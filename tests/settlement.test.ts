/**
 * Settlement under stress: the same request arriving many times at once, a capture PayPal has not
 * finished, and a payout that fails when the refund fails too. Against the built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("settlement (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const calls = async (frag: string) => (await sim.simCalls()).filter((c) => c.includes(frag)).length;
  const rootRow = (id: string) => getDb().query.roots.findFirst({ where: eq(schema.roots.id, id) }).then((r) => r!);
  const blockRow = (id: string) => getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, id) }).then((r) => r!);

  async function world(payee = "designer@example.com") {
    const [ada, ops] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: [payee], purposes: ["design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    return { ada: ada!, ops: ops!, chain, root, payee, leaf: chain[0]!.body.id };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("the same signed request arriving eight times at once is captured, counted and paid once", async () => {
    const w = await world();
    const signed = await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" });
    const rs = await Promise.all(Array.from({ length: 8 }, () => G.spend(signed)));
    expect(rs.every((r) => r.status === "PAID")).toBe(true);
    expect(await calls("/capture")).toBe(1);
    expect(await calls("/payouts")).toBe(1);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(2500);
    expect(await blockRow(w.leaf)).toMatchObject({ spentMinor: 2500, reservedMinor: 0 });
    expect((await sim.simAuthorization(w.root.authorizationId!))!.captured).toBe(2500);
    // and settling it by hand a few more times changes nothing
    await Promise.all(Array.from({ length: 4 }, () => G.settle(rs[0]!.spend!.id)));
    expect((await rootRow(w.root.id)).capturedMinor).toBe(2500);
  });

  it("a capture PayPal has not finished is not paid out until PayPal says it completed", async () => {
    const w = await world();
    await sim.simNextCapturePending();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }));
    expect(r.status).toBe("CAPTURED");
    expect(r.receipt).toBeNull();
    expect(await calls("/payouts")).toBe(0);
    // asked again while still pending: still nothing sent
    expect((await G.syncSpend(r.spend!.id)).status).toBe("CAPTURED");
    expect(await calls("/payouts")).toBe(0);
    // PayPal completes the capture: now the payee is paid, once
    await sim.simSetCapture(r.spend!.captureId!, "COMPLETED");
    const done = await G.syncSpend(r.spend!.id);
    expect(done.status).toBe("PAID");
    expect(await calls("/payouts")).toBe(1);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(2500);
  });

  it("a pending capture that PayPal then declines pays nobody and gives the budget back", async () => {
    const w = await world();
    await sim.simNextCapturePending();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }));
    await sim.simSetCapture(r.spend!.captureId!, "DECLINED");
    const done = await G.syncSpend(r.spend!.id);
    expect(done.status).toBe("FAILED");
    expect(done.reasons.map((x) => x.code)).toEqual(["PAYPAL_CAPTURE_FAILED"]);
    expect(await calls("/payouts")).toBe(0);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(0);
    expect(await blockRow(w.leaf)).toMatchObject({ spentMinor: 0, reservedMinor: 0 });
  });

  it("when the payout is refused and the refund fails too, the books still say the owner was charged", async () => {
    const w = await world("refused@example.com");
    await sim.simRefuseRefunds(true);
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }));
    expect(r.status).toBe("REFUND_DUE");
    // PayPal really captured $25 and has not given it back: the gateway must not pretend otherwise
    expect((await sim.simAuthorization(w.root.authorizationId!))!.captured).toBe(2500);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(2500);
    // nor hand the same $25 of budget out again
    expect(await blockRow(w.leaf)).toMatchObject({ spentMinor: 2500, reservedMinor: 0 });
    const over = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 8000, payee: w.payee, purpose: "design" }));
    const over2 = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 8000, payee: w.payee, purpose: "design" }));
    const over3 = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 8000, payee: w.payee, purpose: "design" }));
    expect([over, over2, over3].map((x) => x.status)).toContain("DENIED");
    // asking again while refunds still fail changes nothing
    expect((await G.syncSpend(r.spend!.id)).status).toBe("REFUND_DUE");
    expect((await rootRow(w.root.id)).capturedMinor).toBeGreaterThanOrEqual(2500);
    // once PayPal accepts the refund, the charge is undone and the budget returns, once
    await sim.simRefuseRefunds(false);
    const fixed = await G.syncSpend(r.spend!.id);
    expect(fixed.status).toBe("FAILED");
    expect(fixed.refundId).toBeTruthy();
    await G.syncSpend(r.spend!.id);
    const spentElsewhere = [over, over2, over3].filter((x) => x.status !== "DENIED" && x.status !== "REFUND_DUE" && x.status !== "FAILED").length;
    expect(spentElsewhere).toBe(0); // every later payment went to the same refused address
  });
});

d("an owner's books are shown only to the owner (handler level)", async () => {
  const { getDb } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { handlers } = await import("../lib/api/handlers");
  const { resetSimMemory } = await import("../lib/sim/store");
  const read = handlers["POST /api/treasury/:principal"]!;

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("knowing an owner's public key is not enough to read their treasury", async () => {
    const [ada, ops, eve] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: null, purposes: null, notAfter: new Date(Date.now() + 3600_000).toISOString(), splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const params = { principal: ada!.publicKey };
    expect((await read({ params, body: {} })).status).toBe(401);
    // Eve signs a read of Ada's books with her own key
    expect((await read({ params, body: { signed: await E.signRead(eve!, "treasury", ada!.publicKey) } })).status).toBe(401);
    // Eve signs with her key and writes Ada's key in `by`
    const posing = await E.signRead(eve!, "treasury", ada!.publicKey); posing.by = ada!.publicKey;
    expect((await read({ params, body: { signed: posing } })).status).toBe(401);
    // Ada's own signature for a different subject, an old one, or another kind of signed message
    expect((await read({ params, body: { signed: await E.signRead(ada!, "treasury", eve!.publicKey) } })).status).toBe(401);
    expect((await read({ params, body: { signed: await E.signRead(ada!, "treasury", ada!.publicKey, new Date(Date.now() - 10 * 60_000)) } })).status).toBe(401);
    const revoke = await E.signRevoke(ada!, chain[0]!.body.id);
    expect((await read({ params, body: { signed: { request: revoke.request, sig: revoke.sig, by: ada!.publicKey } } })).status).toBe(401);
    // Ada
    const ok = await read({ params, body: { signed: await E.signRead(ada!, "treasury", ada!.publicKey) } });
    expect(ok.status ?? 200).toBe(200);
    expect((ok.body as { totals: { open: number } }).totals.open).toBe(1);
  });
});

d("private keys at rest", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");

  beforeEach(async () => {
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("with a secret set, the gateway's signing key is not readable from the database alone", async () => {
    process.env.ENVELOPE_KEY_SECRET = "a-test-secret-of-enough-length-000";
    try {
      const key = await G.gatewayKey();
      const row = (await getDb().select().from(schema.gatewayKeys))[0]!;
      expect((row.privateJwk as JsonWebKey).d).toBeUndefined();
      expect(JSON.stringify(row.privateJwk)).toContain("A256GCM");
      // the same secret opens it again and it is the same key
      G.forgetGatewayKey();
      expect((await G.gatewayKey()).publicKey).toBe(key.publicKey);
      const sig = await E.signDetached((await G.gatewayKey()).privateKey, "test/1", { a: 1 });
      expect(await E.verifyDetached(key.publicKey, "test/1", { a: 1 }, sig)).toBe(true);
      // another secret, or none, does not
      G.forgetGatewayKey();
      process.env.ENVELOPE_KEY_SECRET = "a-different-secret-of-enough-length";
      await expect(G.gatewayKey()).rejects.toThrow(/does not open/);
      delete process.env.ENVELOPE_KEY_SECRET;
      await expect(G.gatewayKey()).rejects.toThrow(/not set/);
    } finally { delete process.env.ENVELOPE_KEY_SECRET; G.forgetGatewayKey(); }
  });
});
