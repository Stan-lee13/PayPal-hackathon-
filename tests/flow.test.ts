/**
 * End-to-end Kept loop against a real Postgres and the LOCAL PayPal EMULATOR
 * (not PayPal). Proves the product logic; real PayPal sandbox verification is a
 * separate manual step documented in the README.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

const { getDb } = await import("../lib/db");
const schema = await import("../lib/db/schema");
const { eq } = await import("drizzle-orm");
const { seedDemoMerchant, resetTransactions } = await import("../lib/services/seed");
const chat = await import("../lib/services/chat");
const orders = await import("../lib/services/orders");
const pipeline = await import("../lib/services/pipeline");
const remedies = await import("../lib/services/remedies");
const actions = await import("../lib/services/merchant-actions");
const sim = await import("../lib/services/simulation");
const webhooks = await import("../lib/services/webhooks");
const views = await import("../lib/services/views");
const emu = await import("../lib/paypal/emulator");

async function placeOrder(shipping: "EXPRESS" | "STANDARD", question = "What's my total with shipping?") {
  const sessionId = await chat.createSession();
  await chat.setCart(sessionId, [{ productId: "prd_ada_dress", qty: 1 }], shipping);
  const { reply } = await chat.postCustomerMessage(sessionId, question);
  const { keptOrderId, paypalOrderId } = await orders.createOrderFromSession(sessionId);
  emu.approveEmulatorOrder(paypalOrderId);
  await orders.captureKeptOrder(keptOrderId, paypalOrderId);
  const delivery = await sim.deliverSimulatedEvents({ duplicateFirst: true });
  return { sessionId, reply, keptOrderId, paypalOrderId, delivery };
}

async function commitmentsOf(orderId: string) {
  const rows = await getDb().select().from(schema.commitments).where(eq(schema.commitments.orderId, orderId));
  return Object.fromEntries(rows.map((r) => [r.type, r]));
}

d("Kept end-to-end (emulated PayPal)", () => {
  beforeAll(async () => {
    await seedDemoMerchant(getDb());
  });
  beforeEach(async () => {
    await resetTransactions(getDb());
    emu.resetEmulator();
  });

  it("overcharge: $84.00 promised, $93.33 captured → BROKEN → $9.33 refund approved → confirmed → receipt updated", async () => {
    const { reply, keptOrderId, delivery } = await placeOrder("EXPRESS");
    expect(reply.text).toContain("Your total is $84.00.");
    expect(reply.text).toContain("Your order ships within 48 hours.");
    expect(reply.text).toContain("We'll sort you out if anything goes wrong.");
    expect(delivery.duplicates).toBeGreaterThan(0); // duplicate webhooks were ignored

    const db = getDb();
    const order = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    expect(order.captureAmountMinor).toBe(9333);
    expect(order.captureVerifiedAt).not.toBeNull();

    const cm = await commitmentsOf(keptOrderId);
    expect(cm.PRICE_AS_QUOTED?.state).toBe("BROKEN");
    expect(cm.PRICE_AS_QUOTED?.evaluation).toMatchObject({ discrepancyMinor: 933, promisedMinor: 8400, capturedMinor: 9333 });
    expect(cm.SHIP_BY?.state).toBe("PENDING");
    expect(cm.OTHER?.state).toBe("UNVERIFIABLE");
    expect(cm.REFUND_BY?.state).toBe("PENDING");

    const [proposal] = await db.select().from(schema.remedies).where(eq(schema.remedies.commitmentId, cm.PRICE_AS_QUOTED!.id));
    expect(proposal).toMatchObject({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD", state: "PROPOSED" });
    expect(proposal!.policyChecks.every((c) => c.ok)).toBe(true);

    // nothing moved before approval
    expect((await db.select().from(schema.refunds)).length).toBe(0);

    // two concurrent approvals (double click / two tabs) → exactly one refund
    const results = await Promise.allSettled([remedies.approveRemedy(proposal!.id), remedies.approveRemedy(proposal!.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refundRows = await db.select().from(schema.refunds).where(eq(schema.refunds.orderId, keptOrderId));
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]).toMatchObject({ amountMinor: 933, status: "COMPLETED" });

    const done = (await db.query.remedies.findFirst({ where: eq(schema.remedies.id, proposal!.id) }))!;
    expect(done.state).toBe("COMPLETED");
    expect(done.paypalRefundId).toBeTruthy();

    // refund webhook (and a duplicate) reconcile without a second refund
    await sim.deliverSimulatedEvents({ duplicateFirst: true });
    expect(await db.select().from(schema.refunds).where(eq(schema.refunds.orderId, keptOrderId))).toHaveLength(1);
    const after = await commitmentsOf(keptOrderId);
    expect(after.PRICE_AS_QUOTED?.evaluation).toMatchObject({ outstandingMinor: 0, madeGood: true });

    // no new proposal after it was made good
    expect(await remedies.proposeRemedy(after.PRICE_AS_QUOTED!.id)).toBeNull();

    const o2 = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    expect(o2.refundedMinor).toBe(933);
    expect(o2.captureStatus).toBe("PARTIALLY_REFUNDED");
    const receipt = (await views.getReceipt(o2.receiptToken))!;
    expect(receipt.refunds[0]).toMatchObject({ status: "COMPLETED", amountMinor: 933 });
    expect(receipt.remedies[0]).toMatchObject({ state: "COMPLETED" });
    expect(await views.getReceipt("x".repeat(43))).toBeNull();

    // a second approval attempt is refused
    await expect(remedies.approveRemedy(proposal!.id)).rejects.toThrow(/already/);
  });

  it("matching price: standard shipping $88.50 quoted and captured → KEPT, no remedy", async () => {
    const { reply, keptOrderId } = await placeOrder("STANDARD");
    expect(reply.text).toContain("Your total is $88.50.");
    const cm = await commitmentsOf(keptOrderId);
    expect(cm.PRICE_AS_QUOTED?.state).toBe("KEPT");
    expect(await getDb().select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId))).toHaveLength(0);
  });

  it("refund failure from PayPal is shown as FAILED, never as success", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const db = getDb();
    const [p] = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    const r = await remedies.approveRemedy(p!.id, { mockResponse: "REFUND_FAILED_INSUFFICIENT_FUNDS" });
    expect(r.state).toBe("FAILED");
    expect(r.errorCode).toBe("REFUND_FAILED_INSUFFICIENT_FUNDS");
    expect(await db.select().from(schema.refunds).where(eq(schema.refunds.orderId, keptOrderId))).toHaveLength(0);
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    const receipt = (await views.getReceipt(o.receiptToken))!;
    expect(receipt.refunds).toHaveLength(0);
    expect(receipt.remedies[0]?.state).toBe("FAILED");
  });

  it("pending refund stays PENDING until PayPal confirms COMPLETED", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const db = getDb();
    const [p] = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    const r = await remedies.approveRemedy(p!.id, { mockResponse: "REFUND_PENDING" });
    expect(r.state).toBe("PENDING");
    let cm = await commitmentsOf(keptOrderId);
    expect(cm.PRICE_AS_QUOTED?.evaluation).toMatchObject({ outstandingMinor: 933 }); // pending money is not counted as returned
    expect(await remedies.proposeRemedy(cm.PRICE_AS_QUOTED!.id)).toMatchObject({ id: p!.id }); // no second proposal while one is live
    emu.settlePendingRefunds();
    await sim.deliverSimulatedEvents();
    const after = (await db.query.remedies.findFirst({ where: eq(schema.remedies.id, p!.id) }))!;
    expect(after.state).toBe("COMPLETED");
    cm = await commitmentsOf(keptOrderId);
    expect(cm.PRICE_AS_QUOTED?.evaluation).toMatchObject({ outstandingMinor: 0 });
  });

  it("rejected remedy: nothing moves and it is not re-proposed automatically", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const db = getDb();
    const [p] = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    await remedies.rejectRemedy(p!.id, "Customer agreed to store credit instead");
    await pipeline.refreshOrder(keptOrderId);
    const rows = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    expect(rows.filter((x) => x.kind === "PARTIAL_REFUND").map((x) => x.state)).toEqual(["REJECTED"]);
    expect(await db.select().from(schema.refunds)).toHaveLength(0);
  });

  it("shipping deadline: AT_RISK with no tracking (simulated clock), then KEPT once tracking is added", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    await actions.advanceDemoClock("mer_adaeze", 40);
    let cm = await commitmentsOf(keptOrderId);
    expect(cm.SHIP_BY?.state).toBe("AT_RISK");
    const reminders = await getDb().select().from(schema.remedies).where(eq(schema.remedies.commitmentId, cm.SHIP_BY!.id));
    expect(reminders[0]?.kind).toBe("ADD_TRACKING_REMINDER");
    await actions.addOrderTracking(keptOrderId, "DHL1234567", "DHL");
    cm = await commitmentsOf(keptOrderId);
    expect(cm.SHIP_BY?.state).toBe("KEPT");
    await actions.advanceDemoClock("mer_adaeze", 0);
  });

  it("webhooks: invalid signature rejected without touching state; duplicate event ids ignored", async () => {
    const bad = await webhooks.ingestWebhook(JSON.stringify({ id: "WH-X", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP" } }), new Headers({ "PAYPAL-TRANSMISSION-ID": "t", "PAYPAL-TRANSMISSION-TIME": new Date().toISOString(), "PAYPAL-TRANSMISSION-SIG": "AAAA", "PAYPAL-CERT-URL": "https://evil.example/cert", "PAYPAL-AUTH-ALGO": "SHA256withRSA" }));
    expect(bad.status).toBe(400);
    expect(await getDb().select().from(schema.paypalEvents)).toHaveLength(0);
    const ev = { id: "WH-SIM-DUP", event_type: "CUSTOMER.DISPUTE.UPDATED", resource: { dispute_id: "nope" } };
    expect((await webhooks.ingestSimulatedEvent(ev)).body.duplicate).toBeUndefined();
    expect((await webhooks.ingestSimulatedEvent(ev)).body.duplicate).toBe(true);
  });

  it("binding: a capture whose custom_id names no Kept order is refused", async () => {
    await expect(orders.syncCapture({ captureId: "CAPX", status: "COMPLETED", statusReason: null, amountMinor: 100, currency: "USD", feeMinor: null, netMinor: null, customId: "ko_does_not_exist", paypalOrderId: null, createdAt: null }, "test")).rejects.toThrow(/No Kept order/);
  });

  it("dispute is ingested via authoritative GET and attached to the order", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const o = (await getDb().query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    emu.openEmulatorDispute(o.paypalCaptureId!);
    await sim.deliverSimulatedEvents();
    const ds = await getDb().select().from(schema.disputes).where(eq(schema.disputes.orderId, keptOrderId));
    expect(ds[0]).toMatchObject({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "INQUIRY" });
  });

  it("reconciliation recovers a capture whose webhook never arrived", async () => {
    const sessionId = await chat.createSession();
    await chat.setCart(sessionId, [{ productId: "prd_ada_dress", qty: 1 }], "EXPRESS");
    await chat.postCustomerMessage(sessionId, "total?");
    const { keptOrderId, paypalOrderId } = await orders.createOrderFromSession(sessionId);
    emu.approveEmulatorOrder(paypalOrderId);
    // capture at PayPal happens, but Kept never hears about it (lost response + lost webhook)
    const { getPayPal } = await import("../lib/paypal/client");
    const { captureOrder } = await import("../lib/paypal/api");
    await captureOrder(getPayPal(), paypalOrderId, "lost-response");
    const { drainEmulatorEvents } = emu; drainEmulatorEvents();
    const report = await pipeline.reconcile({ olderThanMinutes: -1 });
    expect(report.ordersChecked).toBeGreaterThan(0);
    const cm = await commitmentsOf(keptOrderId);
    expect(cm.PRICE_AS_QUOTED?.state).toBe("BROKEN");
  });
});
