/**
 * AI-vs-rules extraction evaluation (tests/fixtures/ai-eval.ts).
 * Runs the rules extractor and — when ANTHROPIC_API_KEY is set — the real Claude extractor over
 * the same cases, through the SAME validator, and reports recall on real promises and false
 * enforceable promises on traps. Writes docs/evidence/ai-eval-results.json.
 *   npm run eval:ai            (rules + Claude if a key is configured)
 */
import fs from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { AI_EVAL, evalCtx, oracleCandidates, scoreCase } = await import("../tests/fixtures/ai-eval");
const { extractWithRules } = await import("../lib/promises/rules-extractor");
const { validateAll } = await import("../lib/promises/validator");
const { aiConfigured, aiModel } = await import("../lib/ai/client");
const { extractWithLlm } = await import("../lib/promises/llm-extractor");

type Score = ReturnType<typeof scoreCase>;
const runClaude = aiConfigured();
const rows: Array<{ name: string; kind: string; lang: string; ceiling: Score; rules: Score; claude: Score | null; claudeError?: string }> = [];

for (const c of AI_EVAL) {
  const ceiling = scoreCase(c, validateAll(c.kind === "trap" ? c.careless!(c.sources) : oracleCandidates(c), evalCtx(c.sources)));
  const rules = scoreCase(c, validateAll(extractWithRules(c.sources, "USD"), evalCtx(c.sources)));
  let claude: Score | null = null; let claudeError: string | undefined;
  if (runClaude) {
    try { claude = scoreCase(c, validateAll(await extractWithLlm(c.sources, { orderCurrency: "USD", orderCreatedAt: "2026-11-05T10:00:00Z", orderSummary: "1 × Ada Wrap Dress, express" }), evalCtx(c.sources))); }
    catch (e) { claudeError = String(e).slice(0, 200); }
  }
  rows.push({ name: c.name, kind: c.kind, lang: c.lang, ceiling, rules, claude, claudeError });
}

const total = (pick: (r: (typeof rows)[number]) => Score | null, kinds: string[]) => {
  const s = rows.filter((r) => kinds.includes(r.kind)).map(pick).filter((x): x is Score => x !== null);
  return { expected: s.reduce((a, x) => a + x.expected, 0), found: s.reduce((a, x) => a + x.found, 0), falseEnforceable: s.reduce((a, x) => a + x.falseEnforceable, 0), cases: s.length };
};
const summary = {
  ranAt: new Date().toISOString(),
  claude: runClaude ? { model: aiModel(), ran: true } : { ran: false, why: "ANTHROPIC_API_KEY not configured" },
  validatorCeiling: total((r) => r.ceiling, ["beyond-rules", "control"]),
  rules: { beyondRules: total((r) => r.rules, ["beyond-rules"]), controls: total((r) => r.rules, ["control"]), falseEnforceableOnTraps: total((r) => r.rules, ["trap"]).falseEnforceable },
  claudeResult: runClaude ? { beyondRules: total((r) => r.claude, ["beyond-rules"]), controls: total((r) => r.claude, ["control"]), falseEnforceableOnTraps: total((r) => r.claude, ["trap"]).falseEnforceable, errors: rows.filter((r) => r.claudeError).length } : null,
  carelessCandidatesBlockedOnTraps: total((r) => r.ceiling, ["trap"]).falseEnforceable === 0,
};
fs.writeFileSync("docs/evidence/ai-eval-results.json", JSON.stringify({ summary, cases: rows }, null, 2) + "\n");

const f = (s: Score | null) => (s ? `${s.found}/${s.expected}${s.falseEnforceable ? ` ✕${s.falseEnforceable} false` : ""}` : "—");
console.log("case".padEnd(52), "kind".padEnd(13), "ceiling".padEnd(9), "rules".padEnd(14), "claude");
for (const r of rows) console.log(`${r.name.slice(0, 51).padEnd(52)} ${r.kind.padEnd(13)} ${f(r.ceiling).padEnd(9)} ${f(r.rules).padEnd(14)} ${r.claudeError ? "error" : f(r.claude)}`);
console.log(`\nBeyond-rules promises — rules ${summary.rules.beyondRules.found}/${summary.rules.beyondRules.expected}` + (summary.claudeResult ? `, Claude ${summary.claudeResult.beyondRules.found}/${summary.claudeResult.beyondRules.expected}` : ", Claude not run (no ANTHROPIC_API_KEY)"));
console.log(`Controls — rules ${summary.rules.controls.found}/${summary.rules.controls.expected}` + (summary.claudeResult ? `, Claude ${summary.claudeResult.controls.found}/${summary.claudeResult.controls.expected}` : ""));
console.log(`False enforceable promises on traps — rules ${summary.rules.falseEnforceableOnTraps}` + (summary.claudeResult ? `, Claude ${summary.claudeResult.falseEnforceableOnTraps}` : "") + `; careless candidates blocked by the validator: ${summary.carelessCandidatesBlockedOnTraps ? "all" : "NOT all"}`);
console.log("Wrote docs/evidence/ai-eval-results.json");
