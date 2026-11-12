/**
 * Ask PayPal for its own statement of the gateway's account (Transaction Search) and compare it with the
 * captures, payouts and refunds recorded in this database, with the fee PayPal charged on each. PayPal's statement can lag by up to three hours, so
 * run this some time after `scripts/sandbox-run.ts`, against the same database.
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… DATABASE_URL=… npx tsx scripts/statement-check.ts [hours]
 *
 * Writes docs/evidence/statement-check.json. Sandbox only.
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode } = await import("../lib/paypal/client");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");
const K = await import("../lib/gateway/books");
const { flushJournal } = await import("../lib/paypal/journal");
const { closeDb } = await import("../lib/db");
const usd = (n: number | null | undefined) => `$${((n ?? 0) / 100).toFixed(2)}`;

const hours = Number(process.argv[2] ?? 24);
const st = await K.statement(hours);
const res = await K.reserves();
const out = {
  ranAt: new Date().toISOString(), paypalMode: paypalMode(), window: { from: st.from, to: st.to },
  statement: { paypalLines: st.paypalLines, ourRecords: st.ours, listedWithTheSameAmount: st.listed, amountDiffers: st.differs, notListedYet: st.notListedYet, linesNotFromThisDatabase: st.otherActivity, ok: st.ok },
  // From PayPal's statement alone, for the records it lists: the fees are PayPal's own figures.
  position: { cameIn: usd(st.position.inMinor), wentOut: usd(st.position.outMinor), refunded: usd(st.position.refundedMinor), paypalFees: usd(st.position.feesMinor), leftAtPayPalByTheseRecords: usd(st.position.netMinor), note: "Agents and payees were credited and paid the full amounts; PayPal's fees fall on the gateway's operator and are not priced in." },
  reserves: { owedToAgents: usd(res.owed.balancesMinor), owedAtPayPalsMoment: usd(res.owed.atPayPalsTimeMinor), paypalAvailable: res.paypal ? usd(res.paypal.availableMinor) : null, paypalAsOf: res.paypal?.asOf ?? null, covered: res.covered },
  matches: st.matches.map((m) => ({ what: m.what, paypalId: m.paypalId, payment: m.spend, recorded: usd(m.amountMinor), onPayPalsStatement: m.listedMinor === null ? null : usd(m.listedMinor), paypalFee: m.feeMinor === null ? null : usd(m.feeMinor), ...(m.returned ? { cameBack: true } : {}), verdict: m.verdict })),
  note: "Lines not from this database are other activity on the same sandbox account (earlier runs). A record not listed yet is within PayPal's stated lag, not an error.",
};
console.log(JSON.stringify({ ...out, matches: `${out.matches.length} (see file)` }, null, 1));
for (const m of out.matches) console.log(` ${m.verdict.padEnd(15)} ${m.what.padEnd(8)} ${m.paypalId}  recorded ${m.recorded}  PayPal ${m.onPayPalsStatement ?? "-"}  fee ${m.paypalFee ?? "-"}  ${m.payment}`);
writeFileSync("docs/evidence/statement-check.json", JSON.stringify(out, null, 2));
await flushJournal();
await closeDb();
