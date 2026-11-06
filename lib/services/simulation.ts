/**
 * Simulated-mode helpers (PAYPAL_MODE=simulated only). Delivers events queued by
 * the local emulator through Kept's normal ingest → process path, minus the
 * signature check (simulated events are labelled SIMULATED everywhere).
 */
import { paypalMode } from "../paypal/client";
import { ingestSimulatedEvent, processEvent } from "./webhooks";
import { withEmulatorState } from "../paypal/emulator-store";

export async function deliverSimulatedEvents(opts: { duplicateFirst?: boolean } = {}) {
  if (paypalMode() !== "simulated") return { delivered: 0, duplicates: 0 };
  return withEmulatorState(() => deliverInner(opts));
}

async function deliverInner(opts: { duplicateFirst?: boolean }) {
  const { drainEmulatorEvents } = await import("../paypal/emulator");
  const events = drainEmulatorEvents();
  let delivered = 0;
  let duplicates = 0;
  for (const ev of events) {
    const copies = opts.duplicateFirst ? 2 : 1; // demonstrate PayPal's at-least-once delivery
    for (let i = 0; i < copies; i++) {
      const res = await ingestSimulatedEvent(ev);
      if (res.body.duplicate) duplicates++;
      if (res.internalId) {
        delivered++;
        await processEvent(res.internalId);
      }
    }
  }
  return { delivered, duplicates };
}

/**
 * SIMULATED MODE ONLY — the "repair" demo's starting point: an order whose payment was captured
 * OUTSIDE Kept's protected checkout (e.g. the merchant's older checkout), so no preflight could stop
 * it. The assistant promised $84.00; PayPal captured $93.33. Kept can only monitor and repair it.
 */
export async function seedExternalCapturedOrder() {
  if (paypalMode() !== "simulated") throw new Error("simulated mode only");
  return withEmulatorState(seedExternalInner);
}

async function seedExternalInner() {
  const { getDb } = await import("../db");
  const { orders } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const chat = await import("./chat");
  const ord = await import("./orders");
  const { afterPaymentEvidence } = await import("./pipeline");
  const { approveEmulatorOrder } = await import("../paypal/emulator");
  const { audit } = await import("./audit");
  const sessionId = await chat.createSession();
  await chat.setCart(sessionId, [{ productId: "prd_ada_dress", qty: 1 }], "EXPRESS");
  await chat.postCustomerMessage(sessionId, "What's my total with express shipping?");
  const { keptOrderId, paypalOrderId } = await ord.createOrderFromSession(sessionId);
  const db = getDb();
  const [o] = await db.update(orders).set({ checkoutChannel: "EXTERNAL" }).where(eq(orders.id, keptOrderId)).returning();
  await audit(db, { merchantId: o!.merchantId, orderId: keptOrderId, actor: "system", action: "order.external_checkout", ref: paypalOrderId, outcome: "INFO",
    detail: { note: "Captured outside Kept's protected checkout: no pre-capture check was possible. Kept monitors it after payment." } });
  approveEmulatorOrder(paypalOrderId);
  const captured = await ord.captureKeptOrder(keptOrderId, paypalOrderId);
  await deliverSimulatedEvents();
  await afterPaymentEvidence(captured.id);
  return { keptOrderId, paypalOrderId };
}
