import { z } from "zod";
import { advanceDemoClock } from "@/lib/services/merchant-actions";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** DEMO_MODE only. hours=0 resets the simulated clock. */
export async function POST(req: Request) {
  try {
    const merchantId = await requireMerchant(req);
    const { hours } = z.object({ hours: z.number().min(-720).max(720) }).parse(await req.json());
    await advanceDemoClock(merchantId, hours);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
