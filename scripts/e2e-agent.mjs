// UI end-to-end run of the agent-to-agent scenario against a running Kept instance (simulated PayPal).
// Usage: BASE_URL=http://localhost:3000 MERCHANT_PASSCODE=... node scripts/e2e-agent.mjs [outDir]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASS = process.env.MERCHANT_PASSCODE ?? "adaeze-demo";
const OUT = process.argv[2] ?? "./e2e-shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const step = (m) => console.log(`• ${m}`);
// This demo is about AFTER payment (fault attribution): use the monitor-only checkout (price check = Warn).
const admin = await ctx.newPage();
await admin.goto(`${BASE}/merchant/login`);
await admin.getByLabel("Passcode").fill(PASS);
await admin.getByRole("button", { name: "Sign in" }).click();
await admin.waitForURL(`${BASE}/merchant`);
const setGuard = (mode) => admin.evaluate(async (mode) => (await fetch("/api/merchant/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutGuard: mode }) })).status, mode);
if ((await setGuard("WARN")) !== 200) throw new Error("could not set the price check to Warn");

// 1. A mandate the merchant cannot meet is declined before any payment exists.
await page.goto(`${BASE}/store`);
await page.getByRole("tab", { name: "Send my AI agent" }).click();
await page.getByRole("textbox", { name: "Mandate" }).fill("Buy me the Ada wrap dress. Keep the total under $60 and it must ship within 2 days.");
await page.getByRole("button", { name: "Send my agent" }).click();
await page.getByText(/Mandate check \(deterministic\) · declined/).waitFor({ timeout: 60000 });
if (await page.getByRole("button", { name: /Pay with/ }).count()) throw new Error("pay button shown after DECLINE");
step("agent declined a $60 mandate; no pay button");
await page.screenshot({ path: `${OUT}/A1-agent-declined.png`, fullPage: true });

// 2. The default $90 mandate clears against the $84.00 quote.
await page.getByRole("textbox", { name: "Mandate" }).fill("Buy me the Ada wrap dress. Keep the total under $90 and it must ship within 2 days.");
await page.getByRole("button", { name: "Send my agent" }).click();
await page.getByText(/Mandate check \(deterministic\) · cleared/).waitFor({ timeout: 60000 });
step("agent cleared the $84.00 quote against a $90 mandate");
await page.screenshot({ path: `${OUT}/A2-agent-cleared.png`, fullPage: true });

await page.getByRole("button", { name: /Pay with simulated PayPal/ }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("button", { name: /Approve & pay/ }).click();
await page.getByRole("link", { name: /Open my living receipt/ }).waitFor({ timeout: 30000 });
const receiptHref = await page.getByRole("link", { name: /Open my living receipt/ }).getAttribute("href");
step(`shopper approved the payment; receipt ${receiptHref}`);

// 3. Merchant sees the broken mandate, the attribution, and the $9.33 remedy.
const m = await ctx.newPage();
await m.goto(`${BASE}/merchant/login`);
await m.getByLabel("Passcode").fill(PASS);
await m.getByRole("button", { name: "Sign in" }).click();
await m.waitForURL(`${BASE}/merchant`);
for (let i = 0; i < 20; i++) {
  if (await m.getByText(/Remedy awaiting approval/).count()) break;
  await m.waitForTimeout(1000); await m.reload();
}
await m.locator('a[href^="/merchant/orders/ko_"]').first().click();
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).waitFor({ timeout: 20000 });
const blame = await m.getByText(/Accountable: merchant/i).count();
if (!blame) throw new Error("ledger does not attribute the broken mandate to the merchant");
step("ledger: mandate broken, accountable: merchant");
await m.screenshot({ path: `${OUT}/A3-agent-ledger.png`, fullPage: true });
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).click();
await m.getByText("Refund COMPLETED — confirmed by PayPal").waitFor({ timeout: 30000 });
step("refund approved and confirmed");
await m.reload();
await m.screenshot({ path: `${OUT}/A4-agent-ledger-refunded.png`, fullPage: true });

// 4. The receipt shows the shopper's own instruction as a promise, now made good.
const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
const r = await phone.newPage();
await r.goto(`${BASE}${receiptHref}`);
await r.getByText(/confirmed COMPLETED by PayPal/).waitFor({ timeout: 20000 });
if (!(await r.getByText(/your instruction to your agent/).count())) throw new Error("receipt lacks the mandate");
const overflow = await r.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step(`receipt shows the mandate (360px horizontal overflow: ${overflow})`);
await r.screenshot({ path: `${OUT}/A5-agent-receipt-mobile.png`, fullPage: true });
await setGuard("BLOCK");
await browser.close();
if (overflow) process.exit(2);
