import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";
import { currentPersona } from "@/lib/security/persona";
import * as B from "@/lib/services/bounties";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fund") }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(300).default("") }),
  z.object({ action: z.literal("sign_nda"), name: z.string().min(2).max(120) }),
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("submit"), pr: z.coerce.number().int().positive(), note: z.string().max(1000).default("") }),
  z.object({ action: z.literal("reverify"), submissionId: z.string() }),
  z.object({ action: z.literal("decide"), submissionId: z.string(), decision: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT"]), note: z.string().max(2000).default(""), override: z.boolean().default(false) }),
  z.object({ action: z.literal("dispute"), submissionId: z.string(), reason: z.string().max(2000) }),
  z.object({ action: z.literal("refund") }),
  z.object({ action: z.literal("sync_capture") }),
  z.object({ action: z.literal("sync_payout") }),
]);

/** Every bounty action, authorised by the current persona (company or developer). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `bounty:act:${clientIp(req)}`, 60, 600))) return json({ error: "Too many actions; slow down." }, 429);
    const { id } = await params;
    const p = await currentPersona();
    const a = Action.parse(await req.json());
    const asCompany = () => { if (p.kind !== "company") throw new Error("COMPANY_ONLY"); return p.id; };
    const asDev = () => { if (p.kind !== "developer") throw new Error("DEVELOPER_ONLY"); return p.id; };
    switch (a.action) {
      case "fund": return json(await B.startFunding(asCompany(), id));
      case "cancel": return json({ bounty: await B.cancelBounty(asCompany(), id, a.reason) });
      case "sign_nda": await B.signNda(asDev(), id, a.name, clientIp(req)); return json({ ok: true });
      case "claim": return json({ bounty: await B.claimBounty(asDev(), id) });
      case "submit": return json({ submission: await B.submitWork(asDev(), id, a.pr, a.note) });
      case "reverify": return json({ submission: await B.reverify(p.kind === "company" ? { companyId: p.id } : { developerId: p.id }, a.submissionId) });
      case "decide": return json(await B.decide(asCompany(), a.submissionId, a.decision, a.note, { overrideFailedChecks: a.override }));
      case "dispute": return json({ submission: await B.disputeRejection(asDev(), a.submissionId, a.reason) });
      case "refund": return json({ bounty: await B.refundFailedPayout(asCompany(), id) });
      case "sync_capture": asCompany(); return json({ bounty: await B.syncCapture(id) });
      case "sync_payout": return json({ bounty: await B.syncPayout(id) });
    }
  } catch (e) {
    if (e instanceof Error && e.message === "COMPANY_ONLY") return json({ error: "Only the company that posted this bounty can do that. Switch persona." }, 403);
    if (e instanceof Error && e.message === "DEVELOPER_ONLY") return json({ error: "Switch to a developer persona to do that." }, 403);
    return errorResponse(e);
  }
}
void submissions; void eq;
