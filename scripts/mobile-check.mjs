/**
 * Every page at phone width: seal an envelope, let the agents pay, issue a card, then visit each page
 * and check that nothing is wider than the screen, that the menu lists every page, and that the cards
 * page is reachable from it.
 *
 *   BASE=http://localhost:3001 PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/mobile-check.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT;
const T = { timeout: 60_000 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
page.on("dialog", (d) => void d.accept());
const problems = [];
/** Anything that makes the page scroll sideways, with the widest offenders named. */
async function measure(name) {
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
    const wide = [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !inScroller(el); })
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")} (${Math.round(el.getBoundingClientRect().right)}px)`);
    return { vw, scroll: document.scrollingElement.scrollWidth, wide };
  });
  const sideways = r.scroll > r.vw + 1;
  if (sideways) problems.push(`${name}: scrolls sideways (${r.scroll}px on a ${r.vw}px screen): ${r.wide.join("; ") || "no single element found"}`);
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {});
  console.log(`${sideways ? "x" : "ok"} ${name}`);
}
let failed = false;
try {
  await page.goto(BASE);
  await measure("home");
  // the menu is the navigation on a phone: it must list every page, cards among them
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("site-menu");
  for (const name of ["Seal an envelope", "Two-minute tour", "Treasury", "Accounts", "Cards", "Auditor", "Books against PayPal", "Developers", "Protocol"]) await menu.getByRole("link", { name: new RegExp(`^${name}`) }).waitFor(T);
  await measure("menu");
  await menu.getByRole("link", { name: /^Cards/ }).click();
  await page.waitForURL(/\/cards/, T);
  await page.getByTestId("cards-empty").waitFor(T);
  await measure("cards-empty");
  await page.getByTestId("site-footer").getByRole("link", { name: "Auditor" }).waitFor(T);

  await page.goto(`${BASE}/console`);
  await page.locator('[data-tour="seal"]').waitFor(T);
  await measure("console");
  await page.locator('[data-tour="seal"]').click();
  await page.waitForURL(/\/e\//, T);
  const envelope = page.url();
  await page.locator('[data-tour="run"]').click();
  await page.locator('[data-tour="receipt"]').first().waitFor(T);
  await page.waitForFunction(() => !document.querySelector('[data-tour="run"]')?.textContent?.includes("…"), null, T);
  await measure("envelope");
  await page.locator('[data-tour="receipt"]').first().click();
  await page.waitForURL(/\/r\//, T);
  await page.getByText("All checks pass").waitFor(T);
  await measure("receipt");
  await page.goto(envelope.replace("/e/", "/proof/"));
  await page.getByTestId("proof-summary").waitFor(T);
  await measure("proof");

  // the earning agent issues a card; it then shows on the cards page
  await page.goto(`${BASE}/cards`);
  await page.getByTestId("cards-issue-here").first().click();
  await page.waitForURL(/\/a\//, T);
  await page.getByRole("button", { name: /Subscribe to Lexica Pro with its card/ }).click();
  await page.getByTestId("xenoncard").waitFor(T);
  await measure("agent");
  await page.getByTestId("menu-button").click();
  await page.getByTestId("site-menu").getByRole("link", { name: /^Cards/ }).click();
  await page.getByTestId("cards-list").getByText("Lexica Pro").first().waitFor(T);
  await measure("cards");

  for (const [name, path, ready] of [["bank", "/bank", '[data-testid="bank-totals"]'], ["treasury", "/treasury", "main"], ["auditor", "/auditor", '[data-testid="auditor-run"]'], ["developers", "/developers", "main"], ["spec", "/spec", "main"]]) {
    await page.goto(BASE + path);
    await page.locator(ready).first().waitFor(T);
    await measure(name);
  }
  // the tour's strip on a phone
  await page.goto(`${BASE}/console?tour=1`);
  await page.getByTestId("tour").getByText("Tour · 1 of 7").waitFor(T);
  await measure("tour");
} catch (e) {
  failed = true;
  console.log("FAILED:", String(e).slice(0, 500));
  if (OUT) await page.screenshot({ path: `${OUT}/fail.png` }).catch(() => {});
}
if (problems.length) console.log(problems.join("\n"));
await browser.close();
console.log(failed || problems.length ? "MOBILE CHECK FAILED" : "MOBILE CHECK PASSED");
process.exit(failed || problems.length ? 1 : 0);
