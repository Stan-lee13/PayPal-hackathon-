import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __keptDb: { db: DB; sql: postgres.Sql } | undefined;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  return url;
}

/** Single shared connection pool per process (survives Next.js dev hot reloads). */
export function getDb(): DB {
  if (!globalThis.__keptDb) {
    const url = databaseUrl();
    const needsSsl = /sslmode=require|neon\.tech/.test(url);
    const sql = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 5), ssl: needsSsl ? "require" : undefined, prepare: false });
    globalThis.__keptDb = { db: drizzle(sql, { schema }), sql };
  }
  return globalThis.__keptDb.db;
}

export async function closeDb() {
  if (globalThis.__keptDb) {
    await globalThis.__keptDb.sql.end({ timeout: 5 });
    globalThis.__keptDb = undefined;
  }
}

export { schema };
