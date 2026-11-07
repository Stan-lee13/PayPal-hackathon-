/**
 * Drives the public demo in a real browser, end to end (simulated PayPal + GitHub):
 * client accepts → agent drafts → developer approves → client pays on the payer page →
 * the playground shows the merge. Then: a fresh PR, a late commit after invoicing → payment
 * does NOT merge. Screenshots go to docs/screenshots/.
 *
 *   BASE=http://localhost:3000 node scripts/e2e-demo.mjs
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "docs/screenshots";
const SCALE = Number(process.env.SCALE ?? 1);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
const fail = (m) => { throw new Error(m); };
const step = (m) => console.log(`• ${m}`);

// start clean: sign in and reset the demo (also resets the server's simulators)
await page.goto(`${BASE}/app/login`);
await page.getByLabel("Passcode").fill(process.env.PASSCODE ?? fail("set PASSCODE"));
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Invoices" }).waitFor();
const reset = await page.evaluate(async () => (await fetch("/api/app/reset", { method: "POST" })).status);
if (reset !== 200) fail(`reset failed: ${reset}`);
step("signed in, demo reset");

await page.goto(`${BASE}/`);
await page.getByRole("heading", { name: "Get paid before you merge." }).waitFor();
await page.waitForTimeout(800); // let the entrance animation finish
await page.screenshot({ path: `${OUT}/01-home.png` });
step("home page");

await page.goto(`${BASE}/demo`);
await page.getByText("You just opened PR").waitFor();
const accept = page.getByRole("button", { name: /^Accept as/ });
if (await accept.isVisible()) { await accept.click(); await page.getByText("Client accepted merge-on-payment").waitFor(); step("client accepted terms"); }

await page.getByRole("button", { name: /^Bill .* for PR #/ }).click();
await page.getByText("Here's the draft, priced from your contract").waitFor({ timeout: 30000 });
await page.getByText("Not covered by the agreed issues — not billed").first().waitFor();
const draftText = await page.locator("section[aria-label='Agent conversation']").innerText();
if (!draftText.includes("$530.00")) fail("draft total is not $530.00");
if (!draftText.includes("lib/analytics.ts")) fail("scope check did not flag lib/analytics.ts");
await page.screenshot({ path: `${OUT}/02-draft.png` });
step("draft: $530.00, analytics flagged as not billed");

await page.getByRole("button", { name: "Looks right — send it" }).click();
await page.getByText("Sent through PayPal to").waitFor({ timeout: 30000 });
const payLink = page.getByRole("link", { name: "Open the PayPal invoice ↗" });
await payLink.waitFor();
await page.screenshot({ path: `${OUT}/03-sent.png` });
step("sent via PayPal (simulated)");

const href = await payLink.getAttribute("href");
const payer = await ctx.newPage();
await payer.goto(href);
await payer.getByText("Simulated payment page.").waitFor();
await payer.screenshot({ path: `${OUT}/04-payer.png` });
await payer.getByRole("button", { name: /^Pay \$530\.00/ }).click();
await payer.getByText(/^Paid\. PayPal/).first().waitFor({ timeout: 30000 });
await payer.close();
await page.bringToFront();
step("client paid");

await page.getByText(/merged commit [0-9a-f]{7} into/).waitFor({ timeout: 20000 });
await page.getByText("Paid · merged").first().waitFor();
await page.screenshot({ path: `${OUT}/05-merged.png` });
step("playground narrated: webhook → re-read → merged");

// Replay: a late commit after invoicing must block the merge
await page.getByRole("button", { name: "Start again with a new pull request" }).click();
await page.getByText(/^New pull request #\d+/).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: /^Bill .* for PR #/ }).click();
await page.getByText("Here's the draft, priced from your contract").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Looks right — send it" }).click();
await page.getByText("Sent through PayPal to").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Sneak in one more commit" }).click();
await page.getByText(/A new commit was pushed to PR #\d+ after the invoice went out/).waitFor();
const href2 = await page.getByRole("link", { name: "Open the PayPal invoice ↗" }).getAttribute("href");
const payer2 = await ctx.newPage();
await payer2.goto(href2);
await payer2.getByRole("button", { name: /^Pay \$530\.00/ }).click();
await payer2.getByText(/^Paid\. PayPal/).first().waitFor({ timeout: 30000 });
await payer2.close();
await page.bringToFront();
await page.getByText(/paid, but not merged: The PR changed after invoicing/).waitFor({ timeout: 20000 });
await page.screenshot({ path: `${OUT}/06-blocked.png` });
step("late commit → paid but NOT merged");

// Dashboard (already signed in)
await page.goto(`${BASE}/app`);
await page.getByRole("heading", { name: "Invoices" }).waitFor();
await page.getByText("Paid · merged").first().waitFor();
await page.screenshot({ path: `${OUT}/07-dashboard.png` });
await page.locator(".ag-row").filter({ hasText: "Paid · merged" }).first().click();
await page.getByText(/Chain intact · \d+ entries/).waitFor();
await page.screenshot({ path: `${OUT}/08-invoice-trail.png`, fullPage: true });
step("dashboard grid + verified audit trail");

await browser.close();
console.log("E2E demo passed.");
