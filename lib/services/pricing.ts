/**
 * Two pricing paths, on purpose:
 *  - quoteForCustomer(): what the AI assistant tells the customer. Applies the
 *    merchant's PUBLISHED promotions (src_promotions).
 *  - checkoutPricing(): what Kept asks PayPal to charge. In DEMO_MODE the demo
 *    checkout does NOT apply chat-advertised promotions — a realistic integration
 *    gap (the conversation layer and the checkout disagree). That gap is the
 *    defect Kept exists to catch. Outside DEMO_MODE both paths agree.
 * All arithmetic is integer minor units, computed from DB prices — never client input.
 */
import { demoModeEnabled } from "../clock";
import type { Product } from "../db/schema";
import { FREE_EXPRESS_THRESHOLD_MINOR, SHIPPING } from "./merchant-data";

export type CartLine = { product: Product; qty: number };
export type Pricing = { itemTotalMinor: number; shippingMinor: number; promoMinor: number; taxMinor: number; totalMinor: number; promoApplied: string | null };

function base(lines: CartLine[], ship: keyof typeof SHIPPING) {
  if (lines.length === 0) throw new Error("Cart is empty");
  const itemTotalMinor = lines.reduce((s, l) => {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > 10) throw new Error("Invalid quantity");
    return s + l.product.priceMinor * l.qty;
  }, 0);
  return { itemTotalMinor, shippingMinor: SHIPPING[ship].priceMinor };
}

export function quoteForCustomer(lines: CartLine[], ship: keyof typeof SHIPPING): Pricing {
  const b = base(lines, ship);
  const freeExpress = ship === "EXPRESS" && b.itemTotalMinor > FREE_EXPRESS_THRESHOLD_MINOR;
  const promoMinor = freeExpress ? b.shippingMinor : 0;
  return { ...b, promoMinor, taxMinor: 0, totalMinor: b.itemTotalMinor + b.shippingMinor - promoMinor, promoApplied: freeExpress ? "Free express shipping over $75" : null };
}

export function checkoutPricing(lines: CartLine[], ship: keyof typeof SHIPPING): Pricing {
  if (!demoModeEnabled()) return quoteForCustomer(lines, ship);
  const b = base(lines, ship);
  return { ...b, promoMinor: 0, taxMinor: 0, totalMinor: b.itemTotalMinor + b.shippingMinor, promoApplied: null };
}
