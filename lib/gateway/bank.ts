/**
 * Balances: the part of an agent's account that holds money.
 *
 * An account opened in "hold" mode keeps what the agent earns. Each payment to it is still a partial
 * capture of the payer's PayPal hold; the amount is then credited to a ledger here and not paid out.
 * The agent moves that money by signing a transfer with its own key:
 *
 *   to another account here   a book transfer: one debit, one credit, under one lock, no PayPal call;
 *   to a PayPal address       a debit, then a PayPal payout from the gateway's balance;
 *   back to its owner         the same, to the settlement address its owner signed for.
 *
 * Every change to a balance is one ledger row, unique per (account, kind, reference), so nothing is
 * credited or debited twice. The owner can cap a single payment and freeze the account.
 *
 * Holding balances for others is stored value. This runs against the PayPal sandbox only; a real
 * deployment needs a licensed partner to hold the funds. No model output is read in this file.
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, cards, ledger, spends, transfers, type Account, type Card, type Spend, type Transfer, type TransferReceipt } from "../db/schema";
import { UserFacingError } from "../errors";
import * as E from "../envelope/core";
import { newId } from "../ids";
import { getPayPal, PayPalApiError, paypalMode } from "../paypal/client";
import { getPayout, payout, refundCapture } from "../paypal/payments";
import { audit } from "../services/audit";
import { gatewayKey, HELD, lockAccount, markRefundedByPayee } from "./service";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
/** What left an account in the last 24 hours through payments and card charges (withdrawals to the owner don't count; refused payouts are netted off). */
async function spentToday(tx: Tx, agent: string): Promise<number> {
  const rows = await tx.select({ kind: ledger.kind, ref: ledger.ref, delta: ledger.deltaMinor }).from(ledger)
    .where(and(eq(ledger.agent, agent), inArray(ledger.kind, ["transfer_out", "payout", "reversal"]), gt(ledger.createdAt, new Date(Date.now() - 86_400_000))));
  // A reversal gives back only the payment it reverses. A refused withdrawal (which never counted) must not make room for more spending.
  const out = new Map<string, number>();
  for (const r of rows) if (r.kind !== "reversal") out.set(r.ref, (out.get(r.ref) ?? 0) - r.delta);
  for (const r of rows) if (r.kind === "reversal" && out.has(r.ref)) out.set(r.ref, Math.max(0, out.get(r.ref)! - r.delta));
  return [...out.values()].reduce((n, x) => n + x, 0);
}
/** The checks every movement out of a balance shares: the owner's freeze, cap per payment, cap per day, and the balance itself. */
async function ownerRules(tx: Tx, live: Account, amount: number, capped: boolean): Promise<E.Violation[]> {
  const why: E.Violation[] = [];
  if (live.frozenAt) why.push({ code: "ACCOUNT_FROZEN", at: null, detail: `${live.label}'s account was frozen by ${live.ownerName}` });
  if (capped && live.perPaymentMinor !== null && amount > live.perPaymentMinor) why.push({ code: "OVER_ACCOUNT_LIMIT", at: null, detail: `${E.money(amount)} is over the ${E.money(live.perPaymentMinor)} ${live.ownerName} lets this account pay at once` });
  if (capped && live.perDayMinor !== null) {
    const spent = await spentToday(tx, live.agent);
    if (spent + amount > live.perDayMinor) why.push({ code: "OVER_DAILY_LIMIT", at: null, detail: `${E.money(spent)} has left in the last 24 hours; ${live.ownerName} allows ${E.money(live.perDayMinor)} a day` });
  }
  if (amount > live.balanceMinor) why.push({ code: "INSUFFICIENT_BALANCE", at: null, detail: `the balance is ${E.money(live.balanceMinor)}` });
  return why;
}

export const TRANSFER_RECEIPT_VERSION = "envelope-transfer-receipt/1" as const;
export type TransferResult = { status: Transfer["status"]; transfer: Transfer | null; reasons: E.Violation[]; receipt: TransferReceipt | null; duplicate: boolean; balanceMinor: number | null };

const note = (a: Account, action: string, outcome: "OK" | "REJECTED" | "FAILED" | "PENDING" | "INFO", ref: string, detail: Record<string, unknown>) =>
  audit(getDb(), { scopeId: a.owner, subjectId: `acct:${a.account}`, actor: "agent", action, ref, outcome, detail });

export async function verifyTransferReceipt(r: TransferReceipt): Promise<boolean> {
  if (!r || r.v !== TRANSFER_RECEIPT_VERSION) return false;
  const { sig, ...body } = r;
  return E.verifyDetached(r.gateway, TRANSFER_RECEIPT_VERSION, body, sig);
}

