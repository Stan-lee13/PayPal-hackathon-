/**
 * The books, checked against PayPal's own.
 *
 *   reserves    what the gateway owes (agents' balances, refunds due) against the balance PayPal reports
 *   statement   PayPal's statement of the account (Transaction Search), line by line against our captures and payouts
 *   disputes    what PayPal says payers have disputed, and the evidence the gateway answers with
 *
 * The first two use a second source at PayPal, independent of the calls that moved the money. The third
 * is where a signed chain of authority earns its keep: when a payer says "I never authorized this", the
 * answer is their own signature on the envelope, and every signature between it and the payment.
 *
 * No model output is read anywhere in this file.
 */
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, ledger, roots, spends, type Spend } from "../db/schema";
import * as E from "../envelope/core";
import { UserFacingError } from "../errors";
import { formatMoney } from "../money";
import { getPayPal, paypalMode } from "../paypal/client";
import { getBalance, listDisputes, listTransactions, provideEvidence, type BalanceFacts } from "../paypal/payments";
import { checkDispute, trail } from "./service";

// ---------------------------------------------------------------------------
// Reserves
// ---------------------------------------------------------------------------

let lastBalance: { at: number; currency: string; facts: BalanceFacts | null } | null = null;
/** PayPal's balance for the gateway's account, asked at most once every 20 seconds. */
async function paypalBalance(currency: string): Promise<BalanceFacts | null> {
  if (lastBalance && lastBalance.currency === currency && Date.now() - lastBalance.at < 20_000) return lastBalance.facts;
  const facts = await getBalance(getPayPal(), currency).catch(() => null);
  lastBalance = { at: Date.now(), currency, facts };
  return facts;
}
/** Tests: forget the cached balance. */
export function forgetBalance() { lastBalance = null; }

/**
 * What the gateway owes, against what PayPal says it holds. Owed: every agent's balance, plus captures
 * the owner is due back (a payout failed and PayPal has not yet accepted the refund). Held: the
 * available balance PayPal's Reporting API gives for the gateway's account.
 *
 * PayPal dates its figure ("as of"), and that date can be hours old. Comparing an old balance with what
 * is owed this second would raise false alarms, so the comparison is made at PayPal's own moment: what
 * was owed then is summed from the ledger, whose every entry carries its time. `covered` is null when
 * PayPal could not be asked.
 */
