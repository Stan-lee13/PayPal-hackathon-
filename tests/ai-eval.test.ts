/**
 * Checks the PREMISES of the AI-vs-rules evaluation, deterministically, before any model runs:
 * every "beyond-rules" promise is accepted by the validator when extracted correctly, the rules
 * extractor really misses it, controls are found by rules, and every trap is blocked.
 * The live comparison with Claude is `npm run eval:ai` (needs ANTHROPIC_API_KEY).
 */
import { describe, expect, it } from "vitest";
import { extractWithRules } from "../lib/promises/rules-extractor";
import { validateAll } from "../lib/promises/validator";
import { AI_EVAL, evalCtx, oracleCandidates, scoreCase } from "./fixtures/ai-eval";

describe("AI-vs-rules evaluation premises", () => {
  for (const c of AI_EVAL) {
    it(`${c.kind} · ${c.lang} · ${c.name}`, () => {
      const rules = scoreCase(c, validateAll(extractWithRules(c.sources, "USD"), evalCtx(c.sources)));
      expect(rules.falseEnforceable, "rules must never create a false enforceable promise").toBe(0);
      if (c.kind === "trap") {
        const careless = validateAll(c.careless!(c.sources), evalCtx(c.sources));
        expect(careless.filter((v) => v.enforceable).map((v) => v.candidate.quote), "careless candidates must be blocked").toEqual([]);
        return;
      }
      const ceiling = scoreCase(c, validateAll(oracleCandidates(c), evalCtx(c.sources)));
      expect(ceiling, "a correct extraction must pass the validator").toMatchObject({ found: c.oracle.length, falseEnforceable: 0 });
      if (c.kind === "control") expect(rules.missed, "rules should find controls").toBe(0);
      else expect(rules.missed, "the premise: rules miss this").toBeGreaterThan(0);
    });
  }
});
