/**
 * Order lifecycle: create Kept order + PayPal order (bound via custom_id),
 * capture, and sync AUTHORITATIVE capture facts (always via GET).
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appBaseUrl } from "../base-url";
import { chatSessions, merchants, orders, preflights, sources, type Order, type Preflight } from "../db/schema";
import { newId, newReceiptToken } from "../ids";
import { getPayPal } from "../paypal/client";
import { captureOrder, createOrder, getCapture, getOrder, parseOrderCaptureRef, type CaptureFacts } from "../paypal/api";
import { serializeTranscript } from "../promises/transcript";
import { redactEmail } from "../security/redact";
import { audit } from "./audit";
import { cartLines } from "./chat";
import { gateEnforced, guardMode, planCheckout } from "./checkout-guard";
import { explain, latestPreflight, orderStatusAfter, runPreflight } from "./preflight";
import { formatMoney } from "../money";

export class UserFacingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
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

/** A capture the gate refused. Carries the coded verdict for the UI (HTTP 409). */
export class CaptureBlockedError extends UserFacingError {
  constructor(message: string, public readonly preflight: Record<string, unknown>) { super(message, 409); }
}

const CLAIMABLE: Order["status"][] = ["PAYPAL_CREATED", "APPROVED", "READY_TO_CAPTURE", "CAPTURE_BLOCKED", "NEEDS_CONFIRMATION", "PRECHECK_FAILED"];

/**
 * Step 2: the buyer approved in PayPal; capture — through Kept's gate.
 *  1. Claim the order atomically (one conditional UPDATE) so concurrent requests cannot both proceed.
 *  2. Preflight: GET the authoritative PayPal order and compare it with the promised total.
 *     In the protected checkout (BLOCK/HONOR) only READY_TO_CAPTURE — or a merchant-confirmed
 *     NEEDS_CONFIRMATION bound to this exact order digest — may capture. Failures fail closed.
 *  3. Write-ahead: record `capture.requested` (with the order digest) on the audit chain first.
 *  4. Capture with a PayPal-Request-Id per PayPal order; then re-fetch the capture with GET.
 * External-channel orders are never gated here: Kept monitors them after payment.
 */
export async function captureKeptOrder(keptOrderId: string, paypalOrderId: string): Promise<Order> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, keptOrderId) });
  if (!order) throw new UserFacingError("Unknown order.", 404);
  if (order.supersededPaypalOrderIds.includes(paypalOrderId)) throw new UserFacingError("This PayPal order was replaced by a corrected one and will not be captured.", 409);
  if (!order.paypalOrderId || order.paypalOrderId !== paypalOrderId) throw new UserFacingError("PayPal order does not belong to this Kept order.", 409);
  if (order.paypalCaptureId) return order; // already captured (idempotent)

  const [claimed] = await db.update(orders).set({ status: "PREFLIGHT_VALIDATING", updatedAt: new Date() })
    .where(and(eq(orders.id, keptOrderId), eq(orders.paypalOrderId, paypalOrderId), isNull(orders.paypalCaptureId), inArray(orders.status, CLAIMABLE)))
    .returning();
  if (!claimed) {
    const now = (await db.query.orders.findFirst({ where: eq(orders.id, keptOrderId) }))!;
    if (now.paypalCaptureId) return now;
    throw new UserFacingError("This payment is already being processed.", 409);
  }
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }))!;
  const enforced = order.checkoutChannel === "KEPT_PROTECTED" && gateEnforced(guardMode(merchant.policy));
  const pf = await runPreflight(claimed, { enforced, actor: "customer" });

  if (!pf.allowCapture) {
    await db.update(orders).set({ status: orderStatusAfter(pf.verdict), updatedAt: new Date() }).where(eq(orders.id, keptOrderId));
    throw new CaptureBlockedError(pf.explanation, preflightView(pf));
  }

  // Write-ahead: no capture call unless the request is on the audit chain.
  await db.transaction(async (tx) => {
    await tx.update(orders).set({ status: "CAPTURE_REQUESTED", updatedAt: new Date() }).where(and(eq(orders.id, keptOrderId), eq(orders.status, "PREFLIGHT_VALIDATING")));
    await tx.update(preflights).set({ consumedAt: new Date() }).where(eq(preflights.id, pf.id));
    await audit(tx, { merchantId: order.merchantId, orderId: order.id, actor: "system", action: "capture.requested", ref: paypalOrderId, outcome: "OK",
      detail: { verdict: pf.verdict, enforced, orderDigest: pf.orderDigest, amount: pf.orderMinor !== null && pf.orderCurrency ? formatMoney(pf.orderMinor, pf.orderCurrency) : null } });
  });

  const pp = getPayPal();
  let ref: ReturnType<typeof parseOrderCaptureRef>;
  try {
    ref = parseOrderCaptureRef(await captureOrder(pp, paypalOrderId, `capture-${paypalOrderId}`));
  } catch (e) {
    // Outcome unknown: ask PayPal rather than capturing again.
    ref = parseOrderCaptureRef(await getOrder(pp, paypalOrderId));
    if (!ref.captureId) {
      await db.update(orders).set({ status: "APPROVED", updatedAt: new Date() }).where(eq(orders.id, keptOrderId));
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
  if (pf.orderMinor !== null && facts.amountMinor !== pf.orderMinor) {
    await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: "system", action: "capture.amount_differs_from_verified", ref: ref.captureId, outcome: "FAILED",
      detail: { verified: pf.orderMinor, captured: facts.amountMinor } });
  }
  return syncCapture(facts, "capture_call");
}

