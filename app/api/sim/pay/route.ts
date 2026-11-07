import { z } from "zod";
import { errorResponse, json, sameOrigin } from "@/lib/http";
import { paypalMode } from "@/lib/paypal/client";
import { deliverSimulatedEvents } from "@/lib/services/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Simulated PayPal only: the client pays on the simulated payer page; the INVOICE.PAID event is then delivered. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (paypalMode() !== "simulated") return json({ error: "Real PayPal is configured: pay on PayPal's own invoice page." }, 409);
    const { invoiceId } = z.object({ invoiceId: z.string().regex(/^INV2-SIM-[A-Z0-9]{8,32}$/) }).parse(await req.json());
    const { simPayInvoice } = await import("@/lib/paypal/emulator");
    const r = await simPayInvoice(invoiceId);
    if (!r.ok) return json({ error: r.message }, 409);
    const delivered = await deliverSimulatedEvents();
    return json({ ok: true, message: r.message, delivered });
  } catch (e) { return errorResponse(e); }
}
