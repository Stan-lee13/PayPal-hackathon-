/**
 * Deterministic promise evaluator. Pure function: (commitment, PayPal facts, now) → state.
 * No I/O, no AI, integer money only. Every state carries a human-readable reason.
 *
 *   PRICE_AS_QUOTED  evidence: authoritative PayPal capture amount/currency/status
 *   SHIP_BY          evidence: PayPal shipment tracker recorded before the deadline
 *                    (a tracker proves the merchant reported shipping — NOT delivery)
 *   REFUND_BY        evidence: PayPal refund COMPLETED before the deadline
 */
import type { CommitmentState, CommitmentType } from "../db/schema";
import { formatMoney } from "../money";

export type CaptureEvidence = {
  status: string; // COMPLETED | PENDING | DECLINED | FAILED | PARTIALLY_REFUNDED | REFUNDED
  amountMinor: number;
  currency: string;
  capturedAt: Date;
  verified: boolean; // re-fetched from PayPal, not just read from a webhook body
};

export type RefundEvidence = { refundId: string; amountMinor: number; currency: string; status: string; createdAt: Date | null; verifiedAt: Date };
export type TrackerEvidence = { trackingNumber: string; recordedAt: Date };

export type EvalInput = {
  type: CommitmentType;
  params: Record<string, unknown>;
  enforceable: boolean;
  currentState: CommitmentState;
  capture: CaptureEvidence | null;
  refunds: RefundEvidence[];
  trackers: TrackerEvidence[];
  now: Date;
  policy: { shipAtRiskHours: number; refundAtRiskDays: number };
  /** For mandates: what the merchant explicitly promised (from its own enforceable commitments). */
  related?: { merchantQuotedMinor: number | null; merchantShipHours: number | null };
};

