/**
 * Membership administration: who is in an organization, the one way in from outside it, and what may be changed
 * about someone who is already there.
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
 *   • **Administering an existing member is bounded on both sides.** A role may be granted only if the actor holds
 *     all of it, and changed or revoked only if they hold all of the role being taken away — so an admin can
 *     neither make nor demote an owner. Nobody changes their own row, the only owner is never demoted or removed,
 *     and a removal is a revocation that keeps the row (who, when) rather than a deletion.
 *   • **Nobody can do any of it quietly.** Every invitation, withdrawal, acceptance, role change and removal is a
 *     hash-chained audit entry for that organization, written in the same transaction as the change itself.
 *   • **Every decision is made again inside the transaction that executes it.** Membership writes take one
 *     organization-scoped PostgreSQL lock, and the caller and the addressed member are re-read under it. Two
 *     owners demoting each other cannot both count two owners; an admin whose own membership was revoked while
 *     their request waited cannot act on the role they held when it arrived; and a member promoted to owner
 *     mid-request cannot be demoted on the strength of the role they had then. A write that matches no row is a
 *     conflict, and a conflict writes no audit entry.
 *
 * Every one of those decisions appends an entry to the organization's audit chain (scope: the organization; actor:
 * `user`), inside the same transaction as the write it describes, so the trail cannot disagree with the roster. The
 * entry names who did what to whom; it never names the invitation token.
 *
 * No email is sent. The creator is given the one-time link and passes it on however they already talk to the
 * invitee, which is honest about what this milestone does and does not do (docs/MILESTONE_4_INVITATIONS.md).
 */
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { requireAuthenticatedUser } from "../auth/context";
import { getDb, type DB } from "../db";
import {
  MEMBERSHIP_ROLES, memberships, organizationInvitations, organizations, sessions, users,
  type MembershipRole,
} from "../db/schema";
import type { TenantScope } from "../db/tenant-context";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { audit } from "../services/audit";
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

function normalizeMemberId(id: unknown): string {
  if (typeof id !== "string" || id.trim() === "") throw new UserFacingError("Name the member.", 400);
  const v = id.trim();
  if (v.length > 80) throw new UserFacingError("That is not a member id.", 400);
  return v;
}

/** Either the pool or an open transaction: the membership decisions below only ever run inside one. */
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Domain separation for the organization membership lock, so its key cannot collide with another advisory lock
 * in this codebase (the audit chain uses `envelope-audit|…`).
 */
export const MEMBERSHIP_LOCK_DOMAIN = "organization-membership|";
export const membershipLockKey = (orgId: string): string => `${MEMBERSHIP_LOCK_DOMAIN}${orgId}`;

/**
 * Run a membership decision in a transaction that holds its organization's membership lock.
 *
 * Every operation that can change who is in an organization — or what they may do in it — takes this lock
 * first, so two requests for one organization are decided in turn, each against the state the previous one
 * committed. The lock is PostgreSQL's, transaction-scoped and keyed by the organization alone: another server
 * process, a serverless instance or a worker takes the same lock, which a process-local mutex would not, and
 * two organizations never wait for each other.
 *
 * It is held until the outer transaction commits or rolls back, and the audit entry is written inside it (its
 * own savepoint), so a trail can neither outlive a rolled-back change nor be appended for one.
 */
