/**
 * The organization's own administrative audit chain, read back.
 *
 * Milestone 4.6 made every membership decision an entry in a hash chain whose scope is the organization. This is
 * the read side of that trail: the decisions in the order they were made, newest first, and the chain checked
 * against itself so a reader can see that no entry in the middle was edited, removed or reordered.
 *
 * Three properties matter, and each one is a test:
 *
 *   • **It is the session's organization, never a requested one.** There is no organization id in the request, so
 *     this cannot be pointed at another organization's trail; the rows are selected by the scope the server
 *     resolved from the session.
 *   • **It needs `audit.read`.** An auditor may read it; a developer holds no audit permission and is refused
 *     (403) rather than shown an empty page that would imply there is nothing to see.
 *   • **It is read-only.** Nothing here writes, and there is no route that appends to a chain: an entry exists
 *     only as the by-product of a membership change, written in the same transaction as the change.
 *
 * What this is not: the envelope chains. Those are per envelope (`scope_id` is the root) and are read with the
 * envelope they belong to. This reads `scope_id = organization` with `subject_id IS NULL`, which is exactly the
 * administration chain an invitation, role change or removal appends to.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog, organizations } from "../db/schema";
import type { TenantScope } from "../db/tenant-context";
import { UserFacingError } from "../errors";
import { verifyChain, type ChainEntry } from "../ledger/chain";
import { permissionsFor } from "./permissions";

/** One page of the trail. Long enough for a year of administration, short enough to read in one request. */
export const AUDIT_PAGE_SIZE = 100;

/** Above this the whole chain is not loaded just to check it; the answer then says it was not checked here. */
const MAX_VERIFIED_ENTRIES = 1000;

export type OrganizationAuditEntry = {
  id: number;
  seq: number;
  actor: string;
  action: string;
  outcome: string;
  ref: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
};

export type OrganizationAuditHistory = {
  organization: { id: string; name: string };
  /** Newest first. */
  entries: OrganizationAuditEntry[];
  /** How many decisions the organization's chain holds, so the page can say how much of it is shown. */
  total: number;
  showing: number;
  /**
   * The chain checked from its genesis. `verified: null` means it was too long to check in one read here — an
   * honest "not checked" rather than a green tick that was never computed.
   */
  chain: { verified: boolean | null; length: number; head: string | null; reason: string | null };
};

/** The permission check, in the same shape as `requirePermission`, from a scope that carries only a role. */
function requireAuditReader(scope: TenantScope | null | undefined): TenantScope {
  if (!scope) throw new UserFacingError("Sign in to continue.", 401);
  if (!permissionsFor(scope.role).has("audit.read")) {
    throw new UserFacingError(`The ${scope.role} role does not include audit.read.`, 403);
  }
  return scope;
}

const view = (r: typeof auditLog.$inferSelect): OrganizationAuditEntry => ({
  id: r.id, seq: r.seq, actor: r.actor, action: r.action, outcome: r.outcome, ref: r.ref,
  detail: r.detail, createdAt: r.createdAt.toISOString(), prevHash: r.prevHash, hash: r.hash,
});

/**
 * The organization's administrative trail, newest first, with the chain verified when it is small enough to read
 * whole. `audit.read` — this is the record of who changed what about whom, and it is never public.
 */
export async function organizationAuditHistory(scope: TenantScope | null | undefined): Promise<OrganizationAuditHistory> {
  const s = requireAuditReader(scope);
  const db = getDb();
  // The organization's own chain, and nothing else: an envelope's entries have that envelope as their scope.
  const chainOf = and(eq(auditLog.scopeId, s.orgId), isNull(auditLog.subjectId));

  const [org, counted, rows] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, s.orgId) }),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(chainOf),
    db.select().from(auditLog).where(chainOf).orderBy(desc(auditLog.seq)).limit(AUDIT_PAGE_SIZE),
  ]);
  const total = Number(counted[0]?.n ?? 0);

  let chain: OrganizationAuditHistory["chain"] = {
    verified: null, length: total, head: null,
    reason: `The chain holds ${total} entries; it is verified whole only up to ${MAX_VERIFIED_ENTRIES}.`,
  };
  if (total <= MAX_VERIFIED_ENTRIES) {
    const all = await db.select().from(auditLog).where(chainOf).orderBy(asc(auditLog.seq));
    const entries: ChainEntry[] = all.map((r) => ({
      seq: r.seq, scopeId: r.scopeId, subjectId: r.subjectId ?? null, actor: r.actor, action: r.action,
      ref: r.ref ?? null, outcome: r.outcome, detail: r.detail, createdAt: r.createdAt.toISOString(),
      prevHash: r.prevHash, hash: r.hash,
    }));
    const verdict = verifyChain(s.orgId, null, entries);
    chain = verdict.ok
      ? { verified: true, length: verdict.length, head: verdict.head, reason: null }
      : { verified: false, length: verdict.length, head: null, reason: verdict.reason };
  }

  return {
    organization: { id: s.orgId, name: org?.name ?? "" },
    entries: rows.map(view),
    total,
    showing: rows.length,
    chain,
  };
}
