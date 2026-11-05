/**
 * Remedy lifecycle.
 *
 *   PROPOSED ──merchant approve──▶ EXECUTING ──PayPal 201 COMPLETED + GET confirms──▶ COMPLETED
 *       │                              │      └─PayPal 201 PENDING──▶ PENDING ──webhook/GET COMPLETED──▶ COMPLETED
 *       │                              └─PayPal 4xx──▶ FAILED          (network/5xx: stays EXECUTING, retried
 *       └─merchant reject──▶ REJECTED                                    with the SAME PayPal-Request-Id)
 *
 * Money moves only on explicit merchant approval. The PROPOSED→EXECUTING
 * transition is a single conditional UPDATE, so two clicks / two tabs cannot
 * both execute; PayPal-Request-Id makes the PayPal side idempotent too.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, disputes, merchants, orders, refunds, remedies, sources, trackers, type Commitment, type Remedy } from "../db/schema";
import { newId, newRequestId } from "../ids";
import { getPayPal, PayPalApiError, paypalMode } from "../paypal/client";
import { buildDisputeRequest, buildRefundRequest, getCapture, getRefund, refundCapture, type RefundFacts } from "../paypal/api";
import { validateProposal, type PolicyContext, type ProposalInput } from "../policy/engine";
import { aiConfigured } from "../ai/client";
import { proposeWithAgent, type AgentProposal } from "../ai/remedy-agent";
import { formatMoney } from "../money";
import { audit } from "./audit";
import { evaluateOrder } from "./ledger";
import { syncCapture, UserFacingError } from "./orders";

const LIVE = ["PROPOSED", "APPROVED", "EXECUTING", "PENDING"] as const;

async function policyContext(c: Commitment, excludeRemedyId?: string): Promise<PolicyContext> {
  const db = getDb();
  const order = (await db.query.orders.findFirst({ where: eq(orders.id, c.orderId) }))!;
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, c.merchantId) }))!;
  const refs = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
  const live = await db.select().from(remedies).where(and(eq(remedies.orderId, order.id), inArray(remedies.state, [...LIVE])));
  const confirmed = refs.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amountMinor, 0);
  // money requested but not yet confirmed COMPLETED: pending PayPal refunds + executing remedies without a refund row
  const pendingRefunds = refs.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.amountMinor, 0);
  const executing = live.filter((r) => r.id !== excludeRemedyId && (r.state === "EXECUTING" || r.state === "APPROVED") && !r.paypalRefundId).reduce((s, r) => s + (r.amountMinor ?? 0), 0);
  return {
    policy: merchant.policy,
    commitment: { type: c.type, state: c.state, enforceable: c.enforceable, evaluation: c.evaluation ?? null },
    capture: { id: order.paypalCaptureId, status: order.captureStatus, amountMinor: order.captureAmountMinor, currency: order.captureCurrency },
    refundedMinor: confirmed,
    inFlightRefundMinor: pendingRefunds + executing,
    otherActiveRemedy: live.some((r) => r.commitmentId === c.id && r.id !== excludeRemedyId),
  };
}

/** Deterministic proposal used when no AI provider is configured (and as a safety net). */
export function rulesProposal(c: Commitment, ctx: PolicyContext): AgentProposal {
  const cur = ctx.capture.currency;
  if (c.type === "PRICE_AS_QUOTED" && c.state === "BROKEN") {
    const amt = Math.max(0, Number(c.evaluation?.outstandingMinor ?? 0) - ctx.inFlightRefundMinor);
    return {
      kind: "PARTIAL_REFUND", amount_minor: amt, currency: cur,
      customer_message: `We quoted you a total of ${formatMoney(Number(c.params.amountMinor), cur ?? "USD")} but charged ${formatMoney(ctx.capture.amountMinor ?? 0, cur ?? "USD")}. We're refunding the ${formatMoney(amt, cur ?? "USD")} difference to your PayPal payment method — sorry about that.`,
      rationale: `Promised total ${formatMoney(Number(c.params.amountMinor), cur ?? "USD")}; PayPal captured ${formatMoney(ctx.capture.amountMinor ?? 0, cur ?? "USD")}. Refund exactly the outstanding difference.`,
      citations: [c.quote, `capture ${ctx.capture.id}`],
    };
  }
  if (c.type === "SHIP_BY") {
    return {
      kind: "ADD_TRACKING_REMINDER", amount_minor: null, currency: null,
      customer_message: c.state === "BROKEN" ? "Your order is running late — we're sorry. We'll share tracking as soon as it ships." : "Just letting you know your order is being prepared and tracking will follow shortly.",
      rationale: `${c.stateReason} Add a shipment tracker to the PayPal order to keep the promise.`,
      citations: [c.quote],
    };
  }
  if (c.type === "REFUND_BY" && c.state === "BROKEN") {
    const remaining = Math.max(0, (ctx.capture.amountMinor ?? 0) - ctx.refundedMinor - ctx.inFlightRefundMinor);
    return { kind: "FULL_REFUND", amount_minor: remaining, currency: cur, customer_message: "We promised your refund within our policy window and missed it. We're issuing it now — sorry for the wait.", rationale: c.stateReason, citations: [c.quote] };
  }
  return { kind: "MESSAGE_ONLY", amount_minor: null, currency: null, customer_message: "We're looking into your order and will update you shortly.", rationale: c.stateReason, citations: [c.quote] };
}

