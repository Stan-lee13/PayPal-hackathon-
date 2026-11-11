/**
 * Records the demo video: drives the real app in Chromium with captions burned into the page, and
 * saves a .webm (convert with ffmpeg). Run the app in PayPal sandbox mode first.
 *
 *   BASE=http://localhost:3000 OUT=/tmp/demo node scripts/record-demo.mjs
 *   AGENT_RUN_ROOT=<root id of an envelope used by external agents>   (optional extra scene)
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "demo-video";
const W = 1280, H = 720;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, colorScheme: "light" });
// Enlarge the app for legibility at video resolution (title cards are left alone).
await ctx.addInitScript(() => {
  if (!location.protocol.startsWith("http")) return;
  const zoom = () => { document.documentElement.style.zoom = "1.18"; };
  if (document.documentElement) zoom();
  document.addEventListener("DOMContentLoaded", zoom);
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const T = { timeout: 90000 };

/** Caption bar at the bottom of the page; survives until the next navigation. */
async function say(text, ms = 4200) {
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:16px 40px 20px;background:rgba(11,12,15,.93);color:#fff;font:600 23px/1.35 'IBM Plex Sans',system-ui,sans-serif;text-align:center;letter-spacing:-.01em;box-shadow:0 -8px 30px rgba(0,0,0,.25)";
      document.body.appendChild(el);
      document.body.style.paddingBottom = "110px";
    }
    el.textContent = t;
  }, text);
  await wait(ms);
}
async function card(title, lines, ms) {
  await page.setContent(`<html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0B0C0F;color:#E8E9EC;font-family:'IBM Plex Sans',system-ui,sans-serif;text-align:center;padding:0 90px">
    <div style="font-size:58px;font-weight:650;letter-spacing:-.03em;line-height:1.08;max-width:1000px">${title}</div>
    ${lines.map((l) => `<div style="margin-top:26px;font-size:27px;line-height:1.4;color:#9CA2AD;max-width:940px">${l}</div>`).join("")}
  </body></html>`);
  await wait(ms);
}
const scrollTo = (sel) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: "center" }), sel);

// 1–2. The problem
await card("Give your agent an envelope,<br>not your wallet.", ["<b style='color:#8E86FF'>Envelope</b> · spending authority for AI agents, built on PayPal"], 5500);
await card("An AI agent that can pay<br>holds your whole credential.", ["So does every sub-agent it calls.", "Flat spending limits don't add up across agents, and afterwards nobody can say who authorized a payment."], 9500);

// 3. What it is
await page.goto(`${BASE}/`);
await page.getByRole("heading", { name: "Give your agent an envelope, not your wallet." }).waitFor();
await say("An envelope is signed spending authority, backed by a PayPal hold. Agents can split it for the agents they hire — but never enlarge it.", 7500);

// 4. Seal
await page.goto(`${BASE}/console`);
await page.getByText(/Signed with your key [A-Za-z0-9_-]{6}…/).waitFor(T);
await say("Ada seals a $200 envelope for her ops agent: two payees, two purposes, six hours. She signs it in her own browser.", 7000);
await page.getByRole("button", { name: /^Seal & hold \$200\.00 on PayPal/ }).click();
await page.getByText("PayPal hold backing this envelope").waitFor(T);
await page.getByText("(you)").waitFor();
await say("PayPal places a real authorization for $200. Nothing is charged yet — and PayPal itself will refuse to capture more.", 7500);

// 5. Agents split and pay
await scrollTo("section.card.space-y-3");
await say("Now the agents get to work.", 2200);
await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).click();
await say("The ops agent splits off two smaller envelopes for its sub-agents. That's just a signature: no server is asked.", 6500);
await page.getByText(/creative-agent asked to pay/).waitFor(T);
await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).waitFor(T);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await say("Each sub-agent pays its vendor: a partial capture of Ada's hold, then a PayPal payout. Budgets are debited at every level.", 8000);

// 6. Compromise
await scrollTo("section.card.space-y-3");
await say("Now suppose the creative agent is compromised.", 3000);
await page.getByRole("button", { name: "Compromise the creative agent" }).click();
await page.getByText(/forged a bigger envelope/).waitFor(T);
await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await say("“Pay this new address” — denied: the payee isn't on its envelope.", 5000);
await say("Overspend — denied. Forge itself a bigger envelope — denied: a block that widens its parent doesn't verify.", 7000);
await say("No AI decides any of this. The gateway reads signatures and numbers.", 4500);

// 7. Revoke
await page.locator(".env", { hasText: "creative-agent" }).last().getByRole("button", { name: "Revoke" }).click();
await page.getByText(/You revoked creative-agent's envelope/).waitFor(T);
await say("Ada revokes that agent with one signature. It, and anything split from it, is dead.", 5500);

// 8. Receipt
await page.getByRole("link", { name: "Receipt & authority chain →" }).first().click();
await page.getByText("All checks pass").waitFor(T);
await page.getByText("Signatures valid").waitFor(T);
await say("Every payment has a receipt: who authorized this dollar, all the way up to Ada, tied to the PayPal capture and payout.", 7500);
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
await say("It's checked against PayPal's own records, and re-verified here in the browser.", 6000);
await page.goBack();
await page.getByText("PayPal hold backing this envelope").waitFor(T);

// 9. Close
await scrollTo("section.card.space-y-3");
await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
await page.getByText(/You closed the envelope\. PayPal released/).waitFor(T);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await say("Ada closes the envelope. PayPal voids the rest of the hold: she paid only for what her agents actually did.", 8000);

// 10. Real AI agents
if (process.env.AGENT_RUN_ROOT) {
  await page.goto(`${BASE}/e/${process.env.AGENT_RUN_ROOT}`);
  await page.getByText("PayPal hold backing this envelope").waitFor(T);
  await say("We also handed envelopes to real Claude agents. The orchestrator chose least-privilege limits for three sub-agents by itself.", 7500);
  await page.evaluate(() => document.querySelector("aside")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  await say("A red-team agent then tried twelve ways to spend beyond its $10 envelope. It moved $0 outside its authority.", 8000);
}

// 11. Close
await card("Seal = authorize.<br>Spend = capture + payout.<br>Close = void.", ["Three PayPal primitives become spending authority that agents can pass on safely.", "<b style='color:#8E86FF'>Envelope</b> · open source · github.com/Stan-lee13/PayPal-hackathon-"], 8000);

await ctx.close();
await browser.close();
const f = readdirSync(OUT).filter((x) => x.endsWith(".webm")).sort().pop();
renameSync(`${OUT}/${f}`, `${OUT}/envelope-demo.webm`);
console.log(`Saved ${OUT}/envelope-demo.webm`);
