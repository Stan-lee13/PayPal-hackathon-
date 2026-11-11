/**
 * The Envelope gateway: the only component that holds PayPal credentials.
 *
 * Agents hold signed envelopes and keys; they never hold money or PayPal access. To move money an
 * agent presents a signed spend request with its envelope chain. The gateway:
 *
 *   1. verifies the chain and the request (pure code, lib/envelope/core.ts);
 *   2. under a per-root lock: registers unseen blocks, checks revocation at every level, checks the
 *      budget of EVERY envelope in the chain, refuses requests it has already seen, and reserves the
 *      amount at every level before any PayPal call;
 *   3. captures exactly that amount from the PayPal authorization that backs the root, then pays
 *      the payee with PayPal Payouts — both idempotent on the spend id;
 *   4. converts the reservation to spend and issues a signed receipt binding the PayPal ids to the
 *      whole authority chain.
 *
 * No model output is read anywhere in this file. `agentNote` is stored for the human, never used.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { blocks, gatewayKeys, roots, spends, type BlockRow, type Receipt, type Root, type Spend } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { formatMoney } from "../money";
import * as E from "../envelope/core";
import { getPayPal, PayPalApiError, paypalMode } from "../paypal/client";
import { authorizeHold, capturePart, getAuthorization, getCapture, getPayout, payout, refundCapture, voidAuthorization } from "../paypal/payments";
import { audit } from "../services/audit";

export const MAX_ROOT_MINOR = 1_000_00; // demo ceiling: $1,000 per envelope
export const RECEIPT_VERSION = "envelope-receipt/1" as const;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
const lockRoot = (tx: Tx, rootId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`envelope-root|${rootId}`}, 0))`);
const trail = (root: Pick<Root, "principal" | "id">, actor: Parameters<typeof audit>[1]["actor"], action: string, outcome: Parameters<typeof audit>[1]["outcome"], ref: string | null, detail: Record<string, unknown> = {}) =>
  audit(getDb(), { scopeId: root.principal, subjectId: root.id, actor, action, ref, outcome, detail });

// ---------------------------------------------------------------------------
// Gateway identity (signs receipts)
// ---------------------------------------------------------------------------

let cachedKey: E.KeyPair | null = null;
export async function gatewayKey(): Promise<E.KeyPair> {
  if (cachedKey) return cachedKey;
  const db = getDb();
  let row = await db.query.gatewayKeys.findFirst({ where: eq(gatewayKeys.id, "default") });
  if (!row) {
    const kp = await E.generateKeyPair();
    await db.insert(gatewayKeys).values({ id: "default", publicKey: kp.publicKey, privateJwk: await E.exportPrivateJwk(kp.privateKey) }).onConflictDoNothing();
    row = (await db.query.gatewayKeys.findFirst({ where: eq(gatewayKeys.id, "default") }))!;
  }
  cachedKey = await E.importPrivateJwk(row.privateJwk);
  return cachedKey;
}
/** Tests switch databases; forget the cached key. */
export function forgetGatewayKey() { cachedKey = null; }

export async function verifyReceipt(r: Receipt): Promise<boolean> {
  const { sig, ...body } = r;
  return E.verifyDetached(r.gateway, RECEIPT_VERSION, body, sig);
}

// ---------------------------------------------------------------------------
// Seal: register a root and back it with a PayPal authorization
// ---------------------------------------------------------------------------

