import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getPayPal } from "@/lib/paypal/client";
import { getCapture } from "@/lib/paypal/api";
import { syncCapture } from "@/lib/services/orders";
import { afterPaymentEvidence } from "@/lib/services/pipeline";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { assertOrderOwned } from "@/lib/services/ownership";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** "Check with PayPal now": authoritative GET of the capture, then re-evaluate. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    const o = await assertOrderOwned(id, merchantId);
    await deliverSimulatedEvents();
    if (o.paypalCaptureId) {
      await syncCapture(await getCapture(getPayPal(), o.paypalCaptureId), "merchant_refresh");
      await afterPaymentEvidence(id);
    }
    const fresh = await getDb().query.orders.findFirst({ where: eq(orders.id, id) });
    return json({ ok: true, captureStatus: fresh?.captureStatus ?? null });
  } catch (e) { return errorResponse(e); }
}
