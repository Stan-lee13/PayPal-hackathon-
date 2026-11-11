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
await page.locator(".env", { hasText: "localization-agent" }).first().waitFor();
if ((await page.getByText(/^capture \S+ · payout \S+/).count()) < 2) throw new Error("expected two captured + paid-out spends");
step("agents split offline and paid: two captures + two payouts");
await page.screenshot({ path: `${OUT}/04-paid.png`, fullPage: true });

await page.getByRole("button", { name: "Compromise the creative agent" }).click();
await page.getByText(/forged a bigger envelope/).waitFor(T);
await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
for (const code of ["PAYEE_NOT_ALLOWED", "OVER_ENVELOPE_LIMIT", "WIDENED_LIMIT"]) await page.getByText(code).first().waitFor();
step("compromised agent denied three ways: wrong payee, over its envelope, forged wider envelope");
await page.screenshot({ path: `${OUT}/05-denied.png`, fullPage: true });

await page.locator(".env", { hasText: "creative-agent" }).last().getByRole("button", { name: "Revoke" }).click();
await page.getByText(/You revoked creative-agent's envelope/).waitFor(T);
step("owner revoked the creative agent (signed in the browser)");

await page.getByRole("link", { name: "Receipt & authority chain →" }).first().click();
await page.getByText("All checks pass").waitFor(T);
await page.getByText("Signatures valid").waitFor(T);
step("receipt: reconciled against PayPal, and signatures re-verified in the browser");
await page.screenshot({ path: `${OUT}/06-receipt.png`, fullPage: true });
await page.goBack();

await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
await page.getByText(/You closed the envelope\. PayPal released \$\d+\.\d\d of the hold/).waitFor(T);
await page.getByText("Closed").first().waitFor();
step(await page.getByText(/You closed the envelope/).innerText());
await page.screenshot({ path: `${OUT}/07-closed.png`, fullPage: true });

await browser.close();
console.log("E2E passed.");
