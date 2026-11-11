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
const B = await import("../lib/gateway/bank");
const { closeDb } = await import("../lib/db");
const { getPayPal } = await import("../lib/paypal/client");
const { getAuthorization } = await import("../lib/paypal/payments");

const translatorPayPal = (process.env.ENVELOPE_PAYEE_1 ?? "translator@example.com").toLowerCase();
const designer = (process.env.ENVELOPE_PAYEE_2 ?? `designer-${Date.now()}@example.com`).toLowerCase();
const notAfter = new Date(Date.now() + 6 * 3600_000).toISOString();
const steps: Array<Record<string, unknown>> = [];
const log = (step: string, data: Record<string, unknown>) => { steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`• ${step}`, JSON.stringify(data)); };

const [ada, ops, loc, art, bea, tr] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));

// The translator is itself an agent, owned by someone else (Bea). It opens an account that can receive:
// signed by its own key and by Bea's. Payments to its account number settle to Bea's PayPal address.
const acct = await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: translatorPayPal }));
const translator = E.accountPayee(tr!.publicKey);
log("translator-agent opened an account that can receive", { account: acct.account, payAs: translator, answersForIt: "Bea", settlesTo: G.maskEmail(acct.settleTo) });

const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: [translator, designer], purposes: ["translation", "design"], notAfter, splits: 2, approveOver: 7000 });
const root = await G.registerRoot({ chain: rootChain, principalName: "Ada (sandbox)", title: "Launch budget" });
const pp = getPayPal();
log("sealed: PayPal hold placed", { root: root.id, order: root.paypalOrderId, authorization: root.authorizationId, held: "$200.00", status: (await getAuthorization(pp, root.authorizationId!)).status });

const locChain = await E.split(rootChain, ops!, { publicKey: loc!.publicKey, label: "localization-agent" }, { currency: "USD", limit: 6000, perPayment: 5000, payees: [translator], purposes: ["translation"], notAfter, splits: 0 });
const artChain = await E.split(rootChain, ops!, { publicKey: art!.publicKey, label: "creative-agent" }, { currency: "USD", limit: 9000, perPayment: 8000, payees: [designer], purposes: ["design"], notAfter, splits: 0 });
await G.announce(locChain); await G.announce(artChain);
log("split offline into two sub-envelopes", { localization: "$60 · translator-agent's account only", creative: "$90 · designer only" });

// Know your agent: before doing any work, the designer asks whether creative-agent is good for $70.
const good = await G.standing(await E.signHello(artChain, art!, { amount: 7000, payee: designer, purpose: "design" }));
log("proof of funds: the designer checked creative-agent before working", { good: good.good, account: good.account, standsBehindIt: good.sponsors.map((x) => x.label).join(" → "), paypalHold: good.paypal.status, unusedOnHold: `$${((good.paypal.unusedMinor ?? 0) / 100).toFixed(2)}`, canPayUpTo: `$${(good.availableMinor / 100).toFixed(2)}`, gatewaySignatureValid: await G.verifyStanding(good) });
const bad = await G.standing(await E.signHello(artChain, art!, { amount: 2000, payee: "attacker@evil.example", purpose: "design" }));
log("proof of funds refused for a payee that is not on the envelope", { good: bad.good, reasons: bad.reasons.map((x) => x.code) });

