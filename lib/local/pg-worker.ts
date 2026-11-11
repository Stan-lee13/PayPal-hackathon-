/// <reference lib="webworker" />
/**
 * The in-browser database: PGlite (Postgres compiled to WebAssembly), persisted in IndexedDB and
 * shared by every open tab through leader election. The schema is created from the same migration
 * files the server uses.
 */
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";
import init0 from "../../drizzle/0000_init.sql";
import init1 from "../../drizzle/0001_clumsy_gamora.sql";
import init2 from "../../drizzle/0002_loud_infant_terrible.sql";

/** Bump when a migration is added: visitors then start from a fresh database. */
const STORE = "idb://envelope-gateway-v3";

void worker({
  async init() {
    const pg = new PGlite(STORE);
    const seen = await pg.query<{ t: string | null }>("select to_regclass('public.roots')::text as t");
    if (!seen.rows[0]?.t) await pg.exec([init0, init1, init2].join("\n").replaceAll("--> statement-breakpoint", ""));
    return pg;
  },
});
