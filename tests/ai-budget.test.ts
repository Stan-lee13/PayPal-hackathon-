/**
 * The capped hybrid: Claude only where the rules can't settle a promise, never past the daily
 * spend cap, and never twice for the same inputs. No API key is used — calls are stubbed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import { extractWithRules } from "../lib/promises/rules-extractor";
import { uncoveredByRules } from "../lib/promises/routing";
import { costMicroUsd } from "../lib/ai/budget";
import { AI_EVAL } from "./fixtures/ai-eval";
import { chat } from "./fixtures/golden-promises";

const enabled = useTestEnv();

describe("routing: rules first, Claude only for what they can't settle", () => {
  for (const c of AI_EVAL.filter((x) => x.kind !== "trap")) {
    it(`${c.kind} · ${c.name}`, () => {
      const gaps = uncoveredByRules(c.sources, extractWithRules(c.sources, "USD"));
      if (c.kind === "beyond-rules") expect(gaps.length, "the model should be asked").toBeGreaterThan(0);
      else expect(gaps, "rules suffice; no model call").toEqual([]);
    });
  }
  it("customer lines never trigger a model call", () => {
    const src = chat([["customer", "Will it ship within 2 days for $84 total?"], ["assistant", "Great choice."]]);
    expect(uncoveredByRules([src], extractWithRules([src], "USD"))).toEqual([]);
  });
});

describe("pricing (integer micro-USD)", () => {
  it("prices a typical assistant turn on Opus 5.5 and Haiku 5.5", () => {
    expect(costMicroUsd("claude-opus-5-5", { input_tokens: 2000, output_tokens: 300 })).toBe(14_000); // $0.014
    expect(costMicroUsd("claude-haiku-5-5", { input_tokens: 2000, output_tokens: 300 })).toBe(350);   // $0.00035
    expect(costMicroUsd("unknown-model", { input_tokens: 1000, output_tokens: 0 })).toBe(10_000);      // priced conservatively
  });
});

const d = enabled ? describe : describe.skip;
d("daily cap and cache (database)", () => {
  beforeEach(async () => {
    const { getDb } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`truncate table ai_usage, ai_cache restart identity`);
  });

  it("records what each call cost, and refuses to call once the cap is reached", async () => {
    process.env.KEPT_AI_DAILY_BUDGET_USD = "0.02";
    const { guarded, spentTodayUsd, AiBudgetExceeded } = await import("../lib/ai/budget");
    let calls = 0;
    const fake = async () => { calls++; return { model: "claude-opus-5-5", usage: { input_tokens: 2000, output_tokens: 300 } }; };
    await guarded("assistant", "claude-opus-5-5", fake);
    expect(await spentTodayUsd()).toBeCloseTo(0.014, 6);
    await guarded("assistant", "claude-opus-5-5", fake); // $0.028 now — over the $0.02 cap
    await expect(guarded("assistant", "claude-opus-5-5", fake)).rejects.toBeInstanceOf(AiBudgetExceeded);
    expect(calls).toBe(2); // the third call never reached the model
    delete process.env.KEPT_AI_DAILY_BUDGET_USD;
  });

  it("prices by the model that actually served the call (e.g. after a fallback)", async () => {
    const { guarded } = await import("../lib/ai/budget");
    const { getDb } = await import("../lib/db");
    const { aiUsage } = await import("../lib/db/schema");
    await guarded("extraction", "claude-opus-5-5", async () => ({ model: "claude-haiku-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } }));
    const [row] = await getDb().select().from(aiUsage);
    expect(row).toMatchObject({ model: "claude-haiku-5-5", costMicroUsd: 100_000 });
  });

  it("the same inputs are answered from the cache, without a second call", async () => {
    const { cachedAi } = await import("../lib/ai/budget");
    let calls = 0;
    const compute = async () => { calls++; return "Your total is $84.00."; };
    const a = await cachedAi("assistant_reply", { cart: [["prd_ada_dress", 1]], message: "total?" }, compute);
    const b = await cachedAi("assistant_reply", { message: "total?", cart: [["prd_ada_dress", 1]] }, compute); // key order doesn't matter
    const c = await cachedAi("assistant_reply", { cart: [["prd_ada_dress", 2]], message: "total?" }, compute);
    expect([a.hit, b.hit, c.hit]).toEqual([false, true, false]);
    expect(b.value).toBe("Your total is $84.00.");
    expect(calls).toBe(2);
  });
});
