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
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { accounts, blocks, gatewayKeys, ledger, roots, spends, type Account, type BlockRow, type PromiseNote, type Receipt, type Root, type Spend } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { formatMoney } from "../money";
import * as E from "../envelope/core";
import { getPayPal, PayPalApiError, paypalMode } from "../paypal/client";
import { authorizeHold, capturePart, getAuthorization, getCapture, getPayout, payout, refundCapture, voidAuthorization } from "../paypal/payments";
import { openJwk, sealJwk } from "../keystore";
import { audit } from "../services/audit";

export const MAX_ROOT_MINOR = 1_000_00; // demo ceiling: $1,000 per envelope
export const RECEIPT_VERSION = "envelope-receipt/1" as const;
export const PROMISE_NOTE_VERSION = "envelope-promise-note/1" as const;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
const lockRoot = (tx: Tx, rootId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`envelope-root|${rootId}`}, 0))`);
/** One lock per agent account: every change to a balance happens under it. */
export const lockAccount = (tx: Tx, agent: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`envelope-account|${agent}`}, 0))`);
/** A payment to an account that keeps its income: there is an agent, and no PayPal address to pay out to. */
export const isHeld = (s: Pick<Spend, "payeeAgent" | "payoutTo">) => Boolean(s.payeeAgent && !s.payoutTo);
export const HELD = "HELD_IN_ACCOUNT" as const;
/** PayPal accepted the capture but has not completed it. Nothing is paid out against it until it has. */
export const AWAITING_CAPTURE = "AWAITING_CAPTURE" as const;
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
    await db.insert(gatewayKeys).values({ id: "default", publicKey: kp.publicKey, privateJwk: await sealJwk(await E.exportPrivateJwk(kp.privateKey)) }).onConflictDoNothing();
    row = (await db.query.gatewayKeys.findFirst({ where: eq(gatewayKeys.id, "default") }))!;
  }
  cachedKey = await E.importPrivateJwk(await openJwk(row.privateJwk));
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
  if (typeof b.body.holderLabel !== "string" || !b.body.holderLabel.trim() || b.body.holderLabel.length > 80) throw new UserFacingError("An envelope names the agent it is for.", 422);
  const hash = await E.blockHash(b);
  const existing = await db.query.roots.findFirst({ where: eq(roots.id, b.body.id) });
  if (existing) {
    const on = await db.query.blocks.findFirst({ where: eq(blocks.id, b.body.id) });
    if (on && on.hash !== hash) throw new UserFacingError("A different envelope with that id is already sealed.", 409);
    return existing;
  }

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
  const root = await db.transaction(async (tx) => {
    const [r] = await tx.insert(roots).values({
      id: b.body.id, principal: b.body.issuer, principalName: a.principalName.trim().slice(0, 80) || "Principal", title: a.title.trim().slice(0, 120) || "Envelope",
      currency: caps.currency, limitMinor: caps.limit, paypalOrderId: auth.orderId, authorizationId: auth.id, authorizationExpiresAt: auth.expiresAt ? new Date(auth.expiresAt) : null,
    }).returning();
    await tx.insert(blocks).values({ id: b.body.id, rootId: b.body.id, parentId: null, depth: 0, hash, holder: b.body.holder, holderLabel: b.body.holderLabel, caps, raw: b });
    return r!;
  }).catch(async (e) => {
    // The hold exists at PayPal but could not be recorded: let it go, so it is not left on the owner's funding source.
    try { await voidAuthorization(getPayPal(), auth.id, b.body.id); } catch { /* reported by the error below */ }
    throw e;
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

/** Under the root lock: give back the reservation of one promise. */
async function lapse(tx: Tx, s: Spend, reason: E.Violation): Promise<Spend | null> {
  const [u] = await tx.update(spends).set({ status: "LAPSED", reasons: [reason], settledAt: new Date() }).where(and(eq(spends.id, s.id), eq(spends.status, "PROMISED"))).returning();
  if (u) await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
  return u ?? null;
}
/** Under the root lock: release every promise whose time has run out. */
async function sweep(tx: Tx, rootId: string): Promise<Spend[]> {
  const due = await tx.select().from(spends).where(and(eq(spends.rootId, rootId), eq(spends.status, "PROMISED"), lt(spends.promiseExpiresAt, new Date())));
  const out: Spend[] = [];
  for (const s of due) { const u = await lapse(tx, s, { code: "PROMISE_LAPSED", at: s.leafId, detail: "the promise ran out before it was paid" }); if (u) out.push(u); }
  return out;
}
const trailLapsed = async (root: Pick<Root, "principal" | "id">, lapsed: Spend[]) => {
  for (const s of lapsed) await trail(root, "gateway", "promise.lapsed", "INFO", s.id, { agent: s.leafLabel, amount: s.amountMinor, payee: s.payee, why: s.reasons[0]?.detail ?? null });
};
/** Reads call this so budgets never show money held by a promise that has already run out. */
export async function sweepExpired(rootId: string): Promise<void> {
  const db = getDb();
  const due = await db.select({ id: spends.id }).from(spends).where(and(eq(spends.rootId, rootId), eq(spends.status, "PROMISED"), lt(spends.promiseExpiresAt, new Date()))).limit(1);
  if (due.length === 0) return;
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) return;
  await trailLapsed(root, await db.transaction(async (tx) => { await lockRoot(tx, rootId); return sweep(tx, rootId); }));
}

export const spend = (signed: E.SignedSpend, agentNote?: string): Promise<SpendResult> => admit("spend", signed, agentNote);

/**
 * Admission, shared by payments and promises: both are checked against the same rules and reserve the
 * amount at every level. A payment then settles on PayPal; a promise waits for its maker to pay or release it.
 */
async function admit(kind: "spend" | "promise", signed: E.SignedSpend | E.SignedPromise, agentNote?: string): Promise<SpendResult> {
  const db = getDb();
  const stateless = kind === "spend" ? await E.verifySpend(signed as E.SignedSpend) : await E.verifyPromise(signed as E.SignedPromise);
  const chain = Array.isArray(signed?.chain) ? signed.chain : [];
  const rootId: string | null = chain[0]?.body?.id ?? null;
  const leaf = chain[chain.length - 1]?.body;
  const root = rootId ? await db.query.roots.findFirst({ where: eq(roots.id, rootId) }) : undefined;
  if (!root || !leaf || !signed.request) {
    return { status: "DENIED", spend: null, duplicate: false, receipt: null, reasons: stateless.violations.length ? stateless.violations : [{ code: "UNKNOWN_ROOT", at: rootId, detail: "this root envelope was never sealed with the gateway" }] };
  }
  const r = signed.request;
  // What makes a request "the same request" is its signed content (it carries a nonce), never how the
  // signature happens to be written. Requests whose signature does not verify are keyed with it, so
  // junk can't occupy a real request's place.
  const authentic = typeof leaf.holder === "string" && typeof r.v === "string" && typeof signed.sig === "string" && (await E.verifyDetached(leaf.holder, r.v, r, signed.sig));
  // A refusal is recorded against an envelope only when the request really came from its holder: signed by
  // the key the block on record was given to, or by the holder of a chain that verifies. Anything else is
  // refused and forgotten, so strangers cannot write into someone's record.
  const onRecord = typeof leaf.id === "string" ? await db.query.blocks.findFirst({ where: eq(blocks.id, leaf.id) }) : undefined;
  const fromHolder = authentic && (onRecord ? onRecord.holder === leaf.holder && onRecord.rootId === root.id : stateless.chain.ok);
  if (!fromHolder) {
    const why = stateless.violations.length ? stateless.violations : [{ code: "NOT_THE_HOLDER" as const, at: null, detail: "the request is not signed by the key this envelope was given to" }];
    return { status: "DENIED", spend: null, duplicate: false, receipt: null, reasons: why };
  }
  const requestHash = await E.sha256(E.canonical(authentic ? { request: r } : { request: r, sig: signed.sig }));
  const base = {
    rootId: root.id, leafId: String(leaf.id), leafLabel: String(leaf.holderLabel ?? "").slice(0, 80), chainIds: stateless.chain.ids, requestHash, signed,
    amountMinor: Number.isSafeInteger(r.amount) ? r.amount : 0, currency: String(r.currency ?? ""), payee: String(r.payee ?? "").slice(0, 127), purpose: String(r.purpose ?? "").slice(0, 60), memo: String(r.memo ?? "").slice(0, 200),
    agentNote: agentNote?.trim().slice(0, 500) || null,
  };

  const outcome = await db.transaction(async (tx): Promise<{ row: Spend; fresh: boolean; lapsed: Spend[] }> => {
    await lockRoot(tx, root.id);
    const lapsed = await sweep(tx, root.id);
    const seen = await tx.query.spends.findFirst({ where: eq(spends.requestHash, requestHash) });
    if (seen) return { row: seen, fresh: false, lapsed };
    const reasons: E.Violation[] = [...stateless.violations];
    // A payee written as an account number is an agent: fix where its income is settled now, so a later change can't redirect this payment.
    let payeeAgent: string | null = null, payoutTo: string | null = null;
    if (E.isAccountPayee(base.payee)) {
      const number = base.payee.slice(5).toUpperCase();
      const acct = await tx.query.accounts.findFirst({ where: eq(accounts.account, number) });
      // An account that holds its income is credited here; one that settles is paid out to the address fixed now.
      if (acct) { payeeAgent = acct.agent; payoutTo = acct.mode === "hold" ? null : acct.settleTo; }
      else reasons.push({ code: "PAYEE_ACCOUNT_UNKNOWN", at: null, detail: `no agent has opened account ${number}` });
    }
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
    const promiseExpiresAt = kind === "promise" && Number.isSafeInteger((r as E.PromiseRequest).ttl)
      ? new Date(Math.min(Date.now() + (r as E.PromiseRequest).ttl * 1000, Date.parse(String(leaf.caps?.notAfter)) || Date.now())) : null;
    if (reasons.length) {
      const [row] = await tx.insert(spends).values({ id: newId(kind === "promise" ? "pr" : "sp"), ...base, payeeAgent, payoutTo, promiseExpiresAt, status: "DENIED", reasons }).returning();
      return { row: row!, fresh: true, lapsed };
    }
    const [row] = await tx.insert(spends).values({ id: newId(kind === "promise" ? "pr" : "sp"), ...base, payeeAgent, payoutTo, promiseExpiresAt, status: kind === "promise" ? "PROMISED" : "RESERVED" }).returning();
    await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} + ${r.amount}` }).where(inArray(blocks.id, stateless.chain.ids));
    return { row: row!, fresh: true, lapsed };
  });
  await trailLapsed(root, outcome.lapsed);

  if (kind === "promise") {
    if (outcome.row.status === "DENIED" && outcome.fresh) await trail(root, "gateway", "promise.denied", "REJECTED", outcome.row.id, { agent: base.leafLabel, amount: base.amountMinor, payee: base.payee, purpose: base.purpose, reasons: outcome.row.reasons.map((x) => x.code) });
    if (outcome.row.status === "PROMISED" && outcome.fresh) await trail(root, "agent", "promise.made", "OK", outcome.row.id, { agent: base.leafLabel, amount: base.amountMinor, payee: base.payee, purpose: base.purpose, until: outcome.row.promiseExpiresAt?.toISOString() ?? null });
    return { status: outcome.row.status, spend: outcome.row, reasons: outcome.row.reasons, receipt: outcome.row.receipt, duplicate: !outcome.fresh };
  }
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
    const line = await db.select({ id: blocks.id, label: blocks.holderLabel, revokedAt: blocks.revokedAt }).from(blocks).where(inArray(blocks.id, s.chainIds));
    const cut = line.find((b) => b.revokedAt);
    if (root.status !== "ACTIVE" || cut) {
      const failed = await release(s, "FAILED", { code: "REVOKED", at: cut?.id ?? root.id, detail: cut ? `${cut.label}'s envelope was revoked before this was captured; nothing was paid` : "the envelope was closed before this was captured; nothing was paid" });
      await trail(root, "gateway", "spend.stopped", "REJECTED", s.id, { reason: "revoked before capture" });
      return failed;
    }
    try {
      const cap = await capturePart(pp, root.authorizationId!, { spendId: s.id, amountMinor: s.amountMinor, currency: s.currency, note: `Envelope spend ${s.id}` });
      if (cap.status !== "COMPLETED" && cap.status !== "PENDING") throw new PayPalApiError(422, "CAPTURE_NOT_COMPLETED", cap.status, undefined, `capture ${cap.status}`, null);
      // The same request can arrive many times at once, and each arrival gets the same capture back from
      // PayPal (one idempotency key). Only the one that records the capture id counts the money.
      const claimed = await db.transaction(async (tx) => {
        const [u] = await tx.update(spends).set({ captureId: cap.id, status: "CAPTURED", ...(cap.status === "PENDING" ? { payoutStatus: AWAITING_CAPTURE } : {}) })
          .where(and(eq(spends.id, s.id), eq(spends.status, "RESERVED"), isNull(spends.captureId))).returning();
        if (u) await tx.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} + ${s.amountMinor}` }).where(eq(roots.id, root.id));
        return u ?? null;
      });
      if (claimed) await trail(root, "paypal", "hold.captured", "OK", cap.id, { spend: s.id, amount: formatMoney(s.amountMinor, s.currency), authorization: root.authorizationId, status: cap.status });
      s = claimed ?? (await db.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
      if (s.status !== "CAPTURED") return s; // another arrival already finished it, or it failed
    } catch (e) {
      if (e instanceof PayPalApiError && !e.retryable) {
        const failed = await release(s, "FAILED", { code: "PAYPAL_CAPTURE_FAILED", at: root.id, detail: `PayPal refused the capture: ${e.issue ?? e.paypalName}` });
        await trail(root, "paypal", "hold.capture_refused", "FAILED", s.id, { issue: e.issue ?? e.paypalName, debugId: e.debugId ?? null });
        return failed;
      }
      return s; // in doubt (network / 5xx): the reservation stays; presenting the same request again resumes here
    }
  }

  // PayPal still has the capture under review: the money has not arrived, so nobody is paid yet.
  if (s.payoutStatus === AWAITING_CAPTURE) {
    const cap = await getCapture(pp, s.captureId!).catch(() => null);
    if (!cap || cap.status === "PENDING") return s;
    if (cap.status !== "COMPLETED") {
      const reason: E.Violation = { code: "PAYPAL_CAPTURE_FAILED", at: root.id, detail: `PayPal did not complete the capture (${cap.status}); nothing was paid` };
      const failed = await db.transaction(async (tx) => {
        await lockRoot(tx, s.rootId);
        const [u] = await tx.update(spends).set({ status: "FAILED", payoutStatus: null, reasons: [reason], settledAt: new Date() }).where(and(eq(spends.id, s.id), eq(spends.status, "CAPTURED"), eq(spends.payoutStatus, AWAITING_CAPTURE))).returning();
        if (u) {
          await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
          await tx.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} - ${s.amountMinor}` }).where(eq(roots.id, root.id));
        }
        return u ?? (await tx.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
      });
      await trail(root, "paypal", "hold.capture_not_completed", "FAILED", s.captureId, { spend: s.id, status: cap.status });
      return failed;
    }
    await db.update(spends).set({ payoutStatus: null }).where(and(eq(spends.id, s.id), eq(spends.payoutStatus, AWAITING_CAPTURE)));
    s = { ...s, payoutStatus: null };
  }

  // An account that holds its income: the captured money is credited to its balance, exactly once. No payout.
  let credit: { id: number; balanceAfterMinor: number } | null = null;
  if (isHeld(s)) {
    credit = await db.transaction(async (tx) => {
      await lockAccount(tx, s.payeeAgent!);
      const had = await tx.query.ledger.findFirst({ where: and(eq(ledger.agent, s.payeeAgent!), eq(ledger.kind, "income"), eq(ledger.ref, s.id)) });
      if (had) return had;
      const a = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, s.payeeAgent!) }))!;
      const after = a.balanceMinor + s.amountMinor;
      await tx.update(accounts).set({ balanceMinor: after }).where(eq(accounts.agent, a.agent));
      const [row] = await tx.insert(ledger).values({ agent: a.agent, kind: "income", ref: s.id, deltaMinor: s.amountMinor, balanceAfterMinor: after, counterparty: s.leafLabel, memo: s.memo || s.purpose }).returning();
      return row!;
    });
    if (s.payoutStatus !== HELD) { await db.update(spends).set({ payoutStatus: HELD }).where(eq(spends.id, s.id)); s = { ...s, payoutStatus: HELD }; }
  } else if (!s.payoutBatchId) {
    try {
      const po = await payout(pp, { spendId: s.id, receiverEmail: s.payoutTo ?? s.payee, amountMinor: s.amountMinor, currency: s.currency, note: `${s.memo || s.purpose} · paid from an Envelope (${s.id})` });
      await db.update(spends).set({ payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutTransactionId: po.transactionId, payoutStatus: po.itemStatus ?? po.batchStatus }).where(eq(spends.id, s.id));
      s = { ...s, payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutTransactionId: po.transactionId, payoutStatus: po.itemStatus ?? po.batchStatus };
    } catch (e) {
      if (e instanceof PayPalApiError && !e.retryable) {
        // Another arrival of this same request may have sent the payout a moment ago, in which case PayPal is refusing a duplicate, not the payment.
        const again = (await db.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
        if (again.payoutBatchId) s = again;
        else if (e.issue === "DUPLICATE_REQUEST_ID" || /duplicate/i.test(e.message)) return again; // a payout exists at PayPal that we have no id for: do not refund on top of it
        else {
          // The money was captured but can't be sent: refund the owner. If PayPal won't refund either, say so and keep counting it.
          const failed = await refundOrPark(s, root, `PayPal refused the payout: ${e.issue ?? e.paypalName}`, null);
          await trail(root, "paypal", "payout.refused", "FAILED", s.id, { issue: e.issue ?? e.paypalName, refunded: failed.refundId, status: failed.status });
          return failed;
        }
      } else return s;
    }
  }

  // Receipt: binds the PayPal transaction ids to the request and the whole authority chain.
  const gw = await gatewayKey();
  const chain = s.signed.chain;
  const payeeAcct = s.payeeAgent ? await db.query.accounts.findFirst({ where: eq(accounts.agent, s.payeeAgent) }) : null;
  const receiptBody: Omit<Receipt, "sig"> = {
    v: RECEIPT_VERSION, spend: s.id, decision: "PAID", request: s.signed.request, requestSig: s.signed.sig,
    ...(s.delivery ? { releasedBy: { key: s.delivery.by, work: s.delivery.work, note: s.delivery.note, at: s.delivery.at } } : {}),
    ...(s.payeeAgent ? { paidTo: { account: E.accountNumber(s.payeeAgent), agent: s.payeeAgent, agentLabel: payeeAcct?.label ?? "agent", settledTo: credit ? "balance" : maskEmail(s.payoutTo!), ...(credit ? { held: { ledgerEntry: credit.id, balanceAfterMinor: credit.balanceAfterMinor } } : {}) } } : {}),
    chain: await Promise.all(chain.map(async (b) => ({ id: b.body.id, hash: await E.blockHash(b), holder: b.body.holder, holderLabel: b.body.holderLabel }))),
    principal: root.principal,
    paypal: { mode: paypalMode(), authorizationId: root.authorizationId!, captureId: s.captureId!, payoutBatchId: s.payoutBatchId, payoutItemId: s.payoutItemId, payoutStatus: credit ? null : s.payoutStatus ?? "PENDING" },
    issuedAt: new Date().toISOString(), gateway: gw.publicKey,
  };
  const receipt: Receipt = { ...receiptBody, sig: await E.signDetached(gw.privateKey, RECEIPT_VERSION, receiptBody) };
  const status = credit ? "PAID" : payoutState(s.payoutStatus);
  const final = await db.transaction(async (tx) => {
    await lockRoot(tx, s.rootId);
    const [u] = await tx.update(spends).set({ status, receipt, settledAt: new Date() }).where(and(eq(spends.id, s.id), eq(spends.status, "CAPTURED"))).returning();
    if (u) await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}`, spentMinor: sql`${blocks.spentMinor} + ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
    return u ?? (await tx.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
  });
  if (credit) { await trail(root, "gateway", "balance.credited", "OK", s.captureId, { spend: s.id, account: s.payee, amount: formatMoney(s.amountMinor, s.currency), ledgerEntry: credit.id }); return final; }
  await trail(root, "paypal", "payout.sent", "OK", s.payoutBatchId, { spend: s.id, to: s.payoutTo ?? s.payee, ...(s.payeeAgent ? { account: s.payee } : {}), amount: formatMoney(s.amountMinor, s.currency), item: s.payoutItemId, status: s.payoutStatus });
  if (s.payoutStatus && PAYOUT_DEAD.includes(s.payoutStatus)) return undoDeadPayout(final, s.payoutStatus, null);
  return final;
}

