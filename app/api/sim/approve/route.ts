import { z } from "zod";
import { paypalMode } from "@/lib/paypal/client";
import { errorResponse, json } from "@/lib/http";
import { UserFacingError } from "@/lib/services/orders";

/** SIMULATED MODE ONLY: stands in for the buyer approving in PayPal's own window. */
export async function POST(req: Request) {
  try {
    if (paypalMode() !== "simulated") throw new UserFacingError("Not available: real PayPal mode.", 404);
    const b = z.object({ paypalOrderId: z.string().startsWith("SIM") }).parse(await req.json());
    const { approveEmulatorOrder } = await import("@/lib/paypal/emulator");
    approveEmulatorOrder(b.paypalOrderId);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