// Agent pays agent, with the money set aside first: translator-agent wants to see it before it starts.
const pr = await G.promise(await E.signPromise(locChain, loc!, { amount: 4500, payee: translator, purpose: "translation", memo: "FR + YO store strings", ttl: 900 }));
log("localization-agent set $45 aside for translator-agent (no money moved)", { status: pr.status, promise: pr.spend?.id, heldUntil: pr.note?.expiresAt, paypalHold: pr.note?.paypal.status, noteSignatureValid: pr.note ? await G.verifyPromiseNote(pr.note) : false, standsBehindThePayer: pr.note?.sponsors.map((x) => x.label).join(" → ") });
const squeezed = await G.spend(await E.signSpend(locChain, loc!, { amount: 2000, payee: translator, purpose: "translation" }));
log("the money set aside can't be spent on anything else", { status: squeezed.status, reasons: squeezed.reasons.map((r) => r.code) });
const pay1 = await G.keep(await E.signKeep(loc!, pr.spend!.id, "pay"), "Translator delivered both files; paying what was set aside.");
log("translator-agent delivered; localization-agent paid the $45 it had set aside", { status: pay1.status, capture: pay1.spend?.captureId, payoutBatch: pay1.spend?.payoutBatchId, payoutItem: pay1.spend?.payoutItemId, paidToAccount: pay1.receipt?.paidTo?.account, settledTo: pay1.spend?.payoutTo ? G.maskEmail(pay1.spend.payoutTo) : null, reasons: pay1.reasons });
const pr2 = await G.promise(await E.signPromise(locChain, loc!, { amount: 1000, payee: translator, purpose: "translation", ttl: 600 }));
const rel = await G.keep(await E.signKeep(loc!, pr2.spend!.id, "release"));
log("a second $10 was set aside, then released: it went back into the envelope", { promised: pr2.status, afterRelease: rel.status });

// Paid on accepted work: $10 set aside, payable when ops-agent (who ordered the work) signs for the delivery.
const pr3 = await G.promise(await E.signPromise(locChain, loc!, { amount: 1000, payee: translator, purpose: "translation", memo: "Glossary", ttl: 600, releaseBy: ops!.publicKey }));
const work = await E.sha256("glossary.fr.json + glossary.yo.json");
let payeeTried = "refused";
try { await G.accept(await E.signAccept(tr!, pr3.spend!.id, { work })); payeeTried = "NOT REFUSED"; } catch (e) { payeeTried = `refused: ${e instanceof Error ? e.message : e}`; }
const acc = await G.accept(await E.signAccept(ops!, pr3.spend!.id, { work, note: "Glossary checked against the brief." }));
log("$10 set aside, payable on ops-agent's acceptance; the payee could not release it itself; ops-agent's signature did", { promised: pr3.status, payeeTriedToReleaseIt: payeeTried, status: acc.status, capture: acc.spend?.captureId, payoutBatch: acc.spend?.payoutBatchId, workFingerprintOnReceipt: acc.receipt?.releasedBy?.work, receiptSignatureValid: acc.receipt ? await G.verifyReceipt(acc.receipt) : false });
const pay2 = await G.spend(await E.signSpend(artChain, art!, { amount: 7000, payee: designer, purpose: "design", memo: "Launch banner set" }));
log("creative-agent paid $70", { status: pay2.status, capture: pay2.spend?.captureId, payoutBatch: pay2.spend?.payoutBatchId, reasons: pay2.reasons });

const bad1 = await G.spend(await E.signSpend(artChain, art!, { amount: 5000, payee: "attacker@evil.example", purpose: "design" }));
log("compromised creative-agent → attacker: denied", { status: bad1.status, reasons: bad1.reasons.map((r) => r.code) });
const bad2 = await G.spend(await E.signSpend(artChain, art!, { amount: 2500, payee: designer, purpose: "design" }));
log("creative-agent over its envelope ($70 + $25 > $90): denied", { status: bad2.status, reasons: bad2.reasons.map((r) => r.code) });

