// UI end-to-end run of a dispute answered from the promise ledger against a running Kept instance (simulated PayPal only).
// Usage: BASE_URL=http://localhost:3000 MERCHANT_PASSCODE=... node scripts/e2e-dispute.mjs [outDir]
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

const tour = await ctx.newPage();
await tour.goto(`${BASE}/tour`);
await tour.getByRole("heading", { name: /Three promises/ }).waitFor();
await tour.screenshot({ path: `${OUT}/T1-tour.png`, fullPage: true });
step("tour page renders");

const page = await ctx.newPage();
await page.goto(`${BASE}/store`);
await page.getByLabel("Quantity of Ada Wrap Dress").selectOption("1");
await page.getByRole("radio", { name: /Express/ }).check();
await page.waitForTimeout(500);
await page.getByLabel("Message").fill("What's my total with express shipping?");
await page.getByRole("button", { name: "Send" }).click();
await page.getByText("Your total is $84.00.").first().waitFor({ timeout: 30000 });
await page.getByRole("button", { name: /Pay with simulated PayPal/ }).click();
await page.getByRole("button", { name: /Approve & pay/ }).click();
const receipt = page.getByRole("link", { name: /Open my living receipt/ });
await receipt.waitFor({ timeout: 30000 });
const receiptHref = await receipt.getAttribute("href");
step("order captured");

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

await m.getByLabel("Tracking number").fill("DHL7654321");
await m.getByRole("button", { name: "Add tracking" }).click();
await m.getByText("Tracking added to PayPal ✓").waitFor({ timeout: 20000 });
step("tracking added to the PayPal order");

await m.getByText("Play the buyer: open a dispute").click();
await m.getByRole("button", { name: /I never received it/ }).click();
await m.getByText(/Dispute opened: item not received ✓/).waitFor({ timeout: 20000 });
await m.reload();
await m.getByText(/Nothing is sent to PayPal until you approve it/).waitFor({ timeout: 20000 });
const approve = m.getByRole("button", { name: "Approve & send to PayPal" });
await approve.waitFor();
await approve.scrollIntoViewIfNeeded();
await m.screenshot({ path: `${OUT}/D1-dispute-proposed.png`, fullPage: true });
step("Kept proposed proof of fulfilment; waiting for approval");
await approve.click();
await m.getByText(/Accepted by PayPal — dispute now UNDER_REVIEW/).waitFor({ timeout: 30000 });
await m.reload();
await m.screenshot({ path: `${OUT}/D2-dispute-sent.png`, fullPage: true });
step("evidence accepted by (simulated) PayPal; dispute UNDER_REVIEW");

const r = await ctx.newPage();
await r.goto(`${BASE}${receiptHref}`);
await r.getByText(/Your PayPal dispute/).waitFor({ timeout: 20000 });
await r.screenshot({ path: `${OUT}/D3-dispute-receipt.png`, fullPage: true });
step("receipt shows the dispute and the merchant's response");
await browser.close();
