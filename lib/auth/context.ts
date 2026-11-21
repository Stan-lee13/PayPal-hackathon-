/**
 * The authenticated organization context.
 *
 * One place resolves, in this order: the session, the stable user, the membership, the organization, the
 * permission, and finally the ownership of the target record. Handlers ask these functions instead of each
 * inventing their own check, so a route cannot be authorized by a mistake in one file.
 *
 * What is never authorization: an `orgId` in a body, `X-Org-Id`, an email, `PayoutDoubtEvidence.by`, a provider
 * webhook field, or a principal key treated as a human identity. A client may *select* an organization from its
 * memberships; the membership row is what allows it.
 *
 * Statuses: 401 for no or invalid session, 403 for an authenticated identity without the membership or the
 * permission, 404 for a record that belongs to another organization (so ids cannot be probed for existence).
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, organizations, principals, sessions, users, type MembershipRole, type OrganizationStatus, type UserStatus } from "../db/schema";
import type { TenantScope } from "../db/tenant-context";
import { UserFacingError } from "../errors";
import { isMoneyPermission, isPermission, permissionsFor, type Permission } from "../identity/permissions";

export const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

export type AuthenticatedUser = {
  userId: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  status: UserStatus;
};

export type AuthenticatedOrgContext = {
  userId: string;
  orgId: string;
  orgName: string;
  orgStatus: OrganizationStatus;
  role: MembershipRole;
  permissions: ReadonlySet<Permission>;
  membershipId: string;
  sessionId: string;
};

/** The session token from a cookie header, or null. The name is Auth.js's; the value is opaque. */
export function sessionTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eqAt = part.indexOf("=");
    if (eqAt < 0) continue;
    const name = part.slice(0, eqAt).trim();
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(name)) {
      const value = part.slice(eqAt + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export const sessionTokenFromRequest = (req: Request): string | null => sessionTokenFromCookieHeader(req.headers.get("cookie"));

/**
 * Validate the session on the server. The cookie is a lookup key, not a claim: the row's expiry and the user's
 * status decide whether it is still valid, so a revoked or expired session stops working immediately.
 */
export async function requireAuthenticatedUser(sessionToken: string | null | undefined): Promise<AuthenticatedUser & { sessionId: string }> {
  if (!sessionToken) throw new UserFacingError("Sign in to continue.", 401);
  const db = getDb();
  const s = await db.query.sessions.findFirst({ where: eq(sessions.sessionToken, sessionToken) });
  if (!s || s.expires.getTime() <= Date.now()) {
    throw new UserFacingError("Your session has expired or is not valid. Sign in again.", 401);
  }
  const u = await db.query.users.findFirst({ where: eq(users.id, s.userId) });
  if (!u || u.status !== "ACTIVE") {
    throw new UserFacingError("This account is not active. Sign in again, or ask an organization owner.", 401);
  }
  return {
    userId: u.id, issuer: u.oidcIssuer, subject: u.oidcSubject, email: u.email,
    emailVerified: u.emailVerified, displayName: u.displayName, status: u.status, sessionId: s.sessionToken,
  };
}

/**
 * The organization a request is served for, when the request carries a valid session.
 *
 * No cookie means no scope: the signed-agent and operator paths never present one, and they keep working. A
 * cookie that is expired, revoked, or belongs to a deactivated user is a 401 rather than a silent anonymous
 * request, so a revoked session is visible to the person holding it. A signed-in user with no active membership
 * is a 403: there is no organization to serve them for.
 *
 * A user may belong to more than one organization. Until the console can select one, the oldest active
 * membership is used deterministically; the selection is a membership check either way, never a request field.
 */
export type RequestScope = TenantScope & { permissions: ReadonlySet<Permission> };

export async function requestScope(req: Request): Promise<RequestScope | null> {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  const user = await requireAuthenticatedUser(token);
  const [m] = await getDb().select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, user.userId), eq(memberships.status, "ACTIVE")))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1);
  if (!m) throw new UserFacingError("You are signed in, but not an active member of an organization, so there is nothing to authorize.", 403);
  return { orgId: m.orgId, userId: user.userId, role: m.role, permissions: permissionsFor(m.role) };
}

