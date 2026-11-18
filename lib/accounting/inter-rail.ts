/**
 * Moving value between financial providers.
 *
 * A payment API can move money inside one provider. It cannot move money *between* providers: the only ways
 * value crosses are a real bank/settlement transfer, an authorized liquidity operation (the operator funding
 * its own account), or a conversion — and this milestone deliberately implements none of them, because each
 * is a licensed, priced, reconcilable operation and guessing one would create money.
 *
 * So the rules here are refusal-first:
 *
 *   • same provider, same currency → an internal book movement. No liquidity is created; one organization's
 *     claim moves from one of its accounts to another, and `lib/accounting/positions.ts` is unchanged.
 *   • different currency → refused. No implied FX rate, no rounding, no "close enough" conversion.
 *   • different provider → refused unless there is an explicit funding leg: a settled external movement that
 *     already arrived at the destination provider, for at least the amount, recorded before this transfer is
 *     planned — *and* an explicit authorization that this is an operator liquidity operation.
 *
 * A funding leg has to come from the destination provider's own records. A reference to a capture at another
 * provider is not a funding leg, and `assertInterRailTransfer` checks the position entries, not the caller's
 * word.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { positionEntries } from "../db/schema";
import type { UserFacingError } from "../errors";

export type RailSide = { rail: string; currency: string };

export type InterRailRequest = {
  from: RailSide;
  to: RailSide;
  amountMinor: number;
  /**
   * A settled arrival at the destination rail that funds this movement. Required whenever the rail changes.
   * `ref` is the domain record of that arrival (a statement line or a funding operation), never a record
   * from the source rail.
   */
  funding?: { rail: string; currency: string; ref: string; settledMinor: number } | null;
  /** True only when the operator has explicitly authorised funding its own destination account. */
  authorisedLiquidity?: boolean;
};

export type InterRailDecision =
  | { ok: true; kind: "internal" | "funded"; detail: string }
  | { ok: false; code: "INVALID_AMOUNT" | "CURRENCY_CONVERSION_NOT_SUPPORTED" | "FUNDING_REQUIRED" | "FUNDING_MISMATCH" | "FUNDING_SHORT" | "NOT_AUTHORISED"; detail: string };

/** The pure rule, with no database: used by tests and by the async check below. */
export function planInterRailTransfer(r: InterRailRequest): InterRailDecision {
  if (!Number.isSafeInteger(r.amountMinor) || r.amountMinor <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", detail: `A movement needs a positive integer amount, got ${r.amountMinor}.` };
  }
  const sameRail = r.from.rail === r.to.rail;
  const sameCurrency = r.from.currency === r.to.currency;
  if (!sameCurrency) {
    return {
      ok: false, code: "CURRENCY_CONVERSION_NOT_SUPPORTED",
      detail: `Moving ${r.from.currency} to ${r.to.currency} needs an explicit conversion at an agreed rate; this gateway performs none, and will not imply one.`,
    };
  }
  if (sameRail) {
    return { ok: true, kind: "internal", detail: `Both sides are at ${r.from.rail} in ${r.from.currency}: one internal book movement, no provider liquidity created.` };
  }
  const f = r.funding;
  if (!f) {
    return {
      ok: false, code: "FUNDING_REQUIRED",
      detail: `Moving money from ${r.from.rail} to ${r.to.rail} requires a settled funding leg at ${r.to.rail}: an internal balance at ${r.from.rail} is not liquidity at ${r.to.rail}.`,
    };
  }
  if (f.rail !== r.to.rail || f.currency !== r.to.currency) {
    return {
      ok: false, code: "FUNDING_MISMATCH",
      detail: `The funding leg is at ${f.rail} in ${f.currency}, but the destination is ${r.to.rail} in ${r.to.currency}.`,
    };
  }
  if (!Number.isSafeInteger(f.settledMinor) || f.settledMinor < r.amountMinor) {
    return { ok: false, code: "FUNDING_SHORT", detail: `The funding leg settled ${f.settledMinor} minor units; ${r.amountMinor} is needed.` };
  }
  if (!r.authorisedLiquidity) {
    return {
      ok: false, code: "NOT_AUTHORISED",
      detail: `Cross-provider funding is an operator liquidity operation: it needs an explicit authorization, not a customer instruction.`,
    };
  }
  return { ok: true, kind: "funded", detail: `Funded by a settled ${f.settledMinor}-minor-unit arrival at ${f.rail} (${f.ref}).` };
}

/**
 * The same rule, with the funding leg checked against the destination provider's recorded movements. A caller
 * cannot assert its own funding: the row has to exist, be available (not pending), at that rail and currency.
 */
export async function assertInterRailTransfer(r: InterRailRequest): Promise<InterRailDecision> {
  const plan = planInterRailTransfer(r);
  if (!plan.ok || plan.kind === "internal") return plan;
  const f = r.funding!;
  const db = getDb();
  const [row] = await db.select({ delta: positionEntries.deltaMinor, bucket: positionEntries.bucket })
    .from(positionEntries)
    .where(and(eq(positionEntries.ref, f.ref), eq(positionEntries.rail, f.rail), eq(positionEntries.currency, f.currency)))
    .limit(1);
  if (!row || row.bucket !== "available" || row.delta < r.amountMinor) {
    return {
      ok: false, code: "FUNDING_REQUIRED",
      detail: `No settled arrival of ${r.amountMinor} minor units at ${f.rail} is recorded under ${f.ref}; the funding leg cannot be verified from this gateway's own books.`,
    };
  }
  return plan;
}

/**
 * Turn a refusal into the error the API returns. 501 for "this gateway does not do that", 409 for "fund it
 * first": both are honest, and neither moves money.
 */
export function interRailRefusal(d: Extract<InterRailDecision, { ok: false }>): { status: number; message: string } {
  const status = d.code === "INVALID_AMOUNT" ? 422 : d.code === "CURRENCY_CONVERSION_NOT_SUPPORTED" ? 501 : d.code === "FUNDING_REQUIRED" || d.code === "FUNDING_MISMATCH" || d.code === "FUNDING_SHORT" ? 409 : 403;
  return { status, message: d.detail };
}

/** A `UserFacingError` shaped refusal, without importing the class at module scope (keeps this file pure-ish). */
export async function refuseInterRailTransfer(r: InterRailRequest): Promise<void> {
  const d = await assertInterRailTransfer(r);
  if (d.ok) return;
  const { status, message } = interRailRefusal(d);
  const { UserFacingError } = await import("../errors");
  throw new UserFacingError(message, status) as UserFacingError;
}