export type EvalResult = {
  state: CommitmentState;
  reason: string;
  dueAt: Date | null;
  evaluation: Record<string, unknown>;
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function evaluate(input: EvalInput): EvalResult {
  // Merchant decisions and non-enforceable promises are never auto-changed.
  if (input.currentState === "WAIVED") return keep(input, "Waived by the merchant.");
  if (!input.enforceable) {
    const st = input.currentState === "NEEDS_CONFIRMATION" ? "NEEDS_CONFIRMATION" : "UNVERIFIABLE";
    return { state: st, reason: st === "UNVERIFIABLE" ? "Not checkable against PayPal records." : "Waiting for the merchant to confirm the exact promise.", dueAt: null, evaluation: {} };
  }
  switch (input.type) {
    case "PRICE_AS_QUOTED": return evalPrice(input);
    case "SHIP_BY": return evalShip(input);
    case "REFUND_BY": return evalRefund(input);
    case "MANDATE_MAX_TOTAL": return evalMandateTotal(input);
    case "MANDATE_SHIP_WITHIN": return evalShip({ ...input, params: { withinHours: input.params.withinHours } }, "mandate");
    default: return { state: "UNVERIFIABLE", reason: "No evaluation rule for this promise type.", dueAt: null, evaluation: {} };
  }
}

function keep(input: EvalInput, reason: string): EvalResult {
  return { state: input.currentState, reason, dueAt: null, evaluation: {} };
}

export function completedRefundTotal(refunds: RefundEvidence[], currency: string): number {
  return refunds.filter((r) => r.status === "COMPLETED" && r.currency === currency).reduce((s, r) => s + r.amountMinor, 0);
}

function evalPrice(input: EvalInput): EvalResult {
  const promised = Number(input.params.amountMinor);
  const currency = String(input.params.currency);
  if (!Number.isSafeInteger(promised)) throw new Error("PRICE_AS_QUOTED without integer amountMinor");
  const cap = input.capture;
  if (!cap || !cap.verified) return { state: "PENDING", reason: "Waiting for a verified PayPal capture.", dueAt: null, evaluation: { promisedMinor: promised } };
  if (cap.status === "PENDING") return { state: "PENDING", reason: "PayPal reports the capture as PENDING — the money is not final yet.", dueAt: null, evaluation: { promisedMinor: promised } };
  if (cap.status === "DECLINED" || cap.status === "FAILED") return { state: "PENDING", reason: `PayPal reports the capture as ${cap.status}; no money was taken.`, dueAt: null, evaluation: { promisedMinor: promised } };
  if (cap.currency !== currency) {
    return { state: "NEEDS_CONFIRMATION", reason: `Promise was in ${currency} but PayPal captured ${cap.currency}; Kept will not convert currencies.`, dueAt: null, evaluation: { promisedMinor: promised, capturedMinor: cap.amountMinor, capturedCurrency: cap.currency } };
  }
  const discrepancy = cap.amountMinor - promised;
  const refunded = completedRefundTotal(input.refunds, currency);
  const evaluation = { promisedMinor: promised, capturedMinor: cap.amountMinor, currency, discrepancyMinor: Math.max(0, discrepancy), refundedMinor: refunded, outstandingMinor: Math.max(0, discrepancy - refunded) };
  if (discrepancy <= 0) {
    return { state: "KEPT", reason: discrepancy === 0 ? `PayPal captured exactly the promised ${formatMoney(promised, currency)}.` : `PayPal captured ${formatMoney(cap.amountMinor, currency)}, less than the promised ${formatMoney(promised, currency)}.`, dueAt: null, evaluation };
  }
  // Overcharged. The promise was broken; it may since have been made good by a confirmed refund.
  const madeGood = refunded >= discrepancy;
  return {
    state: "BROKEN",
    reason: madeGood
      ? `Overcharged by ${formatMoney(discrepancy, currency)}; PayPal has confirmed refunds of ${formatMoney(refunded, currency)} — made good.`
      : `Promised ${formatMoney(promised, currency)} but PayPal captured ${formatMoney(cap.amountMinor, currency)}: overcharged by ${formatMoney(discrepancy, currency)}${refunded ? ` (${formatMoney(refunded, currency)} refunded so far)` : ""}.`,
    dueAt: null,
    evaluation: { ...evaluation, madeGood },
  };
}

function evalMandateTotal(input: EvalInput): EvalResult {
  const max = Number(input.params.maxMinor);
  const currency = String(input.params.currency);
  const inclusive = input.params.inclusive !== false;
  if (!Number.isSafeInteger(max)) throw new Error("MANDATE_MAX_TOTAL without integer maxMinor");
  const cap = input.capture;
  if (!cap || !cap.verified || cap.status === "PENDING" || cap.status === "DECLINED" || cap.status === "FAILED") {
    return { state: "PENDING", reason: "Waiting for a verified, final PayPal capture.", dueAt: null, evaluation: { maxMinor: max } };
  }
  if (cap.currency !== currency) return { state: "NEEDS_CONFIRMATION", reason: `Limit is in ${currency} but PayPal captured ${cap.currency}.`, dueAt: null, evaluation: { maxMinor: max } };
  const within = (v: number) => (inclusive ? v <= max : v < max);
  const refunded = completedRefundTotal(input.refunds, currency);
  const net = cap.amountMinor - refunded;
  const quoted = input.related?.merchantQuotedMinor ?? null;
  // Who is accountable if the limit was exceeded: the agent (accepted an over-limit quote) or the merchant (quote was within, charge was not).
  const attribution = within(cap.amountMinor) ? "NONE" : quoted === null ? "UNKNOWN" : within(quoted) ? "MERCHANT" : "AGENT";
  const evaluation = { maxMinor: max, inclusive, capturedMinor: cap.amountMinor, refundedMinor: refunded, netMinor: net, merchantQuotedMinor: quoted, attribution };
  const lim = `${inclusive ? "at most" : "under"} ${formatMoney(max, currency)}`;
  if (within(cap.amountMinor)) return { state: "KEPT", reason: `Your agent's purchase (${formatMoney(cap.amountMinor, currency)}) respected your limit of ${lim}.`, dueAt: null, evaluation };
  const blame = attribution === "MERCHANT" ? `Your agent was quoted ${formatMoney(quoted!, currency)} — within your limit — so the merchant's charge broke it, not your agent.`
    : attribution === "AGENT" ? `Your agent accepted a quote of ${formatMoney(quoted!, currency)}, which was already over your limit.` : "";
  return {
    state: "BROKEN",
    reason: within(net)
      ? `PayPal captured ${formatMoney(cap.amountMinor, currency)}, over your limit of ${lim}; after confirmed refunds you paid ${formatMoney(net, currency)} — back within your limit. ${blame}`.trim()
      : `PayPal captured ${formatMoney(cap.amountMinor, currency)}, over your limit of ${lim}. ${blame}`.trim(),
    dueAt: null,
    evaluation: { ...evaluation, madeGood: within(net) },
  };
}

function shipDeadline(input: EvalInput): Date | null {
  if (typeof input.params.byDate === "string") return new Date(input.params.byDate);
  const hours = Number(input.params.withinHours);
  if (!input.capture || !Number.isFinite(hours)) return null;
  return new Date(input.capture.capturedAt.getTime() + hours * HOUR);
}

function evalShip(input: EvalInput, who: "merchant" | "mandate" = "merchant"): EvalResult {
  const cap = input.capture;
  if (!cap || !cap.verified || (cap.status !== "COMPLETED" && cap.status !== "PARTIALLY_REFUNDED")) {
    if (cap && (cap.status === "REFUNDED")) return { state: "WAIVED", reason: "Order fully refunded; shipping no longer due.", dueAt: null, evaluation: {} };
    return { state: "PENDING", reason: "Clock starts when PayPal confirms the payment.", dueAt: null, evaluation: {} };
  }
  const due = shipDeadline(input);
  if (!due) return { state: "NEEDS_CONFIRMATION", reason: "Shipping deadline could not be computed.", dueAt: null, evaluation: {} };
  const first = [...input.trackers].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())[0];
  const evaluation: Record<string, unknown> = { dueAt: due.toISOString() };
  if (first) {
    evaluation.trackerRecordedAt = first.recordedAt.toISOString();
    evaluation.trackingNumber = first.trackingNumber;
    if (first.recordedAt.getTime() <= due.getTime()) {
      return { state: "KEPT", reason: `Tracking ${first.trackingNumber} was added to the PayPal order before the deadline (shows the parcel was reported shipped, not that it was delivered).`, dueAt: due, evaluation };
    }
    return { state: "BROKEN", reason: `Tracking was added ${hoursBetween(due, first.recordedAt)} after the shipping deadline.`, dueAt: due, evaluation };
  }
  if (who === "mandate") {
    const mh = input.related?.merchantShipHours ?? null;
    evaluation.attribution = mh === null ? "UNKNOWN" : mh <= Number(input.params.withinHours) ? "MERCHANT" : "AGENT";
  }
  const left = due.getTime() - input.now.getTime();
  if (left < 0) return { state: "BROKEN", reason: `No shipment tracking on the PayPal order and the deadline passed ${hoursBetween(due, input.now)} ago.`, dueAt: due, evaluation };
  if (left <= input.policy.shipAtRiskHours * HOUR) return { state: "AT_RISK", reason: `No tracking yet; ${hoursBetween(input.now, due)} left before the shipping deadline.`, dueAt: due, evaluation };
  return { state: "PENDING", reason: `Ship by ${fmt(due)}; ${hoursBetween(input.now, due)} left.`, dueAt: due, evaluation };
}

