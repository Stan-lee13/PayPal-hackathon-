/**
 * A copy of this site with no database has no gateway behind it, so it cannot apply an event PayPal
 * delivers to it. Rather than drop the delivery, it writes it to the host's log exactly as received:
 * the PayPal headers, and the body in base64 so that not one byte changes. Whoever runs a gateway can
 * replay it there (scripts/replay-delivery.ts), where it is verified with PayPal like any other
 * delivery before anything is done with it. Nothing here is trusted or acted on.
 *
 * PayPal is answered 503: the event was not applied, and PayPal's own retries are the honest record of that.
 */
import { json } from "../http";

const MAX_BODY_BYTES = 64 * 1024;
const PART = 1200;
// Without a database there is no shared rate limit. This one is per server instance, which is enough to keep a stranger from filling the log.
let windowStart = 0, seen = 0;

export async function logPayPalDelivery(req: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { if (k.startsWith("paypal-")) headers[k] = v.slice(0, 600); });
  const id = headers["paypal-transmission-id"];
  if (!id || !headers["paypal-transmission-sig"] || !/^[\w-]{8,80}$/.test(id)) return json({ error: "Not a PayPal delivery." }, 400);
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; seen = 0; }
  if (++seen > 120) return json({ error: "Too many requests; try again later." }, 429);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  const parts = Math.max(1, Math.ceil(b64.length / PART));
  console.log(`[paypal-delivery] ${id} headers ${JSON.stringify(headers)}`);
  for (let i = 0; i < parts; i++) console.log(`[paypal-delivery] ${id} body ${i + 1}/${parts} ${b64.slice(i * PART, (i + 1) * PART)}`);
  return json({ error: "This copy has no gateway behind it, so the event was not applied. The delivery was written to the host's log, unchanged, for replay to a gateway that has one." }, 503);
}
