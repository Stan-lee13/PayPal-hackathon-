/**
 * How much of this deployment is attributed to an organization, and how much is not.
 *
 *   npm run tenant:inventory                      human summary
 *   npm run tenant:inventory -- --json            machine-readable
 *   npm run tenant:inventory -- --fail-unattributed   exit 1 if any financial row is unattributed
 *
 * "Unattributed" is not an error by itself: a row is unattributed when the key that owns it has no explicit
 * `principals` mapping (or the mapping is not ACTIVE), and nothing in this project guesses an owner. It is
 * reported so the decision to make `org_id` NOT NULL — and to enable RLS — is made on numbers, not on hope.
 *
 * It reads ids and counts only. No key, secret or token is selected or printed.
 */
import postgres from "postgres";
import { loadEnv } from "./env";

const TABLES = ["roots", "blocks", "spends", "accounts", "ledger", "cards", "transfers", "audit_log"] as const;

export type TenantInventory = {
  generatedAt: string;
  database: string;
  tables: Array<{ table: string; total: number; attributed: number; unattributed: number }>;
  organizations: Array<{ orgId: string; name: string; status: string; rows: Record<string, number> }>;
  totals: { total: number; attributed: number; unattributed: number; complete: boolean };
};

export async function collectTenantInventory(url: string): Promise<TenantInventory> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const tables: TenantInventory["tables"] = [];
    for (const table of TABLES) {
      const [row] = await sql<{ total: number; attributed: number }[]>`
        select count(*)::int as total, count(org_id)::int as attributed from ${sql(table)}
      `;
      const total = Number(row?.total ?? 0);
      const attributed = Number(row?.attributed ?? 0);
      tables.push({ table, total, attributed, unattributed: total - attributed });
    }
    const orgs = await sql<{ id: string; name: string; status: string }[]>`select id, name, status from organizations order by created_at`;
    const organizations: TenantInventory["organizations"] = [];
    for (const org of orgs) {
      const rows: Record<string, number> = {};
      for (const table of TABLES) {
        const [n] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)} where org_id = ${org.id}`;
        if (Number(n?.n ?? 0) > 0) rows[table] = Number(n!.n);
      }
      organizations.push({ orgId: org.id, name: org.name, status: org.status, rows });
    }
    const total = tables.reduce((n, t) => n + t.total, 0);
    const attributed = tables.reduce((n, t) => n + t.attributed, 0);
    return {
      generatedAt: new Date().toISOString(),
      database: url.replace(/\/\/[^@]*@/, "//"),
      tables, organizations,
      totals: { total, attributed, unattributed: total - attributed, complete: total === attributed },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function printTenantInventory(inv: TenantInventory): void {
  console.log(`Tenant attribution · ${inv.generatedAt}`);
  console.log(`Database: ${inv.database}`);
  console.log("");
  console.log("Rows by table:");
  for (const t of inv.tables) {
    const pct = t.total === 0 ? 100 : Math.round((t.attributed / t.total) * 100);
    console.log(`  ${t.table.padEnd(12)} ${String(t.total).padStart(6)} rows · ${String(t.attributed).padStart(6)} attributed (${pct}%) · ${t.unattributed} unattributed`);
  }
  console.log("");
  console.log(`Organizations with attributed rows: ${inv.organizations.length}`);
  for (const o of inv.organizations) {
    const where = Object.entries(o.rows).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${o.orgId} · ${o.name} [${o.status}] — ${where}`);
  }
  console.log("");
  if (inv.totals.complete) console.log("Every financial row is attributed to an organization.");
  else console.log(`${inv.totals.unattributed} of ${inv.totals.total} rows are unattributed: their key has no explicit ACTIVE mapping. Nothing was guessed, and nothing was modified.`);
}

if (process.argv[1]?.endsWith("tenant-inventory.ts")) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const inv = await collectTenantInventory(url);
  if (process.argv.includes("--json")) console.log(JSON.stringify(inv, null, 2));
  else printTenantInventory(inv);
  if (process.argv.includes("--fail-unattributed") && !inv.totals.complete) process.exit(1);
}
