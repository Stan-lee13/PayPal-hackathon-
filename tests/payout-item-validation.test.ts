/**
 * Payout-item attribution: one validator, every path.
 *
 * These tests pin the single authoritative validation (lib/gateway/payout-item.ts) that initial settlement,
 * `syncSpend()` and `resolvePayoutDoubt()` all use. The first block is pure, so it runs without a database; the
 * second drives the real gateway against the deterministic mock rail and requires TEST_DATABASE_URL.
 *
 * What is being asserted, in one sentence: a batch status, a missing field, another payment's reference, an
 * ambiguous batch or an unknown status can never mark a recipient paid, and the ordinary path is not more
 * permissive than the recovery path.
 */
import { describe, expect, it } from "vitest";
import { attributePayoutItem } from "../lib/gateway/payout-item";
import { amount, railRef, type PayoutFacts, type PayoutItemFacts } from "../lib/rails/types";

const TARGET = { id: "sp_target", amountMinor: 1200, currency: "USD", receiver: "payee@example.com" };

const item = (o: Partial<PayoutItemFacts> = {}): PayoutItemFacts => ({
  itemRef: railRef("mock", "payout_item", "ITEM-1"),
  senderItemId: TARGET.id,
  status: "SUCCESS",
  amount: amount(TARGET.amountMinor, "USD"),
  receiver: TARGET.receiver,
  transactionId: "TXN-1",
  error: null,
  ...o,
});

const facts = (o: { batchStatus?: string; senderBatchId?: string | null; items?: PayoutItemFacts[]; itemCount?: number | null; batchId?: string } = {}): PayoutFacts => {
  const items = o.items ?? [item()];
  return {
    batchRef: railRef("mock", "payout", o.batchId ?? "BATCH-1"),
    batchStatus: o.batchStatus ?? "SUCCESS",
    senderBatchId: o.senderBatchId === undefined ? TARGET.id : o.senderBatchId,
    items,
    itemCount: o.itemCount === undefined ? items.length : o.itemCount,
  };
};

/** The problem code an answer must be refused with, or "ok". */
const verdict = (f: PayoutFacts, extra: { batchRef?: string; itemId?: string } = {}) => {
  const r = attributePayoutItem({ target: TARGET, facts: f, ...extra });
  return r.ok ? "ok" : r.code;
};

