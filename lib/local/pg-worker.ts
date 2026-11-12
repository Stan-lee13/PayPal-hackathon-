/// <reference lib="webworker" />
/**
 * The in-browser database: PGlite (Postgres compiled to WebAssembly), persisted in IndexedDB and
 * shared by every open tab. Each tab starts this worker; the browser picks one of them (by a Web
 * Lock) to hold the database, and the others send it their statements. When the holder's tab goes
 * away another worker takes over. The schema is created from the same migration files the server uses.
 *
 * This file serves the wire protocol that PGlite's own multi-tab client (`PGliteWorker`) speaks, in
 * place of the `worker()` helper that ships with PGlite 0.5, because that helper loses the database
 * for every tab in two cases a visitor with two tabs hits easily:
 *   - a tab that closed or reloaded while waiting its turn was still given the lock later, and never
 *     gave it back;
 *   - a tab that went away inside a transaction left it open, and the next tab's COMMIT then
 *     committed the abandoned half as well.
 * Here the locks are the browser's (lib/local/locks.ts), and a transaction left behind by a tab that
 * is gone is rolled back before anyone else's statement runs.
 *
 * It also saves less often. The stock helper writes the database files to IndexedDB after every
 * protocol message, about six times for one query, reads included. Here they are saved once, when a
 * statement or transaction that wrote something has finished, and before its tab is told so. What is
 * on disk after a tab closes is the same; a page with two tabs open is several times faster.
 */
import { PGlite } from "@electric-sql/pglite";
import { hold, inTurn, TRANSACTION_LOCK } from "./locks";
import init0 from "../../drizzle/0000_init.sql";
import init1 from "../../drizzle/0001_clumsy_gamora.sql";
import init2 from "../../drizzle/0002_loud_infant_terrible.sql";
import init3 from "../../drizzle/0003_calm_earthquake.sql";
import init4 from "../../drizzle/0004_short_blizzard.sql";
import init5 from "../../drizzle/0005_lumpy_christian_walker.sql";
import init6 from "../../drizzle/0006_handy_slipstream.sql";
import init7 from "../../drizzle/0007_quiet_vulture.sql";
import init8 from "../../drizzle/0008_material_gravity.sql";

/** Bump when a migration is added: visitors then start from a fresh database. */
const STORE = "idb://envelope-gateway-v9";

async function open(): Promise<PGlite> {
  const pg = new PGlite(STORE);
  const seen = await pg.query<{ t: string | null }>("select to_regclass('public.roots')::text as t");
  if (!seen.rows[0]?.t) await pg.exec([init0, init1, init2, init3, init4, init5, init6, init7, init8].join("\n").replaceAll("--> statement-breakpoint", ""));
  return pg;
}

// ---- Postgres wire messages this file sends on its own account
const SYNC = new Uint8Array([0x53, 0, 0, 0, 4]);
const ROLLBACK = (() => {
  const sql = new TextEncoder().encode("ROLLBACK\0");
  const m = new Uint8Array(5 + sql.length);
  m[0] = 0x51; // Query
  new DataView(m.buffer).setUint32(1, 4 + sql.length);
  m.set(sql, 5);
  return m;
})();

type Message = { name?: string; status?: string; text?: string };
/** Postgres ends every exchange with ReadyForQuery and says whether a transaction is open: I(dle), T(ransaction) or E(rror). */
const lastStatus = (messages: Message[]): string | null => {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.name === "readyForQuery") return messages[i]!.status ?? null;
  return null;
};
const lastStatusRaw = (b: Uint8Array): string | null => {
  const n = b.length;
  return n >= 6 && b[n - 6] === 0x5a && b[n - 5] === 0 && b[n - 4] === 0 && b[n - 3] === 0 && b[n - 2] === 5 ? String.fromCharCode(b[n - 1]!) : null;
};
/** Postgres names each finished command. These change nothing that has to reach the disk. */
const READ_ONLY = /^(SELECT|BEGIN|COMMIT|ROLLBACK|SHOW|SET)\b/;
const wrote = (messages: Message[]): boolean => messages.some((m) => m?.name === "commandComplete" && !READ_ONLY.test(m.text ?? ""));
/** A view into the WebAssembly memory cannot be posted as it is: copy the bytes out. */
const own = (b: Uint8Array): Uint8Array => (b.byteLength === b.buffer.byteLength ? b : new Uint8Array(b));

const oneAtATime = inTurn();
/** The tab whose last statement left a transaction, or a half-sent query, open on the one connection there is. */
let unfinished: string | null = null;
/** Something has been written since the files were last saved to IndexedDB. */
let unsaved = false;
const NO_SAVE = { syncToFs: false } as const;

async function save(db: PGlite) {
  if (!unsaved) return;
  unsaved = false;
  await db.syncToFs();
}

/** Close whatever a tab that is gone left open, so the next statement starts clean. */
async function abandon(db: PGlite) {
  unfinished = null;
  await db.execProtocol(SYNC, { throwOnError: false, ...NO_SAVE }).catch(() => undefined);
  await db.execProtocol(ROLLBACK, { throwOnError: false, ...NO_SAVE }).catch(() => undefined);
}

