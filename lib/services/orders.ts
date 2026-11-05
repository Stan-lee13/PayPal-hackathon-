/**
 * Order lifecycle: create Kept order + PayPal order (bound via custom_id),
 * capture, and sync AUTHORITATIVE capture facts (always via GET).
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { chatSessions, merchants, orders, sources, type Order } from "../db/schema";
import { newId, newReceiptToken } from "../ids";
import { getPayPal } from "../paypal/client";
import { captureOrder, createOrder, getCapture, getOrder, parseOrderCaptureRef, type CaptureFacts } from "../paypal/api";
import { serializeTranscript } from "../promises/transcript";
import { redactEmail } from "../security/redact";
import { audit } from "./audit";
import { cartLines } from "./chat";
import { planCheckout } from "./checkout-guard";
import { formatMoney } from "../money";

export class UserFacingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Step 1 of checkout. Prices are recomputed server-side from DB prices; the chat
 * transcript is snapshotted into an immutable source tied to this order.
 */
export async function createOrderFromSession(sessionId: string): Promise<{ keptOrderId: string; paypalOrderId: string }> {
  const db = getDb();
  const { session, lines } = await cartLines(sessionId);
  if (lines.length === 0) throw new UserFacingError("Your bag is empty.");
  if (session.orderId) {
    const existing = await db.query.orders.findFirst({ where: eq(orders.id, session.orderId) });
    if (existing?.paypalOrderId && (existing.status === "PAYPAL_CREATED" || existing.status === "APPROVED")) {
      return { keptOrderId: existing.id, paypalOrderId: existing.paypalOrderId };
    }
    throw new UserFacingError("This conversation already has a placed order.");
  }
  const merchant = await db.query.merchants.findFirst({ where: eq(merchants.id, session.merchantId) });
  if (!merchant) throw new Error("merchant missing");
  if (session.mode === "agent" && session.agentVerdict?.decision !== "PROCEED") {
    throw new UserFacingError("Your agent has not cleared this purchase against your mandate.", 409);
  }
  const { price, guard } = planCheckout(session.messages, lines, session.shippingOption, merchant.policy, merchant.currency);
  const keptOrderId = newId("ko");
  const transcript = serializeTranscript(session.messages);

  await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      id: keptOrderId,
      merchantId: merchant.id,
      chatSessionId: session.id,
      status: "DRAFT",
      currency: merchant.currency,
      lines: lines.map((l) => ({ productId: l.product.id, sku: l.product.sku, name: l.product.name, qty: l.qty, unitMinor: l.product.priceMinor })),
      itemTotalMinor: price.itemTotalMinor,
      shippingMinor: price.shippingMinor - price.promoMinor,
      taxMinor: price.taxMinor,
      requestedTotalMinor: guard.totalMinor,
      receiptToken: newReceiptToken(),
    });
    if (transcript.trim()) {
      await tx.insert(sources).values({
        id: newId("src"),
        merchantId: merchant.id,
        orderId: keptOrderId,
        kind: "CHAT_TRANSCRIPT",
        title: `Sales chat ${session.id}`,
        text: transcript,
        sha256: createHash("sha256").update(transcript).digest("hex"),
      });
    }
    if (session.mode === "agent" && session.mandate) {
      await tx.insert(sources).values({
        id: newId("src"),
        merchantId: merchant.id,
        orderId: keptOrderId,
        kind: "USER_MANDATE",
        title: "Shopper's mandate to their agent",
        text: session.mandate,
        sha256: createHash("sha256").update(session.mandate).digest("hex"),
      });
    }
    // Lock the conversation to this order: later messages cannot alter the evidence.
    await tx.update(chatSessions).set({ orderId: keptOrderId, updatedAt: new Date() }).where(eq(chatSessions.id, session.id));
    await audit(tx, { merchantId: merchant.id, orderId: keptOrderId, actor: "customer", action: "order.created", ref: keptOrderId, outcome: "OK",
      detail: { requestedTotal: formatMoney(guard.totalMinor, merchant.currency), lines: lines.length, shipping: session.shippingOption } });
    if (guard.action !== "NONE") {
      await audit(tx, { merchantId: merchant.id, orderId: keptOrderId, actor: "system", action: guard.action === "HONOR" ? "checkout_guard.honored" : "checkout_guard.warned", ref: keptOrderId,
        outcome: guard.action === "HONOR" ? "OK" : "INFO",
        detail: { promised: formatMoney(guard.quotedMinor!, merchant.currency), checkout: formatMoney(guard.checkoutMinor, merchant.currency), gap: formatMoney(guard.gapMinor, merchant.currency), charged: formatMoney(guard.totalMinor, merchant.currency), quote: guard.quote, reason: guard.reason } });
    }
  });

  try {
    const pp = await createOrder(getPayPal(), {
      keptOrderId,
      currency: merchant.currency,
      itemTotalMinor: price.itemTotalMinor,
      shippingMinor: price.shippingMinor,
      shippingDiscountMinor: price.promoMinor,
      discountMinor: guard.honorDiscountMinor,
      taxMinor: price.taxMinor,
      totalMinor: guard.totalMinor,
      lines: lines.map((l) => ({ name: l.product.name, sku: l.product.sku, qty: l.qty, unitMinor: l.product.priceMinor })),
      description: `${merchant.name} order ${keptOrderId}`,
      requestId: `create-${keptOrderId}`,
      returnUrl: `${appBaseUrl()}/store?paid=${keptOrderId}`,
      cancelUrl: `${appBaseUrl()}/store`,
    });
    await db.update(orders).set({ paypalOrderId: pp.id, status: "PAYPAL_CREATED", updatedAt: new Date() }).where(eq(orders.id, keptOrderId));
    await audit(db, { merchantId: merchant.id, orderId: keptOrderId, actor: "paypal", action: "paypal.order.created", ref: pp.id, outcome: "OK", detail: { status: pp.status, customId: keptOrderId } });
    return { keptOrderId, paypalOrderId: pp.id };
  } catch (e) {
    await audit(db, { merchantId: merchant.id, orderId: keptOrderId, actor: "paypal", action: "paypal.order.create_failed", ref: keptOrderId, outcome: "FAILED", detail: { error: String(e) } });
    // release the chat so the customer can retry
    await db.update(chatSessions).set({ orderId: null }).where(eq(chatSessions.id, session.id));
    throw new UserFacingError("PayPal could not create the order. Please try again.", 502);
  }
}