export async function inMembershipTransaction<T>(orgId: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${membershipLockKey(orgId)}, 0))`);
    return run(tx);
  });
}

/**
 * The caller, re-read inside the transaction. The request scope says who they were when the request arrived;
 * this says who they are at the moment the change would commit, and only this authorizes a write. A member who
 * was demoted, suspended or removed while their request waited is refused here rather than acting on an
 * authority they no longer hold.
 */
async function requireMemberManager(tx: Tx, scope: TenantScope): Promise<TenantScope> {
  const actor = await tx.query.memberships.findFirst({
    where: and(eq(memberships.orgId, scope.orgId), eq(memberships.userId, scope.userId)),
  });
  if (!actor || actor.status !== "ACTIVE") {
    throw new UserFacingError("Your membership of this organization is no longer active, so nothing was changed.", 403);
  }
  if (!permissionsFor(actor.role).has("member.manage")) {
    throw new UserFacingError(`The ${actor.role} role does not include member.manage, so nothing was changed.`, 403);
  }
  return { orgId: actor.orgId, userId: actor.userId, role: actor.role };
}

/** A role is a named permission set, so "may I grant it" is a set comparison, never a rank. */
function assertMayGrant(actorRole: MembershipRole, role: MembershipRole): void {
  const missing = [...permissionsFor(role)].filter((p) => !permissionsFor(actorRole).has(p));
  if (missing.length > 0) {
    throw new UserFacingError(`The ${actorRole} role cannot grant the ${role} role: it does not include ${missing.join(", ")}.`, 403);
  }
}

/**
 * Acting on someone who is already here carries the mirror rule: you may not take away an authority you do not
 * hold yourself. An admin can therefore not demote an owner, because the demotion would dispose of
 * `payout.recover.approve`, which makes recovery a second signature.
 */
function assertMayActOn(actorRole: MembershipRole, targetRole: MembershipRole): void {
  const missing = [...permissionsFor(targetRole)].filter((p) => !permissionsFor(actorRole).has(p));
  if (missing.length > 0) {
    throw new UserFacingError(`The ${actorRole} role cannot change a ${targetRole}, because it does not include ${missing.join(", ")}.`, 403);
  }
}

/**
 * An organization nobody can administer is a dead end, so the write that would cause one is refused.
 *
 * This must run inside the organization lock, in the same transaction as the write it guards: the count and the
 * update have to see the same state, or two requests can each count two owners and each remove one.
 */
async function assertNotOnlyOwner(tx: Tx, orgId: string, what: string): Promise<void> {
  const owners = await tx.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner"), eq(memberships.status, "ACTIVE")));
  if (owners.length <= 1) {
    throw new UserFacingError(`This is the organization's only owner, so it cannot be ${what}: nobody would be left who can administer it. Add another owner first.`, 409);
  }
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
  /** The caller's own user id, so the screen can leave their own row alone. */
  you: string;
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
    you: s.userId,
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

  // An admin holds everything an owner does except `payout.recover.approve`, which is what keeps that second
  // signature a second person; this check is what enforces it here, and it is repeated against the fresh role
  // inside the transaction, because the scope's role is only what the caller held when the request arrived.
  assertMayGrant(scope.role, role);

  let ttlHours = INVITATION_TTL_MS / 3_600_000;
  if (a.ttlHours !== undefined && a.ttlHours !== null) {
    const n = Number(a.ttlHours);
    if (!Number.isFinite(n)) throw new UserFacingError("The invitation lifetime must be a number of hours.", 400);
    ttlHours = Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, Math.floor(n)));
  }

  const db = getDb();
  const token = mintInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  const invitation = await inMembershipTransaction(scope.orgId, async (tx) => {
    const actor = await requireMemberManager(tx, scope);
    assertMayGrant(actor.role, role);

    const already = await tx.select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, scope.orgId), eq(users.email, email), eq(memberships.status, "ACTIVE")))
      .limit(1);
    if (already.length > 0) throw new UserFacingError("That address is already an active member of this organization.", 409);

    // One live invitation per address: a new one withdraws the old, so a forwarded link cannot outlive the
    // decision that replaced it. Under the organization lock that is true for two requests that arrive at the
    // same instant as well as for two that arrive a minute apart: they are applied in turn, so the later one
    // supersedes the earlier one instead of leaving both live.
    const superseded = await tx.update(organizationInvitations).set({ revokedAt: now })
      .where(and(
        eq(organizationInvitations.orgId, scope.orgId),
        eq(organizationInvitations.email, email),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
      ))
      .returning();
    const [row] = await tx.insert(organizationInvitations).values({
      id: newId("inv"), orgId: scope.orgId, email, role,
      tokenHash: hashInvitationToken(token), invitedBy: actor.userId, expiresAt, createdAt: now,
    }).returning();
    // Superseding an invitation is a decision too, so each one it withdrew is in the chain: otherwise the trail
    // would describe a live invitation the roster no longer shows.
    for (const old of superseded) {
      await audit(tx, {
        scopeId: scope.orgId, orgId: scope.orgId, actor: "user", action: "member.invitation_withdrawn",
        ref: old.id, outcome: "OK",
        detail: { email: old.email, role: old.role, invitedBy: old.invitedBy, withdrawnBy: actor.userId, supersededBy: row!.id },
      });
    }
    // The trail names who invited whom, at which role, and when it lapses. It never names the token: that exists
    // only in the response.
    await audit(tx, {
      scopeId: scope.orgId, orgId: scope.orgId, actor: "user", action: "member.invited", ref: row!.id, outcome: "OK",
      detail: { email, role, invitedBy: actor.userId, expiresAt: expiresAt.toISOString() },
    });
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
  return inMembershipTransaction(s.orgId, async (tx) => {
    const actor = await requireMemberManager(tx, s);
    // The conditional write is the decision: it matches only while the invitation is still pending, and it
    // returns the row it withdrew. A second withdrawal — a minute later or at the same instant — matches
    // nothing, writes nothing, and therefore adds nothing to the chain.
    const [revoked] = await tx.update(organizationInvitations).set({ revokedAt: new Date() })
      .where(and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.orgId, s.orgId),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
      ))
      .returning();
    if (!revoked) throw new UserFacingError("There is no pending invitation with that id.", 404);
    await audit(tx, {
      scopeId: s.orgId, orgId: s.orgId, actor: "user", action: "member.invitation_withdrawn", ref: revoked.id, outcome: "OK",
      detail: { email: revoked.email, role: revoked.role, invitedBy: revoked.invitedBy, withdrawnBy: actor.userId },
    });
    return { id: revoked.id, revoked: true as const };
  });
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
  // The organization lock is taken before the claim, so an administrator's removal cannot commit between the
  // acceptance and the membership write it restores.
  const outcome = await inMembershipTransaction(invitation.orgId, async (tx) => {
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
    let result: { role: MembershipRole; alreadyMember: boolean };
    if (!existing) {
      await tx.insert(memberships).values({
        id: newId("mem"), orgId: invitation.orgId, userId: user.userId, role: invitation.role, status: "ACTIVE",
        invitedBy: invitation.invitedBy, invitedAt: invitation.createdAt, acceptedAt: now,
      });
      result = { role: invitation.role, alreadyMember: false };
    } else if (existing.status === "ACTIVE") {
      // Already in: the invitation confirms what is already true and grants nothing further. Its role is not applied,
      // because accepting an invitation must never be a way to change a role.
      result = { role: existing.role, alreadyMember: true };
    } else {
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
      result = { role: invitation.role, alreadyMember: false };
    }
    await audit(tx, {
      scopeId: invitation.orgId, orgId: invitation.orgId, actor: "user", action: "member.invitation_accepted",
      ref: invitation.id, outcome: "OK",
      detail: { userId: user.userId, email, role: result.role, alreadyMember: result.alreadyMember, acceptedBy: user.userId },
    });
    return result;
  });

  // The person just joined this organization, so serve the rest of this session for it. It is a session-row write
  // after the membership exists, not a grant: `requestScope` still checks the membership on every request.
  await db.update(sessions).set({ activeOrgId: invitation.orgId }).where(eq(sessions.sessionToken, user.sessionId));
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, invitation.orgId) });
  return { orgId: invitation.orgId, orgName: org?.name ?? "", role: outcome.role, alreadyMember: outcome.alreadyMember };
}

