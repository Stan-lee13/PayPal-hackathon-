import { route } from "@/lib/api/next";
import { gatewayRunsInBrowser } from "@/lib/deployment";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The configured financial rail calls this. Its event shape is parsed by the rail's adapter and its
// signature is verified with the provider itself before anything is done with the event.
// `/api/paypal/webhook` remains as an alias for deployments that already registered that URL.
const withGateway = route("POST /api/rails/webhook", { global: ["webhook", 3000, 600] });

export async function POST(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  // A copy with no server database has no gateway to apply the event to. Say so; never acknowledge it.
  if (gatewayRunsInBrowser()) return json({ error: "This gateway runs in the visitor's browser: the event was not applied." }, 503);
  return withGateway(req, ctx);
}
