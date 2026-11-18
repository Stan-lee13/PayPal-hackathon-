/**
 * The settlement lease, as a lease: renewable, fenced, and honest about doubt.
 *
 * The three ways a payment can be finished twice or refunded without cause:
 *
 *   1. a provider call that outlives the lease (another worker takes over while the first is still waiting);
 *   2. a provider that accepted a payout the database never recorded (crash between the two);
 *   3. an interrupted call whose outcome is unknown (`in_doubt`), which is NOT the same as "not sent".
 *
 * Each is simulated here against the real gateway, locks and ledger.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("settlement lease", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { inDoubt } = await import("../lib/rails/types");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((s) => s!);
  const positions = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);

  const swallowed = (r: Mock) => r as unknown as { payouts: { send: (a: Parameters<Mock["payouts"]["send"]>[0]) => Promise<Awaited<ReturnType<Mock["payouts"]["send"]>>> } };

  beforeEach(async () => {
    process.env.SETTLEMENT_LEASE_MS = "5000";
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });
  afterEach(() => { delete process.env.SETTLEMENT_LEASE_MS; forgetRails(); });

  async function ask(amountMinor = 1200) {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 20000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    return E.signSpend(chain, ops, { amount: amountMinor, payee: "designer@example.com", purpose: "design" });
  }

  it("a provider call longer than the lease is renewed, not taken over", async () => {
    const signed = await ask(1000);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realSend = rail.payouts.send.bind(rail.payouts);
    let calls = 0;
    swallowed(rail).payouts.send = async (a) => { calls += 1; await gate; return realSend(a); };

    const first = G.spend(signed); // claims, captures, then blocks inside the payout call
    await sleep(6_500); // longer than the 5s lease: only the heartbeat keeps it
    const mid = (await getDb().select({ id: schema.spends.id }).from(schema.spends))[0]!;
    const during = await spendRow(mid.id);
    expect(during.settleGeneration).toBe(1); // nobody took over
    // A second arrival now cannot take it either: the claim is alive.
    const second = G.settle(mid.id);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe("PAID");
    expect(b.status).toBe("PAID");
    expect(calls).toBe(1);
    expect(rail.payoutCount(mid.id)).toBe(1);
    expect((await spendRow(mid.id)).settleGeneration).toBe(1);
  }, 30_000);

  it("an interrupted payout is in doubt: parked, never refunded, then paid once on retry", async () => {
    const signed = await ask(900);
    rail.failNext("payout.send", 1); // the provider's answer never arrives: accepted? refused? unknown
    const first = await G.spend(signed);
    expect(first.status).toBe("CAPTURED");
    expect(first.spend!.payoutStatus).toBe("IN_DOUBT");
    expect(first.spend!.refundId).toBeNull();
    // Nothing was refunded, and the money that arrived is still recorded as arrived.
    const afterFirst = await positions();
    expect(afterFirst.map((p) => p.kind)).toEqual(["capture"]);
    expect(rail.payoutCount(first.spend!.id)).toBe(0);

    const retried = await G.settle(first.spend!.id);
    expect(retried.status).toBe("PAID");
    expect(retried.refundId).toBeNull();
    expect(rail.payoutCount(first.spend!.id)).toBe(1);
    expect((await positions()).map((p) => p.kind)).toEqual(["capture", "payout"]);
    expect((await spendRow(first.spend!.id)).payoutStatus).toBe("SUCCESS");
  });

  it("a payout the provider accepted before the database recorded it is paid once, not twice and not refunded", async () => {
    const signed = await ask(700);
    const realSend = rail.payouts.send.bind(rail.payouts);
    let first = true;
    // The provider accepts the payout, then the answer is lost on the way back.
    swallowed(rail).payouts.send = async (a) => {
      const out = await realSend(a);
      if (first) { first = false; throw inDoubt(rail.id, "The mock rail was interrupted during payout.send: the effect is unknown.", { providerCode: "MOCK_IN_DOUBT" }); }
      return out;
    };
    const doubtful = await G.spend(signed);
    expect(doubtful.status).toBe("CAPTURED");
    expect(rail.payoutCount(doubtful.spend!.id)).toBe(1); // it exists at the provider
    expect(doubtful.spend!.refundId).toBeNull(); // and was NOT refunded

    const retried = await G.settle(doubtful.spend!.id);
    expect(retried.status).toBe("PAID");
    // The retry reused the same idempotency reference: still exactly one payout, one capture, one booking.
    expect(rail.payoutCount(doubtful.spend!.id)).toBe(1);
    expect((await positions()).map((p) => p.kind)).toEqual(["capture", "payout"]);
    expect(await getDb().select().from(schema.ledger)).toHaveLength(0);
  });

  /** The same simulator, described the way a real provider must be: no promise about a repeat. */
  const withoutRetryPromise = () => Object.assign(Object.create(rail), {
    idempotency: { sameReferenceIsSameOperation: true, retryWhileInFlight: false, memoryMs: 30 * 86_400_000, duplicateIsAnError: true, lookupByReference: false, note: "no promise about a repeat while the first call is running" },
  }) as unknown as Mock;

  /** The four facts every reconciliation must carry. */
  const evidence = () => ({
    by: "ops@example.com", source: "PayPal dashboard → Payouts (batch list)",
    checkedAt: new Date().toISOString(), rationale: "PayPal's own batch and item records for this payment's sender_batch_id",
  });

  /**
   * A payout the provider accepted whose answer never reached us: exactly the state resolvePayoutDoubt() exists
   * for. Returns the provider's own batch id, which is the only thing that may be reconciled against.
   */
  async function doubtful(amountMinor = 500) {
    let batchId = "";
    let once = true;
    const realSend = rail.payouts.send.bind(rail.payouts);
    swallowed(rail).payouts.send = async (a) => {
      const out = await realSend(a);
      batchId = out.batchRef.id;
      if (once) { once = false; throw inDoubt(rail.id, "the answer was lost on the way back", { providerCode: "MOCK_IN_DOUBT" }); }
      return out;
    };
    const first = await G.spend(await ask(amountMinor));
    expect(first.spend!.payoutStatus).toBe("IN_DOUBT");
    expect(batchId).toBeTruthy();
    return { first, batchId };
  }

  it("a rail that cannot promise a safe repeat is parked and reconciled from the provider's item record, never re-sent", async () => {
    setRailForTesting(withoutRetryPromise());
    const { first, batchId } = await doubtful();
    const again = await G.settle(first.spend!.id);
    expect(again.status).toBe("CAPTURED");
    expect(again.payoutBatchId).toBeNull();
    expect(rail.payoutCount(first.spend!.id)).toBe(1); // nothing was sent a second time

    // A batch id typed by hand is not evidence: the provider is asked, and it does not know this one.
    await expect(G.resolvePayoutDoubt(first.spend!.id, { kind: "sent", batchRef: "PP-BATCH-7", ...evidence() }))
      .rejects.toThrow(/no payout batch/);
    expect((await spendRow(first.spend!.id)).payoutBatchId).toBeNull();

    // The real batch is looked up at the provider; its item status is what is recorded — not a caller's claim.
    const resolved = await G.resolvePayoutDoubt(first.spend!.id, { kind: "sent", batchRef: batchId, ...evidence() });
    expect(resolved.payoutBatchId).toBe(batchId);
    expect(resolved.payoutItemId).toBeTruthy();
    expect(resolved.payoutStatus).toBe("SUCCESS");
    expect((await positions()).filter((p) => p.kind === "payout")).toHaveLength(1);
    expect((await positions()).filter((p) => p.kind === "refund")).toHaveLength(0);
    // And the reconciliation is on the record with its evidence and what the provider said about delivery.
    const trails = (await getDb().execute(sql`select detail from audit_log where action = 'payout.reconciled'`)) as unknown as Array<{ detail: Record<string, unknown> }>;
    expect(trails).toHaveLength(1);
    expect(trails[0]!.detail).toMatchObject({ spend: first.spend!.id, itemStatus: "SUCCESS", funds: "credited", item: resolved.payoutItemId });
  });

  it("a batch the provider knows, but has no item status for, is not evidence that anyone was paid", async () => {
    setRailForTesting(withoutRetryPromise());
    const { first, batchId } = await doubtful();
    const realRead = rail.payouts.read.bind(rail.payouts);
    // A closed batch whose item has not been reported yet: batch SUCCESS says nothing about this recipient.
    rail.payouts.read = async (p) => ({ ...(await realRead(p)), batchStatus: "SUCCESS", itemStatus: null });
    await expect(G.resolvePayoutDoubt(first.spend!.id, { kind: "sent", batchRef: batchId, ...evidence() }))
      .rejects.toThrow(/Batch status is not item status/);
    expect((await spendRow(first.spend!.id)).payoutBatchId).toBeNull();
  });

  it("an item that pays a different amount is not this payment, and is refused", async () => {
    setRailForTesting(withoutRetryPromise());
    const { first, batchId } = await doubtful();
    const realRead = rail.payouts.read.bind(rail.payouts);
    rail.payouts.read = async (p) => ({ ...(await realRead(p)), amount: { minor: 99, currency: "USD" } });
    await expect(G.resolvePayoutDoubt(first.spend!.id, { kind: "sent", batchRef: batchId, ...evidence() }))
      .rejects.toThrow(/this payment owes/);
    expect((await spendRow(first.spend!.id)).payoutBatchId).toBeNull();
  });

  it("clearing a doubt as not-sent needs evidence, and records who said so and why a retry cannot duplicate", async () => {
    setRailForTesting(withoutRetryPromise());
    const signed = await ask(450);
    rail.failNext("payout.send", 1);
    const first = await G.spend(signed);
    expect(first.spend!.payoutStatus).toBe("IN_DOUBT");
    // "I looked" is not a reconciliation: no source, no time, no reasoning.
    await expect(G.resolvePayoutDoubt(first.spend!.id, { kind: "not-sent", by: "ops" } as unknown as Parameters<typeof G.resolvePayoutDoubt>[1]))
      .rejects.toThrow(/needs who authorised it/);
    expect((await spendRow(first.spend!.id)).payoutStatus).toBe("IN_DOUBT");

    const how = evidence();
    await G.resolvePayoutDoubt(first.spend!.id, { kind: "not-sent", ...how });
    const trails = (await getDb().execute(sql`select detail from audit_log where action = 'payout.doubt_cleared'`)) as unknown as Array<{ detail: Record<string, unknown> }>;
    expect(trails).toHaveLength(1);
    expect(trails[0]!.detail).toMatchObject({ by: how.by, source: how.source, checkedAt: how.checkedAt, rationale: how.rationale, lookupByReference: false, retrySafe: false });

    const paid = await G.settle(first.spend!.id);
    expect(paid.status).toBe("PAID");
    expect(rail.payoutCount(first.spend!.id)).toBe(1);
    expect(await getDb().select().from(schema.ledger)).toHaveLength(0);
  });

  it("a worker whose lease lapsed cannot write the outcome another worker now owns", async () => {
    const signed = await ask(600);
    const realSend = rail.payouts.send.bind(rail.payouts);
    let first = true;
    swallowed(rail).payouts.send = async (a) => {
      if (first) {
        first = false;
        // The provider is slow; this worker's lease expires and another arrival takes over and finishes.
        await getDb().execute(sql`update spends set settling_at = now() - interval '1 hour'`);
        const [row] = await getDb().select({ id: schema.spends.id }).from(schema.spends);
        const takeover = await G.settle(row!.id);
        expect(takeover.status).toBe("PAID");
        return realSend(a); // then the first worker finally gets its answer
      }
      return realSend(a);
    };
    const out = await G.spend(signed);
    expect(out.status).toBe("PAID");
    const row = await spendRow(out.spend!.id);
    expect(row.settleGeneration).toBe(2); // the takeover owns it
    expect(rail.payoutCount(out.spend!.id)).toBe(1); // the idempotency reference kept the payout single
    expect(await getDb().select().from(schema.ledger)).toHaveLength(0);
    // One payment line, one booking of the budget.
    const blocks = await getDb().select().from(schema.blocks).where(eq(schema.blocks.depth, 0));
    expect(blocks[0]).toMatchObject({ spentMinor: 600, reservedMinor: 0 });
  }, 30_000);
});
