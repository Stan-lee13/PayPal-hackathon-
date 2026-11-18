/**
 * Treasury policy: whose money backs a payout.
 *
 * This gateway holds one provider account per rail (one PayPal merchant account, in practice). Money from
 * every organization lands in it. That is an **omnibus treasury**, and the honest name for it is "pooled":
 * the operator's provider account backs every tenant's claim, and the operator carries the obligation and
 * the float risk. `reserves()` checks that the account covers what is owed; the guard checks that the money
 * is physically there.
 *
 * It is *not* per-tenant custody. Nothing here gives an organization its own protected balance at a provider,
 * so nothing may claim that. A deployment that really does have one provider account per organization (for
 * example a partner bank that opens a sub-account per tenant) can set
 *
 *     ENVELOPE_TREASURY_MODE=allocated
 *
 * and every payout is then also checked against that organization's own position slice, in addition to the
 * provider account. In that mode one tenant cannot consume another's funds; a treasury transfer between
 * owners would be the only way to move value across, and it is not implemented (see lib/accounting/inter-rail.ts
 * and docs/MULTI_RAIL_ACCOUNTING.md §12).
 *
 * The default is `pooled`, and the mode is reported in `reserves()` and in the audit trail so no reader has
 * to guess which one is in force.
 */
import { UserFacingError } from "../errors";

export type TreasuryMode = "pooled" | "allocated";

const configured = (): TreasuryMode | null => {
  const v = (process.env.ENVELOPE_TREASURY_MODE ?? "").trim().toLowerCase();
  return v === "pooled" || v === "allocated" ? v : null;
};

export function treasuryMode(): TreasuryMode {
  return configured() ?? "pooled";
}

/** True when the operator said, in so many words, which treasury model this deployment runs. */
export function treasuryConfigured(): boolean {
  return configured() !== null;
}

/**
 * A production deployment must choose. Pooled means the operator's account backs every tenant and the
 * operator carries the obligation; that is a decision a person has to make, not an environment default.
 * Called before any payout leaves, so an unconfigured production install fails closed.
 */
export function assertTreasuryPolicy(): TreasuryMode {
  const mode = configured();
  if (mode) return mode;
  if (process.env.NODE_ENV === "production") {
    throw new UserFacingError(
      "This gateway will not move money until its treasury model is chosen: set ENVELOPE_TREASURY_MODE=pooled " +
      "(one operator account backs every organization; the operator owes each balance and carries the float risk) " +
      "or ENVELOPE_TREASURY_MODE=allocated (each organization's payouts are checked against its own provider position). " +
      "Nothing was sent.",
      503,
    );
  }
  return "pooled";
}

/** A sentence for receipts, books and health pages: what the operator is promising, in plain words. */
export function treasuryMeaning(mode: TreasuryMode = treasuryMode()): string {
  return mode === "allocated"
    ? "Each organization's payouts are checked against its own provider position as well as the provider account. One organization cannot spend another's funds."
    : "One provider account holds every organization's money (an operator-run omnibus treasury). Payouts are checked against that account, and the operator owes each organization its balance. This is not segregated or safeguarded custody.";
}
