/**
 * Checkout guard: compare what the merchant's assistant promised in this chat with
 * what Kept is about to ask PayPal to charge, BEFORE the buyer approves the payment.
 *
 * Deterministic. The quote is read by the rules extractor and the validator (the same
 * code that enforces promises after capture); the model plays no part here.
 *
 * Modes (merchant policy `checkoutGuard`):
 *  - OFF:   no pre-payment check (promises are still verified after capture).
 *  - WARN:  the buyer sees the mismatch before paying; the merchant is told after.
 *  - HONOR: the PayPal order is created at the promised total, as a labelled discount —
 *           but ONLY when the promised total is exactly what the merchant's own published
 *           pricing produces for this cart. A stale quote (cart changed since), or a number
 *           the assistant made up, is never honoured automatically; it falls back to WARN.
 */
import type { ChatMessage, MerchantPolicy } from "../db/schema";
import { merchantTerms } from "../ai/buyer-agent";
import { formatMoney } from "../money";
import type { SHIPPING } from "./merchant-data";
import { checkoutPricing, quoteForCustomer, type CartLine, type Pricing } from "./pricing";

export type GuardMode = "OFF" | "WARN" | "HONOR" | "BLOCK";
export const GUARD_MODES: readonly GuardMode[] = ["BLOCK", "HONOR", "WARN", "OFF"];

/** BLOCK (default): the buyer is warned now, and Kept verifies the authoritative PayPal order before capture. */
export function guardMode(policy: MerchantPolicy): GuardMode {
  return policy.checkoutGuard ?? "BLOCK";
}

/** Does Kept's capture gate enforce the preflight verdict in this mode? */
export function gateEnforced(mode: GuardMode): boolean {
  return mode === "BLOCK" || mode === "HONOR";
}

export type GuardResult = {
  mode: GuardMode;
  action: "NONE" | "WARN" | "HONOR";
  quotedMinor: number | null;
  quote: string | null;
  /** What checkout pricing alone would charge. */
  checkoutMinor: number;
  /** checkoutMinor − quotedMinor when the buyer would pay more than promised, else 0. */
  gapMinor: number;
  /** Discount applied to the PayPal order (HONOR only). */
  honorDiscountMinor: number;
  /** What PayPal will actually be asked to charge. */
  totalMinor: number;
  reason: string;
};

export type CheckoutPlan = { price: Pricing; guard: GuardResult };

export function planCheckout(messages: ChatMessage[], lines: CartLine[], ship: keyof typeof SHIPPING, policy: MerchantPolicy, currency: string): CheckoutPlan {
  const price = checkoutPricing(lines, ship);
  const mode = guardMode(policy);
  const terms = merchantTerms(messages, currency);
  const quotedMinor = terms.quotedMinor;
  const base = { mode, quotedMinor, quote: terms.quotedQuote, checkoutMinor: price.totalMinor, honorDiscountMinor: 0, totalMinor: price.totalMinor };

  if (quotedMinor === null) return { price, guard: { ...base, action: "NONE", gapMinor: 0, reason: "No explicit total was promised in this chat." } };
  const gapMinor = Math.max(0, price.totalMinor - quotedMinor);
  if (gapMinor === 0) return { price, guard: { ...base, action: "NONE", gapMinor, reason: `Checkout matches the promised total of ${formatMoney(quotedMinor, currency)}.` } };
  if (mode === "OFF") return { price, guard: { ...base, action: "NONE", gapMinor, reason: "Pre-payment check is off; Kept will still verify the promise after capture." } };

  const published = quoteForCustomer(lines, ship).totalMinor;
  const reproducible = published === quotedMinor;
  if (mode === "HONOR" && reproducible && gapMinor <= policy.maxRefundMinor) {
    return { price, guard: { ...base, action: "HONOR", gapMinor, honorDiscountMinor: gapMinor, totalMinor: quotedMinor,
      reason: `The assistant promised ${formatMoney(quotedMinor, currency)}, which is what the published pricing gives for this cart; checkout would have charged ${formatMoney(price.totalMinor, currency)}. The PayPal order honours the promise.` } };
  }
  const why = !reproducible
    ? `the promised ${formatMoney(quotedMinor, currency)} is not what the published pricing gives for this cart (${formatMoney(published, currency)}) — the cart may have changed since, so it is not honoured automatically`
    : mode === "HONOR" ? `the difference is above the merchant's automatic limit` : mode === "BLOCK" ? `Kept verifies the PayPal order before capture and blocks it if it still differs` : `the merchant reviews differences after payment`;
  return { price, guard: { ...base, action: "WARN", gapMinor,
    reason: `The assistant promised ${formatMoney(quotedMinor, currency)}; checkout would charge ${formatMoney(price.totalMinor, currency)}. Not changed before payment because ${why}.` } };
}
