/**
 * Attribute existing financial rows to organizations, after a mapping is added or corrected.
 *
 *   npm run tenant:backfill
 *
 * The upgrade in drizzle/0015_tenant_partitioning.sql already does this once. This script is how an operator
 * applies a *new* or *corrected* mapping without another migration. It only fills rows whose `org_id` is NULL,
 * so it never moves a row that already belongs to an organization: moving one is an explicit migration, not a
 * side effect of a re-run. Rows whose key is still unmapped stay NULL and are reported by
 * `npm run tenant:inventory`.
 */
import { closeDb, getDb } from "../lib/db";
import { attributeTenantRows } from "../lib/identity/tenant-attribution";
import { loadEnv } from "./env";

loadEnv();
const counts = await attributeTenantRows(getDb());
const n = (i: number) => counts[i] ?? 0;
console.log(`Attributed: ${n(0)} envelope(s), ${n(1)} block(s), ${n(2)} payment(s), ${n(3)} account(s), ${n(4)} balance movement(s), ${n(5)} card(s), ${n(6)} transfer(s), ${n(7) + n(8)} audit entr(ies).`);
console.log("Nothing was rewritten: only rows whose organization was unknown were filled, from the explicit mapping.");
console.log("Run `npm run tenant:inventory` to see what is still unattributed.");
await closeDb();
