/**
 * Membership administration: who is in an organization, and the one way in from outside it.
 *
 * `memberships` has always had an `INVITED` status and `organization_invitations` has always had a token hash,
 * an expiry and an acceptance. Neither had a path that wrote them, so an `INVITED` row could only be produced by
 * a test. This module is that path, and it is deliberately small:
 *
 *   • **Issuing** an invitation needs `member.manage` in the organization the session is served for, and the
 *     organization is the session's — never a body field. The inviter may grant a role only if they already hold
 *     every permission of it, so an `admin` cannot mint an `owner`, and no one can mint a permission they lack.
 *   • **The token** is the only secret. Thirty-two random bytes, shown once at creation and never stored: the row
 *     keeps a SHA-256 of it. Losing the link means issuing a new invitation, which withdraws the old one.
 *   • **Accepting** requires a server-validated session whose verified address is the address invited. The token
 *     proves control of the link; the session proves who is holding it; the address is what binds the two. An
 *     address is therefore a hint that picks the right person, never an identity on its own.
 *   • **Single use** is enforced by the database, not by a read-then-write in the application: the acceptance is
 *     a conditional `UPDATE` that only matches a pending, unexpired invitation, so two simultaneous clicks cannot
 *     both succeed and a used link cannot be replayed.
 *   • **Nothing is rewritten.** An existing `ACTIVE` membership is left exactly as it is (accepting an invitation
 *     never changes a role). A `REVOKED` membership is only restored by an invitation issued *after* the
 *     revocation: an invitation that predates it cannot quietly undo someone's decision.
 *
 * No email is sent. The creator is given the one-time link and passes it on however they already talk to the
 * invitee, which is honest about what this milestone does and does not do (docs/MILESTONE_4_INVITATIONS.md).
 */
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { requireAuthenticatedUser } from "../auth/context";
import { getDb } from "../db";
import {
  MEMBERSHIP_ROLES, memberships, organizationInvitations, organizations, sessions, users,
  type MembershipRole,
} from "../db/schema";
import type { TenantScope } from "../db/tenant-context";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { sha256Hex } from "../sha256";
import { permissionsFor, type Permission } from "./permissions";

/** A week is long enough to be useful and short enough that a forwarded link is not a standing key. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 30 * 24;

/** Domain separation: an invitation token hash can never collide with a hash computed for another purpose. */
const TOKEN_DOMAIN = "envelope-invitation/1|";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashInvitationToken(raw: string): string {
  return sha256Hex(`${TOKEN_DOMAIN}${raw}`);
}

/** 256 bits, base64url, the same shape as every other opaque key in this codebase. */
function mintInvitationToken(): string {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(32))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Addresses are compared lower-cased: the invitation is to the mailbox, not to a spelling. */
export function normalizeInvitationEmail(email: unknown): string {
  if (typeof email !== "string" || email.trim() === "") throw new UserFacingError("Name the address to invite.", 400);
  const e = email.trim().toLowerCase();
  if (e.length > 320 || !EMAIL.test(e)) throw new UserFacingError("That is not an email address.", 400);
  return e;
}

function normalizeRole(role: unknown): MembershipRole {
  if (typeof role !== "string" || !(MEMBERSHIP_ROLES as readonly string[]).includes(role)) {
    throw new UserFacingError(`Choose one of: ${MEMBERSHIP_ROLES.join(", ")}.`, 400);
  }
  return role as MembershipRole;
}

/** The permission check, in the same shape as `requirePermission`, from a scope that carries only a role. */
function requireMemberPermission(scope: TenantScope | null | undefined, permission: Extract<Permission, "member.read" | "member.manage">): TenantScope {
  if (!scope) throw new UserFacingError("Sign in to continue.", 401);
  if (!permissionsFor(scope.role).has(permission)) {
    throw new UserFacingError(`The ${scope.role} role does not include ${permission}.`, 403);
  }
  return scope;
}

export type InvitationView = {
  id: string;
  email: string;
  role: MembershipRole;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
};

const invitationView = (r: typeof organizationInvitations.$inferSelect): InvitationView => ({
  id: r.id, email: r.email, role: r.role, invitedBy: r.invitedBy,
  expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(),
});

/**
 * The member screen's read: who is in this organization now, and which invitations are still outstanding.
 * `member.read` — an auditor may see the roster; only `member.manage` may change it, and `canManage` says which.
 */
