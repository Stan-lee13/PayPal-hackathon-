import { z } from "zod";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { currentPersona } from "@/lib/security/persona";
import { publishBounty, startFunding } from "@/lib/services/bounties";

export const dynamic = "force-dynamic";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

const Body = z.object({
  repo: z.string(), issueNumber: z.coerce.number().int().positive().nullable(), title: z.string().min(5).max(140), summary: z.string().min(10).max(600),
  details: z.string().max(8000).default(""), criteria: z.string(), skills: z.string().default(""), amount: z.string(), deadlineDays: z.coerce.number().int().min(1).max(90).nullable(),
  ndaRequired: z.boolean(), ndaText: z.string().nullable(), requiresTests: z.boolean(), requiredChecks: z.string().default(""),
});

/** Company publishes a bounty and is sent to PayPal to reserve the funds. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `bounty:new:${clientIp(req)}`, 10, 3600))) return json({ error: "Too many new bounties from your network; try later." }, 429);
    const p = await currentPersona();
    if (p.kind !== "company") return json({ error: "Switch to the company persona to post a bounty." }, 403);
    const i = Body.parse(await req.json());
    const b = await publishBounty(p.id, { ...i, criteria: lines(i.criteria), skills: i.skills.split(",").map((s) => s.trim()).filter(Boolean), requiredChecks: i.requiredChecks.split(",").map((s) => s.trim()).filter(Boolean), scopePaths: [], details: i.details || i.summary });
    const { approveUrl } = await startFunding(p.id, b.id);
    return json({ id: b.id, approveUrl });
  } catch (e) { return errorResponse(e); }
}
