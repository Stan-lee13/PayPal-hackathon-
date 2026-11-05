/**
 * Disputes answered from the ledger. When PayPal reports a dispute, Kept already holds the evidence:
 * what was promised (verbatim, anchored), and what PayPal recorded (capture,
 * refunds, trackers). It proposes ONE honest response — defend with evidence
 * when the promise was kept, offer the refund when it was broken — and executes
 * it through the Disputes API only after merchant approval.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, disputes, merchants, orders, refunds, remedies, trackers, type DisputeAction, type Remedy } from "../db/schema";
import { newId, newRequestId } from "../ids";
import { getPayPal, PayPalApiError } from "../paypal/client";
import { executeDisputeAction, getDispute } from "../paypal/api";
import { formatMoney } from "../money";
import { audit } from "./audit";

const LIVE = ["PROPOSED", "APPROVED", "EXECUTING", "PENDING"] as const;

export type DisputeCheck = { check: string; ok: boolean; detail: string };

export async function disputeContext(orderId: string, disputeId: string) {
  const db = getDb();
  const [order, dispute, cms, trks, refs, rems] = await Promise.all([
    db.query.orders.findFirst({ where: eq(orders.id, orderId) }),
    db.query.disputes.findFirst({ where: eq(disputes.paypalDisputeId, disputeId) }),
    db.select().from(commitments).where(eq(commitments.orderId, orderId)),
    db.select().from(trackers).where(eq(trackers.orderId, orderId)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)),
    db.select().from(remedies).where(eq(remedies.orderId, orderId)),
  ]);
  if (!order || !dispute) throw new Error("order or dispute not found");
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }))!;
  const refunded = refs.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amountMinor, 0);
  const inFlight = refs.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.amountMinor, 0)
    + rems.filter((r) => (r.state === "EXECUTING" || r.state === "APPROVED") && !r.paypalRefundId && r.kind !== "DISPUTE_OFFER").reduce((s, r) => s + (r.amountMinor ?? 0), 0);
  const remaining = Math.max(0, (order.captureAmountMinor ?? 0) - refunded - inFlight);
  const { orderChain } = await import("./evidence");
  const chain = (await orderChain(order.merchantId, order.id)).verdict;
  const fingerprint = chain.ok && chain.length > 0 ? chain.head : null;
  return { order, dispute, cms, trks, refs, rems, merchant, refunded, remaining, fingerprint };
}

/** Deterministic choice of response + the factual evidence note. */
export function chooseResponse(ctx: Awaited<ReturnType<typeof disputeContext>>): { action: DisputeAction; commitmentId: string; rationale: string; citations: string[] } | null {
  const { order, dispute, cms, trks, refs, remaining } = ctx;
  const cur = order.captureCurrency ?? order.currency;
  const ship = cms.find((c) => c.type === "SHIP_BY");
  const price = cms.find((c) => c.type === "PRICE_AS_QUOTED");
  const tracker = [...trks].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())[0];
  const completed = refs.filter((r) => r.status === "COMPLETED");
  const anchor = (price ?? ship ?? cms[0])?.id;
  if (!anchor) return null;
  // Evidence is truthful and scoped to the dispute's subject: a "not received" claim gets the
  // shipping facts; an amount claim gets the price facts. Every line comes from PayPal records or a verbatim promise.
  const notReceived = dispute.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
  const lines: string[] = [];
  if (price && !notReceived) lines.push(`Promised in writing: "${price.quote}" — status ${price.state}.`);
  if (ship && (notReceived || !price)) lines.push(`Shipping promise: "${ship.quote}" — status ${ship.state}.`);
  if (order.captureAmountMinor !== null) lines.push(`PayPal capture ${order.paypalCaptureId}: ${formatMoney(order.captureAmountMinor, cur)}.`);
  for (const r of completed) lines.push(`Refund ${r.paypalRefundId} COMPLETED: ${formatMoney(r.amountMinor, cur)}.`);
  if (tracker && notReceived) lines.push(`Tracking ${tracker.carrier} ${tracker.trackingNumber} added to the PayPal order at ${tracker.recordedAt.toISOString().slice(0, 16).replace("T", " ")} UTC (shows shipment, not delivery).`);
  // Anchors Kept's record at PayPal: a later edit to the audit trail would no longer contain this hash.
  if (ctx.fingerprint) lines.push(`Kept evidence fingerprint (SHA-256 audit-chain head): ${ctx.fingerprint}.`);
  const evidence = lines.join(" ");

  if (dispute.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
    if (tracker) {
      return { commitmentId: ship?.id ?? anchor, action: { type: "PROVIDE_EVIDENCE", disputeId: dispute.paypalDisputeId, trackingNumber: tracker.trackingNumber, carrier: tracker.carrier, note: `The order was shipped as promised. ${evidence}` },
        rationale: "The shipping promise is backed by a tracker PayPal recorded before the deadline, so Kept recommends submitting proof of fulfilment.", citations: [ship?.quote ?? "", `tracker ${tracker.trackingNumber}`].filter(Boolean) };
    }
    if (dispute.stage === "INQUIRY" && remaining > 0) {
      return { commitmentId: ship?.id ?? anchor, action: { type: "MAKE_OFFER", disputeId: dispute.paypalDisputeId, amountMinor: remaining, currency: cur, note: `We could not show proof of shipment, so we are offering a full refund. ${evidence}` },
        rationale: "No PayPal-recorded tracker exists, so Kept cannot defend this honestly; it recommends offering the refund in the inquiry stage.", citations: [ship?.quote ?? ""].filter(Boolean) };
    }
  }
  const outstanding = Number(price?.evaluation?.outstandingMinor ?? 0);
  if (price && price.state === "BROKEN" && outstanding > 0 && dispute.stage === "INQUIRY") {
    const amt = Math.min(outstanding, remaining);
    return { commitmentId: price.id, action: { type: "MAKE_OFFER", disputeId: dispute.paypalDisputeId, amountMinor: amt, currency: cur, note: `You were quoted ${formatMoney(Number(price.params.amountMinor), cur)} and charged ${formatMoney(order.captureAmountMinor ?? 0, cur)}. We are offering the ${formatMoney(amt, cur)} difference. ${evidence}` },
      rationale: "The price promise was broken and not yet made good; Kept recommends offering exactly the deterministic overcharge.", citations: [price.quote] };
  }
  return { commitmentId: anchor, action: { type: "SEND_MESSAGE", disputeId: dispute.paypalDisputeId, message: `Here is what was promised and what PayPal recorded for this order. ${evidence}` },
    rationale: completed.length ? "The promise has already been made good with a PayPal-confirmed refund; Kept recommends sharing that evidence." : "Kept recommends sharing the factual record with the buyer.", citations: cms.map((c) => c.quote).slice(0, 3) };
}