/** Propose (but never execute) a remedy for a broken/at-risk commitment. Idempotent per commitment. */
export async function proposeRemedy(commitmentId: string): Promise<Remedy | null> {
  const db = getDb();
  const c = await db.query.commitments.findFirst({ where: eq(commitments.id, commitmentId) });
  if (!c) throw new Error("commitment not found");
  const existing = await db.query.remedies.findFirst({ where: and(eq(remedies.commitmentId, c.id), inArray(remedies.state, [...LIVE])) });
  if (existing) return existing;
  // never re-propose after the merchant rejected (they can request a new proposal explicitly)
  const rejected = await db.query.remedies.findFirst({ where: and(eq(remedies.commitmentId, c.id), eq(remedies.state, "REJECTED")) });
  if (rejected) return null;
  const ctx = await policyContext(c);
  if (c.type === "PRICE_AS_QUOTED" && ctx.refundedMinor + ctx.inFlightRefundMinor >= Number(c.evaluation?.discrepancyMinor ?? 0)) return null;

  let proposal: AgentProposal | null = null;
  let proposedBy: "ai" | "rules" = "rules";
  let aiNote: string | null = null;
  if (aiConfigured()) {
    try {
      proposal = await proposeWithAgent(agentTools(c));
      proposedBy = "ai";
    } catch (e) {
      aiNote = `AI agent failed: ${String(e).slice(0, 160)}`;
    }
  }
  let toValidate: ProposalInput = proposal ? { kind: proposal.kind, amountMinor: proposal.amount_minor, currency: proposal.currency } : { kind: "MESSAGE_ONLY", amountMinor: null, currency: null };
  let verdict = proposal ? validateProposal(toValidate, ctx) : { ok: false, checks: [] };
  if (!proposal || !verdict.ok) {
    if (proposal) aiNote = `AI proposal (${proposal.kind} ${proposal.amount_minor ?? ""}) failed policy: ${verdict.checks.filter((x) => !x.ok).map((x) => x.check).join(", ")}`;
    proposal = rulesProposal(c, ctx);
    proposedBy = "rules";
    toValidate = { kind: proposal.kind, amountMinor: proposal.amount_minor, currency: proposal.currency };
    verdict = validateProposal(toValidate, ctx);
  }
  try {
    const [row] = await db.insert(remedies).values({
      id: newId("rem"),
      commitmentId: c.id,
      orderId: c.orderId,
      merchantId: c.merchantId,
      kind: proposal.kind,
      amountMinor: proposal.amount_minor,
      currency: proposal.currency,
      customerMessage: proposal.customer_message.slice(0, 600),
      rationale: proposal.rationale.slice(0, 600),
      citations: proposal.citations.slice(0, 6).map((x) => x.slice(0, 300)),
      proposedBy,
      policyChecks: verdict.checks,
      state: "PROPOSED",
      paypalRequestId: newRequestId(),
    }).returning();
    await audit(db, { merchantId: c.merchantId, orderId: c.orderId, actor: proposedBy === "ai" ? "ai" : "system", action: "remedy.proposed", ref: row!.id, outcome: verdict.ok ? "OK" : "REJECTED",
      detail: { kind: proposal.kind, amount: proposal.amount_minor !== null && proposal.currency ? formatMoney(proposal.amount_minor, proposal.currency) : null, policyOk: verdict.ok, failedChecks: verdict.checks.filter((x) => !x.ok).map((x) => x.check), note: aiNote } });
    return row!;
  } catch (e) {
    // unique index: another proposal won the race — return it
    const winner = await db.query.remedies.findFirst({ where: and(eq(remedies.commitmentId, c.id), inArray(remedies.state, [...LIVE])) });
    if (winner) return winner;
    throw e;
  }
}

