import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, spends } from "@/lib/db/schema";
import { errorResponse, json } from "@/lib/http";
import { syncSpend, tree } from "@/lib/gateway/service";
import { hasDemoAgents } from "@/lib/demo/agents";
import { verifyChain } from "@/lib/ledger/chain";
import { paypalMode } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let t = await tree(id);
    if (!t) return json({ error: "No such envelope." }, 404);
    // pending payouts: ask PayPal (cheap GET) so the page settles by itself
    const pending = t.spends.filter((s) => s.status === "PAYOUT_PENDING").slice(0, 3);
    if (pending.length) { await Promise.all(pending.map((s) => syncSpend(s.id).catch(() => null))); t = (await tree(id))!; }
    const trail = await getDb().select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(asc(auditLog.seq));
    const audit = verifyChain(t.root.principal, id, trail.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })) as never);
    return json({
      mode: paypalMode(), root: t.root, demoAgents: await hasDemoAgents(id),
      blocks: t.blocks.map(({ raw: _raw, ...b }) => b),
      spends: t.spends.map(({ signed: _s, receipt: _r, ...s }) => ({ ...s, hasReceipt: Boolean(_r) })),
      audit: { ok: audit.ok, length: audit.length, entries: trail.map((x) => ({ seq: x.seq, at: x.createdAt, actor: x.actor, action: x.action, ref: x.ref, outcome: x.outcome })) },
    });
  } catch (e) { return errorResponse(e); }
}
void spends;
