/**
 * Two tabs on the in-browser gateway (the copy a host serves when it has no database).
 *
 * Every tab shares one Postgres-in-WebAssembly, held by one tab's worker. This drives the cases where
 * that used to go wrong: a tab reloaded or closed while it waits its turn or is inside a transaction,
 * and the tab holding the database going away. The tab still open must never be left waiting, and
 * must still have everything that was saved.
 *
 *   DATABASE_URL= PAYPAL_MODE=simulated npx next start -p 3001      # the in-browser copy
 *   BASE=http://localhost:3001 node scripts/tabs-stress.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:3001";
const T = { timeout: 45000 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const fails = [];
const step = async (name, fn) => { const s = Date.now(); try { await fn(); console.log(at(), "ok  ", name, `(${((Date.now() - s) / 1000).toFixed(1)}s)`); } catch (e) { fails.push(name); console.log(at(), "FAIL", name, String(e).split("\n")[0].slice(0, 160)); } };
const watch = (p, tag) => { p.on("pageerror", (e) => console.log(at(), tag, "PAGEERROR", String(e).slice(0, 200))); p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) console.log(at(), tag, "console.error", m.text().slice(0, 200)); }); };

const a = await ctx.newPage(); watch(a, "A");
await a.goto(`${BASE}/console`);
await a.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
await step("A seals an envelope (A's worker holds the database)", async () => {
  await a.getByRole("button", { name: /^Seal & hold/ }).click();
  await a.getByText("PayPal hold backing this envelope").waitFor(T);
});
const envelope = a.url();

// 1. B joins, then is reloaded over and over while A runs the whole launch (many transactions).
let b = await ctx.newPage(); watch(b, "B");
await b.goto(envelope);
await b.getByText("PayPal hold backing this envelope").waitFor(T);
await step("A runs the launch while B (same envelope, polling) is reloaded 8 times", async () => {
  await a.bringToFront();
  await a.getByRole("button", { name: /Run the launch/ }).click();
  for (let i = 0; i < 8; i++) { await b.reload({ waitUntil: "commit" }).catch(() => {}); await a.waitForTimeout(120 + i * 60); }
  await a.getByText(/creative-agent asked to pay/).waitFor(T);
});
await step("B sees the payments A's agents made (read from the shared database)", async () => { await b.goto(envelope); await b.getByTestId("paypal-rail").getByText("Sent a payout").first().waitFor(T); });

// 2. B is closed in the middle of its own requests, many times, while A keeps reading.
await step("B opened and closed 10 times mid-load; A reloads fine each time", async () => {
  for (let i = 0; i < 10; i++) {
    await b.close().catch(() => {});
    b = await ctx.newPage(); watch(b, "B");
    void b.goto(i % 2 ? envelope : `${BASE}/bank`).catch(() => {});
    await a.waitForTimeout(40 + i * 45); // close B at a different point of its start-up and first queries each time
    await b.close().catch(() => {});
    await a.goto(envelope);
    await a.getByText("PayPal hold backing this envelope").waitFor(T);
  }
});

// 3. B starts a change (the compromise demo: several signed requests) and is closed mid-way. A must then be able to act.
await step("B starts 'Compromise the creative agent' and is closed mid-way; A then revokes and reads", async () => {
  b = await ctx.newPage(); watch(b, "B");
  await b.goto(envelope);
  await b.getByRole("button", { name: /Compromise the creative agent/ }).click();
  await b.waitForTimeout(150);
  await b.close();
  await a.goto(`${BASE}/bank`);
  await a.getByTestId("bank-reserves").waitFor(T);
  await a.goto(envelope);
  await a.getByText("PayPal hold backing this envelope").waitFor(T);
});

// 4. The tab holding the database goes away: B must take over with the data intact.
await step("A (holding the database) is closed; B takes over and still has the envelope and its payments", async () => {
  b = await ctx.newPage(); watch(b, "B");
  await b.goto(envelope);
  await b.getByText("PayPal hold backing this envelope").waitFor(T);
  await a.close();
  await b.reload();
  await b.getByTestId("paypal-rail").getByText("Sent a payout").first().waitFor(T);
  await b.getByTestId("statement").getByText(/designer@example\.com/).first().waitFor(T);
  await b.getByTestId("statement").getByText(/^paid$/i).first().waitFor(T);
});
await step("B, now alone, closes the envelope (a change, after the move)", async () => {
  b.once("dialog", (d) => d.accept());
  await b.getByRole("button", { name: /Close envelope/ }).click();
  await b.getByTestId("paypal-rail").getByText("Released the rest of the hold").first().waitFor(T);
  await b.reload();
  await b.getByTestId("paypal-rail").getByText("Released the rest of the hold").first().waitFor(T);
});

// 5. A request in flight when the holder dies: B is mid-read as A closes. It must answer (a retry), not hang.
await step("a third tab closes while B is mid-request, five times; B answers every time", async () => {
  for (let i = 0; i < 5; i++) {
    const c = await ctx.newPage(); watch(c, "C");
    await c.goto(`${BASE}/bank`); await c.getByTestId("bank-reserves").waitFor(T);
    void b.goto(`${BASE}/bank`).catch(() => {});
    await b.waitForTimeout(30 * i);
    await c.close();
    await b.getByTestId("bank-reserves").waitFor(T);
  }
});

// 6. The tab holding the database is reloaded while the other tab is in the middle of its own requests. The other tab's
//    worker takes the database over mid-request; both tabs must come back. (Before the fix a query caught by the move
//    could wait for good, holding the turn, and neither tab answered again.)
await step("the tab holding the database is reloaded 12 times while the other is mid-request; both come back every time", async () => {
  const pair = [b, await ctx.newPage()]; watch(pair[1], "D");
  await pair[1].goto(`${BASE}/bank`); await pair[1].getByTestId("bank-reserves").waitFor(T);
  let holder = 0; // b has held the database since A closed
  for (let i = 0; i < 12; i++) {
    const other = pair[1 - holder];
    void other.goto(`${BASE}/console`).catch(() => {});
    await other.waitForTimeout(60 + 45 * i); // catch the other tab at a different point of its requests each time
    await pair[holder].goto(`${BASE}/bank`);
    await pair[holder].getByTestId("bank-reserves").waitFor(T);
    await other.getByText(/is translator-agent, an agent owned by Bea/).waitFor(T);
    holder = 1 - holder; // the other tab's worker holds the database now
  }
});

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