function agentTools(c: Commitment) {
  const db = getDb();
  return {
    get_case: async () => {
      const ctx = await policyContext(c);
      const src = await db.query.sources.findFirst({ where: eq(sources.id, c.sourceId) });
      const prior = await db.select().from(remedies).where(eq(remedies.commitmentId, c.id));
      return { commitment: { type: c.type, state: c.state, reason: c.stateReason, quote: c.quote, params: c.params, evaluation: c.evaluation, source: src ? { kind: src.kind, title: src.title } : null },
        policy: { allowedRemedies: ctx.policy.allowedRemedies, maxRefundMinor: ctx.policy.maxRefundMinor }, refundedMinor: ctx.refundedMinor, inFlightRefundMinor: ctx.inFlightRefundMinor,
        priorRemedies: prior.map((p) => ({ kind: p.kind, state: p.state, amountMinor: p.amountMinor })) };
    },
    get_capture: async () => {
      const o = (await db.query.orders.findFirst({ where: eq(orders.id, c.orderId) }))!;
      return o.paypalCaptureId ? getCapture(getPayPal(), o.paypalCaptureId) : { error: "no capture" };
    },
    get_refunds: async () => db.select().from(refunds).where(eq(refunds.orderId, c.orderId)),
    get_tracking: async () => db.select().from(trackers).where(eq(trackers.orderId, c.orderId)),
    get_dispute: async () => db.select().from(disputes).where(eq(disputes.orderId, c.orderId)),
  };
}

/** The exact PayPal call an approval would make — shown to the merchant before approving. */
export async function remedyRequestPreview(r: Remedy) {
  if (r.kind === "DISPUTE_OFFER") return r.disputeAction ? buildDisputeRequest(r.disputeAction) : null;
  if (r.kind !== "PARTIAL_REFUND" && r.kind !== "FULL_REFUND") return null;
  const db = getDb();
  const order = (await db.query.orders.findFirst({ where: eq(orders.id, r.orderId) }))!;
  if (!order.paypalCaptureId || r.amountMinor === null || !r.currency) return null;
  return buildRefundRequest({ captureId: order.paypalCaptureId, amountMinor: r.amountMinor, currency: r.currency, keptOrderId: order.id, noteToPayer: r.customerMessage, requestId: r.paypalRequestId });
}

