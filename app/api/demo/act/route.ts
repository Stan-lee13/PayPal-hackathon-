import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { act, DEMO_ACTIONS } from "@/lib/demo/agents";
import { REASON_TEXT } from "@/lib/reasons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** DEMO: one scripted agent step. It goes through the same gateway code as any external agent. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `demoact:${clientIp(req)}`, 120, 3600))) return json({ error: "Too many demo steps; try later." }, 429);
    const b = z.object({ rootId: z.string().max(60), action: z.enum(DEMO_ACTIONS) }).parse(await req.json());
    const r = await act(b.rootId, b.action);
    return json({ action: r.action, narration: r.narration, status: r.result?.status ?? null, reasons: r.result?.reasons.map((x) => ({ code: x.code, detail: x.detail, meaning: REASON_TEXT[x.code] })) ?? [] });
  } catch (e) { return errorResponse(e); }
}
