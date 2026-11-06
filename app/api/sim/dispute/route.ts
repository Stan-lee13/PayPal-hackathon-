import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { paypalMode } from "@/lib/paypal/client";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { assertOrderOwned } from "@/lib/services/ownership";
import { UserFacingError } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/**
 * SIMULATED MODE ONLY: play the buyer and open a PayPal dispute on this order's capture,
 * then deliver the emulator's CUSTOMER.DISPUTE.CREATED through Kept's normal pipeline.
 * In sandbox/live, buyers open disputes in PayPal's Resolution Center instead.
 */
export async function POST(req: Request) {
  try {
    const merchantId = await requireMerchant(req);
    if (paypalMode() !== "simulated") throw new UserFacingError("Not available: real PayPal mode. Open the dispute as the sandbox buyer in PayPal's Resolution Center.", 404);
    const b = z.object({ orderId: z.string().min(3).max(64), reason: z.enum(["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "INCORRECT_AMOUNT"]) }).parse(await req.json());
    const o = await assertOrderOwned(b.orderId, merchantId);
    if (!o.paypalCaptureId) throw new UserFacingError("This order has no capture to dispute.", 409);
    const existing = await getDb().query.disputes.findFirst({ where: eq(disputes.orderId, o.id) });
    if (existing) throw new UserFacingError("This order already has a dispute.", 409);
    const { openEmulatorDispute } = await import("@/lib/paypal/emulator");
    const { withEmulatorState } = await import("@/lib/paypal/emulator-store");
    try { await withEmulatorState(() => openEmulatorDispute(o.paypalCaptureId!, b.reason)); }
    catch { throw new UserFacingError("The simulated PayPal no longer has this capture (the server restarted). Place a new order.", 409); }
    return json(await deliverSimulatedEvents());
  } catch (e) { return errorResponse(e); }
}
