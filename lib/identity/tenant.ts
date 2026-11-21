/**
 * Which organization a financial record belongs to.
 *
 * There is exactly one source: the explicit `principals` mapping added in Milestone 4.1 — one public key, one
 * organization, one `status`. A record whose key is not mapped, or whose mapping is not `ACTIVE`, is *not*
 * attributed: these functions return null rather than defaulting to an organization, because a financial record
 * filed under the wrong tenant is worse than one that is honestly unmatched (scripts/tenant-inventory.ts
 * reports the latter).
 *
 * Nothing here reads a request, a header, an email or a webhook field. The callers pass a key that came from a
 * signed record or from a row already loaded from the database.
 */
import { eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { principals, roots } from "../db/schema";

/** The database, or an open transaction: both expose the relational `query` API. */
type Reader = Pick<DB, "query">;

/** The organization a financial principal (the key that sealed a root envelope) is mapped to. */
export async function orgForPrincipal(publicKey: string | null | undefined, db: Reader = getDb()): Promise<string | null> {
  if (!publicKey) return null;
  const row = await db.query.principals.findFirst({ where: eq(principals.publicKey, publicKey) });
  return row && row.status === "ACTIVE" ? row.orgId : null;
}

/** The organization recorded on a root envelope, for the rows that hang under it. */
export async function orgForRoot(rootId: string, db: Reader = getDb()): Promise<string | null> {
  const row = await db.query.roots.findFirst({ where: eq(roots.id, rootId), columns: { orgId: true } });
  return row?.orgId ?? null;
}
