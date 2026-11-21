/**
 * Is tenant isolation real on this deployment?
 *
 * Checks the request role and the row level security policies (migration 0016). Run it after provisioning the
 * role, and in a deployment pipeline before the app is allowed to serve:
 *
 *   npm run tenant:check
 *
 * Exit status 1 means at least one check failed; nothing is changed by running it.
 */
import { tenantRoleProblems } from "../lib/security/tenant-role";
import { closeDriver } from "../lib/db/driver";
import { tenantRole } from "../lib/db/tenant-context";

void (async () => {
  const role = tenantRole();
  console.log(`Request role: ${role ?? "none (reads run as the role that owns the tables)"}`);
  if (!role) {
    console.error("TENANT_ROLE_NOT_CONFIGURED: request-scoped reads run as the role that owns the tables, so the row level security policies do not apply. See drizzle/0016_row_level_security.sql for the grants, then set ENVELOPE_TENANT_ROLE.");
    process.exitCode = 1;
    return;
  }
  let problems: Awaited<ReturnType<typeof tenantRoleProblems>>;
  try {
    problems = await tenantRoleProblems();
  } catch (e) {
    console.error(`Could not check the database: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  } finally {
    await closeDriver().catch(() => undefined);
  }
  if (problems.length === 0) {
    console.log("Tenant isolation checks out: the request role exists, owns nothing, cannot bypass row level security, and every tenant table has its policy.");
    return;
  }
  for (const p of problems) console.error(`${p.code}: ${p.detail}`);
  process.exitCode = 1;
})();
