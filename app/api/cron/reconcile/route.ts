import { timingSafeEqual } from "node:crypto";
import { reconcile } from "@/lib/services/pipeline";
import { retryEvents } from "@/lib/services/webhooks";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Scheduled reconciliation (Render cron / any scheduler): Authorization: Bearer $CRON_SECRET */
export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET ?? "";
    const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return json({ error: "unauthorized" }, 401);
    await deliverSimulatedEvents();
    const events = await retryEvents();
    const report = await reconcile();
    return json({ ok: true, events, report });
  } catch (e) { return errorResponse(e); }
}
