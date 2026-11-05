/**
 * Verify a Kept evidence pack offline: recompute every audit-chain hash from genesis and
 * every source SHA-256. Needs no database, no network and no Kept server.
 *   npx tsx scripts/verify-evidence.ts kept-evidence-ko_....json [expected-head-hash]
 */
import fs from "node:fs";
import { verifyPack, type EvidencePack } from "../lib/services/evidence";

const [file, expectedHead] = process.argv.slice(2);
if (!file) { console.error("usage: verify-evidence.ts <pack.json> [expected-head-hash]"); process.exit(64); }
const pack = JSON.parse(fs.readFileSync(file, "utf8")) as EvidencePack;
const v = verifyPack(pack);
console.log(`Kept evidence pack for order ${pack.order.keptOrderId} (${pack.paypalMode}${pack.notice ? ", SIMULATED" : ""})`);
console.log(`  sources:       ${v.sources.filter((s) => s.ok).length}/${v.sources.length} SHA-256 match`);
console.log(`  promises:      ${v.promiseSourcesOk ? "every promise points at a fingerprinted source" : "MISMATCH between promises and sources"}`);
if (v.chain.ok) console.log(`  audit chain:   ${v.chain.length} entries, intact from genesis\n  head:          ${v.chain.head}`);
else console.log(`  audit chain:   BROKEN at entry ${v.chain.brokenAtSeq}: ${v.chain.reason}`);
let ok = v.ok;
if (expectedHead && v.chain.ok) {
  const at = pack.auditChain.entries.find((e) => e.hash === expectedHead);
  console.log(at ? `  fingerprint:   ${expectedHead.slice(0, 16)}… found at entry ${at.seq} — nothing before it was altered` : `  fingerprint:   ${expectedHead.slice(0, 16)}… NOT in this chain — the record was truncated or replaced`);
  ok = ok && Boolean(at);
}
console.log(ok ? "VERIFIED" : "NOT VERIFIED");
process.exit(ok ? 0 : 1);