/**
 * Change an existing member's role, in the session's organization.
 *
 * An invitation cannot do this — accepting one never changes a role — so this is the only write that can, and it
 * is bounded on both sides by the same set comparison the invitation uses:
 *
 *   • the role granted may not carry a permission the caller lacks, so an admin cannot make an owner;
 *   • the role being taken away may not carry one either, so an admin cannot demote an owner;
 *   • nobody changes their own role, so a demotion cannot be mistaken for a mistake and an escalation cannot be
 *     a single click;
 *   • the last owner cannot be demoted, because an organization with no owner cannot be administered at all.
 *
 * Nothing else about the row moves: `revoked_at`/`revoked_by` (if the membership was ever restored) stay as the
 * history, and the acceptance date stays the date they joined.
 */
export async function changeOrganizationMemberRole(a: {
  scope: TenantScope | null | undefined;
  userId: unknown;
  role: unknown;
}): Promise<{ member: { userId: string; email: string | null; role: MembershipRole }; changed: boolean }> {
  const scope = requireMemberPermission(a.scope, "member.manage");
  const userId = normalizeMemberId(a.userId);
  const role = normalizeRole(a.role);

  return inMembershipTransaction(scope.orgId, async (tx) => {
    const actor = await requireMemberManager(tx, scope);
    const target = await tx.query.memberships.findFirst({
      where: and(eq(memberships.orgId, scope.orgId), eq(memberships.userId, userId)),
    });
    if (!target || target.status !== "ACTIVE") throw new UserFacingError("There is no active member with that id.", 404);

    const person = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (target.role === role) return { member: { userId, email: person?.email ?? null, role }, changed: false };

    // Both sides of the comparison are the roles as they are now, under the lock: the caller's and the row's.
    // The role the request saw is not used, so a member promoted while it waited cannot be demoted on it.
    assertMayGrant(actor.role, role);
    assertMayActOn(actor.role, target.role);
    if (target.role === "owner") await assertNotOnlyOwner(tx, scope.orgId, "demoted");
    if (target.userId === actor.userId) {
      throw new UserFacingError("You cannot change your own role. Ask another owner.", 409);
    }

    // The update is conditional on the role that was authorized, and it returns the row it changed. If it
    // changed nothing there is nothing to report, so there is no success response and no audit entry.
    const [changed] = await tx.update(memberships).set({ role })
      .where(and(
        eq(memberships.id, target.id),
        eq(memberships.orgId, scope.orgId),
        eq(memberships.status, "ACTIVE"),
        eq(memberships.role, target.role),
      ))
      .returning();
    if (!changed) {
      throw new UserFacingError("This member changed while the request was in flight, so nothing was changed. Reload and try again.", 409);
    }
    await audit(tx, {
      scopeId: scope.orgId, orgId: scope.orgId, actor: "user", action: "member.role_changed", ref: userId, outcome: "OK",
      detail: { email: person?.email ?? null, from: target.role, to: changed.role, by: actor.userId },
    });
    return { member: { userId, email: person?.email ?? null, role: changed.role }, changed: true };
  });
}