/** An agent moves money out of its own balance. Only that agent's key can ask; the gateway checks the balance, the owner's cap and the freeze. */
export async function transfer(signed: E.SignedTransfer): Promise<TransferResult> {
  const db = getDb();
  const stateless = await E.verifyTransfer(signed);
  const r = signed?.request;
  const denied = (reasons: E.Violation[]): TransferResult => ({ status: "DENIED", transfer: null, reasons, receipt: null, duplicate: false, balanceMinor: null });
  if (!r || typeof r.from !== "string") return denied(stateless);
  const from = await db.query.accounts.findFirst({ where: eq(accounts.agent, r.from) });
  if (!from) return denied([...stateless, { code: "NO_BALANCE_ACCOUNT", at: null, detail: "that key has not opened an account here" }]);
  // Only the account's own key can leave a trace on it, even a refusal.
  if (stateless.some((v) => v.code === "NOT_THE_HOLDER" || v.code === "MALFORMED")) return denied(stateless);

  // Where is it going?
  let to: Account | null = null, payoutTo: string | null = null;
  const reasons: E.Violation[] = [...stateless];
  if (stateless.length === 0) {
    if (r.kind === "withdraw") payoutTo = from.settleTo;
    else if (E.isAccountPayee(r.payee)) {
      to = (await db.query.accounts.findFirst({ where: eq(accounts.account, r.payee.slice(5).toUpperCase()) })) ?? null;
      if (!to) reasons.push({ code: "PAYEE_ACCOUNT_UNKNOWN", at: null, detail: `no agent has opened account ${r.payee.slice(5).toUpperCase()}` });
      else if (to.agent === from.agent) reasons.push({ code: "MALFORMED", at: null, detail: "an account cannot pay itself" });
      else if (to.mode !== "hold") { payoutTo = to.settleTo; }
    } else payoutTo = r.payee;
  }
  const book = Boolean(to && to.mode === "hold");
  // The same request is the same request however its signature is written (see service.ts).
  const authentic = !stateless.some((v) => v.code === "NOT_THE_HOLDER" || v.code === "MALFORMED");
  const requestHash = await E.sha256(E.canonical(authentic ? { request: r } : { request: r, sig: signed.sig }));
  const base = { fromAgent: from.agent, kind: r.kind, payee: String(r.payee).slice(0, 127), toAgent: to?.agent ?? null, payoutTo: book ? null : payoutTo, amountMinor: Number.isSafeInteger(r.amount) ? r.amount : 0, currency: String(r.currency), purpose: String(r.purpose).slice(0, 60), memo: String(r.memo).slice(0, 200), requestHash, signed };

  const out = await db.transaction(async (tx): Promise<{ row: Transfer; fresh: boolean; balance: number }> => {
    // Two accounts are always locked in the same order, so two transfers crossing each other cannot deadlock.
    for (const k of [from.agent, ...(book ? [to!.agent] : [])].sort()) await lockAccount(tx, k);
    const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, from.agent) }))!;
    const seen = await tx.query.transfers.findFirst({ where: eq(transfers.requestHash, requestHash) });
    if (seen) return { row: seen, fresh: false, balance: live.balanceMinor };
    const why = [...reasons];
    if (why.length === 0) why.push(...(await ownerRules(tx, live, r.amount, r.kind === "pay")));
    const id = newId("tr");
    if (why.length) {
      const [row] = await tx.insert(transfers).values({ id, ...base, status: "DENIED", reasons: why }).returning();
      return { row: row!, fresh: true, balance: live.balanceMinor };
    }
    const after = live.balanceMinor - r.amount;
    await tx.update(accounts).set({ balanceMinor: after }).where(eq(accounts.agent, live.agent));
    await tx.insert(ledger).values({ agent: live.agent, kind: book ? "transfer_out" : r.kind === "withdraw" ? "withdrawal" : "payout", ref: id, deltaMinor: -r.amount, balanceAfterMinor: after, counterparty: book ? to!.label : payoutTo, memo: base.memo || base.purpose });
    if (book) {
      const dest = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, to!.agent) }))!;
      await tx.update(accounts).set({ balanceMinor: dest.balanceMinor + r.amount }).where(eq(accounts.agent, dest.agent));
      await tx.insert(ledger).values({ agent: dest.agent, kind: "transfer_in", ref: id, deltaMinor: r.amount, balanceAfterMinor: dest.balanceMinor + r.amount, counterparty: live.label, memo: base.memo || base.purpose });
    }
    const [row] = await tx.insert(transfers).values({ id, ...base, status: book ? "BOOKED" : "SENDING" }).returning();
    return { row: row!, fresh: true, balance: after };
  });

  return finish(from, to, out);
}

/** After the debit is committed: pay out through PayPal if the money is leaving, sign the receipt, write the trail. */
async function finish(from: Account, to: Account | null, out: { row: Transfer; fresh: boolean; balance: number }): Promise<TransferResult> {
  let t = out.row;
  const what = t.kind === "charge" ? "card" : "transfer";
  if (t.status === "DENIED") {
    if (out.fresh) await note(from, `${what}.denied`, "REJECTED", t.id, { amount: t.amountMinor, payee: t.payee, ...(t.cardId ? { card: t.cardId } : {}), reasons: t.reasons.map((x) => x.code) });
    return { status: "DENIED", transfer: t, reasons: t.reasons, receipt: null, duplicate: !out.fresh, balanceMinor: out.balance };
  }
  if (t.status === "SENDING") t = await send(from, t);
  if (!t.receipt && t.status !== "FAILED" && t.status !== "SENDING") t = await receipt(from, to, t);
  if (out.fresh) await note(from, t.kind === "charge" ? "card.charged" : t.status === "BOOKED" ? "transfer.booked" : t.kind === "withdraw" ? "balance.withdrawn" : "transfer.paid_out", t.status === "FAILED" ? "FAILED" : "OK", t.id, { amount: t.amountMinor, to: t.toAgent ? t.payee : E.fingerprint(t.payoutTo ?? ""), ...(t.cardId ? { card: t.cardId } : {}), status: t.status });
  const now = await getDb().query.accounts.findFirst({ where: eq(accounts.agent, from.agent) });
  return { status: t.status, transfer: t, reasons: t.reasons, receipt: t.receipt, duplicate: !out.fresh, balanceMinor: now?.balanceMinor ?? null };
}

