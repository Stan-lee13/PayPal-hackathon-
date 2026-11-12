/**
 * Sealing an envelope with a hold the payer approves in PayPal's own checkout. Against the built-in
 * PayPal simulator, where "the payer approves" is simApproveOrder (the simulated checkout page calls it).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("a hold the payer approves at PayPal (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const S = await import("../lib/gateway/settlement");
  const sim = await import("../lib/paypal/emulator");
  const { handlers, run } = await import("../lib/api/handlers");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const BACK = { returnUrl: "https://envelope.example/console?approved=1", cancelUrl: "https://envelope.example/console?cancelled=1" };
  const calls = async (frag: string) => (await sim.simCalls()).filter((c) => c.includes(frag)).length;
  const roots = () => getDb().select().from(schema.roots);
  const refused = async (p: Promise<unknown>) => p.then(() => null, (e: { status?: number; message: string }) => ({ status: e.status, message: e.message }));

  async function envelope(limit = 20000) {
    const [ada, ops] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    return { ada: ada!, ops: ops!, chain, id: chain[0]!.body.id };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
  });

  it("nothing is held or recorded until the payer approves; then the hold is placed on the order they approved", async () => {
    const w = await envelope();
    const asked = await G.askApproval({ chain: w.chain, title: "Launch budget", ...BACK });
    expect(asked).toMatchObject({ amountMinor: 20000, currency: "USD" });
    expect(asked.approveUrl).toContain(asked.orderId);
    // asking holds nothing and stores nothing: if the payer walks away there is nothing to undo
    expect(await roots()).toHaveLength(0);
    expect(await calls("/authorize")).toBe(0);

    // sealing before the payer has approved is refused, and PayPal is not asked to authorize
    expect(await refused(G.registerRoot({ chain: w.chain, principalName: "Ada", title: "Launch budget", paypalOrderId: asked.orderId }))).toMatchObject({ status: 409, message: expect.stringContaining("has not approved") });
    expect(await roots()).toHaveLength(0);

    expect(await sim.simApproveOrder(asked.orderId)).toBe(true);
    const root = await G.registerRoot({ chain: w.chain, principalName: "Ada", title: "Launch budget", paypalOrderId: asked.orderId });
    expect(root).toMatchObject({ id: w.id, limitMinor: 20000, paypalOrderId: asked.orderId, status: "ACTIVE" });
    expect(root.authorizationId).toBeTruthy();
    expect((await sim.simAuthorization(root.authorizationId!))).toMatchObject({ status: "CREATED", order_id: asked.orderId, custom_id: w.id });

    // the envelope then works like any other: a payment is a partial capture of that hold
    const paid = await G.spend(await E.signSpend(w.chain, w.ops, { amount: 4500, payee: "designer@example.com", purpose: "design" }));
    expect(paid.spend?.captureId).toBeTruthy();
    // sealing again with the same order returns the same envelope and authorizes nothing twice
    expect((await G.registerRoot({ chain: w.chain, principalName: "Ada", title: "Launch budget", paypalOrderId: asked.orderId })).authorizationId).toBe(root.authorizationId);
    expect(await calls("/authorize")).toBe(1);

    // the record of PayPal calls says how the hold came about, and the audit trail says who approved
    const t = (await S.paypalTrail(w.id))!;
    // (records are written without waiting, so their order is not asserted)
    expect(t.calls.map((c) => `${c.op} ${c.paypalStatus}`).filter((x) => /^(hold\.ask|order\.read|hold\.place) /.test(x)).sort()).toEqual(["hold.ask PAYER_ACTION_REQUIRED", "hold.place CREATED", "order.read APPROVED", "order.read PAYER_ACTION_REQUIRED"]);
    expect(t.summary).toMatchObject({ holds: 1 });
    const placed = (await getDb().select().from(schema.auditLog)).find((a) => a.action === "hold.placed")!;
    expect(placed.detail).toMatchObject({ funding: "approved by the payer in PayPal's checkout", payerId: "SIMPAYER7Q2" });
    expect(JSON.stringify(placed.detail)).not.toContain("payer@personal.example.com"); // the payer's address is masked
  });

  it("an approved order can back only the envelope it was made for", async () => {
    const mine = await envelope(), other = await envelope(), bigger = await envelope(30000);
    const asked = await G.askApproval({ chain: mine.chain, title: "Mine", ...BACK });
    await sim.simApproveOrder(asked.orderId);
    // someone else's envelope, and an envelope for a different amount, presented with my approved order
    for (const w of [other, bigger]) expect(await refused(G.registerRoot({ chain: w.chain, principalName: "Eve", title: "Not mine", paypalOrderId: asked.orderId }))).toMatchObject({ status: 422, message: expect.stringContaining("not made for this envelope") });
    // an order id PayPal does not know
    expect(await refused(G.registerRoot({ chain: other.chain, principalName: "Eve", title: "x", paypalOrderId: "SIMORDNOPE1234" }))).toMatchObject({ status: 502 });
    expect(await roots()).toHaveLength(0);
    expect(await calls("/authorize")).toBe(0);
    // mine still seals
    expect((await G.registerRoot({ chain: mine.chain, principalName: "Ada", title: "Mine", paypalOrderId: asked.orderId })).id).toBe(mine.id);
  });

  it("the endpoints: an approval link needs a real return address, and the simulated checkout exists only on the simulator", async () => {
    const w = await envelope();
    const post = (key: string, body: unknown) => run(handlers[key as keyof typeof handlers]!, { params: {}, body });
    expect((await post("POST /api/envelopes/approval", { chain: w.chain, title: "x", returnUrl: "javascript:alert(1)", cancelUrl: BACK.cancelUrl })).status).toBe(400);
    const a = await post("POST /api/envelopes/approval", { chain: w.chain, title: "Launch budget", ...BACK });
    expect(a.status).toBe(200);
    const { orderId, approveUrl } = a.body as { orderId: string; approveUrl: string };
    expect(approveUrl.startsWith("/sim/paypal?")).toBe(true); // on the simulator the checkout is a page of this app, marked as such
    expect((await post("POST /api/sim/paypal/approve", { orderId: "SIMORDNOPE1234" })).status).toBe(409);
    expect((await post("POST /api/sim/paypal/approve", { orderId })).status).toBe(200);
    expect((await post("POST /api/sim/paypal/approve", { orderId })).status).toBe(409); // already approved
    const sealed = await post("POST /api/envelopes", { chain: w.chain, principalName: "Ada", title: "Launch budget", paypalOrderId: orderId });
    expect(sealed.status).toBe(200);
    // an envelope already sealed cannot be put up for approval again
    expect((await post("POST /api/envelopes/approval", { chain: w.chain, title: "Launch budget", ...BACK })).status).toBe(409);
  });
});
