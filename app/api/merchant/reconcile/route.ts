import { reconcile } from "@/lib/services/pipeline";
import { retryEvents } from "@/lib/services/webhooks";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function POST(req: Request) {
  try {
    await requireMerchant(req);
    await deliverSimulatedEvents();
    const events = await retryEvents();
    const report = await reconcile({ olderThanMinutes: 0 });
    return json({ ok: true, events, report });
  } catch (e) { return errorResponse(e); }
}
