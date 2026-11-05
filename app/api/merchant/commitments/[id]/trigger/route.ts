import { recordRefundTrigger } from "@/lib/services/merchant-actions";
import { assertCommitmentOwned } from "@/lib/services/ownership";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    await assertCommitmentOwned(id, merchantId);
    await recordRefundTrigger(id);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
