/**
 * Browser driver: Postgres in WebAssembly (PGlite), one database kept in IndexedDB and shared by
 * every tab of this site. Used only when the site has no server database.
 *
 * One of the open tabs holds the database in its worker (lib/local/pg-worker.ts) and the others
 * send it their statements. The class below is PGlite's multi-tab client with two changes, both so
 * that a tab closing or reloading can never leave the others waiting:
 *   - its turn at the database is a Web Lock, which the browser gives back when the tab goes away;
 *   - it waits to be connected to the current holder before sending anything, where the stock client
 *     posts into a channel nobody is listening on yet and then waits for an answer that cannot come.
 * The holder saves to IndexedDB itself when a write has finished, so this client does not ask it to
 * after every query. Nor does it make the three calls about file imports and exports (COPY to or from
 * a blob) that the stock client makes around every query: nothing here uses them, and one of them is
 * sent without checking the connection, which is how a query could be left waiting for good after
 * the database moved to another tab.
 */
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { drizzle } from "drizzle-orm/pglite";
import { inTurn, TRANSACTION_LOCK } from "../local/locks";
import * as schema from "./schema";

class SharedDatabase extends PGliteWorker {
  #oneQuery = inTurn();

  override _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return navigator.locks.request(TRANSACTION_LOCK, fn) as Promise<T>;
  }
  /** Statements inside one transaction go one at a time; only this tab can be inside it, so no shared lock is needed. */
  override _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    return this.#oneQuery(fn);
  }
  override async execProtocol(message: Uint8Array) { await this.waitReady; return super.execProtocol(message); }
  override async execProtocolStream(message: Uint8Array) { await this.waitReady; return super.execProtocolStream(message); }
  override async execProtocolRaw(message: Uint8Array) { await this.waitReady; return super.execProtocolRaw(message); }
  override async execProtocolRawStream(message: Uint8Array, options: { onRawData: (data: Uint8Array) => void }) { await this.waitReady; return super.execProtocolRawStream(message, options); }
  override async dumpDataDir(compression?: Parameters<PGliteWorker["dumpDataDir"]>[0]) { await this.waitReady; return super.dumpDataDir(compression); }
  override async syncToFs() { /* saved by the holder: lib/local/pg-worker.ts */ }
  override async _handleBlob() { /* nothing is ever read from a blob */ }
  override async _getWrittenBlob() { return undefined; }
  override async _cleanupBlob() { /* nothing is ever written to a blob */ }
}

type LocalDb = ReturnType<typeof drizzle<typeof schema>>;
let db: LocalDb | null = null;
let booting: Promise<void> | null = null;
let moves = 0;

/** Start (or join) the in-browser database. Must finish before any gateway code runs. */
export function bootDriver(): Promise<void> {
  booting ??= (async () => {
    const pg = new SharedDatabase(new Worker(new URL("../local/pg-worker.ts", import.meta.url), { type: "module" }), { id: "envelope-gateway" });
    pg.onLeaderChange(() => { moves++; });
    await pg.waitReady;
    db = drizzle(pg as never, { schema });
  })();
  return booting;
}

/**
 * How many times the database has moved to another tab's worker (the tab that held it closed or
 * reloaded). A request that was running across a move fails; the caller compares this before and after.
 */
export const databaseMoves = (): number => moves;

export function openDriver(): LocalDb {
  if (!db) throw new Error("The in-browser gateway has not started yet.");
  return db;
}

export async function closeDriver() { /* the worker lives as long as a tab is open */ }
