/**
 * PayPal webhook ingestion and processing.
 *
 *   1. read raw body           4. dedupe on PayPal's event id, persist
 *   2. verify the signature    5. acknowledge (200) promptly
 *   3. reject invalid → 400    6. GET the invoice from PayPal — the event body is never payment truth
 */
import { and, eq, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { invoices, paypalEvents } from "../db/schema";
import { newId } from "../ids";
import { getPayPal, paypalMode } from "../paypal/client";
import { invoiceIdFromEvent } from "../paypal/invoicing";
import { readWebhookHeaders, verifyWebhookSignature } from "../paypal/webhook-verify";
import { onInvoicePaid } from "./invoices";
import { bounties } from "../db/schema";
import { getAuthorization } from "../paypal/payments";
import { syncPayout } from "./bounties";
import { audit } from "./audit";

type IngestResult = { status: 200 | 400; body: { ok: boolean; duplicate?: boolean; eventId?: string; error?: string }; internalId?: string };
type RawEvent = { id?: string; event_type?: string; resource_type?: string; summary?: string; resource?: Record<string, unknown> };

export async function ingestWebhook(rawBody: string, headers: Headers): Promise<IngestResult> {
  const verdict = await verifyWebhookSignature({ headers: readWebhookHeaders(headers), rawBody, webhookId: process.env.PAYPAL_WEBHOOK_ID, paypal: getPayPal() });
  if (!verdict.ok) {
    console.warn(`[webhook] rejected: ${verdict.reason}`);
    return { status: 400, body: { ok: false, error: "invalid signature" } };
  }
  return persistEvent(rawBody, "SUCCESS");
}

/** Events from the built-in simulator skip signature verification and are refused outside simulated mode. */
export async function ingestSimulatedEvent(event: Record<string, unknown>): Promise<IngestResult> {
  if (paypalMode() !== "simulated") throw new Error("simulated events are only accepted in PAYPAL_MODE=simulated");
  return persistEvent(JSON.stringify(event), "SIMULATED");
}

async function persistEvent(rawBody: string, verification: "SUCCESS" | "SIMULATED"): Promise<IngestResult> {
  let ev: RawEvent;
  try { ev = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, error: "malformed JSON" } }; }
  if (!ev.id || !ev.event_type) return { status: 400, body: { ok: false, error: "missing id/event_type" } };
  const internalId = newId("evt");
  const inserted = await getDb().insert(paypalEvents).values({
    id: internalId, paypalEventId: ev.id, eventType: ev.event_type, resourceType: ev.resource_type ?? null,
    resourceId: invoiceIdFromEvent(ev.resource), summary: ev.summary ?? null, verification, payload: ev as Record<string, unknown>,
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
  try {
    let status: "PROCESSED" | "IGNORED" = "IGNORED";
    let invoiceId: string | null = null;
    const res = (ev.payload as { resource?: Record<string, unknown> }).resource ?? {};
    if (ev.eventType === "PAYMENT.AUTHORIZATION.VOIDED" && typeof res.id === "string") {
      // fires on our own voids and when PayPal lets an authorization lapse: re-read it and close the bounty if it lapsed
      const b = await db.query.bounties.findFirst({ where: eq(bounties.authorizationId, res.id) });
      if (b && ["OPEN", "CLAIMED", "IN_REVIEW", "DISPUTED"].includes(b.status)) {
        const auth = await getAuthorization(getPayPal(), res.id);
        if (auth.status === "VOIDED") {
          const [x] = await db.update(bounties).set({ status: "EXPIRED", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(bounties.id, b.id), eq(bounties.status, b.status))).returning();
          if (x) await audit(db, { freelancerId: b.companyId, subjectId: b.id, actor: "paypal", action: "bounty.reservation_lapsed", ref: res.id, outcome: "INFO", detail: { via: "webhook" } });
        }
      }
      status = b ? "PROCESSED" : "IGNORED";
    } else if (ev.eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
      const batchId = typeof res.payout_batch_id === "string" ? res.payout_batch_id : null;
      const b = batchId ? await db.query.bounties.findFirst({ where: eq(bounties.payoutBatchId, batchId) }) : undefined;
      if (b) { await syncPayout(b.id); status = "PROCESSED"; } // authoritative GET of the batch
    } else if (ev.eventType.startsWith("PAYMENT.CAPTURE.")) {
      status = "IGNORED"; // captures are made synchronously on approval and read back from the response
    } else if (ev.eventType.startsWith("INVOICING.INVOICE.") && ev.resourceId) {
      const inv = await db.query.invoices.findFirst({ where: eq(invoices.paypalInvoiceId, ev.resourceId) });
      if (inv) {
        invoiceId = inv.id;
        // PAID also fires for partial and pending payments; CANCELLED/UPDATED are reconciled the same way.
        await onInvoicePaid(ev.resourceId, `webhook ${ev.eventType}`);
        status = "PROCESSED";
      }
    }
    await db.update(paypalEvents).set({ processingStatus: status, processedAt: new Date(), invoiceId, processingError: null }).where(eq(paypalEvents.id, ev.id));
  } catch (e) {
    await db.update(paypalEvents).set({ processingStatus: "FAILED", processingError: String(e).slice(0, 500) }).where(eq(paypalEvents.id, ev.id));
    throw e;
  }
}

/** Retry failed/unprocessed events (bounded). */
export async function retryEvents(maxAttempts = 5) {
  const stuck = await getDb().select().from(paypalEvents)
    .where(and(or(eq(paypalEvents.processingStatus, "FAILED"), eq(paypalEvents.processingStatus, "RECEIVED")), lt(paypalEvents.attempts, maxAttempts))).limit(50);
  for (const e of stuck) {
    try { await processEvent(e.id); } catch { /* recorded on the event */ }
  }
  return stuck.length;
}

/** Simulated mode: hand the simulator's queued events to our own handler, as PayPal would. */
export async function deliverSimulatedEvents(): Promise<number> {
  const { takeSimOutbox } = await import("../paypal/emulator");
  const events = await takeSimOutbox();
  for (const e of events) {
    const r = await ingestSimulatedEvent(e);
    if (r.internalId) await processEvent(r.internalId);
  }
  return events.length;
}