const PAYOUT_DEAD = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];
function payoutState(itemStatus: string | null): Spend["status"] {
  if (itemStatus === "SUCCESS") return "PAID";
  if (itemStatus === "UNCLAIMED") return "UNCLAIMED";
  return "PAYOUT_PENDING";
}

/**
 * Captured money that cannot reach its payee goes back to the owner. If PayPal refuses the refund as
 * well, the owner has still been charged: the spend is parked as REFUND_DUE, the capture stays in the
 * books and the budget stays used, until a later attempt (syncSpend) gets the refund through.
 */
async function refundOrPark(s: Spend, root: Root, why: string, payoutStatus: string | null): Promise<Spend> {
  const db = getDb();
  let refundId: string | null = null;
  try { refundId = (await refundCapture(getPayPal(), s.captureId!, s.id, "Payout could not be delivered")).id; }
  catch (e) { if (e instanceof PayPalApiError && e.issue === "CAPTURE_FULLY_REFUNDED") refundId = "already-refunded"; }
  const reason: E.Violation = { code: "PAYPAL_PAYOUT_FAILED", at: root.id, detail: `${why}${refundId ? "; the capture was refunded to the owner" : "; the refund also failed, so the owner has been charged and the amount stays counted until PayPal accepts the refund"}` };
  return db.transaction(async (tx) => {
    await lockRoot(tx, s.rootId);
    const live = (await tx.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
    const inFlight = live.status === "RESERVED" || live.status === "CAPTURED"; // the amount sits in reservedMinor
    const settled = ["PAID", "PAYOUT_PENDING", "UNCLAIMED", "REFUND_DUE"].includes(live.status); // the amount sits in spentMinor
    if (!inFlight && !settled) return live;
    if (refundId) {
      const [u] = await tx.update(spends).set({ status: "FAILED", reasons: [reason], refundId, settledAt: new Date(), ...(payoutStatus ? { payoutStatus } : {}) }).where(and(eq(spends.id, s.id), eq(spends.status, live.status))).returning();
      if (!u) return live;
      await tx.update(blocks).set(inFlight ? { reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}` } : { spentMinor: sql`${blocks.spentMinor} - ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
      await tx.update(roots).set({ capturedMinor: sql`${roots.capturedMinor} - ${s.amountMinor}` }).where(eq(roots.id, root.id));
      return u;
    }
    if (live.status === "REFUND_DUE") return live;
    const [u] = await tx.update(spends).set({ status: "REFUND_DUE", reasons: [reason], ...(payoutStatus ? { payoutStatus } : {}) }).where(and(eq(spends.id, s.id), eq(spends.status, live.status))).returning();
    if (!u) return live;
    // Parked money always sits in spentMinor, so a later refund knows where to take it from.
    if (inFlight) await tx.update(blocks).set({ reservedMinor: sql`${blocks.reservedMinor} - ${s.amountMinor}`, spentMinor: sql`${blocks.spentMinor} + ${s.amountMinor}` }).where(inArray(blocks.id, s.chainIds));
    return u;
  });
}

/** PayPal accepted the payout request but later failed or returned it. */
async function undoDeadPayout(s: Spend, itemStatus: string, error: string | null): Promise<Spend> {
  const root = (await getDb().query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  const u = await refundOrPark(s, root, `PayPal could not deliver the payout (${error ?? itemStatus})`, itemStatus);
  await trail(root, "paypal", "payout.failed", "FAILED", s.payoutBatchId, { spend: s.id, status: itemStatus, error, refunded: u.refundId, state: u.status });
  return u;
}

/** Ask PayPal where a pending payout is. */
export async function syncSpend(spendId: string): Promise<Spend> {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s) throw new UserFacingError("No such spend.", 404);
  // Unfinished work resumes here: a capture PayPal was still reviewing, or a refund PayPal refused earlier.
  if (s.status === "RESERVED" || s.status === "CAPTURED") return settle(s.id);
  if (s.status === "REFUND_DUE") { const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!; return refundOrPark(s, root, "The payout did not go through", null); }
  if (!s.payoutBatchId || !["PAYOUT_PENDING", "UNCLAIMED"].includes(s.status)) return s;
  const po = await getPayout(getPayPal(), s.payoutBatchId).catch(() => null);
  if (!po) return s;
  const st = po.itemStatus ?? po.batchStatus;
  if (PAYOUT_DEAD.includes(st)) return undoDeadPayout(s, st, po.error);
  const [u] = await db.update(spends).set({ payoutStatus: st, payoutItemId: po.itemId ?? s.payoutItemId, payoutTransactionId: po.transactionId ?? s.payoutTransactionId, status: payoutState(st) }).where(and(eq(spends.id, s.id), inArray(spends.status, ["PAYOUT_PENDING", "UNCLAIMED"]))).returning();
  return u ?? (await db.query.spends.findFirst({ where: eq(spends.id, s.id) }))!;
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
  const { u, lapsed } = await db.transaction(async (tx) => {
    await lockRoot(tx, root.id);
    const [u] = await tx.update(blocks).set({ revokedAt: new Date(), revokedBy: signed.by }).where(and(eq(blocks.id, block.id), sql`${blocks.revokedAt} is null`)).returning();
    // Money set aside under a revoked envelope goes back to the levels above it.
    const open = await tx.select().from(spends).where(and(eq(spends.rootId, root.id), eq(spends.status, "PROMISED")));
    const lapsed: Spend[] = [];
    for (const p of open) if (p.chainIds.includes(block.id)) { const x = await lapse(tx, p, { code: "REVOKED", at: block.id, detail: `${block.holderLabel}'s envelope was revoked` }); if (x) lapsed.push(x); }
    return { u, lapsed };
  });
  await trailLapsed(root, lapsed);
  if (u) await trail(root, signed.by === root.principal ? "principal" : "agent", "envelope.revoked", "OK", block.id, { holder: block.holderLabel, by: E.fingerprint(signed.by) });
  return { block: u ?? block, root };
}

async function closeRoot(root: Root, reason: string, by: string): Promise<Root> {
  const db = getDb();
  const closed = await db.transaction(async (tx) => {
    await lockRoot(tx, root.id);
    const live = (await tx.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
    if (live.status !== "ACTIVE") return null;
    const open = await tx.select().from(spends).where(and(eq(spends.rootId, root.id), eq(spends.status, "PROMISED")));
    for (const p of open) await lapse(tx, p, { code: "REVOKED", at: root.id, detail: "the envelope was closed by its owner" });
    const inflight = await tx.select({ n: sql<number>`count(*)::int` }).from(spends).where(and(eq(spends.rootId, root.id), inArray(spends.status, ["RESERVED", "CAPTURED"])));
    if ((inflight[0]?.n ?? 0) > 0) throw new UserFacingError("A payment from this envelope is still in flight; try again in a moment.", 409);
    const [u] = await tx.update(roots).set({ status: "CLOSED", closedAt: new Date(), closeReason: reason, releasedMinor: live.limitMinor - live.capturedMinor }).where(eq(roots.id, root.id)).returning();
    await tx.update(blocks).set({ revokedAt: new Date(), revokedBy: by }).where(and(eq(blocks.id, root.id), sql`${blocks.revokedAt} is null`));
    return u!;
  });
  if (!closed) {
    // Already closed. If the void did not go through the first time, the hold may still be there: ask again (PayPal treats a repeat as the same request).
    const now = (await db.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
    if (now.status === "CLOSED" && now.authorizationId) { try { await voidAuthorization(getPayPal(), now.authorizationId, root.id); } catch { /* already voided or fully captured */ } }
    return now;
  }
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
// Promises: money set aside for one payee, backed by the same hold
// ---------------------------------------------------------------------------

export type PromiseResult = SpendResult & { note: PromiseNote | null };

/**
 * An agent sets money aside for a payee before the work starts. The amount is reserved at every
 * level exactly like a payment, so nothing else can spend it; the payee gets a note signed by the
 * gateway, after PayPal has confirmed the hold. Later the agent pays it (`keep`) or releases it.
 * The owner can still revoke: a promise is earmarked money, not escrow.
 */
export async function promise(signed: E.SignedPromise, agentNote?: string): Promise<PromiseResult> {
  const res = await admit("promise", signed, agentNote);
  const s = res.spend;
  if (!s || s.status !== "PROMISED") return { ...res, note: s?.promiseNote ?? null };
  if (s.promiseNote) return { ...res, note: s.promiseNote };
  const db = getDb();
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  // Ask PayPal itself before telling a payee the money is there.
  let status: string | null = null;
  try { status = (await getAuthorization(getPayPal(), root.authorizationId!)).status; } catch { status = null; }
  if (status !== "CREATED" && status !== "PARTIALLY_CAPTURED") {
    const reason: E.Violation = { code: "ROOT_NOT_FUNDED", at: root.id, detail: status ? `PayPal reports the hold as ${status}` : "PayPal could not confirm the hold" };
    const u = await db.transaction(async (tx) => { await lockRoot(tx, root.id); return lapse(tx, s, reason); });
    await trail(root, "paypal", "promise.unbacked", "FAILED", s.id, { status });
    return { status: "LAPSED", spend: u ?? s, reasons: [reason], receipt: null, duplicate: false, note: null };
  }
  const key = await gatewayKey();
  const chain = s.signed.chain;
  const leaf = chain[chain.length - 1]!.body;
  const body: Omit<PromiseNote, "sig"> = {
    v: PROMISE_NOTE_VERSION, promise: s.id,
    agent: leaf.holder, agentLabel: leaf.holderLabel, account: E.accountNumber(leaf.holder),
    sponsors: [{ role: "owner", label: root.principalName, key: root.principal }, ...chain.slice(0, -1).map((b) => ({ role: "agent" as const, label: b.body.holderLabel, key: b.body.holder }))],
    root: root.id, amount: s.amountMinor, currency: s.currency, payee: s.payee, purpose: s.purpose,
    expiresAt: s.promiseExpiresAt!.toISOString(),
    ...((s.signed.request as E.PromiseRequest).releaseBy ? { releaseBy: (s.signed.request as E.PromiseRequest).releaseBy } : {}),
    paypal: { mode: paypalMode(), authorizationId: root.authorizationId!, status },
    issuedAt: new Date().toISOString(), gateway: key.publicKey,
  };
  const note: PromiseNote = { ...body, sig: await E.signDetached(key.privateKey, PROMISE_NOTE_VERSION, body) };
  const [u] = await db.update(spends).set({ promiseNote: note }).where(eq(spends.id, s.id)).returning();
  return { ...res, spend: u ?? s, note };
}

export async function verifyPromiseNote(n: PromiseNote, now = new Date()): Promise<boolean> {
  if (!n || n.v !== PROMISE_NOTE_VERSION || Date.parse(n.expiresAt) < now.getTime()) return false;
  const { sig, ...body } = n;
  return E.verifyDetached(n.gateway, PROMISE_NOTE_VERSION, body, sig);
}

/** The agent that made a promise pays it (capture + payout from the money already set aside) or releases it. */
export async function keep(signed: E.SignedKeep, agentNote?: string): Promise<SpendResult> {
  if (!(await E.verifyKeepSignature(signed))) throw new UserFacingError("That isn't properly signed, or is too old.", 401);
  const s0 = await getDb().query.spends.findFirst({ where: eq(spends.id, signed.request.promise) });
  if (!s0 || !s0.promiseExpiresAt) throw new UserFacingError("No such promise.", 404);
  const leaf = s0.signed.chain[s0.signed.chain.length - 1]!.body;
  if (signed.by !== leaf.holder) throw new UserFacingError("Only the agent that made a promise can pay or release it.", 403);
  // Above the owner's threshold the agent may set money aside and release it, but only the owner's signature pays it.
  if (signed.request.action === "pay" && leaf.caps.approveOver !== undefined && s0.amountMinor > leaf.caps.approveOver) throw new UserFacingError("This payment is over the owner's approval threshold: only the owner's signature can pay it.", 403);
  return decidePromise(s0, signed.request.action, { agentNote });
}

/**
 * The key a promise named (`releaseBy`) signs that the work is delivered and accepted, and the money
 * set aside is paid without going back to the promise's maker. The maker agreed to this when it
 * signed the promise. The gateway checks one thing: that the signature is from the named key.
 * Revocation and expiry still apply; the fingerprint of the delivered work goes on the receipt.
 */
export async function accept(signed: E.SignedAccept): Promise<SpendResult> {
  if (!(await E.verifyAcceptSignature(signed))) throw new UserFacingError("That acceptance isn't properly signed, or is too old.", 401);
  const s0 = await getDb().query.spends.findFirst({ where: eq(spends.id, signed.request.promise) });
  if (!s0 || !s0.promiseExpiresAt) throw new UserFacingError("No such promise.", 404);
  const named = (s0.signed.request as E.PromiseRequest).releaseBy;
  if (!named) throw new UserFacingError("This promise can only be paid by the agent that made it.", 403);
  if (signed.by !== named) throw new UserFacingError("This promise names a different key as the one that can release it.", 403);
  if (signed.request.decline) return decidePromise(s0, "release", { why: "declined by the key it named" });
  return decidePromise(s0, "pay", { delivery: { by: signed.by, work: signed.request.work, note: signed.request.note, at: signed.request.at, sig: signed.sig, request: signed.request } });
}

async function decidePromise(s0: Spend, action: "pay" | "release", o: { agentNote?: string; delivery?: NonNullable<Spend["delivery"]>; why?: string }): Promise<SpendResult> {
  const db = getDb();
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s0.rootId) }))!;
  const out = await db.transaction(async (tx) => {
    await lockRoot(tx, root.id);
    const lapsed = await sweep(tx, root.id);
    const s = (await tx.query.spends.findFirst({ where: eq(spends.id, s0.id) }))!;
    if (s.status !== "PROMISED") return { row: s, changed: false, lapsed };
    if (action === "release") {
      const u = await lapse(tx, s, { code: "PROMISE_LAPSED", at: s.leafId, detail: o.why ?? "released by the agent that made it" });
      return { row: u ?? s, changed: true, lapsed: u ? [...lapsed, u] : lapsed };
    }
    // Authority may have been withdrawn since the promise was made.
    const live = (await tx.query.roots.findFirst({ where: eq(roots.id, root.id) }))!;
    const rows = await tx.select().from(blocks).where(inArray(blocks.id, s.chainIds));
    const dead = live.status !== "ACTIVE" ? "the root envelope was closed by its owner" : rows.find((x) => x.revokedAt) ? `${rows.find((x) => x.revokedAt)!.holderLabel}'s envelope was revoked` : null;
    if (dead) {
      const u = await lapse(tx, s, { code: "REVOKED", at: root.id, detail: dead });
      return { row: u ?? s, changed: true, lapsed: u ? [...lapsed, u] : lapsed };
    }
    const [u] = await tx.update(spends).set({ status: "RESERVED", agentNote: o.agentNote?.trim().slice(0, 500) || s.agentNote, ...(o.delivery ? { delivery: o.delivery } : {}) }).where(and(eq(spends.id, s.id), eq(spends.status, "PROMISED"))).returning();
    return { row: u ?? s, changed: Boolean(u), lapsed };
  });
  await trailLapsed(root, out.lapsed);
  if (out.changed && out.row.status === "RESERVED") await trail(root, "agent", o.delivery ? "promise.released_on_acceptance" : "promise.kept", "PENDING", out.row.id, { agent: out.row.leafLabel, amount: out.row.amountMinor, payee: out.row.payee, ...(o.delivery ? { acceptedBy: E.fingerprint(o.delivery.by), work: o.delivery.work || null } : {}) });
  // RESERVED (just now, or an earlier attempt that was interrupted) continues to PayPal.
  const done = out.row.status === "RESERVED" || out.row.status === "CAPTURED" ? await settle(out.row.id) : out.row;
  return { status: done.status, spend: done, reasons: done.reasons, receipt: done.receipt, duplicate: !out.changed };
}

// ---------------------------------------------------------------------------
// Accounts that receive
// ---------------------------------------------------------------------------

/**
 * Open (or update) an agent's account for receiving. The opening must be signed by the agent's own
 * key, so an account number can never be pointed at someone else's PayPal address, and by the owner
 * who answers for the agent. Payments to "acct:<number>" are then settled to `settleTo` by PayPal Payouts.
 */
export async function openAccount(signed: E.SignedAccount): Promise<Account> {
  if (!(await E.verifyAccount(signed))) throw new UserFacingError("An account opening must be signed by both the agent's key and its owner's key.", 422);
  const db = getDb();
  const b = signed.body;
  const account = E.accountNumber(b.agent);
  const clash = await db.query.accounts.findFirst({ where: eq(accounts.account, account) });
  if (clash && clash.agent !== b.agent) throw new UserFacingError("Another agent already holds that account number.", 409);
  // The owner answers for the account, caps it and can freeze it: an agent must not be able to swap in an owner key of its own.
  if (clash && clash.owner !== b.owner) throw new UserFacingError("This account already has an owner. Only that owner can co-sign a change to it.", 409);
  if (clash && Date.parse(clash.signed.body.at) >= Date.parse(b.at)) return clash;
  const values = { account, label: b.label, owner: b.owner, ownerName: b.ownerName || "Owner", settleTo: b.settleTo, signed, mode: b.mode === "hold" ? "hold" as const : "settle" as const, perPaymentMinor: b.perPayment ?? null, perDayMinor: b.perDay ?? null };
  const [row] = await db.transaction(async (tx) => {
    await lockAccount(tx, b.agent);
    const now = await tx.query.accounts.findFirst({ where: eq(accounts.agent, b.agent) });
    if (now && now.owner !== b.owner) throw new UserFacingError("This account already has an owner. Only that owner can co-sign a change to it.", 409);
    if (now && Date.parse(now.signed.body.at) >= Date.parse(b.at)) return [now];
    return tx.insert(accounts).values({ agent: b.agent, ...values }).onConflictDoUpdate({ target: accounts.agent, set: values }).returning();
  });
  await audit(db, { scopeId: b.owner, subjectId: `acct:${account}`, actor: "principal", action: clash ? "account.updated" : "account.opened", ref: account, outcome: "OK", detail: { agent: b.label, owner: b.ownerName } });
  return row!;
}

/** Find an agent's key from its account number ("7K2Q-9M4X-T0PA", with or without "acct:"). */
export async function accountByNumber(number: string): Promise<Account | null> {
  const n = number.replace(/^acct:/i, "").toUpperCase();
  return (await getDb().query.accounts.findFirst({ where: eq(accounts.account, n) })) ?? null;
}

/** Enough of an address to recognise, not enough to copy. */
export const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent identity: standing ("is this agent good for the money?") and profile
// ---------------------------------------------------------------------------

export const STANDING_VERSION = "envelope-standing/1" as const;
/** How long a statement of standing may be relied on. Budgets move, so it is short. */
export const STANDING_TTL_MS = 5 * 60_000;

export type Standing = {
  v: typeof STANDING_VERSION;
  agent: string;
  agentLabel: string;
  account: string;
  /** Who stands behind the agent: the owner first, then every agent above it. */
  sponsors: Array<{ role: "owner" | "agent"; label: string; key: string }>;
  root: string;
  ask: { amount: number; currency: string; payee: string; purpose: string };
  /** True only if this exact payment would be accepted right now. */
  good: boolean;
  reasons: Array<{ code: E.Reason; detail: string }>;
  /** The most the agent could pay this payee for this purpose in one payment right now. */
  availableMinor: number;
  paypal: { mode: string; authorizationId: string | null; status: string | null; unusedMinor: number | null };
  issuedAt: string;
  validUntil: string;
  gateway: string;
  sig: string;
};

/**
 * Answer a counterparty's question before it does any work: does the agent in front of me control
 * the key it claims, who stands behind it, and would a payment of this size to me go through?
 * Read-only: nothing is reserved, so the answer can go stale; it expires after five minutes.
 */
export async function standing(hello: E.SignedHello): Promise<Standing> {
  const db = getDb();
  const verdict = await E.verifyHello(hello);
  const chain = Array.isArray(hello?.chain) ? hello.chain : [];
  const leaf = chain[chain.length - 1]?.body;
  const r = hello?.request;
  const rootId = chain[0]?.body?.id;
  if (!leaf || !r || typeof rootId !== "string") throw new UserFacingError("That introduction is malformed.", 400);
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) throw new UserFacingError("That agent's envelope was never sealed with this gateway.", 404);

  await sweepExpired(root.id);
  const reasons: E.Violation[] = [...verdict.violations];
  if (root.status !== "ACTIVE") reasons.push({ code: "REVOKED", at: root.id, detail: "the root envelope was closed by its owner" });
  if (typeof r.payee === "string" && E.isAccountPayee(r.payee) && !(await accountByNumber(r.payee))) reasons.push({ code: "PAYEE_ACCOUNT_UNKNOWN", at: null, detail: `no agent has opened account ${r.payee.slice(5).toUpperCase()}` });
  let available = 0;
  if (verdict.ok && verdict.chain.caps) {
    const rows = await db.select().from(blocks).where(inArray(blocks.id, verdict.chain.ids));
    const byId = new Map(rows.map((x) => [x.id, x]));
    available = verdict.chain.caps.perPayment;
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i]!;
      const row = byId.get(b.body.id); // a split the gateway has not seen yet has spent nothing
      if (row && row.hash !== (await E.blockHash(b))) reasons.push({ code: "FORKED_BLOCK", at: b.body.id, detail: "a different block with this id is already on record" });
      if (row?.revokedAt) reasons.push({ code: "REVOKED", at: row.id, detail: `${row.holderLabel}'s envelope was revoked` });
      const left = b.body.caps.limit - (row ? row.spentMinor + row.reservedMinor : 0);
      available = Math.min(available, left);
      if (r.amount > left) {
        reasons.push(i === chain.length - 1
          ? { code: "OVER_ENVELOPE_LIMIT", at: b.body.id, detail: `${b.body.holderLabel} has ${E.money(left, b.body.caps.currency)} left of ${E.money(b.body.caps.limit, b.body.caps.currency)}` }
          : { code: "OVER_ANCESTOR_LIMIT", at: b.body.id, detail: `${b.body.holderLabel}'s envelope, above this one, has ${E.money(left, b.body.caps.currency)} left of ${E.money(b.body.caps.limit, b.body.caps.currency)}` });
      }
    }
  }

  // Ask PayPal itself whether the hold is still there.
  const paypal: Standing["paypal"] = { mode: paypalMode(), authorizationId: root.authorizationId, status: null, unusedMinor: null };
  if (root.authorizationId && root.status === "ACTIVE") {
    try {
      const auth = await getAuthorization(getPayPal(), root.authorizationId);
      paypal.status = auth.status;
      paypal.unusedMinor = Math.max(0, auth.amountMinor - root.capturedMinor);
      if (auth.status !== "CREATED" && auth.status !== "PARTIALLY_CAPTURED") reasons.push({ code: "ROOT_NOT_FUNDED", at: root.id, detail: `PayPal reports the hold as ${auth.status}` });
      else available = Math.min(available, paypal.unusedMinor);
    } catch (e) {
      reasons.push({ code: "ROOT_NOT_FUNDED", at: root.id, detail: `PayPal could not confirm the hold (${e instanceof PayPalApiError ? e.status : "unreachable"})` });
    }
  } else if (root.status === "ACTIVE") reasons.push({ code: "ROOT_NOT_FUNDED", at: root.id, detail: "no PayPal authorization backs this envelope" });

  const good = reasons.length === 0;
  const key = await gatewayKey();
  const now = new Date();
  const body: Omit<Standing, "sig"> = {
    v: STANDING_VERSION,
    agent: String(leaf.holder), agentLabel: String(leaf.holderLabel ?? "").slice(0, 80), account: E.accountNumber(String(leaf.holder)),
    sponsors: [{ role: "owner", label: root.principalName, key: root.principal }, ...chain.slice(0, -1).map((b) => ({ role: "agent" as const, label: String(b.body.holderLabel).slice(0, 80), key: String(b.body.holder) }))],
    root: root.id,
    ask: { amount: Number.isSafeInteger(r.amount) ? r.amount : 0, currency: String(r.currency ?? ""), payee: String(r.payee ?? "").slice(0, 127), purpose: String(r.purpose ?? "").slice(0, 60) },
    good, reasons: reasons.map((x) => ({ code: x.code, detail: x.detail })),
    availableMinor: good ? Math.max(0, available) : 0,
    paypal,
    issuedAt: now.toISOString(), validUntil: new Date(now.getTime() + STANDING_TTL_MS).toISOString(), gateway: key.publicKey,
  };
  const out: Standing = { ...body, sig: await E.signDetached(key.privateKey, STANDING_VERSION, body) };
  await trail(root, "gateway", "standing.issued", good ? "OK" : "REJECTED", body.account, { agent: body.agentLabel, payee: body.ask.payee, amount: body.ask.amount, good, reasons: body.reasons.map((x) => x.code) });
  return out;
}

