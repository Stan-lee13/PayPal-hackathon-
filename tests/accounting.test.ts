/** Multi-rail accounting: provenance, provider-scoped positions, fees, reconciliation and inter-rail refusal. */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("multi-rail accounting (simulated rail)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const K = await import("../lib/gateway/books");
  const A = await import("../lib/accounting");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  let rail: ReturnType<typeof mockRail>;

  beforeEach(async () => {
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    K.forgetBalance();
    // `paypal_calls` is truncated too: the simulator's statement is built from the call journal, so a call left by
    // another suite shows up here as a fee line and can make this test's own fee look like a duplicate.
    await getDb().execute(sql`truncate table position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
  });

  /** Ada → ops-agent, paying Bea's translator account (which keeps a balance). */
  async function world(amountMinor = 1500) {
    const [ada, ops, beaKey, tr] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, beaKey!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    const payee = E.accountPayee(tr!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 20000, payees: [payee], purposes: ["translation"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const paid = await G.spend(await E.signSpend(chain, ops!, { amount: amountMinor, payee, purpose: "translation" }));
    expect(paid.status).toBe("PAID");
    return { ada: ada!, ops: ops!, bea: beaKey!, tr: tr!, payee, chain, root, paid };
  }

  it("a balance knows which rail and currency funded it, and the provider position backs it", async () => {
    const w = await world(1500);
    const led = await getDb().select().from(schema.ledger).where(sql`agent = ${w.tr.publicKey}`);
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ rail: "mock", currency: "USD", deltaMinor: 1500, balanceAfterMinor: 1500 });
    // The claim is funded: the money is recorded as having arrived at the rail.
    expect(await A.fundedByFor(w.tr.publicKey)).toEqual([{ rail: "mock", currency: "USD", minor: 1500 }]);
    const pos = await A.positionOf(null, "mock", "USD");
    expect(pos).toMatchObject({ availableMinor: 1500, pendingMinor: 0, feesMinor: 0, netAtProviderMinor: 1500 });
    // A hold account keeps the money at the provider: no payout left.
    expect(rail.payoutCount()).toBe(0);
    expect((await K.reserves()).owed.totalMinor).toBe(1500);
  });

  it("an internal balance is not liquidity at another provider", async () => {
    const w = await world(1000);
    const short = await A.liquidityAt({ rail: "other-bank", currency: "USD", amountMinor: 100 });
    expect(short.ok).toBe(false);
    expect(short.detail).toContain("other-bank holds 0");
    await expect(A.requireProviderLiquidity({ rail: "other-bank", currency: "USD", amountMinor: 100, what: "A payout", fundedByRail: "mock" }))
      .rejects.toThrow(/no settled funds/);
    // At the rail that actually holds it, the same amount is spendable.
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout" })).resolves.toBeUndefined();
    // ...and a different currency is not spendable either, even at the right rail.
    expect((await A.liquidityAt({ rail: "mock", currency: "EUR", amountMinor: 100 })).ok).toBe(false);
    void w;
  });

  it("proves the fee arithmetic: gross, fee, net and spendable are four separate numbers", async () => {
    rail = mockRail({ fees: true });
    setRailForTesting(rail);
    await world(1000);
    const rec = await K.reconcilePositions();
    expect(rec.available).toBe(true);
    expect(rec.ok).toBe(true);
    const stmt = await K.statement();
    // The provider's own statement is the independent source: the gross it lists and the fee it charged.
    const line = stmt.matches.find((m) => m.what === "capture")!;
    const gross = line.amountMinor;
    const fee = line.feeMinor!;
    expect(fee).toBeGreaterThan(0);
    expect(rec.fees.chargedMinor).toBe(fee);
    expect(rec.findings.filter((f) => f.code === "unexpected_fee")).toHaveLength(1);

    const pos = await A.positionOf(null, "mock", "USD");
    // Fee amounts are a positive cost everywhere, and the arithmetic subtracts them exactly once.
    expect(pos).toMatchObject({ availableMinor: gross, feesMinor: fee, netAtProviderMinor: gross - fee });
    expect(pos.netAtProviderMinor).toBe(gross - fee);
    expect(stmt.position.netMinor).toBe(pos.netAtProviderMinor);

    // A $100 capture with a $2 fee leaves $98: $99 must not pass.
    const spendable = (await A.liquidityAt({ rail: "mock", currency: "USD", amountMinor: 0 })).availableMinor;
    expect(spendable).toBe(gross - fee);
    expect((await A.liquidityAt({ rail: "mock", currency: "USD", amountMinor: gross })).ok).toBe(false);
    expect((await A.liquidityAt({ rail: "mock", currency: "USD", amountMinor: gross - fee + 1 })).ok).toBe(false);
    expect((await A.liquidityAt({ rail: "mock", currency: "USD", amountMinor: gross - fee })).ok).toBe(true);
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: gross, what: "A payout" })).rejects.toThrow(/taken in fees/);

    // Reconciling again records nothing twice.
    const again = await K.reconcilePositions();
    expect(again.fees.recordedMinor).toBe(0);
    expect((await A.positionOf(null, "mock", "USD")).feesMinor).toBe(fee);
    const runs = await A.lastReconciliations();
    expect(runs[0]).toMatchObject({ rail: "mock", available: true, ok: true });
    expect((await getDb().select().from(schema.positionEntries)).filter((r) => r.bucket === "fee")).toHaveLength(1);
  });

  it("a payout fee and a fee reversal move net at the provider, never available", async () => {
    rail = mockRail({ fees: true });
    setRailForTesting(rail);
    const w = await world(1000);
    // Pay the captured money out: the payout carries its own fee on the statement.
    const transfer = await B.transfer(await E.signTransfer(w.tr, { amount: 400, payee: "supplier@example.com", purpose: "translation" }));
    expect(transfer.status).toBe("PAID");
    // The statement is the only place fees appear; reconciling records them once, in the fee bucket.
    await K.reconcilePositions();
    const pos = await A.positionOf(null, "mock", "USD");
    const stmt = await K.statement();
    const payoutLine = stmt.matches.find((m) => m.what === "payout")!;
    expect(payoutLine.feeMinor).toBeGreaterThan(0);
    // available = gross captured − paid out; fees = both fees; net = available − fees.
    expect(pos.availableMinor).toBe(1000 - 400);
    expect(pos.feesMinor).toBe(stmt.position.feesMinor);
    expect(pos.netAtProviderMinor).toBe(pos.availableMinor - pos.feesMinor);
    expect((await A.liquidityAt({ rail: "mock", currency: "USD", amountMinor: pos.availableMinor })).ok).toBe(false);

    // A provider that corrects a fee (a reversal) gives the money back, and it becomes spendable again —
    // but only through a recorded correction, never by editing history.
    await A.recordExternalMovement({ owner: "ada", rail: "mock", currency: "USD", bucket: "fee", kind: "fee", deltaMinor: 50, ref: "statement-correction-1", memo: "fee reversed" });
    const after = await A.positionOf(null, "mock", "USD");
    expect(after.availableMinor).toBe(pos.availableMinor);
    expect(after.feesMinor).toBe(pos.feesMinor - 50);
    expect(after.netAtProviderMinor).toBe(pos.netAtProviderMinor + 50);
    // The same correction twice is one correction.
    expect(await A.recordExternalMovement({ owner: "ada", rail: "mock", currency: "USD", bucket: "fee", kind: "fee", deltaMinor: 50, ref: "statement-correction-1" })).toBe(false);
    expect((await A.positionOf(null, "mock", "USD")).netAtProviderMinor).toBe(after.netAtProviderMinor);
  });

  it("states the treasury policy, and in allocated mode refuses to spend another organization's funds", async () => {
    expect(A.treasuryMode()).toBe("pooled");
    expect(A.treasuryMeaning()).toMatch(/omnibus treasury/);
    const w = await world(500);
    // The capture sits in Ada's organization slice. Bea's organization holds nothing at this rail.
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 400, what: "Bea's payout", owner: w.bea.publicKey })).resolves.toBeUndefined();
    process.env.ENVELOPE_TREASURY_MODE = "allocated";
    try {
      expect(A.treasuryMode()).toBe("allocated");
      await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 400, what: "Bea's payout", owner: w.bea.publicKey }))
        .rejects.toThrow(/allocates liquidity per organization/);
      // The organization that owns the position can still be paid.
      await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 400, what: "Ada's payout", owner: w.ada.publicKey })).resolves.toBeUndefined();
    } finally {
      delete process.env.ENVELOPE_TREASURY_MODE;
    }
  });

  it("refuses to attribute liquidity to an ambiguous provider account", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "PP-ONE" });
    await A.ensureRailAccount({ owner: "bea", rail: "mock", currency: "USD", externalAccountId: "PP-TWO" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 500, ref: "fund-attr" });
    // Two accounts on one rail and currency would make their funds interchangeable; fail closed instead.
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout" }))
      .rejects.toThrow(/one mock USD provider account/);
  });

  it("a production deployment must state its treasury model before it moves money", async () => {
    await world(500);
    const env = process.env as Record<string, string | undefined>;
    const before = { mode: env.ENVELOPE_TREASURY_MODE, node: env.NODE_ENV };
    env.NODE_ENV = "production";
    delete env.ENVELOPE_TREASURY_MODE;
    try {
      await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout" }))
        .rejects.toThrow(/ENVELOPE_TREASURY_MODE/);
      process.env.ENVELOPE_TREASURY_MODE = "pooled";
      await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout" })).resolves.toBeUndefined();
    } finally {
      if (before.mode === undefined) delete env.ENVELOPE_TREASURY_MODE; else env.ENVELOPE_TREASURY_MODE = before.mode;
      if (before.node === undefined) delete env.NODE_ENV; else env.NODE_ENV = before.node;
    }
  });

  it("an unavailable statement is never a successful reconciliation", async () => {
    rail = mockRail({ profile: { "reporting.statement": false } });
    setRailForTesting(rail);
    await world(500);
    const rec = await K.reconcilePositions();
    expect(rec.available).toBe(false);
    expect(rec.ok).toBe(false);
    expect(rec.reason).toMatch(/cannot read a statement/);
    expect(rec.findings[0]).toMatchObject({ code: "statement_unavailable", severity: "error" });
    const runs = await A.lastReconciliations();
    expect(runs[0]).toMatchObject({ available: false, ok: false });
  });

  it("finds settlement facts that cannot both be true, and a position that went negative", async () => {
    const w = await world(1000);
    // (a) The provider says the payout came back; the payment still says PAID.
    await getDb().execute(sql`update spends set payout_status = 'RETURNED' where id = ${w.paid.spend!.id}`);
    let rec = await K.reconcilePositions();
    expect(rec.ok).toBe(false);
    expect(rec.findings.map((f) => f.code)).toContain("inconsistent_settlement");

    // (b) A payout was recorded at the rail for money that never arrived there.
    await A.postPayout({ owner: "someone-else", rail: "mock", currency: "USD", amountMinor: 9000, ref: "manual_overpay" });
    rec = await K.reconcilePositions();
    expect(rec.findings.map((f) => f.code)).toContain("insufficient_liquidity");
    expect(rec.ok).toBe(false);
  });

  it("never counts the same money at two rails, and never lets one rail's funds pay another", async () => {
    // A movement recorded without the provider's account identity is historical and not spendable (see
    // tests/position-verification.test.ts). This test is about per-rail isolation, so the money is recorded the way
    // the capture path records it: with the account identity the provider established.
    await A.ensureRailAccount({ owner: "ada", rail: "rail-a", currency: "USD", externalAccountId: "RAIL-A-ACCOUNT" });
    await A.ensureRailAccount({ owner: "ada", rail: "rail-b", currency: "USD", externalAccountId: "RAIL-B-ACCOUNT" });
    await A.postCapture({ owner: "ada", rail: "rail-a", currency: "USD", amountMinor: 5000, ref: "fund-a", externalAccountId: "RAIL-A-ACCOUNT" });
    await A.postCapture({ owner: "ada", rail: "rail-b", currency: "USD", amountMinor: 1000, ref: "fund-b", externalAccountId: "RAIL-B-ACCOUNT" });
    expect((await A.positionOf(null, "rail-a", "USD")).availableMinor).toBe(5000);
    expect((await A.positionOf(null, "rail-b", "USD")).availableMinor).toBe(1000);
    // The 5000 at rail-a is not spendable at rail-b, even though both are USD and both belong to Ada.
    await expect(A.requireProviderLiquidity({ rail: "rail-b", currency: "USD", amountMinor: 4000, what: "A payout" })).rejects.toThrow(/no settled funds/);
    expect((await A.liquidityAt({ rail: "rail-a", currency: "USD", amountMinor: 5000 })).ok).toBe(true);
    // A funding leg at the destination has to be recorded *at the destination*: the source capture does not count.
    await expect(A.assertInterRailTransfer({
      from: { rail: "rail-a", currency: "USD" }, to: { rail: "rail-b", currency: "USD" },
      amountMinor: 4000, funding: { rail: "rail-b", currency: "USD", ref: "fund-a", settledMinor: 5000 }, authorisedLiquidity: true,
    })).resolves.toMatchObject({ ok: false, code: "FUNDING_REQUIRED" });
    // And with the destination's own leg it is allowed, without double-counting either side.
    await expect(A.assertInterRailTransfer({
      from: { rail: "rail-a", currency: "USD" }, to: { rail: "rail-b", currency: "USD" },
      amountMinor: 400, funding: { rail: "rail-b", currency: "USD", ref: "fund-b", settledMinor: 1000 }, authorisedLiquidity: true,
    })).resolves.toMatchObject({ ok: true, kind: "funded" });
  });

  it("refuses to move value between providers without a settled funding leg and an authorization", async () => {
    const from = { rail: "mock", currency: "USD" };
    const to = { rail: "other-bank", currency: "USD" };
    // Same rail: an internal book movement, and no liquidity is invented.
    expect(A.planInterRailTransfer({ from, to: from, amountMinor: 100 })).toMatchObject({ ok: true, kind: "internal" });
    // Different currency: never implied.
    const fx = A.planInterRailTransfer({ from, to: { rail: "other-bank", currency: "EUR" }, amountMinor: 100 });
    expect(fx).toMatchObject({ ok: false, code: "CURRENCY_CONVERSION_NOT_SUPPORTED" });
    if (!fx.ok) expect(A.interRailRefusal(fx).status).toBe(501);
    // Different provider, no funding leg at the destination.
    const none = A.planInterRailTransfer({ from, to, amountMinor: 100 });
    expect(none).toMatchObject({ ok: false, code: "FUNDING_REQUIRED" });
    // A funding leg that names the wrong rail, or too little.
    expect(A.planInterRailTransfer({ from, to, amountMinor: 100, funding: { rail: "mock", currency: "USD", ref: "x", settledMinor: 1000 }, authorisedLiquidity: true })).toMatchObject({ ok: false, code: "FUNDING_MISMATCH" });
    expect(A.planInterRailTransfer({ from, to, amountMinor: 1000, funding: { rail: "other-bank", currency: "USD", ref: "x", settledMinor: 999 }, authorisedLiquidity: true })).toMatchObject({ ok: false, code: "FUNDING_SHORT" });
    // The right funding leg but no authorization to fund the operator's own account.
    const unauthorised = A.planInterRailTransfer({ from, to, amountMinor: 100, funding: { rail: "other-bank", currency: "USD", ref: "x", settledMinor: 1000 } });
    expect(unauthorised).toMatchObject({ ok: false, code: "NOT_AUTHORISED" });
    if (!unauthorised.ok) expect(A.interRailRefusal(unauthorised).status).toBe(403);

    // A caller cannot assert its own funding: the arrival has to exist in this gateway's books, at the
    // destination rail, in the destination currency, available and large enough.
    const req = { from, to, amountMinor: 100, funding: { rail: "other-bank", currency: "USD", ref: "funding_leg", settledMinor: 1000 }, authorisedLiquidity: true };
    await expect(A.assertInterRailTransfer(req)).resolves.toMatchObject({ ok: false, code: "FUNDING_REQUIRED" });
    await A.postCapture({ owner: "ada", rail: "other-bank", currency: "USD", amountMinor: 1000, ref: "funding_leg" });
    await expect(A.assertInterRailTransfer(req)).resolves.toMatchObject({ ok: true, kind: "funded" });
    // ...but a funding leg recorded at the wrong rail does not satisfy it.
    const wrongRail = { ...req, funding: { ...req.funding, rail: "mock" } };
    await expect(A.assertInterRailTransfer(wrongRail)).resolves.toMatchObject({ ok: false });
  });
});