// Owner approval: Ada asked to sign for any single payment over $70. ops-agent wants to pay the designer $72.
const tooBig = await G.spend(await E.signSpend(rootChain, ops!, { amount: 7200, payee: designer, purpose: "design", memo: "Rush: extra banner sizes" }));
const asked = await G.promise(await E.signPromise(rootChain, ops!, { amount: 7200, payee: designer, purpose: "design", memo: "Rush: extra banner sizes", ttl: 600, releaseBy: ada!.publicKey }), "Over what I may pay on my own; asking the owner.");
let selfPay = "refused";
try { await G.keep(await E.signKeep(ops!, asked.spend!.id, "pay")); selfPay = "NOT REFUSED"; } catch (e) { selfPay = `refused: ${e instanceof Error ? e.message : e}`; }
const waiting = (await G.treasury(ada!.publicKey))?.approvals.length;
const signedOff = await G.accept(await E.signAccept(ada!, asked.spend!.id, { note: "Approved by the owner." }));
log("a $72 payment is over the $70 the owner asked to sign for: refused outright, then set aside, the agent could not pay it itself, and the owner's signature paid it", { direct: tooBig.status, directReasons: tooBig.reasons.map((r) => r.code), asked: asked.status, agentTriedToPayItself: selfPay, waitingInOwnersInbox: waiting, afterOwnerSigned: signedOff.status, capture: signedOff.spend?.captureId, payoutBatch: signedOff.spend?.payoutBatchId, signedByOwnerOnReceipt: signedOff.receipt?.releasedBy?.key === ada!.publicKey });

const rc = pay1.spend ? await G.reconcile(pay1.spend.id) : null;
log("receipt reconciled against PayPal", { ok: rc?.ok, checks: rc?.checks });

await G.revoke(await E.signRevoke(ada!, artChain[1]!.body.id));
const dead = await G.spend(await E.signSpend(artChain, art!, { amount: 1000, payee: designer, purpose: "design" }));
log("owner revoked creative-agent; its next spend is denied", { status: dead.status, reasons: dead.reasons.map((r) => r.code) });

const { root: closed } = await G.revoke(await E.signRevoke(ada!, root.id));
const authAfter = await getAuthorization(pp, root.authorizationId!);
log("owner closed the envelope: PayPal released the rest of the hold", { captured: closed.capturedMinor, released: closed.releasedMinor, authorizationStatus: authAfter.status });

const ref = await G.reference(loc!.publicKey);
log("localization-agent's record, signed by the gateway as a reference", { facts: ref?.facts, signatureValid: ref ? await G.verifyReference(ref) : false });
const books = await G.reconcileTreasury(ada!.publicKey);
log("treasury: the owner's books checked against PayPal", { paymentsChecked: books?.checked, matchPayPal: books?.matched, matched: `$${((books?.matchedMinor ?? 0) / 100).toFixed(2)}` });
const earner = await G.agentProfile(tr!.publicKey);
log("translator-agent's record", { earned: `$${((earner?.record.receivedMinor ?? 0) / 100).toFixed(2)}`, timesPaid: earner?.record.received, holdsAnEnvelope: (earner?.accounts.length ?? 0) > 0 });
const payer = await G.agentProfile(loc!.publicKey);
log("localization-agent's record", { promisesKept: payer?.record.promisesKept, promisesReleasedOrLapsed: payer?.record.promisesLapsed });