export async function registerRoot(a: { chain: E.Envelope; principalName: string; title: string }): Promise<Root> {
  const db = getDb();
  if (!Array.isArray(a.chain) || a.chain.length !== 1) throw new UserFacingError("Register the root block only.", 422);
  const v = await E.verifyChain(a.chain);
  if (!v.ok) throw new UserFacingError(`This envelope doesn't verify: ${v.violations.map((x) => x.detail).join("; ")}`, 422);
  const b = a.chain[0]!;
  const caps = b.body.caps;
  if (caps.limit > MAX_ROOT_MINOR) throw new UserFacingError(`The demo caps an envelope at ${formatMoney(MAX_ROOT_MINOR, caps.currency)}.`, 422);
  if (caps.currency !== "USD") throw new UserFacingError("The demo supports USD envelopes.", 422);
  if (Date.parse(caps.notAfter) - Date.now() > 28 * 86400_000) throw new UserFacingError("An envelope can live at most 28 days: that is how long PayPal keeps the backing authorization.", 422);
  const existing = await db.query.roots.findFirst({ where: eq(roots.id, b.body.id) });
  if (existing) return existing;

  // The hold: PayPal now guarantees the envelope's whole limit, and will refuse to capture beyond it.
  let auth;
  try {
    auth = await authorizeHold(getPayPal(), { rootId: b.body.id, title: a.title, currency: caps.currency, amountMinor: caps.limit });
  } catch (e) {
    if (e instanceof PayPalApiError) throw new UserFacingError(`PayPal refused the hold: ${e.message}${e.debugId ? ` (debug id ${e.debugId})` : ""}`, 502);
    throw e;
  }
  if (!["CREATED", "PARTIALLY_CAPTURED"].includes(auth.status) || auth.amountMinor !== caps.limit || auth.currency !== caps.currency) {
    try { await voidAuthorization(getPayPal(), auth.id, b.body.id); } catch { /* best effort */ }
    throw new UserFacingError(`PayPal's authorization (${auth.status}, ${auth.amountMinor}) doesn't match the envelope, so it was voided.`, 502);
  }
  const hash = await E.blockHash(b);
  const root = await db.transaction(async (tx) => {
    const [r] = await tx.insert(roots).values({
      id: b.body.id, principal: b.body.issuer, principalName: a.principalName.trim().slice(0, 80) || "Principal", title: a.title.trim().slice(0, 120) || "Envelope",
      currency: caps.currency, limitMinor: caps.limit, paypalOrderId: auth.orderId, authorizationId: auth.id, authorizationExpiresAt: auth.expiresAt ? new Date(auth.expiresAt) : null,
    }).returning();
    await tx.insert(blocks).values({ id: b.body.id, rootId: b.body.id, parentId: null, depth: 0, hash, holder: b.body.holder, holderLabel: b.body.holderLabel, caps, raw: b });
    return r!;
  });
  await trail(root, "principal", "envelope.sealed", "OK", b.body.id, { holder: b.body.holderLabel, caps });
  await trail(root, "paypal", "hold.placed", "OK", auth.id, { amount: formatMoney(auth.amountMinor, auth.currency), expiresAt: auth.expiresAt, order: auth.orderId, mode: paypalMode() });
  return root;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Insert blocks the gateway hasn't seen; a known id with different content is a forgery. Caller holds the root lock. */
async function upsertBlocks(tx: Tx, chain: E.Envelope): Promise<E.Violation[]> {
  const out: E.Violation[] = [];
  const rootId = chain[0]!.body.id;
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i]!;
    const hash = await E.blockHash(b);
    const row = await tx.query.blocks.findFirst({ where: eq(blocks.id, b.body.id) });
    if (row) { if (row.hash !== hash) out.push({ code: "FORKED_BLOCK", at: b.body.id, detail: "a different block with this id is already on record" }); continue; }
    if (i === 0) { out.push({ code: "UNKNOWN_ROOT", at: b.body.id, detail: "this root envelope was never sealed with the gateway" }); break; }
    await tx.insert(blocks).values({ id: b.body.id, rootId, parentId: chain[i - 1]!.body.id, depth: i, hash, holder: b.body.holder, holderLabel: b.body.holderLabel, caps: b.body.caps, raw: b });
  }
  return out;
}

