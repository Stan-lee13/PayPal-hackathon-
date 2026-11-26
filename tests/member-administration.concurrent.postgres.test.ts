/**
 * Milestone 4.6c — the same membership decisions, taken at the same moment on independent connections.
 *
 * A sequential test cannot show whether a rule holds when two requests overlap: an owner count read before a
 * transaction, a target role read before it was changed, and an audit entry appended after an update that
 * matched no rows all look correct when the requests arrive one after the other.
 *
 * These tests are gated the way `tests/concurrency.postgres.test.ts` is, and for the same reason — a single
 * serialized connection proves nothing about locking:
 *
 *   • `REAL_DATABASE_URL` must be set (CI sets it; a local run must opt in), and
 *   • a preflight asserts the server is a real PostgreSQL with more than one backend and that the pool is not
 *     one connection. If any of that is untrue the suite FAILS rather than skipped-passing.
 *
 * Several tests use a **gate**: a separate connection that takes the organization's membership lock, so the
 * request under test is parked exactly where the decision is about to be made. That is what makes these races
 * reproducible rather than merely likely: the competing change (another owner's promotion, a removal of the
 * caller) is committed *while* the request waits, and the assertions are about what the request does next. With
 * the pre-4.6c code the request never queues at all, so `waitFor` reports that it never reached the lock and the
 * test fails instead of passing by luck.
 */
import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const database = useTestEnv();
const optedIn = Boolean(process.env.REAL_DATABASE_URL);
const enabled = Boolean(database && optedIn);
const d = enabled ? describe : describe.skip;

