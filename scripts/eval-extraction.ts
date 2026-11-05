/**
 * Runs the REAL Claude extractor over the golden-set sources and scores the
 * validated result (the unit test scores the validator on fixed candidates).
 * Requires ANTHROPIC_API_KEY. Costs a few cents per run.
 */
import { loadEnv } from "./env";
loadEnv();
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for this eval.");
const { GOLDEN } = await import("../tests/fixtures/golden-promises");
const { extractWithLlm } = await import("../lib/promises/llm-extractor");
const { validateAll } = await import("../lib/promises/validator");
let cases = 0, ok = 0, falseEnforceable = 0;
for (const g of GOLDEN) {
  const expectedEnforceable = g.expect.filter((e) => e.outcome === "ENFORCEABLE").map((e) => JSON.stringify(e.params));
  const cands = await extractWithLlm(g.sources, { orderCurrency: "USD", orderCreatedAt: new Date().toISOString(), orderSummary: "golden" });
  const v = validateAll(cands, { sources: g.sources, merchantId: "mer_test", orderId: "ko_test", orderCurrency: "USD", minConfidence: 0.7 });
  const got = v.filter((x) => x.enforceable).map((x) => x.params);
  const fe = got.filter((p) => !expectedEnforceable.some((e) => Object.entries(JSON.parse(e ?? "{}")).every(([k, val]) => (p as Record<string, unknown>)[k] === val))).length;
  const missing = expectedEnforceable.length - (got.length - fe);
  cases++;
  if (fe === 0 && missing === 0) ok++;
  falseEnforceable += fe;
  console.log(`${fe === 0 && missing === 0 ? "✓" : "✕"} ${g.name}: enforceable ${got.length} (false ${fe}, missing ${Math.max(0, missing)})`);
}
console.log(`\nLLM end-to-end: ${ok}/${cases} cases exact; false enforceable promises: ${falseEnforceable}`);
