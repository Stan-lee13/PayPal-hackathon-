/**
 * Runs the attack corpus against the gateway on the built-in PayPal simulator and writes the result
 * to docs/evidence/attack-suite.json. Uses the TEST database (it is wiped).
 *
 *   npx tsx scripts/attack-suite.ts
 */
import { writeFileSync } from "node:fs";
import { useTestEnv } from "../tests/helpers";

if (!useTestEnv()) { console.error("Set TEST_DATABASE_URL (see .env.example)."); process.exit(2); }
const { runCorpus } = await import("../tests/attack-corpus");
const { corpusDeps } = await import("../tests/attack-deps");
const { closeDb } = await import("../lib/db");

const rows = await runCorpus(await corpusDeps());
const byCategory: Record<string, { attacks: number; refused: number; movedMoney: number }> = {};
for (const r of rows) {
  const c = (byCategory[r.category] ??= { attacks: 0, refused: 0, movedMoney: 0 });
  c.attacks += 1; if (r.refused) c.refused += 1; if (r.moneyMoved) c.movedMoney += 1;
}
const summary = { attacks: rows.length, refused: rows.filter((r) => r.refused).length, movedMoney: rows.filter((r) => r.moneyMoved).length };
writeFileSync("docs/evidence/attack-suite.json", JSON.stringify({ ranAt: new Date().toISOString(), paypal: "built-in simulator", summary, byCategory, rows }, null, 2) + "\n");
for (const [k, v] of Object.entries(byCategory)) console.log(`${k.padEnd(24)} ${String(v.refused).padStart(3)}/${v.attacks} refused, ${v.movedMoney} moved money`);
console.log(`\n${summary.refused}/${summary.attacks} attacks refused; ${summary.movedMoney} moved money it should not have. Written to docs/evidence/attack-suite.json`);
for (const r of rows.filter((x) => !x.refused || x.moneyMoved)) console.log("FAILED:", r);
await closeDb();
process.exit(summary.refused === summary.attacks && summary.movedMoney === 0 ? 0 : 1);
