import { z } from "zod";
import { getDb } from "@/lib/db";
import { runBuyerAgent } from "@/lib/services/chat";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";
import { UserFacingError } from "@/lib/services/orders";

const Body = z.object({ sessionId: z.string().regex(/^chat_[A-Za-z0-9_-]{16}$/), mandate: z.string().trim().min(8).max(400) });

export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    if (!(await rateLimit(getDb(), `agent:ip:${clientIp(req)}`, 10, 600))) throw new UserFacingError("Too many agent runs — wait a few minutes.", 429);
    const r = await runBuyerAgent(b.sessionId, b.mandate);
    return json(r);
  } catch (e) { return errorResponse(e); }
}