/** An agent tells the gateway about a split so the principal can see (and revoke) it. Optional: splits are valid without it. */
export async function announce(chain: E.Envelope): Promise<{ ids: string[] }> {
  const v = await E.verifyChain(chain);
  if (!v.ok) throw new UserFacingError(`This envelope doesn't verify: ${v.violations.map((x) => `${x.code} (${x.detail})`).join("; ")}`, 422);
  const rootId = chain[0]!.body.id;
  const db = getDb();
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) throw new UserFacingError("This root envelope was never sealed with the gateway.", 404);
  const before = await db.select({ id: blocks.id }).from(blocks).where(eq(blocks.rootId, rootId));
  const bad = await db.transaction(async (tx) => { await lockRoot(tx, rootId); return upsertBlocks(tx, chain); });
  if (bad.length) throw new UserFacingError(bad.map((b) => b.detail).join("; "), 409);
  const known = new Set(before.map((b) => b.id));
  for (const b of chain) if (!known.has(b.body.id)) {
    await trail(root, "agent", "envelope.split", "OK", b.body.id, { by: chain[chain.indexOf(b) - 1]?.body.holderLabel, to: b.body.holderLabel, caps: b.body.caps });
  }
  return { ids: v.ids };
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export type SpendResult = { status: Spend["status"]; spend: Spend | null; reasons: E.Violation[]; receipt: Receipt | null; duplicate: boolean };

export async function spend(signed: E.SignedSpend, agentNote?: string): Promise<SpendResult> {
  const db = getDb();
  const stateless = await E.verifySpend(signed);
  const chain = Array.isArray(signed?.chain) ? signed.chain : [];
  const rootId: string | null = chain[0]?.body?.id ?? null;
  const leaf = chain[chain.length - 1]?.body;
  const root = rootId ? await db.query.roots.findFirst({ where: eq(roots.id, rootId) }) : undefined;
  if (!root || !leaf || !signed.request) {
    return { status: "DENIED", spend: null, duplicate: false, receipt: null, reasons: stateless.violations.length ? stateless.violations : [{ code: "UNKNOWN_ROOT", at: rootId, detail: "this root envelope was never sealed with the gateway" }] };
  }
  const r = signed.request;
  const requestHash = await E.sha256(E.canonical({ request: r, sig: signed.sig }));
  const base = {
    rootId: root.id, leafId: String(leaf.id), leafLabel: String(leaf.holderLabel ?? "").slice(0, 80), chainIds: stateless.chain.ids, requestHash, signed,
    amountMinor: Number.isSafeInteger(r.amount) ? r.amount : 0, currency: String(r.currency ?? ""), payee: String(r.payee ?? "").slice(0, 127), purpose: String(r.purpose ?? "").slice(0, 60), memo: String(r.memo ?? "").slice(0, 200),
    agentNote: agentNote?.trim().slice(0, 500) || null,
  };

  const outcome = await db.transaction(async (tx): Promise<{ row: Spend; fresh: boolean }> => {
    await lockRoot(tx, root.id);
    const seen = await tx.query.spends.findFirst({ where: eq(spends.requestHash, requestHash) });
    if (seen) return { row: seen, fresh: false };
    const reasons: E.Violation[] = [...stateless.violations];
    const live = (await tx.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
    if (live.status !== "ACTIVE") reasons.push({ code: "REVOKED", at: root.id, detail: "the root envelope was closed by its owner" });
    else if (!live.authorizationId) reasons.push({ code: "ROOT_NOT_FUNDED", at: root.id, detail: "no PayPal authorization backs this envelope" });
    if (stateless.ok) {
      reasons.push(...(await upsertBlocks(tx, chain)));
      if (reasons.length === 0) {
        const rows = await tx.select().from(blocks).where(inArray(blocks.id, stateless.chain.ids));
        const byId = new Map(rows.map((x) => [x.id, x]));
        for (let i = 0; i < chain.length; i++) {
          const row = byId.get(chain[i]!.body.id)!;
          if (row.revokedAt) reasons.push({ code: "REVOKED", at: row.id, detail: `${row.holderLabel}'s envelope was revoked` });
          const left = row.caps.limit - row.spentMinor - row.reservedMinor;
          if (r.amount > left) {
            reasons.push(i === chain.length - 1
              ? { code: "OVER_ENVELOPE_LIMIT", at: row.id, detail: `${row.holderLabel} has ${E.money(left, row.caps.currency)} left of ${E.money(row.caps.limit, row.caps.currency)}` }
              : { code: "OVER_ANCESTOR_LIMIT", at: row.id, detail: `${row.holderLabel}'s envelope, above this one, has ${E.money(left, row.caps.currency)} left of ${E.money(row.caps.limit, row.caps.currency)}` });
          }
        }
      }
    }
    if (reasons.length) {
      const [row] = await tx.insert(spends).values({ id: newId("sp"), ...base, status: "DENIED", reasons }).returning();
      return { row: row!, fresh: true };
    }
    const [row] = await tx.insert(spends).values({ id: newId("sp"), ...base, status: "RESERVED" }).returning();
    await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} + ${r.amount}` }).where(inArray(blocks.id, stateless.chain.ids));
    return { row: row!, fresh: true };
  });

  if (outcome.row.status === "DENIED") {
    if (outcome.fresh) await trail(root, "gateway", "spend.denied", "REJECTED", outcome.row.id, { agent: base.leafLabel, amount: base.amountMinor, payee: base.payee, purpose: base.purpose, reasons: outcome.row.reasons.map((x) => x.code) });
    return { status: "DENIED", spend: outcome.row, reasons: outcome.row.reasons, receipt: null, duplicate: !outcome.fresh };
  }
  if (outcome.fresh) await trail(root, "agent", "spend.requested", "PENDING", outcome.row.id, { agent: base.leafLabel, amount: base.amountMinor, payee: base.payee, purpose: base.purpose, chain: base.chainIds });
  // RESERVED (fresh, or an earlier attempt that was interrupted) continues; anything else is returned as it was.
  const done = outcome.row.status === "RESERVED" || outcome.row.status === "CAPTURED" ? await settle(outcome.row.id) : outcome.row;
  return { status: done.status, spend: done, reasons: done.reasons, receipt: done.receipt, duplicate: !outcome.fresh };
}

/** Release a reservation that will never be used. */
async function release(spendRow: Spend, status: "FAILED", reason: E.Violation, extra: Partial<Spend> = {}): Promise<Spend> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockRoot(tx, spendRow.rootId);
    const [u] = await tx.update(spends).set({ status, reasons: [reason], settledAt: new Date(), ...extra }).where(and(eq(spends.id, spendRow.id), inArray(spends.status, ["RESERVED", "CAPTURED"]))).returning();
    if (u) await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${spendRow.amountMinor}` }).where(inArray(blocks.id, spendRow.chainIds));
    return u ?? spendRow;
  });
}

