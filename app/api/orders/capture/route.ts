import { after } from "next/server";
import { z } from "zod";
import { captureKeptOrder } from "@/lib/services/orders";
import { afterPaymentEvidence } from "@/lib/services/pipeline";
import { deliverSimulatedEvents } from "@/lib/services/simulation";
import { errorResponse, json } from "@/lib/http";

const Body = z.object({ keptOrderId: z.string().regex(/^ko_[A-Za-z0-9_-]{16}$/), paypalOrderId: z.string().min(5).max(64) });

/** Called by the PayPal JS SDK's onApprove callback. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const order = await captureKeptOrder(b.keptOrderId, b.paypalOrderId);
    // Promise extraction + evaluation run after the response (the capture itself is already verified by GET).
    after(async () => {
      try {
        await deliverSimulatedEvents();
        await afterPaymentEvidence(order.id);
      } catch (e) { console.error("[kept] post-capture pipeline", e); }
    });
    return json({ ok: true, status: order.status, captureStatus: order.captureStatus, receiptUrl: `/r/${order.receiptToken}` });
  } catch (e) { return errorResponse(e); }
}
