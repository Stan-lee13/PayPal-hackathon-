/**
 * Deterministic policy engine. Validates a remedy PROPOSAL (from the AI agent or
 * the rules fallback) independently of whoever proposed it. Only proposals that
 * pass every check can be shown with an "Approve" button; execution re-runs the
 * same checks against fresh data inside the database transaction.
 */
import type { CommitmentState, CommitmentType, MerchantPolicy, RemedyKind } from "../db/schema";
import { formatMoney } from "../money";

export type PolicyCheck = { check: string; ok: boolean; detail: string };

export type ProposalInput = {
  kind: RemedyKind;
  amountMinor: number | null;
  currency: string | null;
};

export type PolicyContext = {
  policy: MerchantPolicy;
  commitment: { type: CommitmentType; state: CommitmentState; enforceable: boolean; evaluation: Record<string, unknown> | null };
  capture: { id: string | null; status: string | null; amountMinor: number | null; currency: string | null };
  /** COMPLETED refunds confirmed by PayPal. */
  refundedMinor: number;
  /** Refunds Kept has requested that PayPal has not yet confirmed (PENDING / in flight). */
  inFlightRefundMinor: number;
  /** Another remedy for this commitment is already live (proposed/approved/executing/pending). */
  otherActiveRemedy: boolean;
};

const REFUND_KINDS: RemedyKind[] = ["PARTIAL_REFUND", "FULL_REFUND"];

export function remainingRefundable(ctx: PolicyContext): number {
  if (ctx.capture.amountMinor === null) return 0;
  return Math.max(0, ctx.capture.amountMinor - ctx.refundedMinor - ctx.inFlightRefundMinor);
}

/** Outstanding overcharge computed by the deterministic evaluator (never by the model). */
export function outstandingDiscrepancy(ctx: PolicyContext): number {
  const ev = ctx.commitment.evaluation ?? {};
  const d = Number(ev.discrepancyMinor ?? 0);
  const refunded = Number(ev.refundedMinor ?? 0);
  return Math.max(0, d - refunded - ctx.inFlightRefundMinor);
}

export function validateProposal(p: ProposalInput, ctx: PolicyContext): { ok: boolean; checks: PolicyCheck[] } {
  const checks: PolicyCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  add("remedy_type_allowed", ctx.policy.allowedRemedies.includes(p.kind), `${p.kind} ${ctx.policy.allowedRemedies.includes(p.kind) ? "is" : "is not"} allowed by merchant policy`);
  add("commitment_enforceable", ctx.commitment.enforceable, ctx.commitment.enforceable ? "promise passed source validation" : "promise is not enforceable");
  const brokenOrRisk = ctx.commitment.state === "BROKEN" || ctx.commitment.state === "AT_RISK";
  add("commitment_needs_remedy", brokenOrRisk, `commitment is ${ctx.commitment.state}`);
  add("no_other_active_remedy", !ctx.otherActiveRemedy, ctx.otherActiveRemedy ? "another remedy is already in progress" : "no remedy in progress");

  if (REFUND_KINDS.includes(p.kind)) {
    const cur = ctx.capture.currency;
    const amt = p.amountMinor;
    add("amount_is_integer_minor_units", amt !== null && Number.isSafeInteger(amt) && amt > 0, `amount ${amt}`);
    add("currency_matches_capture", p.currency !== null && p.currency === cur, `remedy ${p.currency} vs capture ${cur}`);
    const refundableStatus = ctx.capture.status === "COMPLETED" || ctx.capture.status === "PARTIALLY_REFUNDED";
    add("capture_refundable", Boolean(ctx.capture.id) && refundableStatus, `capture status ${ctx.capture.status ?? "none"}`);
    const remaining = remainingRefundable(ctx);
    add("within_remaining_refundable", amt !== null && amt <= remaining, `remaining refundable ${cur ? formatMoney(remaining, cur) : remaining}`);
    add("within_policy_cap", amt !== null && amt <= ctx.policy.maxRefundMinor, `policy cap ${cur ? formatMoney(ctx.policy.maxRefundMinor, cur) : ctx.policy.maxRefundMinor}`);

    if (ctx.commitment.type === "PRICE_AS_QUOTED") {
      const outstanding = outstandingDiscrepancy(ctx);
      add("within_computed_discrepancy", amt !== null && amt <= outstanding, `deterministic outstanding overcharge ${cur ? formatMoney(outstanding, cur) : outstanding}`);
      add("refund_kind_fits", p.kind === "PARTIAL_REFUND", "an overcharge is remedied with a partial refund of the difference");
    } else if (ctx.commitment.type === "REFUND_BY") {
      add("refund_kind_fits", p.kind === "FULL_REFUND" || p.kind === "PARTIAL_REFUND", "refund promise remedied by a refund");
      if (p.kind === "FULL_REFUND") add("full_refund_is_full", amt === remaining, "full refund must equal the remaining refundable amount");
    } else {
      add("refund_kind_fits", false, `${ctx.commitment.type} is not remedied with money by default policy`);
    }
  } else {
    add("no_money_movement", p.amountMinor === null || p.amountMinor === 0, "non-refund remedy moves no money");
  }
  return { ok: checks.every((c) => c.ok), checks };
}
