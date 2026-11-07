import { z } from "zod";
import { errorResponse, json, sameOrigin } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (paypalMode() !== "simulated") return json({ error: "Real PayPal is configured: approve on PayPal." }, 409);
    const { orderId } = z.object({ orderId: z.string().regex(/^SIMORD[A-Z0-9]{8,32}$/) }).parse(await req.json());
    const { simApproveOrder } = await import("@/lib/paypal/emulator-payments");
    const r = await simApproveOrder(orderId);
    return r.ok ? json({ returnUrl: r.returnUrl }) : json({ error: r.message }, 409);
  } catch (e) { return errorResponse(e); }
}
