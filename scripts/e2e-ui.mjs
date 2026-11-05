// DEMONSTRATION 1 — STOP THE MISMATCH (simulated PayPal, protected checkout, price check = Block).
// The assistant promises $84.00; the PayPal order is $93.33; Kept fetches the order before capture,
// blocks it, the merchant corrects it, the buyer approves $84.00, Kept verifies and captures.
// Usage: BASE_URL=http://localhost:3000 MERCHANT_PASSCODE=... node scripts/e2e-ui.mjs [outDir]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASS = process.env.MERCHANT_PASSCODE ?? "adaeze-demo";
const OUT = process.argv[2] ?? "./e2e-shots";
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log(`• ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/store`);
await page.getByLabel("Quantity of Ada Wrap Dress").selectOption("1");
await page.getByRole("radio", { name: /Express/ }).check();
await page.waitForTimeout(500);
await page.getByLabel("Message").fill("What's my total with express shipping?");
await page.getByRole("button", { name: "Send" }).click();
await page.getByText("Your total is $84.00.").first().waitFor({ timeout: 30000 });
step("assistant promised $84.00 and 48h shipping");
await page.getByText(/Kept · price check before you pay/i).waitFor({ timeout: 15000 });
step("pre-payment price check warned: promised $84.00, checkout $93.33");
await page.screenshot({ path: `${OUT}/01-store-chat.png`, fullPage: true });

await page.getByRole("button", { name: /Pay with simulated PayPal/ }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("button", { name: /Approve & pay/ }).click();
await page.getByText(/Payment mismatch detected/i).waitFor({ timeout: 30000 });
await page.getByText("Capture blocked", { exact: true }).waitFor();
await page.getByText(/Nothing has been charged/).waitFor();
if (await page.getByRole("link", { name: /Open my living receipt/ }).count()) throw new Error("a receipt appeared for a blocked payment");
step("Kept fetched the PayPal order before capture: BLOCKED_MISMATCH ($84.00 vs $93.33) — nothing charged");
await page.screenshot({ path: `${OUT}/02-capture-blocked.png`, fullPage: true });

const m = await ctx.newPage();
await m.goto(`${BASE}/merchant/login`);
await m.getByLabel("Passcode").fill(PASS);
await m.getByRole("button", { name: "Sign in" }).click();
await m.waitForURL(`${BASE}/merchant`);
await m.getByText(/Checkouts held by Kept before capture/).waitFor({ timeout: 20000 });
await m.screenshot({ path: `${OUT}/03-merchant-held.png`, fullPage: true });
await m.locator('a[href^="/merchant/orders/ko_"]').first().click();
await m.getByText("Kept blocked this capture").waitFor();
await m.screenshot({ path: `${OUT}/04-order-blocked.png`, fullPage: true });
await m.getByRole("button", { name: /Correct the order to the promised \$84\.00/ }).click();
await m.getByText(/Corrected order sent — waiting for the buyer/).waitFor({ timeout: 20000 });
step("merchant corrected the order to the promised $84.00 (a new PayPal order; the blocked one is never captured)");

await page.bringToFront();
await page.getByText("Corrected order ready").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: /Pay with simulated PayPal/ }).click();
await page.getByRole("dialog").getByText("$84.00").waitFor();
await page.getByRole("button", { name: /Approve & pay/ }).click();
await page.getByText(/Promise verified before capture/).waitFor({ timeout: 30000 });
const receiptHref = await page.getByRole("link", { name: /Open my living receipt/ }).getAttribute("href");
step(`buyer approved $84.00; Kept re-verified (READY_TO_CAPTURE) and captured; receipt ${receiptHref}`);
await page.screenshot({ path: `${OUT}/05-verified-captured.png`, fullPage: true });

await m.reload();
await m.getByText(/READY_TO_CAPTURE/).first().waitFor({ timeout: 20000 });
for (let i = 0; i < 15 && !(await m.getByText(/\$84\.00/).count()); i++) { await m.waitForTimeout(1000); await m.reload(); }
await m.screenshot({ path: `${OUT}/06-order-ledger-kept.png`, fullPage: true });

const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
const r = await phone.newPage();
await r.goto(`${BASE}${receiptHref}`);
await r.getByText(/never charged/).waitFor({ timeout: 20000 });
const overflow = await r.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step(`receipt shows the blocked order was never charged (360px horizontal overflow: ${overflow})`);
await r.screenshot({ path: `${OUT}/07-receipt-mobile.png`, fullPage: true });
const s = await phone.newPage();
await s.goto(`${BASE}/store`);
const storeOverflow = await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step(`store 360px horizontal overflow: ${storeOverflow}`);
await browser.close();
if (overflow || storeOverflow) process.exit(2);