export function validateDisputeAction(a: DisputeAction, ctx: Awaited<ReturnType<typeof disputeContext>>, otherLive: boolean): { ok: boolean; checks: DisputeCheck[] } {
  const checks: DisputeCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });
  add("remedy_type_allowed", ctx.merchant.policy.allowedRemedies.includes("DISPUTE_OFFER"), "DISPUTE_OFFER in merchant policy");
  add("dispute_open", ctx.dispute.status !== "RESOLVED", `dispute status ${ctx.dispute.status}`);
  add("no_other_dispute_response_live", !otherLive, otherLive ? "another response is in progress" : "none in progress");
  if (a.type === "MAKE_OFFER") {
    const cur = ctx.order.captureCurrency;
    add("offer_in_inquiry_stage", ctx.dispute.stage === "INQUIRY", `stage ${ctx.dispute.stage}`);
    add("amount_is_integer_minor_units", Number.isSafeInteger(a.amountMinor) && a.amountMinor > 0, `${a.amountMinor}`);
    add("currency_matches_capture", a.currency === cur, `${a.currency} vs ${cur}`);
    add("within_remaining_refundable", a.amountMinor <= ctx.remaining, `remaining ${cur ? formatMoney(ctx.remaining, cur) : ctx.remaining}`);
    add("within_policy_cap", a.amountMinor <= ctx.merchant.policy.maxRefundMinor, `cap ${cur ? formatMoney(ctx.merchant.policy.maxRefundMinor, cur) : ""}`);
  }
  if (a.type === "PROVIDE_EVIDENCE") {
    add("tracker_recorded_at_paypal", ctx.trks.some((t) => t.trackingNumber === a.trackingNumber), `tracker ${a.trackingNumber}`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** Called when a dispute is verified. Proposes at most one live response per dispute. */
export async function proposeDisputeResponse(orderId: string, disputeId: string): Promise<Remedy | null> {
  const db = getDb();
  const ctx = await disputeContext(orderId, disputeId);
  if (ctx.dispute.status === "RESOLVED") return null;
  const forDispute = ctx.rems.filter((r) => r.kind === "DISPUTE_OFFER" && r.disputeAction?.disputeId === disputeId);
  const live = forDispute.find((r) => (LIVE as readonly string[]).includes(r.state));
  if (live) return live;
  if (forDispute.some((r) => r.state === "REJECTED")) return null;
  // Already answered: PayPal's follow-up CUSTOMER.DISPUTE.UPDATED must not trigger a second response.
  // Propose again only when PayPal is explicitly asking the seller for something new.
  if (forDispute.some((r) => r.state === "COMPLETED") && ctx.dispute.status !== "WAITING_FOR_SELLER_RESPONSE") return null;
  const choice = chooseResponse(ctx);
  if (!choice) return null;
  // One live remedy per commitment: a still-PROPOSED remedy is superseded by the dispute response.
  const blocking = ctx.rems.find((r) => r.commitmentId === choice.commitmentId && (LIVE as readonly string[]).includes(r.state));
  if (blocking && blocking.state !== "PROPOSED") {
    await audit(db, { merchantId: ctx.order.merchantId, orderId, actor: "system", action: "dispute.response_deferred", ref: disputeId, outcome: "INFO", detail: { reason: `remedy ${blocking.id} is ${blocking.state}` } });
    return null;
  }
  const verdict = validateDisputeAction(choice.action, ctx, false);
  const row = await db.transaction(async (tx) => {
    if (blocking) await tx.update(remedies).set({ state: "SUPERSEDED", updatedAt: new Date() }).where(and(eq(remedies.id, blocking.id), eq(remedies.state, "PROPOSED")));
    const [r] = await tx.insert(remedies).values({
      id: newId("rem"), commitmentId: choice.commitmentId, orderId, merchantId: ctx.order.merchantId, kind: "DISPUTE_OFFER",
      amountMinor: choice.action.type === "MAKE_OFFER" ? choice.action.amountMinor : null,
      currency: choice.action.type === "MAKE_OFFER" ? choice.action.currency : null,
      customerMessage: (choice.action.type === "SEND_MESSAGE" ? choice.action.message : choice.action.note).slice(0, 600),
      rationale: choice.rationale, citations: choice.citations.slice(0, 6), proposedBy: "rules", policyChecks: verdict.checks,
      disputeAction: choice.action, state: "PROPOSED", paypalRequestId: newRequestId(),
    }).returning();
    await audit(tx, { merchantId: ctx.order.merchantId, orderId, actor: "system", action: "dispute.response_proposed", ref: r!.id, outcome: verdict.ok ? "OK" : "REJECTED",
      detail: { disputeId, reason: ctx.dispute.reason, action: choice.action.type, supersededRemedy: blocking?.id ?? null } });
    return r!;
  });
  return row;
}

/** Execute an approved DISPUTE_OFFER through the Disputes API, then verify with GET. */
export async function executeDisputeRemedy(r: Remedy): Promise<Remedy> {
  const db = getDb();
  if (!r.disputeAction) throw new Error("dispute remedy without action");
  const pp = getPayPal();
  try {
    await executeDisputeAction(pp, r.disputeAction, r.paypalRequestId);
  } catch (e) {
    const pe = e instanceof PayPalApiError ? e : null;
    const [failed] = await db.update(remedies).set({ state: pe && !pe.retryable ? "FAILED" : "EXECUTING", errorCode: pe?.issue ?? pe?.paypalName ?? "UNKNOWN_OUTCOME", errorDetail: String(e).slice(0, 500), updatedAt: new Date() }).where(eq(remedies.id, r.id)).returning();
    await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "paypal", action: "paypal.dispute_action.failed", ref: r.disputeAction.disputeId, outcome: "FAILED", detail: { action: r.disputeAction.type, issue: pe?.issue } });
    return failed!;
  }
  const d = await getDispute(pp, r.disputeAction.disputeId);
  await db.update(disputes).set({ status: d.status, stage: d.stage, verifiedAt: new Date() }).where(eq(disputes.paypalDisputeId, d.disputeId));
  const [done] = await db.update(remedies).set({ state: "COMPLETED", paypalRefundStatus: d.status, completedAt: new Date(), updatedAt: new Date() }).where(eq(remedies.id, r.id)).returning();
  await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "paypal", action: "paypal.dispute_action.accepted", ref: d.disputeId, outcome: "OK",
    detail: { action: r.disputeAction.type, disputeStatus: d.status, stage: d.stage, note: r.disputeAction.type === "MAKE_OFFER" ? "Money moves only if the buyer accepts the offer; PayPal will then report the refund." : undefined } });
  return done!;
}

export async function liveDisputeResponses(orderId: string) {
  return getDb().select().from(remedies).where(and(eq(remedies.orderId, orderId), eq(remedies.kind, "DISPUTE_OFFER"), inArray(remedies.state, [...LIVE])));
}