/** The balance has already been debited; send the money through PayPal. Safe to call again for the same transfer. */
async function send(from: Account, t: Transfer): Promise<Transfer> {
  const db = getDb();
  try {
    const po = await payout(getPayPal(), { spendId: t.id, receiverEmail: t.payoutTo!, amountMinor: t.amountMinor, currency: t.currency, note: `${t.memo || t.purpose || "Payment"} · from ${from.label}'s Envelope account (${t.id})` });
    const st = po.itemStatus ?? po.batchStatus;
    const status: Transfer["status"] = st === "SUCCESS" ? "PAID" : st === "UNCLAIMED" ? "UNCLAIMED" : "PAYOUT_PENDING";
    const [u] = await db.update(transfers).set({ status, payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutStatus: st }).where(and(eq(transfers.id, t.id), eq(transfers.status, "SENDING"))).returning();
    return u ?? (await db.query.transfers.findFirst({ where: eq(transfers.id, t.id) }))!;
  } catch (e) {
    if (!(e instanceof PayPalApiError) || e.retryable) return t; // in doubt: stays SENDING; presenting the same request again resumes here
    // Another arrival of the same request may already have sent it; then PayPal is refusing a duplicate, not the payment.
    const again = (await db.query.transfers.findFirst({ where: eq(transfers.id, t.id) }))!;
    if (again.payoutBatchId || again.status !== "SENDING") return again;
    if (e.issue === "DUPLICATE_REQUEST_ID" || /duplicate/i.test(e.message)) return again;
    // PayPal refused: put the money back, exactly once.
    return reverse(t, { code: "PAYPAL_PAYOUT_FAILED", at: null, detail: `PayPal refused the payout: ${e.issue ?? e.paypalName}; the amount is back in the balance` }, null);
  }
}

const DEAD = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];
/** Put a debit back, exactly once (the ledger's unique index is the guard). */
async function reverse(t: Transfer, reason: E.Violation, payoutStatus: string | null): Promise<Transfer> {
  return getDb().transaction(async (tx) => {
    await lockAccount(tx, t.fromAgent);
    const [u] = await tx.update(transfers).set({ status: "FAILED", reasons: [reason], ...(payoutStatus ? { payoutStatus } : {}) }).where(and(eq(transfers.id, t.id), inArray(transfers.status, ["SENDING", "PAYOUT_PENDING", "UNCLAIMED", "PAID"]))).returning();
    if (!u) return (await tx.query.transfers.findFirst({ where: eq(transfers.id, t.id) }))!;
    const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, t.fromAgent) }))!;
    const [row] = await tx.insert(ledger).values({ agent: live.agent, kind: "reversal", ref: t.id, deltaMinor: t.amountMinor, balanceAfterMinor: live.balanceMinor + t.amountMinor, counterparty: t.payoutTo, memo: "the payout did not go through" }).onConflictDoNothing().returning();
    if (row) await tx.update(accounts).set({ balanceMinor: live.balanceMinor + t.amountMinor }).where(eq(accounts.agent, live.agent));
    // A card charge that did not go through does not count against the card.
    if (row && t.cardId) await tx.update(cards).set({ charges: sql`greatest(${cards.charges} - 1, 0)`, chargedMinor: sql`greatest(${cards.chargedMinor} - ${t.amountMinor}, 0)` }).where(eq(cards.id, t.cardId));
    return u;
  });
}

/** Ask PayPal where a pending payout is. If PayPal failed or returned it, the amount goes back to the balance. */
export async function syncTransfer(id: string): Promise<Transfer | null> {
  const db = getDb();
  const t = await db.query.transfers.findFirst({ where: eq(transfers.id, id) });
  if (!t || !t.payoutBatchId || !["PAYOUT_PENDING", "UNCLAIMED"].includes(t.status)) return t ?? null;
  const po = await getPayout(getPayPal(), t.payoutBatchId).catch(() => null);
  if (!po) return t;
  const st = po.itemStatus ?? po.batchStatus;
  if (DEAD.includes(st)) return reverse(t, { code: "PAYPAL_PAYOUT_FAILED", at: null, detail: `PayPal could not deliver the payout (${po.error ?? st}); the amount is back in the balance` }, st);
  const status: Transfer["status"] = st === "SUCCESS" ? "PAID" : st === "UNCLAIMED" ? "UNCLAIMED" : "PAYOUT_PENDING";
  const [u] = await db.update(transfers).set({ status, payoutStatus: st, payoutItemId: po.itemId ?? t.payoutItemId }).where(and(eq(transfers.id, t.id), inArray(transfers.status, ["PAYOUT_PENDING", "UNCLAIMED"]))).returning();
  return u ?? t;
}