export async function verifyStanding(s: Standing, now = new Date()): Promise<boolean> {
  if (!s || s.v !== STANDING_VERSION || Date.parse(s.validUntil) < now.getTime()) return false;
  const { sig, ...body } = s;
  return E.verifyDetached(s.gateway, STANDING_VERSION, body, sig);
}

export type AgentAccount = {
  blockId: string; rootId: string; rootTitle: string; depth: number; label: string;
  openedBy: { role: "owner" | "agent"; label: string; key: string };
  /** Owner first, then every holder down to the one above this agent. */
  sponsors: Array<{ role: "owner" | "agent"; label: string; key: string }>;
  caps: E.Caps; spentMinor: number; reservedMinor: number; availableMinor: number;
  state: "LIVE" | "REVOKED" | "CLOSED" | "EXPIRED";
  issued: Array<{ blockId: string; label: string; key: string; limitMinor: number; revoked: boolean }>;
  openedAt: string;
};

/** Everything the gateway knows about one agent key, across every envelope it holds. */
export async function agentProfile(key: string) {
  const db = getDb();
  const [held0, acct] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.holder, key)).orderBy(desc(blocks.firstSeenAt)).limit(40),
    db.query.accounts.findFirst({ where: eq(accounts.agent, key) }),
  ]);
  if (held0.length === 0 && !acct) return null;
  for (const id of new Set(held0.map((b) => b.rootId))) await sweepExpired(id);
  const held = held0.length ? await db.select().from(blocks).where(eq(blocks.holder, key)).orderBy(desc(blocks.firstSeenAt)).limit(40) : held0;
  const rootIds = [...new Set(held.map((b) => b.rootId))];
  const none = Promise.resolve([] as never[]);
  const [rootRows, all, mine, incoming] = await Promise.all([
    rootIds.length ? db.select().from(roots).where(inArray(roots.id, rootIds)) : none,
    rootIds.length ? db.select().from(blocks).where(inArray(blocks.rootId, rootIds)) : none,
    held.length ? db.select().from(spends).where(inArray(spends.leafId, held.map((b) => b.id))).orderBy(desc(spends.createdAt)).limit(300) : none,
    db.select().from(spends).where(eq(spends.payeeAgent, key)).orderBy(desc(spends.createdAt)).limit(300),
  ]);
  const rootById = new Map(rootRows.map((x) => [x.id, x]));
  const blockById = new Map(all.map((x) => [x.id, x]));
  const now = Date.now();
  const holdings: AgentAccount[] = held.map((b) => {
    const root = rootById.get(b.rootId)!;
    const up: BlockRow[] = [];
    for (let p = b.parentId ? blockById.get(b.parentId) : undefined; p; p = p.parentId ? blockById.get(p.parentId) : undefined) up.unshift(p);
    const line = [...up, b];
    const owner = { role: "owner" as const, label: root.principalName, key: root.principal };
    const sponsors = [owner, ...up.map((x) => ({ role: "agent" as const, label: x.holderLabel, key: x.holder }))];
    const state: AgentAccount["state"] = root.status !== "ACTIVE" ? "CLOSED" : line.some((x) => x.revokedAt) ? "REVOKED" : Date.parse(b.caps.notAfter) < now ? "EXPIRED" : "LIVE";
    const left = Math.min(...line.map((x) => x.caps.limit - x.spentMinor - x.reservedMinor));
    return {
      blockId: b.id, rootId: b.rootId, rootTitle: root.title, depth: b.depth, label: b.holderLabel,
      openedBy: sponsors[sponsors.length - 1]!, sponsors,
      caps: b.caps, spentMinor: b.spentMinor, reservedMinor: b.reservedMinor, availableMinor: state === "LIVE" ? Math.max(0, left) : 0, state,
      issued: all.filter((x) => x.parentId === b.id).map((x) => ({ blockId: x.id, label: x.holderLabel, key: x.holder, limitMinor: x.caps.limit, revoked: Boolean(x.revokedAt) })),
      openedAt: b.firstSeenAt.toISOString(),
    };
  });
  const isSettled = (x: Spend) => x.status === "PAID" || x.status === "UNCLAIMED" || x.status === "PAYOUT_PENDING";
  const settled = mine.filter(isSettled);
  const denied = mine.filter((x) => x.status === "DENIED");
  const received = incoming.filter(isSettled);
  const strip = ({ signed: _s, receipt: _r, promiseNote: _n, payoutTo: _p, ...x }: Spend) => ({ ...x, hasReceipt: Boolean(_r) });
  const firstSeen = [held[held.length - 1]?.firstSeenAt, acct?.openedAt].filter((x): x is Date => Boolean(x)).sort((a, b) => a.getTime() - b.getTime())[0]!;
  return {
    key, account: E.accountNumber(key), label: held[0]?.holderLabel ?? acct!.label,
    firstSeenAt: firstSeen.toISOString(),
    accounts: holdings,
    /** Set when the agent has opened an account that can receive. */
    receives: acct ? { payee: E.accountPayee(key), owner: { label: acct.ownerName, key: acct.owner }, settlesTo: maskEmail(acct.settleTo), openedAt: acct.openedAt.toISOString(), holds: acct.mode === "hold" } : null,
    /** Set when the account keeps a balance (or still has one). */
    balance: acct && (acct.mode === "hold" || acct.balanceMinor > 0) ? {
      minor: acct.balanceMinor, frozen: Boolean(acct.frozenAt), perPaymentMinor: acct.perPaymentMinor, perDayMinor: acct.perDayMinor,
      ledger: (await db.select().from(ledger).where(eq(ledger.agent, key)).orderBy(desc(ledger.id)).limit(30)).map((l) => ({ id: l.id, kind: l.kind, ref: l.ref, deltaMinor: l.deltaMinor, balanceAfterMinor: l.balanceAfterMinor, counterparty: l.counterparty && l.counterparty.includes("@") ? maskEmail(l.counterparty) : l.counterparty, memo: l.memo, at: l.createdAt.toISOString() })),
    } : null,
    record: {
      payments: settled.length, paidMinor: settled.reduce((n, x) => n + x.amountMinor, 0),
      refused: denied.length, refusedCodes: [...new Set(denied.flatMap((x) => x.reasons.map((y) => y.code)))],
      revoked: holdings.filter((a) => a.state === "REVOKED").length,
      availableMinor: holdings.reduce((n, a) => n + a.availableMinor, 0),
      promisesKept: settled.filter((x) => x.promiseExpiresAt).length,
      promisesLapsed: mine.filter((x) => x.promiseExpiresAt && x.status === "LAPSED").length,
      received: received.length, receivedMinor: received.reduce((n, x) => n + x.amountMinor, 0),
      setAsideForItMinor: incoming.filter((x) => x.status === "PROMISED").reduce((n, x) => n + x.amountMinor, 0),
    },
    statement: mine.slice(0, 60).map(strip),
    incoming: incoming.filter((x) => x.status !== "DENIED").slice(0, 60).map(strip),
  };
}