export async function rejectRemedy(remedyId: string, merchantNote: string) {
  const db = getDb();
  const [row] = await db.update(remedies).set({ state: "REJECTED", decidedBy: "merchant", decidedAt: new Date(), errorDetail: merchantNote.slice(0, 300) || null, updatedAt: new Date() })
    .where(and(eq(remedies.id, remedyId), eq(remedies.state, "PROPOSED"))).returning();
  if (!row) throw new UserFacingError("This remedy is no longer awaiting a decision.", 409);
  await audit(db, { merchantId: row.merchantId, orderId: row.orderId, actor: "merchant", action: "remedy.rejected", ref: row.id, outcome: "REJECTED", detail: { note: merchantNote.slice(0, 300) } });
  return row;
}

/**
 * Merchant approval → execution. Re-validates against FRESH data, then claims
 * the remedy atomically (PROPOSED→EXECUTING) before any PayPal call.
 */
export async function approveRemedy(remedyId: string, opts: { customerMessage?: string; acknowledgeLarge?: boolean; mockResponse?: string } = {}): Promise<Remedy> {
  const db = getDb();
  const r = await db.query.remedies.findFirst({ where: eq(remedies.id, remedyId) });
  if (!r) throw new UserFacingError("Remedy not found.", 404);
  if (r.state !== "PROPOSED") throw new UserFacingError(`This remedy is already ${r.state.toLowerCase()}.`, 409);
  if (r.kind === "DISPUTE_OFFER") return approveDisputeRemedy(r, opts.customerMessage);
  const c = (await db.query.commitments.findFirst({ where: eq(commitments.id, r.commitmentId) }))!;
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, r.merchantId) }))!;
  const ctx = await policyContext(c, r.id);
  const verdict = validateProposal({ kind: r.kind, amountMinor: r.amountMinor, currency: r.currency }, ctx);
  if (!verdict.ok) {
    await db.update(remedies).set({ policyChecks: verdict.checks, updatedAt: new Date() }).where(eq(remedies.id, r.id));
    throw new UserFacingError(`Policy check failed: ${verdict.checks.filter((x) => !x.ok).map((x) => x.detail).join("; ")}`, 422);
  }
  const isRefund = r.kind === "PARTIAL_REFUND" || r.kind === "FULL_REFUND";
  if (isRefund && (r.amountMinor ?? 0) > merchant.policy.reviewThresholdMinor && !opts.acknowledgeLarge) {
    throw new UserFacingError("This refund is above your review threshold. Tick the confirmation box to approve it.", 422);
  }
  const message = (opts.customerMessage ?? r.customerMessage).slice(0, 600);
  // Atomic claim: only one request can move PROPOSED → EXECUTING.
  const [claimed] = await db.update(remedies).set({ state: isRefund ? "EXECUTING" : "COMPLETED", customerMessage: message, decidedBy: "merchant", decidedAt: new Date(), executedAt: new Date(), completedAt: isRefund ? null : new Date(), policyChecks: verdict.checks, updatedAt: new Date() })
    .where(and(eq(remedies.id, r.id), eq(remedies.state, "PROPOSED"))).returning();
  if (!claimed) throw new UserFacingError("This remedy was already approved.", 409);
  await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "merchant", action: "remedy.approved", ref: r.id, outcome: "OK",
    detail: { kind: r.kind, amount: r.amountMinor !== null && r.currency ? formatMoney(r.amountMinor, r.currency) : null, messageEdited: message !== r.customerMessage } });
  if (!isRefund) return claimed;
  return executeRefund(claimed, opts.mockResponse);
}