async function receipt(from: Account, to: Account | null, t: Transfer): Promise<Transfer> {
  const db = getDb();
  const gw = await gatewayKey();
  const entry = await db.query.ledger.findFirst({ where: and(eq(ledger.agent, from.agent), eq(ledger.ref, t.id)), orderBy: desc(ledger.id) });
  const body: Omit<TransferReceipt, "sig"> = {
    v: TRANSFER_RECEIPT_VERSION, transfer: t.id, request: t.signed.request, requestSig: t.signed.sig,
    ...(await cardOnReceipt(t)),
    from: { account: from.account, agent: from.agent, agentLabel: from.label },
    to: t.toAgent && to && !t.payoutTo ? { kind: "account", account: to.account, agent: to.agent, agentLabel: to.label } : { kind: "paypal", address: t.payoutTo!.replace(/^(.)[^@]*(@.*)$/, "$1•••$2"), payoutBatchId: t.payoutBatchId!, mode: paypalMode() },
    balanceAfterMinor: entry?.balanceAfterMinor ?? 0,
    issuedAt: new Date().toISOString(), gateway: gw.publicKey,
  };
  const r: TransferReceipt = { ...body, sig: await E.signDetached(gw.privateKey, TRANSFER_RECEIPT_VERSION, body) };
  const [u] = await db.update(transfers).set({ receipt: r }).where(eq(transfers.id, t.id)).returning();
  return u ?? t;
}

async function cardOnReceipt(t: Transfer): Promise<Pick<TransferReceipt, "card">> {
  if (!t.cardId) return {};
  const c = await getDb().query.cards.findFirst({ where: eq(cards.id, t.cardId) });
  return c ? { card: { id: c.id, number: c.number, label: c.label, charge: c.charges, of: c.maxCharges } } : {};
}

// ---------------------------------------------------------------------------------------------------
// Cards. An agent's signed permission for one merchant to charge its balance: capped per charge,
// spaced by a billing period, limited to a number of charges, and gone after a date. Charges are
// signed by the merchant's own key, so the card's details are useless to anyone else.
// ---------------------------------------------------------------------------------------------------

const MAX_LIVE_CARDS = 50;
export type CardState = "ACTIVE" | "USED_UP" | "CANCELLED" | "EXPIRED";
export const cardState = (c: Card, now = Date.now()): CardState => (c.cancelledAt ? "CANCELLED" : c.charges >= c.maxCharges ? "USED_UP" : c.notAfter.getTime() < now ? "EXPIRED" : "ACTIVE");

/** An agent issues a card on its own balance. Issuing moves no money. */
export async function issueCard(signed: E.SignedCard): Promise<Card> {
  const bad = await E.verifyCard(signed);
  if (bad.length) throw new UserFacingError(bad.map((x) => x.detail).join("; "), bad.some((x) => x.code === "NOT_THE_HOLDER") ? 401 : 422);
  const db = getDb();
  const b = signed.body;
  const number = b.merchant.slice(5).toUpperCase();
  const [holder, merchant, existing] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(accounts.agent, b.holder) }),
    db.query.accounts.findFirst({ where: eq(accounts.account, number) }),
    db.query.cards.findFirst({ where: eq(cards.id, b.id) }),
  ]);
  if (existing) { if (existing.holder !== b.holder) throw new UserFacingError("That card id is taken.", 409); return existing; }
  if (!holder) throw new UserFacingError("A card draws on its holder's balance: the agent needs an account here first.", 422);
  if (!merchant) throw new UserFacingError(`No merchant has opened account ${number}. A card can only be locked to an account that exists.`, 422);
  if (merchant.agent === holder.agent) throw new UserFacingError("A card can't be locked to its own holder.", 422);
  const live = await db.select({ n: sql<number>`count(*)::int` }).from(cards).where(and(eq(cards.holder, b.holder), isNull(cards.cancelledAt), gt(cards.notAfter, new Date())));
  if ((live[0]?.n ?? 0) >= MAX_LIVE_CARDS) throw new UserFacingError("This account has too many live cards. Cancel one first.", 429);
  const h = (await E.sha256(E.canonical(signed))).slice(0, 14).toUpperCase();
  const [row] = await db.insert(cards).values({
    id: b.id, number: `XN${h.slice(0, 2)} ${h.slice(2, 6)} ${h.slice(6, 10)} ${h.slice(10, 14)}`, holder: b.holder, label: b.label, merchantAgent: merchant.agent,
    perChargeMinor: b.perCharge, maxCharges: b.maxCharges, everySeconds: b.every, notAfter: new Date(b.notAfter), signed,
  }).onConflictDoNothing().returning();
  const card = row ?? (await db.query.cards.findFirst({ where: eq(cards.id, b.id) }))!;
  await note(holder, "card.issued", "OK", card.id, { label: card.label, merchant: merchant.label, perCharge: card.perChargeMinor, maxCharges: card.maxCharges, every: card.everySeconds, notAfter: b.notAfter });
  return card;
}

