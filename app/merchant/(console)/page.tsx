import Link from "next/link";
import { currentMerchant } from "@/lib/security/session";
import { getInbox } from "@/lib/services/views";
import { StateSeal } from "@/components/seal";
import { Money } from "@/components/money";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata = { title: "Promises" };

const TYPE: Record<string, string> = { PRICE_AS_QUOTED: "Price as quoted", SHIP_BY: "Ship by", REFUND_BY: "Refund by", OTHER: "Other", MANDATE_MAX_TOTAL: "Shopper mandate · limit", MANDATE_SHIP_WITHIN: "Shopper mandate · shipping" };

export default async function InboxPage() {
  const merchantId = (await currentMerchant())!;
  const rows = await getInbox(merchantId);
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.commitment.state] = (a[r.commitment.state] ?? 0) + 1), a), {});
  return (
    <>
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="quote text-3xl">Promises</h1>
          <p className="text-sm text-ink-soft">Broken first, then at risk, then those needing your confirmation.</p>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Counts">
          {(["BROKEN", "AT_RISK", "NEEDS_CONFIRMATION", "PENDING", "KEPT"] as const).map((s) => <li key={s} className="flex items-center gap-1"><StateSeal state={s} size="sm" /><span className="mono">{counts[s] ?? 0}</span></li>)}
        </ul>
      </div>

      {rows.length === 0 ? (
        <div className="paper mt-8 p-8 text-center">
          <p className="quote text-xl">No promises yet.</p>
          <p className="mt-1 text-sm text-ink-soft">Promises appear when a customer pays. <Link className="underline" href="/store">Open the store</Link> to place a demo order.</p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--rule)] border-y border-rule">
          {rows.map(({ commitment: c, order: o, remedy }) => (
            <li key={c.id}>
              <Link href={`/merchant/orders/${o.id}#${c.id}`} className="grid gap-2 py-4 hover:bg-raised sm:grid-cols-[9rem_1fr_9rem_8rem] sm:items-center sm:gap-4 sm:px-2">
                <span><StateSeal state={c.state} size="sm" madeGood={c.evaluation?.madeGood === true} /></span>
                <span className="min-w-0">
                  <span className="eyebrow">{TYPE[c.type]}</span>
                  <span className="quote block truncate text-lg">&ldquo;{c.quote}&rdquo;</span>
                  <span className="block text-sm text-ink-soft">{c.stateReason}</span>
                </span>
                <span className="text-sm">
                  <span className="block">{o.buyerFirstName ?? "Customer"}</span>
                  <span className="mono block text-xs text-ink-soft">{o.id}</span>
                </span>
                <span className="text-right text-sm">
                  <Money minor={o.captureAmountMinor ?? o.requestedTotalMinor} currency={o.captureCurrency ?? o.currency} />
                  {c.dueAt && <span className="mono block text-xs text-ink-soft">due {c.dueAt.toISOString().slice(0, 16).replace("T", " ")}</span>}
                  {remedy && <span className="block text-xs font-semibold text-accent">{remedy.state === "PROPOSED" ? "Remedy awaiting approval" : `Remedy ${remedy.state.toLowerCase()}`}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
