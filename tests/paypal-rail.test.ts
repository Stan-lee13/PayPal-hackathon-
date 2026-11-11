/**
 * What PayPal does for an envelope, and settlement that finishes on PayPal's word:
 * the record of every PayPal call, the owner's recall of a payout nobody claimed, events from PayPal
 * (genuine, forged, repeated), and the sweep. Against the built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("the PayPal rail (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const S = await import("../lib/gateway/settlement");
  const sim = await import("../lib/paypal/emulator");
  const { handlers, run } = await import("../lib/api/handlers");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const calls = async (frag: string) => (await sim.simCalls()).filter((c) => c.includes(frag)).length;
  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((r) => r!);
  const rootRow = (id: string) => getDb().query.roots.findFirst({ where: eq(schema.roots.id, id) }).then((r) => r!);
  const blockRow = (id: string) => getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, id) }).then((r) => r!);
  const SIGNED = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-SIM", "paypal-transmission-id": "t-1", "paypal-transmission-sig": sim.SIM_SIGNATURE, "paypal-transmission-time": new Date().toISOString() };
  const webhook = (ev: unknown, headers: Record<string, string> = SIGNED) => run(handlers["POST /api/paypal/webhook"]!, { params: {}, body: ev, headers, raw: JSON.stringify(ev) });

  async function world(payee = "unclaimed.designer@example.com") {
    const [ada, ops] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: [payee], purposes: ["design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    return { ada: ada!, ops: ops!, chain, root, payee, leaf: chain[0]!.body.id };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
  });

  it("every PayPal call behind an envelope is on record, with no card number or body kept", async () => {
    const w = await world("designer@example.com");
    const paid = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }));
    expect(paid.status).toBe("PAID");
    const denied = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: "attacker@evil.example", purpose: "design" }));
    expect(denied.status).toBe("DENIED");
    await G.revoke(await E.signRevoke(w.ada, w.root.id));
    const t = (await S.paypalTrail(w.root.id))!;
    const ops = t.calls.map((c) => c.op);
    // the hold, one capture, one payout, and the release: four changes at PayPal, and nothing for the refused request
    expect(ops.filter((o) => ["hold.place", "capture", "payout.send", "hold.void"].includes(o))).toEqual(["hold.place", "capture", "payout.send", "hold.void"]);
    expect(t.summary).toMatchObject({ holds: 1, captures: 1, payouts: 1, voids: 1, refunds: 0, changed: 4, refused: 0 });
    const cap = t.calls.find((c) => c.op === "capture")!;
    expect(cap).toMatchObject({ amountMinor: 2500, currency: "USD", paypalStatus: "COMPLETED", requestId: `capture-${paid.spend!.id}`, resourceId: paid.spend!.captureId });
    expect(t.calls.find((c) => c.op === "hold.place")).toMatchObject({ amountMinor: 20000, paypalStatus: "CREATED", resourceId: w.root.authorizationId });
    const stored = JSON.stringify(await getDb().select().from(schema.paypalCalls));
    expect(stored).not.toMatch(/4012888888881881|4032039317984658|security_code|SIMULATED-TOKEN/);
    // the same signed request arriving again makes the gateway ask PayPal again with the same key: recorded as a repeat, counted once
    await G.settle(paid.spend!.id);
    expect((await S.paypalTrail(w.root.id))!.summary).toMatchObject({ captures: 1, payouts: 1 });
    // another envelope's calls are not mixed in
    const other = await world("designer@example.com");
    expect((await S.paypalTrail(other.root.id))!.calls.map((c) => c.op)).toEqual(["hold.place"]);
    // a call PayPal refuses is recorded as refused
    await sim.simFailNext("/capture", 5);
    await G.spend(await E.signSpend(other.chain, other.ops, { amount: 1000, payee: other.payee, purpose: "design" }));
    await sim.simFailNext(null);
    expect((await S.paypalTrail(other.root.id))!.summary.refused).toBeGreaterThan(0);
  });

  it("the owner recalls a payout nobody claimed: PayPal cancels it, the capture is refunded, the budget returns", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 6700, payee: w.payee, purpose: "design" }));
    expect(r.status).toBe("UNCLAIMED");
    expect((await rootRow(w.root.id)).capturedMinor).toBe(6700);
    // not the owner: the agent itself, a stranger, and the owner signing for a different payment
    const stranger = await E.generateKeyPair();
    for (const signed of [await E.signRead(w.ops, "recall", r.spend!.id), await E.signRead(stranger, "recall", r.spend!.id), await E.signRead(w.ada, "recall", "sp_someone_elses"), await E.signRead(w.ada, "treasury", r.spend!.id)]) {
      await expect(S.recall(r.spend!.id, signed)).rejects.toThrow(/Only the owner/);
    }
    expect(await calls("/cancel")).toBe(0);
    const back = await S.recall(r.spend!.id, await E.signRead(w.ada, "recall", r.spend!.id));
    expect(back.status).toBe("FAILED");
    expect(back.refundId).toBeTruthy();
    expect(back.payoutStatus).toBe("RETURNED");
    expect(back.reasons[0]!.code).toBe("RECALLED_BY_OWNER");
    expect(await calls("/cancel")).toBe(1);
    expect(await calls("/refund")).toBe(1);
    expect((await rootRow(w.root.id)).capturedMinor).toBe(0);
    expect(await blockRow(w.leaf)).toMatchObject({ spentMinor: 0, reservedMinor: 0 });
    // again: nothing more happens at PayPal
    const again = await S.recall(r.spend!.id, await E.signRead(w.ada, "recall", r.spend!.id));
    expect(again.status).toBe("FAILED");
    expect(await calls("/cancel")).toBe(1);
    expect(await calls("/refund")).toBe(1);
    // the money is spendable again
    expect((await G.spend(await E.signSpend(w.chain, w.ops, { amount: 8000, payee: w.payee, purpose: "design" }))).status).toBe("UNCLAIMED");
    const t = (await S.paypalTrail(w.root.id))!;
    expect(t.summary).toMatchObject({ cancels: 1, refunds: 1 });
  });

  it("a delivered payment cannot be recalled", async () => {
    const w = await world("designer@example.com");
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }));
    expect(r.status).toBe("PAID");
    await expect(S.recall(r.spend!.id, await E.signRead(w.ada, "recall", r.spend!.id))).rejects.toThrow(/delivered/);
    expect(await calls("/cancel")).toBe(0);
    expect((await spendRow(r.spend!.id)).status).toBe("PAID");
  });

  it("a genuine PayPal event settles a payment once; a forged, edited or unsigned one changes nothing", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 6700, payee: w.payee, purpose: "design" }));
    expect(r.status).toBe("UNCLAIMED");
    // PayPal later reports the payout claimed
    await sim.simSetPayout(r.spend!.payoutBatchId!, "SUCCESS");
    const ev = (await sim.simEvents()).at(-1)!;
    expect(ev.event_type).toBe("PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    // no signature headers, a wrong signature, and a genuine event edited to name another status
    expect((await webhook(ev, {})).status).toBe(401);
    expect((await webhook(ev, { ...SIGNED, "paypal-transmission-sig": "forged" })).status).toBe(401);
    expect((await webhook({ ...ev, resource: { ...ev.resource, transaction_status: "FAILED" } })).status).toBe(401);
    expect((await webhook({ id: "WH-INVENTED", event_type: "PAYMENT.PAYOUTS-ITEM.FAILED", resource: ev.resource })).status).toBe(401);
    expect((await spendRow(r.spend!.id)).status).toBe("UNCLAIMED");
    expect(await getDb().select().from(schema.paypalEvents)).toHaveLength(0);
    // the genuine one
    const first = await webhook(ev);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false, subject: r.spend!.id, outcome: "payment UNCLAIMED → PAID" });
    expect((await spendRow(r.spend!.id)).status).toBe("PAID");
    // delivered again by PayPal: applied once
    expect((await webhook(ev)).body).toMatchObject({ duplicate: true });
    expect(await getDb().select().from(schema.paypalEvents)).toHaveLength(1);
  });

  it("an event is only a hint: a genuine old event cannot undo what PayPal says now", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 6700, payee: w.payee, purpose: "design" }));
    const unclaimed = (await sim.simEvents()).find((e) => e.event_type === "PAYMENT.PAYOUTS-ITEM.UNCLAIMED")!;
    await sim.simSetPayout(r.spend!.payoutBatchId!, "SUCCESS");
    await S.sweepUnfinished();
    expect((await spendRow(r.spend!.id)).status).toBe("PAID");
    // the earlier "unclaimed" event arrives late: PayPal is asked, and it says SUCCESS
    const late = await webhook(unclaimed);
    expect(late.status).toBe(200);
    expect((await spendRow(r.spend!.id)).status).toBe("PAID");
  });

  it("a payout PayPal returns later is refunded by the sweep with nobody opening a page", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 6700, payee: w.payee, purpose: "design" }));
    await sim.simSetPayout(r.spend!.payoutBatchId!, "RETURNED"); // thirty days passed
    const out = await S.sweepUnfinished();
    // PayPal's own event feed told the gateway where to look; PayPal's answer for that payout did the rest
    // (whichever event about this payment is read first triggers the reading; the later ones find nothing left to do)
    expect(out.events.outcomes.filter((o) => o.subject === r.spend!.id && o.outcome === "payment UNCLAIMED → FAILED")).toHaveLength(1);
    const s = await spendRow(r.spend!.id);
    expect(s.refundId).toBeTruthy();
    expect((await rootRow(w.root.id)).capturedMinor).toBe(0);
    // a second sweep reads the refund PayPal has since reported, changes nothing, and a third has nothing new to read
    const again = await S.sweepUnfinished();
    expect(again.moved).toEqual([]);
    expect(again.events.outcomes.map((o) => o.type)).toEqual(["PAYMENT.CAPTURE.REFUNDED"]);
    expect(again.events.outcomes[0]!.outcome).toBe("payment unchanged (FAILED)");
    expect((await S.sweepUnfinished()).events.applied).toBe(0);
    expect(await calls("/refund")).toBe(1);
  });

  it("when PayPal reports the hold voided, the envelope closes and nothing more can be spent", async () => {
    const w = await world("designer@example.com");
    // voided at PayPal, outside the gateway
    const { getPayPal } = await import("../lib/paypal/client");
    await getPayPal().request("POST", `/v2/payments/authorizations/${w.root.authorizationId}/void`, { requestId: "outside-the-gateway" });
    const ev = (await sim.simEvents()).find((e) => e.event_type === "PAYMENT.AUTHORIZATION.VOIDED")!;
    const out = await webhook(ev);
    expect(out.body).toMatchObject({ subject: w.root.id });
    expect((await rootRow(w.root.id)).status).toBe("CLOSED");
    expect((await G.spend(await E.signSpend(w.chain, w.ops, { amount: 2500, payee: w.payee, purpose: "design" }))).status).toBe("DENIED");
    expect(await calls("/capture")).toBe(0);
  });

  it("the sweep endpoint refuses callers without the scheduler's secret when one is set", async () => {
    process.env.CRON_SECRET = "s3cret";
    try {
      expect((await run(handlers["POST /api/sweep"]!, { params: {}, body: {}, headers: {} })).status).toBe(401);
      expect((await run(handlers["POST /api/sweep"]!, { params: {}, body: {}, headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    } finally { delete process.env.CRON_SECRET; }
  });
});