/** The merchant a card is locked to pulls money through it. Everything the card and the owner allow is checked under the holder's lock. */
export async function charge(signed: E.SignedCharge): Promise<TransferResult & { card: Card | null }> {
  const db = getDb();
  const stateless = await E.verifyCharge(signed);
  const r = signed?.request;
  const denied = (reasons: E.Violation[], card: Card | null = null) => ({ status: "DENIED" as const, transfer: null, reasons, receipt: null, duplicate: false, balanceMinor: null, card });
  if (!r || typeof r.card !== "string") return denied(stateless);
  const card = await db.query.cards.findFirst({ where: eq(cards.id, r.card) });
  if (!card) return denied([...stateless, { code: "UNKNOWN_CARD", at: null, detail: "no card with that id" }]);
  const [from, to] = await Promise.all([db.query.accounts.findFirst({ where: eq(accounts.agent, card.holder) }), db.query.accounts.findFirst({ where: eq(accounts.agent, card.merchantAgent) })]);
  if (!from || !to) return denied([...stateless, { code: "NO_BALANCE_ACCOUNT", at: null, detail: "the card's holder or merchant no longer has an account" }], card);
  const reasons: E.Violation[] = [...stateless];
  // Only the card's own merchant can leave a trace on it, even a refusal.
  if (stateless.some((v) => v.code === "NOT_THE_MERCHANT" || v.code === "MALFORMED")) return denied(stateless, card);
  if (r.merchant !== card.merchantAgent) return denied([...stateless, { code: "NOT_THE_MERCHANT", at: null, detail: `this card is locked to ${to.label}; only that merchant's key can charge it` }], card);
  const book = to.mode === "hold";
  const authentic = !stateless.some((v) => v.code === "NOT_THE_MERCHANT" || v.code === "MALFORMED");
  const requestHash = await E.sha256(E.canonical(authentic ? { request: r } : { request: r, sig: signed.sig }));
  const amount = Number.isSafeInteger(r.amount) ? r.amount : 0;
  const base = { fromAgent: from.agent, kind: "charge" as const, cardId: card.id, payee: `acct:${to.account.toLowerCase()}`, toAgent: to.agent, payoutTo: book ? null : to.settleTo, amountMinor: amount, currency: String(r.currency), purpose: card.label.toLowerCase().slice(0, 60), memo: String(r.memo).slice(0, 200), requestHash, signed };

  const out = await db.transaction(async (tx): Promise<{ row: Transfer; fresh: boolean; balance: number }> => {
    for (const k of [from.agent, ...(book ? [to.agent] : [])].sort()) await lockAccount(tx, k);
    const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, from.agent) }))!;
    const seen = await tx.query.transfers.findFirst({ where: eq(transfers.requestHash, requestHash) });
    if (seen) return { row: seen, fresh: false, balance: live.balanceMinor };
    const c = (await tx.query.cards.findFirst({ where: eq(cards.id, card.id) }))!;
    const now = Date.now();
    const why = [...reasons];
    if (why.length === 0) {
      if (c.cancelledAt) why.push({ code: "CARD_CANCELLED", at: null, detail: `the card was cancelled on ${c.cancelledAt.toISOString()}` });
      else if (c.notAfter.getTime() < now) why.push({ code: "CARD_EXPIRED", at: null, detail: `the card expired on ${c.notAfter.toISOString()}` });
      else if (c.charges >= c.maxCharges) why.push({ code: "CARD_USED_UP", at: null, detail: `the card allowed ${c.maxCharges} charge${c.maxCharges === 1 ? "" : "s"} and all have been made` });
      else {
        if (amount > c.perChargeMinor) why.push({ code: "OVER_CARD_LIMIT", at: null, detail: `${E.money(amount)} is over the card's ${E.money(c.perChargeMinor)} per charge` });
        if (c.lastChargeAt && c.everySeconds > 0 && now < c.lastChargeAt.getTime() + c.everySeconds * 1000) why.push({ code: "CHARGE_TOO_SOON", at: null, detail: `the next charge is allowed from ${new Date(c.lastChargeAt.getTime() + c.everySeconds * 1000).toISOString()}` });
      }
      if (why.length === 0) why.push(...(await ownerRules(tx, live, amount, true)));
    }
    const id = newId("ch");
    if (why.length) {
      const [row] = await tx.insert(transfers).values({ id, ...base, status: "DENIED", reasons: why }).returning();
      return { row: row!, fresh: true, balance: live.balanceMinor };
    }
    const after = live.balanceMinor - amount;
    const memo = `Card · ${c.label}${base.memo ? ` · ${base.memo}` : ""}`.slice(0, 200);
    await tx.update(accounts).set({ balanceMinor: after }).where(eq(accounts.agent, live.agent));
    await tx.insert(ledger).values({ agent: live.agent, kind: book ? "transfer_out" : "payout", ref: id, deltaMinor: -amount, balanceAfterMinor: after, counterparty: book ? to.label : to.settleTo, memo });
    if (book) {
      const dest = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, to.agent) }))!;
      await tx.update(accounts).set({ balanceMinor: dest.balanceMinor + amount }).where(eq(accounts.agent, dest.agent));
      await tx.insert(ledger).values({ agent: dest.agent, kind: "transfer_in", ref: id, deltaMinor: amount, balanceAfterMinor: dest.balanceMinor + amount, counterparty: live.label, memo });
    }
    await tx.update(cards).set({ charges: c.charges + 1, chargedMinor: c.chargedMinor + amount, lastChargeAt: new Date(now) }).where(eq(cards.id, c.id));
    const [row] = await tx.insert(transfers).values({ id, ...base, status: book ? "BOOKED" : "SENDING" }).returning();
    return { row: row!, fresh: true, balance: after };
  });
  const done = await finish(from, to, out);
  return { ...done, card: (await db.query.cards.findFirst({ where: eq(cards.id, card.id) })) ?? card };
}

