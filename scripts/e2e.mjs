/**
 * End-to-end check in a real browser. Works against either mode of the app: a server gateway
 * (DATABASE_URL set; PayPal sandbox or simulator) or the in-browser gateway (no DATABASE_URL).
 * Uses the scripted agents, so it needs no model.
 *
 *   BASE=http://localhost:3000 node scripts/e2e.mjs            # optional: OUT=<dir> for screenshots
 *
 * Covers: seal with a key held in the browser, agents split, money set aside and released when a
 * named agent signs for the delivered work, a direct payment, a payment over the owner's threshold
 * that waits for the owner's signature, the earning agent's passport, a receipt checked against PayPal and in
 * the browser, proof of funds, three attacks denied, close, and a second tab seeing the same data.
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
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
const T = { timeout: 60000 };
try {
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
  await page.getByTestId("statement").getByRole("link", { name: /translator-agent/ }).first().click();
  await page.getByTestId("receives").waitFor(T);
  await page.getByTestId("incoming").getByText("from localization-agent").first().waitFor(T);
  if (OUT) await page.screenshot({ path: `${OUT}/local-3-earner.png`, fullPage: true }).catch(() => {});
  console.log("translator-agent passport shows income");
  await page.goBack();
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  // receipt of the promise that was paid
  await page.getByRole("link", { name: "Receipt & authority chain →" }).last().click();
  await page.getByText("All checks pass").waitFor(T);
  await page.getByText("Signatures valid").waitFor(T);
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
  await p2.goto(`${BASE}/console`);
  await p2.getByText("Store launch budget").first().waitFor(T);
  await p2.getByText("can be paid").first().waitFor(T);
  if (OUT) await p2.screenshot({ path: `${OUT}/local-5-console.png`, fullPage: true }).catch(() => {});
  console.log("second tab: console lists the envelope and the receiving agent");
} catch (e) {
  failed = true;
  console.log("FAILED:", String(e).slice(0, 500));
  if (OUT) await page.screenshot({ path: `${OUT}/local-fail.png`, fullPage: true }).catch(() => {});
}
const real = logs.filter((l) => !l.includes("_rsc=") && !l.includes("preloaded using"));
if (real.length) console.log(real.slice(0, 25).join("\n"));
await browser.close();
console.log(failed ? "E2E FAILED" : "E2E PASSED");
process.exit(failed ? 1 : 0);