export const REFERENCE_VERSION = "envelope-reference/1" as const;
/** An agent's record as this gateway has seen it, signed so the agent can show it to anyone. Facts only: no score. */
export type Reference = {
  v: typeof REFERENCE_VERSION;
  agent: string; label: string; account: string;
  knownSince: string; asOf: string;
  /** The owner who answers for the agent's account, when it has opened one. */
  answersForIt: string | null;
  facts: {
    paymentsSettled: number; paidMinor: number;
    promisesKept: number; promisesLapsed: number;
    requestsRefused: number; refusedFor: string[];
    envelopesHeld: number; envelopesRevoked: number;
    timesPaid: number; earnedMinor: number;
  };
  paypalMode: string; gateway: string; sig: string;
};

export async function reference(key: string): Promise<Reference | null> {
  const p = await agentProfile(key);
  if (!p) return null;
  const gw = await gatewayKey();
  const body: Omit<Reference, "sig"> = {
    v: REFERENCE_VERSION, agent: key, label: p.label, account: p.account, knownSince: p.firstSeenAt, asOf: new Date().toISOString(),
    answersForIt: p.receives?.owner.label ?? null,
    facts: {
      paymentsSettled: p.record.payments, paidMinor: p.record.paidMinor,
      promisesKept: p.record.promisesKept, promisesLapsed: p.record.promisesLapsed,
      requestsRefused: p.record.refused, refusedFor: p.record.refusedCodes,
      envelopesHeld: p.accounts.length, envelopesRevoked: p.record.revoked,
      timesPaid: p.record.received, earnedMinor: p.record.receivedMinor,
    },
    paypalMode: paypalMode(), gateway: gw.publicKey,
  };
  return { ...body, sig: await E.signDetached(gw.privateKey, REFERENCE_VERSION, body) };
}
export async function verifyReference(r: Reference): Promise<boolean> {
  if (!r || r.v !== REFERENCE_VERSION) return false;
  const { sig, ...body } = r;
  return E.verifyDetached(r.gateway, REFERENCE_VERSION, body, sig);
}

