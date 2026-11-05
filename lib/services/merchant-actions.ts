import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, merchants, orders, trackers, type MerchantPolicy } from "../db/schema";
import { newId } from "../ids";
import { getPayPal, paypalMode } from "../paypal/client";
import { addTracking, CARRIERS } from "../paypal/api";
import { demoModeEnabled, effectiveNow } from "../clock";
import { audit } from "./audit";
import { refreshOrder } from "./pipeline";
import { UserFacingError } from "./orders";
import { REMEDY_KINDS } from "../db/schema";
import { z } from "zod";

/** Add a shipment tracker to the PayPal order (Orders v2 /track). Recorded only after PayPal accepts it. */
export async function addOrderTracking(orderId: string, trackingNumber: string, carrier: (typeof CARRIERS)[number]) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.paypalOrderId || !order.paypalCaptureId) throw new UserFacingError("Order has no PayPal capture yet.", 409);
  const clean = trackingNumber.trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
  if (clean.length < 4) throw new UserFacingError("Enter a valid tracking number.");
  if (!CARRIERS.includes(carrier)) throw new UserFacingError("Unknown carrier.");
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }))!;
  const t = await addTracking(getPayPal(), { paypalOrderId: order.paypalOrderId, captureId: order.paypalCaptureId, trackingNumber: clean, carrier, requestId: `track-${order.id}-${clean}` });
  const recordedAt = effectiveNow(merchant.demoClockOffsetMs);
  await db.insert(trackers).values({ id: newId("trk"), orderId: order.id, paypalTrackerId: t?.trackerId ?? null, trackingNumber: clean, carrier, status: t?.status ?? "SHIPPED", recordedAt })
    .onConflictDoNothing({ target: [trackers.orderId, trackers.trackingNumber] });
  await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "merchant", action: "paypal.tracking.added", ref: t?.trackerId ?? clean, outcome: "OK",
    detail: { carrier, trackingNumber: clean, paypalStatus: t?.status ?? null, recordedAt: recordedAt.toISOString(), simulatedClock: demoModeEnabled() && merchant.demoClockOffsetMs !== 0 } });
  await refreshOrder(order.id);
}

/** Merchant resolves a NEEDS_CONFIRMATION item: either waive it, or confirm a corrected enforceable value. */
export async function decideCommitment(commitmentId: string, decision: "WAIVE" | "CONFIRM", note: string) {
  const db = getDb();
  const c = await db.query.commitments.findFirst({ where: eq(commitments.id, commitmentId) });
  if (!c) throw new UserFacingError("Promise not found.", 404);
  if (decision === "WAIVE") {
    await db.update(commitments).set({ state: "WAIVED", stateReason: `Waived by merchant${note ? `: ${note.slice(0, 200)}` : "."}`, updatedAt: new Date() }).where(eq(commitments.id, c.id));
  } else {
    // Confirm is only possible when the validator produced complete normalised params.
    const p = c.params;
    const complete = (c.type === "PRICE_AS_QUOTED" && Number.isSafeInteger(p.amountMinor)) || (c.type === "SHIP_BY" && (p.withinHours || p.byDate)) || (c.type === "REFUND_BY" && p.withinDays && p.trigger);
    if (!complete || c.state !== "NEEDS_CONFIRMATION") throw new UserFacingError("Kept could not derive exact terms from this quote, so it cannot be enforced. You can waive it.", 422);
    await db.update(commitments).set({ enforceable: true, state: "PENDING", stateReason: `Confirmed by merchant${note ? `: ${note.slice(0, 200)}` : "."}`, updatedAt: new Date() }).where(eq(commitments.id, c.id));
  }
  await audit(db, { merchantId: c.merchantId, orderId: c.orderId, actor: "merchant", action: decision === "WAIVE" ? "commitment.waived" : "commitment.confirmed", ref: c.id, outcome: "OK", detail: { note: note.slice(0, 200), type: c.type } });
  await refreshOrder(c.orderId);
}

/** Start a REFUND_BY clock (e.g. the return arrived). */
export async function recordRefundTrigger(commitmentId: string) {
  const db = getDb();
  const c = await db.query.commitments.findFirst({ where: and(eq(commitments.id, commitmentId), eq(commitments.type, "REFUND_BY")) });
  if (!c) throw new UserFacingError("Refund promise not found.", 404);
  if (c.params.triggeredAt) throw new UserFacingError("Already recorded.", 409);
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, c.merchantId) }))!;
  const at = effectiveNow(merchant.demoClockOffsetMs).toISOString();
  await db.update(commitments).set({ params: { ...c.params, triggeredAt: at }, updatedAt: new Date() }).where(eq(commitments.id, c.id));
  await audit(db, { merchantId: c.merchantId, orderId: c.orderId, actor: "merchant", action: "commitment.refund_clock_started", ref: c.id, outcome: "OK", detail: { trigger: c.params.trigger, at } });
  await refreshOrder(c.orderId);
}

/** DEMO ONLY: move the merchant's simulated clock. Always labelled in the UI. */
export async function advanceDemoClock(merchantId: string, hours: number) {
  if (!demoModeEnabled()) throw new UserFacingError("The simulated clock is only available in DEMO_MODE.", 403);
  if (!Number.isFinite(hours) || Math.abs(hours) > 24 * 30) throw new UserFacingError("Invalid hours.");
  const db = getDb();
  const m = (await db.query.merchants.findFirst({ where: eq(merchants.id, merchantId) }))!;
  const next = hours === 0 ? 0 : m.demoClockOffsetMs + Math.round(hours * 3600_000);
  await db.update(merchants).set({ demoClockOffsetMs: next }).where(eq(merchants.id, merchantId));
  await audit(db, { merchantId, actor: "merchant", action: "demo.clock_changed", outcome: "INFO", detail: { offsetHours: next / 3600_000, simulated: true } });
  const open = await db.select({ id: orders.id }).from(orders).where(eq(orders.merchantId, merchantId));
  for (const o of open) await refreshOrder(o.id);
}

export const PolicyUpdateSchema = z.object({
  allowedRemedies: z.array(z.enum(REMEDY_KINDS)).min(1),
  maxRefundMinor: z.number().int().min(0).max(1_000_000),
  reviewThresholdMinor: z.number().int().min(0).max(1_000_000),
  minConfidence: z.number().min(0.5).max(1),
  shipAtRiskHours: z.number().int().min(1).max(240),
  refundAtRiskDays: z.number().int().min(0).max(30),
  checkoutGuard: z.enum(["OFF", "WARN", "HONOR"]).optional(),
});

export async function updatePolicy(merchantId: string, input: unknown) {
  const p = PolicyUpdateSchema.parse(input);
  const db = getDb();
  const m = (await db.query.merchants.findFirst({ where: eq(merchants.id, merchantId) }))!;
  const policy: MerchantPolicy = { ...m.policy, ...p };
  await db.update(merchants).set({ policy }).where(eq(merchants.id, merchantId));
  await audit(db, { merchantId, actor: "merchant", action: "policy.updated", outcome: "OK", detail: p });
  return policy;
}

export function modeLabel() {
  const mode = paypalMode();
  return mode === "simulated" ? "SIMULATED (local PayPal emulator — no PayPal involved)" : mode === "sandbox" ? "PayPal Sandbox" : "PayPal Live";
}
