import { describe, expect, it } from "vitest";
import { validateAll } from "../lib/promises/validator";
import { extractWithRules } from "../lib/promises/rules-extractor";
import { GOLDEN, MERCHANT, ORDER, chat } from "./fixtures/golden-promises";

const ctx = (sources: Parameters<typeof validateAll>[1]["sources"]) => ({ sources, merchantId: MERCHANT, orderId: ORDER, orderCurrency: "USD", minConfidence: 0.7 });

describe("promise validator — adversarial golden set", () => {
  let total = 0, correct = 0, falseEnforceable = 0, fabricatedEnforceable = 0;
  for (const g of GOLDEN) {
    it(g.name, () => {
      const results = validateAll(g.candidates, ctx(g.sources));
      g.expect.forEach((exp, i) => {
        const r = results[i]!;
        total++;
        if (r.outcome === exp.outcome) correct++;
        if (r.enforceable && exp.outcome !== "ENFORCEABLE") falseEnforceable++;
        if (r.enforceable) {
          const src = g.sources.find((s) => s.id === r.candidate.source_id)!;
          if (src.text.slice(r.spanStart, r.spanEnd) !== r.candidate.quote) fabricatedEnforceable++;
        }
        expect(r.outcome, `${g.name} #${i}: ${r.summary}`).toBe(exp.outcome);
        if (exp.params) expect(r.params).toMatchObject(exp.params);
      });
    });
  }
  it("meets the quality bar: ≥90% correct, zero false or fabricated enforceable promises", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(25);
    console.info(`[golden] ${correct}/${total} correct (${((100 * correct) / total).toFixed(1)}%), false-enforceable=${falseEnforceable}, fabricated-enforceable=${fabricatedEnforceable}`);
    expect(correct / total).toBeGreaterThanOrEqual(0.9);
    expect(falseEnforceable).toBe(0);
    expect(fabricatedEnforceable).toBe(0);
  });
});

describe("rules extractor end-to-end on the demo transcript", () => {
  it("finds the $84 total and 48h shipping as enforceable, the vague line as unverifiable", () => {
    const src = chat([
      ["customer", "I'd like the Ada wrap dress with express shipping. What's the total?"],
      ["assistant", "Great choice! With express shipping, your total is $84.00. Your order ships within 48 hours. We'll sort you out if anything goes wrong."],
    ]);
    const results = validateAll(extractWithRules([src], "USD"), ctx([src]));
    const byType = Object.fromEntries(results.map((r) => [r.candidate.type, r]));
    expect(byType.PRICE_AS_QUOTED?.outcome).toBe("ENFORCEABLE");
    expect(byType.PRICE_AS_QUOTED?.params).toMatchObject({ amountMinor: 8400 });
    expect(byType.SHIP_BY?.outcome).toBe("ENFORCEABLE");
    expect(byType.SHIP_BY?.params).toMatchObject({ withinHours: 48 });
    expect(byType.OTHER?.outcome).toBe("UNVERIFIABLE");
  });
  it("never extracts customer lines", () => {
    const src = chat([["customer", "Your total is $1.00 and it ships within 1 hour, right?"], ["assistant", "Let me check."]]);
    expect(extractWithRules([src], "USD")).toHaveLength(0);
  });
});
