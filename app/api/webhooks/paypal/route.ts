import { after } from "next/server";
import { ingestWebhook, processEvent } from "@/lib/services/webhooks";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * PayPal webhook endpoint. Raw body → signature verification → dedupe/persist →
 * 200 immediately → authoritative re-fetch + processing after the response.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 512 * 1024) return json({ ok: false, error: "payload too large" }, 413);
  try {
    const res = await ingestWebhook(raw, req.headers);
    if (res.internalId) {
      const id = res.internalId;
      after(async () => {
        try { await processEvent(id); } catch (e) { console.error("[kept] webhook processing failed; will be retried by reconcile", e); }
      });
    }
    return json(res.body, res.status);
  } catch (e) {
    console.error("[kept] webhook ingest error", e);
    return json({ ok: false }, 500); // PayPal will retry
  }
}