async function approveDisputeRemedy(r: Remedy, editedMessage?: string): Promise<Remedy> {
  const db = getDb();
  const { disputeContext, validateDisputeAction, executeDisputeRemedy } = await import("./disputes");
  if (!r.disputeAction) throw new UserFacingError("Dispute response is missing its action.", 422);
  const action = { ...r.disputeAction };
  if (editedMessage) {
    if (action.type === "SEND_MESSAGE") action.message = editedMessage.slice(0, 2000);
    else action.note = editedMessage.slice(0, 2000);
  }
  const ctx = await disputeContext(r.orderId, action.disputeId);
  const otherLive = ctx.rems.some((x) => x.id !== r.id && x.kind === "DISPUTE_OFFER" && x.disputeAction?.disputeId === action.disputeId && ["APPROVED", "EXECUTING", "PENDING"].includes(x.state));
  const verdict = validateDisputeAction(action, ctx, otherLive);
  if (!verdict.ok) {
    await db.update(remedies).set({ policyChecks: verdict.checks, updatedAt: new Date() }).where(eq(remedies.id, r.id));
    throw new UserFacingError(`Policy check failed: ${verdict.checks.filter((x) => !x.ok).map((x) => x.detail).join("; ")}`, 422);
  }
  const [claimed] = await db.update(remedies).set({ state: "EXECUTING", disputeAction: action, customerMessage: editedMessage?.slice(0, 600) ?? r.customerMessage, decidedBy: "merchant", decidedAt: new Date(), executedAt: new Date(), policyChecks: verdict.checks, updatedAt: new Date() })
    .where(and(eq(remedies.id, r.id), eq(remedies.state, "PROPOSED"))).returning();
  if (!claimed) throw new UserFacingError("This dispute response was already approved.", 409);
  await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "merchant", action: "dispute.response_approved", ref: r.id, outcome: "OK", detail: { action: action.type, disputeId: action.disputeId } });
  return executeDisputeRemedy(claimed);
}

/** Calls PayPal. Safe to call again for an EXECUTING remedy: the same PayPal-Request-Id is reused. */
export async function executeRefund(r: Remedy, mockResponse?: string): Promise<Remedy> {
  const db = getDb();
  const order = (await db.query.orders.findFirst({ where: eq(orders.id, r.orderId) }))!;
  if (!order.paypalCaptureId || r.amountMinor === null || !r.currency) throw new Error("refund remedy missing capture/amount");
  const pp = getPayPal();
  let facts: RefundFacts;
  try {
    facts = await refundCapture(pp, { captureId: order.paypalCaptureId, amountMinor: r.amountMinor, currency: r.currency, keptOrderId: order.id, noteToPayer: r.customerMessage, requestId: r.paypalRequestId, mockResponse: paypalMode() === "live" ? undefined : mockResponse });
  } catch (e) {
    const pe = e instanceof PayPalApiError ? e : null;
    if (pe && !pe.retryable) {
      const [failed] = await db.update(remedies).set({ state: "FAILED", errorCode: pe.issue ?? pe.paypalName, errorDetail: `${pe.message}${pe.debugId ? ` (debug_id ${pe.debugId})` : ""}`.slice(0, 500), updatedAt: new Date() }).where(eq(remedies.id, r.id)).returning();
      await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "paypal", action: "paypal.refund.failed", ref: r.id, outcome: "FAILED", detail: { issue: pe.issue, name: pe.paypalName, debugId: pe.debugId } });
      return failed!;
    }
    // Unknown outcome (network / 5xx): leave EXECUTING; reconciliation retries with the same request id.
    await db.update(remedies).set({ errorCode: "UNKNOWN_OUTCOME", errorDetail: String(e).slice(0, 500), updatedAt: new Date() }).where(eq(remedies.id, r.id));
    await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "paypal", action: "paypal.refund.unknown_outcome", ref: r.id, outcome: "PENDING", detail: { error: String(e).slice(0, 300), willRetryWithRequestId: r.paypalRequestId } });
    return (await db.query.remedies.findFirst({ where: eq(remedies.id, r.id) }))!;
  }
  await db.update(remedies).set({ paypalRefundId: facts.refundId, paypalRefundStatus: facts.status, errorCode: null, errorDetail: null, updatedAt: new Date() }).where(eq(remedies.id, r.id));
  await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "paypal", action: "paypal.refund.requested", ref: facts.refundId, outcome: facts.status === "COMPLETED" ? "OK" : facts.status === "PENDING" ? "PENDING" : "FAILED",
    detail: { reportedStatus: facts.status, statusReason: facts.statusReason, requestId: r.paypalRequestId } });
  // Never trust the POST alone: confirm with an authoritative GET.
  const confirmed = await getRefund(pp, facts.refundId);
  await syncRefund(confirmed, order.id, "refund_call");
  return (await db.query.remedies.findFirst({ where: eq(remedies.id, r.id) }))!;
}

