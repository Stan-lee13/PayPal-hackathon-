/**
 * Balances: income held in an agent's account, transfers between agents, payouts and withdrawals,
 * the owner's cap and freeze, and the books. Against the built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("agent balances (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const codes = (v: Array<{ code: string }>) => v.map((x) => x.code).sort();
  const acctRow = (k: string) => getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, k) }).then((a) => a!);
  const payouts = async () => (await sim.simCalls()).filter((c) => c === "POST /v1/payments/payouts").length;
  const booksOk = async () => (await B.position()).checks.every((c) => c.ok);

  /**
   * Ada → ops-agent ($200). Bea's translator-agent keeps its income (cap $30 a payment);
   * Cy's proofreader-agent keeps its income too; Dee's archive-agent settles straight to PayPal.
   */
  async function world() {
    const [ada, ops, bea, tr, cy, pf, dee, ar, rogue] = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold", perPayment: 3000 }));
    await G.openAccount(await E.signAccount(pf!, cy!, { label: "proofreader-agent", ownerName: "Cy", settleTo: "cy@example.com", mode: "hold" }));
    await G.openAccount(await E.signAccount(ar!, dee!, { label: "archive-agent", ownerName: "Dee", settleTo: "dee@example.com" }));
    const payee = E.accountPayee(tr!.publicKey);
    const caps: E.Caps = { currency: "USD", limit: 20000, perPayment: 10000, payees: [payee], purposes: ["translation"], notAfter: EXP, splits: 0 };
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, caps);
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const earn = async (amount: number) => G.spend(await E.signSpend(chain, ops!, { amount, payee, purpose: "translation", memo: "Spanish strings" }));
    return { ada: ada!, ops: ops!, bea: bea!, tr: tr!, cy: cy!, pf: pf!, dee: dee!, ar: ar!, rogue: rogue!, payee, chain, root, earn, proof: E.accountPayee(pf!.publicKey), archive: E.accountPayee(ar!.publicKey) };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("income to an account that holds is captured from the payer's hold and credited once, with no payout", async () => {
    const w = await world();
    const signed = await E.signSpend(w.chain, w.ops, { amount: 4500, payee: w.payee, purpose: "translation" });
    const r = await G.spend(signed);
    expect(r.status).toBe("PAID");
    expect(r.spend).toMatchObject({ payeeAgent: w.tr.publicKey, payoutTo: null, payoutBatchId: null, payoutStatus: "HELD_IN_ACCOUNT" });
    expect(r.spend!.captureId).toBeTruthy();
    expect(await payouts()).toBe(0);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(4500);
    expect(r.receipt!.paidTo).toMatchObject({ agentLabel: "translator-agent", settledTo: "balance", held: { balanceAfterMinor: 4500 } });
    expect(await G.verifyReceipt(r.receipt!)).toBe(true);
    // the same signed request again: no second credit
    const again = await G.spend(signed);
    expect(again.duplicate).toBe(true);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(4500);
    // settling again by hand is harmless too
    await G.settle(r.spend!.id);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(4500);
    const rc = await G.reconcile(r.spend!.id);
    expect(rc.ok).toBe(true);
    expect(rc.checks.map((c) => c.name)).toContain("Credited once to the account the agent signed for");
    expect(await booksOk()).toBe(true);
  });

  it("an agent pays another agent out of its balance: one debit, one credit, no PayPal call, a signed receipt", async () => {
    const w = await world();
    await w.earn(4500);
    const before = (await sim.simCalls()).length;
    const signed = await E.signTransfer(w.tr, { amount: 1200, payee: w.proof, purpose: "proofreading", memo: "Check the Spanish strings" });
    const r = await B.transfer(signed);
    expect(r.status).toBe("BOOKED");
    expect((await sim.simCalls()).length).toBe(before);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(3300);
    expect((await acctRow(w.pf.publicKey)).balanceMinor).toBe(1200);
    expect(r.receipt).toMatchObject({ from: { agentLabel: "translator-agent" }, to: { kind: "account", agentLabel: "proofreader-agent" }, balanceAfterMinor: 3300 });
    expect(await B.verifyTransferReceipt(r.receipt!)).toBe(true);
    expect(await B.verifyTransferReceipt({ ...r.receipt!, balanceAfterMinor: 0 })).toBe(false);
    // replay of the same signed transfer moves nothing
    const again = await B.transfer(signed);
    expect(again).toMatchObject({ status: "BOOKED", duplicate: true });
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(3300);
    expect((await acctRow(w.pf.publicKey)).balanceMinor).toBe(1200);
    // the proofreader can spend what it was paid
    const on = await B.transfer(await E.signTransfer(w.pf, { amount: 200, payee: w.payee, purpose: "refund" }));
    expect(on.status).toBe("BOOKED");
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(3500);
    expect(await booksOk()).toBe(true);
  });

  it("ten transfers race for a balance that covers four: exactly four go through", async () => {
    const w = await world();
    await w.earn(4500);
    const signed = await Promise.all(Array.from({ length: 10 }, () => E.signTransfer(w.tr, { amount: 1000, payee: w.proof, purpose: "proofreading" })));
    const rs = await Promise.all(signed.map((s) => B.transfer(s)));
    expect(rs.filter((r) => r.status === "BOOKED")).toHaveLength(4);
    expect(rs.filter((r) => r.status === "DENIED").every((r) => codes(r.reasons).includes("INSUFFICIENT_BALANCE"))).toBe(true);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(500);
    expect((await acctRow(w.pf.publicKey)).balanceMinor).toBe(4000);
    expect(await booksOk()).toBe(true);
  });

  it("two agents paying each other at the same moment do not deadlock or lose money", async () => {
    const w = await world();
    await w.earn(4000);
    await B.transfer(await E.signTransfer(w.tr, { amount: 2000, payee: w.proof, purpose: "float" }));
    const a = await Promise.all(Array.from({ length: 6 }, () => E.signTransfer(w.tr, { amount: 100, payee: w.proof })));
    const b = await Promise.all(Array.from({ length: 6 }, () => E.signTransfer(w.pf, { amount: 150, payee: w.payee })));
    const rs = await Promise.all([...a, ...b].map((s) => B.transfer(s)));
    expect(rs.every((r) => r.status === "BOOKED")).toBe(true);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(2000 - 600 + 900);
    expect((await acctRow(w.pf.publicKey)).balanceMinor).toBe(2000 + 600 - 900);
    expect(await booksOk()).toBe(true);
  });

  it("money leaves to a PayPal address through a payout; a withdrawal goes only to the owner's address", async () => {
    const w = await world();
    await w.earn(4500);
    const out = await B.transfer(await E.signTransfer(w.tr, { amount: 1500, payee: "glossary-vendor@example.com", purpose: "glossary" }));
    expect(out.status).toBe("PAID");
    expect(out.transfer).toMatchObject({ payoutTo: "glossary-vendor@example.com" });
    expect(out.receipt!.to).toMatchObject({ kind: "paypal", address: "glossary-vendor@example.com" });
    // an account that settles (does not hold) is paid out to the address its owner signed for
    const settle = await B.transfer(await E.signTransfer(w.tr, { amount: 500, payee: w.archive, purpose: "storage" }));
    expect(settle.transfer).toMatchObject({ status: "PAID", payoutTo: "dee@example.com", toAgent: w.ar.publicKey });
    expect((await acctRow(w.ar.publicKey)).balanceMinor).toBe(0);
    // a withdrawal names no payee: it goes to the owner's settlement address, and the cap on payments does not apply
    const wd = await B.transfer(await E.signTransfer(w.tr, { kind: "withdraw", amount: 2500 }));
    expect(wd.transfer).toMatchObject({ status: "PAID", payoutTo: "bea@example.com", kind: "withdraw" });
    expect(await payouts()).toBe(3);
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(0);
    const p = await B.position();
    expect(p.totals).toMatchObject({ balancesMinor: 0, capturedInMinor: 4500, paidOutMinor: 4500 });
    expect(p.checks.every((c) => c.ok)).toBe(true);
  });

  it("a payout interrupted half-way resumes without paying twice; a refused payout puts the money back once", async () => {
    const w = await world();
    await w.earn(4500);
    const signed = await E.signTransfer(w.tr, { amount: 1000, payee: "vendor@example.com" });
    // PayPal answers 500 once: the client retries with the same idempotency key, so one payout is made
    await sim.simFailNext("/v1/payments/payouts");
    const first = await B.transfer(signed);
    expect(first).toMatchObject({ status: "PAID", balanceMinor: 3500 });
    // the gateway dies after debiting and before recording the payout: the transfer is left SENDING
    await getDb().update(schema.transfers).set({ status: "SENDING", payoutBatchId: null, payoutItemId: null, payoutStatus: null, receipt: null }).where(eq(schema.transfers.id, first.transfer!.id));
    const second = await B.transfer(signed);
    expect(second).toMatchObject({ status: "PAID", duplicate: true, balanceMinor: 3500 });
    expect(second.transfer!.payoutBatchId).toBe(first.transfer!.payoutBatchId);
    expect(second.receipt).toBeTruthy();
    expect((await B.transfer(signed)).balanceMinor).toBe(3500);
    // refused outright
    const bad = await E.signTransfer(w.tr, { amount: 700, payee: "refused@example.com" });
    const r = await B.transfer(bad);
    expect(r.status).toBe("FAILED");
    expect(codes(r.reasons)).toEqual(["PAYPAL_PAYOUT_FAILED"]);
    expect(r.balanceMinor).toBe(3500);
    expect((await B.transfer(bad)).balanceMinor).toBe(3500);
    const rows = await B.ledgerOf(w.tr.publicKey);
    expect(rows.filter((l) => l.kind === "reversal")).toHaveLength(1);
    expect(await booksOk()).toBe(true);
  });

  it("only the account's own key can move its money", async () => {
    const w = await world();
    await w.earn(4500);
    // the rogue signs a transfer and writes the translator's key in `from`
    const forged = await E.signTransfer(w.rogue, { amount: 1000, payee: "mallory@evil.example" });
    forged.request.from = w.tr.publicKey;
    expect(codes((await B.transfer(forged)).reasons)).toContain("NOT_THE_HOLDER");
    // a real transfer with the amount or the payee changed after signing
    const real = await E.signTransfer(w.tr, { amount: 100, payee: w.proof });
    expect(codes((await B.transfer({ ...real, request: { ...real.request, amount: 4500 } })).reasons)).toContain("NOT_THE_HOLDER");
    expect(codes((await B.transfer({ ...real, request: { ...real.request, payee: "mallory@evil.example" } })).reasons)).toContain("NOT_THE_HOLDER");
    // a spend signature is not a transfer signature, and the owner cannot move the agent's money either
    const owner = await E.signTransfer(w.bea, { amount: 100, payee: "bea@example.com" });
    expect(codes((await B.transfer(owner)).reasons)).toEqual(["NO_BALANCE_ACCOUNT"]);
    // stale, wrong currency, nonsense amounts, unknown account
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { amount: 100, payee: w.proof }, new Date(Date.now() - 10 * 60_000)))).reasons)).toContain("STALE_REQUEST");
    for (const amount of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect((await B.transfer(await E.signTransfer(w.tr, { amount, payee: w.proof }))).status).toBe("DENIED");
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { amount: 100, payee: "acct:aaaa-bbbb-cccc" }))).reasons)).toEqual(["PAYEE_ACCOUNT_UNKNOWN"]);
    expect((await B.transfer(await E.signTransfer(w.tr, { amount: 100, payee: w.payee }))).status).toBe("DENIED");
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(4500);
    expect(await payouts()).toBe(0);
  });

  it("the owner's cap and freeze bind the agent; only the owner can freeze, and nobody can swap the owner", async () => {
    const w = await world();
    await w.earn(9000);
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { amount: 3001, payee: w.proof }))).reasons)).toEqual(["OVER_ACCOUNT_LIMIT"]);
    expect((await B.transfer(await E.signTransfer(w.tr, { amount: 3000, payee: w.proof }))).status).toBe("BOOKED");
    // the agent tries to give itself a new owner (a key it made) with no cap
    const fake = await E.generateKeyPair();
    await expect(G.openAccount(await E.signAccount(w.tr, fake, { label: "translator-agent", ownerName: "Bea", settleTo: "mine@example.com", mode: "hold" }, new Date(Date.now() + 1000)))).rejects.toThrow(/already has an owner/);
    // freeze: not by the agent, not by a stranger
    await expect(B.freeze(await E.signFreeze(w.tr, w.tr.publicKey, true))).rejects.toThrow(/Only the owner/);
    await expect(B.freeze(await E.signFreeze(w.rogue, w.tr.publicKey, true))).rejects.toThrow(/Only the owner/);
    const f = await E.signFreeze(w.bea, w.tr.publicKey, true);
    await expect(B.freeze({ ...f, request: { ...f.request, frozen: false } })).rejects.toThrow(/properly signed/);
    expect((await B.freeze(f)).frozenAt).toBeTruthy();
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { amount: 100, payee: w.proof }))).reasons)).toEqual(["ACCOUNT_FROZEN"]);
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { kind: "withdraw", amount: 100 }))).reasons)).toEqual(["ACCOUNT_FROZEN"]);
    // income still arrives while frozen
    expect((await w.earn(1000)).status).toBe("PAID");
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(7000);
    // the agent cannot unfreeze itself; the owner can
    await expect(B.freeze(await E.signFreeze(w.tr, w.tr.publicKey, false))).rejects.toThrow(/Only the owner/);
    await B.freeze(await E.signFreeze(w.bea, w.tr.publicKey, false));
    expect((await B.transfer(await E.signTransfer(w.tr, { amount: 100, payee: w.proof }))).status).toBe("BOOKED");
    // the owner raises the cap with a new co-signed opening; the balance is untouched
    await G.openAccount(await E.signAccount(w.tr, w.bea, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold", perPayment: 5000 }, new Date(Date.now() + 2000)));
    expect((await acctRow(w.tr.publicKey)).balanceMinor).toBe(6900);
    expect((await B.transfer(await E.signTransfer(w.tr, { amount: 5000, payee: w.proof }))).status).toBe("BOOKED");
    expect(await booksOk()).toBe(true);
  });
});
