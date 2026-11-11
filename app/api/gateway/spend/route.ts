import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";
import { spend } from "@/lib/gateway/service";
import { REASON_TEXT } from "@/lib/reasons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ signed: z.object({ request: z.any(), sig: z.string(), chain: z.array(z.any()).min(1).max(8) }), note: z.string().max(500).optional() });

/**
 * The money boundary. Anyone may call it; the only thing that matters is what the signatures say.
 * Body: { signed: SignedSpend, note?: string }.
 */
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(getDb(), `spend:${clientIp(req)}`, 120, 600))) return json({ error: "Too many requests." }, 429);
    const b = Body.parse(await req.json());
    const r = await spend(b.signed as never, b.note);
    return json({
      status: r.status, duplicate: r.duplicate, spendId: r.spend?.id ?? null,
      reasons: r.reasons.map((x) => ({ ...x, meaning: REASON_TEXT[x.code] })),
      paypal: r.spend ? { captureId: r.spend.captureId, payoutBatchId: r.spend.payoutBatchId, payoutItemId: r.spend.payoutItemId, payoutStatus: r.spend.payoutStatus } : null,
      receipt: r.receipt,
    }, r.status === "DENIED" ? 403 : r.status === "FAILED" ? 502 : 200);
  } catch (e) { return errorResponse(e); }
}
