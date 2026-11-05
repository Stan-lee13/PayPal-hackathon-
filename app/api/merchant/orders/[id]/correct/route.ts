import { correctBlockedOrder } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** Merchant: replace a blocked PayPal order with one at the promised total (the buyer must approve it). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    return json(await correctBlockedOrder((await params).id, merchantId));
  } catch (e) { return errorResponse(e); }
}
