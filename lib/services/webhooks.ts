/**
 * PayPal webhook ingestion and processing.
 *
 *   1. read raw body            5. acknowledge (200) promptly
 *   2. verify signature         6. re-fetch the PayPal resource (GET) — the payload is never payment truth
 *   3. reject invalid → 400     7. process idempotently, evaluate commitments, audit
 *   4. dedupe on event id, persist
 */
import { and, eq, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { disputes, orders, paypalEvents } from "../db/schema";
import { newId } from "../ids";
import { getPayPal, paypalMode } from "../paypal/client";
import { getCapture, getDispute, getRefund } from "../paypal/api";
import { readWebhookHeaders, verifyWebhookSignature } from "../paypal/webhook-verify";
import { audit } from "./audit";
import { afterPaymentEvidence, refreshOrder } from "./pipeline";
import { syncCapture } from "./orders";
import { syncRefund } from "./remedies";

type IngestResult = { status: 200 | 400; body: { ok: boolean; duplicate?: boolean; eventId?: string; error?: string } };

type RawEvent = { id?: string; event_type?: string; resource_type?: string; summary?: string; resource?: Record<string, unknown> };

export async function ingestWebhook(rawBody: string, headers: Headers): Promise<IngestResult & { internalId?: string }> {
  const verdict = await verifyWebhookSignature({ headers: readWebhookHeaders(headers), rawBody, webhookId: process.env.PAYPAL_WEBHOOK_ID, paypal: getPayPal() });
  if (!verdict.ok) {
    console.warn(`[webhook] rejected: ${verdict.reason}`);
    return { status: 400, body: { ok: false, error: "invalid signature" } };
  }
  return persistEvent(rawBody, "SUCCESS");
}

/** Simulated events (local emulator) skip signature verification and are refused outside simulated mode. */
export async function ingestSimulatedEvent(event: RawEvent) {
  if (paypalMode() !== "simulated") throw new Error("simulated events are only accepted in PAYPAL_MODE=simulated");
  return persistEvent(JSON.stringify(event), "SIMULATED");
}

async function persistEvent(rawBody: string, verification: "SUCCESS" | "SIMULATED"): Promise<IngestResult & { internalId?: string }> {
  let ev: RawEvent;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "malformed JSON" } };
  }
  if (!ev.id || !ev.event_type) return { status: 400, body: { ok: false, error: "missing id/event_type" } };
  const db = getDb();
  const resourceId = typeof ev.resource?.id === "string" ? ev.resource.id : typeof ev.resource?.dispute_id === "string" ? ev.resource.dispute_id : null;
  const internalId = newId("evt");
  const inserted = await db.insert(paypalEvents).values({
    id: internalId,
    paypalEventId: ev.id,
    eventType: ev.event_type,
    resourceType: ev.resource_type ?? null,
    resourceId,
    summary: ev.summary ?? null,
    verification,
    payload: ev as Record<string, unknown>,
  }).onConflictDoNothing({ target: paypalEvents.paypalEventId }).returning({ id: paypalEvents.id });
  if (inserted.length === 0) return { status: 200, body: { ok: true, duplicate: true, eventId: ev.id } };
  return { status: 200, body: { ok: true, eventId: ev.id }, internalId };
}

/** Process one stored event. Safe to run repeatedly. */
export async function processEvent(internalId: string): Promise<void> {
  const db = getDb();
  const ev = await db.query.paypalEvents.findFirst({ where: eq(paypalEvents.id, internalId) });
  if (!ev || ev.processingStatus === "PROCESSED" || ev.processingStatus === "IGNORED") return;
  await db.update(paypalEvents).set({ attempts: ev.attempts + 1 }).where(eq(paypalEvents.id, ev.id));
  const pp = getPayPal();
  try {
    let orderId: string | null = null;
    let status: "PROCESSED" | "IGNORED" = "PROCESSED";
    const t = ev.eventType;
    if (t === "CHECKOUT.ORDER.APPROVED") {
      const o = ev.resourceId ? await db.query.orders.findFirst({ where: eq(orders.paypalOrderId, ev.resourceId) }) : undefined;
      orderId = o?.id ?? null;
      if (o && o.status === "PAYPAL_CREATED") await db.update(orders).set({ status: "APPROVED", updatedAt: new Date() }).where(eq(orders.id, o.id));
      if (!o) status = "IGNORED";
    } else if (t.startsWith("PAYMENT.CAPTURE.") && t !== "PAYMENT.CAPTURE.REFUNDED") {
      if (!ev.resourceId) throw new Error("capture event without resource id");
      const facts = await getCapture(pp, ev.resourceId); // authoritative re-fetch
      const order = await syncCapture(facts, `webhook ${t}`);
      orderId = order.id;
      await afterPaymentEvidence(order.id);
    } else if (t === "PAYMENT.CAPTURE.REFUNDED" || t.startsWith("PAYMENT.REFUND.")) {
      if (!ev.resourceId) throw new Error("refund event without resource id");
      const facts = await getRefund(pp, ev.resourceId); // authoritative re-fetch
      await syncRefund(facts, null, `webhook ${t}`);
      const o = facts.customId ? await db.query.orders.findFirst({ where: eq(orders.id, facts.customId) }) : undefined;
      orderId = o?.id ?? null;
      if (orderId) await refreshOrder(orderId);
    } else if (t.startsWith("CUSTOMER.DISPUTE.")) {
      if (!ev.resourceId) throw new Error("dispute event without resource id");
      const d = await getDispute(pp, ev.resourceId);
      let order;
      for (const capId of d.sellerTransactionIds) {
        order = await db.query.orders.findFirst({ where: eq(orders.paypalCaptureId, capId) });
        if (order) break;
      }
      orderId = order?.id ?? null;
      await db.insert(disputes).values({ paypalDisputeId: d.disputeId, orderId, reason: d.reason, status: d.status, stage: d.stage, amountMinor: d.amountMinor, currency: d.currency, paypalCreatedAt: d.createdAt, verifiedAt: new Date(), raw: { reason: d.reason, status: d.status, stage: d.stage } })
        .onConflictDoUpdate({ target: disputes.paypalDisputeId, set: { status: d.status, stage: d.stage, verifiedAt: new Date(), orderId } });
      if (order) {
        await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "paypal", action: "paypal.dispute.verified", ref: d.disputeId, outcome: "INFO", detail: { event: t, reason: d.reason, status: d.status, stage: d.stage } });
        const { proposeDisputeResponse } = await import("./disputes");
        await proposeDisputeResponse(order.id, d.disputeId);
      }
    } else {
      status = "IGNORED";
    }
    await db.update(paypalEvents).set({ processingStatus: status, processedAt: new Date(), orderId, processingError: null }).where(eq(paypalEvents.id, ev.id));
  } catch (e) {
    await db.update(paypalEvents).set({ processingStatus: "FAILED", processingError: String(e).slice(0, 500) }).where(eq(paypalEvents.id, ev.id));
    throw e;
  }
}

/** Retry failed/unprocessed events (bounded). */
export async function retryEvents(maxAttempts = 5) {
  const db = getDb();
  const stuck = await db.select().from(paypalEvents).where(and(or(eq(paypalEvents.processingStatus, "FAILED"), eq(paypalEvents.processingStatus, "RECEIVED")), lt(paypalEvents.attempts, maxAttempts))).limit(50);
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const e of stuck) {
    try {
      await processEvent(e.id);
      out.push({ id: e.id, ok: true });
    } catch (err) {
      out.push({ id: e.id, ok: false, error: String(err).slice(0, 200) });
    }
  }
  return out;
}
