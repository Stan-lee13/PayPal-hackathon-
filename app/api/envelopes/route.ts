import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { roots } from "@/lib/db/schema";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";
import { registerRoot } from "@/lib/gateway/service";
import { attachDemoAgents } from "@/lib/demo/agents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    return json({ roots: await getDb().select().from(roots).orderBy(desc(roots.createdAt)).limit(30) });
  } catch (e) { return errorResponse(e); }
}

const Body = z.object({ chain: z.array(z.any()).length(1), principalName: z.string().max(80).default("Principal"), title: z.string().max(120).default("Envelope"), draftId: z.string().max(60).optional() });

/** Seal: register a root envelope signed by the principal; the gateway places the PayPal hold. */
export async function POST(req: Request) {
  try {
    const db = getDb();
    if (!(await rateLimit(db, `seal:${clientIp(req)}`, 12, 3600)) || !(await rateLimit(db, "seal:global", 120, 3600))) return json({ error: "Too many envelopes sealed recently; try again later." }, 429);
    const b = Body.parse(await req.json());
    const root = await registerRoot({ chain: b.chain, principalName: b.principalName, title: b.title });
    const demo = b.draftId ? await attachDemoAgents(b.draftId, b.chain) : false;
    return json({ root, demoAgents: demo });
  } catch (e) { return errorResponse(e); }
}
