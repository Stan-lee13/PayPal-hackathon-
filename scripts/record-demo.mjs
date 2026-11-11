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
// Enlarge the app for legibility at video resolution.
await ctx.addInitScript(() => {
  const zoom = () => { document.documentElement.style.zoom = "1.16"; };
  if (document.documentElement) zoom();
  document.addEventListener("DOMContentLoaded", zoom);
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const T = { timeout: 90000 };

/** Caption bar at the bottom of the page; survives until the next full navigation. */
async function say(text, ms = 4200) {
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99998;padding:15px 44px 19px;background:#17140F;color:#FCFAF4;font:500 20px/1.38 var(--font-ui),system-ui,sans-serif;text-align:center;border-top:3px solid #B5301B";
      document.body.appendChild(el);
      document.body.style.paddingBottom = "120px";
    }
    el.textContent = t;
  }, text);
  await wait(ms);
}
/** A full-screen title card, set in the app's own type. Removed by the next navigation or by uncard(). */
async function card(title, lines, ms) {
  await page.evaluate(({ title, lines }) => {
    document.getElementById("__card")?.remove();
    const el = document.createElement("div");
    el.id = "__card";
    el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F3EEE3;color:#17140F;text-align:center;padding:0 70px";
    el.innerHTML = `<div class="display" style="font-size:62px;max-width:940px">${title}</div>` + lines.map((l) => `<div style="margin-top:26px;font:400 23px/1.45 var(--font-ui),system-ui,sans-serif;color:#5B5447;max-width:820px">${l}</div>`).join("");
    document.body.appendChild(el);
  }, { title, lines });
  await wait(ms);
}
const uncard = () => page.evaluate(() => document.getElementById("__card")?.remove());
const scrollTo = (sel) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: "center" }), sel);
const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
const holdCard = () => page.getByText("PayPal hold backing this envelope").waitFor(T);

// 1–2. The problem
await page.goto(`${BASE}/`);
await card("Give your agent an envelope, <em>not your wallet.</em>", ["Envelope · spending authority for AI agents, backed by a PayPal hold"], 5000);
await card("An AI agent that can pay holds <em>your whole credential.</em>", ["So does every sub-agent it calls. Limits don't add up across agents, a payee can't tell if the agent can pay, and afterwards nobody can say who authorized a payment."], 9000);

// 3. What it is
await uncard();
await page.getByRole("heading", { name: "Give your agent an envelope, not your wallet." }).waitFor();
await say("An envelope is money PayPal is already holding, with your limits signed onto it. Agents can tear off smaller envelopes for the agents they hire. Never bigger ones.", 8000);

// 4. Seal
await page.goto(`${BASE}/console`);
await page.getByText(/Signed with your key [A-Za-z0-9_-]{6}…/).waitFor(T);
await say("Ada seals a $200 envelope for her ops agent: two payees, two purposes, six hours. She signs it in her own browser.", 6500);
await scrollTo("form button");
await page.getByRole("button", { name: /^Seal & hold \$200\.00 on PayPal/ }).click();
await holdCard();
await page.getByText("(you)").waitFor();
await say("PayPal places a real authorization for $200. Nothing is charged yet, and PayPal itself will refuse to capture more.", 7000);

// 5. Agents split and pay
await scrollTo('[data-testid="controls"]');
await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).click();
await say("The ops agent tears off two smaller envelopes for its sub-agents. That is just a signature: no server is asked.", 6000);
await page.getByText(/creative-agent asked to pay/).waitFor(T);
await page.getByRole("button", { name: "Run the launch (agents split & pay)" }).waitFor(T);
await top();
await say("Each sub-agent pays its vendor: a partial capture of Ada's hold, then a PayPal payout. Budgets are debited at every level.", 7500);

// 6. Know your agent
await scrollTo('[data-testid="node-creative-agent"]');
await wait(900);
await page.getByTestId("node-creative-agent").getByRole("link", { name: /creative-agent/ }).click();
await page.getByRole("heading", { name: "Is it good for the money?" }).waitFor(T);
await page.getByText("In good standing").first().waitFor(T);
await say("Every agent has a passport: an account number drawn from its key, and everyone standing behind it, back to a person.", 6500);
await page.getByLabel("For (USD)").fill("20");
await page.getByRole("button", { name: "Ask the gateway" }).click();
await page.getByTestId("standing").getByText("Signature checked in your browser.").waitFor(T);
await scrollTo('[data-testid="standing"]');
await say("Before working for it, a payee asks: is it good for the money? The gateway proves the agent's key and asks PayPal whether the hold is still there.", 8500);
await page.goBack();
await holdCard();

// 7. Compromise
await scrollTo('[data-testid="controls"]');
await say("Now suppose the creative agent is compromised.", 2600);
await page.getByRole("button", { name: "Compromise the creative agent" }).click();
await page.getByText(/forged a bigger envelope/).waitFor(T);
await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
await top();
await say("“Pay this new address.” Denied: the payee is not on its envelope. Overspend: denied.", 6000);
await say("Forge itself a bigger envelope: denied. No AI decides any of this. The gateway reads signatures and numbers.", 7000);

// 8. Revoke
await scrollTo('[data-testid="node-creative-agent"]');
await page.getByTestId("node-creative-agent").getByRole("button", { name: "Revoke" }).click();
await page.getByText(/You revoked creative-agent's envelope/).waitFor(T);
await say("Ada revokes that agent with one signature. It, and anything torn off from it, is dead.", 5200);

// 9. Receipt
await top();
await page.getByRole("link", { name: "Receipt & authority chain →" }).first().click();
await page.getByText("All checks pass").waitFor(T);
await page.getByText("Signatures valid").waitFor(T);
await say("Every payment has a receipt: who authorized this dollar, all the way up to Ada, tied to the PayPal capture and payout.", 7000);
await say("It is checked against PayPal's own records, and re-verified here in the browser.", 5000);
await page.goBack();
await holdCard();

// 10. Close
await scrollTo('[data-testid="controls"]');
await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
await page.getByText(/You closed the envelope\. PayPal released/).waitFor(T);
await top();
await say("Ada closes the envelope. PayPal voids the rest of the hold: she paid only for what her agents actually did.", 7000);

// 11. Real AI agents
if (process.env.AGENT_RUN_ROOT) {
  await page.goto(`${BASE}/e/${process.env.AGENT_RUN_ROOT}`);
  await holdCard();
  await say("We also handed envelopes to real Claude agents. The orchestrator chose least-privilege limits for three sub-agents by itself.", 7000);
  await page.evaluate(() => window.scrollTo({ top: 420, behavior: "smooth" }));
  await say("A red-team agent then tried twelve ways to spend beyond its $10 envelope. It moved $0 outside its authority.", 7500);
}

// 12. Close
await card("Seal is an authorization.<br>Spend is a capture and a payout.<br><em>Close is a void.</em>", ["Three things PayPal already does become money an agent can pass on safely, and prove it has.", "Envelope · open source · github.com/Stan-lee13/PayPal-hackathon-"], 7000);

await ctx.close();
await browser.close();
const f = readdirSync(OUT).filter((x) => x.endsWith(".webm")).sort().pop();
renameSync(`${OUT}/${f}`, `${OUT}/envelope-demo.webm`);
console.log(`Saved ${OUT}/envelope-demo.webm`);
