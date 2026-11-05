import { confirmPreflightAmount } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** Merchant: confirm the buyer-approved amount for a NEEDS_CONFIRMATION verdict (never clears a mismatch). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    await confirmPreflightAmount((await params).id, merchantId);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
