/**
 * Records the demo video: drives the real app in Chromium, scene by scene, with captions burned
 * into the page. Each scene lasts as long as its narration line (scripts/demo-narration.json and
 * the durations written by scripts/narrate.py). Scenes that wait on a language model are marked
 * "fast"; scripts/assemble_demo.py speeds them up to fit their narration and labels them.
 *
 * Start the app first, in PayPal sandbox mode, with a model connected (see the README, "Live agents").
 *
 *   BASE=http://localhost:3000 OUT=/tmp/demo VO=/tmp/vo node scripts/record-demo.mjs
 *   python3 scripts/assemble_demo.py /tmp/demo /tmp/vo docs/demo/envelope-demo.mp4
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "demo-video";
const VO = process.env.VO ?? OUT;
const W = 1280, H = 720;
const lines = Object.fromEntries(JSON.parse(readFileSync(new URL("./demo-narration.json", import.meta.url), "utf8")).map((l) => [l.id, l]));
const durations = existsSync(`${VO}/durations.json`) ? JSON.parse(readFileSync(`${VO}/durations.json`, "utf8")) : {};
const spoken = (id) => durations[id] ?? Math.max(4, lines[id].say.split(/\s+/).length / 2.6);

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
const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;
const wait = (ms) => page.waitForTimeout(ms);
const T = { timeout: 120000 };
const timeline = [];

/** Caption bar at the bottom of the page; put back after every navigation while a scene is running. */
let captionText = "", fastTag = false;
async function paintCaption() {
  await page.evaluate(({ t, fast }) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99998;padding:14px 44px 18px;background:#17140F;color:#FCFAF4;font:500 19px/1.38 var(--font-ui),system-ui,sans-serif;text-align:center;border-top:3px solid #B5301B";
      document.body.appendChild(el);
      document.body.style.paddingBottom = "120px";
    }
    el.textContent = t;
    let tag = document.getElementById("__fast");
    if (fast && !tag) {
      tag = document.createElement("div");
      tag.id = "__fast";
      tag.textContent = "▸▸ sped up · the model is thinking";
      tag.style.cssText = "position:fixed;right:14px;top:40px;z-index:99998;padding:5px 10px;background:#1F3FA8;color:#fff;font:600 12px/1 var(--font-data),monospace;letter-spacing:.08em;border-radius:3px";
      document.body.appendChild(tag);
    } else if (!fast && tag) tag.remove();
  }, { t: captionText, fast: fastTag }).catch(() => {});
}
page.on("load", () => { void paintCaption(); });

/** A scene at real speed: caption on, do things, and stay until the narration line has been spoken. */
async function scene(id, act = async () => {}) {
  captionText = lines[id].caption; fastTag = false;
  await paintCaption();
  const t0 = now();
  await act();
  await paintCaption();
  const left = spoken(id) + 0.7 - (now() - t0);
  if (left > 0) await wait(left * 1000);
  timeline.push({ id, t0, t1: now() });
}
/** A scene that waits on the model: recorded in full, shown sped up to the length of its narration. */
async function fast(id, until) {
  captionText = lines[id].caption; fastTag = true;
  await paintCaption();
  const t0 = now();
  await until();
  await wait(700);
  timeline.push({ id, t0, t1: now(), target: spoken(id) + 0.9 });
}
/** A full-screen title card, set in the app's own type. */
async function card(title, sub = []) {
  await page.evaluate(({ title, sub }) => {
    document.getElementById("__card")?.remove();
    const el = document.createElement("div");
    el.id = "__card";
    el.style.cssText = "position:fixed;inset:0;z-index:99997;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F3EEE3;color:#17140F;text-align:center;padding:0 70px 90px";
    el.innerHTML = `<div class="display" style="font-size:60px;max-width:960px">${title}</div>` + sub.map((l) => `<div style="margin-top:24px;font:400 22px/1.45 var(--font-ui),system-ui,sans-serif;color:#5B5447;max-width:840px">${l}</div>`).join("");
    document.body.appendChild(el);
  }, { title, sub });
}
const uncard = () => page.evaluate(() => document.getElementById("__card")?.remove());
const scrollTo = (sel, block = "center") => page.evaluate(({ s, block }) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block }), { s: sel, block });
const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
const holdCard = () => page.getByText("PayPal hold backing this envelope").waitFor(T);
const log = () => page.getByTestId("mission-log");

// 1. The problem, then the idea
await page.goto(`${BASE}/`);
await page.getByRole("heading", { name: "Give your agent an envelope, not your wallet." }).waitFor(T);
await card("Give your agent an envelope, <em>not your wallet.</em>", ["Envelope · spending authority for AI agents, backed by a PayPal hold", "<span style=\"font-size:15px;color:#8A8271\">Recorded on the PayPal sandbox · narration is a synthetic voice</span>"]);
await scene("problem");
await uncard();
await scene("idea");

// 2. Seal
await page.goto(`${BASE}/console`);
await page.getByText(/Signed with your key [A-Za-z0-9_-]{6}…/).waitFor(T);
await page.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
await scene("seal", async () => { await wait(2600); await scrollTo("form button"); });
await scene("hold", async () => {
  await page.getByRole("button", { name: /^Seal & hold \$200\.00 on PayPal/ }).click();
  await holdCard();
  await page.getByText("(you)").waitFor();
});
const rootUrl = page.url();