export async function reserves(currency = "USD") {
  const db = getDb();
  const [bal, due] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${accounts.balanceMinor}), 0)::int`, n: sql<number>`count(*) filter (where ${accounts.balanceMinor} > 0)::int` }).from(accounts),
    db.select({ total: sql<number>`coalesce(sum(${spends.amountMinor}), 0)::int` }).from(spends).where(eq(spends.status, "REFUND_DUE")),
  ]);
  const balances = bal[0]?.total ?? 0, refundsDue = due[0]?.total ?? 0, owed = balances + refundsDue;
  const paypal = await paypalBalance(currency);
  // Like for like: what was owed at the moment PayPal dates its figure, from the ledger. (That balances equal the ledger is its own check, in the books.)
  const asOf = paypal?.asOf ? new Date(paypal.asOf) : null;
  const owedThen = asOf ? ((await db.select({ total: sql<number>`coalesce(sum(${ledger.deltaMinor}), 0)::int` }).from(ledger).where(lte(ledger.createdAt, asOf)))[0]?.total ?? 0) + refundsDue : owed;
  return {
    mode: paypalMode(), currency,
    owed: { balancesMinor: balances, accountsWithMoney: bal[0]?.n ?? 0, refundsDueMinor: refundsDue, totalMinor: owed, atPayPalsTimeMinor: owedThen },
    paypal: paypal ? { availableMinor: paypal.availableMinor, totalMinor: paypal.totalMinor, withheldMinor: paypal.withheldMinor, asOf: paypal.asOf } : null,
    covered: paypal ? paypal.availableMinor >= owedThen : null,
    surplusMinor: paypal ? paypal.availableMinor - owedThen : null,
  };
}

// ---------------------------------------------------------------------------
// PayPal's statement
// ---------------------------------------------------------------------------

export type StatementMatch = { paypalId: string; what: "capture" | "payout" | "refund"; spend: string; amountMinor: number; verdict: "listed" | "amount differs" | "not listed yet"; listedMinor: number | null };

/**
 * Compare what this gateway recorded with PayPal's own statement of the account for the last `hours`.
 * A capture is looked for under its PayPal transaction id and must carry the same amount; a payout
 * under the transaction id PayPal gave it. PayPal's statement can lag by up to three hours, so a recent
 * transaction that is missing is "not listed yet", not an error. A line PayPal lists that is not ours
 * is counted as other activity on the account.
 */
export async function statement(hours = 72) {
  const db = getDb();
  const end = new Date(), start = new Date(end.getTime() - Math.min(hours, 24 * 30) * 3600_000);
  const lines = await listTransactions(getPayPal(), start, end);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const ours = await db.select().from(spends).where(and(isNotNull(spends.captureId), gt(spends.createdAt, start))).orderBy(desc(spends.createdAt)).limit(300);
  const matches: StatementMatch[] = [];
  const seen = new Set<string>();
  const look = (paypalId: string, what: StatementMatch["what"], s: Spend) => {
    const l = byId.get(paypalId);
    if (l) seen.add(l.id);
    matches.push({ paypalId, what, spend: s.id, amountMinor: s.amountMinor, listedMinor: l ? Math.abs(l.amountMinor) : null, verdict: !l ? "not listed yet" : Math.abs(l.amountMinor) === s.amountMinor && l.currency === s.currency ? "listed" : "amount differs" });
  };
  for (const s of ours) {
    look(s.captureId!, "capture", s);
    if (s.payoutTransactionId) look(s.payoutTransactionId, "payout", s);
  }
  const count = (v: StatementMatch["verdict"]) => matches.filter((m) => m.verdict === v).length;
  return {
    mode: paypalMode(), from: start.toISOString(), to: end.toISOString(),
    paypalLines: lines.length, ours: matches.length, listed: count("listed"), differs: count("amount differs"), notListedYet: count("not listed yet"),
    otherActivity: lines.filter((l) => !seen.has(l.id)).length,
    ok: count("amount differs") === 0,
    matches: matches.slice(0, 120),
  };
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

const fp = (key: string) => E.fingerprint(key);

/**
 * The evidence for one payment: who authorized it, in what words, and how anyone can check. This is
 * what the gateway sends PayPal when the payer disputes the capture, and it is public by the payment's
 * id, like its receipt. It proves the payment was inside limits the payer signed. It does not prove the
 * work was any good.
 */
export async function evidence(spendId: string) {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s?.captureId) throw new UserFacingError("There is no captured payment with that id.", 404);
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
  const chain = s.signed.chain;
  const verdict = await E.verifyChain(chain, new Date(s.signed.request.at));
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const rootCaps = chain[0]!.body.caps;
  const steps = chain.map((b, i) => i === 0
    ? `1. The payer's own key ${fp(root.principal)} signed envelope ${b.body.id} on ${b.body.issuedAt.slice(0, 10)}: up to ${formatMoney(rootCaps.limit, rootCaps.currency)} in total, ${formatMoney(rootCaps.perPayment, rootCaps.currency)} per payment, payees ${rootCaps.payees?.join(", ") ?? "any"}, purposes ${rootCaps.purposes?.join(", ") ?? "any"}, until ${rootCaps.notAfter}. It names agent "${b.body.holderLabel}" (${fp(b.body.holder)}).`
    : `${i + 1}. "${chain[i - 1]!.body.holderLabel}" signed a narrower envelope for "${b.body.holderLabel}" (${fp(b.body.holder)}): up to ${formatMoney(b.body.caps.limit, b.body.caps.currency)}.`);
  const summary = [
    `This payment was made by software acting inside limits the payer signed with their own key. PayPal authorization ${root.authorizationId} was placed for those limits; capture ${s.captureId} took ${formatMoney(s.amountMinor, s.currency)} of it for "${s.purpose}", payable to ${s.payee}.`,
    ...steps,
    `${chain.length + 1}. "${s.leafLabel}" signed the request for exactly this amount, payee and purpose at ${s.signed.request.at}.`,
    ...(s.delivery ? [`Delivery: accepted by key ${fp(s.delivery.by)}${s.delivery.work ? `, naming the delivered work by fingerprint ${s.delivery.work}` : ""}.`] : []),
    `Every signature above verifies${verdict.ok ? "" : " (the chain as presented failed verification: see the record)"}; none of the limits was exceeded. Anyone can re-check them without trusting us: ${base}/proof/${root.id}/${s.id} re-runs the signature checks in the reader's browser, and ${base}/r/${s.id} shows the signed receipt.`,
  ].join("\n");
  return {
    spend: s.id, amountMinor: s.amountMinor, currency: s.currency, payee: s.payee, purpose: s.purpose,
    paypal: { mode: paypalMode(), authorizationId: root.authorizationId, captureId: s.captureId, payoutBatchId: s.payoutBatchId },
    dispute: s.disputeId ? { id: s.disputeId, status: s.disputeStatus } : null,
    summary, chainVerifies: verdict.ok, payerKey: root.principal,
    request: s.signed.request, requestSignature: s.signed.sig, chain, receipt: s.receipt,
    links: { proof: `${base}/proof/${root.id}/${s.id}`, receipt: `${base}/r/${s.id}` },
    whatItProves: "That the payment was requested by a key holding authority derived, by signed steps that only narrow, from an envelope the payer signed; and that it was within every limit on the way. It does not prove the quality of what was bought.",
  };
}

/**
 * Read every dispute PayPal holds against the gateway's account, record the ones that are about a
 * payment made here, and answer those PayPal is waiting on with the payment's evidence. Sending
 * evidence moves no money. Returns what was found and done.
 */
export async function settleDisputes() {
  const db = getDb();
  const found = await listDisputes(getPayPal()).catch(() => null);
  if (!found) return { asked: false, disputes: 0, ours: [] as Array<{ dispute: string; spend: string; status: string; evidenceSent: boolean }> };
  const ours: Array<{ dispute: string; spend: string; status: string; evidenceSent: boolean }> = [];
  for (const d of found) {
    if (!d.transactionIds.length) continue;
    const s = await db.query.spends.findFirst({ where: inArray(spends.captureId, d.transactionIds) });
    if (!s) continue;
    const seen = await checkDispute(s.id); // records it on the payment and on the envelope's audit trail
    let sent = false;
    if ((seen?.dispute?.status ?? d.status) === "WAITING_FOR_SELLER_RESPONSE") {
      const ev = await evidence(s.id);
      try {
        await provideEvidence(getPayPal(), d.id, ev.summary);
        sent = true;
        const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
        await trail(root, "gateway", "dispute.evidence_sent", "OK", d.id, { spend: s.id, capture: s.captureId, characters: Math.min(ev.summary.length, 2000) });
        await checkDispute(s.id);
      } catch { /* PayPal would not take it now; the next sweep tries again while PayPal is still waiting */ }
    }
    ours.push({ dispute: d.id, spend: s.id, status: (await db.query.spends.findFirst({ where: eq(spends.id, s.id) }))?.disputeStatus ?? d.status, evidenceSent: sent });
  }
  return { asked: true, disputes: found.length, ours };
}
