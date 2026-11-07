/**
 * Bounty demo in a real browser (simulated PayPal + GitHub): company posts and reserves funds →
 * a developer games CI and is caught → an honest developer is verified, approved and paid.
 *   BASE=http://localhost:3000 PASSCODE=… node scripts/e2e-bounty.mjs
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
const step = (m) => console.log(`• ${m}`);
const as = async (persona) => { await page.evaluate(async (p) => fetch("/api/persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: p }) }), persona); await page.reload(); };

// clean demo state (also resets the simulators)
await page.goto(`${BASE}/app/login`);
await page.getByLabel("Passcode").fill(process.env.PASSCODE);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Invoices" }).waitFor();
await page.evaluate(async () => fetch("/api/app/reset", { method: "POST" }));

await page.goto(`${BASE}/bounties/new`);
await as("company");
await page.getByRole("button", { name: "Reserve funds with PayPal →" }).click();
await page.getByText("Simulated approval page.").waitFor();
await page.screenshot({ path: `${OUT}/b1-reserve.png` });
await page.getByRole("button", { name: /Approve the hold/ }).click();
await page.getByText("PayPal authorization").waitFor();
await page.getByText(/^SIMAUTH/).waitFor();
step("company posted and reserved $315.00 on PayPal (authorization)");

const url = page.url().split("?")[0];
await as("quickfix");
await page.getByRole("button", { name: "Claim this bounty" }).click();
await page.getByLabel("Your pull request #").fill("33");
await page.getByRole("button", { name: "Submit for verification" }).click();
await page.getByText("Recommend rejecting: integrity").waitFor({ timeout: 30000 });
await page.screenshot({ path: `${OUT}/b2-cheat-caught.png`, fullPage: true });
step("CI-gaming submission caught: CI config edited, tests deleted and skipped");

await as("company");
await page.getByRole("button", { name: "Reject" }).click();
await page.getByText("open").first().waitFor();
await as("chidi");
await page.getByRole("button", { name: "Claim this bounty" }).click();
await page.getByLabel("Your pull request #").fill("32");
await page.getByRole("button", { name: "Submit for verification" }).click();
await page.getByText("Recommend paying").waitFor({ timeout: 30000 });
step("honest submission: every criterion proven by a passing test");

await as("company");
await page.getByRole("button", { name: "Approve & pay via PayPal" }).click();
await page.getByText(/^SIMBATCH|SUCCESS SIMBATCH/).first().waitFor({ timeout: 30000 });
await page.getByText(/bounty › paid/).waitFor();
await page.screenshot({ path: `${OUT}/b3-paid.png`, fullPage: true });
step("approved → captured → paid out via PayPal Payouts → PR merged");
await page.goto(`${BASE}/bounties`);
await page.screenshot({ path: `${OUT}/b4-board.png` });
await browser.close();
console.log("Bounty E2E passed.", url);