/** The holder, or the owner who answers for the holder's account, cancels a card. Nothing can be charged to it again. */
export async function cancelCard(signed: E.SignedCardCancel): Promise<Card> {
  if (!(await E.verifyCardCancelSignature(signed))) throw new UserFacingError("That isn't properly signed, or is too old.", 401);
  const db = getDb();
  const card = await db.query.cards.findFirst({ where: eq(cards.id, signed.request.card) });
  if (!card) throw new UserFacingError("No such card.", 404);
  const holder = await db.query.accounts.findFirst({ where: eq(accounts.agent, card.holder) });
  if (signed.by !== card.holder && signed.by !== holder?.owner) throw new UserFacingError("Only the card's holder or the owner of its account can cancel it.", 403);
  if (card.cancelledAt) return card;
  const [u] = await db.update(cards).set({ cancelledAt: new Date(), cancelledBy: signed.by === card.holder ? "holder" : "owner" }).where(and(eq(cards.id, card.id), isNull(cards.cancelledAt))).returning();
  if (u && holder) await audit(db, { scopeId: holder.owner, subjectId: `acct:${holder.account}`, actor: signed.by === card.holder ? "agent" : "principal", action: "card.cancelled", ref: card.id, outcome: "OK", detail: { label: card.label, charges: card.charges } });
  return u ?? (await db.query.cards.findFirst({ where: eq(cards.id, card.id) }))!;
}

async function describeCard(c: Card) {
  const db = getDb();
  const [merchant, holder, rows] = await Promise.all([
    db.query.accounts.findFirst({ where: eq(accounts.agent, c.merchantAgent) }),
    db.query.accounts.findFirst({ where: eq(accounts.agent, c.holder) }),
    db.select().from(transfers).where(eq(transfers.cardId, c.id)).orderBy(desc(transfers.createdAt)).limit(20),
  ]);
  const state = cardState(c);
  const next = state === "ACTIVE" && c.lastChargeAt && c.everySeconds > 0 ? new Date(c.lastChargeAt.getTime() + c.everySeconds * 1000) : null;
  return {
    id: c.id, number: c.number, label: c.label, state,
    holder: { key: c.holder, label: holder?.label ?? "agent", owner: holder?.ownerName ?? null, frozen: Boolean(holder?.frozenAt) },
    merchant: { key: c.merchantAgent, label: merchant?.label ?? "merchant", account: merchant?.account ?? null },
    perChargeMinor: c.perChargeMinor, maxCharges: c.maxCharges, everySeconds: c.everySeconds, notAfter: c.notAfter.toISOString(),
    charges: c.charges, chargedMinor: c.chargedMinor, lastChargeAt: c.lastChargeAt?.toISOString() ?? null,
    nextChargeFrom: next && next.getTime() > Date.now() ? next.toISOString() : null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null, cancelledBy: c.cancelledBy, issuedAt: c.createdAt.toISOString(),
    signed: c.signed,
    attempts: rows.map((t) => ({ id: t.id, at: t.createdAt.toISOString(), amountMinor: t.amountMinor, status: t.status, reasons: t.reasons.map((x) => x.code), memo: t.memo, payoutBatchId: t.payoutBatchId, payoutStatus: t.payoutStatus })),
  };
}
/** One card: its signed terms, what has been used, and every attempt to charge it. There is nothing secret in it. */
export async function cardById(id: string) {
  const c = await getDb().query.cards.findFirst({ where: eq(cards.id, id) });
  return c ? describeCard(c) : null;
}
/** Every card on the gateway, newest first, without the charge attempts. Nothing in a card is secret. */
export async function allCards(limit = 60) {
  const rows = await getDb().select().from(cards).orderBy(desc(cards.createdAt)).limit(limit);
  return (await Promise.all(rows.map(describeCard))).map(({ attempts, signed: _signed, ...c }) => ({ ...c, attempts: attempts.length }));
}
/** The cards an agent has issued, newest first. */
export async function cardsOf(agent: string) {
  const rows = await getDb().select().from(cards).where(eq(cards.holder, agent)).orderBy(desc(cards.createdAt)).limit(8);
  return Promise.all(rows.map(describeCard));
}

/** The owner freezes (or unfreezes) an agent's account: nothing can leave a frozen balance. Income still arrives. */
export async function freeze(signed: E.SignedFreeze): Promise<Account> {
  if (!(await E.verifyFreezeSignature(signed))) throw new UserFacingError("That isn't properly signed, or is too old.", 401);
  const db = getDb();
  const acct = await db.query.accounts.findFirst({ where: eq(accounts.agent, signed.request.agent) });
  if (!acct) throw new UserFacingError("No such account.", 404);
  if (signed.by !== acct.owner) throw new UserFacingError("Only the owner who answers for an account can freeze it.", 403);
  const at = new Date(signed.request.at);
  const u = await db.transaction(async (tx) => {
    await lockAccount(tx, acct.agent);
    const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, acct.agent) }))!;
    // An older freeze or unfreeze can't be presented again to undo a newer one.
    if (live.freezeSignedAt && live.freezeSignedAt.getTime() >= at.getTime()) throw new UserFacingError("A newer freeze or unfreeze has already been applied to this account.", 409);
    const [row] = await tx.update(accounts).set({ frozenAt: signed.request.frozen ? live.frozenAt ?? new Date() : null, freezeSignedAt: at }).where(eq(accounts.agent, acct.agent)).returning();
    return row;
  });
  await audit(db, { scopeId: acct.owner, subjectId: `acct:${acct.account}`, actor: "principal", action: signed.request.frozen ? "account.frozen" : "account.unfrozen", ref: acct.account, outcome: "OK", detail: { agent: acct.label } });
  return u!;
}

/**
 * The bank's own books. Every balance is a liability; it must equal what the ledger says, and the
 * ledger must equal money captured from PayPal holds into accounts minus money paid out of them.
 */
// ---------------------------------------------------------------------------
// Refund: an agent that kept a payment gives it back
// ---------------------------------------------------------------------------

