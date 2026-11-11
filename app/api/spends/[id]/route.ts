import { errorResponse, json } from "@/lib/http";
import { reconcile } from "@/lib/gateway/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A receipt, its full authority chain, and a live check of it against PayPal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const r = await reconcile(id);
    return json({ ok: r.ok, checks: r.checks, receipt: r.receipt, chain: r.spend.signed.chain, spend: { id: r.spend.id, status: r.spend.status, payoutStatus: r.spend.payoutStatus, payoutTransactionId: r.spend.payoutTransactionId, agentNote: r.spend.agentNote } });
  } catch (e) { return errorResponse(e); }
}
