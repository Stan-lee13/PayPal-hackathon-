/**
 * Serverless hosting: each request may hit a fresh instance with empty memory. With
 * KEPT_EMULATOR_PERSIST=1 the simulated PayPal must still carry an order from "created"
 * through "approved", "captured" and its webhook events.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("simulated PayPal survives instance changes (KEPT_EMULATOR_PERSIST=1)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { seedDemoMerchant, resetTransactions } = await import("../lib/services/seed");
  const chat = await import("../lib/services/chat");
  const orders = await import("../lib/services/orders");
  const sim = await import("../lib/services/simulation");
  const emu = await import("../lib/paypal/emulator");
  const { withEmulatorState } = await import("../lib/paypal/emulator-store");

  beforeAll(async () => {
    process.env.KEPT_EMULATOR_PERSIST = "1";
    await seedDemoMerchant(getDb());
    await resetTransactions(getDb());
    emu.resetEmulator();
    const [m] = await getDb().select().from(schema.merchants);
    await getDb().update(schema.merchants).set({ policy: { ...m!.policy, checkoutGuard: "BLOCK" } }).where(eq(schema.merchants.id, m!.id));
  });
  afterAll(() => { delete process.env.KEPT_EMULATOR_PERSIST; emu.resetEmulator(); });

  const newInstance = () => emu.resetEmulator(); // memory wiped, as on a different serverless instance

  it("creates, approves, captures and delivers events across fresh instances", async () => {
    const s = await chat.createSession();
    await chat.setCart(s, [{ productId: "prd_ada_dress", qty: 1 }], "STANDARD");
    await chat.postCustomerMessage(s, "What's my total with standard shipping?");
    const { keptOrderId, paypalOrderId } = await orders.createOrderFromSession(s);
    newInstance();
    await withEmulatorState(() => emu.approveEmulatorOrder(paypalOrderId));
    newInstance();
    const o = await orders.captureKeptOrder(keptOrderId, paypalOrderId);
    expect(o.captureAmountMinor).toBe(8850);
    newInstance();
    const delivered = await sim.deliverSimulatedEvents();
    expect(delivered.delivered).toBeGreaterThanOrEqual(2); // CHECKOUT.ORDER.APPROVED + PAYMENT.CAPTURE.COMPLETED survived in the stored outbox
    const [row] = await getDb().select().from(schema.emulatorState);
    expect(row?.id).toBe("default");
  });

  it("concurrent emulator uses do not lose each other's writes", async () => {
    const ids = await Promise.all([1, 2, 3].map(async () => {
      const s = await chat.createSession();
      await chat.setCart(s, [{ productId: "prd_ada_dress", qty: 1 }], "STANDARD");
      await chat.postCustomerMessage(s, "Total?");
      return orders.createOrderFromSession(s);
    }));
    newInstance();
    await withEmulatorState(() => { for (const x of ids) emu.approveEmulatorOrder(x.paypalOrderId); });
    newInstance();
    for (const x of ids) expect((await orders.captureKeptOrder(x.keptOrderId, x.paypalOrderId)).paypalCaptureId).toBeTruthy();
  });
});