/** Capture, pay out, issue the receipt. Idempotent: safe to call again after a crash or a PayPal outage. */
export async function settle(spendId: string): Promise<Spend> {
  const db = getDb();
  let s = (await db.query.spends.findFirst({ where: eq(spends.id, spendId) }))!;
  if (s.status !== "RESERVED" && s.status !== "CAPTURED") return s;
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  const pp = getPayPal();

  if (!s.captureId) {
    try {
      const cap = await capturePart(pp, root.authorizationId!, { spendId: s.id, amountMinor: s.amountMinor, currency: s.currency, note: `Envelope spend ${s.id}` });
      if (cap.status !== "COMPLETED" && cap.status !== "PENDING") throw new PayPalApiError(422, "CAPTURE_NOT_COMPLETED", cap.status, undefined, `capture ${cap.status}`, null);
      await db.transaction(async (tx) => {
        await tx.update(spends).set({ captureId: cap.id, status: "CAPTURED" }).where(eq(spends.id, s.id));
        await tx.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} + ${s.amountMinor}` }).where(eq(roots.id, root.id));
      });
      s = { ...s, captureId: cap.id, status: "CAPTURED" };
      await trail(root, "paypal", "hold.captured", "OK", cap.id, { spend: s.id, amount: formatMoney(s.amountMinor, s.currency), authorization: root.authorizationId });
    } catch (e) {
      if (e instanceof PayPalApiError && !e.retryable) {
        const failed = await release(s, "FAILED", { code: "PAYPAL_CAPTURE_FAILED", at: root.id, detail: `PayPal refused the capture: ${e.issue ?? e.paypalName}` });
        await trail(root, "paypal", "hold.capture_refused", "FAILED", s.id, { issue: e.issue ?? e.paypalName, debugId: e.debugId ?? null });
        return failed;
      }
      return s; // in doubt (network / 5xx): the reservation stays; presenting the same request again resumes here
    }
  }

  if (!s.payoutBatchId) {
    try {
      const po = await payout(pp, { spendId: s.id, receiverEmail: s.payee, amountMinor: s.amountMinor, currency: s.currency, note: `${s.memo || s.purpose} · paid from an Envelope (${s.id})` });
      await db.update(spends).set({ payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutTransactionId: po.transactionId, payoutStatus: po.itemStatus ?? po.batchStatus }).where(eq(spends.id, s.id));
      s = { ...s, payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutTransactionId: po.transactionId, payoutStatus: po.itemStatus ?? po.batchStatus };
    } catch (e) {
      if (e instanceof PayPalApiError && !e.retryable) {
        // The money was captured but can't be sent: give it back to the principal and free the budget.
        let refundId: string | null = null;
        try { refundId = (await refundCapture(pp, s.captureId!, s.id, "Payout could not be sent")).id; } catch { /* reported below */ }
        await db.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} - ${s.amountMinor}` }).where(eq(roots.id, root.id));
        const failed = await release(s, "FAILED", { code: "PAYPAL_PAYOUT_FAILED", at: root.id, detail: `PayPal refused the payout: ${e.issue ?? e.paypalName}${refundId ? "; the capture was refunded" : "; the refund also failed and needs attention"}` }, { refundId });
        await trail(root, "paypal", "payout.refused", "FAILED", s.id, { issue: e.issue ?? e.paypalName, refunded: refundId });
        return failed;
      }
      return s;
    }
  }

  // Receipt: binds the PayPal transaction ids to the request and the whole authority chain.
  const gw = await gatewayKey();
  const chain = s.signed.chain;
  const receiptBody: Omit<Receipt, "sig"> = {
    v: RECEIPT_VERSION, spend: s.id, decision: "PAID", request: s.signed.request, requestSig: s.signed.sig,
    chain: await Promise.all(chain.map(async (b) => ({ id: b.body.id, hash: await E.blockHash(b), holder: b.body.holder, holderLabel: b.body.holderLabel }))),
    principal: root.principal,
    paypal: { mode: paypalMode(), authorizationId: root.authorizationId!, captureId: s.captureId!, payoutBatchId: s.payoutBatchId!, payoutItemId: s.payoutItemId },
    issuedAt: new Date().toISOString(), gateway: gw.publicKey,
  };
  const receipt: Receipt = { ...receiptBody, sig: await E.signDetached(gw.privateKey, RECEIPT_VERSION, receiptBody) };
  const status = payoutState(s.payoutStatus);
  const final = await db.transaction(async (tx) => {
    await lockRoot(tx, s.rootId);
    const [u] = await tx.update(spends).set({ status, receipt, settledAt: new Date() }).where(and(eq(spends.id, s.id), eq(spends.status, "CAPTURED"))).returning();
    if (u) await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}`, spentMinor: sql`${blocks.spentMinor} + ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
    return u ?? (await tx.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
  });
  await trail(root, "paypal", "payout.sent", "OK", s.payoutBatchId, { spend: s.id, to: s.payee, amount: formatMoney(s.amountMinor, s.currency), item: s.payoutItemId, status: s.payoutStatus });
  if (s.payoutStatus && PAYOUT_DEAD.includes(s.payoutStatus)) return undoDeadPayout(final, s.payoutStatus, null);
  return final;
}

