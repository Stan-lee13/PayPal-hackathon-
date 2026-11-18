/**
 * The gateway, driven through a rail that misbehaves on purpose.
 *
 * `tests/rails-contract.test.ts` proves each adapter keeps the rail contract. This file proves the
 * *engine* keeps its promises when the rail does not keep its own:
 *
 *   • a capture or payout interrupted mid-flight leaves money reserved, not lost, and the same request
 *     finishes the job exactly once;
 *   • a payout the rail definitely refuses gives the owner their money back, and the envelope does not
 *     regain the capacity (a refunded capture stays used — the same rule as PayPal);
 *   • a rail without a capability refuses cleanly instead of pretending (`payout.cancel`, `hold.*`,
 *     `reporting.*`);
 *   • an altered webhook is refused, and a genuine one is applied once;
 *   • every record says which rail produced it.
 *
 * The rail is in memory; the gateway, its locks, budgets, ledger and receipts are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("the gateway through a rail that misbehaves", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const K = await import("../lib/gateway/books");
  const E = await import("../lib/envelope/core");
  const { handlers, run } = await import("../lib/api/handlers");
  const { mockRail, mockPayoutOnlyRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const PAYEE = "designer@example.com";

  beforeEach(async () => {
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
  });
  afterEach(() => { forgetRails(); delete process.env.ENVELOPE_WEBHOOK_ID; });

  /** A sealed envelope on the current rail, with one agent under the owner. */
  async function world(opts: { limit?: number; perPayment?: number; payee?: string } = {}) {
    const [owner, agent] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(owner, { publicKey: agent.publicKey, label: "ops-agent" }, {
      currency: "USD", limit: opts.limit ?? 20000, perPayment: opts.perPayment ?? 8000,
      payees: [opts.payee ?? PAYEE], purposes: ["design"], notAfter: EXP, splits: 0,
    });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const ask = (amount: number, payee = opts.payee ?? PAYEE) => E.signSpend(chain, agent, { amount, payee, purpose: "design" });
    return { owner, agent, chain, root, ask };
  }

  const rootRow = (id: string) => getDb().query.roots.findFirst({ where: eq(schema.roots.id, id) }).then((r) => r!);
  const blockRow = (id: string) => getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, id) }).then((r) => r!);

  it("refuses to seal on a rail that cannot hold funds, and creates nothing", async () => {
    setRailForTesting(mockPayoutOnlyRail());
    const [owner, agent] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(owner, { publicKey: agent.publicKey, label: "ops" }, { currency: "USD", limit: 5000, perPayment: 5000, payees: [PAYEE], purposes: ["design"], notAfter: EXP, splits: 0 });
    await expect(G.registerRoot({ chain, principalName: "Ada", title: "Budget" })).rejects.toMatchObject({ status: 501 });
    expect(await getDb().select().from(schema.roots)).toHaveLength(0);
  });

  it("leaves an interrupted capture reserved, then finishes it exactly once when the same request returns", async () => {
    const w = await world();
    const signed = await w.ask(2500);
    rail.failNext("hold.capture", 1);
    const first = await G.spend(signed);
    expect(first.status).toBe("RESERVED");
    const id = first.spend!.id;
    // The budget is held, not spent, and nothing reached the payee.
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 2500, spentMinor: 0 });
    expect(rail.payoutCount(id)).toBe(0);
    rail.failNext("", 0);
    const done = await G.settle(id);
    expect(done.status).toBe("PAID");
    expect(done.receipt).toBeTruthy();
    expect(rail.captureCount(id)).toBe(1);
    expect(rail.payoutCount(id)).toBe(1);
    // Spent once, reserved nowhere, captured once at the rail.
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0, spentMinor: 2500 });
    expect((await rootRow(w.root.id)).capturedMinor).toBe(2500);
  });

  it("leaves an interrupted payout captured but unpaid, then pays it exactly once", async () => {
    const w = await world();
    rail.failNext("payout.send", 1);
    const first = await G.spend(await w.ask(3000));
    expect(first.status).toBe("CAPTURED");
    const id = first.spend!.id;
    expect(rail.captureCount(id)).toBe(1);
    expect(rail.payoutCount(id)).toBe(0);
    rail.failNext("", 0);
    const done = await G.settle(id);
    expect(done.status).toBe("PAID");
    expect(rail.payoutCount(id)).toBe(1);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(3000);
  });

  it("gives the owner their money back when the payee cannot be paid, and keeps that part of the budget used", async () => {
    const w = await world({ payee: "refused.payee@example.com" });
    const r = await G.spend(await w.ask(4200));
    expect(r.status).toBe("FAILED");
    const row = r.spend!;
    expect(row.refundId).toBeTruthy();
    expect(rail.refundCount(row.id)).toBe(1);
    // The owner is no longer charged…
    const root = await rootRow(w.root.id);
    expect(root.capturedMinor).toBe(0);
    expect(root.refundedMinor).toBe(4200);
    // …but the envelope does not get the capacity back: a refunded capture stays used.
    expect(await blockRow(w.root.id)).toMatchObject({ spentMinor: 4200, reservedMinor: 0 });
    // A second attempt is not helped by the refund either: the same part of the budget is used, and the
    // rail will refuse the payee again rather than the engine quietly paying twice.
    const second = await G.spend(await w.ask(4200));
    expect(second.status).toBe("FAILED");
    expect(await blockRow(w.root.id)).toMatchObject({ spentMinor: 8400, reservedMinor: 0 });
  });

  it("cannot recall a payout on a rail without payout.cancel, and changes nothing", async () => {
    rail = mockRail({ profile: { "payout.cancel": false } });
    setRailForTesting(rail);
    const w = await world({ payee: "unclaimed.designer@example.com" });
    const r = await G.spend(await w.ask(2400));
    expect(r.status).toBe("UNCLAIMED");
    const { recall } = await import("../lib/gateway/settlement");
    await expect(recall(r.spend!.id, await E.signRead(w.owner, "recall", r.spend!.id))).rejects.toMatchObject({ status: 501 });
    // Still unclaimed, still captured, no refund asked for.
    const row = (await getDb().query.spends.findFirst({ where: eq(schema.spends.id, r.spend!.id) }))!;
    expect(row.status).toBe("UNCLAIMED");
    expect(row.refundId).toBeNull();
    expect(rail.refundCount(row.id)).toBe(0);
  });

  it("reports a statement it cannot read as unavailable, never as reconciled", async () => {
    rail = mockRail({ profile: { "reporting.statement": false } });
    setRailForTesting(rail);
    await world();
    const st = await K.statement();
    expect(st.available).toBe(false);
    expect(st.ok).toBe(false);
    expect(st.reason).toMatch(/cannot read a statement/);
    expect(st.ours).toBe(0);
  });

  it("does not claim the books are covered when the rail cannot report a balance", async () => {
    rail = mockRail({ profile: { "reporting.balance": false } });
    setRailForTesting(rail);
    const w = await world();
    await G.spend(await w.ask(1000));
    const r = await K.reserves();
    expect(r.paypal).toBeNull();
    expect(r.covered).toBeNull();
    expect(r.owed.totalMinor).toBeGreaterThanOrEqual(0);
  });

  it("applies a genuine event once and refuses an altered one", async () => {
    process.env.ENVELOPE_WEBHOOK_ID = "MOCK-ENDPOINT";
    await world();
    const ev = (await rail.events.list())[0]!;
    const body = { id: ev.id, event_type: ev.type, resource: ev.resource };
    const post = (b: unknown) => run(handlers["POST /api/rails/webhook"]!, { params: {}, body: b, headers: { "mock-signature": "MOCK-VALID" }, raw: JSON.stringify(b) });

    const first = await post(body);
    expect(first.status ?? 200).toBe(200);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    const again = await post(body);
    expect((again.body as { duplicate: boolean }).duplicate).toBe(true);

    const tampered = await post({ ...body, resource: { ...ev.resource, status: "VOIDED", amount: "999.99" } });
    expect(tampered.status).toBe(401);
    // A body that is not this rail's event shape is refused before any provider is asked.
    const nonsense = await post({ id: "x", event: "something" });
    expect(nonsense.status).toBe(400);
  });

  it("records which rail moved each payment, and reconciles against it", async () => {
    const w = await world();
    const r = await G.spend(await w.ask(1500));
    expect(r.status).toBe("PAID");
    expect(r.spend!.railProvider).toBe("mock");
    expect((await rootRow(w.root.id)).railProvider).toBe("mock");
    const rec = await G.reconcile(r.spend!.id);
    expect(rec.checks.map((c) => c.name)).toContain("The rail has a capture for exactly this amount");
    expect(rec.ok).toBe(true);
  });

  it("moves money once when the same signed request arrives eight times at once", async () => {
    const w = await world();
    const signed = await w.ask(1100);
    const results = await Promise.all(Array.from({ length: 8 }, () => G.spend(signed)));
    expect(new Set(results.map((x) => x.spend!.id)).size).toBe(1);
    expect(results.every((x) => x.status === "PAID")).toBe(true);
    expect(results.filter((x) => !x.duplicate)).toHaveLength(1);
    const id = results[0]!.spend!.id;
    expect(rail.captureCount(id)).toBe(1);
    expect(rail.payoutCount(id)).toBe(1);
    expect(await blockRow(w.root.id)).toMatchObject({ spentMinor: 1100, reservedMinor: 0 });
  });
});
