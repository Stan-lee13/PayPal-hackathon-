import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "../scripts/env";

/** Recreates the test schema once per run. Requires TEST_DATABASE_URL (never the dev DB). */
export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    // A run that skips every database-backed suite must not pass for a full one. CI, or REQUIRE_TEST_DB=1, makes it fail.
    if (process.env.CI || process.env.REQUIRE_TEST_DB === "1") throw new Error("TEST_DATABASE_URL is not set: the database-backed suites (most of the tests) would be skipped. Set it, or run without CI/REQUIRE_TEST_DB to skip them knowingly.");
    console.warn("\n[tests] TEST_DATABASE_URL IS NOT SET. Every database-backed suite will be SKIPPED; only the pure tests run. This is not a full test run.\n");
    return;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