export async function organizationMembers(scope: TenantScope | null | undefined): Promise<{
  organization: { id: string; name: string };
  members: { userId: string; email: string | null; displayName: string; role: MembershipRole; acceptedAt: string | null; since: string }[];
  invitations: InvitationView[];
  canManage: boolean;
}> {
  const s = requireMemberPermission(scope, "member.read");
  const db = getDb();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, s.orgId) });
  const rows = await db.select({
    userId: memberships.userId, email: users.email, displayName: users.displayName, role: memberships.role,
    acceptedAt: memberships.acceptedAt, createdAt: memberships.createdAt,
  })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.orgId, s.orgId), eq(memberships.status, "ACTIVE")))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
  const pending = await db.select().from(organizationInvitations)
    .where(and(
      eq(organizationInvitations.orgId, s.orgId),
      isNull(organizationInvitations.acceptedAt),
      isNull(organizationInvitations.revokedAt),
      gt(organizationInvitations.expiresAt, new Date()),
    ))
    .orderBy(desc(organizationInvitations.createdAt));
  return {
    organization: { id: s.orgId, name: org?.name ?? "" },
    members: rows.map((r) => ({
      userId: r.userId, email: r.email, displayName: r.displayName, role: r.role,
      acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null, since: r.createdAt.toISOString(),
    })),
    invitations: pending.map(invitationView),
    canManage: permissionsFor(s.role).has("member.manage"),
  };
}

/**
 * Issue an invitation for the session's organization. The raw token is returned here and nowhere else; the row
 * keeps only its hash, so this response is the only copy that will ever exist.
 */
export async function createOrganizationInvitation(a: {
  scope: TenantScope | null | undefined;
  email: unknown;
  role: unknown;
  ttlHours?: unknown;
}): Promise<{ invitation: InvitationView; token: string; acceptPath: string; organization: { id: string; name: string } }> {
  const scope = requireMemberPermission(a.scope, "member.manage");
  const email = normalizeInvitationEmail(a.email);
  const role = normalizeRole(a.role);

  // A role is a named set of permissions, so "may I grant it" is a set comparison, not a rank. An admin holds
  // everything an owner does except `payout.recover.approve`, which is what keeps that second signature a second
  // person; this check is what enforces it here.
  const missing = [...permissionsFor(role)].filter((p) => !permissionsFor(scope.role).has(p));
  if (missing.length > 0) {
    throw new UserFacingError(`The ${scope.role} role cannot grant the ${role} role: it does not include ${missing.join(", ")}.`, 403);
  }

  let ttlHours = INVITATION_TTL_MS / 3_600_000;
  if (a.ttlHours !== undefined && a.ttlHours !== null) {
    const n = Number(a.ttlHours);
    if (!Number.isFinite(n)) throw new UserFacingError("The invitation lifetime must be a number of hours.", 400);
    ttlHours = Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, Math.floor(n)));
  }

  const db = getDb();
  const already = await db.select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.orgId, scope.orgId), eq(users.email, email), eq(memberships.status, "ACTIVE")))
    .limit(1);
  if (already.length > 0) throw new UserFacingError("That address is already an active member of this organization.", 409);

  const token = mintInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  const invitation = await db.transaction(async (tx) => {
    // One live invitation per address: a new one withdraws the old, so a forwarded link cannot outlive the
    // decision that replaced it.
    await tx.update(organizationInvitations).set({ revokedAt: now })
      .where(and(
        eq(organizationInvitations.orgId, scope.orgId),
        eq(organizationInvitations.email, email),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
      ));
    const [row] = await tx.insert(organizationInvitations).values({
      id: newId("inv"), orgId: scope.orgId, email, role,
      tokenHash: hashInvitationToken(token), invitedBy: scope.userId, expiresAt, createdAt: now,
    }).returning();
    return row!;
  });
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, scope.orgId) });
  return {
    invitation: invitationView(invitation),
    token,
    acceptPath: `/invitations/${token}`,
    organization: { id: scope.orgId, name: org?.name ?? "" },
  };
}

/** Withdraw a pending invitation. An accepted or already withdrawn one is not found, and stays as it is. */
export async function revokeOrganizationInvitation(scope: TenantScope | null | undefined, invitationId: string | null | undefined): Promise<{ id: string; revoked: true }> {
  const s = requireMemberPermission(scope, "member.manage");
  if (!invitationId) throw new UserFacingError("Name the invitation to withdraw.", 400);
  const db = getDb();
  const row = await db.query.organizationInvitations.findFirst({
    where: and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.orgId, s.orgId)),
  });
  if (!row || row.acceptedAt || row.revokedAt) throw new UserFacingError("There is no pending invitation with that id.", 404);
  await db.update(organizationInvitations).set({ revokedAt: new Date() })
    .where(and(eq(organizationInvitations.id, row.id), isNull(organizationInvitations.acceptedAt), isNull(organizationInvitations.revokedAt)));
  return { id: row.id, revoked: true };
}

