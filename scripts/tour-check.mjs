/**
 * Walks the two-minute tour the way a visitor would: start from the landing page, press only what the
 * strip rings, and check that each step ticks over because the thing really happened.
 *
 *   BASE=http://localhost:3001 PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/tour-check.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT;
const T = { timeout: 60_000 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: OUT ? 2 : 1 });
page.on("dialog", (d) => void d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
const strip = page.getByTestId("tour");
const at = async (n) => { await strip.getByText(`Tour · ${n} of 7`).waitFor(T); };
const ringed = () => page.locator("[data-tour-on]");
const shot = async (name) => { if (!OUT) return; await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {}); }; // let the scroll to the ringed control settle
let failed = false;
try {
  await page.goto(BASE);
  await page.getByTestId("tour-start").click();
  await page.waitForURL(/\/console/, T);
  await at(1);
  await ringed().waitFor(T);
  if (!/Seal & hold/.test(await ringed().innerText())) throw new Error("step 1 rings the wrong control");
  await shot("tour-1-seal");
  await ringed().click();
  await page.waitForURL(/\/e\//, T);
  await at(2);
  await ringed().filter({ hasText: "Run the launch" }).click();
  await at(3);
  await ringed().filter({ hasText: "Compromise the creative agent" }).waitFor(T);
  await shot("tour-3-attack");
  await ringed().click();
  await at(4);
  await ringed().filter({ hasText: "Receipt & authority chain" }).click();
  await page.waitForURL(/\/r\//, T);
  await at(5);
  // step 5 is on another page: the strip offers to take the visitor there
  await strip.getByTestId("tour-go").click();
  await page.waitForURL(/\/bank/, T);
  await ringed().filter({ hasText: "Compare with PayPal" }).click();
  await at(6);
  await strip.getByTestId("tour-go").click();
  await page.waitForURL(/\/auditor/, T);
  await ringed().filter({ hasText: "A payer disputes the latest payment" }).click();
  await page.getByTestId("auditor-note").getByText(/has disputed payment/).waitFor(T);
  await ringed().filter({ hasText: /audit/i }).click();
  await page.getByTestId("auditor-report").waitFor(T);
  await shot("tour-6-auditor");
  await at(7);
  await strip.getByTestId("tour-go").click();
  await page.waitForURL(/\/e\//, T);
  await ringed().filter({ hasText: "Close envelope" }).click();
  await strip.getByText("That was the whole loop.").waitFor(T);
  await shot("tour-8-done");
  // it remembers where it is across a reload, and ends when told to
  await page.reload();
  await strip.getByText("Tour done").waitFor(T);
  await strip.getByTestId("tour-end").click();
  await strip.waitFor({ state: "detached", ...T });
  console.log("tour: seven steps, each ticked by the page or the gateway's records; remembered across a reload; ended");
} catch (e) {
  failed = true;
  console.log("FAILED:", String(e).slice(0, 600));
  console.log("strip said:", await strip.innerText().catch(() => "(no strip)"));
  await shot("tour-fail");
}
if (errors.length) console.log(errors.join("\n"));
await browser.close();
console.log(failed ? "TOUR CHECK FAILED" : "TOUR CHECK PASSED");
process.exit(failed ? 1 : 0);
