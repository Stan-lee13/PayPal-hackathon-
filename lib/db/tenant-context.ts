/**
 * The organization a request is being served for, carried into the database.
 *
 * Milestone 4.2 put `org_id` on every financial row. This is the other half: a caller who has an organization
 * runs its reads inside a transaction that carries it, so the row filter and (when they are enabled) the row
 * level security policies read the same value.
 *
 * Three rules, all of them deliberate:
 *
 *   • The setting is transaction-local (`set_config(..., true)`). A pooled connection goes back to the pool with
 *     no organization on it, so the next request cannot inherit this one's tenant.
 *   • It is read back and checked before any query runs. A transaction that says it is for one organization and
 *     is not is a bug, and it fails rather than silently reading everything.
 *   • A query still filters by `org_id` explicitly. The result is therefore the same whether or not RLS is
 *     enabled: enabling the policies later cannot change an answer that was already scoped.
 *
 * An *unscoped* caller (no session: the signed agent paths, the in-browser gateway, the operator tools) keeps
 * reading what it read before. That is the gap this milestone does not close: requiring a session on the
 * addressed reads is the next step, and it needs the console to have a sign-in.
 */
import { sql } from "drizzle-orm";
import { getDb, type DB } from "./index";
import type { MembershipRole } from "./schema";

/** Who is reading, and for which organization. Derived only from a server-validated session. */
export type TenantScope = { orgId: string; userId: string; role: MembershipRole };

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Either the pool or an open transaction: both expose the relational `query` API and the query builder. */
export type TenantDb = DB | Tx;

/** The Postgres setting the policies will read. */
export const TENANT_SETTING = "envelope.org_id";

/**
 * Run `run` in a transaction that carries `orgId`, after proving the setting was established. The transaction is
 * the unit: nothing on the pooled connection outside it knows the organization.
 */
export async function withTenant<T>(orgId: string, run: (db: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("withTenant needs an organization.");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${orgId}, true)`);
    const rows = (await tx.execute(sql`select current_setting(${TENANT_SETTING}, true) as org`)) as unknown as Array<{ org: string | null }>;
    if (rows[0]?.org !== orgId) throw new Error("The organization context was not established for this transaction.");
    return run(tx);
  });
}

/** Run a read under the caller's organization, or unscoped when the caller has none. */
export async function readInTenant<T>(scope: TenantScope | null | undefined, read: (db: TenantDb) => Promise<T>): Promise<T> {
  return scope ? withTenant(scope.orgId, read) : read(getDb());
}

/**
 * Whether a row is the caller's to see.
 *
 * A scoped caller sees a row only when it carries that organization. An unattributed row (`org_id` NULL) is
 * nobody's, so a scoped caller does not see it: the honest gap stays a gap rather than becoming a shared record.
 * A caller with no scope is the pre-session path and sees what it always saw; that is stated in the route table,
 * not hidden here.
 */
export function visibleTo(scope: TenantScope | null | undefined, orgId: string | null | undefined): boolean {
  if (!scope) return true;
  return Boolean(orgId) && orgId === scope.orgId;
}
