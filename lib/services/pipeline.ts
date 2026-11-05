/**
 * Glue between payment evidence and the promise ledger.
 */
import { and, eq, inArray, lt, or, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, orders, refunds, remedies } from "../db/schema";
import { getPayPal } from "../paypal/client";
import { getCapture, getOrder, getRefund, parseOrderCaptureRef } from "../paypal/api";
import { evaluateOrder, runExtraction } from "./ledger";
import { executeRefund, proposeRemedy, syncRefund } from "./remedies";
import { syncCapture } from "./orders";
import { audit } from "./audit";

/** After a verified capture: extract promises (once), evaluate, propose remedies. */
export async function afterPaymentEvidence(orderId: string) {
  await runExtraction(orderId);
  await refreshOrder(orderId);
}

/** Re-evaluate an order and propose remedies for anything broken/at risk. */
export async function refreshOrder(orderId: string) {
  const needs = await evaluateOrder(orderId);
  for (const c of needs) await proposeRemedy(c.id);
}

/**
 * Reconciliation sweep (cron / manual). Uses authoritative GETs when webhooks
 * are missing or delayed. Never creates a second refund: stuck EXECUTING
 * remedies are retried with their ORIGINAL PayPal-Request-Id.
 */
export async function reconcile(opts: { olderThanMinutes?: number } = {}) {
  const db = getDb();
  const pp = getPayPal();
  const cutoff = new Date(Date.now() - (opts.olderThanMinutes ?? Number(process.env.RECONCILE_AFTER_MINUTES ?? 2)) * 60_000);
  const report = { capturesChecked: 0, ordersChecked: 0, refundsChecked: 0, remediesRetried: 0, ordersEvaluated: 0, errors: [] as string[] };

  // 1. orders approved/created but no capture recorded → ask PayPal
  const noCapture = await db.select().from(orders).where(and(inArray(orders.status, ["PAYPAL_CREATED", "APPROVED"]), lt(orders.updatedAt, cutoff), isNotNull(orders.paypalOrderId)));
  for (const o of noCapture) {
    try {
      const ref = parseOrderCaptureRef(await getOrder(pp, o.paypalOrderId!));
      report.ordersChecked++;
      if (ref.captureId && ref.customId === o.id) {
        await syncCapture(await getCapture(pp, ref.captureId), "reconcile");
        await afterPaymentEvidence(o.id);
      }
    } catch (e) { report.errors.push(`order ${o.id}: ${String(e).slice(0, 120)}`); }
  }
  // 2. captures not final yet (PENDING) or captured but never verified
  const pendingCaps = await db.select().from(orders).where(and(isNotNull(orders.paypalCaptureId), or(eq(orders.captureStatus, "PENDING"), eq(orders.status, "APPROVED"))));
  for (const o of pendingCaps) {
    try {
      await syncCapture(await getCapture(pp, o.paypalCaptureId!), "reconcile");
      await afterPaymentEvidence(o.id);
      report.capturesChecked++;
    } catch (e) { report.errors.push(`capture ${o.paypalCaptureId}: ${String(e).slice(0, 120)}`); }
  }
  // 3. refunds PayPal still reports as PENDING
  const pendingRefunds = await db.select().from(refunds).where(eq(refunds.status, "PENDING"));
  for (const r of pendingRefunds) {
    try {
      await syncRefund(await getRefund(pp, r.paypalRefundId), r.orderId, "reconcile");
      report.refundsChecked++;
    } catch (e) { report.errors.push(`refund ${r.paypalRefundId}: ${String(e).slice(0, 120)}`); }
  }
  // 4. remedies stuck EXECUTING with unknown outcome → retry with the SAME request id (idempotent at PayPal)
  const stuck = await db.select().from(remedies).where(and(eq(remedies.state, "EXECUTING"), lt(remedies.updatedAt, cutoff)));
  for (const r of stuck) {
    try {
      await audit(db, { merchantId: r.merchantId, orderId: r.orderId, actor: "system", action: "remedy.retry_same_request_id", ref: r.id, outcome: "PENDING", detail: { requestId: r.paypalRequestId } });
      await executeRefund(r);
      report.remediesRetried++;
    } catch (e) { report.errors.push(`remedy ${r.id}: ${String(e).slice(0, 120)}`); }
  }
  // 5. time-based promises (shipping deadlines, refund windows) move with the clock
  const live = await db.selectDistinct({ orderId: commitments.orderId }).from(commitments).where(inArray(commitments.state, ["PENDING", "AT_RISK"]));
  for (const { orderId } of live) {
    try { await refreshOrder(orderId); report.ordersEvaluated++; } catch (e) { report.errors.push(`evaluate ${orderId}: ${String(e).slice(0, 120)}`); }
  }
  return report;
}