const PAYOUT_DEAD = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];
function payoutState(itemStatus: string | null): Spend["status"] {
  if (itemStatus === "SUCCESS") return "PAID";
  if (itemStatus === "UNCLAIMED") return "UNCLAIMED";
  return "PAYOUT_PENDING";
}

/** PayPal accepted the payout request but later failed or returned it: refund the capture and give the budget back. */
async function undoDeadPayout(s: Spend, itemStatus: string, error: string | null): Promise<Spend> {
  const db = getDb();
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  let refundId: string | null = null;
  try { refundId = (await refundCapture(getPayPal(), s.captureId!, s.id, "Payout could not be delivered")).id; } catch { /* reported in the reason */ }
  const reason: E.Violation = { code: "PAYPAL_PAYOUT_FAILED", at: root.id, detail: `PayPal could not deliver the payout (${error ?? itemStatus})${refundId ? "; the capture was refunded to the owner" : "; the refund also failed and needs attention"}` };
  const u = await db.transaction(async (tx) => {
    await lockRoot(tx, s.rootId);
    const [row] = await tx.update(spends).set({ status: "FAILED", payoutStatus: itemStatus, reasons: [reason], refundId }).where(and(eq(spends.id, s.id), inArray(spends.status, ["PAID", "PAYOUT_PENDING", "UNCLAIMED"]))).returning();
    if (row) {
      await tx.update(blocks).set({ spentMinor: sql`${blocks.spentMinor} - ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
      if (refundId) await tx.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} - ${s.amountMinor}` }).where(eq(roots.id, root.id));
    }
    return row ?? s;
  });
  await trail(root, "paypal", "payout.failed", "FAILED", s.payoutBatchId, { spend: s.id, status: itemStatus, error, refunded: refundId });
  return u;
}