/**
 * Accept an invitation as the signed-in person.
 *
 * A session is required and is validated on the server, but a *membership* is not: the whole point is that this
 * person has none yet in the inviting organization. That is why this is reached through its own route rather than
 * through `requestScope`, which answers 403 when someone is signed in but belongs nowhere.
 */
export async function acceptOrganizationInvitation(a: { sessionToken: string | null | undefined; token: unknown }): Promise<{
  orgId: string; orgName: string; role: MembershipRole; alreadyMember: boolean;
}> {
  const user = await requireAuthenticatedUser(a.sessionToken);
  if (typeof a.token !== "string" || !TOKEN.test(a.token.trim())) {
    throw new UserFacingError("This invitation link is not complete.", 400);
  }
  const db = getDb();
  const invitation = await db.query.organizationInvitations.findFirst({
    where: eq(organizationInvitations.tokenHash, hashInvitationToken(a.token.trim())),
  });
  // An unknown link, and one that was withdrawn or has expired, get the same answer here: nothing about an
  // organization is disclosed by the difference, and the row is only read after the token matched.
  if (!invitation) throw new UserFacingError("This invitation is not valid.", 404);

  const email = user.email?.trim().toLowerCase() ?? null;
  if (!email || !user.emailVerified) {
    throw new UserFacingError("Verify this account's email address before accepting an invitation.", 403);
  }
  if (email !== invitation.email) {
    throw new UserFacingError("This invitation was sent to a different address. Sign in with the address it was sent to.", 403);
  }

  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    // The claim is the single-use rule. It matches only while the invitation is pending and unexpired, and it is
    // one statement, so two concurrent acceptances cannot both see "pending" and both proceed.
    const claimed = await tx.update(organizationInvitations)
      .set({ acceptedAt: now, acceptedBy: user.userId })
      .where(and(
        eq(organizationInvitations.id, invitation.id),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
        gt(organizationInvitations.expiresAt, now),
      ))
      .returning();
    if (claimed.length === 0) {
      throw new UserFacingError("This invitation has expired, was withdrawn, or has already been used.", 404);
    }

    const existing = await tx.query.memberships.findFirst({
      where: and(eq(memberships.orgId, invitation.orgId), eq(memberships.userId, user.userId)),
    });
    if (!existing) {
      await tx.insert(memberships).values({
        id: newId("mem"), orgId: invitation.orgId, userId: user.userId, role: invitation.role, status: "ACTIVE",
        invitedBy: invitation.invitedBy, invitedAt: invitation.createdAt, acceptedAt: now,
      });
      return { role: invitation.role, alreadyMember: false };
    }
    // Already in: the invitation confirms what is already true and grants nothing further. Its role is not applied,
    // because accepting an invitation must never be a way to change a role.
    if (existing.status === "ACTIVE") return { role: existing.role, alreadyMember: true };
    if (existing.status === "REVOKED") {
      // A revocation was somebody's decision, dated. Only an invitation issued after it is a later decision that
      // can reverse it; one that predates it must not quietly undo it.
      if (!existing.revokedAt || invitation.createdAt.getTime() <= existing.revokedAt.getTime()) {
        throw new UserFacingError("Your membership of this organization was revoked after this invitation was sent. Ask an owner to invite you again.", 409);
      }
    }
    await tx.update(memberships)
      .set({ status: "ACTIVE", role: invitation.role, acceptedAt: now, invitedBy: invitation.invitedBy, invitedAt: invitation.createdAt })
      .where(eq(memberships.id, existing.id));
    return { role: invitation.role, alreadyMember: false };
  });

  // The person just joined this organization, so serve the rest of this session for it. It is a session-row write
  // after the membership exists, not a grant: `requestScope` still checks the membership on every request.
  await db.update(sessions).set({ activeOrgId: invitation.orgId }).where(eq(sessions.sessionToken, user.sessionId));
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, invitation.orgId) });
  return { orgId: invitation.orgId, orgName: org?.name ?? "", role: outcome.role, alreadyMember: outcome.alreadyMember };
}