function evalRefund(input: EvalInput): EvalResult {
  const days = Number(input.params.withinDays);
  const triggeredAt = typeof input.params.triggeredAt === "string" ? new Date(input.params.triggeredAt) : null;
  if (!triggeredAt) return { state: "PENDING", reason: `Not started — the ${String(input.params.trigger ?? "trigger").toLowerCase().replace(/_/g, " ")} has not been recorded.`, dueAt: null, evaluation: {} };
  const due = new Date(triggeredAt.getTime() + days * DAY);
  const relevant = input.refunds.filter((r) => (r.createdAt ?? r.verifiedAt).getTime() >= triggeredAt.getTime());
  const completed = relevant.filter((r) => r.status === "COMPLETED").sort((a, b) => (a.createdAt ?? a.verifiedAt).getTime() - (b.createdAt ?? b.verifiedAt).getTime())[0];
  const evaluation: Record<string, unknown> = { dueAt: due.toISOString(), triggeredAt: triggeredAt.toISOString() };
  if (completed) {
    const at = completed.createdAt ?? completed.verifiedAt;
    evaluation.refundId = completed.refundId;
    return at.getTime() <= due.getTime()
      ? { state: "KEPT", reason: `PayPal confirms refund ${completed.refundId} completed within the promised window.`, dueAt: due, evaluation }
      : { state: "BROKEN", reason: `Refund completed ${hoursBetween(due, at)} after the promised deadline.`, dueAt: due, evaluation };
  }
  const pending = relevant.find((r) => r.status === "PENDING");
  const left = due.getTime() - input.now.getTime();
  if (left < 0) return { state: "BROKEN", reason: pending ? "A refund is still PENDING at PayPal and the deadline has passed." : "No completed refund and the promised refund deadline has passed.", dueAt: due, evaluation };
  if (pending) return { state: "AT_RISK", reason: "Refund issued but PayPal still reports it as PENDING.", dueAt: due, evaluation };
  if (left <= input.policy.refundAtRiskDays * DAY) return { state: "AT_RISK", reason: `No refund yet; ${hoursBetween(input.now, due)} left.`, dueAt: due, evaluation };
  return { state: "PENDING", reason: `Refund due by ${fmt(due)}.`, dueAt: due, evaluation };
}

function fmt(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function hoursBetween(a: Date, b: Date): string {
  const h = Math.abs(b.getTime() - a.getTime()) / HOUR;
  return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)}h`;
}