/** Ask PayPal where a pending payout is. */
export async function syncSpend(spendId: string): Promise<Spend> {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s) throw new UserFacingError("No such spend.", 404);
  if (!s.payoutBatchId || !["PAYOUT_PENDING", "UNCLAIMED"].includes(s.status)) return s;
  const po = await getPayout(getPayPal(), s.payoutBatchId).catch(() => null);
  if (!po) return s;
  const st = po.itemStatus ?? po.batchStatus;
  if (PAYOUT_DEAD.includes(st)) return undoDeadPayout(s, st, po.error);
  const [u] = await db.update(spends).set({ payoutStatus: st, payoutItemId: po.itemId ?? s.payoutItemId, payoutTransactionId: po.transactionId ?? s.payoutTransactionId, status: payoutState(st) }).where(eq(spends.id, s.id)).returning();
  return u!;
}

// ---------------------------------------------------------------------------
// Revoke / close
// ---------------------------------------------------------------------------

/**
 * Revoke one envelope (and so everything split from it). Allowed for the principal, the holder of
 * any ancestor, or the holder itself. Revoking the root closes it: PayPal releases what was never spent.
 */
export async function revoke(signed: E.SignedRevoke): Promise<{ block: BlockRow; root: Root }> {
  const db = getDb();
  if (!(await E.verifyRevokeSignature(signed))) throw new UserFacingError("The revocation isn't properly signed, or is too old.", 401);
  const block = await db.query.blocks.findFirst({ where: eq(blocks.id, signed.request.block) });
  if (!block) throw new UserFacingError("The gateway hasn't seen that envelope.", 404);
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, block.rootId) }))!;
  const allowed = new Set<string>([root.principal, block.holder]);
  for (let p = block.parentId; p; ) { const row = await db.query.blocks.findFirst({ where: eq(blocks.id, p) }); if (!row) break; allowed.add(row.holder); p = row.parentId; }
  if (!allowed.has(signed.by)) throw new UserFacingError("Only the owner, or the holder of an envelope above this one, can revoke it.", 403);

  if (block.depth === 0) return { block, root: await closeRoot(root, signed.by === root.principal ? "closed by its owner" : "closed by its holder", signed.by) };
  const [u] = await db.update(blocks).set({ revokedAt: new Date(), revokedBy: signed.by }).where(and(eq(blocks.id, block.id), sql`${blocks.revokedAt} is null`)).returning();
  if (u) await trail(root, signed.by === root.principal ? "principal" : "agent", "envelope.revoked", "OK", block.id, { holder: block.holderLabel, by: E.fingerprint(signed.by) });
  return { block: u ?? block, root };
}

