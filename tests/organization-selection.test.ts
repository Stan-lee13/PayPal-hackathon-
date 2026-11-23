/**
 * Milestone 4.5 — a session can say which of its memberships it is being served for.
 *
 * Milestone 4.4 made a session mandatory and scoped every read to the caller's organization, but a person in two
 * organizations was always served the oldest membership with no way to choose. That is a real dead end (the second
 * organization's books exist and cannot be opened), so the choice is now explicit.
 *
 * What these tests hold the implementation to:
 *
 *   • the choice is written to the session row and re-checked against an active membership on every read, so a
 *     cookie or a body field naming an organization is never authorization;
 *   • choosing an organization the person is not in — unknown, or only `INVITED` — is the same 403 as one that
 *     does not exist, and leaves the session serving what it was serving;
 *   • the reads really move: the envelope that was 404 becomes 200 and the one that was 200 becomes 404;
 *   • a membership revoked after it was chosen falls back to the oldest remaining one instead of failing;
 *   • the route needs a session, and a cross-origin POST is refused.
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("organization selection (Milestone 4.5)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { route } = await import("../lib/api/next");
  const { openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { newId } = await import("../lib/ids");
  const selection = await import("../app/api/session/organization/route");

  const reset = () =>
    getDb().execute(
      sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`,
    );

  const cookie = (token: string) => `authjs.session-token=${encodeURIComponent(token)}`;

  const selectionRequest = (init: { method?: "GET" | "POST"; body?: unknown; token?: string; origin?: string } = {}) =>
    new Request("http://localhost:3000/api/session/organization", {
      method: init.method ?? "GET",
      headers: {
        ...(init.token ? { cookie: cookie(init.token) } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.origin ? { origin: init.origin } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  /** One envelope in an organization, so a read can be proved to serve it (or refuse it). */
  async function seedEnvelope(orgId: string) {
    const db = getDb();
    const principal = orgId.padEnd(43, "x").slice(0, 43).replace(/[^A-Za-z0-9_-]/g, "x");
    const rootId = newId("rt");
    await db.insert(schema.roots).values({ id: rootId, principal, orgId, principalName: "Ada", title: "Budget", currency: "USD", limitMinor: 20000 });
    return rootId;
  }

  /** A second organization the development user belongs to, with the role and status the test needs. */
  async function joinOrganization(userId: string, opts: { name?: string; role?: "owner" | "developer"; status?: "ACTIVE" | "INVITED" | "REVOKED" } = {}) {
    const org = (await getDb().insert(schema.organizations).values({ id: newId("org"), name: opts.name ?? "Second organization" }).returning())[0]!;
    await getDb().insert(schema.memberships).values({
      id: newId("mem"), orgId: org.id, userId, role: opts.role ?? "owner", status: opts.status ?? "ACTIVE",
    });
    return org;
  }

  const readEnvelope = async (rootId: string, token: string) => {
    const handler = route("GET /api/envelopes/:id");
    const res = await handler(new Request(`http://localhost:3000/api/envelopes/${rootId}`, { headers: { cookie: cookie(token) } }), {
      params: Promise.resolve({ id: rootId }),
    });
    return res.status;
  };

  it("starts on the oldest active membership and lists every organization the person may choose", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const second = await joinOrganization(dev.userId, { name: "Second organization" });

    const res = await selection.GET(selectionRequest({ token: dev.sessionToken }));
    const body = (await res.json()) as { current: { orgId: string }; memberships: { orgId: string }[] };
    expect(res.status).toBe(200);
    expect(body.current.orgId).toBe(dev.orgId);
    expect(body.memberships.map((m) => m.orgId).sort()).toEqual([dev.orgId, second.id].sort());
  });

  it("moves the reads to the chosen organization, and away from the one it was serving", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const second = await joinOrganization(dev.userId, { name: "Second organization" });
    const first = await seedEnvelope(dev.orgId);
    const theirs = await seedEnvelope(second.id);

    // Before the choice: the first organization's envelope is readable and the second's is not.
    expect(await readEnvelope(first, dev.sessionToken)).toBe(200);
    expect(await readEnvelope(theirs, dev.sessionToken)).toBe(404);

    const res = await selection.POST(selectionRequest({ method: "POST", token: dev.sessionToken, body: { orgId: second.id } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { org: { orgId: string } }).org.orgId).toBe(second.id);

    // After it: exactly reversed, which is the whole point.
    expect(await readEnvelope(theirs, dev.sessionToken)).toBe(200);
    expect(await readEnvelope(first, dev.sessionToken)).toBe(404);

    const row = await getDb().query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, dev.sessionToken) });
    expect(row?.activeOrgId).toBe(second.id);
  });

  it("refuses an organization the person is not in, and keeps serving the one it was serving", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const first = await seedEnvelope(dev.orgId);
    const stranger = (await getDb().insert(schema.organizations).values({ id: newId("org"), name: "Not mine" }).returning())[0]!;
    const invited = await joinOrganization(dev.userId, { name: "Invitation only", status: "INVITED" });

    // An organization that exists but is not theirs, an unknown id, and an invitation that was never accepted all
    // answer the same way: nothing about another organization is disclosed by the difference.
    for (const orgId of [stranger.id, invited.id, "org_does_not_exist"]) {
      const res = await selection.POST(selectionRequest({ method: "POST", token: dev.sessionToken, body: { orgId } }));
      expect(res.status, orgId).toBe(403);
    }

    expect(await readEnvelope(first, dev.sessionToken)).toBe(200);
    const row = await getDb().query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, dev.sessionToken) });
    expect(row?.activeOrgId ?? null).toBe(null);
  });

  it("falls back to the oldest membership when the chosen one is revoked afterwards", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const second = await joinOrganization(dev.userId, { name: "Second organization" });
    const first = await seedEnvelope(dev.orgId);
    const theirs = await seedEnvelope(second.id);

    expect((await selection.POST(selectionRequest({ method: "POST", token: dev.sessionToken, body: { orgId: second.id } }))).status).toBe(200);
    expect(await readEnvelope(theirs, dev.sessionToken)).toBe(200);

    await getDb().update(schema.memberships).set({ status: "REVOKED" }).where(eq(schema.memberships.orgId, second.id));

    // The stale choice is not an error and is not honoured: the session falls back to what is still theirs.
    expect(await readEnvelope(first, dev.sessionToken)).toBe(200);
    expect(await readEnvelope(theirs, dev.sessionToken)).toBe(404);
    const listed = (await (await selection.GET(selectionRequest({ token: dev.sessionToken }))).json()) as { current: { orgId: string }; memberships: unknown[] };
    expect(listed.current.orgId).toBe(dev.orgId);
    expect(listed.memberships).toHaveLength(1);
  });

  it("needs a session, and refuses a cross-origin switch", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const second = await joinOrganization(dev.userId);

    expect((await selection.GET(selectionRequest())).status).toBe(401);
    expect((await selection.POST(selectionRequest({ method: "POST", body: { orgId: second.id } }))).status).toBe(401);

    const cross = await selection.POST(selectionRequest({ method: "POST", token: dev.sessionToken, body: { orgId: second.id }, origin: "https://elsewhere.example" }));
    expect(cross.status).toBe(403);

    // A body without an organization is refused before anything is written.
    expect((await selection.POST(selectionRequest({ method: "POST", token: dev.sessionToken, body: {} }))).status).toBe(400);
    const row = await getDb().query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, dev.sessionToken) });
    expect(row?.activeOrgId ?? null).toBe(null);
  });
});
