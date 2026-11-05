import { z } from "zod";
import { approveRemedy } from "@/lib/services/remedies";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { errorResponse, json, requireMerchant } from "@/lib/http";
import { getDb } from "@/lib/db";
import { remedies } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { UserFacingError } from "@/lib/services/orders";
import { paypalMode } from "@/lib/paypal/client";

const Body = z.object({
  customerMessage: z.string().trim().min(1).max(600),
  acknowledgeLarge: z.boolean().optional(),
  /** Sandbox/simulated negative testing only (PayPal-Mock-Response). Ignored on live. */
  simulate: z.enum(["REFUND_FAILED_INSUFFICIENT_FUNDS", "REFUND_PENDING"]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    const b = Body.parse(await req.json());
    const owned = await getDb().query.remedies.findFirst({ where: and(eq(remedies.id, id), eq(remedies.merchantId, merchantId)) });
    if (!owned) throw new UserFacingError("Remedy not found.", 404);
    if (b.simulate === "REFUND_PENDING" && paypalMode() !== "simulated") throw new UserFacingError("Pending-refund simulation is only available in simulated mode.", 400);
    const r = await approveRemedy(id, { customerMessage: b.customerMessage, acknowledgeLarge: b.acknowledgeLarge, mockResponse: b.simulate });
    await deliverSimulatedEvents();
    return json({ remedy: { id: r.id, state: r.state, paypalRefundId: r.paypalRefundId, paypalRefundStatus: r.paypalRefundStatus, errorCode: r.errorCode, errorDetail: r.errorDetail } });
  } catch (e) { return errorResponse(e); }
}
