import { updatePolicy } from "@/lib/services/merchant-actions";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function PUT(req: Request) {
  try {
    const merchantId = await requireMerchant(req);
    return json({ policy: await updatePolicy(merchantId, await req.json()) });
  } catch (e) { return errorResponse(e); }
}
