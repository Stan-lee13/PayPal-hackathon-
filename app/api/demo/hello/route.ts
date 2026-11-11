import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { demoHello } from "@/lib/demo/agents";

export const dynamic = "force-dynamic";

/** DEMO: have a built-in agent introduce itself to a payee. The result is checked through the public standing endpoint. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `demohello:${clientIp(req)}`, 120, 3600))) return json({ error: "Too many requests; try later." }, 429);
    const b = z.object({ agent: z.string().regex(/^[A-Za-z0-9_-]{43}$/), amountMinor: z.number().int().positive().max(1_000_00), payee: z.string().min(3).max(127), purpose: z.string().min(1).max(60) }).parse(await req.json());
    return json({ hello: await demoHello(b.agent, b) });
  } catch (e) { return errorResponse(e); }
}
