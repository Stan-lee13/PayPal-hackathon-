/**
 * Milestone 4.4 — row level security on the tables that carry an organization.
 *
 * A policy that is enabled on tables owned by the connecting role is a policy that never runs, so this test does
 * what the deployment does: it creates a request role that owns nothing, grants it SELECT only, switches to it
 * for one transaction, and reads.
 *
 *   • the policies are enabled on all eight tenant tables;
 *   • inside a transaction that names one organization, only that organization's rows exist;
 *   • a transaction that names none reads nothing (NULL is not equal to anything, which is the direction we want);
 *   • the role cannot write at all, so a request-scoped bug cannot rewrite a financial record;
 *   • the production check passes on this setup and names what is wrong on a broken one;
 *   • `withTenant` honours the role, and the role does not leak onto the pooled connection afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;
const PROBE = `envelope_probe_${process.pid.toString(36)}${Date.now().toString(36)}`;
if (!/^[a-z0-9_]+$/.test(PROBE)) throw new Error("probe role name must be a plain identifier");

d("row level security (real PostgreSQL)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");
  const { withTenant } = await import("../lib/db/tenant-context");
  const { REQUIRED_RLS_TABLES, tenantRoleConfigProblems, tenantRoleDatabaseProblems } = await import("../lib/security/tenant-role");
  const { newId } = await import("../lib/ids");

  const reset = () => getDb().execute(sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);

  beforeAll(async () => {
    const db = getDb();
    await db.execute(sql.raw(`drop role if exists ${PROBE}`));
    await db.execute(sql.raw(`create role ${PROBE} nologin`));
    await db.execute(sql.raw(`grant usage on schema public to ${PROBE}`));
    await db.execute(sql.raw(`grant select on accounts, audit_log, blocks, cards, ledger, roots, spends, transfers to ${PROBE}`));
    process.env.ENVELOPE_TENANT_ROLE = PROBE;
  });

  afterAll(async () => {
    delete process.env.ENVELOPE_TENANT_ROLE;
    const db = getDb();
    await db.execute(sql.raw(`revoke all on accounts, audit_log, blocks, cards, ledger, roots, spends, transfers from ${PROBE}`)).catch(() => undefined);
    await db.execute(sql.raw(`drop role if exists ${PROBE}`)).catch(() => undefined);
  });

  async function makeOrg(name: string): Promise<string> {
    const id = newId("org");
    await getDb().insert(schema.organizations).values({ id, name });
    return id;
  }

  async function seedRoot(orgId: string | null, principal: string) {
    const id = newId("rt");
    await getDb().insert(schema.roots).values({ id, principal, orgId, principalName: "Ada", title: "Budget", currency: "USD", limitMinor: 20000 });
    return id;
  }

  const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

  it("has the policies enabled on every tenant table", async () => {
    const rows = (await getDb().execute(sql`select relname from pg_class where relkind = 'r' and relrowsecurity`)) as unknown as Array<{ relname: string }>;
    const on = new Set(rows.map((r) => r.relname));
    expect(REQUIRED_RLS_TABLES.filter((t) => !on.has(t))).toEqual([]);
  });

  it("shows a request-role transaction only the organization it named", async () => {
    await reset();
    const [a, b] = [await makeOrg("A"), await makeOrg("B")];
    const [ra, rb] = [await seedRoot(a, "A".repeat(43)), await seedRoot(b, "B".repeat(43))];
    const unattributed = await seedRoot(null, "C".repeat(43));

    expect(ids(await withTenant(a, (tx) => tx.execute(sql`select id from roots`)))).toEqual([ra]);
    expect(ids(await withTenant(b, (tx) => tx.execute(sql`select id from roots`)))).toEqual([rb]);
    // An unattributed row is nobody's, so it is in neither organization's view.
    expect(ids(await withTenant(a, (tx) => tx.execute(sql`select id from roots`)))).not.toContain(unattributed);
  });

  it("reads nothing when no organization was named", async () => {
    await reset();
    const a = await makeOrg("A");
    await seedRoot(a, "A".repeat(43));
    const rows = await getDb().transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${PROBE}`));
      return tx.execute(sql`select id from roots`);
    });
    expect(ids(rows)).toEqual([]);
  });

  it("cannot write, so a request-scoped bug cannot rewrite a financial record", async () => {
    await reset();
    const a = await makeOrg("A");
    const id = await seedRoot(a, "A".repeat(43));
    // Drizzle wraps the driver's error, so the Postgres message is on the cause.
    let message = "";
    try {
      await withTenant(a, (tx) => tx.execute(sql`delete from roots where id = ${id}`));
    } catch (e) {
      const err = e as { message: string; cause?: { message?: string } };
      message = `${err.message} ${err.cause?.message ?? ""}`;
    }
    expect(message).toMatch(/permission denied/i);
    expect((await getDb().execute(sql`select id from roots`)) as unknown as Array<{ id: string }>).toHaveLength(1);
  });

  it("leaves the engine's role on the pooled connection", async () => {
    await reset();
    const a = await makeOrg("A");
    await withTenant(a, (tx) => tx.execute(sql`select 1`));
    const rows = (await getDb().execute(sql`select current_setting('role', true) as role`)) as unknown as Array<{ role: string | null }>;
    expect([null, "", "none"]).toContain(rows[0]?.role ?? null);
  });

  it("passes the production check on a correct setup, and names what is wrong on a broken one", async () => {
    await reset();
    expect(await tenantRoleDatabaseProblems()).toEqual([]);
    expect(tenantRoleConfigProblems({ NODE_ENV: "production" }).map((p) => p.code)).toEqual(["TENANT_ROLE_NOT_CONFIGURED"]);
    expect(tenantRoleConfigProblems({ NODE_ENV: "production", ENVELOPE_TENANT_ROLE: "bad name; drop table" }).map((p) => p.code)).toEqual(["TENANT_ROLE_INVALID"]);
    expect((await tenantRoleDatabaseProblems({ NODE_ENV: "production", ENVELOPE_TENANT_ROLE: "no_such_request_role" })).map((p) => p.code)).toEqual(["TENANT_ROLE_MISSING"]);
    expect(tenantRoleConfigProblems({ NODE_ENV: "development" })).toEqual([]);
  });
});
