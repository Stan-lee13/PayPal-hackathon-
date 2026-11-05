import { z } from "zod";
import { addOrderTracking } from "@/lib/services/merchant-actions";
import { assertOrderOwned } from "@/lib/services/ownership";
import { CARRIERS } from "@/lib/paypal/api";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    await assertOrderOwned(id, merchantId);
    const b = z.object({ trackingNumber: z.string().min(4).max(40), carrier: z.enum(CARRIERS) }).parse(await req.json());
    await addOrderTracking(id, b.trackingNumber, b.carrier);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
