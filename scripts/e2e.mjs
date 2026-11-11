/**
 * Drives the console in a real browser, end to end: seal (browser-side signature + PayPal hold) →
 * agents split and pay → a compromised agent is denied three ways → revoke → close (hold released)
 * → receipt verified against PayPal and in the browser.
 *
 *   BASE=http://localhost:3000 node scripts/e2e.mjs
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) })).newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));
const step = (m) => console.log(`• ${m}`);
const T = { timeout: 90000 };

await page.goto(`${BASE}/`);
await page.getByRole("heading", { name: "Give your agent an envelope, not your wallet." }).waitFor();
await page.screenshot({ path: `${OUT}/01-home.png` });

await page.goto(`${BASE}/console`);
await page.getByText(/Signed with your key [A-Za-z0-9_-]{6}…/).waitFor(T);
await page.screenshot({ path: `${OUT}/02-seal.png` });
await page.getByRole("button", { name: /^Seal & hold \$200\.00 on PayPal/ }).click();
await page.getByText("PayPal hold backing this envelope").waitFor(T);
await page.getByText("(you)").waitFor();
const auth = await page.getByText(/^authorization \S+/).innerText();
step(`sealed in the browser; ${auth}`);
await page.screenshot({ path: `${OUT}/03-sealed.png` });

await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).click();
await page.getByText(/creative-agent asked to pay/).waitFor(T);
await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).waitFor(T);
await page.getByTestId("node-localization-agent").waitFor();
if ((await page.getByText(/^capture \S+ · payout \S+/).count()) < 2) throw new Error("expected two captured + paid-out spends");
step("agents split offline and paid: two captures + two payouts");
await page.screenshot({ path: `${OUT}/04-paid.png`, fullPage: true });

// Know your agent: a payee checks the creative agent before doing more work for it
await page.getByTestId("node-creative-agent").getByRole("link", { name: /creative-agent/ }).click();
await page.getByRole("heading", { name: "Is it good for the money?" }).waitFor(T);
await page.getByText("In good standing").first().waitFor(T);
await page.getByLabel("For (USD)").fill("20");
await page.getByRole("button", { name: "Ask the gateway" }).click();
await page.getByTestId("standing").getByText("Signature checked in your browser.").waitFor(T);
if (!(await page.getByTestId("standing").innerText()).includes("Good for $20.00")) throw new Error("expected a good statement of standing");
step("proof of funds: " + (await page.getByTestId("standing").getByText(/PARTIALLY_CAPTURED|CREATED/).innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: `${OUT}/05-passport.png`, fullPage: true });
await page.goBack();
await page.getByText("PayPal hold backing this envelope").waitFor(T);

await page.getByRole("button", { name: "Compromise the creative agent" }).click();
await page.getByText(/forged a bigger envelope/).waitFor(T);
await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
for (const code of ["PAYEE_NOT_ALLOWED", "OVER_ENVELOPE_LIMIT", "WIDENED_LIMIT"]) await page.getByText(code).first().waitFor();
step("compromised agent denied three ways: wrong payee, over its envelope, forged wider envelope");
await page.screenshot({ path: `${OUT}/06-denied.png`, fullPage: true });

await page.getByTestId("node-creative-agent").getByRole("button", { name: "Revoke" }).click();
await page.getByText(/You revoked creative-agent's envelope/).waitFor(T);
step("owner revoked the creative agent (signed in the browser)");

// the same check now fails, and says why
await page.getByTestId("node-creative-agent").getByRole("link", { name: /creative-agent/ }).click();
await page.getByRole("heading", { name: "Is it good for the money?" }).waitFor(T);
await page.getByLabel("For (USD)").fill("5");
await page.getByRole("button", { name: "Ask the gateway" }).click();
await page.getByTestId("standing").getByText("REVOKED").first().waitFor(T);
if (!(await page.getByTestId("standing").innerText()).includes("Would not pay")) throw new Error("expected a refused statement of standing after revocation");
step("after revocation the same check says: not good (REVOKED)");
await page.goBack();
await page.getByText("PayPal hold backing this envelope").waitFor(T);

await page.getByRole("link", { name: "Receipt & authority chain →" }).first().click();
await page.getByText("All checks pass").waitFor(T);
await page.getByText("Signatures valid").waitFor(T);
step("receipt: reconciled against PayPal, and signatures re-verified in the browser");
await page.screenshot({ path: `${OUT}/07-receipt.png`, fullPage: true });
await page.goBack();

await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
await page.getByText(/You closed the envelope\. PayPal released \$\d+\.\d\d of the hold/).waitFor(T);
await page.getByText("Closed").first().waitFor();
step(await page.getByText(/You closed the envelope/).innerText());
await page.screenshot({ path: `${OUT}/08-closed.png`, fullPage: true });

await browser.close();
console.log("E2E passed.");