// 3. A real model plays the agents
await scene("model", async () => { await scrollTo('[data-testid="mission"]'); });
await page.getByLabel(/Finish with a red-team stage/).uncheck(); // models sometimes decline that stage; the video uses the scripted attacker instead
await page.getByRole("button", { name: "Give the brief to the model" }).click();
// keep the newest line of the model's log in view while it works
await page.evaluate(() => { window.__follow = setInterval(() => { const l = document.querySelectorAll('[data-testid="mission-log"] li'); l[l.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 600); });
await fast("ops", () => log().getByText(/^localization-agent · played by/).waitFor({ timeout: 240000 }));
await fast("aside", () => log().getByText(/^creative-agent · played by/).waitFor({ timeout: 240000 }));
await fast("inject", () => log().getByText(/^Done\./).waitFor({ timeout: 240000 }));
await page.evaluate(() => clearInterval(window.__follow));
const missionText = await log().innerText();
writeFileSync(`${OUT}/mission-log.txt`, missionText);
// The model decides for itself, so a run can go differently. The narration describes money set aside
// and two payments; if this run did not have them, say so and record again rather than mislabel it.
const paidCount = (missionText.match(/Gateway: PAID/g) ?? []).length;
if (paidCount !== 2 || !/SET ASIDE/.test(missionText) || /Gateway: DENIED/.test(missionText)) throw new Error(`This run does not match the narration (paid ${paidCount}). Record again.`);
// The scripted attacker (no model): a new payee, an overspend, a forged bigger envelope.
await scene("redteam", async () => {
  await scrollTo('[data-testid="controls"]', "start");
  await wait(700);
  await page.getByRole("button", { name: "Compromise the creative agent" }).click();
  await page.getByText(/forged a bigger envelope/).waitFor(T);
  await page.getByRole("button", { name: "Compromise the creative agent" }).waitFor(T);
  await wait(900);
  await top();
});
if ((await page.getByTestId("statement").getByText("Denied", { exact: true }).count()) !== 3) throw new Error("Expected three denials from the scripted attacker.");
await scene("result", async () => { await top(); });

// 4. The agent that got paid
await scene("earner", async () => {
  await page.getByTestId("statement").getByRole("link", { name: /translator-agent/ }).first().click();
  await page.getByTestId("receives").waitFor(T);
  await wait(1500);
  await scrollTo('[data-testid="receives"]');
});

// 5. Is it good for the money?
await page.goto(rootUrl);
await holdCard();
await scene("check", async () => {
  // ops-agent still has money in its envelope; the two sub-agents have spent exactly what they were given
  await page.getByTestId("node-ops-agent").getByRole("link", { name: /ops-agent/ }).first().click();
  await page.getByRole("heading", { name: "Is it good for the money?" }).waitFor(T);
  await page.getByLabel(/You are \(payee/).fill("designer@example.com");
  await page.getByLabel("Purpose").fill("design");
  await page.getByLabel("For (USD)").fill("20");
  await page.getByRole("button", { name: "Ask the gateway" }).click();
  await page.getByTestId("standing").getByText("Signature checked in your browser.").waitFor(T);
  if (!(await page.getByTestId("standing").getByText(/^Good for/).count())) throw new Error("Expected a good statement of standing for ops-agent.");
  await scrollTo('[data-testid="standing"]');
});

// 6. Receipt
await page.goto(rootUrl);
await holdCard();
await scene("receipt", async () => {
  await page.getByRole("link", { name: "Receipt & authority chain →" }).last().click();
  await page.getByText("All checks pass").waitFor(T);
  await page.getByText("Signatures valid").waitFor(T);
});

// 6b. The owner's treasury, with the books checked against PayPal
await scene("treasury", async () => {
  await page.goto(`${BASE}/treasury`);
  await page.getByTestId("totals").waitFor(T);
  await wait(2200);
  await page.getByRole("button", { name: "Reconcile with PayPal" }).click();
  await page.getByTestId("books").getByText(/\d+ of \d+ match PayPal/i).waitFor(T);
});

// 7. Revoke the compromised agent, then close
await page.goto(rootUrl);
await holdCard();
await scene("close", async () => {
  await scrollTo('[data-testid="node-creative-agent"]');
  await wait(600);
  await page.getByTestId("node-creative-agent").getByRole("button", { name: "Revoke" }).click();
  await page.getByText(/You revoked creative-agent's envelope/).waitFor(T);
  await wait(1200);
  await page.getByRole("button", { name: "Close envelope & release the hold" }).click();
  await page.getByText(/You closed the envelope\. PayPal released/).waitFor(T);
  await page.getByText("Closed", { exact: true }).first().waitFor(T);
  await top();
});

// 8. Numbers, then the close
await card("<span class=\"figure\" style=\"font-size:120px\">98<span style=\"color:#8A8271\">/98</span></span>", ["attacks refused in the test corpus. None moved money.", "The try-it copy runs the whole gateway in your browser: nothing to install, nothing to configure."]);
await scene("numbers");
await card("Seal is an authorization.<br>Spend is a capture and a payout.<br><em>Close is a void.</em>", ["Envelope · a treasury, accounts and a payment protocol for AI agents", "open source · github.com/Stan-lee13/PayPal-hackathon-"]);
await scene("end");

await ctx.close();
await browser.close();
const f = readdirSync(OUT).filter((x) => x.endsWith(".webm") && x !== "envelope-demo.webm").sort().pop();
renameSync(`${OUT}/${f}`, `${OUT}/envelope-demo.webm`);
writeFileSync(`${OUT}/timeline.json`, JSON.stringify(timeline, null, 1));
console.log(`Saved ${OUT}/envelope-demo.webm and timeline.json (${timeline.length} scenes, ${Math.round(now())}s recorded)`);
