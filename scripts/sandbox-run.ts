/**
 * End-to-end run against the REAL PayPal sandbox (no browser needed). Writes evidence with the real
 * PayPal ids to docs/evidence/sandbox-run.json.
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npx tsx scripts/sandbox-run.ts
 *   Optional: ENVELOPE_PAYEE_1 / ENVELOPE_PAYEE_2 = emails of sandbox accounts to pay
 *   (payouts to addresses without a sandbox account are reported by PayPal as UNCLAIMED).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode } = await import("../lib/paypal/client");
if (paypalMode() !== "sandbox") throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) first; this script refuses to run on the simulator.");
const E = await import("../lib/envelope/core");
const G = await import("../lib/gateway/service");
const { closeDb } = await import("../lib/db");
const { getPayPal } = await import("../lib/paypal/client");
const { getAuthorization } = await import("../lib/paypal/payments");

const translator = (process.env.ENVELOPE_PAYEE_1 ?? `translator-${Date.now()}@example.com`).toLowerCase();
const designer = (process.env.ENVELOPE_PAYEE_2 ?? `designer-${Date.now()}@example.com`).toLowerCase();
const notAfter = new Date(Date.now() + 6 * 3600_000).toISOString();
const steps: Array<Record<string, unknown>> = [];
const log = (step: string, data: Record<string, unknown>) => { steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`• ${step}`, JSON.stringify(data)); };

const [ada, ops, loc, art] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: [translator, designer], purposes: ["translation", "design"], notAfter, splits: 2 });
const root = await G.registerRoot({ chain: rootChain, principalName: "Ada (sandbox)", title: "Launch budget" });
const pp = getPayPal();
log("sealed: PayPal hold placed", { root: root.id, order: root.paypalOrderId, authorization: root.authorizationId, held: "$200.00", status: (await getAuthorization(pp, root.authorizationId!)).status });

const locChain = await E.split(rootChain, ops!, { publicKey: loc!.publicKey, label: "localization-agent" }, { currency: "USD", limit: 6000, perPayment: 5000, payees: [translator], purposes: ["translation"], notAfter, splits: 0 });
const artChain = await E.split(rootChain, ops!, { publicKey: art!.publicKey, label: "creative-agent" }, { currency: "USD", limit: 9000, perPayment: 8000, payees: [designer], purposes: ["design"], notAfter, splits: 0 });
await G.announce(locChain); await G.announce(artChain);
log("split offline into two sub-envelopes", { localization: "$60 · translator only", creative: "$90 · designer only" });

// Know your agent: before doing any work, the designer asks whether creative-agent is good for $70.
const good = await G.standing(await E.signHello(artChain, art!, { amount: 7000, payee: designer, purpose: "design" }));
log("proof of funds: the designer checked creative-agent before working", { good: good.good, account: good.account, standsBehindIt: good.sponsors.map((x) => x.label).join(" → "), paypalHold: good.paypal.status, unusedOnHold: `$${((good.paypal.unusedMinor ?? 0) / 100).toFixed(2)}`, canPayUpTo: `$${(good.availableMinor / 100).toFixed(2)}`, gatewaySignatureValid: await G.verifyStanding(good) });
const bad = await G.standing(await E.signHello(artChain, art!, { amount: 2000, payee: "attacker@evil.example", purpose: "design" }));
log("proof of funds refused for a payee that is not on the envelope", { good: bad.good, reasons: bad.reasons.map((x) => x.code) });

const pay1 = await G.spend(await E.signSpend(locChain, loc!, { amount: 4500, payee: translator, purpose: "translation", memo: "FR + YO store strings" }));
log("localization-agent paid $45", { status: pay1.status, capture: pay1.spend?.captureId, payoutBatch: pay1.spend?.payoutBatchId, payoutItem: pay1.spend?.payoutItemId, reasons: pay1.reasons });
const pay2 = await G.spend(await E.signSpend(artChain, art!, { amount: 7000, payee: designer, purpose: "design", memo: "Launch banner set" }));
log("creative-agent paid $70", { status: pay2.status, capture: pay2.spend?.captureId, payoutBatch: pay2.spend?.payoutBatchId, reasons: pay2.reasons });

const bad1 = await G.spend(await E.signSpend(artChain, art!, { amount: 5000, payee: "attacker@evil.example", purpose: "design" }));
log("compromised creative-agent → attacker: denied", { status: bad1.status, reasons: bad1.reasons.map((r) => r.code) });
const bad2 = await G.spend(await E.signSpend(artChain, art!, { amount: 2500, payee: designer, purpose: "design" }));
log("creative-agent over its envelope ($70 + $25 > $90): denied", { status: bad2.status, reasons: bad2.reasons.map((r) => r.code) });

const rc = pay1.spend ? await G.reconcile(pay1.spend.id) : null;
log("receipt reconciled against PayPal", { ok: rc?.ok, checks: rc?.checks });

await G.revoke(await E.signRevoke(ada!, artChain[1]!.body.id));
const dead = await G.spend(await E.signSpend(artChain, art!, { amount: 1000, payee: designer, purpose: "design" }));
log("owner revoked creative-agent; its next spend is denied", { status: dead.status, reasons: dead.reasons.map((r) => r.code) });

const { root: closed } = await G.revoke(await E.signRevoke(ada!, root.id));
const authAfter = await getAuthorization(pp, root.authorizationId!);
log("owner closed the envelope: PayPal released the rest of the hold", { captured: closed.capturedMinor, released: closed.releasedMinor, authorizationStatus: authAfter.status });

for (const s of [pay1, pay2]) if (s.spend) { const u = await G.syncSpend(s.spend.id); log("payout status", { spend: u.id, payee: u.payee, status: u.status, paypal: u.payoutStatus, transaction: u.payoutTransactionId }); }

mkdirSync("docs/evidence", { recursive: true });
writeFileSync("docs/evidence/sandbox-run.json", JSON.stringify({ ranAt: new Date().toISOString(), paypalMode: paypalMode(), note: "Real PayPal sandbox API calls. Payee addresses without a sandbox account are reported by PayPal as UNCLAIMED.", steps, receipt: pay1.receipt }, null, 2));
console.log("Evidence written to docs/evidence/sandbox-run.json");
await closeDb();