export function preflightView(p: Preflight & { explanation?: string }) {
  return {
    verdict: p.verdict, reasons: p.reasonCodes, enforced: p.enforced, paypalOrderId: p.paypalOrderId, promisedMinor: p.promisedMinor, promisedCurrency: p.promisedCurrency,
    orderMinor: p.orderMinor, orderCurrency: p.orderCurrency, diffMinor: p.diffMinor, quote: p.quote, checkedAt: p.checkedAt.toISOString(), explanation: p.explanation ?? explain(p),
  };
}

/**
 * Merchant fixes a BLOCKED_MISMATCH: Kept creates a NEW PayPal order at the promised total (the
 * difference shown as a labelled discount). The buyer must approve it in PayPal; the blocked order
 * is never captured. There is no override that captures an amount the buyer did not approve.
 */
export async function correctBlockedOrder(keptOrderId: string, merchantId: string): Promise<{ paypalOrderId: string }> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, keptOrderId), eq(orders.merchantId, merchantId)) });
  if (!order) throw new UserFacingError("Order not found.", 404);
  if (order.status !== "CAPTURE_BLOCKED" || order.paypalCaptureId) throw new UserFacingError("Only a checkout blocked by Kept can be corrected.", 409);
  const pf = await latestPreflight(order.id);
  if (!pf || pf.verdict !== "BLOCKED_MISMATCH" || pf.paypalOrderId !== order.paypalOrderId) throw new UserFacingError("No blocking verdict for the current PayPal order.", 409);
  if (pf.promisedMinor === null || pf.promisedCurrency !== order.currency) throw new UserFacingError("The promise is in another currency; correct the price with the customer instead.", 409);
  const gross = order.itemTotalMinor + order.shippingMinor + order.taxMinor;
  const discount = gross - pf.promisedMinor;
  if (discount <= 0 || discount > order.itemTotalMinor) throw new UserFacingError("The promised total cannot be expressed as a discount on this order.", 409);
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, merchantId) }))!;
  const n = order.supersededPaypalOrderIds.length + 1;
  const created = await createOrder(getPayPal(), {
    keptOrderId: order.id, currency: order.currency, itemTotalMinor: order.itemTotalMinor, shippingMinor: order.shippingMinor, shippingDiscountMinor: 0,
    discountMinor: discount, taxMinor: order.taxMinor, totalMinor: pf.promisedMinor,
    lines: order.lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty, unitMinor: l.unitMinor })),
    description: `${merchant.name} order ${order.id} (corrected to the promised total)`,
    requestId: `create-${order.id}-c${n}`, returnUrl: `${appBaseUrl()}/store?paid=${order.id}`, cancelUrl: `${appBaseUrl()}/store`,
  });
  const old = order.paypalOrderId!;
  // Prove the blocked order was never captured (authoritative GET).
  let oldStatus = "UNKNOWN";
  try { oldStatus = String((await getOrder(getPayPal(), old)).status ?? "UNKNOWN"); } catch { /* recorded as UNKNOWN */ }
  await db.transaction(async (tx) => {
    await tx.update(orders).set({ paypalOrderId: created.id, supersededPaypalOrderIds: [...order.supersededPaypalOrderIds, old], requestedTotalMinor: pf.promisedMinor!, status: "PAYPAL_CREATED", updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), eq(orders.status, "CAPTURE_BLOCKED")));
    await tx.update(preflights).set({ resolution: "CORRECTED_ORDER", resolvedBy: "merchant", resolvedAt: new Date() }).where(eq(preflights.id, pf.id));
    await audit(tx, { merchantId, orderId: order.id, actor: "merchant", action: "checkout.corrected", ref: created.id, outcome: "OK",
      detail: { from: formatMoney(gross, order.currency), to: formatMoney(pf.promisedMinor!, order.currency), discount: formatMoney(discount, order.currency), blockedPaypalOrderId: old, blockedOrderStatusAtPayPal: oldStatus, newPaypalOrderId: created.id } });
  });
  return { paypalOrderId: created.id };
}

/** Merchant confirms the amount the buyer already approved, for a NEEDS_CONFIRMATION verdict (bound to that order digest). */
export async function confirmPreflightAmount(keptOrderId: string, merchantId: string) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, keptOrderId), eq(orders.merchantId, merchantId)) });
  if (!order) throw new UserFacingError("Order not found.", 404);
  const pf = await latestPreflight(order.id);
  if (!pf || pf.verdict !== "NEEDS_CONFIRMATION" || !pf.orderDigest || pf.paypalOrderId !== order.paypalOrderId) throw new UserFacingError("Nothing awaits confirmation for this order.", 409);
  await db.update(preflights).set({ resolution: "MERCHANT_CONFIRMED_AMOUNT", resolvedBy: "merchant", resolvedAt: new Date() }).where(eq(preflights.id, pf.id));
  await audit(db, { merchantId, orderId: order.id, actor: "merchant", action: "preflight.amount_confirmed", ref: pf.paypalOrderId, outcome: "OK",
    detail: { amount: pf.orderMinor !== null && pf.orderCurrency ? formatMoney(pf.orderMinor, pf.orderCurrency) : null, orderDigest: pf.orderDigest, reasons: pf.reasonCodes } });
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
