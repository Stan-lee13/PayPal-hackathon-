/**
 * Apply the explicit legacy principal → organization mapping.
 *
 *   npm run identity:migrate -- --map config/legacy-organization-map.json --dry-run
 *   npm run identity:migrate -- --map config/legacy-organization-map.json --apply
 *
 * Rules, in order:
 *
 *   1. the mapping file is validated before anything is read from the database;
 *   2. every distinct principal in the deployment is inventoried;
 *   3. a principal the file does not map stops the migration — nothing is assigned to a default organization;
 *   4. applying is additive and idempotent: organizations and `principals` rows only. No envelope, receipt,
 *      provider identifier, spend, transfer or audit row is rewritten.
 *
 * `--allow-unmapped` does not assign anything: it only lets the mapped principals be recorded while the
 * unmapped ones are reported and left without an organization, for a later, deliberate decision.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv } from "./env";
import { organizationForPrincipal, parseLegacyOrganizationMap, unmappedLegacyPrincipals, type LegacyOrganizationMap } from "../lib/identity/legacy-map";

const PRINCIPAL_SOURCES = ["roots.principal", "accounts.owner", "rail_accounts.owner", "position_entries.owner", "audit_log.scope_id"] as const;

type Row = { key: string };

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** Every distinct principal key, from the tables that can own a financial record. */
async function legacyPrincipals(sql: postgres.Sql): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const [table, column] = [null, null]; // typed below; kept explicit for readability
  void table; void column;
  for (const source of PRINCIPAL_SOURCES) {
    const [schematic, col] = source.split(".") as [string, string];
    const rows = await sql<Row[]>`select distinct ${sql(col)} as key from ${sql(schematic)} where ${sql(col)} is not null`;
    for (const r of rows) {
      if (!r.key) continue;
      const list = seen.get(r.key) ?? [];
      list.push(source);
      seen.set(r.key, list);
    }
  }
  return seen;
}

function report(map: LegacyOrganizationMap, keys: Map<string, string[]>, unmapped: string[]) {
  console.log(`Mapped principals: ${keys.size - unmapped.length}/${keys.size}`);
  for (const o of map.organizations) console.log(`  ${o.organization_id} · ${o.name} · ${o.legacy_principals.length} principal(s)`);
  if (unmapped.length) {
    console.log("");
    console.log(`UNMAPPED PRINCIPALS (${unmapped.length}) — these records have no organization and stay that way:`);
    for (const k of unmapped) console.log(`  ${k} (${(keys.get(k) ?? []).join(", ")})`);
  }
}

async function main() {
  loadEnv();
  const mapPath = arg("--map");
  if (!mapPath) {
    console.error("Give the mapping file: --map config/legacy-organization-map.json");
    process.exit(2);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(mapPath, "utf8")); }
  catch (e) { console.error(`Cannot read ${mapPath}: ${(e as Error).message}`); process.exit(2); }
  const valid = parseLegacyOrganizationMap(parsed);
  if (!valid.ok) {
    console.error("The mapping file is invalid; nothing was read from the database:");
    for (const p of valid.problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  const map = valid.map;

  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const keys = await legacyPrincipals(sql);
    const unmapped = unmappedLegacyPrincipals(map, keys.keys());
    const allowUnmapped = process.argv.includes("--allow-unmapped");
    report(map, keys, unmapped);
    if (unmapped.length && !allowUnmapped) {
      console.error("");
      console.error("Refusing to migrate: every principal must be mapped explicitly. Nothing was written.");
      console.error("Add them to the file, or pass --allow-unmapped to record only the mapped ones.");
      process.exit(1);
    }

    // Contradictions between the file and an earlier run: a principal already in another organization.
    const existing = await sql<{ public_key: string; org_id: string }[]>`select public_key, org_id from principals`;
    const conflicts = existing.filter((r) => {
      const wants = organizationForPrincipal(map, r.public_key);
      return wants !== null && wants !== r.org_id;
    });
    if (conflicts.length) {
      console.error("Refusing to migrate: these principals are already mapped to a different organization:");
      for (const c of conflicts) console.error(`  ${c.public_key} is ${c.org_id}, the file says ${organizationForPrincipal(map, c.public_key)}`);
      process.exit(1);
    }

    if (process.argv.includes("--dry-run") || !process.argv.includes("--apply")) {
      console.log("");
      console.log("Dry run: nothing was written. Re-run with --apply to record the organizations and principal mappings.");
      return;
    }

    const result = await sql.begin(async (tx) => {
      let orgsAdded = 0, principalsAdded = 0;
      for (const o of map.organizations) {
        const [org] = await tx<{ id: string }[]>`
          insert into organizations (id, name, status, metadata)
          values (${o.organization_id}, ${o.name}, 'ACTIVE', ${tx.json({ source: "legacy-map", version: map.version })})
          on conflict (id) do nothing returning id
        `;
        if (org) orgsAdded += 1;
        for (const publicKey of o.legacy_principals) {
          const [p] = await tx<{ id: string }[]>`
            insert into principals (id, org_id, public_key, label, status)
            values (${`prn_${publicKey.slice(0, 20)}_${o.organization_id.slice(0, 12)}`}, ${o.organization_id}, ${publicKey}, '', 'ACTIVE')
            on conflict (public_key) do nothing returning id
          `;
          if (p) principalsAdded += 1;
        }
      }
      return { orgsAdded, principalsAdded };
    });
    console.log("");
    console.log(`Applied: ${result.orgsAdded} organization(s) created, ${result.principalsAdded} principal mapping(s) recorded.`);
    console.log("No envelope, receipt, provider identifier, spend, transfer or audit row was changed.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
