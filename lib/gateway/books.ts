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
import { accounts, ledger, roots, spends, transfers, type ReconciliationFinding } from "../db/schema";
import { movementsFor, positionsFor, postFee, railAccountIdentity, recordReconciliation } from "../accounting";
import * as E from "../envelope/core";
import { UserFacingError } from "../errors";
import { formatMoney } from "../money";
// The books are checked against the rail's own record, a second source independent of the calls that
// moved the money. Which provider that is, is the rail's business (lib/rails).
import { isRailError, rail, railCode, railMode, type BalanceFacts } from "../rails";
import { checkDispute, trail } from "./service";

// ---------------------------------------------------------------------------
// Reserves
// ---------------------------------------------------------------------------

let lastBalance: { at: number; currency: string; facts: BalanceFacts | null } | null = null;
/** PayPal's balance for the gateway's account, asked at most once every 20 seconds. */
async function paypalBalance(currency: string): Promise<BalanceFacts | null> {
  if (lastBalance && lastBalance.currency === currency && Date.now() - lastBalance.at < 20_000) return lastBalance.facts;
  const facts = await rail().reporting.balance(currency).catch(() => null);
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
    mode: railMode(), currency,
    owed: { balancesMinor: balances, accountsWithMoney: bal[0]?.n ?? 0, refundsDueMinor: refundsDue, totalMinor: owed, atPayPalsTimeMinor: owedThen },
    paypal: paypal ? { availableMinor: paypal.availableMinor, totalMinor: paypal.totalMinor, withheldMinor: paypal.withheldMinor, asOf: paypal.asOf } : null,
    covered: paypal ? paypal.availableMinor >= owedThen : null,
    surplusMinor: paypal ? paypal.availableMinor - owedThen : null,
  };
}

// ---------------------------------------------------------------------------
// PayPal's statement
// ---------------------------------------------------------------------------

export type StatementMatch = {
  paypalId: string; what: "capture" | "payout" | "refund";
  /** The payment (sp_…, pr_…) or, for a payout from an agent's balance, the transfer (tr_…) this line belongs to. */
  spend: string;
  amountMinor: number; listedMinor: number | null;
  /** What PayPal charged on this line, from its statement. Null until the line is listed. */
  feeMinor: number | null;
  /** A payout that PayPal returned or cancelled. It is still looked up, but it is not money that went out. */
  returned: boolean;
  verdict: "listed" | "amount differs" | "not listed yet";
};

/**
 * Compare what this gateway recorded with PayPal's own statement of the account for the last `hours`.
 *
 * A capture and a refund are looked for under their PayPal ids and must carry the same amount. A payout
 * is looked for under the transaction id PayPal gave it or, for a payout from an agent's balance, under
 * the transfer's id, which PayPal prints on the line. PayPal's statement can lag by up to three hours,
 * so a recent transaction that is missing is "not listed yet", not an error. A line PayPal lists that is
 * not ours is counted as other activity on the account.
 *
 * The statement is also the only place PayPal's fees appear. Agents and payees are credited and paid the
 * full amounts, so the fees fall on whoever operates the gateway; `position` says what the listed records
 * left at PayPal once they are taken off. A payout PayPal returned or cancelled is left out of that sum,
 * with its fee: the money came back, and PayPal lists the reversal as a line of its own.
 */
