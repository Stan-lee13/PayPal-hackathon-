/**
 * Read models for the merchant console and the customer receipt.
 * Customer view exposes only what the customer is entitled to see.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog, commitments, disputes, merchants, orders, paypalEvents, refunds, remedies, sources, trackers, type Commitment, type Remedy } from "../db/schema";
import { effectiveNow } from "../clock";

export const STATE_PRIORITY: Record<string, number> = { BROKEN: 0, AT_RISK: 1, NEEDS_CONFIRMATION: 2, PENDING: 3, KEPT: 4, UNVERIFIABLE: 5, WAIVED: 6 };

export async function getOrderBundle(orderId: string) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return null;
  const [cms, rems, refs, trks, evs, auditRows, disps, srcs, merchant] = await Promise.all([
    db.select().from(commitments).where(eq(commitments.orderId, orderId)),
    db.select().from(remedies).where(eq(remedies.orderId, orderId)).orderBy(desc(remedies.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)),
    db.select().from(trackers).where(eq(trackers.orderId, orderId)),
    db.select().from(paypalEvents).where(eq(paypalEvents.orderId, orderId)).orderBy(asc(paypalEvents.receivedAt)),
    db.select().from(auditLog).where(eq(auditLog.orderId, orderId)).orderBy(asc(auditLog.createdAt), asc(auditLog.id)),
    db.select().from(disputes).where(eq(disputes.orderId, orderId)),
    db.select().from(sources).where(eq(sources.orderId, orderId)),
    db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }),
  ]);
  const commitmentSources = await db.select().from(sources).where(inArray(sources.id, [...new Set(cms.map((c) => c.sourceId)), "__none__"]));
  cms.sort((a, b) => (STATE_PRIORITY[a.state] ?? 9) - (STATE_PRIORITY[b.state] ?? 9));
  return { order, commitments: cms, remedies: rems, refunds: refs, trackers: trks, events: evs, audit: auditRows, disputes: disps, orderSources: srcs, commitmentSources, merchant: merchant! };
}

export type InboxRow = { commitment: Commitment; order: typeof orders.$inferSelect; remedy: Remedy | null; sourceKind: string | null };

export async function getInbox(merchantId: string): Promise<InboxRow[]> {
  const db = getDb();
  const cms = await db.select().from(commitments).where(eq(commitments.merchantId, merchantId));
  if (cms.length === 0) return [];
  const ords = await db.select().from(orders).where(inArray(orders.id, [...new Set(cms.map((c) => c.orderId))]));
  const rems = await db.select().from(remedies).where(and(eq(remedies.merchantId, merchantId), inArray(remedies.state, ["PROPOSED", "EXECUTING", "PENDING", "FAILED"])));
  const srcs = await db.select({ id: sources.id, kind: sources.kind }).from(sources).where(inArray(sources.id, [...new Set(cms.map((c) => c.sourceId)), "__none__"]));
  return cms
    .map((c) => ({ commitment: c, order: ords.find((o) => o.id === c.orderId)!, remedy: rems.find((r) => r.commitmentId === c.id) ?? null, sourceKind: srcs.find((x) => x.id === c.sourceId)?.kind ?? null }))
    .sort((a, b) => (STATE_PRIORITY[a.commitment.state] ?? 9) - (STATE_PRIORITY[b.commitment.state] ?? 9) || b.order.createdAt.getTime() - a.order.createdAt.getTime());
}

export async function listOrders(merchantId: string) {
  return getDb().select().from(orders).where(eq(orders.merchantId, merchantId)).orderBy(desc(orders.createdAt)).limit(100);
}

/** Orders with their promise tallies, for the orders grid. */
export async function listOrdersWithPromises(merchantId: string) {
  const ords = await listOrders(merchantId);
  const cms = ords.length ? await getDb().select({ orderId: commitments.orderId, state: commitments.state, evaluation: commitments.evaluation }).from(commitments).where(inArray(commitments.orderId, ords.map((o) => o.id))) : [];
  return ords.map((o) => {
    const mine = cms.filter((c) => c.orderId === o.id);
    return { order: o, promises: mine.length, broken: mine.filter((c) => c.state === "BROKEN" && c.evaluation?.madeGood !== true).length, madeGood: mine.filter((c) => c.state === "BROKEN" && c.evaluation?.madeGood === true).length };
  });
}

export async function merchantAudit(merchantId: string, limit = 200) {
  return getDb().select().from(auditLog).where(eq(auditLog.merchantId, merchantId)).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit);
}

/** Customer receipt. Token is the only key; nothing else about the merchant is exposed. */
export async function getReceipt(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.receiptToken, token) });
  if (!order) return null;
  const b = await getOrderBundle(order.id);
  if (!b) return null;
  const now = effectiveNow(b.merchant.demoClockOffsetMs);
  const customerActions = b.audit.filter((a) => CUSTOMER_VISIBLE_ACTIONS.has(a.action));
  return {
    merchantName: b.merchant.name,
    supportEmail: b.merchant.policy.supportEmail,
    order: {
      id: order.id, createdAt: order.createdAt, currency: order.currency, lines: order.lines, status: order.status,
      paypalOrderId: order.paypalOrderId, captureId: order.paypalCaptureId, captureStatus: order.captureStatus,
      captureAmountMinor: order.captureAmountMinor, captureCurrency: order.captureCurrency, capturedAt: order.capturedAt,
      captureVerifiedAt: order.captureVerifiedAt, refundedMinor: order.refundedMinor, buyerFirstName: order.buyerFirstName,
    },
    promises: b.commitments.map((c) => ({ id: c.id, type: c.type, quote: c.quote, state: c.state, reason: c.stateReason, dueAt: c.dueAt, evaluation: c.evaluation, sourceKind: b.commitmentSources.find((s) => s.id === c.sourceId)?.kind ?? null })),
    remedies: b.remedies.filter((r) => r.state !== "SUPERSEDED").map((r) => ({ id: r.id, kind: r.kind, state: r.state, amountMinor: r.amountMinor, currency: r.currency, customerMessage: r.state === "PROPOSED" ? null : r.customerMessage, refundId: r.paypalRefundId, decidedAt: r.decidedAt, completedAt: r.completedAt })),
    refunds: b.refunds.map((r) => ({ id: r.paypalRefundId, amountMinor: r.amountMinor, currency: r.currency, status: r.status, statusReason: r.statusReason, verifiedAt: r.verifiedAt })),
    trackers: b.trackers.map((t) => ({ carrier: t.carrier, trackingNumber: t.trackingNumber, recordedAt: t.recordedAt })),
    disputes: b.disputes.map((d) => ({ id: d.paypalDisputeId, reason: d.reason, status: d.status, stage: d.stage })),
    timeline: customerActions.map((a) => ({ at: a.createdAt, action: a.action, outcome: a.outcome, detail: a.detail })),
    now,
    simulatedClock: b.merchant.demoClockOffsetMs !== 0,
  };
}

const CUSTOMER_VISIBLE_ACTIONS = new Set([
  "order.created", "paypal.order.created", "paypal.capture.verified", "promises.extracted", "commitment.state_changed",
  "remedy.proposed", "remedy.approved", "remedy.rejected", "paypal.refund.requested", "paypal.refund.verified", "paypal.refund.failed",
  "paypal.tracking.added", "paypal.dispute.verified", "dispute.response_approved", "paypal.dispute_action.accepted", "checkout_guard.honored", "checkout_guard.warned",
]);
