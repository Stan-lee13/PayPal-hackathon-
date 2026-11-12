import { route } from "@/lib/api/next";
import { logPayPalDelivery } from "@/lib/api/relay";
import { gatewayRunsInBrowser } from "@/lib/deployment";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PayPal calls this. Every event is verified with PayPal before anything is done with it.
const withGateway = route("POST /api/paypal/webhook", { global: ["webhook", 3000, 600] });

export async function POST(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  // A copy with no database has no gateway to apply the event: it logs the delivery for replay elsewhere and says so.
  return gatewayRunsInBrowser() ? logPayPalDelivery(req) : withGateway(req, ctx);
}
