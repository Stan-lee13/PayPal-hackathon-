/**
 * Milestone 4.6d — reading the organization's administrative trail back.
 *
 * Milestone 4.6c made every membership decision an entry in a hash chain scoped to the organization. Until this
 * existed the chain could only be inspected with a database client, which is not a thing to ask an auditor to do.
 * These tests hold the read to the same rules as the writes it reports:
 *
 *   • the organization comes from the session, never from the request, so another organization's trail is not
 *     reachable at all;
 *   • `audit.read` is required — an auditor may read, a developer is refused rather than shown an empty page;
 *   • it is read-only: there is one GET and no route that appends an entry;
 *   • it reports what actually happened, newest first, and says so when the chain does not verify.
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("organization audit history (Milestone 4.6d)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { asc, desc, eq, sql } = await import("drizzle-orm");
  const { route } = await import("../lib/api/next");
  const { openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { createTestIdentity } = await import("../lib/auth/testing");

  const reset = () =>
    getDb().execute(
      sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`,
    );

  const cookie = (token: string) => `authjs.session-token=${encodeURIComponent(token)}`;

  type Reply = { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

  const call = async (method: string, key: string, path: string, params: Record<string, string>, session: string | null, body: unknown = {}): Promise<Reply> => {
    const res = await route(key as never)(
      new Request(`http://localhost:3000${path}`, {
        method,
        headers: { "content-type": "application/json", ...(session ? { cookie: cookie(session) } : {}) },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      }),
      { params: Promise.resolve(params) },
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  const history = (session: string | null) =>
    call("GET", "GET /api/organizations/audit", "/api/organizations/audit", {}, session);
  const setRole = (session: string, userId: string, role: string) =>
    call("POST", "POST /api/organizations/members/:userId/role", `/api/organizations/members/${userId}/role`, { userId }, session, { role });
  const remove = (session: string, userId: string) =>
    call("POST", "POST /api/organizations/members/:userId/remove", `/api/organizations/members/${userId}/remove`, { userId }, session);

  it("requires a session, and audit.read rather than any membership at all", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const auditor = await createTestIdentity({ orgId: dev.orgId, role: "auditor" });
    const developer = await createTestIdentity({ orgId: dev.orgId, role: "developer" });

    expect((await history(null)).status).toBe(401);

    const denied = await history(developer.sessionToken);
    expect(denied.status).toBe(403);
    expect(String(denied.body.error)).toContain("audit.read");

    const read = await history(auditor.sessionToken);
    expect(read.status).toBe(200);
    expect(read.body.organization.id).toBe(dev.orgId);
    expect(read.body.entries).toEqual([]);
    expect(read.body.total).toBe(0);
    // An empty chain still verifies: it is the organization's genesis and nothing has been appended to it.
    expect(read.body.chain).toMatchObject({ verified: true, length: 0 });
  });

  it("reads the session's own chain newest first, and verifies it against what was written", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const jane = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "jane@example.test" });

    expect((await setRole(dev.sessionToken, jane.userId, "auditor")).status).toBe(200);
    expect((await remove(dev.sessionToken, jane.userId)).status).toBe(200);
    // A refused change is not a decision, so it adds nothing: the trail describes the roster, not the attempts.
    expect((await remove(dev.sessionToken, dev.userId)).status).toBe(409);

    const read = await history(dev.sessionToken);
    expect(read.status).toBe(200);
    expect(read.body.entries.map((e: { action: string }) => e.action)).toEqual(["member.removed", "member.role_changed"]);
    expect(read.body.entries.map((e: { seq: number }) => e.seq)).toEqual([2, 1]);
    expect(read.body).toMatchObject({ total: 2, showing: 2 });
    expect(read.body.chain.verified).toBe(true);

    // The head the page shows is the newest hash actually stored, and each entry names its own predecessor.
    const stored = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.orgId, dev.orgId)).orderBy(asc(schema.auditLog.seq));
    expect(read.body.chain.head).toBe(stored[stored.length - 1]!.hash);
    expect(read.body.entries[0].hash).toBe(stored[1]!.hash);
    expect(read.body.entries[1].prevHash).toBe(stored[0]!.prevHash);
    // What the reader gets is the change, who made it and the address it concerns — never a secret.
    expect(read.body.entries[1].detail).toMatchObject({ email: "jane@example.test", from: "developer", to: "auditor" });
  });

  it("shows nothing that belongs to another organization", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const other = await createTestIdentity({ orgName: "Somebody else", role: "owner" });
    const theirs = await createTestIdentity({ orgId: other.orgId, role: "developer", email: "theirs@example.test" });
    expect((await setRole(other.sessionToken, theirs.userId, "auditor")).status).toBe(200);

    // The caller's own organization has no decisions, and the other organization's decision is not in it.
    expect((await history(dev.sessionToken)).body.total).toBe(0);
    const mine = await history(other.sessionToken);
    expect(mine.body.total).toBe(1);
    expect(mine.body.organization.name).toBe("Somebody else");
    expect(mine.body.entries[0].detail).toMatchObject({ email: "theirs@example.test" });
  });

  it("says the chain is broken instead of showing a green tick when an entry was edited", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const jane = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "jane@example.test" });
    expect((await setRole(dev.sessionToken, jane.userId, "auditor")).status).toBe(200);

    const [row] = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.orgId, dev.orgId)).orderBy(desc(schema.auditLog.seq)).limit(1);
    await getDb().update(schema.auditLog).set({ detail: { ...row!.detail, to: "owner" } }).where(eq(schema.auditLog.id, row!.id));

    const read = await history(dev.sessionToken);
    expect(read.status).toBe(200);
    expect(read.body.chain.verified).toBe(false);
    expect(String(read.body.chain.reason)).toContain("hash");
    // The entries themselves are still returned: an edited trail is evidence, not something to hide.
    expect(read.body.entries).toHaveLength(1);
  });

  it("is a read-only surface: one GET, audit.read, and no route that appends", async () => {
    const { ROUTE_POLICY } = await import("../lib/api/route-policy");
    const keys = Object.keys(ROUTE_POLICY).filter((k) => k.includes("/api/organizations/audit"));
    expect(keys).toEqual(["GET /api/organizations/audit"]);
    expect(ROUTE_POLICY["GET /api/organizations/audit"]).toMatchObject({
      category: "session", permission: "audit.read", session: "required", enforcement: "enforced",
    });
  });
});
