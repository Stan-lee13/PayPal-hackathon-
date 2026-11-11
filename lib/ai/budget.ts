/**
 * Keeps Claude affordable for a public demo, without hiding it:
 *  - a hard DAILY spend cap (ENVELOPE_AI_DAILY_BUDGET_USD, default $2): over it, calls are not made and
 *    every caller falls back to its labelled deterministic path;
 *  - per-call usage and cost recorded from the API's own `usage` (priced by the model that served it);
 *  - a response cache, so a repeated demo conversation or extraction costs nothing.
 * Prices: USD per million tokens (Claude API list prices as of Nov 2026).
 */
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiCache, aiUsage } from "../db/schema";
import { canonicalJson } from "../ledger/chain";

export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
};
const UNKNOWN_PRICE = { input: 10, output: 50, cacheRead: 1 }; // unknown models are priced conservatively

export function dailyBudgetUsd(): number {
  const v = Number(process.env.ENVELOPE_AI_DAILY_BUDGET_USD ?? "2");
  return Number.isFinite(v) && v >= 0 ? v : 2;
}

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** Cost in micro-USD (integers: no float money, even for fractions of a cent). */
export function costMicroUsd(model: string, u: Usage): number {
  const p = PRICE_PER_MTOK[model] ?? UNKNOWN_PRICE;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25;
  return Math.ceil(input * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead);
}

export class AiBudgetExceeded extends Error {
  constructor(public readonly spentUsd: number, public readonly budgetUsd: number) {
    super(`Daily AI budget reached ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}); using the deterministic path.`);
  }
}

function startOfUtcDay() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; }

export async function spentTodayUsd(): Promise<number> {
  const [r] = await getDb().select({ micro: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` }).from(aiUsage).where(gte(aiUsage.createdAt, startOfUtcDay()));
  return Number(r?.micro ?? 0) / 1_000_000;
}

/** Run one Claude call under the cap; record what it actually cost. */
export async function guarded<T extends { usage?: Usage | null; model?: string }>(purpose: string, model: string, call: () => Promise<T>): Promise<T> {
  const budget = dailyBudgetUsd();
  const spent = await spentTodayUsd();
  if (spent >= budget) throw new AiBudgetExceeded(spent, budget);
  const res = await call();
  const served = typeof res.model === "string" ? res.model : model;
  const u = res.usage ?? {};
  await getDb().insert(aiUsage).values({
    purpose, model: served, inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0, costMicroUsd: costMicroUsd(served, u),
  });
  return res;
}

/** Memoise a whole AI result by its exact inputs (purpose + canonical JSON of the key parts). */
export async function cachedAi<T>(purpose: string, keyParts: unknown, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const key = createHash("sha256").update(`${purpose}|${canonicalJson(keyParts)}`).digest("hex");
  const db = getDb();
  const row = await db.query.aiCache.findFirst({ where: and(eq(aiCache.key, key), eq(aiCache.purpose, purpose)) });
  if (row) return { value: (row.value as { v: T }).v, hit: true };
  const value = await compute();
  await db.insert(aiCache).values({ key, purpose, value: { v: value } as unknown as Record<string, unknown> }).onConflictDoNothing();
  return { value, hit: false };
}