// ---------------------------------------------------------------------------
// Treasury: one owner's view across every envelope they sealed
// ---------------------------------------------------------------------------

const SETTLED = ["PAID", "UNCLAIMED", "PAYOUT_PENDING"];

/** Everything one owner's key has sealed: what PayPal is holding, what agents spent, what is set aside, and who did what. */
export async function treasury(principal: string) {
  const db = getDb();
  const rootRows = await db.select().from(roots).where(eq(roots.principal, principal)).orderBy(desc(roots.createdAt)).limit(50);
  if (rootRows.length === 0) return null;
  const ids = rootRows.map((r) => r.id);
  for (const id of ids) await sweepExpired(id);
  const [bs, ss] = await Promise.all([
    db.select().from(blocks).where(inArray(blocks.rootId, ids)).orderBy(asc(blocks.depth), asc(blocks.firstSeenAt)),
    db.select().from(spends).where(inArray(spends.rootId, ids)).orderBy(desc(spends.createdAt)).limit(1000),
  ]);
  const rootById = new Map(rootRows.map((r) => [r.id, r]));
  const blockById = new Map(bs.map((b) => [b.id, b]));
  const now = Date.now();
  const open = rootRows.filter((r) => r.status === "ACTIVE");
  const numbers = [...new Set(ss.map((x) => x.payee).filter(E.isAccountPayee).map((x) => x.slice(5).toUpperCase()))];
  const named = numbers.length ? await db.select().from(accounts).where(inArray(accounts.account, numbers)) : [];
  const nameOf = new Map(named.map((a) => [`acct:${a.account.toLowerCase()}`, { label: a.label, key: a.agent, owner: a.ownerName }]));

  const agents = bs.map((b) => {
    const root = rootById.get(b.rootId)!;
    const line: BlockRow[] = [];
    for (let x: BlockRow | undefined = b; x; x = x.parentId ? blockById.get(x.parentId) : undefined) line.unshift(x);
    const state = root.status !== "ACTIVE" ? "CLOSED" : line.some((x) => x.revokedAt) ? "REVOKED" : Date.parse(b.caps.notAfter) < now ? "EXPIRED" : "LIVE";
    const mine = ss.filter((x) => x.leafId === b.id);
    return {
      blockId: b.id, rootId: b.rootId, rootTitle: root.title, depth: b.depth, key: b.holder, label: b.holderLabel, account: E.accountNumber(b.holder),
      under: line.slice(0, -1).map((x) => x.holderLabel),
      limitMinor: b.caps.limit, spentMinor: b.spentMinor, setAsideMinor: b.reservedMinor,
      leftMinor: state === "LIVE" ? Math.max(0, Math.min(...line.map((x) => x.caps.limit - x.spentMinor - x.reservedMinor))) : 0,
      refused: mine.filter((x) => x.status === "DENIED").length, state,
    };
  });
  const paid = ss.filter((x) => SETTLED.includes(x.status));
  const byPayee = new Map<string, { payee: string; who: string | null; key: string | null; owner: string | null; totalMinor: number; payments: number }>();
  for (const x of paid) {
    const e = byPayee.get(x.payee) ?? { payee: x.payee, who: nameOf.get(x.payee)?.label ?? null, key: nameOf.get(x.payee)?.key ?? null, owner: nameOf.get(x.payee)?.owner ?? null, totalMinor: 0, payments: 0 };
    e.totalMinor += x.amountMinor; e.payments += 1;
    byPayee.set(x.payee, e);
  }
  return {
    principal, mode: paypalMode(), ownerName: rootRows[0]!.principalName,
    totals: {
      envelopes: rootRows.length, open: open.length,
      heldNowMinor: open.reduce((n, r) => n + r.limitMinor - r.capturedMinor, 0),
      spentMinor: rootRows.reduce((n, r) => n + r.capturedMinor, 0),
      setAsideMinor: ss.filter((x) => x.status === "PROMISED").reduce((n, x) => n + x.amountMinor, 0),
      releasedMinor: rootRows.reduce((n, r) => n + (r.releasedMinor ?? 0), 0),
      payments: paid.length, refused: ss.filter((x) => x.status === "DENIED").length,
      agents: new Set(bs.map((b) => b.holder)).size,
    },
    envelopes: rootRows.map((r) => ({ id: r.id, title: r.title, status: r.status, limitMinor: r.limitMinor, capturedMinor: r.capturedMinor, releasedMinor: r.releasedMinor, authorizationId: r.authorizationId, createdAt: r.createdAt.toISOString() })),
    agents,
    /** Money set aside that names this owner as the key that releases it: waiting for the owner's signature. */
    approvals: ss.filter((x) => x.status === "PROMISED" && (x.signed.request as E.PromiseRequest).releaseBy === principal).map((x) => ({ id: x.id, rootId: x.rootId, rootTitle: rootById.get(x.rootId)!.title, agent: x.leafLabel, payee: x.payee, who: nameOf.get(x.payee)?.label ?? null, purpose: x.purpose, memo: x.memo, agentNote: x.agentNote, amountMinor: x.amountMinor, expiresAt: x.promiseExpiresAt!.toISOString() })),
    payees: [...byPayee.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    activity: ss.slice(0, 40).map((x) => ({ id: x.id, rootId: x.rootId, at: x.createdAt.toISOString(), agent: x.leafLabel, payee: x.payee, who: nameOf.get(x.payee)?.label ?? null, purpose: x.purpose, amountMinor: x.amountMinor, status: x.status, reasons: x.reasons.map((y) => y.code), captureId: x.captureId, payoutBatchId: x.payoutBatchId, payoutStatus: x.payoutStatus, hasReceipt: Boolean(x.receipt) })),
  };
}

/** Check every recent payment of one owner against PayPal's own records. */
export async function reconcileTreasury(principal: string) {
  const db = getDb();
  const rootRows = await db.select({ id: roots.id }).from(roots).where(eq(roots.principal, principal)).orderBy(desc(roots.createdAt)).limit(50);
  if (rootRows.length === 0) return null;
  const ss = await db.select().from(spends).where(and(inArray(spends.rootId, rootRows.map((r) => r.id)), inArray(spends.status, SETTLED as Spend["status"][]))).orderBy(desc(spends.createdAt)).limit(20);
  const results = [];
  for (const s of ss) {
    try { const r = await reconcile(s.id); results.push({ id: s.id, amountMinor: s.amountMinor, ok: r.ok, failed: r.checks.filter((c) => !c.ok).map((c) => c.name) }); }
    catch { results.push({ id: s.id, amountMinor: s.amountMinor, ok: false, failed: ["could not be checked"] }); }
  }
  return { checked: results.length, matched: results.filter((r) => r.ok).length, matchedMinor: results.filter((r) => r.ok).reduce((n, r) => n + r.amountMinor, 0), results, mode: paypalMode(), at: new Date().toISOString() };
}

/** Agents the gateway has seen most recently. */
export async function recentAgents(limit = 24) {
  const db = getDb();
  const [rows, accts] = await Promise.all([
    db.select({ key: blocks.holder, label: sql<string>`max(${blocks.holderLabel})`, envelopes: sql<number>`count(*)::int`, lastSeen: sql<Date>`max(${blocks.firstSeenAt})` })
      .from(blocks).groupBy(blocks.holder).orderBy(desc(sql`max(${blocks.firstSeenAt})`)).limit(limit),
    db.select().from(accounts).orderBy(desc(accounts.openedAt)).limit(limit),
  ]);
  const receiving = new Set(accts.map((a) => a.agent));
  const seen = new Set(rows.map((x) => x.key));
  return [
    ...accts.filter((a) => !seen.has(a.agent)).map((a) => ({ key: a.agent, label: a.label, envelopes: 0, lastSeen: a.openedAt, account: a.account, receives: true })),
    ...rows.map((x) => ({ ...x, account: E.accountNumber(x.key), receives: receiving.has(x.key) })),
  ].slice(0, limit);
}

export async function tree(rootId: string) {
  const db = getDb();
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) return null;
  await sweepExpired(rootId);
  const [bs, ss] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.rootId, rootId)).orderBy(asc(blocks.depth), asc(blocks.firstSeenAt)),
    db.select().from(spends).where(eq(spends.rootId, rootId)).orderBy(desc(spends.createdAt)).limit(200),
  ]);
  // Names for payees written as account numbers, so people see "translator-agent", not only a number.
  const numbers = [...new Set([...bs.flatMap((b) => b.caps.payees ?? []), ...ss.map((x) => x.payee)].filter(E.isAccountPayee).map((p) => p.slice(5).toUpperCase()))];
  const named = numbers.length ? await db.select().from(accounts).where(inArray(accounts.account, numbers)) : [];
  const payees = Object.fromEntries(named.map((a) => [`acct:${a.account.toLowerCase()}`, { label: a.label, key: a.agent, owner: a.ownerName }]));
  return { root, blocks: bs, spends: ss, payees };
}

