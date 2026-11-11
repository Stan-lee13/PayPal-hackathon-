/**
 * A question about PayPal that the design depends on, asked of the real sandbox: when part of a hold is
 * captured and that capture is then refunded, can the refunded amount be captured again?
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npx tsx scripts/paypal-refund-capacity.ts
 *
 * Places a $10 hold, captures $7, refunds it, then tries to capture $7 again, then $3, and voids.
 */
import { loadEnv } from "./env";
loadEnv();
const { getPayPal, paypalMode, PayPalApiError } = await import("../lib/paypal/client");
const { authorizeHold, capturePart, getAuthorization, getCapture, refundCapture, voidAuthorization } = await import("../lib/paypal/payments");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");
const pp = getPayPal();
const tag = `probe_${Date.now().toString(36)}`;
const say = (step: string, data: unknown) => console.log(`• ${step}`, JSON.stringify(data));
const attempt = async (id: string, amountMinor: number) => {
  try { const c = await capturePart(pp, auth.id, { spendId: id, amountMinor, currency: "USD", note: "capacity probe" }); return { captured: true, capture: c.id, status: c.status }; }
  catch (e) { return { captured: false, refusedWith: e instanceof PayPalApiError ? e.issue ?? e.paypalName : String(e) }; }
};
const auth = await authorizeHold(pp, { rootId: tag, title: "Refund capacity probe", currency: "USD", amountMinor: 1000 });
say("hold placed", { authorization: auth.id, amount: "$10.00", status: auth.status });
const first = await capturePart(pp, auth.id, { spendId: `${tag}_a`, amountMinor: 700, currency: "USD", note: "capacity probe" });
say("captured $7", { capture: first.id, status: first.status, hold: (await getAuthorization(pp, auth.id)).status });
const refund = await refundCapture(pp, first.id, `${tag}_a`, "capacity probe");
say("refunded that capture", { refund: refund.id, status: refund.status, capture: (await getCapture(pp, first.id)).status, hold: (await getAuthorization(pp, auth.id)).status });
say("tried to capture $7 again (only fits if the refund gave capacity back)", await attempt(`${tag}_b`, 700));
say("tried to capture $3 (fits either way)", await attempt(`${tag}_c`, 300));
await voidAuthorization(pp, auth.id, tag).catch((e: unknown) => say("void", { refusedWith: e instanceof PayPalApiError ? e.issue ?? e.paypalName : String(e) }));
say("hold at the end", { status: (await getAuthorization(pp, auth.id)).status });