/**
 * Resolve an active membership. `INVITED` and `REVOKED` rows are not memberships for authorization, and a
 * suspended organization is returned with its status so the money check can refuse it.
 */
export async function requireOrganizationMembership(userId: string, orgId: string): Promise<{
  membershipId: string; orgId: string; orgName: string; orgStatus: OrganizationStatus; role: MembershipRole;
}> {
  const db = getDb();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  // Do not disclose whether the organization exists to someone who is not in it.
  if (!org) throw new UserFacingError("You are not a member of that organization.", 403);
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)) });
  if (!m || m.status !== "ACTIVE") throw new UserFacingError("You are not an active member of that organization.", 403);
  return { membershipId: m.id, orgId: org.id, orgName: org.name, orgStatus: org.status, role: m.role };
}

/**
 * Check one permission. A permission the caller's role does not have is 403; a money permission in a suspended
 * organization is 403 even for the owner.
 */
export function requirePermission(ctx: Pick<AuthenticatedOrgContext, "role" | "permissions" | "orgStatus" | "orgId">, permission: Permission): void {
  if (!isPermission(permission)) throw new UserFacingError(`Unknown permission ${String(permission)}.`, 403);
  if (!ctx.permissions.has(permission)) {
    throw new UserFacingError(`The ${ctx.role} role does not include ${permission}.`, 403);
  }
  if (isMoneyPermission(permission) && ctx.orgStatus !== "ACTIVE") {
    throw new UserFacingError(`This organization is ${ctx.orgStatus.toLowerCase()}: it cannot start or change money movement.`, 403);
  }
}

/** A record in another organization is reported as missing, not as forbidden. */
export function requireOwnedResource(ctx: Pick<AuthenticatedOrgContext, "orgId">, resource: { orgId: string | null | undefined }): void {
  if (!resource.orgId || resource.orgId !== ctx.orgId) throw new UserFacingError("Not found.", 404);
}

/**
 * The whole check, in the documented order. `permission` is optional for a route that only needs "an
 * authenticated member of this organization".
 */
export async function requireOrgContext(a: { sessionToken: string | null | undefined; orgId: string; permission?: Permission }): Promise<AuthenticatedOrgContext> {
  const user = await requireAuthenticatedUser(a.sessionToken);
  const m = await requireOrganizationMembership(user.userId, a.orgId);
  const ctx: AuthenticatedOrgContext = {
    userId: user.userId, orgId: m.orgId, orgName: m.orgName, orgStatus: m.orgStatus,
    role: m.role, permissions: permissionsFor(m.role), membershipId: m.membershipId, sessionId: user.sessionId,
  };
  if (a.permission) requirePermission(ctx, a.permission);
  return ctx;
}

/**
 * The organization a financial principal belongs to, or null. This is the bridge for signed-agent requests:
 * the agent keeps its signature, and the server resolves the organization from the root principal's durable
 * mapping — never from a request field.
 */
export async function organizationForPrincipal(publicKey: string): Promise<{ orgId: string; principalId: string; status: string } | null> {
  const row = await getDb().query.principals.findFirst({ where: eq(principals.publicKey, publicKey) });
  return row ? { orgId: row.orgId, principalId: row.id, status: row.status } : null;
}

/** Fail closed when a principal is unknown or has been revoked. */
export async function requirePrincipalOrganization(publicKey: string): Promise<{ orgId: string; principalId: string }> {
  const found = await organizationForPrincipal(publicKey);
  if (!found || found.status !== "ACTIVE") {
    throw new UserFacingError("This financial principal is not mapped to an active organization, so nothing can be authorized for it.", 403);
  }
  return { orgId: found.orgId, principalId: found.principalId };
}

/**
 * A principal may not silently move between organizations, and an unknown principal is not accepted for a
 * known organization. Used where a signed record names both.
 */
export async function requirePrincipalInOrganization(publicKey: string, orgId: string): Promise<void> {
  const found = await requirePrincipalOrganization(publicKey);
  if (found.orgId !== orgId) throw new UserFacingError("This principal belongs to a different organization.", 403);
}
