/**
 * Milestone 4.4 — the HTTP wrapper requires a session for a read that serves one organization.
 *
 * These tests go through `route()`, the same wrapper Next.js mounts, not through the handlers directly. That is
 * the layer the route table is enforced at, so it is the layer that has to be proved:
 *
 *   • no cookie is a 401 on every session-classified read, before any handler runs;
 *   • a validated session reads its own organization's records and gets a 404 for another organization's;
 *   • the permission named in the table is enforced from the membership role (a developer cannot read the books);
 *   • a revoked session stops working immediately;
 *   • the signed-only proof surface stays public, because that is what a payee is shown.
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

const SESSION_READS = [
  "GET /api/envelopes/:id",
  "GET /api/envelopes/:id/paypal",
  "GET /api/spends/:id",
  "GET /api/spends/:id/status",
  "GET /api/spends/:id/evidence",
  "GET /api/bank",
  "GET /api/bank/statement",
  "GET /api/bank/transfers/:id",
  "GET /api/cards",
  "GET /api/cards/:id",
] as const;

d("session-required reads (through the HTTP wrapper)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { route } = await import("../lib/api/next");
  const { openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { newId } = await import("../lib/ids");

  const reset = () => getDb().execute(sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);

  async function seed(orgId: string | null) {
    const db = getDb();
    const principal = `${orgId ?? "none"}`.padEnd(43, "x").slice(0, 43).replace(/[^A-Za-z0-9_-]/g, "x");
    const rootId = newId("rt");
    await db.insert(schema.roots).values({ id: rootId, principal, orgId, principalName: "Ada", title: "Budget", currency: "USD", limitMinor: 20000 });
    const blockId = newId("bl");
    await db.insert(schema.blocks).values({ id: blockId, rootId, orgId, depth: 0, hash: `h_${blockId}`, holder: principal, holderLabel: "ada", caps: {} as never, raw: {} as never });
    const spendId = newId("sp");
    await db.insert(schema.spends).values({
      id: spendId, rootId, orgId, leafId: blockId, leafLabel: "ada", chainIds: [blockId], requestHash: `rh_${spendId}`,
      signed: { request: { releaseBy: null } } as never, amountMinor: 100, currency: "USD", payee: "translator@example.com", purpose: "translation",
      status: "DENIED", captureId: `CAP_${spendId}`,
    });
    return { rootId, spendId };
  }

  const cookie = (token: string) => `authjs.session-token=${encodeURIComponent(token)}`;
  const url = (key: string, params: Record<string, string>) => {
    const path = key.split(" ")[1]!.replace(/:(\w+)/g, (_, k: string) => params[k] ?? "").replace(/\/$/, "");
    return `http://localhost:3000${path}`;
  };
  const call = async (key: (typeof SESSION_READS)[number], params: Record<string, string>, token?: string) => {
    const handler = route(key);
    const res = await handler(new Request(url(key, params), { headers: token ? { cookie: cookie(token) } : {} }), { params: Promise.resolve(params) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("refuses every organization read without a session, before the handler runs", async () => {
    await reset();
    const org = (await getDb().insert(schema.organizations).values({ id: newId("org"), name: "A" }).returning())[0]!;
    const s = await seed(org.id);
    for (const key of SESSION_READS) {
      const r = await call(key, { id: key.includes("cards") ? "cd_none" : key.includes("envelopes") ? s.rootId : key.includes("transfers") ? "tr_none" : s.spendId });
      expect(r.status, key).toBe(401);
    }
  });

  it("reads the caller's organization and answers 404 for another organization's record", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const other = (await getDb().insert(schema.organizations).values({ id: newId("org"), name: "Other" }).returning())[0]!;
    const mine = await seed(dev.orgId);
    const theirs = await seed(other.id);

    expect((await call("GET /api/envelopes/:id", { id: mine.rootId }, dev.sessionToken)).status).toBe(200);
    expect((await call("GET /api/envelopes/:id", { id: theirs.rootId }, dev.sessionToken)).status).toBe(404);
    expect((await call("GET /api/spends/:id", { id: theirs.spendId }, dev.sessionToken)).status).toBe(404);
    expect((await call("GET /api/spends/:id/status", { id: theirs.spendId }, dev.sessionToken)).status).toBe(404);
  });

  it("enforces the permission the table names, from the membership role", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const role = () => getDb().update(schema.memberships).set({ role: "developer" }).where(eq(schema.memberships.orgId, dev.orgId));
    await role();
    // A developer reads envelopes and payments, but not the books: statement.read is not theirs.
    expect((await call("GET /api/bank", {}, dev.sessionToken)).status).toBe(403);
    expect((await call("GET /api/cards", {}, dev.sessionToken)).status).toBe(403);
    await getDb().update(schema.memberships).set({ role: "owner" }).where(eq(schema.memberships.orgId, dev.orgId));
    expect((await call("GET /api/bank", {}, dev.sessionToken)).status).toBe(200);
  });

  it("stops accepting a session as soon as it is revoked", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const s = await seed(dev.orgId);
    expect((await call("GET /api/envelopes/:id", { id: s.rootId }, dev.sessionToken)).status).toBe(200);
    await getDb().delete(schema.sessions).where(eq(schema.sessions.sessionToken, dev.sessionToken));
    expect((await call("GET /api/envelopes/:id", { id: s.rootId }, dev.sessionToken)).status).toBe(401);
  });

  it("leaves the signed-only proof graph public: that is what a payee is shown", async () => {
    await reset();
    // Reached without any cookie. An unknown id is a 404 from the handler, not a 401 from the session check:
    // the proof graph answers anyone, and adds nothing private to the signed records it returns.
    const handler = route("GET /api/proof/:root");
    const missing = newId("rt");
    const res = await handler(new Request(`http://localhost:3000/api/proof/${missing}`), { params: Promise.resolve({ root: missing }) });
    expect(res.status).toBe(404);
  });
});
