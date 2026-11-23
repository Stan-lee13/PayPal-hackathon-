/**
 * Milestone 4.6b — administering a member who is already in the organization.
 *
 * An invitation deliberately cannot change a role, so until this existed a role change was a database operation.
 * These tests hold the new writes to the same rules the rest of the tenancy work follows:
 *
 *   • the organization comes from the session, never from the request;
 *   • a role may be granted only if the caller holds all of it, and changed or revoked only if they hold all of the
 *     role being taken away — so an admin can neither make nor demote an owner;
 *   • nobody changes or removes themselves, and the only owner cannot be demoted or removed;
 *   • removal is a revocation: the row stays, with who did it and when, and the session stops being served for
 *     that organization;
 *   • an invitation pending when the removal happened cannot undo it; a new one afterwards can.
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("member administration (Milestone 4.6b)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const { route } = await import("../lib/api/next");
  const { openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { createTestIdentity } = await import("../lib/auth/testing");
  const { newId } = await import("../lib/ids");
  const accept = await import("../app/api/invitations/accept/route");

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

  const setRole = (session: string | null, userId: string, role: unknown) =>
    call("POST", "POST /api/organizations/members/:userId/role", `/api/organizations/members/${userId}/role`, { userId }, session, { role });
  const remove = (session: string | null, userId: string) =>
    call("POST", "POST /api/organizations/members/:userId/remove", `/api/organizations/members/${userId}/remove`, { userId }, session);
  const roster = (session: string | null) => call("GET", "GET /api/organizations/members", "/api/organizations/members", {}, session);
  const invite = (session: string | null, email: string, role: string) =>
    call("POST", "POST /api/organizations/invitations", "/api/organizations/invitations", {}, session, { email, role });
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

  const membership = (orgId: string, userId: string) =>
    getDb().query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)) });

  it("changes a member's role without touching their history", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const dana = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "dana@example.test" });

    // A developer can reach nothing in the roster; an auditor may read it.
    expect((await roster(dana.sessionToken)).status).toBe(403);
    const changed = await setRole(dev.sessionToken, dana.userId, "auditor");
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ changed: true, member: { userId: dana.userId, role: "auditor" } });
    expect((await membership(dev.orgId, dana.userId))?.role).toBe("auditor");

    // The roster shows it, and the permissions are read from the role, not from the old one.
    const listed = await roster(dev.sessionToken);
    expect(listed.body.members.find((m: { userId: string }) => m.userId === dana.userId).role).toBe("auditor");
    expect((await roster(dana.sessionToken)).status).toBe(200);

    // Setting the role they already have changes nothing and is not an error.
    expect(await setRole(dev.sessionToken, dana.userId, "auditor")).toMatchObject({ status: 200, body: { changed: false } });

    // A member of another organization, or nobody at all, is a 404: it is not this organization's roster.
    const elsewhere = await createTestIdentity({ role: "developer" });
    expect((await setRole(dev.sessionToken, elsewhere.userId, "auditor")).status).toBe(404);
    expect((await setRole(dev.sessionToken, newId("usr"), "auditor")).status).toBe(404);
  });

  it("bounds both directions: nobody grants or removes an authority they do not hold", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const admin = await createTestIdentity({ orgId: dev.orgId, role: "admin" });
    const owner = await createTestIdentity({ orgId: dev.orgId, role: "owner" });
    const finance = await createTestIdentity({ orgId: dev.orgId, role: "finance" });

    // Upwards: an admin may not make an owner, named by the permission that stops it.
    const promote = await setRole(admin.sessionToken, finance.userId, "owner");
    expect(promote.status).toBe(403);
    expect(String(promote.body.error)).toContain("payout.recover.approve");
    // Downwards: the same permission means an admin may not demote an owner either.
    const demote = await setRole(admin.sessionToken, owner.userId, "developer");
    expect(demote.status).toBe(403);
    expect(String(demote.body.error)).toContain("payout.recover.approve");
    expect((await membership(dev.orgId, owner.userId))?.role).toBe("owner");
    // Nor remove them.
    expect((await remove(admin.sessionToken, owner.userId)).status).toBe(403);
    expect((await membership(dev.orgId, owner.userId))?.status).toBe("ACTIVE");

    // Sideways, where the sets do contain each other, is allowed.
    expect((await setRole(admin.sessionToken, finance.userId, "developer")).status).toBe(200);
    expect((await setRole(admin.sessionToken, owner.userId, "admin")).status).toBe(403);

    // A developer holds no member permission at all; an auditor reads but never writes.
    const developer = await createTestIdentity({ orgId: dev.orgId, role: "developer" });
    const auditor = await createTestIdentity({ orgId: dev.orgId, role: "auditor" });
    expect((await setRole(developer.sessionToken, finance.userId, "admin")).status).toBe(403);
    expect((await remove(developer.sessionToken, finance.userId)).status).toBe(403);
    expect((await roster(auditor.sessionToken)).body.canManage).toBe(false);
    expect((await setRole(auditor.sessionToken, finance.userId, "admin")).status).toBe(403);
    expect((await remove(auditor.sessionToken, finance.userId)).status).toBe(403);

    // No session at all.
    expect((await setRole(null, finance.userId, "admin")).status).toBe(401);
    expect((await remove(null, finance.userId)).status).toBe(401);
  });

  it("refuses to change or remove yourself, and never the only owner", async () => {
    await reset();
    const dev = await openDevelopmentSession();

    // The development identity is the organization's only owner: demoting or removing it is refused outright.
    const self = await setRole(dev.sessionToken, dev.userId, "admin");
    expect(self.status).toBe(409);
    expect(String(self.body.error)).toContain("only owner");
    expect(await remove(dev.sessionToken, dev.userId)).toMatchObject({ status: 409 });
    expect((await membership(dev.orgId, dev.userId))?.role).toBe("owner");

    // With a second owner present, a self-change is still the caller's own row: not a thing to do by accident.
    const second = await createTestIdentity({ orgId: dev.orgId, role: "owner" });
    expect((await setRole(second.sessionToken, second.userId, "admin")).status).toBe(409);
    expect(await remove(second.sessionToken, second.userId)).toMatchObject({ status: 409 });
    // But one owner may move the other, because there is still an owner left.
    expect((await setRole(dev.sessionToken, second.userId, "admin")).status).toBe(200);
    expect((await membership(dev.orgId, second.userId))?.role).toBe("admin");
  });

  it("removes a member by revoking the row, and stops serving their session for the organization", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const erin = await createTestIdentity({ orgId: dev.orgId, role: "finance", email: "erin@example.test" });
    await getDb().update(schema.sessions).set({ activeOrgId: dev.orgId }).where(eq(schema.sessions.sessionToken, erin.sessionToken));

    const removed = await remove(dev.sessionToken, erin.userId);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ removed: true, member: { userId: erin.userId, role: "finance", status: "REVOKED" } });

    // The row is history, not a deletion: role, who, and when all stay readable.
    const row = await membership(dev.orgId, erin.userId);
    expect(row?.status).toBe("REVOKED");
    expect(row?.role).toBe("finance");
    expect(row?.revokedBy).toBe(dev.userId);
    expect(row?.revokedAt).toBeInstanceOf(Date);

    // They are gone from the roster, their session is no longer pointed at the organization, and their next read is
    // refused because the membership is re-checked on every request.
    const listed = await roster(dev.sessionToken);
    expect(listed.body.members.map((m: { userId: string }) => m.userId)).not.toContain(erin.userId);
    const session = await getDb().query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, erin.sessionToken) });
    expect(session?.activeOrgId).toBeNull();
    expect((await roster(erin.sessionToken)).status).toBe(403);

    // Removing twice is a 404, not a second revocation.
    expect((await remove(dev.sessionToken, erin.userId)).status).toBe(404);
  });

  it("lets a removed member back only by accepting a new invitation, with the revocation kept", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const ivan = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "ivan@example.test" });

    // While they are here, the address cannot be invited over: it is already an active member.
    expect((await invite(dev.sessionToken, "ivan@example.test", "finance")).status).toBe(409);

    expect((await remove(dev.sessionToken, ivan.userId)).status).toBe(200);
    // A removed person is no longer an active member, so the address may be invited again — and the removal is a
    // decision, so the way back is a link they open themselves, not something done to them.
    const again = await invite(dev.sessionToken, "ivan@example.test", "finance");
    expect(again.status).toBe(201);

    const restored = await acceptInvitation(ivan.sessionToken, again.body.token);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ role: "finance", alreadyMember: false });
    const row = await membership(dev.orgId, ivan.userId);
    expect(row?.status).toBe("ACTIVE");
    expect(row?.role).toBe("finance");
    // The revocation is still on the row: coming back does not erase that they left, or who removed them.
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(row?.revokedBy).toBe(dev.userId);

    // The link they used is spent, as any invitation is.
    expect((await acceptInvitation(ivan.sessionToken, again.body.token)).status).toBe(404);
  });
});
