/** Server driver: one shared Postgres pool per process (survives Next.js dev hot reloads). */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;
declare global {
  // eslint-disable-next-line no-var
  var __envelopeDb: { db: DB; sql: postgres.Sql } | undefined;
}

export function openDriver(): DB {
  if (!globalThis.__envelopeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
    const needsSsl = /sslmode=require|neon\.tech|supabase\.(co|com)/.test(url);
    const sql = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 5), ssl: needsSsl ? "require" : undefined, prepare: false });
    globalThis.__envelopeDb = { db: drizzle(sql, { schema }), sql };
  }
  return globalThis.__envelopeDb.db;
}

export async function closeDriver() {
  if (globalThis.__envelopeDb) {
    await globalThis.__envelopeDb.sql.end({ timeout: 5 });
    globalThis.__envelopeDb = undefined;
  }
}