const CAME_BACK = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];
export async function statement(hours = 72) {
  const db = getDb();
  const end = new Date(), start = new Date(end.getTime() - Math.min(hours, 24 * 30) * 3600_000);
  let lines: Awaited<ReturnType<ReturnType<typeof rail>["reporting"]["statement"]>>;
  try {
    lines = await rail().reporting.statement({ from: start, to: end });
  } catch (e) {
    // A rail may be unable to give a statement (it has no reporting capability, or it is down). That is
    // not "everything matches": say it is unavailable and reconcile nothing.
    const why = isRailError(e) ? `${rail().label} cannot read a statement (${railCode(e)}).` : `${rail().label} could not be asked for a statement.`;
    return {
      mode: railMode(), from: start.toISOString(), to: end.toISOString(), available: false, reason: why,
      paypalLines: 0, ours: 0, listed: 0, differs: 0, notListedYet: 0, otherActivity: 0, ok: false,
      position: { inMinor: 0, outMinor: 0, refundedMinor: 0, feesMinor: 0, netMinor: 0 }, matches: [],
    };
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  // a payout's line carries the sender's item id; PayPal also lists the hold it took and released around it, which are not the payout
  const payoutBySender = new Map(lines.filter((l) => l.customField && l.amountMinor < 0 && l.code.startsWith("T00")).map((l) => [l.customField!, l]));
  const matches: StatementMatch[] = [];
  const seen = new Set<string>();
  const position = { inMinor: 0, outMinor: 0, refundedMinor: 0, feesMinor: 0, netMinor: 0 };
  const look = (l: (typeof lines)[number] | undefined, paypalId: string, what: StatementMatch["what"], record: { id: string; amountMinor: number; currency: string }, returned = false) => {
    if (l) seen.add(l.id);
    if (l && !returned) {
      position[what === "capture" ? "inMinor" : what === "payout" ? "outMinor" : "refundedMinor"] += Math.abs(l.amountMinor);
      // Providers report a fee as a negative amount on the line; it is money taken, whoever writes the sign.
      const fee = Math.abs(l.feeMinor);
      position.feesMinor += fee;
      position.netMinor += l.amountMinor - fee;
    }
    matches.push({ paypalId: l?.id ?? paypalId, what, spend: record.id, amountMinor: record.amountMinor, listedMinor: l ? Math.abs(l.amountMinor) : null, feeMinor: l ? Math.abs(l.feeMinor) : null, returned, verdict: !l ? "not listed yet" : Math.abs(l.amountMinor) === record.amountMinor && l.currency === record.currency ? "listed" : "amount differs" });
  };
  const paid = await db.select().from(spends).where(and(isNotNull(spends.captureId), gt(spends.createdAt, start))).orderBy(desc(spends.createdAt)).limit(300);
  for (const s of paid) {
    look(byId.get(s.captureId!), s.captureId!, "capture", s);
    if (s.payoutTransactionId) look(byId.get(s.payoutTransactionId), s.payoutTransactionId, "payout", s, CAME_BACK.includes(s.payoutStatus ?? ""));
    if (s.refundId) look(byId.get(s.refundId), s.refundId, "refund", s);
  }
  const sent = await db.select().from(transfers).where(and(isNotNull(transfers.payoutItemId), gt(transfers.createdAt, start))).orderBy(desc(transfers.createdAt)).limit(200);
  for (const t of sent) look(payoutBySender.get(t.id), t.payoutItemId!, "payout", t, CAME_BACK.includes(t.payoutStatus ?? ""));
  const count = (v: StatementMatch["verdict"]) => matches.filter((m) => m.verdict === v).length;
  return {
    mode: railMode(), from: start.toISOString(), to: end.toISOString(), available: true,
    paypalLines: lines.length, ours: matches.length, listed: count("listed"), differs: count("amount differs"), notListedYet: count("not listed yet"),
    otherActivity: lines.filter((l) => !seen.has(l.id)).length,
    ok: count("amount differs") === 0,
    /** For the records PayPal lists: what came in, went out and was refunded, what PayPal charged, and what that leaves at PayPal. */
    position,
    matches: matches.slice(0, 160),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation: the two books, and the provider's own statement
// ---------------------------------------------------------------------------

export type Reconciliation = {
  /** False when the provider could not give a statement. That is never a successful reconciliation. */
  available: boolean;
  ok: boolean;
  reason?: string;
  rail: string;
  from: string;
  to: string;
  findings: ReconciliationFinding[];
  /** Provider fees seen on the statement in this window, and who ends up paying them. */
  fees: { chargedMinor: number; recordedMinor: number; absorbedBy: string };
  /** Why each of the seven things reconciliation exists to find is, or is not, in this run. */
  checks: string[];
};

/**
 * Compare the provider-side positions (what actually arrived at and left each rail) with the rail's own
 * statement, and record the attempt.
 *
 * The seven things reconciliation must be able to find, and where each is decided here:
 *
 *   missing transactions      a record we have that the statement does not list (`missing_transaction`)
 *   duplicate transactions    the same statement line twice, or two payouts for one payment
 *   incorrect amounts         the statement's amount differs from the record's (`amount_differs`)
 *   unexpected fees           a fee on a line that the application credited gross (`unexpected_fee`)
 *   reversed transfers        a payout the provider returned, with no return on our books
 *   inconsistent settlement   status and provider facts that cannot both be true
 *   insufficient liquidity    a position that went negative: money spent that was never there
 *
 * Fees are the reason this is not bookkeeping theatre. The application credits agents and payees the full
 * amount, so a provider fee is a loss to whoever operates the gateway, and nothing in the ledger shows it.
 * Each fee the statement lists is recorded once in the `fee` bucket of the provider position (`postFee`,
 * keyed by the statement line), which makes it visible and keeps it out of available liquidity.
 *
 * An unavailable statement is recorded as `available: false, ok: false` — never as a pass.
 */
export async function reconcilePositions(hours = 72, currency = "USD"): Promise<Reconciliation> {
  const db = getDb();
  const railId = rail().id;
  const st = await statement(hours);
  const findings: ReconciliationFinding[] = [];
  const add = (code: string, severity: ReconciliationFinding["severity"], detail: string, ref: string | null = null) => findings.push({ code, severity, detail, ref });
  const base = { rail: railId, from: st.from, to: st.to };

  if (!st.available) {
    add("statement_unavailable", "error", st.reason ?? `${railId} could not give a statement`, null);
    await recordReconciliation({ owner: null, rail: railId, currency, from: new Date(st.from), to: new Date(st.to), available: false, ok: false, findings });
    return {
      available: false, ok: false, reason: st.reason, ...base, findings,
      fees: { chargedMinor: 0, recordedMinor: 0, absorbedBy: "gateway operator" },
      checks: ["nothing was reconciled: the provider could not be asked"],
    };
  }

  // Who owns each record, so a fee lands on the organization whose money it was taken from.
  const owners = new Map<string, string>();
  const spendIds = [...new Set(st.matches.filter((m) => m.spend.startsWith("sp_")).map((m) => m.spend))];
  if (spendIds.length) {
    for (const r of await db.select({ id: spends.id, owner: roots.principal }).from(spends).innerJoin(roots, eq(roots.id, spends.rootId)).where(inArray(spends.id, spendIds))) owners.set(r.id, r.owner);
  }
  const transferIds = [...new Set(st.matches.filter((m) => m.spend.startsWith("tr_")).map((m) => m.spend))];
  if (transferIds.length) {
    for (const r of await db.select({ id: transfers.id, owner: accounts.owner }).from(transfers).innerJoin(accounts, eq(accounts.agent, transfers.fromAgent)).where(inArray(transfers.id, transferIds))) owners.set(r.id, r.owner);
  }

  // Fees: recorded once per statement line, in their own bucket, and reported as a cost the app never charged.
  // A fee left the account the statement was read from, so it carries that account's identity.
  const feeAccountId = await railAccountIdentity({ rail: railId, currency });
  let charged = 0, recorded = 0;
  for (const m of st.matches) {
    if (!m.feeMinor) continue;
    charged += Math.abs(m.feeMinor);
    const fresh = await postFee({
      owner: owners.get(m.spend) ?? `rail:${railId}`,
      rail: railId, currency, feeMinor: m.feeMinor, ref: m.paypalId,
      memo: `provider fee on ${m.what} ${m.spend}`, externalAccountId: feeAccountId,
    });
    if (fresh) recorded += Math.abs(m.feeMinor);
    add("unexpected_fee", "warning", `${railId} charged ${formatMoney(Math.abs(m.feeMinor), currency)} on ${m.what} ${m.spend}; the application credited the full ${formatMoney(m.amountMinor, currency)}, so this cost falls on the gateway operator.`, m.spend);
  }

  const threeHours = 3 * 3600_000;
  const aged = new Map<string, number>();
  for (const s of await db.select({ id: spends.id, at: spends.createdAt }).from(spends).where(inArray(spends.id, spendIds.length ? spendIds : ["-"]))) aged.set(s.id, s.at.getTime());
  for (const t of await db.select({ id: transfers.id, at: transfers.createdAt }).from(transfers).where(inArray(transfers.id, transferIds.length ? transferIds : ["-"]))) aged.set(t.id, t.at.getTime());

  let oursNet = 0;
  for (const m of st.matches) {
    if (m.listedMinor === null) {
      // The provider's statement lags by up to three hours; after that, a record it does not list is missing.
      const at = aged.get(m.spend);
      const stale = at !== undefined && Date.now() - at > threeHours;
      add("missing_transaction", stale ? "error" : "warning", `${m.what} ${m.spend} is not on ${railId}'s statement${stale ? " and it is older than the statement's lag" : " yet (the statement can lag by up to three hours)"}.`, m.spend);
      continue;
    }
    if (m.verdict === "amount differs") {
      add("amount_differs", "error", `${m.what} ${m.spend}: we recorded ${formatMoney(m.amountMinor, currency)}, ${railId} lists ${formatMoney(m.listedMinor, currency)}.`, m.spend);
    }
    if (m.returned) {
      const back = (await movementsFor(m.spend)).some((x) => x.kind === "payout_return");
      if (!back) add("reversed_transfer", "error", `A payout for ${m.spend} came back at ${railId}, but no payout return is on the provider position: the books still show the money gone.`, m.spend);
      continue; // money that came back is not in the provider's net for this line
    }
    oursNet += m.what === "capture" ? m.amountMinor : -m.amountMinor;
  }

  // Duplicate lines: the same statement entry twice, or one payment paid out twice.
  const seenLine = new Map<string, number>();
  for (const m of st.matches) seenLine.set(m.paypalId, (seenLine.get(m.paypalId) ?? 0) + 1);
  for (const [id, n] of seenLine) if (n > 1) add("duplicate_transaction", "error", `${railId} lists ${id} ${n} times.`, id);
  const payoutsPerRecord = new Map<string, number>();
  for (const m of st.matches) if (m.what === "payout") payoutsPerRecord.set(m.spend, (payoutsPerRecord.get(m.spend) ?? 0) + 1);
  for (const [id, n] of payoutsPerRecord) if (n > 1) add("duplicate_transaction", "error", `${id} has ${n} payouts on the statement; it should have at most one.`, id);

  // Settlement facts that cannot both be true.
  for (const s of spendIds.length ? await db.select().from(spends).where(inArray(spends.id, spendIds)) : []) {
    const caps = await movementsFor(s.id);
    const captured = caps.some((x) => x.kind === "capture" || x.kind === "capture_pending");
    if (["PAID", "REFUND_DUE"].includes(s.status) && s.captureId && !captured)
      add("inconsistent_settlement", "error", `${s.id} is ${s.status} with capture ${s.captureId}, but nothing was recorded at ${railId}: the balance this payment credited is not backed by provider money.`, s.id);
    if (s.status === "FAILED" && s.payoutStatus === "SUCCESS")
      add("inconsistent_settlement", "error", `${s.id} is FAILED but its payout reported SUCCESS.`, s.id);
    if (["PAID"].includes(s.status) && s.payoutStatus && CAME_BACK.includes(s.payoutStatus))
      add("inconsistent_settlement", "error", `${s.id} is PAID but its payout is ${s.payoutStatus}.`, s.id);
  }
  for (const t of transferIds.length ? await db.select().from(transfers).where(inArray(transfers.id, transferIds)) : []) {
    if (t.status === "PAID" && t.payoutStatus && CAME_BACK.includes(t.payoutStatus))
      add("inconsistent_settlement", "error", `${t.id} is PAID but its payout is ${t.payoutStatus}.`, t.id);
  }

  // Liquidity: a provider position that went negative is money spent that was never there.
  for (const p of await positionsFor(null)) {
    if (p.availableMinor < 0) add("insufficient_liquidity", "error", `${p.rail} ${p.currency} holds ${formatMoney(p.availableMinor, p.currency)}: payouts went out that were never funded at ${p.rail}.`, p.rail);
    else if (p.pendingMinor < 0) add("inconsistent_settlement", "warning", `${p.rail} ${p.currency} has ${formatMoney(p.pendingMinor, p.currency)} pending: more of a pending capture was settled than was pending.`, p.rail);
  }

  // The arithmetic check: our side of the listed lines must equal the provider's own net position for them.
  oursNet -= charged;
  if (oursNet !== st.position.netMinor) {
    add("position_differs", "error", `For the listed lines, ${railId} shows a net of ${formatMoney(st.position.netMinor, currency)} and our provider position accounts for ${formatMoney(oursNet, currency)} (a difference of ${formatMoney(st.position.netMinor - oursNet, currency)}).`, null);
  }
  if (st.otherActivity > 0) add("other_activity", "info", `${st.otherActivity} statement line(s) are not this gateway's: fees, holds, or another integration on the same account.`, null);

  const ok = findings.every((f) => f.severity !== "error");
  await recordReconciliation({ owner: null, rail: railId, currency, from: new Date(st.from), to: new Date(st.to), available: true, ok, findings });
  return {
    available: true, ok, ...base, findings,
    fees: { chargedMinor: charged, recordedMinor: recorded, absorbedBy: "gateway operator (agents and payees are credited gross)" },
    checks: [
      `missing: ${findings.filter((f) => f.code === "missing_transaction").length}`,
      `duplicates: ${findings.filter((f) => f.code === "duplicate_transaction").length}`,
      `amounts: ${findings.filter((f) => f.code === "amount_differs").length}`,
      `fees: ${formatMoney(charged, currency)} charged on ${findings.filter((f) => f.code === "unexpected_fee").length} line(s)`,
      `reversals: ${findings.filter((f) => f.code === "reversed_transfer").length}`,
      `settlement: ${findings.filter((f) => f.code === "inconsistent_settlement").length}`,
      `liquidity: ${findings.filter((f) => f.code === "insufficient_liquidity").length}`,
    ],
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
    paypal: { mode: railMode(), authorizationId: root.authorizationId, captureId: s.captureId, payoutBatchId: s.payoutBatchId },
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
  const found = await rail().disputes.list().catch(() => null);
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
        await rail().disputes.respond(d.ref, ev.summary);
        sent = true;
        const root = (await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) }))!;
        await trail(root, "gateway", "dispute.evidence_sent", "OK", d.ref.id, { spend: s.id, capture: s.captureId, characters: Math.min(ev.summary.length, 2000) });
        await checkDispute(s.id);
      } catch { /* PayPal would not take it now; the next sweep tries again while PayPal is still waiting */ }
    }
    ours.push({ dispute: d.ref.id, spend: s.id, status: (await db.query.spends.findFirst({ where: eq(spends.id, s.id) }))?.disputeStatus ?? d.status, evidenceSent: sent });
  }
  return { asked: true, disputes: found.length, ours };
}
