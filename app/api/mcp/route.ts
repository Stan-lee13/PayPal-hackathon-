import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { freelancers } from "@/lib/db/schema";
import { rateLimit } from "@/lib/security/rate-limit";
import { handleMcp } from "@/lib/mcp/server";
import { clientIp } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rpcError = (status: number, code: number, message: string, extra?: Record<string, string>) =>
  NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...extra } });

/** Bearer token → freelancer id (tokens are stored only as SHA-256). */
async function authenticate(req: Request): Promise<string | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+([A-Za-z0-9_\-.]{20,200})$/);
  if (!m) return null;
  const hash = createHash("sha256").update(m[1]!).digest("hex");
  const row = await getDb().query.freelancers.findFirst({ where: eq(freelancers.mcpTokenHash, hash), columns: { id: true, mcpTokenHash: true } });
  if (!row?.mcpTokenHash) return null;
  return timingSafeEqual(Buffer.from(row.mcpTokenHash), Buffer.from(hash)) ? row.id : null;
}

/** MCP Streamable HTTP endpoint (stateless; JSON responses; batches accepted for older clients). */
export async function POST(req: Request) {
  if (!(await rateLimit(getDb(), `mcp:ip:${clientIp(req)}`, 120, 60))) return rpcError(429, -32000, "Rate limited");
  const freelancerId = await authenticate(req);
  if (!freelancerId) return rpcError(401, -32001, "Unauthorized: send Authorization: Bearer <your MergePay token> (dashboard → Connect your editor).", { "WWW-Authenticate": 'Bearer realm="mergepay"' });
  let body: unknown;
  try { body = await req.json(); } catch { return rpcError(400, -32700, "Parse error"); }
  const msgs = Array.isArray(body) ? body.slice(0, 20) : [body];
  const out = [];
  for (const m of msgs) {
    const r = await handleMcp(freelancerId, m as never);
    if (r) out.push(r);
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
