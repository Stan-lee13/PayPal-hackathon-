/**
 * The books against PayPal's own: reserves against the balance PayPal reports, the gateway's records
 * against PayPal's statement, a payee's refund through a PayPal capture refund, and disputes answered
 * with the signed chain of authority. Against the built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("the books against PayPal's (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const K = await import("../lib/gateway/books");
  const S = await import("../lib/gateway/settlement");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const calls = async (frag: string) => (await sim.simCalls()).filter((c) => c.includes(frag)).length;
  const acctRow = (k: string) => getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, k) }).then((a) => a!);
  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((r) => r!);
  const rootRow = (id: string) => getDb().query.roots.findFirst({ where: eq(schema.roots.id, id) }).then((r) => r!);
  const booksOk = async () => (await B.position()).checks.every((c) => c.ok);
  const fresh = async () => { K.forgetBalance(); return K.reserves(); };

  /** Ada → ops-agent ($200). Bea's writer-agent keeps its income. designer@ is a PayPal address. */
  async function world() {
    const [ada, ops, bea, wr, rogue] = await Promise.all([1, 2, 3, 4, 5].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(wr!, bea!, { label: "writer-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    const payee = E.accountPayee(wr!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 10000, payees: [payee, "designer@example.com"], purposes: ["writing", "design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const earn = async (amount: number) => G.spend(await E.signSpend(chain, ops!, { amount, payee, purpose: "writing", memo: "Launch page copy" }));
    return { ada: ada!, ops: ops!, bea: bea!, wr: wr!, rogue: rogue!, payee, chain, root, earn, leaf: chain[0]!.body.id };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    K.forgetBalance();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
  });

  it("what agents are owed is covered by the balance PayPal reports, through income, a payout and a withdrawal", async () => {
    const w = await world();
    expect(await fresh()).toMatchObject({ owed: { totalMinor: 0 }, paypal: { availableMinor: 0 }, covered: true });
    await w.earn(5000);
    expect(await fresh()).toMatchObject({ owed: { balancesMinor: 5000, accountsWithMoney: 1, totalMinor: 5000 }, paypal: { availableMinor: 5000 }, covered: true, surplusMinor: 0 });
    // a payment that is paid straight out passes through: nothing is owed for it and nothing is kept for it
    expect((await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: "designer@example.com", purpose: "design" }))).status).toBe("PAID");
    expect(await fresh()).toMatchObject({ owed: { totalMinor: 5000 }, paypal: { availableMinor: 5000 }, covered: true });
    expect((await B.transfer(await E.signTransfer(w.wr, { kind: "withdraw", amount: 2000 }))).status).toBe("PAID");
    expect(await fresh()).toMatchObject({ owed: { totalMinor: 3000 }, paypal: { availableMinor: 3000 }, covered: true, surplusMinor: 0 });
    // if the ledger ever claimed more than PayPal holds, it would say so
    await getDb().update(schema.accounts).set({ balanceMinor: 9000 }).where(eq(schema.accounts.agent, w.wr.publicKey));
    expect(await fresh()).toMatchObject({ covered: false, surplusMinor: -6000 });
  });

  it("the agent that was paid gives a payment back: balance debited once, PayPal refunds the capture, the owner's books follow", async () => {
    const w = await world();
    const a = await w.earn(5000), b = await w.earn(1500);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(6500);
    // not the payee: the payer's own agent, a stranger, and a stranger's signature under the payee's name
    for (const who of [w.ops, w.rogue]) expect((await B.refund(await E.signRefund(who, a.spend!.id))).reasons.map((r) => r.code)).toEqual(["NOT_THE_HOLDER"]);
    const forged = await E.signRefund(w.rogue, a.spend!.id); forged.request.from = w.wr.publicKey;
    expect((await B.refund(forged)).reasons.map((r) => r.code)).toEqual(["NOT_THE_HOLDER"]);
    expect(await calls("/refund")).toBe(0);
    expect((await acctRow(w.wr.publicKey)).balanceMinor).toBe(6500);

    const r = await B.refund(await E.signRefund(w.wr, a.spend!.id, "Brief was withdrawn"));
    expect(r).toMatchObject({ status: "REFUNDED", balanceMinor: 1500 });
    expect(r.refundId).toBeTruthy();
    expect(r.reasons[0]!.code).toBe("REFUNDED_BY_PAYEE");
    expect(await calls("/refund")).toBe(1);
    const s = await spendRow(a.spend!.id);
    expect(s).toMatchObject({ status: "FAILED", payoutStatus: "REFUNDED" });
    // the owner is charged $15 now; the $50 came back to them, and that part of the hold stays used (PayPal's rule)
    expect(await rootRow(w.root.id)).toMatchObject({ capturedMinor: 1500, refundedMinor: 5000 });
    expect((await getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, w.leaf) }))!.spentMinor).toBe(6500);
    expect(await booksOk()).toBe(true);
    expect(await fresh()).toMatchObject({ owed: { totalMinor: 1500 }, paypal: { availableMinor: 1500 }, covered: true });
    // the receipt's check against PayPal still holds: the capture exists, for this amount, and is now refunded
    expect((await G.reconcile(a.spend!.id)).checks.find((c) => c.name.startsWith("PayPal capture exists"))).toMatchObject({ ok: true });

    // again, by a fresh signature and by the same one: nothing more happens anywhere
    expect((await B.refund(await E.signRefund(w.wr, a.spend!.id))).status).toBe("REFUNDED");
    expect(await calls("/refund")).toBe(1);
    expect((await acctRow(w.wr.publicKey)).balanceMinor).toBe(1500);
    // The refunded $50 does not come back to the envelope: PayPal would refuse to capture it, so the gateway refuses first,
    // by its own arithmetic, without asking PayPal. $200 − $65 used = $135 is what is left.
    expect(b.status).toBe("PAID");
    expect((await w.earn(10000)).status).toBe("PAID");
    const captures = await calls("/capture");
    const over = await w.earn(3600);
    expect(over.status).toBe("DENIED");
    expect(over.reasons.map((x) => x.code)).toContain("OVER_ENVELOPE_LIMIT");
    expect(await calls("/capture")).toBe(captures);
    expect((await w.earn(3500)).status).toBe("PAID");
    expect((await w.earn(100)).status).toBe("DENIED");
    // closing releases what PayPal's void really releases: nothing here, the hold is used up; the owner was charged $150
    const { root: closed } = await G.revoke(await E.signRevoke(w.ada, w.root.id));
    expect(closed).toMatchObject({ capturedMinor: 15000, refundedMinor: 5000, releasedMinor: 0 });
  });

  it("a refund is refused when the money is gone, when the account is frozen, and for a payment that was paid out", async () => {
    const w = await world();
    const a = await w.earn(5000);
    await B.transfer(await E.signTransfer(w.wr, { kind: "withdraw", amount: 2000 }));
    expect((await B.refund(await E.signRefund(w.wr, a.spend!.id))).reasons.map((r) => r.code)).toEqual(["INSUFFICIENT_BALANCE"]);
    await w.earn(3000);
    await B.freeze(await E.signFreeze(w.bea, w.wr.publicKey, true));
    expect((await B.refund(await E.signRefund(w.wr, a.spend!.id))).reasons.map((r) => r.code)).toEqual(["ACCOUNT_FROZEN"]);
    const out = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: "designer@example.com", purpose: "design" }));
    expect((await B.refund(await E.signRefund(w.wr, out.spend!.id))).reasons.map((r) => r.code)).toEqual(["NOT_THE_HOLDER"]);
    expect(await calls("/refund")).toBe(0);
    expect((await acctRow(w.wr.publicKey)).balanceMinor).toBe(6000);
    expect(await booksOk()).toBe(true);
  });

  it("if PayPal refuses the refund the money returns to the balance once; if PayPal is unreachable the sweep finishes it", async () => {
    const w = await world();
    const a = await w.earn(5000), b = await w.earn(1500);
    await sim.simRefuseRefunds(true);
    const no = await B.refund(await E.signRefund(w.wr, a.spend!.id));
    expect(no).toMatchObject({ status: "FAILED", balanceMinor: 6500 });
    expect(no.reasons[0]!.code).toBe("PAYPAL_REFUND_FAILED");
    expect((await spendRow(a.spend!.id)).status).toBe("PAID");
    expect((await rootRow(w.root.id)).capturedMinor).toBe(6500);
    expect(await booksOk()).toBe(true);
    await sim.simRefuseRefunds(false);
    // PayPal down for the other payment's refund: debited, pending, nothing lost
    await sim.simFailNext("/refund", 9);
    const pending = await B.refund(await E.signRefund(w.wr, b.spend!.id));
    expect(pending).toMatchObject({ status: "PENDING", balanceMinor: 5000 });
    expect((await spendRow(b.spend!.id)).status).toBe("PAID");
    await sim.simFailNext(null);
    const swept = await S.sweepUnfinished();
    expect(swept.moved).toContainEqual({ id: b.spend!.id, from: "PAID", to: "REFUNDED" });
    expect((await spendRow(b.spend!.id))).toMatchObject({ status: "FAILED", payoutStatus: "REFUNDED" });
    expect((await acctRow(w.wr.publicKey)).balanceMinor).toBe(5000);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(5000);
    expect(await booksOk()).toBe(true);
    expect((await S.sweepUnfinished()).moved).toEqual([]);
  });

  it("PayPal's own statement lists every capture and payout recorded here, and a record that disagrees is caught", async () => {
    const w = await world();
    const a = await w.earn(5000);
    const out = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: "designer@example.com", purpose: "design" }));
    await G.syncSpend(out.spend!.id);
    const st = await K.statement();
    expect(st).toMatchObject({ ours: 3, listed: 3, differs: 0, notListedYet: 0, ok: true });
    expect(st.matches.map((m) => m.what).sort()).toEqual(["capture", "capture", "payout"]);
    // the gateway's record of the first capture is altered: PayPal's statement no longer agrees with it
    await getDb().update(schema.spends).set({ amountMinor: 4000 }).where(eq(schema.spends.id, a.spend!.id));
    const bad = await K.statement();
    expect(bad).toMatchObject({ differs: 1, ok: false });
    expect(bad.matches.find((m) => m.verdict === "amount differs")).toMatchObject({ spend: a.spend!.id, amountMinor: 4000, listedMinor: 5000 });
  });

  it("a dispute at PayPal shows on the payment, and the gateway answers it once with the signed chain of authority", async () => {
    const w = await world();
    const a = await w.earn(5000);
    const clean = await G.reconcile(a.spend!.id);
    expect(clean.checks.find((c) => c.name.startsWith("PayPal holds no dispute"))).toMatchObject({ ok: true, detail: "none" });
    expect(clean.ok).toBe(true);

    const disputeId = (await sim.simOpenDispute(a.spend!.captureId!, "UNAUTHORISED"))!;
    const seen = await G.reconcile(a.spend!.id);
    expect(seen.ok).toBe(false);
    expect(seen.checks.find((c) => c.name.startsWith("PayPal holds no dispute"))!.detail).toContain(disputeId);
    expect(await spendRow(a.spend!.id)).toMatchObject({ disputeId, disputeStatus: "WAITING_FOR_SELLER_RESPONSE" });

    const ev = await K.evidence(a.spend!.id);
    expect(ev.chainVerifies).toBe(true);
    expect(ev.summary).toContain(E.fingerprint(w.ada.publicKey));
    expect(ev.summary).toContain(a.spend!.captureId!);
    expect(ev.summary).toContain("$50.00");
    expect(ev.summary.length).toBeLessThan(2000);
    expect(JSON.stringify(ev)).not.toMatch(/"d":"/); // no private key material

    const first = await K.settleDisputes();
    expect(first).toMatchObject({ asked: true, disputes: 1 });
    expect(first.ours).toEqual([{ dispute: disputeId, spend: a.spend!.id, status: "UNDER_REVIEW", evidenceSent: true }]);
    expect((await sim.simDispute(disputeId))).toMatchObject({ status: "UNDER_REVIEW", evidence: "received" });
    // the sweep finds it again and does not answer twice
    const swept = await S.sweepUnfinished();
    expect(swept.disputes.aboutPaymentsHere).toEqual([{ dispute: disputeId, spend: a.spend!.id, status: "UNDER_REVIEW", evidenceSent: false }]);
    expect(await calls("/provide-evidence")).toBe(1);
    // it is on the envelope's audit trail, and money did not move because of it
    const actions = (await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, w.root.id))).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["dispute.opened", "dispute.evidence_sent"]));
    expect((await acctRow(w.wr.publicKey)).balanceMinor).toBe(5000);
    expect(await calls("/refund")).toBe(0);
    // a dispute about a transaction that is not ours is left alone
    expect((await K.evidence(a.spend!.id)).dispute).toMatchObject({ id: disputeId, status: "UNDER_REVIEW" });
  });
});
