import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";
import { standing } from "@/lib/gateway/service";
import { REASON_TEXT } from "@/lib/reasons";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ hello: z.object({ request: z.any(), sig: z.string(), chain: z.array(z.any()).min(1).max(8) }) });

/**
 * "Is this agent good for the money?" A counterparty posts the introduction an agent gave it and
 * gets back a statement signed by the gateway. Read-only; moves no money.
 */
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getDb(), `standing:${clientIp(req)}`, 120, 600))) return json({ error: "Too many requests." }, 429);
    const b = Body.parse(await req.json());
    const s = await standing(b.hello as never);
    return json({ standing: s, meanings: Object.fromEntries(s.reasons.map((x) => [x.code, REASON_TEXT[x.code]])) });
  } catch (e) { return errorResponse(e); }
}