describe("payout item attribution (authoritative validation)", () => {
  it("accepts exactly the item that carries this payment's sender reference and its own facts", () => {
    const r = attributePayoutItem({ target: TARGET, facts: facts() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemId).toBe("ITEM-1");
    expect(r.status).toBe("SUCCESS");
    expect(r.outcome).toBe("credited");
  });

  it("refuses the right sender reference with the wrong amount", () => {
    expect(verdict(facts({ items: [item({ amount: amount(1201, "USD") })] }))).toBe("amount_mismatch");
    // One minor unit either way is still the wrong amount.
    expect(verdict(facts({ items: [item({ amount: amount(1199, "USD") })] }))).toBe("amount_mismatch");
  });

  it("refuses the right sender reference with the wrong currency", () => {
    expect(verdict(facts({ items: [item({ amount: amount(1200, "EUR") })] }))).toBe("amount_mismatch");
  });

  it("refuses the right sender reference with the wrong receiver", () => {
    expect(verdict(facts({ items: [item({ receiver: "someone-else@example.com" })] }))).toBe("receiver_mismatch");
  });

  it("refuses a missing receiver, amount, item id or status", () => {
    expect(verdict(facts({ items: [item({ receiver: null })] }))).toBe("no_receiver");
    expect(verdict(facts({ items: [item({ amount: null })] }))).toBe("no_amount");
    expect(verdict(facts({ items: [item({ itemRef: null })] }))).toBe("no_item_id");
    expect(verdict(facts({ items: [item({ status: null })] }))).toBe("no_status");
  });

  it("never lets a caller-supplied item id stand in for the provider's", () => {
    expect(verdict(facts(), { itemId: "TYPED-BY-HAND" })).toBe("no_item_id");
    // The provider's own id is accepted as an expectation, and is still the id returned.
    const r = attributePayoutItem({ target: TARGET, facts: facts(), itemId: "ITEM-1" });
    expect(r.ok && r.itemId).toBe("ITEM-1");
  });

  it("refuses an unknown provider status: neither paid nor refunded on a guess", () => {
    expect(verdict(facts({ items: [item({ status: "AWAITING_SOMETHING_NEW" })] }))).toBe("unknown_status");
  });

  it("reads a SUCCESS batch by its item: unclaimed and pending are not delivery", () => {
    const unclaimed = attributePayoutItem({ target: TARGET, facts: facts({ items: [item({ status: "UNCLAIMED" })] }) });
    expect(unclaimed.ok && unclaimed.outcome).toBe("unclaimed");
    const pending = attributePayoutItem({ target: TARGET, facts: facts({ items: [item({ status: "PENDING" })] }) });
    expect(pending.ok && pending.outcome).toBe("submitted");
    // A failed item is a return, not a success, whatever the batch says.
    const failed = attributePayoutItem({ target: TARGET, facts: facts({ items: [item({ status: "FAILED" })] }) });
    expect(failed.ok && failed.outcome).toBe("failed");
  });

  it("refuses a successful batch that reported no item information at all", () => {
    expect(verdict(facts({ batchStatus: "SUCCESS", items: [], itemCount: null }))).toBe("no_item");
    expect(verdict(facts({ batchStatus: "SUCCESS", items: [], itemCount: 0 }))).toBe("no_item");
  });

  it("refuses an item that belongs to a different spend with the same amount and payee", () => {
    const other = item({ senderItemId: "sp_somebody_else" });
    expect(verdict(facts({ items: [other] }))).toBe("no_item");
  });

  it("refuses a batch that reports more items than it listed (an incomplete paginated read)", () => {
    expect(verdict(facts({ itemCount: 2 }))).toBe("incomplete_batch");
  });

  it("refuses two items that both claim this payment's sender reference", () => {
    const second = item({ itemRef: railRef("mock", "payout_item", "ITEM-2") });
    expect(verdict(facts({ items: [item(), second] }))).toBe("ambiguous_item");
  });

  it("refuses a batch whose sender reference belongs to another payment", () => {
    expect(verdict(facts({ senderBatchId: "sp_somebody_else" }))).toBe("sender_batch_mismatch");
    // No echo at all is acceptable only because the item itself must still name this payment.
    expect(verdict(facts({ senderBatchId: null }))).toBe("ok");
  });

  it("refuses a batch other than the one already on record", () => {
    expect(verdict(facts(), { batchRef: "ANOTHER-BATCH" })).toBe("batch_mismatch");
  });

  it("classifies each successive provider read on its own: a status change is not cached", () => {
    const first = attributePayoutItem({ target: TARGET, facts: facts({ items: [item({ status: "PENDING" })] }) });
    const second = attributePayoutItem({ target: TARGET, facts: facts({ items: [item({ status: "SUCCESS" })] }) });
    expect(first.ok && first.outcome).toBe("submitted");
    expect(second.ok && second.outcome).toBe("credited");
  });
});

// ---------------------------------------------------------------------------
// The gateway's own paths, against the deterministic mock rail
// ---------------------------------------------------------------------------

const { useTestEnv } = await import("./helpers");
const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("payout item attribution in the gateway paths", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");
  const E = await import("../lib/envelope/core");

  const PAYEE = "designer@example.com";
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const rail = mockRail();
  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((s) => s!);
  const positions = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);

  const before = async () => {
    setRailForTesting(rail);
    G.forgetGatewayKey();
    G.forgetProviderAccountIdentity();
    await getDb().execute(sql`truncate table position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  };

  const ask = async (amountMinor = 1000) => {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, {
      currency: "USD", limit: 100000, perPayment: 100000, payees: [PAYEE], purposes: ["design"], notAfter: EXP, splits: 0,
    });
    await G.registerRoot({ chain, principalName: "Ada", title: "Budget" });
    return E.signSpend(chain, ops, { amount: amountMinor, payee: PAYEE, purpose: "design" });
  };

  it("initial settlement refuses a wrong-amount item: submitted, not paid, and not refunded", async () => {
    await before();
    const signed = await ask(1000);
    const real = rail.payouts.send.bind(rail.payouts);
    rail.payouts.send = async (a) => {
      const out = await real(a);
      return { ...out, items: out.items.map((i) => ({ ...i, amount: amount(i.amount!.minor + 1, "USD") })) };
    };
    const r = (await G.spend(signed)).spend!;
    expect(r.status).toBe("PAYOUT_PENDING");
    expect(r.payoutStatus).toBe("SUBMITTED");
    expect(r.payoutItemId).toBeNull();
    expect(r.refundId).toBeNull();
    // The batch was accepted, so the payout is on the books; nothing came back, and no refund was sent.
    expect((await positions()).map((p) => p.kind)).toEqual(["capture", "payout"]);
  });

  it("syncSpend refuses a wrong receiver on a later read, and never refunds on it", async () => {
    await before();
    const r0 = (await G.spend(await ask(1000))).spend!;
    expect(r0.status).toBe("PAID");
    rail.payouts.read = async (ref) => {
      const real = await mockRail().payouts.read(ref);
      return { ...real, items: real.items.map((i) => ({ ...i, status: "SUCCESS", receiver: "someone-else@example.com" })) };
    };
    const after = await G.syncSpend(r0.id);
    // Whatever the record said before, a mismatch from the provider is not evidence: the payment is unchanged.
    expect(after.status).toBe(r0.status);
    expect(after.refundId).toBeNull();
    forgetRails();
    setRailForTesting(rail);
  });

  it("the recovery path and the settlement path refuse the same answer", async () => {
    await before();
    const signed = await ask(900);
    rail.failNext("payout.send", 1);
    const doubtful = (await G.spend(signed)).spend!;
    expect(doubtful.payoutStatus).toBe("IN_DOUBT");
    rail.payouts.read = async () => ({
      batchRef: railRef(rail.id, "payout", "BATCH-WRONG"),
      batchStatus: "SUCCESS",
      senderBatchId: doubtful.id,
      items: [{ itemRef: railRef(rail.id, "payout_item", "ITEM-WRONG"), senderItemId: doubtful.id, status: "SUCCESS", amount: amount(901, "USD"), receiver: PAYEE, transactionId: null, error: null }],
      itemCount: 1,
    });
    await expect(G.resolvePayoutDoubt(doubtful.id, {
      kind: "sent", batchRef: "BATCH-WRONG",
      by: "ops@example.com", source: "provider batch read", checkedAt: new Date().toISOString(), rationale: "checked the provider's own item",
    })).rejects.toThrow(/this payment owes/);
    const row = await spendRow(doubtful.id);
    expect(row.payoutBatchId).toBeNull();
    expect(row.refundId).toBeNull();
  });
});
