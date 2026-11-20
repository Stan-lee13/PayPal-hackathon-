/**
 * Deterministic identities for tests — and only for tests.
 *
 * Real sign-in goes through OIDC. A test that needs "a member of organization A with the finance role" should
 * not have to run an identity provider, so this module writes the rows an OIDC callback would have written:
 * a user keyed by (issuer, subject), an organization, an active membership, and a server-side session.
 *
 * It refuses to run when `NODE_ENV=production`, so this cannot become a production sign-in path. It is not an
 * authentication bypass either: everything downstream still validates the session row, the membership status and
 * the permission, exactly as it would for a real session.
 */
import { getDb } from "../db";
import { memberships, organizations, sessions, users, type MembershipRole, type OrganizationStatus } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";

export function testIdentityAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production";
}

export type TestIdentity = {
  userId: string;
  orgId: string;
  membershipId: string;
  role: MembershipRole;
  sessionToken: string;
  email: string;
  issuer: string;
  subject: string;
};

/**
 * Create (or reuse) one test identity. The session token is random and is returned so a test can present it as
 * the Auth.js cookie; no other code path may mint a session this way.
 */
export async function createTestIdentity(a: {
  orgId?: string;
  orgName?: string;
  orgStatus?: OrganizationStatus;
  role?: MembershipRole;
  email?: string;
  issuer?: string;
  subject?: string;
  userId?: string;
  /** Defaults to 8 hours from now; a test may pass a past date to prove expiry is enforced. */
  expiresAt?: Date;
  membershipStatus?: "ACTIVE" | "INVITED" | "REVOKED";
} = {}): Promise<TestIdentity> {
  if (!testIdentityAllowed()) throw new UserFacingError("Test identities are not available in production.", 404);
  const db = getDb();
  const orgId = a.orgId ?? newId("org");
  const issuer = a.issuer ?? "https://idp.test.invalid";
  const subject = a.subject ?? newId("sub");
  const email = a.email ?? `${subject}@example.test`;
  const userId = a.userId ?? newId("usr");

  await db.insert(organizations).values({
    id: orgId, name: a.orgName ?? "Test organization", status: a.orgStatus ?? "ACTIVE", metadata: { test: true },
  }).onConflictDoNothing();

  await db.insert(users).values({
    id: userId, oidcIssuer: issuer, oidcSubject: subject, email: email.toLowerCase(), emailVerified: true, displayName: "Test user",
  }).onConflictDoNothing();
  const user = (await db.query.users.findFirst({ where: (u, { and, eq }) => and(eq(u.oidcIssuer, issuer), eq(u.oidcSubject, subject)) }))!;

  const membershipId = newId("mem");
  await db.insert(memberships).values({
    id: membershipId, orgId, userId: user.id, role: a.role ?? "owner",
    status: a.membershipStatus ?? "ACTIVE",
    acceptedAt: (a.membershipStatus ?? "ACTIVE") === "ACTIVE" ? new Date() : null,
    invitedAt: new Date(),
  }).onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: a.role ?? "owner", status: a.membershipStatus ?? "ACTIVE" } });

  const sessionToken = `test-session-${newId("tok")}`;
  const expires = a.expiresAt ?? new Date(Date.now() + 8 * 3600_000);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

  return { userId: user.id, orgId, membershipId, role: a.role ?? "owner", sessionToken, email, issuer, subject };
}
