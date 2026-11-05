/**
 * Serverless-safe simulated PayPal. On hosts where consecutive requests may land on different
 * instances (Vercel), the emulator's in-memory state would be lost between "create order" and
 * "approve". With KEPT_EMULATOR_PERSIST=1, each emulator use loads the state from Postgres and
 * saves it back, under an advisory lock so two requests never interleave. Nested uses inside one
 * scope (e.g. delivering events that call PayPal again) run directly.
 * Simulated mode only; the real PayPal client never touches this.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { emulatorState } from "../db/schema";

const scope = new AsyncLocalStorage<true>();

export function emulatorPersistenceEnabled(): boolean {
  return process.env.KEPT_EMULATOR_PERSIST === "1";
}

type Serial = Record<string, unknown>;

function toSerial(s: Record<string, unknown>): Serial {
  const out: Serial = {};
  for (const [k, v] of Object.entries(s)) out[k] = v instanceof Map ? { __map: [...v.entries()] } : v;
  return out;
}
function fromSerial(s: Serial): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) out[k] = v && typeof v === "object" && "__map" in (v as object) ? new Map((v as { __map: [string, unknown][] }).__map) : v;
  return out;
}

/** Run `fn` with the emulator state loaded from, and saved back to, the database. */
export async function withEmulatorState<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!emulatorPersistenceEnabled() || scope.getStore()) return fn();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('kept-emulator-state', 0))`);
    const row = await tx.query.emulatorState.findFirst({ where: eq(emulatorState.id, "default") });
    (globalThis as { __keptPayPalEmulator?: unknown }).__keptPayPalEmulator = row ? fromSerial(row.state) : undefined;
    const result = await scope.run(true, fn);
    const current = (globalThis as { __keptPayPalEmulator?: Record<string, unknown> }).__keptPayPalEmulator;
    if (current) {
      const state = toSerial(current);
      await tx.insert(emulatorState).values({ id: "default", state, updatedAt: new Date() })
        .onConflictDoUpdate({ target: emulatorState.id, set: { state, updatedAt: new Date() } });
    }
    return result;
  });
}
