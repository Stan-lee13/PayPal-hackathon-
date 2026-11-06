import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { acceptTerms } from "@/lib/services/contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `accept:${clientIp(req)}`, 20, 600))) return json({ error: "Too many attempts." }, 429);
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(await req.json());
    const c = await acceptTerms(token, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" });
    return json({ ok: true, acceptedAt: c.clientAcceptedAt });
  } catch (e) { return errorResponse(e); }
}