/** Independent check of a receipt: its signature, and what PayPal itself says about the capture and the payout. */
export async function reconcile(spendId: string) {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s?.receipt) throw new UserFacingError("No receipt for that spend.", 404);
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  const pp = getPayPal();
  const held = isHeld(s);
  const entry = held ? await db.query.ledger.findFirst({ where: and(eq(ledger.agent, s.payeeAgent!), eq(ledger.kind, "income"), eq(ledger.ref, s.id)) }) : null;
  const [signatureOk, chainVerdict, cap, po, auth] = await Promise.all([
    verifyReceipt(s.receipt),
    E.verifyChain(s.signed.chain, new Date(s.signed.request.at)),
    getCapture(pp, s.captureId!).catch(() => null),
    held ? null : getPayout(pp, s.payoutBatchId!).catch(() => null),
    getAuthorization(pp, root.authorizationId!).catch(() => null),
  ]);
  const checks = [
    { name: "Receipt is signed by the gateway", ok: signatureOk },
    { name: "Authority chain verifies back to the principal's key", ok: chainVerdict.ok && chainVerdict.principal === root.principal },
    { name: "PayPal capture exists for exactly this amount", ok: Boolean(cap && cap.amountMinor === s.amountMinor && cap.currency === s.currency && ["COMPLETED", "PENDING", "PARTIALLY_REFUNDED"].includes(cap.status)), detail: cap ? `${cap.id} · ${cap.status} · ${formatMoney(cap.amountMinor, cap.currency)}` : "not found" },
    { name: "PayPal capture carries this spend's id", ok: Boolean(cap && (cap.invoiceId === s.id || cap.invoiceId === null)), detail: cap?.invoiceId ?? "invoice_id not returned" },
    held
      ? { name: "Credited once to the account the agent signed for", ok: Boolean(entry && entry.deltaMinor === s.amountMinor && s.receipt.paidTo?.held?.ledgerEntry === entry.id), detail: entry ? `ledger entry ${entry.id} · ${formatMoney(entry.deltaMinor, s.currency)} · no payout: the money stays in the agent's balance` : "not found" }
      : { name: "PayPal payout went to the payee the agent signed for", ok: Boolean(po && po.receiver?.toLowerCase() === (s.payoutTo ?? s.payee)), detail: po ? `${po.batchId} · ${po.itemStatus ?? po.batchStatus} · ${po.receiver}` : "not found" },
    { name: "The hold belongs to this envelope", ok: Boolean(auth && (auth.customId === root.id || auth.customId === null)), detail: auth ? `${auth.id} · ${auth.status}` : "not found" },
  ];
  return { spend: s, receipt: s.receipt, checks, ok: checks.every((c) => c.ok) };
}