export type RefundResult = { status: "REFUNDED" | "DENIED" | "PENDING" | "FAILED"; spendId: string | null; refundId: string | null; reasons: E.Violation[]; balanceMinor: number | null };

/**
 * An agent that was paid, and kept the money in its balance, returns one payment in full. Its balance is
 * debited first, once (one ledger row per payment); then PayPal refunds the capture to the owner's
 * funding source; then the owner's books follow. If PayPal refuses, the debit is undone, once. If PayPal
 * cannot be reached, the debit stands and `settleRefunds` finishes the job later: the refund carries
 * the payment's own idempotency key, so asking again can never refund twice.
 *
 * Only the key that was paid can do this. Money that already left the balance cannot be refunded from it.
 */
export async function refund(signed: E.SignedRefund): Promise<RefundResult> {
  const db = getDb();
  const why = await E.verifyRefund(signed);
  if (why.length) return { status: "DENIED", spendId: null, refundId: null, reasons: why, balanceMinor: null };
  const r = signed.request;
  const s = await db.query.spends.findFirst({ where: eq(spends.id, r.spend) });
  const acct = await db.query.accounts.findFirst({ where: eq(accounts.agent, r.from) });
  const deny = (code: E.Reason, detail: string, balance: number | null = acct?.balanceMinor ?? null): RefundResult => ({ status: "DENIED", spendId: s?.id ?? null, refundId: null, reasons: [{ code, at: null, detail }], balanceMinor: balance });
  // Anyone else's request says nothing about this account or this payment, and leaves no trace on them.
  if (!s || !acct || s.payeeAgent !== r.from) return deny("NOT_THE_HOLDER", "only the agent that was paid can refund a payment", null);
  if (s.status === "FAILED" && s.refundId) return { status: "REFUNDED", spendId: s.id, refundId: s.refundId, reasons: s.reasons, balanceMinor: acct.balanceMinor };
  if (s.status !== "PAID" || s.payoutStatus !== HELD || !s.captureId) return deny("NOT_REFUNDABLE", "only a payment that was credited to this agent's balance can be refunded by it");

  const debit = await db.transaction(async (tx) => {
    await lockAccount(tx, acct.agent);
    const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, acct.agent) }))!;
    const already = await tx.query.ledger.findFirst({ where: and(eq(ledger.agent, live.agent), eq(ledger.kind, "refund"), eq(ledger.ref, s.id)) });
    if (already) {
      // Debited before. Unless that debit was undone (PayPal refused), the refund is in progress and can simply continue.
      const undone = await tx.query.ledger.findFirst({ where: and(eq(ledger.agent, live.agent), eq(ledger.kind, "refund_reversal"), eq(ledger.ref, s.id)) });
      return undone ? { refused: [{ code: "PAYPAL_REFUND_FAILED", at: null, detail: "PayPal refused this refund earlier; the money is in the balance" }] as E.Violation[], balance: live.balanceMinor } : { refused: null, balance: live.balanceMinor };
    }
    const no: E.Violation[] = [];
    if (live.frozenAt) no.push({ code: "ACCOUNT_FROZEN", at: null, detail: `${live.label}'s account was frozen by ${live.ownerName}` });
    if (s.amountMinor > live.balanceMinor) no.push({ code: "INSUFFICIENT_BALANCE", at: null, detail: `the balance is ${E.money(live.balanceMinor)}; this payment was ${E.money(s.amountMinor)}` });
    if (no.length) return { refused: no, balance: live.balanceMinor };
    const after = live.balanceMinor - s.amountMinor;
    await tx.insert(ledger).values({ agent: live.agent, kind: "refund", ref: s.id, deltaMinor: -s.amountMinor, balanceAfterMinor: after, counterparty: s.leafLabel, memo: r.memo || "refund" });
    await tx.update(accounts).set({ balanceMinor: after }).where(eq(accounts.agent, live.agent));
    return { refused: null, balance: after };
  });
  if (debit.refused) return { status: "DENIED", spendId: s.id, refundId: null, reasons: debit.refused, balanceMinor: debit.balance };
  await note(acct, "balance.refund_requested", "PENDING", s.id, { amount: s.amountMinor, to: s.leafLabel, memo: r.memo });
  return finishRefund(s, acct, r.memo);
}