/**
 * Remove a member: the row is revoked, never deleted, so what they were and when they left stay readable.
 *
 * The same two bounds apply as for a role change. A removal also stops any session currently pointed at this
 * organization from being served for it — `requestScope` re-checks the membership on every request anyway, so
 * this only turns the next page from a 403 into the fallback to another organization, if they have one.
 *
 * A pending invitation issued *before* the removal cannot undo it: acceptance requires an invitation created
 * after the revocation, exactly as it does for a membership revoked any other way.
 */
export async function removeOrganizationMember(scope: TenantScope | null | undefined, memberUserId: unknown): Promise<{
  member: { userId: string; email: string | null; role: MembershipRole; status: "REVOKED" };
  removed: true;
}> {
  const s = requireMemberPermission(scope, "member.manage");
  const userId = normalizeMemberId(memberUserId);

  return inMembershipTransaction(s.orgId, async (tx) => {
    const actor = await requireMemberManager(tx, s);
    const target = await tx.query.memberships.findFirst({
      where: and(eq(memberships.orgId, s.orgId), eq(memberships.userId, userId)),
    });
    if (!target || target.status !== "ACTIVE") throw new UserFacingError("There is no active member with that id.", 404);

    assertMayActOn(actor.role, target.role);
    if (target.role === "owner") await assertNotOnlyOwner(tx, s.orgId, "removed");
    if (target.userId === actor.userId) throw new UserFacingError("You cannot remove yourself. Ask another owner.", 409);

    const person = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    const now = new Date();
    // ACTIVE → REVOKED, once. The returned row is what was actually revoked: the chain entry, the response and
    // the session cleanup all follow from it, so a request that revoked nothing reports nothing.
    const [revoked] = await tx.update(memberships).set({ status: "REVOKED", revokedAt: now, revokedBy: actor.userId })
      .where(and(
        eq(memberships.id, target.id),
        eq(memberships.orgId, s.orgId),
        eq(memberships.status, "ACTIVE"),
      ))
      .returning();
    if (!revoked) {
      throw new UserFacingError("This member changed while the request was in flight, so nothing was changed. Reload and try again.", 409);
    }
    await tx.update(sessions).set({ activeOrgId: null })
      .where(and(eq(sessions.userId, userId), eq(sessions.activeOrgId, s.orgId)));
    await audit(tx, {
      scopeId: s.orgId, orgId: s.orgId, actor: "user", action: "member.removed", ref: userId, outcome: "OK",
      detail: { email: person?.email ?? null, role: revoked.role, by: actor.userId },
    });
    return { member: { userId, email: person?.email ?? null, role: revoked.role, status: "REVOKED" as const }, removed: true as const };
  });
}