function callsFor(tabId: string, db: PGlite) {
  let gone = false;
  const held = new Map<string, () => void>();

  // This lock is the tab's own for as long as it lives, so getting it here means the tab is gone.
  void hold(`pglite-tab-close:${tabId}`).then((release) => {
    release();
    gone = true;
    for (const giveBack of held.values()) giveBack();
    held.clear();
    void oneAtATime(async () => { if (unfinished === tabId) await abandon(db); });
  });

  /**
   * Whether this tab is the one inside the transaction lock right now. A statement a tab posted just
   * before it went away can arrive after the next tab has started; it must not run in that tab's transaction.
   */
  const hasTheTurn = async (): Promise<boolean> => {
    if (held.has("transaction")) return true;
    const locks = (await navigator.locks.query()).held ?? [];
    const turn = locks.find((l) => l.name === TRANSACTION_LOCK)?.clientId;
    const tab = locks.find((l) => l.name === `pglite-tab-close:${tabId}`)?.clientId;
    return Boolean(turn && tab && turn === tab);
  };

  /** Run one protocol message for this tab, note whether it left anything open, and save what a finished write changed. */
  const send = <R>(work: () => Promise<R>, read: (r: R) => { status: string | null; wrote: boolean }): Promise<R> => oneAtATime(async () => {
    if (unfinished !== tabId) {
      if (gone || !(await hasTheTurn())) throw new Error("This tab is not the one whose turn it is at the in-browser database.");
      // Only one tab can be inside the transaction lock, so whatever a different tab left open was abandoned.
      if (unfinished) await abandon(db);
    }
    unfinished = tabId; // stays so if the statement fails: the client's closing Sync reports the true state
    let r: R;
    try { r = await work(); } catch (e) { unsaved = true; throw e; }
    const seen = read(r);
    if (seen.wrote) unsaved = true;
    if (seen.status) unfinished = seen.status === "I" ? null : tabId;
    if (seen.status === "I") await save(db);
    return r;
  });
  const readMessages = (messages: unknown) => ({ status: lastStatus(messages as Message[]), wrote: wrote(messages as Message[]) });

  // The stock PGliteWorker client asks the holder for its locks; ours (lib/db/driver.browser.ts) takes the same Web Lock itself.
  const acquire = async (name: string, lock: string) => {
    const giveBack = await hold(lock);
    if (gone) giveBack(); else held.set(name, giveBack);
  };
  const release = (name: string) => { held.get(name)?.(); held.delete(name); };

  return {
    getDebugLevel: async () => db.debug,
    close: async () => undefined, // one tab leaving does not close the database for the others
    execProtocol: (message: Uint8Array) => send(async () => { const r = await db.execProtocol(message, NO_SAVE); return { messages: r.messages, data: own(r.data) }; }, (r) => readMessages(r.messages)),
    execProtocolStream: (message: Uint8Array) => send(() => db.execProtocolStream(message, NO_SAVE), readMessages),
    execProtocolRaw: (message: Uint8Array) => send(async () => own(await db.execProtocolRaw(message, NO_SAVE)), (r) => ({ status: lastStatusRaw(r), wrote: true })),
    syncToFs: () => oneAtATime(() => save(db)),
    dumpDataDir: (compression?: Parameters<PGlite["dumpDataDir"]>[0]) => db.dumpDataDir(compression),
    _handleBlob: (blob?: File | Blob) => db._handleBlob(blob),
    _getWrittenBlob: () => db._getWrittenBlob(),
    _cleanupBlob: () => db._cleanupBlob(),
    _checkReady: () => db._checkReady(),
    _acquireTransactionLock: () => acquire("transaction", TRANSACTION_LOCK),
    _releaseTransactionLock: async () => release("transaction"),
    _acquireQueryLock: () => acquire("query", `envelope-gateway:query:${tabId}`),
    _releaseQueryLock: async () => release("query"),
  };
}

function connect(tabId: string, db: PGlite, connected: Set<string>) {
  if (connected.has(tabId)) return;
  connected.add(tabId);
  const channel = new BroadcastChannel(`pglite-tab:${tabId}`);
  const calls = callsFor(tabId, db) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  void hold(`pglite-tab-close:${tabId}`).then((release) => { release(); channel.close(); connected.delete(tabId); });

  channel.addEventListener("message", async (event) => {
    const msg = event.data as { type?: string; callId?: string; method?: string; args?: unknown[] };
    if (msg?.type !== "rpc-call" || !msg.callId || !msg.method) return;
    let answer: unknown;
    try {
      const call = Object.hasOwn(calls, msg.method) ? calls[msg.method] : undefined;
      if (!call) throw new Error(`The in-browser database has no call named ${msg.method}.`);
      answer = { type: "rpc-return", callId: msg.callId, result: await call(...(msg.args ?? [])) };
    } catch (e) {
      const err = e as { message?: string; code?: string; detail?: string; constraint?: string };
      answer = { type: "rpc-error", callId: msg.callId, error: { message: err?.message ?? String(e), code: err?.code, detail: err?.detail, constraint: err?.constraint } };
    }
    try { channel.postMessage(answer); } catch { /* the tab that asked has gone, and its channel with it */ }
  });
  channel.postMessage({ type: "connected" });
}

async function serve() {
  postMessage({ type: "here" });
  const options = await new Promise<{ id?: string }>((resolve) => {
    const onInit = (event: MessageEvent) => {
      if (event.data?.type !== "init") return;
      removeEventListener("message", onInit);
      resolve(event.data.options ?? {});
    };
    addEventListener("message", onInit);
  });
  const id = options.id ?? "envelope-gateway";
  postMessage({ type: "ready", id });

  const everyone = new BroadcastChannel(`pglite-broadcast:${id}`);
  // Whoever gets this lock holds the database. It is never given back: the browser passes it on when this worker goes away.
  await hold(`pglite-election-lock:${id}`);
  const ready = open();
  const connected = new Set<string>();
  everyone.onmessage = async (event) => {
    if (event.data?.type === "tab-here" && typeof event.data.id === "string") connect(event.data.id, await ready, connected);
  };
  everyone.postMessage({ type: "leader-here", id });
  postMessage({ type: "leader-now" });
  const db = await ready;
  db.onNotification((channel, payload) => everyone.postMessage({ type: "notify", channel, payload }));
}

void serve();
