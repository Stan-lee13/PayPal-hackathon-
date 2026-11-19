/**
 * Payout identity and item-level settlement.
 *
 * A payout batch has a status of its own and it says nothing about the recipient: PayPal reports a batch as
 * SUCCESS while the item inside it is UNCLAIMED, PENDING or FAILED. These tests hold the gateway to the
 * item-level facts only:
 *
 *   • the batch and the item carry this payment's own sender references, as the provider echoes them;
 *   • a missing or mismatched item id, receiver, amount or currency leaves the payout unresolved;
 *   • a batch status can never mark a recipient paid, and an unknown status neither pays nor refunds;
 *   • an interrupted read cannot turn the amount the gateway asked for into a provider-confirmed amount.
 *
 * The provider is the deterministic mock rail; the facts it returns are replaced deliberately, because these
 * are the shapes a real provider can return and the gateway must not guess about.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";
import type { PayoutFacts, PayoutItemFacts } from "../lib/rails/types";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("payout identity and item-level settlement", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { amount, inDoubt, railRef } = await import("../lib/rails/types");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const PAYEE = "designer@example.com";
  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;

  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((s) => s!);
  /** The settlement state a v2 receipt names; a v1 receipt (PayPal-shaped) has none. */
  const stateOf = (r: unknown): string | null => (r && typeof r === "object" && "settlement" in r
    ? String((r as { settlement: { state: string } }).settlement.state) : null);
  const positions = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);
  const evidence = () => ({
    by: "ops@example.com", source: "provider dashboard → Payouts → batch/item",
    checkedAt: new Date().toISOString(), rationale: "the provider's own batch and item records, read by id",
  });

  beforeEach(async () => {
    process.env.SETTLEMENT_LEASE_MS = "5000";
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    G.forgetProviderAccountIdentity();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });
  afterEach(() => { delete process.env.SETTLEMENT_LEASE_MS; forgetRails(); });

  async function ask(amountMinor = 1200) {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, {
      currency: "USD", limit: 100000, perPayment: 100000, payees: [PAYEE], purposes: ["design"], notAfter: EXP, splits: 0,
    });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    return E.signSpend(chain, ops, { amount: amountMinor, payee: PAYEE, purpose: "design" });
  }

  /** Pay through a payout whose facts the provider returns as given, instead of the mock's own. */
  function sendReturns(f: (a: Parameters<Mock["payouts"]["send"]>[0], real: (a: Parameters<Mock["payouts"]["send"]>[0]) => Promise<PayoutFacts>) => Promise<PayoutFacts>) {
    const real = rail.payouts.send.bind(rail.payouts);
    rail.payouts.send = (a) => f(a, real);
  }
  /** Read a payout as the provider reports it, replacing the mock's record with a chosen shape. */
  function readReturns(f: PayoutFacts) {
    rail.payouts.read = async () => f;
  }

  const goodItem = (s: { id: string; amountMinor: number }, o: Partial<PayoutItemFacts> = {}): PayoutItemFacts => ({
    itemRef: railRef(rail.id, "payout_item", "MOCK-ITEM-1"),
    senderItemId: s.id,
    status: "SUCCESS",
    amount: amount(s.amountMinor, "USD"),
    receiver: PAYEE,
    transactionId: "MOCK-TXN-1",
    error: null,
    ...o,
  });

  const factsFor = (s: { id: string; amountMinor: number }, o: {
    batchStatus?: string; senderBatchId?: string | null; items?: PayoutItemFacts[]; itemCount?: number | null;
  } = {}): PayoutFacts => {
    const items = o.items ?? [goodItem(s)];
    return {
      batchRef: railRef(rail.id, "payout", "MOCK-BATCH-1"),
      batchStatus: o.batchStatus ?? "SUCCESS",
      senderBatchId: o.senderBatchId === undefined ? s.id : o.senderBatchId,
      items,
      itemCount: o.itemCount === undefined ? items.length : o.itemCount,
    };
  };

  /** A payment whose payout call was interrupted: the provider may or may not have a payout for it. */
  async function doubtful(amountMinor = 900) {
    const signed = await ask(amountMinor);
    rail.failNext("payout.send", 1);
    const res = await G.spend(signed);
    expect(res.spend!.payoutStatus).toBe("IN_DOUBT");
    return res.spend!;
  }

  const expectUnresolved = async (spendId: string) => {
    const row = await spendRow(spendId);
    expect(row.payoutBatchId).toBeNull();
    expect(row.payoutItemId).toBeNull();
    expect(row.refundId).toBeNull();
    // Nothing left the provider account on the strength of an unusable record, and nothing came back.
    expect((await positions()).filter((p) => ["payout", "payout_return", "refund"].includes(p.kind))).toHaveLength(0);
    return row;
  };

  // ---------------------------------------------------------------------------------------------
  // What the provider's item status means (never the batch's)
  // ---------------------------------------------------------------------------------------------

  it("a SUCCESS batch with a PENDING item is submitted, not paid", async () => {
    const signed = await ask(1000);
    // The mock creates the payout inside the call; splice in a batch SUCCESS / item PENDING answer.
    sendReturns(async (a, real) => {
      const out = await real(a);
      return { ...out, batchStatus: "SUCCESS", items: out.items.map((i) => ({ ...i, status: "PENDING" })) };
    });
    const paid = (await G.spend(signed)).spend!;
    expect(paid.status).toBe("PAYOUT_PENDING");
    expect(paid.payoutStatus).toBe("PENDING");
    expect(paid.refundId).toBeNull();
    expect(stateOf(paid.receipt)).toBe("payout_pending");
  });

  it("a SUCCESS batch with an UNCLAIMED item is unclaimed, not paid", async () => {
    const signed = await ask(1000);
    sendReturns(async (a, real) => {
      const out = await real(a);
      return { ...out, batchStatus: "SUCCESS", items: out.items.map((i) => ({ ...i, status: "UNCLAIMED" })) };
    });
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("UNCLAIMED");
    expect(r.payoutStatus).toBe("UNCLAIMED");
    expect(r.refundId).toBeNull();
  });

  it("a SUCCESS batch with a FAILED item takes the recovery path, and is never reported delivered", async () => {
    const signed = await ask(1000);
    sendReturns(async (a, real) => {
      const out = await real(a);
      return { ...out, batchStatus: "SUCCESS", items: out.items.map((i) => ({ ...i, status: "FAILED", error: "RECEIVER_UNREGISTERED" })) };
    });
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("FAILED");
    expect(r.refundId).toBeTruthy();
    // The money went out with the batch and came back: one payout, one return, one refund. No second payout.
    expect((await positions()).map((p) => `${p.kind}:${p.deltaMinor}`).sort()).toEqual(["capture:1000", "payout:-1000", "payout_return:1000", "refund:-1000"]);
  });

  it("a SUCCESS batch with no item status is not evidence about the recipient", async () => {
    const signed = await ask(1000);
    // The batch was accepted; the item has not been reported. The amount and receiver we sent are NOT facts.
    sendReturns(async (a) => ({
      batchRef: railRef(rail.id, "payout", "MOCK-BATCH-NOITEM"),
      batchStatus: "SUCCESS", senderBatchId: a.reference, items: [], itemCount: null,
    }));
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("PAYOUT_PENDING");
    expect(r.payoutStatus).toBe("SUBMITTED");
    expect(r.payoutItemId).toBeNull();
    expect(r.refundId).toBeNull();
    expect(stateOf(r.receipt)).toBe("payout_pending");
  });

  it("a PENDING batch with a SUCCESS item is classified by the item", async () => {
    const signed = await ask(1000);
    sendReturns(async (a, real) => {
      const out = await real(a);
      return { ...out, batchStatus: "PENDING", items: out.items.map((i) => ({ ...i, status: "SUCCESS" })) };
    });
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("PAID");
    expect(r.payoutStatus).toBe("SUCCESS");
  });

  it("a read failure after the batch was accepted records the batch, and never a requested amount as paid", async () => {
    const signed = await ask(1000);
    sendReturns(async (a) => ({
      batchRef: railRef(rail.id, "payout", "MOCK-BATCH-READFAIL"),
      batchStatus: "PENDING", senderBatchId: a.reference, items: [], itemCount: null,
    }));
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("PAYOUT_PENDING");
    expect(r.payoutBatchId).toBe("MOCK-BATCH-READFAIL");
    expect(r.payoutItemId).toBeNull();
    expect(r.refundId).toBeNull();
    expect(stateOf(r.receipt)).toBe("payout_pending");
    // The receipt may name the batch the provider gave us; it must not name an item or an amount that nobody reported.
    expect(r.receipt && "providerOps" in r.receipt ? r.receipt.providerOps.map((o) => o.kind) : []).not.toContain("payout_item");
  });

  it("a batch the provider says belongs to another sender reference is parked, never recorded and never refunded", async () => {
    const signed = await ask(1000);
    sendReturns(async (a, real) => ({ ...(await real(a)), senderBatchId: "sp_somebody_else" }));
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("CAPTURED");
    expect(r.payoutStatus).toBe("IN_DOUBT");
    expect(r.payoutBatchId).toBeNull();
    expect(r.refundId).toBeNull();
  });

  it("a batch with no item carrying this payment's sender reference is submitted, not paid", async () => {
    const signed = await ask(1000);
    sendReturns(async (a) => ({
      batchRef: railRef(rail.id, "payout", "MOCK-BATCH-OTHERITEM"),
      batchStatus: "SUCCESS", senderBatchId: a.reference,
      items: [{ itemRef: railRef(rail.id, "payout_item", "SOMEONE-ELSES"), senderItemId: "sp_other", status: "SUCCESS", amount: amount(1000, "USD"), receiver: PAYEE, transactionId: null, error: null }],
      itemCount: 1,
    }));
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("PAYOUT_PENDING");
    expect(r.payoutStatus).toBe("SUBMITTED");
    expect(r.payoutItemId).toBeNull();
    expect(r.refundId).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // Reconciliation from the provider's item record
  // ---------------------------------------------------------------------------------------------

  it("records a payout from the provider's item, with evidence, once", async () => {
    const s = await doubtful(700);
    readReturns(factsFor(s));
    const resolved = await G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() });
    expect(resolved.payoutBatchId).toBe("MOCK-BATCH-1");
    expect(resolved.payoutItemId).toBe("MOCK-ITEM-1");
    expect(resolved.payoutStatus).toBe("SUCCESS");
    // The reconciliation records the provider's item fact; the spend's own state follows from it on the next sync.
    expect(resolved.status).toBe("CAPTURED");
    expect((await positions()).map((p) => p.kind)).toEqual(["capture", "payout"]);
    // Reconciling again is a no-op: one payment, one booking.
    await G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() });
    expect((await positions()).map((p) => p.kind)).toEqual(["capture", "payout"]);
  });

  it("refuses an item with no provider item id, no amount, no receiver, or the wrong amount or currency", async () => {
    const cases: Array<[string, (s: { id: string; amountMinor: number }) => PayoutItemFacts, RegExp]> = [
      ["no provider item id", (s) => goodItem(s, { itemRef: null }), /no item id/],
      ["no amount", (s) => goodItem(s, { amount: null }), /no amount/],
      ["wrong amount", (s) => goodItem(s, { amount: amount(s.amountMinor + 1, "USD") }), /this payment owes/],
      ["wrong currency", (s) => goodItem(s, { amount: amount(s.amountMinor, "EUR") }), /this payment owes/],
      ["no receiver", (s) => goodItem(s, { receiver: null }), /no receiver/],
      ["wrong receiver", (s) => goodItem(s, { receiver: "someone@else.example" }), /different recipient/],
      ["no status", (s) => goodItem(s, { status: null }), /no status/],
    ];
    for (const [name, item, message] of cases) {
      const s = await doubtful(700);
      readReturns(factsFor(s, { items: [item(s)] }));
      await expect(G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }), name)
        .rejects.toThrow(message);
      await expectUnresolved(s.id);
    }
  });

  it("refuses another payment's item, an ambiguous batch, and a batch that reports more items than it lists", async () => {
    // Two spends with the same amount and payee: only the sender item reference can tell them apart.
    const a = await doubtful(700);
    const b = await doubtful(700);
    // The batch belongs to b: looking it up for a must not pay a.
    readReturns(factsFor(b, { items: [goodItem(b)] }));
    await expect(G.resolvePayoutDoubt(a.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/belongs to the sender reference/);
    await expectUnresolved(a.id);
    // And when the provider echoes no sender batch id at all, the item still has to name this payment.
    readReturns(factsFor(b, { items: [goodItem(b)], senderBatchId: null }));
    await expect(G.resolvePayoutDoubt(a.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/no item carries the sender reference/);
    await expectUnresolved(a.id);

    // Two items claim the same sender reference: ambiguous, so neither settles.
    readReturns(factsFor(a, { items: [goodItem(a), goodItem(a, { itemRef: railRef(rail.id, "payout_item", "MOCK-ITEM-2") })] }));
    await expect(G.resolvePayoutDoubt(a.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/items carry the sender reference/);
    await expectUnresolved(a.id);

    // The provider says the batch holds two items but lists one: the read is incomplete, and one item is not proof.
    readReturns(factsFor(a, { itemCount: 2 }));
    await expect(G.resolvePayoutDoubt(a.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/holds 2 item/);
    await expectUnresolved(a.id);

    // The batch belongs to another sender reference entirely: refused before any item is considered.
    readReturns(factsFor(a, { senderBatchId: b.id }));
    await expect(G.resolvePayoutDoubt(a.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/belongs to the sender reference/);
    await expectUnresolved(a.id);
  });

  it("does not accept an operator-supplied item id in place of the provider's, or a batch status as an item status", async () => {
    const s = await doubtful(700);
    readReturns(factsFor(s, { items: [goodItem(s, { itemRef: null })] }));
    await expect(G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", itemRef: "TYPED-BY-HAND", ...evidence() }))
      .rejects.toThrow(/no item id/);
    await expectUnresolved(s.id);

    // A batch with no items at all: its SUCCESS status is not this recipient's status.
    readReturns(factsFor(s, { batchStatus: "SUCCESS", items: [], itemCount: 0 }));
    await expect(G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/no payout items/);
    await expectUnresolved(s.id);
  });

  it("leaves a future item status unresolved: neither paid nor refunded", async () => {
    const s = await doubtful(700);
    readReturns(factsFor(s, { batchStatus: "SUCCESS", items: [goodItem(s, { status: "AWAITING_SOMETHING_NEW" })] }));
    await expect(G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/not one this gateway recognises/);
    await expectUnresolved(s.id);
  });

  it("cannot record a reconciliation when the provider read fails", async () => {
    const s = await doubtful(700);
    rail.payouts.read = async () => { throw inDoubt(rail.id, "the provider could not be read"); };
    await expect(G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }))
      .rejects.toThrow(/could not be read/);
    await expectUnresolved(s.id);
  });

  it("a stale reconciliation worker writes no success event and no second booking", async () => {
    const s = await doubtful(700);
    readReturns(factsFor(s));
    // Something else records the payout while this worker is reading: the fenced write must lose, and stay quiet.
    await G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() });
    await G.resolvePayoutDoubt(s.id, { kind: "sent", batchRef: "MOCK-BATCH-1", ...evidence() }).catch(() => undefined);
    const reconciled = (await getDb().execute(sql`select detail from audit_log where action = 'payout.reconciled'`)) as unknown as Array<{ detail: Record<string, unknown> }>;
    expect(reconciled).toHaveLength(1);
    expect((await positions()).filter((p) => p.kind === "payout")).toHaveLength(1);
    expect((await spendRow(s.id)).payoutBatchId).toBe("MOCK-BATCH-1");
  });
});
