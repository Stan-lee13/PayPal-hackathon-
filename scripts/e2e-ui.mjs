// UI end-to-end run of the demo scenario against a running Kept instance.
// Usage: BASE_URL=http://localhost:3000 MERCHANT_PASSCODE=... node scripts/e2e-ui.mjs [outDir]
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
await page.screenshot({ path: `${OUT}/02-simulated-approval.png` });
await page.getByRole("button", { name: /Approve & pay/ }).click();
await page.getByRole("link", { name: /Open my living receipt/ }).waitFor({ timeout: 30000 });
const receiptHref = await page.getByRole("link", { name: /Open my living receipt/ }).getAttribute("href");
step(`captured; receipt ${receiptHref}`);

const m = await ctx.newPage();
await m.goto(`${BASE}/merchant/login`);
await m.getByLabel("Passcode").fill(PASS);
await m.getByRole("button", { name: "Sign in" }).click();
await m.waitForURL(`${BASE}/merchant`);
for (let i = 0; i < 20; i++) {
  if (await m.getByText(/Remedy awaiting approval/).count()) break;
  await m.waitForTimeout(1000); await m.reload();
}
await m.screenshot({ path: `${OUT}/03-merchant-inbox.png`, fullPage: true });
step("merchant inbox shows the broken promise");
await m.locator('a[href^="/merchant/orders/ko_"]').first().click();
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).waitFor();
await m.screenshot({ path: `${OUT}/04-order-ledger.png`, fullPage: true });
await m.getByRole("button", { name: /Approve & refund \$9\.33/ }).click();
await m.getByText("Refund COMPLETED — confirmed by PayPal").waitFor({ timeout: 30000 });
step("merchant approved; refund confirmed");
await m.screenshot({ path: `${OUT}/05-order-ledger-refunded.png`, fullPage: true });

const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
const r = await phone.newPage();
await r.goto(`${BASE}${receiptHref}`);
await r.getByText(/confirmed COMPLETED by PayPal/).waitFor({ timeout: 20000 });
const overflow = await r.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step(`receipt updated (360px horizontal overflow: ${overflow})`);
await r.screenshot({ path: `${OUT}/06-receipt-mobile.png`, fullPage: true });
const s = await phone.newPage();
await s.goto(`${BASE}/store`);
await s.screenshot({ path: `${OUT}/07-store-mobile.png`, fullPage: true });
const storeOverflow = await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step(`store 360px horizontal overflow: ${storeOverflow}`);
await browser.close();
if (overflow || storeOverflow) process.exit(2);
