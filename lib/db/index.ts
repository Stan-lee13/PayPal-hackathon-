/**
 * The gateway's database. On a server this is Postgres (./driver.ts). In a browser tab, when the
 * site has no server database, the build swaps in ./driver.browser.ts: the same schema and the same
 * SQL on Postgres compiled to WebAssembly (PGlite), stored in the visitor's own browser.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { closeDriver, openDriver } from "./driver";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export const getDb = (): DB => openDriver() as DB;
export const closeDb = (): Promise<void> => closeDriver();
export { schema };