/**
 * Step 2: the buyer approved in PayPal; capture. The capture id comes from
 * PayPal's response, then the capture itself is re-fetched with GET before
 * anything is believed.
 */
export async function captureKeptOrder(keptOrderId: string, paypalOrderId: string): Promise<Order> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, keptOrderId) });
  if (!order) throw new UserFacingError("Unknown order.", 404);
  if (!order.paypalOrderId || order.paypalOrderId !== paypalOrderId) throw new UserFacingError("PayPal order does not belong to this Kept order.", 409);
  if (order.paypalCaptureId) return order; // already captured (idempotent)

  const pp = getPayPal();
  let ref: ReturnType<typeof parseOrderCaptureRef>;
  try {
    ref = parseOrderCaptureRef(await captureOrder(pp, paypalOrderId, `capture-${keptOrderId}`));
  } catch (e) {
    // The capture may have happened even if we lost the response: ask PayPal.
    ref = parseOrderCaptureRef(await getOrder(pp, paypalOrderId));
    if (!ref.captureId) {
      await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "paypal", action: "paypal.capture.failed", ref: paypalOrderId, outcome: "FAILED", detail: { error: String(e) } });
      throw new UserFacingError("PayPal could not capture the payment.", 502);
    }
  }
  if (ref.customId !== keptOrderId) throw new Error(`custom_id mismatch: PayPal ${ref.customId} vs Kept ${keptOrderId}`);
  if (!ref.captureId) throw new UserFacingError("PayPal returned no capture.", 502);
  await db.update(orders).set({
    paypalCaptureId: ref.captureId,
    buyerFirstName: ref.payerFirstName?.slice(0, 40) ?? null,
    buyerEmailRedacted: redactEmail(ref.payerEmail),
    status: "APPROVED",
    updatedAt: new Date(),
  }).where(and(eq(orders.id, keptOrderId), sql`${orders.paypalCaptureId} is null`));
  await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "paypal", action: "paypal.order.captured", ref: ref.captureId, outcome: "OK", detail: { reportedStatus: ref.captureStatus } });
  const facts = await getCapture(pp, ref.captureId);
  return syncCapture(facts, "capture_call");
}

/**
 * Write authoritative capture facts onto the bound order. Binding is strict:
 * the capture's custom_id must equal a Kept order id (or its capture id must
 * already be recorded on that order). Never matched by name/email/amount.
 */
export async function syncCapture(facts: CaptureFacts, via: string): Promise<Order> {
  const db = getDb();
  let order = facts.customId ? await db.query.orders.findFirst({ where: eq(orders.id, facts.customId) }) : undefined;
  if (!order) order = await db.query.orders.findFirst({ where: eq(orders.paypalCaptureId, facts.captureId) });
  if (!order) throw new Error(`No Kept order bound to capture ${facts.captureId} (custom_id ${facts.customId ?? "none"})`);
  if (order.paypalCaptureId && order.paypalCaptureId !== facts.captureId) throw new Error(`Order ${order.id} is bound to a different capture`);
  if (facts.paypalOrderId && order.paypalOrderId && facts.paypalOrderId !== order.paypalOrderId) throw new Error("Capture belongs to a different PayPal order");

  const status: Order["status"] = facts.status === "PENDING" ? "CAPTURE_PENDING" : facts.status === "DECLINED" || facts.status === "FAILED" ? "CAPTURE_DECLINED" : "CAPTURED";
  const [updated] = await db.update(orders).set({
    paypalCaptureId: facts.captureId,
    status,
    captureStatus: facts.status,
    captureStatusReason: facts.statusReason,
    captureAmountMinor: facts.amountMinor,
    captureCurrency: facts.currency,
    paypalFeeMinor: facts.feeMinor,
    netAmountMinor: facts.netMinor,
    capturedAt: order.capturedAt ?? facts.createdAt ?? new Date(),
    captureVerifiedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(orders.id, order.id)).returning();
  if (order.captureStatus !== facts.status || order.captureAmountMinor !== facts.amountMinor) {
    await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "paypal", action: "paypal.capture.verified", ref: facts.captureId, outcome: "OK",
      detail: { via, status: facts.status, amount: formatMoney(facts.amountMinor, facts.currency), fee: facts.feeMinor !== null ? formatMoney(facts.feeMinor, facts.currency) : null } });
  }
  return updated!;
}