// ---------------------------------------------------------------------------------------------------
// Balances. A second envelope pays an agent whose account KEEPS its income. That agent then pays
// another agent out of its balance, is stopped from overpaying, is frozen by its owner, and withdraws.
// ---------------------------------------------------------------------------------------------------
const usd = (n: number | null | undefined) => `$${((n ?? 0) / 100).toFixed(2)}`;
const [dee, buyer, wr, cy, ed, rogue] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));
const wAcct = await G.openAccount(await E.signAccount(wr!, bea!, { label: "writer-agent", ownerName: "Bea", settleTo: translatorPayPal, mode: "hold", perPayment: 3000 }));
await G.openAccount(await E.signAccount(ed!, cy!, { label: "editor-agent", ownerName: "Cy", settleTo: designer, mode: "hold" }));
const [writer, editor] = [E.accountPayee(wr!.publicKey), E.accountPayee(ed!.publicKey)];
log("writer-agent and editor-agent opened accounts that keep their income", { writer, editor, writerMayPayAtOnce: usd(wAcct.perPaymentMinor), setBy: "Bea, its owner", withdrawsTo: G.maskEmail(wAcct.settleTo) });
const chain2 = await E.seal(dee!, { publicKey: buyer!.publicKey, label: "buyer-agent" }, { currency: "USD", limit: 6000, perPayment: 6000, payees: [writer], purposes: ["writing"], notAfter, splits: 0 });
const root2 = await G.registerRoot({ chain: chain2, principalName: "Dee (sandbox)", title: "Copy budget" });
log("a second owner sealed $60 for buyer-agent: PayPal hold placed", { root: root2.id, order: root2.paypalOrderId, authorization: root2.authorizationId });
const inc = await G.spend(await E.signSpend(chain2, buyer!, { amount: 5000, payee: writer, purpose: "writing", memo: "Launch page copy" }));
const incCheck = inc.spend ? await G.reconcile(inc.spend.id) : null;
log("buyer-agent paid writer-agent $50: PayPal captured it from the hold and it was credited to writer-agent's balance, with no payout", { status: inc.status, capture: inc.spend?.captureId, payoutBatch: inc.spend?.payoutBatchId, heldInAccount: inc.receipt?.paidTo?.held, receiptChecksAgainstPayPal: incCheck?.ok, checks: incCheck?.checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}`) });
const t1 = await B.transfer(await E.signTransfer(wr!, { amount: 1200, payee: editor, purpose: "editing", memo: "Edit the launch page copy" }));
log("writer-agent paid editor-agent $12 out of its balance: moved on the ledger, no PayPal call", { status: t1.status, transfer: t1.transfer?.id, writerBalance: usd(t1.balanceMinor), editorBalance: usd((await G.agentProfile(ed!.publicKey))?.balance?.minor), receiptSignatureValid: t1.receipt ? await B.verifyTransferReceipt(t1.receipt) : false, paypalPayout: t1.transfer?.payoutBatchId ?? "none" });
const replay = await B.transfer(t1.transfer!.signed);
log("the same signed transfer presented again moved nothing", { duplicate: replay.duplicate, writerBalance: usd(replay.balanceMinor) });
const drain = await B.transfer(await E.signTransfer(wr!, { amount: 3800, payee: "stranger@evil.example", memo: "Send everything here" }));
const forgedT = await E.signTransfer(rogue!, { amount: 1000, payee: "stranger@evil.example" }); forgedT.request.from = wr!.publicKey;
const forgedR = await B.transfer(forgedT);
log("a compromised writer-agent tried to send its whole balance to a stranger; a stranger tried to move it with a forged signature: both refused", { drain: drain.status, drainReasons: drain.reasons.map((r) => r.code), forged: forgedR.status, forgedReasons: forgedR.reasons.map((r) => r.code), writerBalance: usd(drain.balanceMinor) });
await B.freeze(await E.signFreeze(bea!, wr!.publicKey, true));
const frozen = await B.transfer(await E.signTransfer(wr!, { kind: "withdraw", amount: 500 }));
let selfUnfreeze = "refused";
try { await B.freeze(await E.signFreeze(wr!, wr!.publicKey, false)); selfUnfreeze = "NOT REFUSED"; } catch (e) { selfUnfreeze = `refused: ${e instanceof Error ? e.message : e}`; }
await B.freeze(await E.signFreeze(bea!, wr!.publicKey, false));
log("Bea froze writer-agent's account: nothing could leave, and the agent could not lift the freeze; then Bea lifted it", { whileFrozen: frozen.status, reasons: frozen.reasons.map((r) => r.code), agentTriedToUnfreeze: selfUnfreeze });
const wd = await B.transfer(await E.signTransfer(wr!, { kind: "withdraw", amount: 2000, memo: "Earnings to Bea" }));
log("writer-agent withdrew $20 to its owner: a real PayPal payout", { status: wd.status, payoutBatch: wd.transfer?.payoutBatchId, payoutStatus: wd.transfer?.payoutStatus, sentTo: wd.transfer?.payoutTo ? G.maskEmail(wd.transfer.payoutTo) : null, writerBalance: usd(wd.balanceMinor), reasons: wd.reasons.map((r) => r.code) });
const out2 = await B.transfer(await E.signTransfer(ed!, { amount: 500, payee: designer, purpose: "design", memo: "Header image" }));
log("editor-agent paid $5 of what it was paid to a PayPal address: a real PayPal payout", { status: out2.status, payoutBatch: out2.transfer?.payoutBatchId, payoutStatus: out2.transfer?.payoutStatus, editorBalance: usd(out2.balanceMinor), reasons: out2.reasons.map((r) => r.code) });
const { root: closed2 } = await G.revoke(await E.signRevoke(dee!, root2.id));
log("the second owner closed the envelope: PayPal released what was not spent", { captured: usd(closed2.capturedMinor), released: usd(closed2.releasedMinor), authorizationStatus: (await getAuthorization(pp, root2.authorizationId!)).status });
const pos = await B.position();
log("the books", { paidIn: usd(pos.totals.capturedInMinor), paidOut: usd(pos.totals.paidOutMinor), heldForAgents: usd(pos.totals.balancesMinor), movedBetweenAgents: usd(pos.totals.bookTransferredMinor), balances: Object.fromEntries(pos.accounts.filter((a) => a.mode === "hold").map((a) => [a.label, usd(a.balanceMinor)])), checks: pos.checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}`) });
for (const t of [wd, out2]) if (t.transfer?.payoutBatchId) {
  let u = (await B.syncTransfer(t.transfer.id))!;
  const seen = [u.payoutStatus];
  for (let i = 0; i < 12 && (u.payoutStatus === "PENDING" || u.payoutStatus === null); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    u = (await B.syncTransfer(t.transfer.id))!;
    if (seen[seen.length - 1] !== u.payoutStatus) seen.push(u.payoutStatus);
  }
  log("payout from a balance, as PayPal reports it", { transfer: u.id, kind: u.kind, sentTo: u.payoutTo ? G.maskEmail(u.payoutTo) : null, statusesSeen: seen, final: u.payoutStatus, status: u.status, meaning: u.payoutStatus === "SUCCESS" ? "delivered to the PayPal account" : u.payoutStatus === "UNCLAIMED" ? "accepted by PayPal and held for the receiver, who has no PayPal account at that address (placeholder address)" : "not final yet" });
}

