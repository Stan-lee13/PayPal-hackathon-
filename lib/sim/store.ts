/**
 * State for the built-in PayPal simulator (used only when real credentials are absent;
 * every page says so). It keeps one plain JSON object on globalThis.
 *
 * Serverless hosts (Vercel) may serve consecutive requests from different instances, which would
 * lose in-memory state between "authorize" and "capture". With ENVELOPE_SIM_PERSIST=1, each
 * simulator use loads the state from Postgres and saves it back, under an advisory lock so two
 * requests never interleave. Nested uses inside one scope run directly.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { emulatorState } from "../db/schema";

const scope = new AsyncLocalStorage<true>();

export type SimKey = "paypal";
type Holder = { __envelopeSim?: Partial<Record<SimKey, unknown>> };

export function simPersistenceEnabled(): boolean {
  return process.env.ENVELOPE_SIM_PERSIST === "1";
}

/** The simulator's state object, created by `init` on first use. Mutate it in place. */
export function simState<T>(key: SimKey, init: () => T): T {
  const g = globalThis as Holder;
  g.__envelopeSim ??= {};
  if (g.__envelopeSim[key] === undefined) g.__envelopeSim[key] = init();
  return g.__envelopeSim[key] as T;
}

/** Forget all simulator state in this process (tests; "a different serverless instance"). */
export function resetSimMemory() {
  (globalThis as Holder).__envelopeSim = undefined;
}

/** Run `fn` with simulator state loaded from, and saved back to, the database. */
export async function withSimState<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!simPersistenceEnabled() || scope.getStore()) return fn();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('envelope-sim-state', 0))`);
    const row = await tx.query.emulatorState.findFirst({ where: eq(emulatorState.id, "default") });
    (globalThis as Holder).__envelopeSim = row ? (structuredClone(row.state) as Holder["__envelopeSim"]) : undefined;
    const result = await scope.run(true, fn);
    const current = (globalThis as Holder).__envelopeSim;
    if (current) {
      const state = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
      await tx.insert(emulatorState).values({ id: "default", state, updatedAt: new Date() })
        .onConflictDoUpdate({ target: emulatorState.id, set: { state, updatedAt: new Date() } });
    }
    return result;
  });
}
