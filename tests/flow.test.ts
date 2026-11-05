/**
 * End-to-end Kept loop against a real Postgres and the LOCAL PayPal EMULATOR
 * (not PayPal). Proves the product logic; real PayPal sandbox verification is a
 * separate manual step documented in the README.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

const { getDb } = await import("../lib/db");
const schema = await import("../lib/db/schema");
const { eq, sql } = await import("drizzle-orm");
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
const ppApi = await import("../lib/paypal/api");
const { getPayPal } = await import("../lib/paypal/client");

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

async function setGuard(mode: "BLOCK" | "WARN" | "HONOR" | "OFF") {
  const db = getDb();
  const [m] = await db.select().from(schema.merchants);
  await db.update(schema.merchants).set({ policy: { ...m!.policy, checkoutGuard: mode } }).where(eq(schema.merchants.id, m!.id));
}

/** Buyer chats, the order is created and APPROVED in PayPal, but not captured. */
async function approvedOrder(shipping: "EXPRESS" | "STANDARD", question = "What's my total with shipping?") {
  const sessionId = await chat.createSession();
  await chat.setCart(sessionId, [{ productId: "prd_ada_dress", qty: 1 }], shipping);
  await chat.postCustomerMessage(sessionId, question);
  const { keptOrderId, paypalOrderId } = await orders.createOrderFromSession(sessionId);
  emu.approveEmulatorOrder(paypalOrderId);
  return { sessionId, keptOrderId, paypalOrderId };
}
const blocked = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { status: number; message: string; preflight?: Record<string, unknown> }; } throw new Error("expected the capture to be refused"); };

async function commitmentsOf(orderId: string) {
  const rows = await getDb().select().from(schema.commitments).where(eq(schema.commitments.orderId, orderId));
  return Object.fromEntries(rows.map((r) => [r.type, r]));
}

