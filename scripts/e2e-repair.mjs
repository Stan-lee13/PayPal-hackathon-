// DEMONSTRATION 2 — REPAIR WHAT WAS ALREADY PAID (simulated PayPal).
// A separate order, captured OUTSIDE Kept's checkout: $84.00 promised, $93.33 captured.
// Kept detects the $9.33 gap after payment, the merchant approves the refund, PayPal confirms it.
// Usage: BASE_URL=http://localhost:3000 MERCHANT_PASSCODE=... node scripts/e2e-repair.mjs [outDir]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASS = process.env.MERCHANT_PASSCODE ?? "adaeze-demo";
const OUT = process.argv[2] ?? "./e2e-shots";
fs.mkdirSync(OUT, { recursive: true });
const step = (msg) => console.log(`• ${msg}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const m = await ctx.newPage();
await m.goto(`${BASE}/merchant/login`);
await m.getByLabel("Passcode").fill(PASS);
await m.getByRole("button", { name: "Sign in" }).click();
await m.waitForURL(`${BASE}/merchant`);
await m.getByText("Demo tools").click();
await m.getByRole("button", { name: /Add an order captured outside Kept/ }).click();
await m.getByText(/Added an order captured outside Kept's checkout: done/).waitFor({ timeout: 30000 });
step("an order captured outside Kept's checkout: $84.00 promised, $93.33 captured");
for (let i = 0; i < 20; i++) { if (await m.getByText(/Remedy awaiting approval/).count()) break; await m.waitForTimeout(1000); await m.reload(); }
await m.screenshot({ path: `${OUT}/R1-inbox.png`, fullPage: true });
await m.locator('a[href^="/merchant/orders/ko_"]').first().click();
await m.getByText(/This payment was captured/).waitFor();
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).waitFor({ timeout: 20000 });
step("Kept detected the $9.33 overcharge after payment and proposed a refund");
await m.screenshot({ path: `${OUT}/R2-ledger-broken.png`, fullPage: true });
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).click();
await m.getByText("Refund COMPLETED — confirmed by PayPal").waitFor({ timeout: 30000 });
step("merchant approved; PayPal refund confirmed by GET");
await m.reload();
await m.screenshot({ path: `${OUT}/R3-ledger-refunded.png`, fullPage: true });
const receiptHref = await m.getByRole("link", { name: /Customer receipt/ }).getAttribute("href");
const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
const r = await phone.newPage();
await r.goto(`${BASE}${receiptHref}`);
await r.getByText(/confirmed COMPLETED by PayPal/).waitFor({ timeout: 20000 });
await r.getByText(/outside Kept's checkout/).waitFor();
step("receipt: broken · made good, refund confirmed");
await r.screenshot({ path: `${OUT}/R4-receipt-mobile.png`, fullPage: true });
await browser.close();
