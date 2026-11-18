/**
 * Proves the migration strategy is additive, on a real Postgres:
 *
 *   1. a fresh database is brought to migration 0009 only (the last one before multi-rail accounting);
 *   2. historical financial records are written into that schema, exactly as the running system would have;
 *   3. migrations 0010 and 0011 are applied on top;
 *   4. the records are still there, unchanged, and the new columns carry their documented defaults.
 *
 * Run against a server where the role may create databases:
 *
 *   DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres node scripts/migration-upgrade-check.mjs
 *
 * This is what the `upgrade` step of .github/workflows/postgres-acceptance.yml runs. It exits non-zero on any
 * loss, so "additive" is a checked fact rather than a claim.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const base = process.env.DATABASE_URL;
if (!base) {
  console.error("DATABASE_URL is not set: point it at a real Postgres where this role may create a database.");
  process.exit(2);
}
const UPGRADE_BEFORE = 9; // the journal index of 0009_rail_provenance
const scratch = `envelope_upgrade_${Date.now()}`;
const root = path.resolve("drizzle");
const work = mkdtempSync(path.join(tmpdir(), "envelope-migrations-"));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`ok   ${m}`);

const admin = postgres(base, { max: 1, onnotice: () => {} });
const url = new URL(base);
url.pathname = `/${scratch}`;

async function applyFolder(folder) {
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try { await migrate(drizzle(sql), { migrationsFolder: folder }); } finally { await sql.end(); }
}

try {
  await admin.unsafe(`create database "${scratch}"`);
  ok(`created a scratch database (${scratch})`);

  // A migrations folder with only the entries up to 0009, so the upgrade starts from a real 0009 database.
  cpSync(root, work, { recursive: true });
  const journalPath = path.join(work, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const head = journal.entries.filter((e) => e.idx <= UPGRADE_BEFORE);
  if (head.length !== UPGRADE_BEFORE + 1) throw new Error(`expected ${UPGRADE_BEFORE + 1} migrations up to 0009, found ${head.length}`);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: head }, null, 2));
  for (const file of readdirSync(path.join(work, "meta"))) {
    if (/^\d+_snapshot\.json$/.test(file) && Number(file.split("_")[0]) > UPGRADE_BEFORE) rmSync(path.join(work, "meta", file));
  }
  for (const file of readdirSync(work)) {
    if (/^\d+_.*\.sql$/.test(file) && Number(file.split("_")[0]) > UPGRADE_BEFORE) rmSync(path.join(work, file));
  }
  await applyFolder(work);
  ok("applied migrations 0000–0009 to an empty database");

  // Historical records: an owner, a hold, a payment, its capture and payout, an agent balance, a ledger entry.
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      insert into roots (id, principal, principal_name, title, currency, limit_minor, status, paypal_order_id, authorization_id, captured_minor, refunded_minor)
      values ('root_legacy', 'pk_owner', 'Ada', 'Legacy budget', 'USD', 10000, 'ACTIVE', 'ORDER1', 'AUTH1', 2500, 0);
      insert into blocks (id, root_id, depth, hash, holder, holder_label, caps, raw, spent_minor, reserved_minor)
      values ('root_legacy', 'root_legacy', 0, 'hash1', 'pk_ops', 'ops-agent', '{}'::jsonb, '{}'::jsonb, 2500, 0);
      insert into spends (id, root_id, leaf_id, leaf_label, chain_ids, request_hash, signed, amount_minor, currency, payee, purpose, status, capture_id, payout_batch_id, payout_item_id, payout_status, receipt)
      values ('sp_legacy', 'root_legacy', 'root_legacy', 'ops-agent', '["root_legacy"]'::jsonb, 'rh1', '{}'::jsonb, 2500, 'USD', 'designer@example.com', 'design', 'PAID', 'CAP1', 'BATCH1', 'ITEM1', 'SUCCESS', null);
      insert into accounts (agent, account, label, owner, owner_name, settle_to, signed, mode, balance_minor)
      values ('pk_agent', 'ACCT-1', 'translator-agent', 'pk_owner', 'Ada', 'ada@example.com', '{}'::jsonb, 'hold', 2500);
      insert into ledger (agent, kind, ref, delta_minor, balance_after_minor, counterparty, memo)
      values ('pk_agent', 'income', 'sp_legacy', 2500, 2500, 'ops-agent', 'legacy credit');
      insert into transfers (id, from_agent, kind, payee, amount_minor, currency, request_hash, signed, status, payout_batch_id, payout_item_id, payout_status)
      values ('tr_legacy', 'pk_agent', 'withdraw', 'ada@example.com', 500, 'USD', 'rh2', '{}'::jsonb, 'PAID', 'BATCH2', 'ITEM2', 'SUCCESS');
    `);
  } finally { await sql.end(); }
  ok("wrote historical financial records into the 0009 schema");

  const before = await (async () => {
    const s = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      return {
        roots: (await s`select count(*)::int as n from roots`)[0].n,
        spends: (await s`select count(*)::int as n from spends`)[0].n,
        ledger: (await s`select count(*)::int as n from ledger`)[0].n,
        transfers: (await s`select count(*)::int as n from transfers`)[0].n,
        captured: (await s`select captured_minor from roots where id = 'root_legacy'`)[0].captured_minor,
        balance: (await s`select balance_minor from accounts where agent = 'pk_agent'`)[0].balance_minor,
      };
    } finally { await s.end(); }
  })();

  await applyFolder(root);
  ok("applied 0010 and 0011 on top of the existing database");

  const s = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const after = {
      roots: (await s`select count(*)::int as n from roots`)[0].n,
      spends: (await s`select count(*)::int as n from spends`)[0].n,
      ledger: (await s`select count(*)::int as n from ledger`)[0].n,
      transfers: (await s`select count(*)::int as n from transfers`)[0].n,
      captured: (await s`select captured_minor from roots where id = 'root_legacy'`)[0].captured_minor,
      balance: (await s`select balance_minor from accounts where agent = 'pk_agent'`)[0].balance_minor,
    };
    const same = JSON.stringify(before) === JSON.stringify(after);
    same ? ok("every historical record is unchanged (counts, captured amount, balance)") : fail(`records changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);

    const tables = new Set((await s`select table_name from information_schema.tables where table_schema = 'public'`).map((r) => r.table_name));
    for (const t of ["rail_accounts", "position_entries", "reconciliation_runs"]) tables.has(t) ? ok(`table ${t} exists`) : fail(`table ${t} is missing`);

    const ledgerCols = Object.fromEntries((await s`select column_name, column_default, is_nullable from information_schema.columns where table_name = 'ledger'`).map((c) => [c.column_name, c]));
    ledgerCols.rail?.column_default?.includes("'paypal'") ? ok("ledger.rail defaults to 'paypal'") : fail("ledger.rail is missing or has no default");
    ledgerCols.currency?.column_default?.includes("'USD'") ? ok("ledger.currency defaults to 'USD'") : fail("ledger.currency is missing or has no default");

    const legacyLedger = (await s`select rail, currency from ledger where ref = 'sp_legacy'`)[0];
    legacyLedger.rail === "paypal" && legacyLedger.currency === "USD"
      ? ok("the historical ledger row was backfilled to paypal/USD — the rail that actually funded it")
      : fail(`the historical ledger row was not backfilled: ${JSON.stringify(legacyLedger)}`);

    const spendCols = new Set((await s`select column_name from information_schema.columns where table_name = 'spends'`).map((c) => c.column_name));
    spendCols.has("settling_at") && spendCols.has("rail_provider") && spendCols.has("settle_generation")
      ? ok("spends has rail_provider, settling_at and settle_generation")
      : fail("spends is missing rail_provider, settling_at or settle_generation");
    const legacyGen = (await s`select settle_generation from spends where id = 'sp_legacy'`)[0].settle_generation;
    legacyGen === 0 ? ok("the historical payment was given settle_generation 0 (never claimed)") : fail(`settle_generation was not defaulted: ${legacyGen}`);

    const idx = (await s`select indexname from pg_indexes where tablename = 'position_entries'`).map((r) => r.indexname);
    idx.includes("position_entries_once") ? ok("position_entries is unique per (rail, currency, bucket, kind, ref)") : fail("the position_entries idempotency index is missing");
  } finally { await s.end(); }
} catch (e) {
  fail(e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  rmSync(work, { recursive: true, force: true });
  await admin.unsafe(`drop database if exists "${scratch}" with (force)`).catch((e) => fail(`could not drop the scratch database: ${e.message}`));
  await admin.end();
}

if (process.exitCode) {
  console.error("\nThe upgrade is NOT additive. Do not ship it.");
} else {
  console.log("\nUpgrade check passed: the migrations are additive and historical records survive.");
}
