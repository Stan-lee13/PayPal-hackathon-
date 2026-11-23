/**
 * Milestone 4.6 — the way into an organization from outside it.
 *
 * `INVITED` has been a membership status and `organization_invitations` has had a token hash since Milestone 4.1,
 * but nothing wrote either. These tests hold the new path to the rules the rest of the tenancy work follows:
 *
 *   • the organization comes from the session, never from the request, and a person sees only their own roster;
 *   • the raw token exists once, in the response, and only a hash is stored;
 *   • the invitation is single use, expiring and withdrawable, and a use is claimed by one conditional write;
 *   • only the invited address may accept, and a wrong address does not consume the invitation;
 *   • the role granted may not carry a permission the inviter lacks (an admin cannot mint an owner);
 *   • an invitation that predates a revocation cannot undo it; one issued after it can;
 *   • accepting needs a session, a cross-origin POST is refused, and accepting never changes an existing role.
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("invitations (Milestone 4.6)", async () => {
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

  const invite = async (session: string | null, body: unknown): Promise<Reply> => {
    const res = await route("POST /api/organizations/invitations")(
      new Request("http://localhost:3000/api/organizations/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(session ? { cookie: cookie(session) } : {}) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  const withdraw = async (session: string, id: string): Promise<number> => {
    const res = await route("POST /api/organizations/invitations/:id/revoke")(
      new Request(`http://localhost:3000/api/organizations/invitations/${id}/revoke`, {
        method: "POST",
        headers: { cookie: cookie(session), "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id }) },
    );
    return res.status;
  };

  const roster = async (session: string | null): Promise<Reply> => {
    const res = await route("GET /api/organizations/members")(
      new Request("http://localhost:3000/api/organizations/members", { headers: session ? { cookie: cookie(session) } : {} }),
      { params: Promise.resolve({}) },
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  const acceptInvitation = async (session: string | null, token: unknown, origin?: string): Promise<Reply> => {
    const res = await accept.POST(
      new Request("http://localhost:3000/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json", ...(session ? { cookie: cookie(session) } : {}), ...(origin ? { origin } : {}) },
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

  it("issues a link once, stores only its hash, and shows the invitation to nobody else", async () => {
    await reset();
    const dev = await openDevelopmentSession();

    const issued = await invite(dev.sessionToken, { email: "Alice@Example.Test", role: "developer" });
    expect(issued.status).toBe(201);
    expect(typeof issued.body.token).toBe("string");
    expect(issued.body.token).toHaveLength(43);
    expect(issued.body.acceptPath).toBe(`/invitations/${issued.body.token}`);
    expect(issued.body.invitation.email).toBe("alice@example.test");

    const row = await getDb().query.organizationInvitations.findFirst({
      where: eq(schema.organizationInvitations.id, issued.body.invitation.id),
    });
    expect(row?.tokenHash).toHaveLength(64);
    expect(row?.tokenHash).not.toContain(issued.body.token);
    expect(JSON.stringify(row)).not.toContain(issued.body.token);

    // The inviter sees it, and `canManage` says they may act on it.
    const mine = await roster(dev.sessionToken);
    expect(mine.status).toBe(200);
    expect(mine.body.invitations.map((i: { email: string }) => i.email)).toEqual(["alice@example.test"]);
    expect(mine.body.canManage).toBe(true);

    // An owner of a different organization sees neither the roster nor the invitation.
    const elsewhere = await createTestIdentity({ role: "owner" });
    const theirs = await roster(elsewhere.sessionToken);
    expect(theirs.body.invitations).toEqual([]);
    expect(theirs.body.organization.id).toBe(elsewhere.orgId);
  });

  it("lets the invited person in, exactly once", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const issued = await invite(dev.sessionToken, { email: "bob@example.test", role: "finance" });
    expect(issued.status).toBe(201);

    const bob = await signUp("bob@example.test");
    const accepted = await acceptInvitation(bob.sessionToken, issued.body.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ orgId: dev.orgId, role: "finance", alreadyMember: false });

    const row = await membership(dev.orgId, bob.userId);
    expect(row?.status).toBe("ACTIVE");
    expect(row?.role).toBe("finance");
    expect(row?.acceptedAt).toBeInstanceOf(Date);

    // The session is served for the organization it just joined, so the next page shows its records.
    const session = await getDb().query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, bob.sessionToken) });
    expect(session?.activeOrgId).toBe(dev.orgId);

    // Single use: the same link again is refused, and it did not add a second membership.
    const replay = await acceptInvitation(bob.sessionToken, issued.body.token);
    expect(replay.status).toBe(404);
    const all = await getDb().select().from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, dev.orgId), eq(schema.memberships.userId, bob.userId)));
    expect(all).toHaveLength(1);
  });

  it("refuses an expired invitation and a withdrawn one", async () => {
    await reset();
    const dev = await openDevelopmentSession();

    const expiring = await invite(dev.sessionToken, { email: "late@example.test", role: "developer" });
    await getDb().update(schema.organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.organizationInvitations.id, expiring.body.invitation.id));
    const late = await signUp("late@example.test");
    expect((await acceptInvitation(late.sessionToken, expiring.body.token)).status).toBe(404);

    const withdrawn = await invite(dev.sessionToken, { email: "gone@example.test", role: "developer" });
    expect(await withdraw(dev.sessionToken, withdrawn.body.invitation.id)).toBe(200);
    // Withdrawing twice is a 404: an accepted or already withdrawn invitation is not pending.
    expect(await withdraw(dev.sessionToken, withdrawn.body.invitation.id)).toBe(404);

    const gone = await signUp("gone@example.test");
    expect((await acceptInvitation(gone.sessionToken, withdrawn.body.token)).status).toBe(404);
    expect(await membership(dev.orgId, gone.userId)).toBeUndefined();

    // A withdrawn invitation is not in the outstanding list either.
    const mine = await roster(dev.sessionToken);
    expect(mine.body.invitations).toEqual([]);
  });

  it("refuses a different address, and a wrong attempt does not use the invitation up", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const issued = await invite(dev.sessionToken, { email: "carol@example.test", role: "auditor" });

    const dan = await signUp("dan@example.test");
    const wrong = await acceptInvitation(dan.sessionToken, issued.body.token);
    expect(wrong.status).toBe(403);

    const stillPending = await getDb().query.organizationInvitations.findFirst({
      where: eq(schema.organizationInvitations.id, issued.body.invitation.id),
    });
    expect(stillPending?.acceptedAt).toBeNull();

    const carol = await signUp("carol@example.test");
    expect((await acceptInvitation(carol.sessionToken, issued.body.token)).status).toBe(200);
    expect((await membership(dev.orgId, carol.userId))?.role).toBe("auditor");
  });

  it("needs member.manage to invite, and cannot grant a permission the inviter lacks", async () => {
    await reset();
    const dev = await openDevelopmentSession();

    // A developer holds no membership permission at all: neither the roster nor an invitation.
    const developer = await createTestIdentity({ orgId: dev.orgId, role: "developer" });
    expect((await roster(developer.sessionToken)).status).toBe(403);
    const byDeveloper = await invite(developer.sessionToken, { email: "x@example.test", role: "developer" });
    expect(byDeveloper.status).toBe(403);

    // An auditor may read the roster (member.read) but not change it.
    const auditor = await createTestIdentity({ orgId: dev.orgId, role: "auditor" });
    const seen = await roster(auditor.sessionToken);
    expect(seen.status).toBe(200);
    expect(seen.body.canManage).toBe(false);
    expect((await invite(auditor.sessionToken, { email: "y@example.test", role: "developer" })).status).toBe(403);

    // An admin holds member.manage, but not payout.recover.approve: an owner is therefore not theirs to mint.
    const admin = await createTestIdentity({ orgId: dev.orgId, role: "admin" });
    const asOwner = await invite(admin.sessionToken, { email: "z@example.test", role: "owner" });
    expect(asOwner.status).toBe(403);
    expect(String(asOwner.body.error)).toContain("payout.recover.approve");
    // The same inviter may grant a role whose permissions they do hold.
    expect((await invite(admin.sessionToken, { email: "z@example.test", role: "admin" })).status).toBe(201);
    // The owner may grant ownership, because they hold everything it carries.
    expect((await invite(dev.sessionToken, { email: "z@example.test", role: "owner" })).status).toBe(201);
  });

  it("only an invitation issued after a revocation can restore the membership", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const eve = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "eve@example.test" });

    const revokedAt = new Date(Date.now() - 60_000);
    await getDb().update(schema.memberships)
      .set({ status: "REVOKED", revokedAt, revokedBy: dev.userId })
      .where(eq(schema.memberships.id, eve.membershipId));

    // An invitation that was in flight when the revocation happened: created before it, and not yet used.
    const before = await invite(dev.sessionToken, { email: "eve@example.test", role: "finance" });
    expect(before.status).toBe(201);
    await getDb().update(schema.organizationInvitations)
      .set({ createdAt: new Date(revokedAt.getTime() - 60_000) })
      .where(eq(schema.organizationInvitations.id, before.body.invitation.id));

    // Issued before the revocation: it cannot undo that decision.
    const stale = await acceptInvitation(eve.sessionToken, before.body.token);
    expect(stale.status).toBe(409);
    expect((await membership(dev.orgId, eve.userId))?.status).toBe("REVOKED");

    // Issued afterwards: a later decision by an owner, so the membership comes back — with its history intact.
    const after = await invite(dev.sessionToken, { email: "eve@example.test", role: "finance" });
    expect(after.status).toBe(201);
    expect((await acceptInvitation(eve.sessionToken, after.body.token)).status).toBe(200);
    const restored = await membership(dev.orgId, eve.userId);
    expect(restored?.status).toBe("ACTIVE");
    expect(restored?.role).toBe("finance");
    expect(restored?.revokedAt).toBeInstanceOf(Date);
  });

  it("does not change the role of someone who is already a member", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const issued = await invite(dev.sessionToken, { email: "frank@example.test", role: "owner" });
    expect(issued.status).toBe(201);
    // Frank joins through another route first, as an auditor.
    const frank = await createTestIdentity({ orgId: dev.orgId, role: "auditor", email: "frank@example.test" });

    const accepted = await acceptInvitation(frank.sessionToken, issued.body.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ alreadyMember: true, role: "auditor" });
    expect((await membership(dev.orgId, frank.userId))?.role).toBe("auditor");
  });

  it("needs a session, and refuses a cross-origin POST", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const issued = await invite(dev.sessionToken, { email: "gina@example.test", role: "developer" });

    expect((await acceptInvitation(null, issued.body.token)).status).toBe(401);
    expect((await acceptInvitation(dev.sessionToken, issued.body.token, "https://elsewhere.test")).status).toBe(403);
    // Neither attempt consumed it.
    const row = await getDb().query.organizationInvitations.findFirst({
      where: eq(schema.organizationInvitations.id, issued.body.invitation.id),
    });
    expect(row?.acceptedAt).toBeNull();

    const gina = await signUp("gina@example.test");
    expect((await acceptInvitation(gina.sessionToken, issued.body.token)).status).toBe(200);
  });

  it("refuses an invitation over an address that is already an active member", async () => {
    await reset();
    const dev = await openDevelopmentSession();
    const member = await createTestIdentity({ orgId: dev.orgId, role: "developer", email: "hank@example.test" });
    expect(member.email).toBe("hank@example.test");
    const again = await invite(dev.sessionToken, { email: "hank@example.test", role: "developer" });
    expect(again.status).toBe(409);
    // And a new invitation withdraws the previous one for the same address, so a forwarded old link dies.
    const first = await invite(dev.sessionToken, { email: "ivy@example.test", role: "developer" });
    const second = await invite(dev.sessionToken, { email: "ivy@example.test", role: "auditor" });
    expect(second.status).toBe(201);
    const ivy = await signUp("ivy@example.test");
    expect((await acceptInvitation(ivy.sessionToken, first.body.token)).status).toBe(404);
    expect((await acceptInvitation(ivy.sessionToken, second.body.token)).status).toBe(200);
    expect((await membership(dev.orgId, ivy.userId))?.role).toBe("auditor");
  });
});
