/**
 * Real PayPal sandbox smoke test (no buyer interaction needed):
 *   OAuth token → create order with custom_id → GET order → verify custom_id round-trips →
 *   negative test (PayPal-Mock-Response) on capture of an unapproved order.
 * The full capture/refund loop needs a sandbox BUYER to approve in PayPal's UI: use the store.
 */
import { loadEnv } from "./env";
loadEnv();
const { getPayPal, paypalMode, PayPalApiError } = await import("../lib/paypal/client");
const { createOrder, getOrder, captureOrder } = await import("../lib/paypal/api");
if (paypalMode() !== "sandbox") throw new Error("PAYPAL_MODE must be sandbox with real credentials.");
const pp = getPayPal();
const id = `ko_smoke${Date.now()}`;
await pp.getAccessToken();
console.log("✓ OAuth token acquired");
const order = await createOrder(pp, { keptOrderId: id, currency: "USD", itemTotalMinor: 8400, shippingMinor: 933, shippingDiscountMinor: 0, taxMinor: 0, totalMinor: 9333,
  lines: [{ name: "Ada Wrap Dress", sku: "ADA-WRAP-01", qty: 1, unitMinor: 8400 }], description: "Kept smoke test", requestId: `create-${id}`,
  returnUrl: "https://example.com/return", cancelUrl: "https://example.com/cancel" });
console.log(`✓ Order created ${order.id} (${order.status})`);
const again = await createOrder(pp, { keptOrderId: id, currency: "USD", itemTotalMinor: 8400, shippingMinor: 933, shippingDiscountMinor: 0, taxMinor: 0, totalMinor: 9333,
  lines: [{ name: "Ada Wrap Dress", sku: "ADA-WRAP-01", qty: 1, unitMinor: 8400 }], description: "Kept smoke test", requestId: `create-${id}`,
  returnUrl: "https://example.com/return", cancelUrl: "https://example.com/cancel" });
console.log(`${again.id === order.id ? "✓" : "✕"} Same PayPal-Request-Id returned the same order (idempotency): ${again.id}`);
const got = (await getOrder(pp, order.id)) as { purchase_units: Array<{ custom_id?: string; amount: { value: string } }> };
console.log(`${got.purchase_units[0]?.custom_id === id ? "✓" : "✕"} custom_id round-trips: ${got.purchase_units[0]?.custom_id}; amount ${got.purchase_units[0]?.amount.value}`);
try {
  await captureOrder(pp, order.id, `capture-${id}`);
  console.log("✕ capture of an unapproved order unexpectedly succeeded");
} catch (e) {
  console.log(`✓ capture before buyer approval refused by PayPal: ${e instanceof PayPalApiError ? `${e.issue ?? e.paypalName} (debug_id ${e.debugId})` : String(e)}`);
}
