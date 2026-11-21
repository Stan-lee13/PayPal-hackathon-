/**
 * The request role, and whether this deployment can be trusted to serve tenant reads.
 *
 * Migration 0016 turns on row level security on the eight tables that carry an organization. The policies only
 * bite for a role that does not own those tables and cannot bypass RLS, which is why the deployment names one:
 * `withTenant` switches to it for the length of one read transaction.
 *
 * These checks are the difference between "the policies are enabled" and "the policies are doing something".
 * A deployment that connects as the owner (or as a superuser) has the policies switched on and completely
 * unapplied. In production, that is a refusal to start, not a warning.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { assertTenantRoleName, tenantRole } from "../db/tenant-context";

export const REQUIRED_RLS_TABLES = ["accounts", "audit_log", "blocks", "cards", "ledger", "roots", "spends", "transfers"] as const;

export type TenantRoleProblem = { code: string; detail: string };

/** The part of the check that needs only the environment. Empty outside production. */
export function tenantRoleConfigProblems(env: NodeJS.ProcessEnv = process.env): TenantRoleProblem[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: TenantRoleProblem[] = [];
  const role = tenantRole(env);
  if (!role) {
    problems.push({
      code: "TENANT_ROLE_NOT_CONFIGURED",
      detail:
        "ENVELOPE_TENANT_ROLE is not set, so request-scoped reads run as the role that owns the tables and the row level security policies do not apply. Provision a SELECT-only role (see drizzle/0016_row_level_security.sql) and name it here.",
    });
    return problems;
  }
  try {
    assertTenantRoleName(role);
  } catch (e) {
    problems.push({ code: "TENANT_ROLE_INVALID", detail: (e as Error).message });
  }
  return problems;
}

/** The part that needs the database: the role exists, owns nothing, cannot bypass RLS, and the policies are on. */
export async function tenantRoleDatabaseProblems(env: NodeJS.ProcessEnv = process.env): Promise<TenantRoleProblem[]> {
  const role = tenantRole(env);
  if (!role) return [];
  try {
    assertTenantRoleName(role);
  } catch {
    return []; // reported by tenantRoleConfigProblems; there is no role to look up
  }
  const db = getDb();
  const problems: TenantRoleProblem[] = [];

  const found = (await db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = ${role}`)) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
  if (!found[0]) {
    return [{ code: "TENANT_ROLE_MISSING", detail: `The request role ${role} does not exist on this database.` }];
  }
  if (found[0].rolsuper) problems.push({ code: "TENANT_ROLE_SUPERUSER", detail: `${role} is a superuser: a superuser is never subject to row level security.` });
  if (found[0].rolbypassrls) problems.push({ code: "TENANT_ROLE_BYPASSES_RLS", detail: `${role} has BYPASSRLS, which makes the policies decorative.` });

  const owned = (await db.execute(sql`select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = ${role} and c.relkind = 'r'`)) as unknown as Array<{ n: number }>;
  if ((owned[0]?.n ?? 0) > 0) problems.push({ code: "TENANT_ROLE_OWNS_TABLES", detail: `${role} owns ${owned[0]!.n} table(s); a table's owner is exempt from its policies unless they are forced.` });

  // A role without USAGE on the schema sees no tables at all, which surfaces as a confusing "relation does not
  // exist" on every request-scoped read. It is a setup mistake this check names plainly.
  const usage = (await db.execute(sql`select has_schema_privilege(${role}, 'public', 'USAGE') as ok`)) as unknown as Array<{ ok: boolean }>;
  if (!usage[0]?.ok) problems.push({ code: "TENANT_ROLE_NO_SCHEMA_USAGE", detail: `${role} has no USAGE on schema public; grant it, or every request-scoped read fails as a missing relation.` });

  const readable = (await db.execute(sql`select count(*)::int as n from unnest(array['accounts','audit_log','blocks','cards','ledger','roots','spends','transfers']) as t(name) where has_table_privilege(${role}, 'public.' || t.name, 'SELECT')`)) as unknown as Array<{ n: number }>;
  if ((readable[0]?.n ?? 0) !== REQUIRED_RLS_TABLES.length) {
    problems.push({ code: "TENANT_ROLE_CANNOT_READ", detail: `${role} holds SELECT on ${readable[0]?.n ?? 0} of the ${REQUIRED_RLS_TABLES.length} tenant tables.` });
  }

  const on = (await db.execute(sql`select relname from pg_class where relkind = 'r' and relrowsecurity`)) as unknown as Array<{ relname: string }>;
  const enabled = new Set(on.map((r) => r.relname));
  const missing = REQUIRED_RLS_TABLES.filter((t) => !enabled.has(t));
  if (missing.length) problems.push({ code: "RLS_NOT_ENABLED", detail: `Row level security is not enabled on: ${missing.join(", ")}.` });

  return problems;
}

/** Every problem, without throwing. */
export async function tenantRoleProblems(env: NodeJS.ProcessEnv = process.env): Promise<TenantRoleProblem[]> {
  return [...tenantRoleConfigProblems(env), ...(await tenantRoleDatabaseProblems(env))];
}

/** Refuse to serve when the deployment's tenant isolation is not real. Production only. */
export async function assertTenantRole(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV !== "production") return;
  const problems = await tenantRoleProblems(env);
  if (problems.length === 0) return;
  throw new Error("Refusing to serve: " + problems.map((p) => `${p.code}: ${p.detail}`).join(" "));
}
