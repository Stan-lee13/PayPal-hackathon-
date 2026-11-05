import { z } from "zod";
import { paypalMode } from "@/lib/paypal/client";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { errorResponse, json, requireMerchant } from "@/lib/http";
import { UserFacingError } from "@/lib/services/orders";

/** SIMULATED MODE ONLY: deliver queued emulator webhooks (optionally twice, to show de-duplication). */
export async function POST(req: Request) {
  try {
    await requireMerchant(req);
    if (paypalMode() !== "simulated") throw new UserFacingError("Not available: real PayPal mode.", 404);
    const b = z.object({ duplicate: z.boolean().optional(), settlePending: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
    if (b.settlePending) (await import("@/lib/paypal/emulator")).settlePendingRefunds();
    return json(await deliverSimulatedEvents({ duplicateFirst: b.duplicate }));
  } catch (e) { return errorResponse(e); }
}
