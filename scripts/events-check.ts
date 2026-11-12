/**
 * PayPal's own events, on the REAL sandbox: make a few real payments, then let the events PayPal
 * publishes about them finish the settlement, read from PayPal's event feed.
 *
 * Needs a webhook registered for the sandbox app (any URL): PayPal only records events for an app
 * that has one. The gateway does not have to be reachable from PayPal for this: it reads the feed
 * (`GET /v1/notifications/webhooks-events`) with its own credentials.
 *
 *   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… DATABASE_URL=… npx tsx scripts/events-check.ts
 *
 * Writes docs/evidence/paypal-events.json. Sandbox only. What it does NOT show: a pushed delivery
 * whose signature PayPal verifies. That needs a gateway PayPal can reach.
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode, getPayPal } = await import("../lib/paypal/client");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");
const E = await import("../lib/envelope/core");
const G = await import("../lib/gateway/service");
const B = await import("../lib/gateway/bank");
const S = await import("../lib/gateway/settlement");
const { listEvents } = await import("../lib/paypal/payments");
const { flushJournal } = await import("../lib/paypal/journal");
const { getDb, closeDb } = await import("../lib/db");
const { spends } = await import("../lib/db/schema");
const { eq } = await import("drizzle-orm");

const pp = getPayPal();
const started = new Date(Date.now() - 60_000);
const steps: Array<Record<string, unknown>> = [];
const log = (step: string, data: Record<string, unknown>) => { steps.push({ step, at: new Date().toISOString(), ...data }); console.log(`• ${step}`, JSON.stringify(data)); };
const row = (id: string) => getDb().query.spends.findFirst({ where: eq(spends.id, id) }).then((r) => r!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hooks = await pp.request<{ webhooks?: Array<{ id: string; url: string; event_types?: Array<{ name: string }> }> }>("GET", "/v1/notifications/webhooks");
if (!hooks.webhooks?.length) throw new Error("No webhook is registered for this sandbox app, so PayPal records no events for it.");
log("a webhook is registered for the sandbox app, so PayPal records its events", { webhook: hooks.webhooks[0]!.id, url: hooks.webhooks[0]!.url, events: hooks.webhooks[0]!.event_types?.map((t) => t.name) });

const [ada, ops, bea, tr, cy, wr] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));
const settleTo = (process.env.ENVELOPE_PAYEE_1 || "translator@example.com").toLowerCase();
await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo }));
await G.openAccount(await E.signAccount(wr!, cy!, { label: "writer-agent", ownerName: "Cy", settleTo, mode: "hold" }));
const translator = E.accountPayee(tr!.publicKey), writer = E.accountPayee(wr!.publicKey);
const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 3000, perPayment: 2000, payees: [translator, writer], purposes: ["translation", "writing"], notAfter: new Date(Date.now() + 3 * 3600_000).toISOString(), splits: 0 });
const root = await G.registerRoot({ chain, principalName: "Ada (sandbox)", title: "Events check" });
log("sealed: PayPal hold placed", { root: root.id, authorization: root.authorizationId, held: "$30.00" });

// 1. A payment that PayPal pays out. The gateway is NOT asked about it again: only PayPal's event may finish it.
const paid = await G.spend(await E.signSpend(chain, ops!, { amount: 800, payee: translator, purpose: "translation", memo: "Store strings" }));
log("ops-agent paid translator-agent $8: captured, payout requested; left as PayPal first reported it", { payment: paid.spend?.id, status: paid.status, capture: paid.spend?.captureId, payoutBatch: paid.spend?.payoutBatchId, payoutStatus: paid.spend?.payoutStatus });

// 2. A payment kept in a balance, then given back: PayPal refunds the capture.
const kept = await G.spend(await E.signSpend(chain, ops!, { amount: 600, payee: writer, purpose: "writing", memo: "Deposit" }));
const back = await B.refund(await E.signRefund(wr!, kept.spend!.id, "Cannot take it on"));
log("ops-agent paid writer-agent $6 into its balance; writer-agent gave it back and PayPal refunded the capture", { payment: kept.spend?.id, capture: kept.spend?.captureId, refund: back.refundId, status: back.status });

// 3. Wait for PayPal to publish its events about these, without touching the payments.
const want = [paid.spend!.id, kept.spend!.id, paid.spend!.captureId, kept.spend!.captureId, paid.spend!.payoutBatchId, root.authorizationId].filter(Boolean) as string[];
const about = (evs: Awaited<ReturnType<typeof listEvents>>) => evs.filter((e) => want.some((w) => JSON.stringify(e.resource ?? {}).includes(w)));
let feed: Awaited<ReturnType<typeof listEvents>> = [];
for (let i = 0; i < 30; i++) {
  feed = about(await listEvents(pp, started));
  const types = new Set(feed.map((e) => e.event_type));
  console.log(`  feed after ${i * 20}s: ${feed.length} events about this run [${[...types].join(", ")}]`);
  if ([...types].some((t) => String(t).startsWith("PAYMENT.PAYOUTS-ITEM.")) && types.has("PAYMENT.CAPTURE.REFUNDED")) break;
  await sleep(20_000);
}
const before = await row(paid.spend!.id);
log("PayPal's event feed, read with the gateway's own credentials", { eventsAboutThisRun: feed.length, types: [...new Set(feed.map((e) => e.event_type))], firstEventId: feed.at(-1)?.id ?? null, paymentStillAsFirstReported: before.status });

// 4. Apply the feed. Each event is only a hint: the gateway reads the record it names from PayPal by id.
const pulled = await S.pullPayPalEvents();
const mine = pulled.applied.filter((o) => o.subject && [paid.spend!.id, kept.spend!.id, root.id].includes(o.subject));
const after = await row(paid.spend!.id);
log("the gateway applied PayPal's events: each made it read the named record from PayPal, and that reading changed the books", {
  eventsInFeed: pulled.seen, appliedNow: pulled.applied.length, aboutThisRun: mine.map((o) => ({ event: o.event, type: o.type, outcome: o.outcome })),
  paymentBefore: before.status, paymentAfter: after.status, payoutStatusAfter: after.payoutStatus,
  meaning: after.status === "PAID" ? "delivered to the payee's PayPal account, settled by PayPal's own event" : after.status === "UNCLAIMED" ? "PayPal is holding it for a payee with no account at that address: not paid" : "not finished yet",
});

// 5. The same feed again changes nothing: an event is applied once, under PayPal's own event id.
const again = await S.pullPayPalEvents();
log("the same feed read again applied nothing", { eventsInFeed: again.seen, appliedNow: again.applied.length });

// 6. Close the envelope; PayPal publishes the void, and the next read of the feed takes it as confirmation.
const { root: closed } = await G.revoke(await E.signRevoke(ada!, root.id));
log("the owner closed the envelope: PayPal released the rest of the hold", { captured: closed.capturedMinor, refunded: closed.refundedMinor, released: closed.releasedMinor });
let voided: Awaited<ReturnType<typeof S.pullPayPalEvents>> | null = null;
for (let i = 0; i < 12; i++) {
  await sleep(15_000);
  voided = await S.pullPayPalEvents();
  if (voided.applied.some((o) => o.type === "PAYMENT.AUTHORIZATION.VOIDED")) break;
}
log("PayPal's event for the void arrived in the feed and was applied once", { applied: (voided?.applied ?? []).map((o) => ({ type: o.type, outcome: o.outcome })) });

await flushJournal();
writeFileSync("docs/evidence/paypal-events.json", JSON.stringify({
  ranAt: new Date().toISOString(), paypalMode: paypalMode(),
  note: "Real PayPal sandbox. Events were read from PayPal's event feed with the gateway's credentials; none was pushed to this gateway, so no delivery signature was verified here. An event never changes the books by itself: it makes the gateway read the record it names from PayPal.",
  steps,
}, null, 2));
await closeDb();