d("membership administration under concurrency (Milestone 4.6c)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { and, asc, eq, isNull, sql } = await import("drizzle-orm");
  const { route } = await import("../lib/api/next");
  const { openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { createTestIdentity } = await import("../lib/auth/testing");
  const { newId } = await import("../lib/ids");
  const { hashInvitationToken, membershipLockKey } = await import("../lib/identity/members");
  const { genesisHash, verifyChain } = await import("../lib/ledger/chain");
  const accept = await import("../app/api/invitations/accept/route");

  beforeAll(async () => {
    const db = getDb();
    const versions = (await db.execute(sql`select version() as v`)) as unknown as Array<{ v: string }>;
    const version = String(versions[0]?.v ?? "");
    if (/pglite/i.test(version)) throw new Error(`These tests need a real Postgres server, not PGlite (got: ${version}).`);
    const pids = new Set<number>();
    const rows = await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_backend_pid() as pid`).catch(() => [])));
    for (const r of rows as unknown as Array<Array<{ pid: number | string }>>) pids.add(Number(r[0]?.pid));
    if (pids.size < 2) throw new Error(`The pool handed every query the same backend (pids: ${[...pids].join(", ")}): concurrency is not being exercised.`);
    if (Number(process.env.DB_POOL_MAX ?? 5) < 2) throw new Error("DB_POOL_MAX is 1: a single connection cannot establish locking behaviour. Set DB_POOL_MAX=8.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  });

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

  const setRole = (session: string, userId: string, role: unknown) =>
    call("POST", "POST /api/organizations/members/:userId/role", `/api/organizations/members/${userId}/role`, { userId }, session, { role });
  const remove = (session: string, userId: string) =>
    call("POST", "POST /api/organizations/members/:userId/remove", `/api/organizations/members/${userId}/remove`, { userId }, session);
  const invite = (session: string, email: string, role: string) =>
    call("POST", "POST /api/organizations/invitations", "/api/organizations/invitations", {}, session, { email, role });
  const withdraw = (session: string, id: string) =>
    call("POST", "POST /api/organizations/invitations/:id/revoke", `/api/organizations/invitations/${id}/revoke`, { id }, session);
  const acceptInvitation = async (session: string, token: string): Promise<Reply> => {
    const res = await accept.POST(
      new Request("http://localhost:3000/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(session) },
        body: JSON.stringify({ token }),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  /** A person known to the identity provider with no membership at all: the state an invitation is for. */
  async function signUp(email: string) {
    const userId = newId("usr");
    await getDb().insert(schema.users).values({
      id: userId, oidcIssuer: "https://idp.test.invalid", oidcSubject: newId("sub"), email,
      emailVerified: true, displayName: "Invitee",
    });
    const sessionToken = `test-session-${newId("tok")}`;
    await getDb().insert(schema.sessions).values({ sessionToken, userId, expires: new Date(Date.now() + 3600_000) });
    return { userId, sessionToken };
  }

  const membership = (orgId: string, userId: string) =>
    getDb().query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)) });

  const auditTrail = (orgId: string) =>
    getDb().select().from(schema.auditLog).where(eq(schema.auditLog.orgId, orgId)).orderBy(asc(schema.auditLog.seq));

  const chainVerdict = async (orgId: string) => {
    const trail = await auditTrail(orgId);
    return verifyChain(orgId, null, trail.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) as never);
  };

  const activeOwners = async (orgId: string) =>
    (await getDb().select().from(schema.memberships).where(and(
      eq(schema.memberships.orgId, orgId),
      eq(schema.memberships.role, "owner"),
      eq(schema.memberships.status, "ACTIVE"),
    ))).length;

  // ---- The gate: a second connection holding the organization's lock -------------------------------

  /** The gate's transaction handle: postgres.js's tagged-template callable. */
  type GateTx = any; // eslint-disable-line @typescript-eslint/no-explicit-any

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  }

  /**
   * Take `orgId`'s membership lock on a connection that is not the pool, wait for the test to release the
   * request(s) it started, then run `work` and commit. The request therefore executes its decision against
   * whatever `work` committed, which is precisely the race the decision has to survive.
   */
  async function holdingOrganizationLock<T>(orgId: string, requestIsParked: Promise<void>, work: (tx: GateTx) => Promise<T>): Promise<T> {
    const url = process.env.DATABASE_URL!;
    const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const result = await client.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${membershipLockKey(orgId)}, 0))`;
        await requestIsParked;
        return work(tx);
      });
      return result as unknown as T;
    } finally {
      await client.end({ timeout: 5 });
    }
  }

  /** Advisory locks held and waited on right now: the gate holds one, and a queued request waits for one. */
  const advisoryLocks = async (): Promise<{ granted: number; waiting: number }> => {
    const rows = (await getDb().execute(
      sql`select count(*) filter (where granted)::int as granted, count(*) filter (where not granted)::int as waiting from pg_locks where locktype = 'advisory'`,
    )) as unknown as Array<{ granted: number; waiting: number }>;
    return { granted: Number(rows[0]?.granted ?? 0), waiting: Number(rows[0]?.waiting ?? 0) };
  };

  async function waitFor(predicate: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - started > timeoutMs) throw new Error(`${what} (gave up after ${timeoutMs}ms)`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  const gateHoldsLock = () => waitFor(async () => (await advisoryLocks()).granted >= 1, "the gate never took the organization's membership lock");
  const requestsQueued = (n: number) =>
    waitFor(async () => (await advisoryLocks()).waiting >= n, `${n} request(s) never queued on the organization's membership lock`);

  // ---- Two owners, one organization ----------------------------------------------------------------

  it("two owners demoting each other leave an owner, and record only the decision that committed", async () => {
    await reset();
    const alice = await openDevelopmentSession();
    const bob = await createTestIdentity({ orgId: alice.orgId, role: "owner" });

    const parked = deferred();
    const gate = holdingOrganizationLock(alice.orgId, parked.promise, async () => undefined);
    await gateHoldsLock();

    const fromBob = setRole(bob.sessionToken, alice.userId, "developer");
    const fromAlice = setRole(alice.sessionToken, bob.userId, "developer");
    await requestsQueued(2);
    parked.resolve();
    await gate;

    const results = await Promise.all([fromBob, fromAlice]);
    // At most one may succeed: the first removes the second caller's authority to do it.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 403 || r.status === 409)).toHaveLength(1);
    expect(await activeOwners(alice.orgId)).toBeGreaterThanOrEqual(1);

    const trail = await auditTrail(alice.orgId);
    expect(trail.filter((r) => r.action === "member.role_changed")).toHaveLength(1);
    expect((await chainVerdict(alice.orgId)).ok).toBe(true);
  });

  it("two owners removing each other leave an owner, and one revocation in the chain", async () => {
    await reset();
    const alice = await openDevelopmentSession();
    const bob = await createTestIdentity({ orgId: alice.orgId, role: "owner" });

    const parked = deferred();
    const gate = holdingOrganizationLock(alice.orgId, parked.promise, async () => undefined);
    await gateHoldsLock();

    const fromBob = remove(bob.sessionToken, alice.userId);
    const fromAlice = remove(alice.sessionToken, bob.userId);
    await requestsQueued(2);
    parked.resolve();
    await gate;

    const results = await Promise.all([fromBob, fromAlice]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await activeOwners(alice.orgId)).toBeGreaterThanOrEqual(1);

    const trail = await auditTrail(alice.orgId);
    expect(trail.filter((r) => r.action === "member.removed")).toHaveLength(1);
    // Exactly one row is revoked: the other request never reached the write.
    const revoked = await getDb().select().from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, alice.orgId), eq(schema.memberships.status, "REVOKED")));
    expect(revoked).toHaveLength(1);
  });

  it("a demotion racing a removal still leaves an owner", async () => {
    await reset();
    const alice = await openDevelopmentSession();
    const bob = await createTestIdentity({ orgId: alice.orgId, role: "owner" });

    const parked = deferred();
    const gate = holdingOrganizationLock(alice.orgId, parked.promise, async () => undefined);
    await gateHoldsLock();

    const demote = setRole(alice.sessionToken, bob.userId, "developer");
    const revoke = remove(bob.sessionToken, alice.userId);
    await requestsQueued(2);
    parked.resolve();
    await gate;

    const [demoted, revoked] = await Promise.all([demote, revoke]);
    expect([demoted.status, revoked.status].filter((s) => s === 200)).toHaveLength(1);
    expect(await activeOwners(alice.orgId)).toBeGreaterThanOrEqual(1);
    expect((await chainVerdict(alice.orgId)).ok).toBe(true);
  });

  // ---- Stale target, stale actor -------------------------------------------------------------------

  it("an admin cannot demote a member who was promoted to owner while the request waited", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const admin = await createTestIdentity({ orgId: owner.orgId, role: "admin" });
    const finance = await createTestIdentity({ orgId: owner.orgId, role: "finance" });

    const parked = deferred();
    const gate = holdingOrganizationLock(owner.orgId, parked.promise, async (tx) => {
      // What an owner's promotion commits while the admin's request is in flight.
      await tx`update memberships set role = 'owner' where org_id = ${owner.orgId} and user_id = ${finance.userId}`;
    });
    await gateHoldsLock();

    const change = setRole(admin.sessionToken, finance.userId, "developer");
    await requestsQueued(1);
    parked.resolve();
    await gate;

    const result = await change;
    expect(result.status).toBe(403);
    expect(String(result.body.error)).toContain("payout.recover.approve");
    expect((await membership(owner.orgId, finance.userId))?.role).toBe("owner");
    expect((await auditTrail(owner.orgId)).filter((r) => r.action === "member.role_changed")).toHaveLength(0);
  });

  it("an admin cannot remove a member who was promoted to owner while the request waited", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const admin = await createTestIdentity({ orgId: owner.orgId, role: "admin" });
    const finance = await createTestIdentity({ orgId: owner.orgId, role: "finance" });

    const parked = deferred();
    const gate = holdingOrganizationLock(owner.orgId, parked.promise, async (tx) => {
      await tx`update memberships set role = 'owner' where org_id = ${owner.orgId} and user_id = ${finance.userId}`;
    });
    await gateHoldsLock();

    const removal = remove(admin.sessionToken, finance.userId);
    await requestsQueued(1);
    parked.resolve();
    await gate;

    const result = await removal;
    expect(result.status).toBe(403);
    expect((await membership(owner.orgId, finance.userId))).toMatchObject({ status: "ACTIVE", role: "owner" });
    expect((await auditTrail(owner.orgId)).filter((r) => r.action === "member.removed")).toHaveLength(0);
  });

  it("a caller demoted while the request waited cannot act on the role it had", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const admin = await createTestIdentity({ orgId: owner.orgId, role: "admin" });
    const finance = await createTestIdentity({ orgId: owner.orgId, role: "finance" });

    const parked = deferred();
    const gate = holdingOrganizationLock(owner.orgId, parked.promise, async (tx) => {
      await tx`update memberships set role = 'developer' where org_id = ${owner.orgId} and user_id = ${admin.userId}`;
    });
    await gateHoldsLock();

    const change = setRole(admin.sessionToken, finance.userId, "auditor");
    await requestsQueued(1);
    parked.resolve();
    await gate;

    const result = await change;
    expect(result.status).toBe(403);
    expect(String(result.body.error)).toContain("member.manage");
    expect((await membership(owner.orgId, finance.userId))?.role).toBe("finance");
    expect((await auditTrail(owner.orgId)).filter((r) => r.action === "member.role_changed")).toHaveLength(0);
  });

  it("a caller removed while the request waited cannot complete it", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const admin = await createTestIdentity({ orgId: owner.orgId, role: "admin" });
    const finance = await createTestIdentity({ orgId: owner.orgId, role: "finance" });

    const parked = deferred();
    const gate = holdingOrganizationLock(owner.orgId, parked.promise, async (tx) => {
      await tx`update memberships set status = 'REVOKED', revoked_at = now() where org_id = ${owner.orgId} and user_id = ${admin.userId}`;
    });
    await gateHoldsLock();

    const removal = remove(admin.sessionToken, finance.userId);
    await requestsQueued(1);
    parked.resolve();
    await gate;

    const result = await removal;
    expect(result.status).toBe(403);
    expect((await membership(owner.orgId, finance.userId))?.status).toBe("ACTIVE");
    expect((await auditTrail(owner.orgId)).filter((r) => r.action === "member.removed")).toHaveLength(0);
  });

  // ---- One target, several decisions ----------------------------------------------------------------

  it("two simultaneous removals of one member revoke once and record once", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const erin = await createTestIdentity({ orgId: owner.orgId, role: "finance" });

    const [a, b] = await Promise.all([remove(owner.sessionToken, erin.userId), remove(owner.sessionToken, erin.userId)]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect((await membership(owner.orgId, erin.userId))?.status).toBe("REVOKED");
    expect((await auditTrail(owner.orgId)).filter((r) => r.action === "member.removed")).toHaveLength(1);
    expect((await chainVerdict(owner.orgId)).ok).toBe(true);
  });

  it("a role change and a removal racing on one member leave the history of what actually committed", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const erin = await createTestIdentity({ orgId: owner.orgId, role: "developer" });

    const [change, removal] = await Promise.all([
      setRole(owner.sessionToken, erin.userId, "auditor"),
      remove(owner.sessionToken, erin.userId),
    ]);
    expect([change.status, removal.status]).toContain(200);

    const row = await membership(owner.orgId, erin.userId);
    const trail = await auditTrail(owner.orgId);
    const changes = trail.filter((r) => r.action === "member.role_changed");
    const removals = trail.filter((r) => r.action === "member.removed");

    expect(row?.status).toBe("REVOKED");
    expect(removals).toHaveLength(1);
    // No success entry for a transition that did not commit, and the removal names the role it revoked.
    expect(changes).toHaveLength(change.status === 200 ? 1 : 0);
    expect(removals[0]!.detail.role).toBe(change.status === 200 ? "auditor" : "developer");
    expect((await chainVerdict(owner.orgId)).ok).toBe(true);
  });

  // ---- Organizations do not wait for each other -----------------------------------------------------

  it("an organization's lock does not serialize another organization's administration", async () => {
    await reset();
    const a = await openDevelopmentSession();
    const memberA = await createTestIdentity({ orgId: a.orgId, role: "developer" });
    const b = await createTestIdentity({ role: "owner" });
    const memberB = await createTestIdentity({ orgId: b.orgId, role: "developer" });

    const parked = deferred();
    const gate = holdingOrganizationLock(a.orgId, parked.promise, async () => undefined);
    await gateHoldsLock();

    const parkedRemoval = remove(a.sessionToken, memberA.userId);
    await requestsQueued(1);

    // While A's request is queued behind A's lock, B's removal must go through untouched.
    const started = Date.now();
    const elsewhere = await remove(b.sessionToken, memberB.userId);
    expect(elsewhere.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3000);
    expect((await advisoryLocks()).waiting).toBeGreaterThanOrEqual(1);

    parked.resolve();
    await gate;
    expect((await parkedRemoval).status).toBe(200);
    expect((await membership(a.orgId, memberA.userId))?.status).toBe("REVOKED");
    expect((await membership(b.orgId, memberB.userId))?.status).toBe("REVOKED");
  });

  // ---- Invitations ----------------------------------------------------------------------------------

  it("two simultaneous invitations to one address leave exactly one live invitation", async () => {
    await reset();
    const owner = await openDevelopmentSession();

    const [a, b] = await Promise.all([
      invite(owner.sessionToken, "same@example.test", "developer"),
      invite(owner.sessionToken, "same@example.test", "auditor"),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);

    const live = await getDb().select().from(schema.organizationInvitations).where(and(
      eq(schema.organizationInvitations.orgId, owner.orgId),
      eq(schema.organizationInvitations.email, "same@example.test"),
      isNull(schema.organizationInvitations.acceptedAt),
      isNull(schema.organizationInvitations.revokedAt),
    ));
    expect(live).toHaveLength(1);
    expect([hashInvitationToken(a.body.token), hashInvitationToken(b.body.token)]).toContain(live[0]!.tokenHash);

    // Both decisions are in the chain, plus the withdrawal that superseded the first one.
    const actions = (await auditTrail(owner.orgId)).map((r) => r.action);
    expect(actions.filter((x) => x === "member.invited")).toHaveLength(2);
    expect(actions.filter((x) => x === "member.invitation_withdrawn")).toHaveLength(1);
    expect((await chainVerdict(owner.orgId)).ok).toBe(true);
  });

  it("two simultaneous withdrawals of one invitation withdraw once and record once", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const issued = await invite(owner.sessionToken, "gone@example.test", "developer");

    const [a, b] = await Promise.all([
      withdraw(owner.sessionToken, issued.body.invitation.id),
      withdraw(owner.sessionToken, issued.body.invitation.id),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const trail = await auditTrail(owner.orgId);
    expect(trail.filter((r) => r.action === "member.invitation_withdrawn")).toHaveLength(1);
    expect((await chainVerdict(owner.orgId)).ok).toBe(true);
  });

  it("two simultaneous acceptances of one invitation create one membership and one entry", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const issued = await invite(owner.sessionToken, "zoe@example.test", "finance");
    const zoe = await signUp("zoe@example.test");

    const [a, b] = await Promise.all([
      acceptInvitation(zoe.sessionToken, issued.body.token),
      acceptInvitation(zoe.sessionToken, issued.body.token),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);

    const rows = await getDb().select().from(schema.memberships).where(and(
      eq(schema.memberships.orgId, owner.orgId),
      eq(schema.memberships.userId, zoe.userId),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ACTIVE", role: "finance" });
    const trail = await auditTrail(owner.orgId);
    expect(trail.filter((r) => r.action === "member.invitation_accepted")).toHaveLength(1);
    expect((await chainVerdict(owner.orgId)).ok).toBe(true);
  });

  // ---- The chain under concurrent writers ------------------------------------------------------------

  it("concurrent administrative writes produce one unbroken chain", async () => {
    await reset();
    const owner = await openDevelopmentSession();
    const people = await Promise.all([0, 1, 2].map(() => createTestIdentity({ orgId: owner.orgId, role: "developer" })));

    const results = await Promise.all([
      setRole(owner.sessionToken, people[0]!.userId, "auditor"),
      setRole(owner.sessionToken, people[1]!.userId, "finance"),
      invite(owner.sessionToken, "one@example.test", "developer"),
      invite(owner.sessionToken, "two@example.test", "auditor"),
      remove(owner.sessionToken, people[2]!.userId),
    ]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    const trail = await auditTrail(owner.orgId);
    expect(trail).toHaveLength(5);
    expect(trail.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(trail[0]!.prevHash).toBe(genesisHash(owner.orgId, null));
    for (let i = 1; i < trail.length; i += 1) expect(trail[i]!.prevHash).toBe(trail[i - 1]!.hash);
    expect(verifyChain(owner.orgId, null, trail.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) as never)).toMatchObject({ ok: true, length: 5 });
  });
});

if (!enabled) {
  // Named, so a reader of the log cannot mistake this for a run.
  describe.skip("membership administration under concurrency — SKIPPED (set REAL_DATABASE_URL and DB_POOL_MAX>=2)", () => {
    it("is not being exercised in this run", () => undefined);
  });
}
