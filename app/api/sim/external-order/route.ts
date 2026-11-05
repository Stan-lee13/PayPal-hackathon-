import { paypalMode } from "@/lib/paypal/client";
import { seedExternalCapturedOrder } from "@/lib/services/simulation";
import { UserFacingError } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** SIMULATED MODE ONLY: add a payment captured outside Kept's checkout (the repair demo). */
export async function POST(req: Request) {
  try {
    await requireMerchant(req);
    if (paypalMode() !== "simulated") throw new UserFacingError("Not available in real PayPal mode: capture one through a checkout with the price check set to Warn or Off.", 404);
    return json(await seedExternalCapturedOrder());
  } catch (e) { return errorResponse(e); }
}
