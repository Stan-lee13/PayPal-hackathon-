/**
 * Replay a PayPal webhook delivery that a copy without a gateway logged (lib/api/relay.ts) to a
 * gateway that has one. The delivery is verified with PayPal (`verify-webhook-signature`) exactly as
 * if PayPal had pushed it here, and applied only if PayPal says it is genuine. The same delivery with
 * one character of its body changed is then offered too, and must be refused.
 *
 *   PAYPAL_WEBHOOK_ID=… PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… DATABASE_URL=… \
 *     npx tsx scripts/replay-delivery.ts delivery.json [more.json …]
 *
 * A delivery file is { "headers": { "paypal-transmission-id": …, … }, "bodyBase64": "…" }.
 * Appends to docs/evidence/paypal-events.json. Sandbox only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode } = await import("../lib/paypal/client");
if (paypalMode() !== "sandbox") throw new Error("This script only runs against the PayPal sandbox.");
if (!process.env.PAYPAL_WEBHOOK_ID) throw new Error("Set PAYPAL_WEBHOOK_ID to the id of the webhook the deliveries were made to.");
const { handlers, run } = await import("../lib/api/handlers");
const { flushJournal } = await import("../lib/paypal/journal");
const { closeDb } = await import("../lib/db");

const post = (headers: Record<string, string>, raw: string) => run(handlers["POST /api/paypal/webhook"]!, { params: {}, body: JSON.parse(raw), headers, raw });
const deliveries: Array<Record<string, unknown>> = [];
for (const file of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(file, "utf8")) as { headers: Record<string, string>; bodyBase64: string };
  const raw = Buffer.from(d.bodyBase64, "base64").toString("utf8");
  const ev = JSON.parse(raw) as { id: string; event_type: string; create_time?: string };
  // First the forgery: the genuine headers with a body that differs by one character. PayPal must not vouch for it.
  const i = raw.indexOf('"create_time"');
  const edited = i > 0 ? raw.slice(0, i) + '"create_time_"' + raw.slice(i + '"create_time"'.length) : raw.replace(/\d/, (c) => String((Number(c) + 1) % 10));
  const forged = await post(d.headers, edited);
  const genuine = await post(d.headers, raw);
  const again = await post(d.headers, raw);
  const out = {
    transmission: d.headers["paypal-transmission-id"], sentAt: d.headers["paypal-transmission-time"], event: ev.id, type: ev.event_type,
    sameHeadersWithAnEditedBody: { status: forged.status, answer: forged.body },
    asDelivered: { status: genuine.status, answer: genuine.body },
    deliveredAgain: { status: again.status, answer: again.body },
  };
  deliveries.push(out);
  console.log(JSON.stringify(out, null, 1));
}
await flushJournal();
const path = "docs/evidence/paypal-events.json";
const doc = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { steps: [] };
doc.pushedDeliveries = {
  replayedAt: new Date().toISOString(), webhook: process.env.PAYPAL_WEBHOOK_ID,
  note: "PayPal pushed these to the hosted copy, which has no gateway and logged them unchanged. They were replayed to a gateway with the sandbox credentials, which asked PayPal to verify each signature before doing anything.",
  deliveries,
};
writeFileSync(path, JSON.stringify(doc, null, 2));
await closeDb();
