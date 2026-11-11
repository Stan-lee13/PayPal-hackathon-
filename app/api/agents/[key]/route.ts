import { errorResponse, json } from "@/lib/http";
import { agentProfile } from "@/lib/gateway/service";
import { isDemoAgent } from "@/lib/demo/agents";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

/** Public profile of one agent key: who stands behind it, what it holds, what it has done. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return json({ error: "Not an agent key." }, 400);
    const p = await agentProfile(key);
    if (!p) return json({ error: "No agent with that key has been seen by this gateway." }, 404);
    return json({ ...p, mode: paypalMode(), demo: await isDemoAgent(key) });
  } catch (e) { return errorResponse(e); }
}
