/**
 * Browser driver: Postgres in WebAssembly (PGlite) running in a shared worker, so every tab of this
 * site talks to one database kept in IndexedDB. Used only when the site has no server database.
 */
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

type LocalDb = ReturnType<typeof drizzle<typeof schema>>;
let db: LocalDb | null = null;
let booting: Promise<void> | null = null;

/** Start (or join) the in-browser database. Must finish before any gateway code runs. */
export function bootDriver(): Promise<void> {
  booting ??= (async () => {
    const pg = new PGliteWorker(new Worker(new URL("../local/pg-worker.ts", import.meta.url), { type: "module" }), { id: "envelope-gateway" });
    await pg.waitReady;
    db = drizzle(pg as never, { schema });
  })();
  return booting;
}

export function openDriver(): LocalDb {
  if (!db) throw new Error("The in-browser gateway has not started yet.");
  return db;
}

export async function closeDriver() { /* the worker lives as long as a tab is open */ }
