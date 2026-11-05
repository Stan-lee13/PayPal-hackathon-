import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { remedies } from "@/lib/db/schema";
import { proposeRemedy } from "@/lib/services/remedies";
import { evaluateOrder } from "@/lib/services/ledger";
import { assertCommitmentOwned } from "@/lib/services/ownership";
import { UserFacingError } from "@/lib/services/orders";
import { errorResponse, json, requireMerchant } from "@/lib/http";

/** Merchant asks for a fresh proposal (e.g. after rejecting one). Previous rejections are marked superseded. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchant(req);
    const { id } = await params;
    const c = await assertCommitmentOwned(id, merchantId);
    const needs = await evaluateOrder(c.orderId);
    if (!needs.some((n) => n.id === id)) throw new UserFacingError("This promise does not currently need a remedy.", 409);
    await getDb().update(remedies).set({ state: "SUPERSEDED", updatedAt: new Date() }).where(and(eq(remedies.commitmentId, id), eq(remedies.state, "REJECTED")));
    const r = await proposeRemedy(id);
    return json({ remedy: r && { id: r.id, state: r.state, kind: r.kind } });
  } catch (e) { return errorResponse(e); }
}
