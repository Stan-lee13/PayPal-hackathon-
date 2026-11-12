/**
 * End-to-end check in a real browser. Works against either mode of the app: a server gateway
 * (DATABASE_URL set; PayPal sandbox or simulator) or the in-browser gateway (no DATABASE_URL).
 * Uses the scripted agents, so it needs no model.
 *
 *   BASE=http://localhost:3000 node scripts/e2e.mjs            # optional: OUT=<dir> for screenshots
 *
 * Covers: seal with a key held in the browser, agents split, money set aside and released when a
 * named agent signs for the delivered work, a direct payment, a payment over the owner's threshold
 * that waits for the owner's signature, the earning agent's passport and balance (transfer to another
 * agent, a refused drain, an owner freeze, a withdrawal), its card (a subscription charged by the
 * merchant, three declined charges, cancellation), the books, a receipt checked against PayPal and in
 * the browser, proof of funds, three attacks denied, close, a second tab seeing the same data, the
 * record of PayPal calls on an envelope's page, and (on the simulator) the owner's recall of an unclaimed payout.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? null;
let failed = false;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 600)}`));
if (process.env.E2E_DEBUG) { const t0 = Date.now(); page.on("console", (m) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s ${m.text().slice(0, 240)}`)); }
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
const T = { timeout: 60000 };
try {
  const health0 = await (await fetch(`${BASE}/api/health`)).json().catch(() => ({}));
  await page.goto(`${BASE}/console`);
  console.log("gateway mode:", await page.evaluate(() => document.documentElement.dataset.gateway));
  await page.getByText(/Signed with your key [A-Za-z0-9_-]{6}…/).waitFor(T);
  await page.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
  console.log("counterparty loaded");
  if (OUT) await page.screenshot({ path: `${OUT}/local-1-console.png`, fullPage: true }).catch(() => {});
  await page.getByRole("button", { name: /^Seal & hold/ }).click();
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  console.log("sealed:", page.url());
  await page.getByRole("button", { name: /Run the launch/ }).click();
  await page.getByText(/creative-agent asked to pay/).waitFor(T);
  await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).waitFor(T);
  await page.waitForTimeout(1500);
  if (OUT) await page.screenshot({ path: `${OUT}/local-2-envelope.png`, fullPage: true }).catch(() => {});
  console.log("launch ran");
  // over the owner's threshold: the agent can only ask; the owner signs in this browser
  await page.getByRole("button", { name: "Agent asks for a bigger payment" }).click();
  await page.getByTestId("approval").getByText(/asks to pay/).waitFor(T);
  await page.getByTestId("approval").getByRole("button", { name: /^Sign & pay \$80\.00/ }).click();
  await page.getByText(/^You signed\./).waitFor(T);
  await page.getByTestId("approval").waitFor({ state: "detached", timeout: 20000 });
  console.log("owner approval: asked, signed, paid");
  await page.getByText("held for this payee until").waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  if (OUT) await page.screenshot({ path: `${OUT}/local-2-envelope.png`, fullPage: true }).catch(() => {});
  // the agent that got paid
  const envelopeUrl = page.url();
  await page.getByTestId("statement").getByRole("link", { name: /translator-agent/ }).first().click();
  await page.getByTestId("receives").waitFor(T);
  await page.getByTestId("incoming").getByText("from localization-agent").first().waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-3-earner.png`, fullPage: true }).catch(() => {});
  console.log("translator-agent passport shows income");
  // its balance: the income stayed in its account; it pays another agent, is stopped from draining, is frozen by its owner, withdraws
  const bal = page.getByTestId("balance");
  const said = page.getByTestId("bank-result");
  await bal.getByTestId("ledger").getByText("Paid in from").first().waitFor(T);
  await bal.getByRole("button", { name: "Pay proofreader-agent $12" }).click();
  await said.getByText("Moved.").waitFor(T);
  await bal.getByTestId("ledger").getByText("Paid to").first().waitFor(T);
  await bal.getByRole("button", { name: /drain to a stranger/ }).click();
  await said.getByText("Refused.").waitFor(T);
  await said.getByText(/OVER_ACCOUNT_LIMIT/).waitFor(T);
  await bal.getByRole("button", { name: "Owner freezes it" }).click();
  await said.getByText("Frozen.").waitFor(T);
  await bal.getByRole("button", { name: "Pay proofreader-agent $12" }).click();
  await said.getByText(/ACCOUNT_FROZEN/).waitFor(T);
  await bal.getByRole("button", { name: "Owner lifts the freeze" }).click();
  await said.getByText("Open again.").waitFor(T);
  await bal.getByRole("button", { name: "Withdraw $20 to its owner" }).click();
  await said.getByText(/Paid by PayPal\.|Sent to PayPal\./).waitFor(T);
  await bal.getByTestId("ledger").getByText("Withdrawn to its owner at").first().waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-3b-balance.png`, fullPage: true }).catch(() => {});
  console.log("balance: agent-to-agent transfer booked, drain refused, freeze held, withdrawal sent");
  // its card: a subscription it pays itself, that only the merchant can charge, within what the card allows
  const cards = page.getByTestId("cards");
  const cardSaid = page.getByTestId("card-result");
  await cards.getByRole("button", { name: "Subscribe to Lexica Pro with its card" }).click();
  await cardSaid.getByText(/^Charged/).waitFor(T);
  await page.getByTestId("xenoncard").getByText("Lexica Pro").waitFor(T);
  await page.getByTestId("card-used").getByText("1 of 2 charges").waitFor(T);
  await cards.getByRole("button", { name: "Merchant charges the next period" }).click();
  await cardSaid.getByText(/CHARGE_TOO_SOON/).waitFor(T);
  await cards.getByRole("button", { name: "Merchant overcharges $19" }).click();
  await cardSaid.getByText(/OVER_CARD_LIMIT/).waitFor(T);
  await cards.getByRole("button", { name: "A thief uses the card details" }).click();
  await cardSaid.getByText(/NOT_THE_MERCHANT/).waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-3d-card.png`, fullPage: true }).catch(() => {});
  await cards.getByRole("button", { name: "Agent cancels the card" }).click();
  await cardSaid.getByText("Cancelled.").waitFor(T);
  await cards.getByRole("button", { name: "Merchant charges the next period" }).click();
  await cardSaid.getByText(/CARD_CANCELLED/).waitFor(T);
  console.log("card: subscribed and charged once; too soon, overcharge and a thief declined; cancelled by the agent");
  await page.goto(`${BASE}/bank`);
  await page.getByTestId("bank-checks").getByText("Books balance").waitFor(T);
  await page.getByTestId("bank-accounts").getByText("proofreader-agent").waitFor(T);
  // the books against PayPal's own: its reported balance covers what agents are owed, and its statement agrees with ours
  await page.getByTestId("bank-reserves").getByText("Covered at PayPal").waitFor(T);
  if (health0.paypalMode === "simulated") {
    await page.getByTestId("bank-statement").getByRole("button", { name: "Compare with PayPal" }).click();
    await page.getByTestId("bank-statement").getByText("No disagreement.").waitFor(T);
    await page.getByTestId("bank-position").getByText("Left at PayPal by these records").waitFor(T);
  }
  if (OUT) await page.screenshot({ path: `${OUT}/local-3c-bank.png`, fullPage: true }).catch(() => {});
  console.log("the books balance; PayPal's reported balance covers what agents are owed" + (health0.paypalMode === "simulated" ? "; PayPal's statement agrees with every capture and payout" : ""));
  await page.goto(envelopeUrl);
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  // receipt of the promise that was paid
  await page.getByRole("link", { name: "Receipt & authority chain →" }).last().click();
  await page.getByText("All checks pass").waitFor(T);
  await page.getByText("Signatures valid").waitFor(T);
  // PayPal's Disputes API was asked about this capture, and the evidence the gateway would answer a dispute with can be read
  await page.getByText("PayPal holds no dispute against this capture").waitFor(T);
  await page.getByTestId("evidence-link").click();
  await page.getByTestId("evidence").getByText(/This payment was made by software acting inside limits the payer signed/).waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-4-receipt.png`, fullPage: true }).catch(() => {});
  console.log("receipt verified");
  await page.goBack();
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  // proof of funds
  await page.getByTestId("node-creative-agent").getByRole("link", { name: /creative-agent/ }).click();
  await page.getByRole("heading", { name: "Is it good for the money?" }).waitFor(T);
  await page.getByLabel("For (USD)").fill("20");
  await page.getByRole("button", { name: "Ask the gateway" }).click();
  await page.getByTestId("standing").getByText("Signature checked in your browser.").waitFor(T);
  console.log("standing:", (await page.getByTestId("standing").innerText()).replace(/\n+/g, " | ").slice(0, 300));
  await page.goBack();
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  await page.getByRole("button", { name: "Compromise the creative agent" }).click();
  await page.getByText(/forged a bigger envelope/).waitFor(T);
  await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
  console.log("denials:", await page.getByTestId("statement").getByText("Denied", { exact: true }).count());
  await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
  await page.getByText(/You closed the envelope\. PayPal released/).waitFor(T);
  await page.getByText("Closed", { exact: true }).first().waitFor(T);
  console.log("closed");
  // the proof graph: every record behind the envelope, each signature checked in this browser
  await page.getByTestId("proof-link").click();
  const sum = page.getByTestId("proof-summary");
  await sum.getByText("Signatures checked in your browser").waitFor(T);
  await page.waitForFunction(() => !document.querySelector('[data-testid="proof-summary"]')?.textContent?.includes("…"), null, T);
  const [checked, failedSigs] = (await sum.locator(".figure").allInnerTexts()).map((x) => Number(x));
  if (!(checked >= 12) || failedSigs !== 0) throw new Error(`Proof graph: ${checked} signatures checked, ${failedSigs} failed.`);
  for (const kind of ["owner", "hold", "envelope", "commitment", "acceptance", "capture", "credit", "payout", "receipt", "refused", "account", "card"]) await page.getByTestId(`node-${kind}`).first().waitFor(T);
  // pick the PayPal capture of a payment: its trail leads back to the owner, and PayPal confirms it
  await page.getByTestId("node-capture").first().click();
  await page.getByTestId("proof-trail").getByText(/Person · Ada/).waitFor(T);
  await page.getByRole("button", { name: "Ask PayPal now" }).click();
  await page.getByTestId("paypal-answer").getByText(/PayPal capture exists for exactly this amount/).waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-7-proof.png`, fullPage: true }).catch(() => {});
  // the page a payee can be shown: one payment only
  await page.getByTestId("proof-share").click();
  await page.getByText("traced back to a person.").waitFor(T);
  await page.waitForFunction(() => !document.querySelector('[data-testid="proof-summary"]')?.textContent?.includes("…"), null, T);
  if (await page.getByTestId("node-refused").count() || await page.getByTestId("node-account").count()) throw new Error("The single-payment proof shows more than that payment.");
  if (OUT) await page.screenshot({ path: `${OUT}/local-8-proof-one.png`, fullPage: true }).catch(() => {});
  console.log(`proof graph: ${checked} signatures checked in the browser, 0 failed; a capture traced to the owner and confirmed by PayPal; single-payment page shows only that payment`);
  await page.goBack(); await page.goBack();
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  // the owner's treasury: totals, agents, and the books checked against PayPal
  await page.goto(`${BASE}/treasury`);
  await page.getByTestId("totals").waitFor(T);
  await page.getByTestId("agents").getByText("creative-agent").first().waitFor(T);
  await page.getByRole("button", { name: "Reconcile with PayPal" }).click();
  await page.getByTestId("books").getByText(/\d+ of \d+ match PayPal/).waitFor(T);
  const books = await page.getByTestId("books").getByText(/\d+ of \d+ match PayPal/).innerText();
  if (OUT) await page.screenshot({ path: `${OUT}/local-6-treasury.png`, fullPage: true }).catch(() => {});
  const m = books.match(/(\d+) of (\d+)/i);
  if (!m || m[1] !== m[2]) throw new Error(`Treasury books do not match PayPal: ${books}`);
  console.log("treasury:", books.toLowerCase());
  // a signed, portable record
  await page.getByTestId("agents").getByRole("link", { name: "localization-agent" }).first().click();
  await page.getByRole("button", { name: "Get a signed reference" }).click();
  await page.getByTestId("reference").getByText("Signature checked in your browser.").waitFor(T);
  console.log("reference signed and verified");
  const p2 = await ctx.newPage();
  if (process.env.E2E_DEBUG) p2.on("console", (m) => console.log(`  tab 2: ${m.text().slice(0, 240)}`));
  await p2.goto(`${BASE}/console`);
  await p2.getByText("Store launch budget").first().waitFor(T);
  await p2.getByText("can be paid").first().waitFor(T);
  if (OUT) await p2.screenshot({ path: `${OUT}/local-5-console.png`, fullPage: true }).catch(() => {});
  console.log("second tab: console lists the envelope and the receiving agent");
  // The second tab stays open (and keeps polling) for the rest of the run: two tabs share one in-browser database.
  // A hold the payer approves in PayPal's checkout. On the simulator the checkout is a page of this app; on the sandbox it needs a person at PayPal.
  if ((await (await fetch(`${BASE}/api/health`)).json().catch(() => ({}))).paypalMode === "simulated") {
    await page.goto(`${BASE}/console`);
    await page.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
    await page.getByTestId("approve-at-paypal").click();
    await page.getByTestId("sim-checkout").getByText(/Approve a hold of/).waitFor(T);
    await page.getByTestId("sim-checkout").getByText("$200.00").waitFor(T);
    // cancelling at PayPal seals nothing
    await page.getByRole("link", { name: "Cancel and go back" }).click();
    await page.getByText("You cancelled at PayPal. Nothing was held and nothing was sealed.").waitFor(T);
    await page.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
    await page.getByTestId("approve-at-paypal").click();
    await page.getByTestId("sim-checkout").getByRole("button", { name: "Approve the hold" }).click();
    await page.getByText("PayPal hold backing this envelope").waitFor(T);
    const rail = page.getByTestId("paypal-rail");
    await rail.getByRole("button", { name: /Show all/ }).click().catch(() => {});
    await rail.getByText("Asked the payer to approve the hold in PayPal").first().waitFor(T);
    await rail.getByText("Placed the hold").waitFor(T);
    await page.getByRole("button", { name: /Run the launch/ }).click();
    await page.getByText(/creative-agent asked to pay/).waitFor(T);
    console.log("payer approval: a cancelled checkout sealed nothing; an approved one placed the hold, and the agents spent from it");
  }
  // What PayPal did, and a recall. The recall runs on the simulator only: PayPal's sandbox does not complete a cancel (see the README).
  const health = await (await fetch(`${BASE}/api/health`)).json().catch(() => ({}));
  if (health.paypalMode === "simulated") {
    await page.goto(`${BASE}/console`);
    await page.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
    let payees = null;
    for (const box of await page.getByRole("textbox").all()) if ((await box.inputValue()).includes("designer@example.com")) payees = box;
    if (!payees) throw new Error("no payees field");
    await payees.fill((await payees.inputValue()).replace("designer@example.com", "unclaimed.designer@example.com"));
    await page.getByRole("button", { name: /^Seal & hold/ }).click();
    await page.getByText("PayPal hold backing this envelope").waitFor(T);
    await page.getByRole("button", { name: /Run the launch/ }).click();
    await page.getByText(/creative-agent asked to pay/).waitFor(T);
    const rail = page.getByTestId("paypal-rail");
    await rail.getByText("Placed the hold").waitFor(T);
    await rail.getByText("Sent a payout").waitFor(T);
    await page.getByTestId("recall").click();
    await page.getByTestId("statement").getByText("Recalled · refunded").waitFor(T);
    await rail.getByText("Cancelled an unclaimed payout").waitFor(T);
    await rail.getByText("Refunded a capture").waitFor(T);
    if (OUT) await page.screenshot({ path: `${OUT}/local-9-recall.png`, fullPage: true }).catch(() => {});
    // a refund: translator-agent gives back the $45 it was just paid from this envelope; PayPal refunds the capture
    const here = page.url();
    await page.getByTestId("statement").getByRole("link", { name: /translator-agent/ }).first().click();
    await page.getByTestId("bank-actions").getByRole("button", { name: "Give its last payment back" }).click();
    await page.getByTestId("bank-result").getByText("Refunded by PayPal.").waitFor(T);
    await page.goto(here);
    await page.getByTestId("statement").getByText("Refunded by the payee").waitFor(T);
    await page.getByTestId("refunded").getByText(/\$112\.00 was captured and then refunded/).waitFor(T);
    await page.getByTestId("paypal-rail").getByText("Refunded a capture").first().waitFor(T);
    console.log("refund: the agent that was paid gave $45 back; PayPal refunded the capture; the envelope shows $112 refunded and not spendable again");
    console.log("paypal record: hold, captures and payout listed; an unclaimed payout recalled by the owner: cancelled at PayPal, capture refunded");

    // The auditor: PayPal's own Agent Toolkit, cut down to reading, run by the gateway. It finds a dispute the gateway has not heard of.
    await page.goto(`${BASE}/auditor`);
    await page.getByTestId("auditor-reach").getByText("list_transactions").waitFor(T);
    await page.getByRole("button", { name: "create_refund" }).click();
    await page.getByTestId("auditor-refusal").getByText(/is not a tool the auditor has/).waitFor(T);
    await page.getByTestId("auditor-stage-dispute").click();
    await page.getByTestId("auditor-note").getByText(/has disputed payment/).waitFor(T);
    await page.getByTestId("auditor-run").click();
    await page.getByTestId("auditor-report").getByText(/thing(s)? needs? a person\./).waitFor(T);
    const proposal = page.getByTestId("auditor-proposal").filter({ hasText: "Answer the dispute" });
    await proposal.getByText("stands", { exact: true }).waitFor(T);
    await proposal.getByText("the gateway's sweep", { exact: true }).waitFor(T);
    await page.getByTestId("auditor-steps").getByText("PayPal Agent Toolkit").first().waitFor(T);
    if (OUT) await page.screenshot({ path: `${OUT}/local-9-auditor.png`, fullPage: true }).catch(() => {});
    await proposal.getByTestId("auditor-sweep").click();
    await page.getByTestId("auditor-note").getByText(/sent the signed evidence|belongs to its scheduler/).waitFor(T);
    // A gateway with CRON_SECRET keeps the sweep for its scheduler; the page then says so and the dispute waits for the next scheduled sweep.
    const swept = (await page.getByTestId("auditor-note").getByText(/sent the signed evidence/).count()) > 0;
    if (swept) {
      await page.getByTestId("auditor-run").click();
      await page.getByTestId("auditor-steps").getByText("list_disputes").waitFor(T);
      await page.getByTestId("auditor-report").waitFor(T);
      if (await page.getByTestId("auditor-proposal").filter({ hasText: "Answer the dispute" }).count()) throw new Error("the dispute was answered, yet the auditor still proposes answering it");
    }
    console.log(`auditor: read PayPal through PayPal's Agent Toolkit, was refused a refund tool, found a dispute the gateway had not heard of, proposed; ${swept ? "the gateway's sweep answered it; a second audit no longer proposes it" : "this gateway keeps the sweep for its scheduler (CRON_SECRET), and the page said so"}`);
  }
} catch (e) {
  failed = true;
  console.log("FAILED:", String(e).slice(0, 500));
  if (OUT) await page.screenshot({ path: `${OUT}/local-fail.png`, fullPage: true }).catch(() => {});
  // Where every open tab stood, and who held which browser lock: what is needed to tell a stuck in-browser database from a slow one.
  for (const [i, p] of ctx.pages().entries()) {
    const state = await Promise.race([
      p.evaluate(async () => {
        const q = await navigator.locks.query();
        const f = (l) => `${l.name.replace(/^pglite-/, "").slice(0, 26)}@${(l.clientId ?? "").slice(0, 5)}`;
        return `${location.pathname} · held ${q.held.map(f).join(", ") || "none"} · waiting ${q.pending.map(f).join(", ") || "none"} · text: ${document.body.innerText.slice(0, 90).replace(/\n+/g, " | ")}`;
      }),
      new Promise((r) => setTimeout(() => r("did not answer in 5 s"), 5000)),
    ]).catch((x) => `could not be asked: ${String(x).slice(0, 80)}`);
    console.log(`  tab ${i}: ${state}`);
  }
}
const real = logs.filter((l) => !l.includes("_rsc=") && !l.includes("preloaded using"));
if (real.length) console.log(real.slice(0, 25).join("\n"));
await browser.close();
console.log(failed ? "E2E FAILED" : "E2E PASSED");
process.exit(failed ? 1 : 0);