/** The PayPal half of a refund whose debit is already on the ledger. Safe to call any number of times. */
async function finishRefund(s: Spend, acct: Account, memo: string): Promise<RefundResult> {
  const db = getDb();
  let refundId: string | null = null;
  try {
    refundId = (await refundCapture(getPayPal(), s.captureId!, s.id, memo || "Refunded by the payee")).id;
  } catch (e) {
    if (e instanceof PayPalApiError && e.issue === "CAPTURE_FULLY_REFUNDED") refundId = "already-refunded";
    else if (e instanceof PayPalApiError && !e.retryable) {
      // PayPal said no. Put the money back in the balance, once, and say so.
      const balance = await db.transaction(async (tx) => {
        await lockAccount(tx, acct.agent);
        const live = (await tx.query.accounts.findFirst({ where: eq(accounts.agent, acct.agent) }))!;
        const [row] = await tx.insert(ledger).values({ agent: live.agent, kind: "refund_reversal", ref: s.id, deltaMinor: s.amountMinor, balanceAfterMinor: live.balanceMinor + s.amountMinor, counterparty: s.leafLabel, memo: "PayPal refused the refund" }).onConflictDoNothing().returning();
        if (row) await tx.update(accounts).set({ balanceMinor: live.balanceMinor + s.amountMinor }).where(eq(accounts.agent, live.agent));
        return live.balanceMinor + (row ? s.amountMinor : 0);
      });
      await note(acct, "balance.refund_refused", "FAILED", s.id, { issue: e.issue ?? e.paypalName });
      return { status: "FAILED", spendId: s.id, refundId: null, reasons: [{ code: "PAYPAL_REFUND_FAILED", at: null, detail: `PayPal refused the refund (${e.issue ?? e.paypalName}); the money is back in the balance` }], balanceMinor: balance };
    } else {
      // PayPal could not be reached. The debit stands; settleRefunds asks again.
      return { status: "PENDING", spendId: s.id, refundId: null, reasons: [], balanceMinor: (await db.query.accounts.findFirst({ where: eq(accounts.agent, acct.agent) }))?.balanceMinor ?? null };
    }
  }
  const u = await markRefundedByPayee(s.id, refundId, acct.label, memo);
  await note(acct, "balance.refunded", "OK", s.id, { amount: s.amountMinor, refund: refundId, capture: s.captureId });
  return { status: "REFUNDED", spendId: s.id, refundId: u.refundId, reasons: u.reasons, balanceMinor: (await db.query.accounts.findFirst({ where: eq(accounts.agent, acct.agent) }))?.balanceMinor ?? null };
}

/** Refunds whose debit is on the ledger but which PayPal has not confirmed (it was unreachable): ask again. */
export async function settleRefunds(limit = 20): Promise<Array<{ spend: string; status: RefundResult["status"] }>> {
  const db = getDb();
  const open = await db.select({ agent: ledger.agent, ref: ledger.ref, memo: ledger.memo }).from(ledger).innerJoin(spends, eq(spends.id, ledger.ref))
    .where(and(eq(ledger.kind, "refund"), eq(spends.status, "PAID"), isNull(spends.refundId))).limit(limit);
  const out: Array<{ spend: string; status: RefundResult["status"] }> = [];
  for (const o of open) {
    const undone = await db.query.ledger.findFirst({ where: and(eq(ledger.agent, o.agent), eq(ledger.kind, "refund_reversal"), eq(ledger.ref, o.ref)) });
    if (undone) continue;
    const s = (await db.query.spends.findFirst({ where: eq(spends.id, o.ref) }))!;
    const acct = (await db.query.accounts.findFirst({ where: eq(accounts.agent, o.agent) }))!;
    out.push({ spend: s.id, status: (await finishRefund(s, acct, o.memo ?? "")).status });
  }
  return out;
}

export async function position() {
  const db = getDb();
  const [accts, sums] = await Promise.all([
    db.select().from(accounts).orderBy(desc(accounts.balanceMinor), desc(accounts.openedAt)).limit(200),
    db.select({ kind: ledger.kind, total: sql<number>`coalesce(sum(${ledger.deltaMinor}), 0)::int`, n: sql<number>`count(*)::int` }).from(ledger).groupBy(ledger.kind),
  ]);
  const by = Object.fromEntries(sums.map((x) => [x.kind, x])) as Record<string, { total: number; n: number } | undefined>;
  const balances = accts.reduce((n, a) => n + a.balanceMinor, 0);
  const ledgerTotal = sums.reduce((n, x) => n + x.total, 0);
  const capturedIn = by.income?.total ?? 0;
  const paidOut = -((by.payout?.total ?? 0) + (by.withdrawal?.total ?? 0)) - (by.reversal?.total ?? 0);
  const refunded = -((by.refund?.total ?? 0) + (by.refund_reversal?.total ?? 0));
  const bookTransfers = by.transfer_out?.n ?? 0;
  return {
    mode: paypalMode(),
    accounts: accts.map((a) => ({ agent: a.agent, account: a.account, label: a.label, owner: a.ownerName, mode: a.mode, balanceMinor: a.balanceMinor, frozen: Boolean(a.frozenAt), perPaymentMinor: a.perPaymentMinor })),
    totals: { accounts: accts.length, holding: accts.filter((a) => a.mode === "hold").length, balancesMinor: balances, capturedInMinor: capturedIn, paidOutMinor: paidOut, refundedMinor: refunded, bookTransfers, bookTransferredMinor: by.transfer_in?.total ?? 0 },
    // balances == ledger, and ledger == captured in − paid out (book transfers net to zero)
    checks: [
      { name: "Every balance equals the sum of its ledger entries", ok: balances === ledgerTotal },
      { name: "Balances equal money captured from PayPal holds into accounts, minus money paid out or refunded", ok: balances === capturedIn - paidOut - refunded },
      { name: "Transfers between accounts net to zero", ok: (by.transfer_in?.total ?? 0) + (by.transfer_out?.total ?? 0) === 0 },
    ],
  };
}

/** A transfer and whether its receipt verifies. The PayPal address is masked. */
export async function transferById(id: string) {
  const t = await syncTransfer(id);
  if (!t) return null;
  const { signed: _s, payoutTo, ...rest } = t;
  return { ...rest, payoutTo: payoutTo ? payoutTo.replace(/^(.)[^@]*(@.*)$/, "$1•••$2") : null, receiptOk: t.receipt ? await verifyTransferReceipt(t.receipt) : null };
}

/** One account's recent ledger. */
export async function ledgerOf(agent: string, limit = 40) {
  return getDb().select().from(ledger).where(eq(ledger.agent, agent)).orderBy(desc(ledger.id)).limit(limit);
}