async function closeRoot(root: Root, reason: string, by: string): Promise<Root> {
  const db = getDb();
  const closed = await db.transaction(async (tx) => {
    await lockRoot(tx, root.id);
    const live = (await tx.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
    if (live.status !== "ACTIVE") return null;
    const inflight = await tx.select({ n: sql<number>`count(*)::int` }).from(spends).where(and(eq(spends.rootId, root.id), inArray(spends.status, ["RESERVED", "CAPTURED"])));
    if ((inflight[0]?.n ?? 0) > 0) throw new UserFacingError("A payment from this envelope is still in flight; try again in a moment.", 409);
    const [u] = await tx.update(roots).set({ status: "CLOSED", closedAt: new Date(), closeReason: reason, releasedMinor: live.limitMinor - live.capturedMinor }).where(eq(roots.id, root.id)).returning();
    await tx.update(blocks).set({ revokedAt: new Date(), revokedBy: by }).where(and(eq(blocks.id, root.id), sql`${blocks.revokedAt} is null`));
    return u!;
  });
  if (!closed) return (await db.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
  await trail(root, "principal", "envelope.closed", "OK", root.id, { reason });
  if (closed.authorizationId) {
    try {
      await voidAuthorization(getPayPal(), closed.authorizationId, root.id);
      await trail(root, "paypal", "hold.released", "OK", closed.authorizationId, { released: formatMoney(closed.releasedMinor ?? 0, closed.currency), captured: formatMoney(closed.capturedMinor, closed.currency) });
    } catch (e) {
      // Fully captured holds can't be voided (nothing is left to release); anything else is worth knowing about.
      const issue = e instanceof PayPalApiError ? e.issue ?? e.paypalName : String(e).slice(0, 120);
      await trail(root, "paypal", "hold.release_failed", issue === "PREVIOUSLY_CAPTURED" || issue === "AUTHORIZATION_ALREADY_CAPTURED" ? "INFO" : "FAILED", closed.authorizationId, { issue });
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function tree(rootId: string) {
  const db = getDb();
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) return null;
  const [bs, ss] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.rootId, rootId)).orderBy(asc(blocks.depth), asc(blocks.firstSeenAt)),
    db.select().from(spends).where(eq(spends.rootId, rootId)).orderBy(desc(spends.createdAt)).limit(200),
  ]);
  return { root, blocks: bs, spends: ss };
}

/** Independent check of a receipt: its signature, and what PayPal itself says about the capture and the payout. */
export async function reconcile(spendId: string) {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s?.receipt) throw new UserFacingError("No receipt for that spend.", 404);
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  const pp = getPayPal();
  const [signatureOk, chainVerdict, cap, po, auth] = await Promise.all([
    verifyReceipt(s.receipt),
    E.verifyChain(s.signed.chain, new Date(s.signed.request.at)),
    getCapture(pp, s.captureId!).catch(() => null),
    getPayout(pp, s.payoutBatchId!).catch(() => null),
    getAuthorization(pp, root.authorizationId!).catch(() => null),
  ]);
  const checks = [
    { name: "Receipt is signed by the gateway", ok: signatureOk },
    { name: "Authority chain verifies back to the principal's key", ok: chainVerdict.ok && chainVerdict.principal === root.principal },
    { name: "PayPal capture exists for exactly this amount", ok: Boolean(cap && cap.amountMinor === s.amountMinor && cap.currency === s.currency && ["COMPLETED", "PENDING", "PARTIALLY_REFUNDED"].includes(cap.status)), detail: cap ? `${cap.id} · ${cap.status} · ${formatMoney(cap.amountMinor, cap.currency)}` : "not found" },
    { name: "PayPal capture carries this spend's id", ok: Boolean(cap && (cap.invoiceId === s.id || cap.invoiceId === null)), detail: cap?.invoiceId ?? "invoice_id not returned" },
    { name: "PayPal payout went to the payee the agent signed for", ok: Boolean(po && po.receiver?.toLowerCase() === s.payee), detail: po ? `${po.batchId} · ${po.itemStatus ?? po.batchStatus} · ${po.receiver}` : "not found" },
    { name: "The hold belongs to this envelope", ok: Boolean(auth && (auth.customId === root.id || auth.customId === null)), detail: auth ? `${auth.id} · ${auth.status}` : "not found" },
  ];
  return { spend: s, receipt: s.receipt, checks, ok: checks.every((c) => c.ok) };
}