d("Kept end-to-end (emulated PayPal)", () => {
  beforeAll(async () => {
    await seedDemoMerchant(getDb());
    // These scenarios are about AFTER payment: run them as a monitor-only checkout (price check = Warn),
    // so a mismatched capture can happen and be repaired. The capture gate has its own suite below.
    await setGuard("WARN");
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

  it("agent-to-agent: shopper's agent clears the $84 quote against a $90 mandate; PayPal's $93.33 breaks both; blame goes to the merchant; refund makes both good", async () => {
    const db = getDb();
    const sessionId = await chat.createSession();
    const run = await chat.runBuyerAgent(sessionId, "Buy me the Ada wrap dress. Keep the total under $90 and it must ship within 2 days.");
    expect(run.verdict.decision).toBe("PROCEED");
    expect(run.messages.some((m) => m.role === "agent")).toBe(true);
    expect(run.messages.some((m) => m.role === "assistant" && m.text.includes("Your total is $84.00."))).toBe(true);
    const { keptOrderId, paypalOrderId } = await orders.createOrderFromSession(sessionId);
    emu.approveEmulatorOrder(paypalOrderId);
    await orders.captureKeptOrder(keptOrderId, paypalOrderId);
    await sim.deliverSimulatedEvents();
    const cm = await commitmentsOf(keptOrderId);
    expect(cm.MANDATE_MAX_TOTAL?.state).toBe("BROKEN");
    expect(cm.MANDATE_MAX_TOTAL?.evaluation).toMatchObject({ attribution: "MERCHANT", capturedMinor: 9333, maxMinor: 9000 });
    expect(cm.MANDATE_SHIP_WITHIN?.state).toBe("PENDING");
    expect(cm.PRICE_AS_QUOTED?.state).toBe("BROKEN");
    // the buyer agent's own lines are never merchant promises
    const agentQuotes = await db.select().from(schema.commitments).where(eq(schema.commitments.orderId, keptOrderId));
    expect(agentQuotes.every((c) => !c.quote.includes("AI shopping agent"))).toBe(true);
    const rems = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    expect(rems).toHaveLength(1); // one fix (on the merchant's price promise), not one per breach
    await remedies.approveRemedy(rems[0]!.id);
    const after = await commitmentsOf(keptOrderId);
    expect(after.MANDATE_MAX_TOTAL?.evaluation).toMatchObject({ netMinor: 8400, madeGood: true });
  });

  it("agent-to-agent: the agent's guard declines a quote over the mandate, and no order can be created", async () => {
    const sessionId = await chat.createSession();
    const run = await chat.runBuyerAgent(sessionId, "Buy me the Ada wrap dress. Keep the total under $80.");
    expect(run.verdict.decision).toBe("DECLINE");
    expect(run.verdict.checks.find((c) => c.check === "quoted_total_within_limit")?.ok).toBe(false);
    await expect(orders.createOrderFromSession(sessionId)).rejects.toThrow(/not cleared/);
  });

  it("agent-to-agent: a mandate without a hard limit never pays", async () => {
    const sessionId = await chat.createSession();
    const run = await chat.runBuyerAgent(sessionId, "Get me something nice from Adaeze Studio, around $90.");
    expect(run.verdict.decision).toBe("DECLINE");
  });

  it("checkout guard HONOR: the PayPal order is created at the promised $84.00, so the promise is KEPT and no refund is needed", async () => {
    const db = getDb();
    const [m] = await db.select().from(schema.merchants);
    await db.update(schema.merchants).set({ policy: { ...m!.policy, checkoutGuard: "HONOR" } }).where(eq(schema.merchants.id, m!.id));
    try {
      const { keptOrderId } = await placeOrder("EXPRESS");
      const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
      expect(o.requestedTotalMinor).toBe(8400);
      expect(o.captureAmountMinor).toBe(8400); // what PayPal actually captured
      const cm = await commitmentsOf(keptOrderId);
      expect(cm.PRICE_AS_QUOTED?.state).toBe("KEPT");
      expect(await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId))).toHaveLength(0);
      const trail = await db.select().from(schema.auditLog).where(eq(schema.auditLog.orderId, keptOrderId));
      expect(trail.some((a) => a.action === "checkout_guard.honored")).toBe(true);
      const receipt = await views.getReceipt(o.receiptToken);
      expect(receipt?.timeline.some((t) => t.action === "checkout_guard.honored")).toBe(true);
    } finally {
      await db.update(schema.merchants).set({ policy: m!.policy }).where(eq(schema.merchants.id, m!.id));
    }
  });

  it("checkout guard WARN (default): the overcharge is recorded before payment and still caught after capture", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const trail = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.orderId, keptOrderId));
    expect(trail.find((a) => a.action === "checkout_guard.warned")?.detail).toMatchObject({ promised: "$84.00", checkout: "$93.33", gap: "$9.33" });
    expect((await commitmentsOf(keptOrderId)).PRICE_AS_QUOTED?.state).toBe("BROKEN");
  });

  it("evidence: every order's audit trail is a SHA-256 chain; the pack verifies offline; tampering is detected", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const db = getDb();
    const ev = await import("../lib/services/evidence");
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    const { verdict } = await ev.orderChain(o.merchantId, keptOrderId);
    expect(verdict.ok).toBe(true);
    expect(verdict.length).toBeGreaterThan(5);
    const pack = (await ev.evidencePack(keptOrderId))!;
    expect(ev.verifyPack(JSON.parse(JSON.stringify(pack))).ok).toBe(true);
    expect(pack.sources.some((s) => s.kind === "REFUND_POLICY")).toBe(true); // merchant-level sources behind policy promises are included
    const receipt = (await views.getReceipt(o.receiptToken))!;
    expect(receipt.fingerprint?.head).toBe(verdict.ok ? verdict.head : "");

    // someone edits history directly in the database
    await db.execute(sql`update audit_log set detail = '{"status":"COMPLETED","amount":"$84.00"}' where order_id = ${keptOrderId} and seq = 3`);
    const after = await ev.orderChain(o.merchantId, keptOrderId);
    expect(after.verdict).toMatchObject({ ok: false, brokenAtSeq: 3 });
    // and an exported pack with an altered source fails offline
    const forged = JSON.parse(JSON.stringify(pack)); forged.sources[0].text += " (edited)";
    expect(ev.verifyPack(forged).ok).toBe(false);
  });

  it("evidence: concurrent writers to one order cannot fork its chain", async () => {
    const { keptOrderId } = await placeOrder("STANDARD");
    const db = getDb();
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    const { audit } = await import("../lib/services/audit");
    await Promise.all(Array.from({ length: 25 }, (_, i) => audit(db, { merchantId: o.merchantId, orderId: keptOrderId, actor: "system", action: "test.concurrent", outcome: "INFO", detail: { i } })));
    const { verdict } = await (await import("../lib/services/evidence")).orderChain(o.merchantId, keptOrderId);
    expect(verdict.ok).toBe(true);
  });

  it("promise record: public aggregate over PayPal-verified outcomes, served over MCP, consulted by the shopper's agent", async () => {
    const { promiseRecord } = await import("../lib/services/promise-record");
    const { handleMcp } = await import("../lib/services/mcp");
    const { keptOrderId } = await placeOrder("EXPRESS"); // $84 promised, $93.33 captured → BROKEN
    const [rem] = await getDb().select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    await remedies.approveRemedy(rem!.id);                    // made good
    await placeOrder("STANDARD");                             // $88.50 → KEPT
    const r = (await promiseRecord("adaeze-studio"))!;
    expect(r).toMatchObject({ data: "SIMULATED", keptAsPromised: 1, brokenThenMadeGood: 1, brokenStillOpen: 0, keptAsPromisedRate: 0.5, keptOrMadeGoodRate: 1, auditChains: { intact: true } });
    expect(r.caveats.join(" ")).toMatch(/Small sample/);
    expect(JSON.stringify(r)).not.toMatch(/Tom|ko_|chat_|@/); // aggregates only: no customer, order or chat data
    const call = await handleMcp({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_promise_record", arguments: { merchant: "adaeze-studio" } } });
    expect((call?.result as { structuredContent: { resolved: number } }).structuredContent.resolved).toBe(2);
    // the shopper's agent reads it, and a "keeps 90%" rule declines on too little history
    const s = await chat.createSession();
    const out = await chat.runBuyerAgent(s, "Buy me the Ada wrap dress. Keep the total under $90 and it must ship within 2 days. Only buy from a shop that keeps at least 90% of its promises.");
    expect(out.verdict.record).toMatch(/kept 1 of 2 resolved promises/);
    expect(out.verdict.decision).toBe("DECLINE");
    expect(out.verdict.checks.find((c) => c.check === "merchant_record_meets_your_bar")?.detail).toMatch(/not enough history/);
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

  it("dispute from the ledger: 'not received' + tracker recorded before deadline → proof of fulfilment submitted via Disputes API after approval", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    await actions.addOrderTracking(keptOrderId, "DHL7654321", "DHL");
    const db = getDb();
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    const disputeId = emu.openEmulatorDispute(o.paypalCaptureId!, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    await sim.deliverSimulatedEvents();
    const [resp] = await db.select().from(schema.remedies).where(eq(schema.remedies.kind, "DISPUTE_OFFER"));
    expect(resp?.disputeAction).toMatchObject({ type: "PROVIDE_EVIDENCE", disputeId, trackingNumber: "DHL7654321" });
    expect((resp?.disputeAction as { note: string }).note).toMatch(/Kept evidence fingerprint \(SHA-256 audit-chain head\): [0-9a-f]{64}/);
    expect(resp!.customerMessage).toMatch(/[0-9a-f]{64}/); // survives the 600-character message limit
    expect(resp?.policyChecks.every((c) => c.ok)).toBe(true);
    // nothing is sent to the Disputes API until the merchant approves
    expect(resp?.state).toBe("PROPOSED");
    const before = (await db.query.disputes.findFirst({ where: eq(schema.disputes.paypalDisputeId, disputeId) }))!;
    expect(before.status).not.toBe("UNDER_REVIEW");
    expect((await ppApi.getDispute(getPayPal(), disputeId)).status).not.toBe("UNDER_REVIEW");
    const done = await remedies.approveRemedy(resp!.id);
    expect(done.state).toBe("COMPLETED");
    const d = (await db.query.disputes.findFirst({ where: eq(schema.disputes.paypalDisputeId, disputeId) }))!;
    expect(d.status).toBe("UNDER_REVIEW");
    // PayPal follows up with CUSTOMER.DISPUTE.UPDATED; that must not produce a second response
    await sim.deliverSimulatedEvents();
    const responses = await db.select().from(schema.remedies).where(eq(schema.remedies.kind, "DISPUTE_OFFER"));
    expect(responses).toHaveLength(1);
    expect(responses[0]!.state).toBe("COMPLETED");
  });

  it("dispute from the ledger: overcharge dispute → offer exactly the $9.33 difference (supersedes the pending refund proposal)", async () => {
    const { keptOrderId } = await placeOrder("EXPRESS");
    const db = getDb();
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    const disputeId = emu.openEmulatorDispute(o.paypalCaptureId!, "INCORRECT_AMOUNT");
    await sim.deliverSimulatedEvents();
    const rows = await db.select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
    const offer = rows.find((r) => r.kind === "DISPUTE_OFFER")!;
    expect(offer.disputeAction).toMatchObject({ type: "MAKE_OFFER", amountMinor: 933, currency: "USD" });
    expect(rows.find((r) => r.kind === "PARTIAL_REFUND")?.state).toBe("SUPERSEDED");
    await remedies.approveRemedy(offer.id);
    const d = (await db.query.disputes.findFirst({ where: eq(schema.disputes.paypalDisputeId, disputeId) }))!;
    expect(d.status).toBe("WAITING_FOR_BUYER_RESPONSE");
    expect(await db.select().from(schema.refunds).where(eq(schema.refunds.orderId, keptOrderId))).toHaveLength(0); // money only moves if the buyer accepts
  });

  it("dispute from the ledger: 'not received' with no tracker → honest refund offer, not a fake defence", async () => {
    const { keptOrderId } = await placeOrder("STANDARD");
    const db = getDb();
    const o = (await db.query.orders.findFirst({ where: eq(schema.orders.id, keptOrderId) }))!;
    emu.openEmulatorDispute(o.paypalCaptureId!, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    await sim.deliverSimulatedEvents();
    const [offer] = await db.select().from(schema.remedies).where(eq(schema.remedies.kind, "DISPUTE_OFFER"));
    expect(offer?.disputeAction).toMatchObject({ type: "MAKE_OFFER", amountMinor: 8850 });
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

  describe("capture gate: the PayPal order is verified against the promise BEFORE capture", () => {
    beforeEach(async () => { await setGuard("BLOCK"); });
    afterAll(async () => { await setGuard("WARN"); });
    const db = () => getDb();
    const orderRow = async (id: string) => (await db().query.orders.findFirst({ where: eq(schema.orders.id, id) }))!;
    const pfs = async (id: string) => db().select().from(schema.preflights).where(eq(schema.preflights.orderId, id));

    it("1. promise matches the PayPal order → READY_TO_CAPTURE, captured", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("STANDARD"); // $88.50 quoted, $88.50 order
      const o = await orders.captureKeptOrder(keptOrderId, paypalOrderId);
      expect(o.captureAmountMinor).toBe(8850);
      expect((await pfs(keptOrderId))[0]).toMatchObject({ verdict: "READY_TO_CAPTURE", enforced: true, promisedMinor: 8850, orderMinor: 8850 });
      const trail = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.orderId, keptOrderId))).map((a) => a.action);
      expect(trail.indexOf("capture.requested")).toBeGreaterThan(-1);
      expect(trail.indexOf("capture.requested")).toBeLessThan(trail.indexOf("paypal.order.captured")); // write-ahead
    });

    it("2. $84.00 promised, $93.33 PayPal order → BLOCKED_MISMATCH; provably not captured", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("EXPRESS");
      const e = await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));
      expect(e.status).toBe(409);
      expect(e.preflight).toMatchObject({ verdict: "BLOCKED_MISMATCH", promisedMinor: 8400, orderMinor: 9333, diffMinor: 933, quote: "Your total is $84.00." });
      const o = await orderRow(keptOrderId);
      expect(o).toMatchObject({ status: "CAPTURE_BLOCKED", paypalCaptureId: null });
      expect((await ppApi.getOrder(getPayPal(), paypalOrderId)).status).toBe("APPROVED"); // PayPal: approved, never captured
    });

    it("3. $84.00 promised, $80.00 order → discrepancy detected (NEEDS_CONFIRMATION); merchant confirms; then captured", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("EXPRESS");
      emu.mutateEmulatorOrderAmount(paypalOrderId, "80.00");
      const e = await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));
      expect(e.preflight).toMatchObject({ verdict: "NEEDS_CONFIRMATION", diffMinor: -400 });
      await orders.confirmPreflightAmount(keptOrderId, (await orderRow(keptOrderId)).merchantId);
      expect((await orders.captureKeptOrder(keptOrderId, paypalOrderId)).captureAmountMinor).toBe(8000);
    });

    it("4. promise in USD, PayPal order in GBP → BLOCKED_MISMATCH (currency)", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("EXPRESS");
      emu.mutateEmulatorOrderAmount(paypalOrderId, "84.00", "GBP");
      const e = await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));
      expect(e.preflight).toMatchObject({ verdict: "BLOCKED_MISMATCH", reasons: expect.arrayContaining(["CURRENCY_MISMATCH"]) });
    });

    it("8. PayPal GET fails → PRECHECK_FAILED; fails closed; nothing captured", async () => {
      const { keptOrderId } = await approvedOrder("STANDARD");
      await db().update(schema.orders).set({ paypalOrderId: "SIM-DOES-NOT-EXIST" }).where(eq(schema.orders.id, keptOrderId));
      const e = await blocked(orders.captureKeptOrder(keptOrderId, "SIM-DOES-NOT-EXIST"));
      expect(e.preflight).toMatchObject({ verdict: "PRECHECK_FAILED", reasons: ["PAYPAL_ORDER_UNAVAILABLE"] });
      expect((await orderRow(keptOrderId)).paypalCaptureId).toBeNull();
    });

    it("9. the order changes after a READY verdict → capture re-verifies and refuses", async () => {
      await setGuard("HONOR"); // order created at the promised $84.00
      const { keptOrderId, paypalOrderId } = await approvedOrder("EXPRESS");
      const pre = await (await import("../lib/services/preflight")).runPreflight(await orderRow(keptOrderId), { enforced: true });
      expect(pre.verdict).toBe("READY_TO_CAPTURE");
      emu.mutateEmulatorOrderAmount(paypalOrderId, "93.33"); // changed by another system after verification
      const e = await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));
      expect(e.preflight).toMatchObject({ verdict: "BLOCKED_MISMATCH", reasons: expect.arrayContaining(["ORDER_CHANGED_SINCE_LAST_CHECK", "AMOUNT_ABOVE_PROMISE"]) });
      expect((await orderRow(keptOrderId)).paypalCaptureId).toBeNull();
    });

    it("10. duplicate concurrent capture requests → exactly one capture", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("STANDARD");
      const results = await Promise.allSettled([orders.captureKeptOrder(keptOrderId, paypalOrderId), orders.captureKeptOrder(keptOrderId, paypalOrderId), orders.captureKeptOrder(keptOrderId, paypalOrderId)]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
      const order = await orderRow(keptOrderId);
      expect(order.paypalCaptureId).toBeTruthy();
      const requests = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.orderId, keptOrderId))).filter((a) => a.action === "capture.requested");
      expect(requests).toHaveLength(1);
    });

    it("11. corrected order: the buyer must approve it; the blocked order is never captured", async () => {
      const { keptOrderId, paypalOrderId } = await approvedOrder("EXPRESS");
      await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));
      const merchantId = (await orderRow(keptOrderId)).merchantId;
      const { paypalOrderId: corrected } = await orders.correctBlockedOrder(keptOrderId, merchantId);
      const notYet = await blocked(orders.captureKeptOrder(keptOrderId, corrected));          // buyer has not approved the corrected amount
      expect(notYet.preflight).toMatchObject({ verdict: "PRECHECK_FAILED", reasons: expect.arrayContaining(["NOT_APPROVED_BY_BUYER"]) });
      const old = await blocked(orders.captureKeptOrder(keptOrderId, paypalOrderId));        // the blocked order can never be captured now
      expect(old.message).toMatch(/replaced/);
      emu.approveEmulatorOrder(corrected);
      const o = await orders.captureKeptOrder(keptOrderId, corrected);
      expect(o.captureAmountMinor).toBe(8400);
      expect((await ppApi.getOrder(getPayPal(), paypalOrderId)).status).toBe("APPROVED"); // still uncaptured at PayPal
      await sim.deliverSimulatedEvents();
      await pipeline.afterPaymentEvidence(keptOrderId);
      expect((await commitmentsOf(keptOrderId)).PRICE_AS_QUOTED?.state).toBe("KEPT");
      const trail = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.orderId, keptOrderId))).map((a) => a.action);
      expect(trail).toEqual(expect.arrayContaining(["preflight.verdict", "checkout.corrected", "capture.requested"]));
    });

    it("Intelligence figures equal database aggregates (prevention + recovery), with no invented rows", async () => {
      const { promiseAnalytics } = await import("../lib/services/analytics");
      // prevention: blocked → corrected → captured at $84.00
      const a = await approvedOrder("EXPRESS");
      await blocked(orders.captureKeptOrder(a.keptOrderId, a.paypalOrderId));
      const { paypalOrderId: fixed } = await orders.correctBlockedOrder(a.keptOrderId, (await orderRow(a.keptOrderId)).merchantId);
      emu.approveEmulatorOrder(fixed);
      await orders.captureKeptOrder(a.keptOrderId, fixed);
      // recovery: captured outside Kept at $93.33, refund approved and confirmed
      const b = await sim.seedExternalCapturedOrder();
      const [rem] = await db().select().from(schema.remedies).where(eq(schema.remedies.orderId, b.keptOrderId));
      await remedies.approveRemedy(rem!.id);
      await sim.deliverSimulatedEvents(); await pipeline.afterPaymentEvidence(a.keptOrderId);
      const [m] = await db().select().from(schema.merchants);
      const d = await promiseAnalytics(m!.id);
      const sum = <T,>(rows: T[], f: (r: T) => number) => Math.round(rows.reduce((x, r) => x + f(r), 0) * 100) / 100;
      expect(sum(d.preflights, (p) => p.stoppedBeforeCapture)).toBe(9.33);          // the over-charge Kept refused to capture
      expect(sum(d.preflights, (p) => p.blocked)).toBe(1);           // only the protected checkout counts as blocked
      expect(sum(d.preflights, (p) => p.recordedMismatch)).toBe(1);  // the external capture: recorded, not stoppable
      expect(sum(d.refunds, (r) => r.completed)).toBe(9.33);
      expect(d.orders.map((o) => o.channel).sort()).toEqual(["Kept protected checkout", "Outside Kept's checkout"]);
      const dbPromises = await db().select().from(schema.commitments);
      expect(d.promises).toHaveLength(dbPromises.length);
      expect(d.promises.every((p) => dbPromises.some((c) => c.id === p.id))).toBe(true);
      const dbChecks = await db().select().from(schema.preflights);
      expect(d.preflights.map((p) => p.id).sort()).toEqual(dbChecks.map((p) => p.id).sort());
      expect(new Set(d.orders.map((o) => o.currency))).toEqual(new Set(["USD"]));
    });

    it("repair path is separate: an order captured OUTSIDE Kept's checkout is only monitored, then repaired", async () => {
      const { keptOrderId } = await sim.seedExternalCapturedOrder();
      const o = await orderRow(keptOrderId);
      expect(o).toMatchObject({ checkoutChannel: "EXTERNAL", captureAmountMinor: 9333 });
      expect((await pfs(keptOrderId))[0]).toMatchObject({ verdict: "BLOCKED_MISMATCH", enforced: false }); // recorded, could not stop it
      expect((await commitmentsOf(keptOrderId)).PRICE_AS_QUOTED?.state).toBe("BROKEN");
      const [rem] = await db().select().from(schema.remedies).where(eq(schema.remedies.orderId, keptOrderId));
      expect(rem).toMatchObject({ kind: "PARTIAL_REFUND", amountMinor: 933, state: "PROPOSED" });
    });
  });
});