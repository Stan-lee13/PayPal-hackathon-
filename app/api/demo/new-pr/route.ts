import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { createDemoPullRequest } from "@/lib/services/demo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A fresh pull request (and the two issues it closes, with agreed prices) to replay the demo. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    const db = getDb();
    if (!(await rateLimit(db, `demo:newpr:${clientIp(req)}`, 6, 3600)) || !(await rateLimit(db, "demo:newpr:global", 40, 3600))) {
      return json({ error: "Enough new demo pull requests for now; try again later." }, 429);
    }
    return json(await createDemoPullRequest());
  } catch (e) { return errorResponse(e); }
}
