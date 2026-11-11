import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { createDemoAgents } from "@/lib/demo/agents";

export const dynamic = "force-dynamic";

/** DEMO: create the console's scripted agents for a draft envelope; returns the key to seal it for. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `demoagents:${clientIp(req)}`, 30, 3600))) return json({ error: "Too many demo runs; try later." }, 429);
    const { draftId } = z.object({ draftId: z.string().regex(/^draft_[A-Za-z0-9_-]{8,40}$/) }).parse(await req.json());
    return json(await createDemoAgents(draftId));
  } catch (e) { return errorResponse(e); }
}