/**
 * Apply authoritative refund facts (from GET) to the order and any remedy that
 * issued it. Called from the refund call, webhooks and reconciliation.
 */
export async function syncRefund(f: RefundFacts, orderIdHint: string | null, via: string) {
  const db = getDb();
  let order = f.customId ? await db.query.orders.findFirst({ where: eq(orders.id, f.customId) }) : undefined;
  if (!order && f.captureId) order = await db.query.orders.findFirst({ where: eq(orders.paypalCaptureId, f.captureId) });
  if (!order && orderIdHint) order = await db.query.orders.findFirst({ where: eq(orders.id, orderIdHint) });
  if (!order) throw new Error(`refund ${f.refundId} is not bound to a Kept order`);
  if (f.captureId && order.paypalCaptureId && f.captureId !== order.paypalCaptureId) throw new Error("refund belongs to a different capture");
  if (f.amountMinor === null || !f.currency) throw new Error("refund has no amount");
  const remedy = await db.query.remedies.findFirst({ where: eq(remedies.paypalRefundId, f.refundId) });
  const prev = await db.query.refunds.findFirst({ where: eq(refunds.paypalRefundId, f.refundId) });

  await db.transaction(async (tx) => {
    await tx.insert(refunds).values({ paypalRefundId: f.refundId, orderId: order!.id, remedyId: remedy?.id ?? null, amountMinor: f.amountMinor!, currency: f.currency!, status: f.status, statusReason: f.statusReason, paypalCreatedAt: f.createdAt, verifiedAt: new Date() })
      .onConflictDoUpdate({ target: refunds.paypalRefundId, set: { status: f.status, statusReason: f.statusReason, verifiedAt: new Date(), remedyId: remedy?.id ?? sql`${refunds.remedyId}` } });
    const total = await tx.select({ s: sql<number>`coalesce(sum(${refunds.amountMinor}),0)::int` }).from(refunds).where(and(eq(refunds.orderId, order!.id), eq(refunds.status, "COMPLETED")));
    await tx.update(orders).set({ refundedMinor: Number(total[0]?.s ?? 0), updatedAt: new Date() }).where(eq(orders.id, order!.id));
    if (remedy) {
      const state = f.status === "COMPLETED" ? "COMPLETED" : f.status === "PENDING" ? "PENDING" : "FAILED";
      if (remedy.state !== state && remedy.state !== "REJECTED") {
        await tx.update(remedies).set({ state, paypalRefundStatus: f.status, completedAt: f.status === "COMPLETED" ? new Date() : null, errorCode: state === "FAILED" ? `REFUND_${f.status}` : null, updatedAt: new Date() }).where(eq(remedies.id, remedy.id));
      }
    }
  });
  if (!prev || prev.status !== f.status) {
    await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "paypal", action: "paypal.refund.verified", ref: f.refundId, outcome: f.status === "COMPLETED" ? "OK" : f.status === "PENDING" ? "PENDING" : "FAILED",
      detail: { via, status: f.status, amount: formatMoney(f.amountMinor, f.currency), statusReason: f.statusReason, issuedByKept: Boolean(remedy) } });
  }
  // a refund changes the capture's status (PARTIALLY_REFUNDED); refresh it, then re-evaluate
  if (order.paypalCaptureId) await syncCapture(await getCapture(getPayPal(), order.paypalCaptureId), via);
  await evaluateOrder(order.id);
}
