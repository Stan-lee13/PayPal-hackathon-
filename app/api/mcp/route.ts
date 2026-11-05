import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { handleMcp } from "@/lib/services/mcp";
import { clientIp } from "@/lib/http";

export const dynamic = "force-dynamic";

/** MCP Streamable HTTP endpoint (stateless; JSON responses; batches accepted for older clients). */
export async function POST(req: Request) {
  if (!(await rateLimit(getDb(), `mcp:ip:${clientIp(req)}`, 120, 60))) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limited" } }, { status: 429 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  const msgs = Array.isArray(body) ? body.slice(0, 20) : [body];
  const out = (await Promise.all(msgs.map((m) => handleMcp(m as never)))).filter((r) => r !== null);
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  // No server-initiated stream: this server only answers requests.
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
