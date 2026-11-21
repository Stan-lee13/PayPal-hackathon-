/**
 * The attribution statements, so an operator can re-run them after correcting a mapping.
 *
 * These are the same statements drizzle/0015_tenant_partitioning.sql runs once at upgrade. They only ever fill a
 * NULL `org_id` from the explicit parent chain, so running them again is safe and never rewrites a row that
 * already has an organization. A record whose owner is still unmapped keeps its NULL: no guess, no default
 * organization, no consolidation.
 */
import { sql } from "drizzle-orm";
import type { DB } from "../db";

export const ATTRIBUTION_SQL: readonly string[] = [
  // A sealed envelope belongs to the organization its sealing principal is explicitly mapped to.
  `UPDATE "roots" SET "org_id" = p."org_id" FROM "principals" p
     WHERE p."public_key" = "roots"."principal" AND p."status" = 'ACTIVE' AND "roots"."org_id" IS NULL`,
  // Every block and payment under it belongs to the same organization as the envelope.
  `UPDATE "blocks" SET "org_id" = r."org_id" FROM "roots" r
     WHERE r."id" = "blocks"."root_id" AND r."org_id" IS NOT NULL AND "blocks"."org_id" IS NULL`,
  `UPDATE "spends" SET "org_id" = r."org_id" FROM "roots" r
     WHERE r."id" = "spends"."root_id" AND r."org_id" IS NOT NULL AND "spends"."org_id" IS NULL`,
  // An account belongs to the organization of the owner who co-signed it open.
  `UPDATE "accounts" SET "org_id" = p."org_id" FROM "principals" p
     WHERE p."public_key" = "accounts"."owner" AND p."status" = 'ACTIVE' AND "accounts"."org_id" IS NULL`,
  // Balance movements, cards and transfers belong to the organization of the account that carries them.
  `UPDATE "ledger" SET "org_id" = a."org_id" FROM "accounts" a
     WHERE a."agent" = "ledger"."agent" AND a."org_id" IS NOT NULL AND "ledger"."org_id" IS NULL`,
  `UPDATE "cards" SET "org_id" = a."org_id" FROM "accounts" a
     WHERE a."agent" = "cards"."holder" AND a."org_id" IS NOT NULL AND "cards"."org_id" IS NULL`,
  `UPDATE "transfers" SET "org_id" = a."org_id" FROM "accounts" a
     WHERE a."agent" = "transfers"."from_agent" AND a."org_id" IS NOT NULL AND "transfers"."org_id" IS NULL`,
  // Audit entries take the organization of the envelope they are about, or of the principal whose chain they extend.
  `UPDATE "audit_log" SET "org_id" = r."org_id" FROM "roots" r
     WHERE r."id" = "audit_log"."subject_id" AND r."org_id" IS NOT NULL AND "audit_log"."org_id" IS NULL`,
  `UPDATE "audit_log" SET "org_id" = p."org_id" FROM "principals" p
     WHERE p."public_key" = "audit_log"."scope_id" AND p."status" = 'ACTIVE' AND "audit_log"."org_id" IS NULL`,
];

/** One transaction, one lock, every statement. Returns how many rows each statement attributed. */
export async function attributeTenantRows(db: DB): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('envelope-tenant-attribution', 0))`);
    const counts: number[] = [];
    for (const statement of ATTRIBUTION_SQL) {
      const rows = (await tx.execute(sql.raw(`${statement} RETURNING 1`))) as unknown as unknown[];
      counts.push(rows.length);
    }
    return counts;
  });
}
