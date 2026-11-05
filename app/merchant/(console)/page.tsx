import Link from "next/link";
import { currentMerchant } from "@/lib/security/session";
import { getInbox } from "@/lib/services/views";
import { StateSeal } from "@/components/seal";
import { AutoRefresh } from "@/components/auto-refresh";
import { LedgerGrid, type PromiseRow } from "@/components/ledger-grid";
import { getDb } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { latestPreflight, explain } from "@/lib/services/preflight";

export const metadata = { title: "Promises" };

const TYPE: Record<string, string> = { PRICE_AS_QUOTED: "Price as quoted", SHIP_BY: "Ship by", REFUND_BY: "Refund by", OTHER: "Other", MANDATE_MAX_TOTAL: "Shopper mandate · limit", MANDATE_SHIP_WITHIN: "Shopper mandate · shipping" };
const SOURCE: Record<string, string> = { CHAT_TRANSCRIPT: "AI sales chat", REFUND_POLICY: "Refund policy", SHIPPING_POLICY: "Shipping policy", PRODUCT_PAGE: "Product page", USER_MANDATE: "Shopper's mandate" };

export default async function InboxPage() {
  const merchantId = (await currentMerchant())!;
  const rows = await getInbox(merchantId);
  const heldOrders = await getDb().select().from(orders).where(and(eq(orders.merchantId, merchantId), inArray(orders.status, ["CAPTURE_BLOCKED", "NEEDS_CONFIRMATION", "PRECHECK_FAILED"])));
  const held = await Promise.all(heldOrders.map(async (o) => ({ o, pf: await latestPreflight(o.id) })));
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.commitment.state] = (a[r.commitment.state] ?? 0) + 1), a), {});
  const grid: PromiseRow[] = rows.map(({ commitment: c, order: o, remedy, sourceKind }) => {
    const ev = (c.evaluation ?? {}) as Record<string, unknown>;
    const gap = typeof ev.outstandingMinor === "number" ? ev.outstandingMinor : null;
    return {
      id: c.id, orderId: o.id, state: c.state, madeGood: ev.madeGood === true, type: c.type, typeLabel: TYPE[c.type] ?? c.type, quote: c.quote, reason: c.stateReason ?? "",
      source: sourceKind ? SOURCE[sourceKind] ?? sourceKind : "—", customer: o.buyerFirstName ?? "Customer",
      amountMinor: o.captureAmountMinor ?? o.requestedTotalMinor, gapMinor: gap, currency: o.captureCurrency ?? o.currency,
      dueAt: c.dueAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
      remedy: remedy ? (remedy.state === "PROPOSED" ? "Remedy awaiting approval" : `Remedy ${remedy.state.toLowerCase()}`) : null,
    };
  });
  return (
    <>
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="quote text-3xl">Promises</h1>
          <p className="text-sm text-ink-soft">Broken first, then at risk, then those needing your confirmation. Sort, filter or search any column; open a row for its ledger.</p>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Counts">
          {(["BROKEN", "AT_RISK", "NEEDS_CONFIRMATION", "PENDING", "KEPT"] as const).map((s) => <li key={s} className="flex items-center gap-1"><StateSeal state={s} size="sm" /><span className="mono">{counts[s] ?? 0}</span></li>)}
        </ul>
      </div>
      {held.length > 0 && (
        <section className="mt-6 rounded-lg border border-broken bg-broken-wash p-4" aria-labelledby="held-h">
          <h2 id="held-h" className="eyebrow text-broken">Checkouts held by Kept before capture · {held.length}</h2>
          <ul className="mt-2 space-y-2 text-sm">{held.map(({ o, pf }) => (
            <li key={o.id}><Link className="font-semibold underline" href={`/merchant/orders/${o.id}`}>{o.status === "CAPTURE_BLOCKED" ? "Blocked" : o.status === "NEEDS_CONFIRMATION" ? "Needs your confirmation" : "Check failed"} · <span className="mono">{o.id}</span></Link>
              <span className="block text-ink-soft">{pf ? explain(pf) : ""}</span></li>))}
          </ul>
        </section>
      )}
      {rows.length === 0 && held.length === 0 ? (
        <div className="paper mt-8 p-8 text-center">
          <p className="quote text-xl">No promises yet.</p>
          <p className="mt-1 text-sm text-ink-soft">Promises appear when a customer pays. <Link className="underline" href="/store">Open the store</Link> to place a demo order.</p>
        </div>
      ) : <LedgerGrid kind="promises" rows={grid} searchLabel="Search promises, quotes, customers…" />}
    </>
  );
}
