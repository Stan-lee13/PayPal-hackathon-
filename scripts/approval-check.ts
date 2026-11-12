/**
 * A hold the payer approves in PayPal's own checkout, on the REAL sandbox.
 *
 * The script signs an envelope, asks PayPal for an approval link and prints it. A person opens the
 * link, signs in to PayPal with a sandbox personal (buyer) account and approves. The script waits,
 * reads the order back from PayPal, places the hold on it, makes one payment from the hold and closes
 * the envelope. The gateway never sees the payer's PayPal password.
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… DATABASE_URL=… npx tsx scripts/approval-check.ts [minutes to wait, default 45]
 *
 * Writes docs/evidence/payer-approval.json. Sandbox only.
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode, getPayPal } = await import("../lib/paypal/client");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");
const E = await import("../lib/envelope/core");
const G = await import("../lib/gateway/service");
const { getOrder, getAuthorization } = await import("../lib/paypal/payments");
const { flushJournal } = await import("../lib/paypal/journal");
const { paypalTrail } = await import("../lib/gateway/settlement");
const { closeDb } = await import("../lib/db");

const pp = getPayPal();
const minutes = Number(process.argv[2] ?? 45);
const site = (process.env.APPROVAL_RETURN_TO || "https://envelope-paypal.vercel.app").replace(/\/$/, "");
const steps: Array<Record<string, unknown>> = [];
const log = (step: string, data: Record<string, unknown>) => { steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`• ${step}`, JSON.stringify(data)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;

const [ada, ops, bea, tr] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
const settleTo = (process.env.ENVELOPE_PAYEE_1 || "translator@example.com").toLowerCase();
await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo }));
const translator = E.accountPayee(tr!.publicKey);
const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 2500, perPayment: 1500, payees: [translator], purposes: ["translation"], notAfter: new Date(Date.now() + 6 * 3600_000).toISOString(), splits: 0 });
const rootId = chain[0]!.body.id;

const asked = await G.askApproval({ chain, title: "Payer-approved budget", returnUrl: `${site}/console?approved=1`, cancelUrl: `${site}/console?cancelled=1` });
log("the envelope was signed and PayPal was asked for an approval link: nothing is held and nothing is recorded yet", { envelope: rootId, order: asked.orderId, amount: usd(asked.amountMinor), statusAtPayPal: (await getOrder(pp, asked.orderId)).status });
console.log(`\nAPPROVE HERE (sign in with a sandbox PERSONAL account): ${asked.approveUrl}\n`);
if (process.env.APPROVAL_URL_FILE) writeFileSync(process.env.APPROVAL_URL_FILE, asked.approveUrl);

// Sealing before the payer approves is refused, with nothing held.
let early = "NOT REFUSED";
try { await G.registerRoot({ chain, principalName: "Ada (sandbox)", title: "Payer-approved budget", paypalOrderId: asked.orderId }); } catch (e) { early = `refused: ${e instanceof Error ? e.message : e}`; }
log("sealing before the payer has approved", { answer: early });

let status = "PAYER_ACTION_REQUIRED";
const until = Date.now() + minutes * 60_000;
while (Date.now() < until) {
  const o = await getOrder(pp, asked.orderId).catch(() => null);
  if (o && o.status !== status) { status = o.status; console.log(`  PayPal now says the order is ${status}`); }
  if (status === "APPROVED" || status === "COMPLETED" || status === "VOIDED") break;
  await sleep(8000);
}
if (status !== "APPROVED") {
  log("the payer did not approve in time: nothing was held and nothing was sealed", { statusAtPayPal: status, waitedMinutes: minutes });
} else {
  const o = await getOrder(pp, asked.orderId);
  log("the payer approved in PayPal's checkout; the gateway read the order back from PayPal", { statusAtPayPal: o.status, madeForThisEnvelope: o.customId === rootId, amount: o.amountMinor === null ? null : usd(o.amountMinor), payer: o.payerEmail ? G.maskEmail(o.payerEmail) : null, payerId: o.payerId });
  const root = await G.registerRoot({ chain, principalName: "Ada (sandbox)", title: "Payer-approved budget", paypalOrderId: asked.orderId });
  const auth = await getAuthorization(pp, root.authorizationId!);
  log("sealed: PayPal placed the hold on the order the payer approved", { authorization: root.authorizationId, order: root.paypalOrderId, held: usd(root.limitMinor), statusAtPayPal: auth.status, expiresAt: auth.expiresAt });

  const paid = await G.spend(await E.signSpend(chain, ops!, { amount: 900, payee: translator, purpose: "translation", memo: "Store strings" }));
  let now = paid.spend!;
  for (let i = 0; i < 12 && now.status === "PAYOUT_PENDING"; i++) { await sleep(5000); now = await G.syncSpend(now.id); }
  log("ops-agent paid translator-agent $9 from that hold: a partial capture and a payout", { status: now.status, capture: now.captureId, payoutBatch: now.payoutBatchId, payoutStatus: now.payoutStatus, meaning: now.status === "PAID" ? "delivered" : now.status === "UNCLAIMED" ? "held by PayPal for a payee with no account at that address: not paid" : "not finished" });

  const { root: closed } = await G.revoke(await E.signRevoke(ada!, rootId));
  log("the owner closed the envelope: PayPal released the rest to the payer", { captured: usd(closed.capturedMinor), released: usd(closed.releasedMinor ?? 0), authorizationStatus: (await getAuthorization(pp, root.authorizationId!)).status });
  const t = (await paypalTrail(rootId))!;
  log("PayPal calls behind this envelope", { ...t.summary, how: t.calls.filter((c) => ["hold.ask", "order.read", "hold.place"].includes(c.op)).map((c) => `${c.text} (${c.paypalStatus ?? c.error})`) });
}

await flushJournal();
writeFileSync("docs/evidence/payer-approval.json", JSON.stringify({
  ranAt: new Date().toISOString(), paypalMode: paypalMode(),
  note: "Real PayPal sandbox. The payer approved the hold in PayPal's own checkout, signed in to a sandbox personal account; the gateway only received PayPal's word that the order was approved.",
  steps,
}, null, 2));
await closeDb();
