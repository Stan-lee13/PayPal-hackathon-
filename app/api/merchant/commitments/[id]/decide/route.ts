import { z } from "zod";
import { decideCommitment } from "@/lib/services/merchant-actions";
import { assertCommitmentOwned } from "@/lib/services/ownership";
import { errorResponse, json, requireMerchant } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    await assertCommitmentOwned(id, merchantId);
    const b = z.object({ decision: z.enum(["WAIVE", "CONFIRM"]), note: z.string().max(200).default("") }).parse(await req.json());
    await decideCommitment(id, b.decision, b.note);
    return json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
