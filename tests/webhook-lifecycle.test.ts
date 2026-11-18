/**
 * The provider event lifecycle at /api/rails/webhook: what is authenticated, what is applied, what is
 * refused, what can be retried, what an acknowledgement means — and what must never be logged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("provider event lifecycle (/api/rails/webhook)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { handlers, run } = await import("../lib/api/handlers");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;

  type Res = { status?: number; body: unknown; threw?: boolean };
  const post = async (body: unknown, opts: { headers?: Record<string, string>; raw?: string } = {}): Promise<Res> => {
    try {
      return (await run(handlers["POST /api/rails/webhook"]!, {
        params: {}, body, raw: opts.raw ?? JSON.stringify(body),
        headers: { "mock-signature": "MOCK-VALID", ...(opts.headers ?? {}) },
      })) as Res;
    } catch (e) {
      return { status: 500, body: { error: String(e) }, threw: true };
    }
  };
  const status = (r: Res) => r.status ?? 200;

  beforeEach(async () => {
    process.env.ENVELOPE_WEBHOOK_ID = "MOCK-ENDPOINT";
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });
  afterEach(() => { delete process.env.ENVELOPE_WEBHOOK_ID; forgetRails(); });

  async function paid(amountMinor = 1300) {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 20000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const r = await G.spend(await E.signSpend(chain, ops, { amount: amountMinor, payee: "designer@example.com", purpose: "design" }));
    expect(r.status).toBe("PAID");
    return r.spend!;
  }
  const books = async () => ({
    spends: (await getDb().select().from(schema.spends)).length,
    ledger: (await getDb().select().from(schema.ledger)).length,
    events: (await getDb().select().from(schema.paypalEvents)).length,
    captured: (await getDb().select({ n: sql<number>`coalesce(sum(${schema.roots.capturedMinor}), 0)::int` }).from(schema.roots))[0]!.n,
  });
  const eventFor = async (spendId: string) => {
    const ev = (await rail.events.list()).find((e) => JSON.stringify(e.resource).includes(spendId) || e.type.includes("CAPTURE"))!;
    return { id: ev.id, event_type: ev.type, resource: ev.resource as Record<string, unknown> };
  };

  it("authenticates through the rail's adapter: no signature, a wrong one, or an adapter that cannot verify is refused", async () => {
    const s = await paid();
    const body = await eventFor(s.id);
    expect(status(await post(body, { headers: { "mock-signature": "" } }))).toBe(401);
    expect(status(await post(body, { headers: { "mock-signature": "forged" } }))).toBe(401);
    // A rail that cannot verify events refuses them rather than accepting them unverified.
    const blind = mockRail({ profile: { "events.verify": false } });
    setRailForTesting(blind);
    setRailForTesting(blind);
    expect(status(await post(body))).toBe(401);
    expect(await books()).toMatchObject({ events: 0 });
    setRailForTesting(rail);
    // A body that is not this rail's event shape never reaches the provider.
    expect(status(await post({ hello: "world" }))).toBe(400);
    // An event id the rail never issued is not genuine, however well formed.
    expect(status(await post({ ...body, id: "MOCK-EVT-INVENTED" }))).toBe(401);
    expect(await books()).toMatchObject({ events: 0 });
  });

  it("applies the bytes that were signed, not a second parse of them", async () => {
    const s = await paid();
    const genuine = await eventFor(s.id);
    // A request whose parsed body says one thing and whose raw text says another is applied as the raw
    // text — the thing the provider actually signed. (The alternative is applying content nobody vouched for.)
    const altered = { ...genuine, resource: { ...genuine.resource, amount: { ...(genuine.resource.amount as object), value: "999.99" } } };
    const r = await post(altered, { raw: JSON.stringify(genuine) });
    expect(status(r)).toBe(200);
    expect((r.body as { duplicate: boolean }).duplicate).toBe(false);
    expect(await books()).toMatchObject({ spends: 1, captured: 1300 });
    // And an altered raw body with a genuine parsed body is refused: the signature covers the text.
    const sneaky = await post(genuine, { raw: JSON.stringify({ ...genuine, resource: { ...genuine.resource, status: "VOIDED" } }) });
    expect(status(sneaky)).toBe(401);
  });

  it("is idempotent, calmly: the same event eight times changes nothing the second time", async () => {
    const s = await paid(700);
    const body = await eventFor(s.id);
    const before = await books();
    const first = await post(body);
    expect(status(first)).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false });
    const after = await books();
    expect(after.events).toBe(1);
    expect(after).toMatchObject({ spends: before.spends, ledger: before.ledger, captured: before.captured });
    for (let i = 0; i < 7; i++) {
      const again = await post(body);
      expect(status(again)).toBe(200);
      expect(again.body).toMatchObject({ duplicate: true, subject: null });
    }
    expect(await books()).toMatchObject({ events: 1, spends: before.spends, ledger: before.ledger, captured: before.captured });
  });

  it("an event that names nothing this gateway did cannot move money", async () => {
    const s = await paid(800);
    const body = await eventFor(s.id);
    const before = await books();
    // Same genuine id, different type: the rail's verification covers the type, so this is not genuine.
    expect(status(await post({ ...body, event_type: `${body.event_type}.TAMPERED` }))).toBe(401);
    // A genuine event whose resource names a capture we do not have.
    const stray = { id: (await rail.events.list())[0]!.id, event_type: body.event_type, resource: { ...body.resource, id: "CAP-UNRELATED", invoice_id: "sp_unknown" } };
    const r = await post(stray);
    // Either the rail refuses it (it did not issue that resource) or it applies to nothing; never a money move.
    if (status(r) === 200) expect((r.body as { subject: string | null }).subject).toBeNull();
    else expect(status(r)).toBe(401);
    expect(await books()).toMatchObject({ spends: before.spends, ledger: before.ledger, captured: before.captured });
  });

  it("a failed apply leaves nothing behind, and the redelivery is applied once", async () => {
    const s = await paid(900);
    const body = await eventFor(s.id);
    const before = await books();
    // The event is written as "received", then applying it fails (a database hiccup at the last write).
    // Nothing may be left claiming it was applied, or the provider's redelivery would be dropped as a duplicate.
    const S = await import("../lib/gateway/settlement");
    const db = getDb() as unknown as { update: unknown };
    const realUpdate = db.update;
    db.update = () => { throw new Error("database hiccup"); };
    await expect(S.applyPayPalEvent({ id: body.id, event_type: body.event_type, resource: body.resource }, "webhook")).rejects.toThrow(/hiccup/);
    db.update = realUpdate;
    expect(await books()).toMatchObject({ events: 0, spends: before.spends, ledger: before.ledger });
    // The provider redelivers: processed now, exactly once.
    const retried = await post(body);
    expect(status(retried)).toBe(200);
    expect(retried.body).toMatchObject({ duplicate: false, subject: s.id });
    expect(await books()).toMatchObject({ events: 1, captured: before.captured });
    // A second delivery of the same event is a duplicate, not a second application.
    expect((await post(body)).body).toMatchObject({ duplicate: true });
  });

  it("acknowledges receipt, not settlement, and keeps payloads out of the record", async () => {
    const s = await paid(1100);
    const body = await eventFor(s.id);
    const r = await post(body);
    const text = JSON.stringify(r.body);
    // The response says which event, whether it was new, what it matched and what changed — nothing more.
    expect(Object.keys(r.body as object).sort()).toEqual(["duplicate", "event", "outcome", "subject", "type"]);
    expect(text).not.toMatch(/designer@example\.com|signature|mock-signature|Bearer/i);
    expect(text).not.toMatch(/delivered|settled success/i);
    // The stored event keeps ids and an outcome, not the provider's payload.
    const row = (await getDb().select().from(schema.paypalEvents))[0]!;
    const stored = JSON.stringify(row);
    expect(stored).not.toMatch(/designer@example\.com|MOCK-VALID|Bearer/i);
    expect(row).toMatchObject({ id: body.id, source: "webhook" });
    expect(row.outcome.length).toBeLessThan(200);
    // Nor does any trail entry written for the event keep a payload.
    for (const a of await getDb().select().from(schema.auditLog)) {
      if (a.scopeId !== body.id) continue;
      expect(JSON.stringify(a)).not.toMatch(/designer@example\.com|MOCK-VALID|Bearer/i);
    }
    void s;
    void eq;
  });
});
