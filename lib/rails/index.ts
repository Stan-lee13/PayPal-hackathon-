/**
 * The financial rail boundary.
 *
 * The only import the financial engine needs: `import { rail } from "../rails"`. Nothing below the
 * adapter layer names PayPal, and no adapter may claim a guarantee it does not have.
 */
export * from "./types";
export { configuredRailId, forgetRails, railIds, registerRail, resolveRail, setRailForTesting } from "./registry";
export { mockEmptyRail, mockPayoutOnlyRail, mockRail, MockRail } from "./mock-rail";
export { PayPalRail, paypalRail } from "./paypal-rail";

import { resolveRail } from "./registry";
import type { Rail } from "./types";

/** The rail this deployment moves money through. Resolved once, from the registry. */
export function rail(): Rail {
  return resolveRail();
}

/** The mode to record alongside money facts: `sandbox`, `live`, `simulated` or `mock`. */
export function railMode(): Rail["mode"] {
  return rail().mode;
}

/** What this rail promises. Pages and receipts must not claim more. */
export function railGuarantees(): string[] {
  return [...rail().guarantees];
}