// A capture is not a delivered payout. PayPal processes payouts asynchronously, so ask again until each
// one leaves PENDING (or a minute passes) and record what PayPal finally says.
for (const s of [pay1, acc, pay2, signedOff]) if (s.spend) {
  let u = await G.syncSpend(s.spend.id);
  const seen = [u.payoutStatus];
  for (let i = 0; i < 12 && (u.payoutStatus === "PENDING" || u.payoutStatus === null); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    u = await G.syncSpend(s.spend.id);
    if (seen[seen.length - 1] !== u.payoutStatus) seen.push(u.payoutStatus);
  }
  log("payout delivery, as PayPal reports it", { spend: u.id, payee: u.payee, sentTo: u.payoutTo ? G.maskEmail(u.payoutTo) : u.payee, statusesSeen: seen, final: u.payoutStatus, meaning: u.payoutStatus === "SUCCESS" ? "delivered to the payee's PayPal account" : u.payoutStatus === "UNCLAIMED" ? "accepted by PayPal and held for the payee to claim: this address has no sandbox account" : "not final when this run ended", transaction: u.payoutTransactionId });
}

mkdirSync("docs/evidence", { recursive: true });
writeFileSync("docs/evidence/sandbox-run.json", JSON.stringify({ ranAt: new Date().toISOString(), paypalMode: paypalMode(), note: "Real PayPal sandbox API calls. A completed capture and a delivered payout are different things: each payout's final status from PayPal is recorded at the end. Payee addresses without a sandbox account are reported by PayPal as UNCLAIMED.", steps, receipt: pay1.receipt }, null, 2));
console.log("Evidence written to docs/evidence/sandbox-run.json");
await closeDb();
