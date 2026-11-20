/**
 * Dry-run inventory of every financial identity in this deployment, for the organization migration.
 *
 *   npm run identity:inventory            human summary
 *   npm run identity:inventory -- --json  machine-readable, for checking a mapping file
 *
 * It reads public keys, counts and provider identifiers only. No private key, provider secret or token is
 * selected, printed or stored. Run it before writing config/legacy-organization-map.json: the migration refuses
 * to assign a principal the operator has not explicitly mapped.
 */
import postgres from "postgres";
import { loadEnv } from "./env";

type Source = { table: string; column: string; note: string };

/** Every place a principal key appears in the existing schema. */
const SOURCES: Source[] = [
  { table: "roots", column: "principal", note: "the human principal who sealed a root envelope" },
  { table: "blocks", column: "holder", note: "an agent key that holds a block" },
  { table: "accounts", column: "owner", note: "the owner who answers for an agent account" },
  { table: "rail_accounts", column: "owner", note: "the organization's provider position" },
  { table: "position_entries", column: "owner", note: "provider movements, by owner" },
  { table: "audit_log", column: "scope_id", note: "the audit hash chain for one principal" },
  { table: "demo_keys", column: "public_key", note: "DEMO ONLY: built-in agents' keys" },
  { table: "gateway_keys", column: "public_key", note: "the gateway's own signing key (not a principal)" },
];

export type IdentityInventory = {
  generatedAt: string;
  database: string;
  principals: Array<{ publicKey: string; sources: Record<string, number>; total: number }>;
  gatewayKeys: Array<{ id: string; publicKey: string; createdAt: string }>;
  providerAccounts: Array<{ owner: string; rail: string; currency: string; externalAccountId: string | null; label: string }>;
  counts: Record<string, number>;
};

const maskAccount = (id: string | null) => (id ? `${id.slice(0, 8)}…` : null);

export async function collectInventory(url: string): Promise<IdentityInventory> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const perSource: Record<string, Record<string, number>> = {};
    const counts: Record<string, number> = {};
    for (const s of SOURCES) {
      const rows = await sql<{ key: string | null; n: number }[]>`
        select ${sql(s.column)} as key, count(*)::int as n from ${sql(s.table)} group by 1
      `;
      counts[s.table] = rows.reduce((n, r) => n + Number(r.n), 0);
      for (const r of rows) {
        if (!r.key) continue;
        perSource[r.key] ??= {};
        perSource[r.key]![s.table] = Number(r.n);
      }
    }
    const gateway = await sql<{ id: string; public_key: string; created_at: Date }[]>`
      select id, public_key, created_at from gateway_keys order by created_at
    `;
    const accounts = await sql<{ owner: string; rail: string; currency: string; external_account_id: string | null; label: string }[]>`
      select owner, rail, currency, external_account_id, label from rail_accounts order by owner, rail, currency
    `;
    const principals = Object.entries(perSource)
      .map(([publicKey, sources]) => ({ publicKey, sources, total: Object.values(sources).reduce((n, x) => n + x, 0) }))
      .sort((a, b) => a.publicKey.localeCompare(b.publicKey));
    return {
      generatedAt: new Date().toISOString(),
      // Host and database only: no credentials.
      database: url.replace(/\/\/[^@]*@/, "//").replace(/\?.*$/, ""),
      principals,
      gatewayKeys: gateway.map((g) => ({ id: g.id, publicKey: g.public_key, createdAt: new Date(g.created_at).toISOString() })),
      providerAccounts: accounts.map((a) => ({ owner: a.owner, rail: a.rail, currency: a.currency, externalAccountId: maskAccount(a.external_account_id), label: a.label })),
      counts,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function print(inv: IdentityInventory) {
  console.log(`Identity inventory · ${inv.generatedAt}`);
  console.log(`Database: ${inv.database}`);
  console.log("");
  console.log("Financial record counts:");
  for (const [table, n] of Object.entries(inv.counts)) console.log(`  ${table.padEnd(20)} ${n}`);
  console.log("");
  console.log(`Distinct public keys: ${inv.principals.length}`);
  for (const p of inv.principals) {
    const where = Object.entries(p.sources).map(([t, n]) => `${t}×${n}`).join(", ");
    console.log(`  ${p.publicKey}  (${p.total}) ${where}`);
  }
  console.log("");
  console.log(`Gateway signing keys: ${inv.gatewayKeys.length}`);
  for (const g of inv.gatewayKeys) console.log(`  ${g.id}: ${g.publicKey} (${g.createdAt})`);
  console.log("");
  console.log(`Provider accounts: ${inv.providerAccounts.length}`);
  for (const a of inv.providerAccounts) console.log(`  ${a.owner} · ${a.rail} ${a.currency} · ${a.externalAccountId ?? "identity not established"} ${a.label}`.trim());
  console.log("");
  console.log("Nothing was modified. Map every principal in config/legacy-organization-map.json before migrating.");
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set: the inventory cannot be produced.");
    process.exit(1);
  }
  const inv = await collectInventory(url);
  if (process.argv.includes("--json")) console.log(JSON.stringify(inv, null, 2));
  else print(inv);
}

if (process.argv[1]?.endsWith("identity-inventory.ts")) {
  await main();
}
