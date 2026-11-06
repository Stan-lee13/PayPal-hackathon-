import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { callTool, MCP_TOOLS } from "@/lib/mcp/server";
import { DEMO_FREELANCER_ID } from "@/lib/security/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ name: z.enum(MCP_TOOLS.map((t) => t.name) as [string, ...string[]]), args: z.record(z.string(), z.unknown()).default({}) });

/**
 * The browser playground calls the SAME tool handlers the editor's MCP client reaches through
 * /api/mcp, as the demo freelancer. It returns the JSON-RPC exchange so the page can show it.
 */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    const db = getDb();
    const ip = clientIp(req);
    if (!(await rateLimit(db, `demo:tool:${ip}`, 60, 600))) return json({ error: "Slow down a little: too many demo calls from your network. Try again in a few minutes." }, 429);
    const { name, args } = Body.parse(await req.json());
    if (name === "send_invoice" && !(await rateLimit(db, "demo:send:global", 40, 3600))) return json({ error: "The demo has sent a lot of invoices this hour. Try again later." }, 429);
    const request = { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } };
    const result = await callTool(DEMO_FREELANCER_ID, name, args);
    return json({ request, response: { jsonrpc: "2.0", id: request.id, result } });
  } catch (e) { return errorResponse(e); }
}
