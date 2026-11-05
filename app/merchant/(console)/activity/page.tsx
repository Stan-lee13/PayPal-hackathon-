import Link from "next/link";
import { currentMerchant } from "@/lib/security/session";
import { merchantAudit } from "@/lib/services/views";

export const metadata = { title: "Activity" };

const ACTOR: Record<string, string> = { ai: "AI proposal", merchant: "Merchant decision", system: "Kept system", paypal: "PayPal-confirmed", customer: "Customer" };

export default async function ActivityPage() {
  const merchantId = (await currentMerchant())!;
  const rows = await merchantAudit(merchantId);
  return (
    <>
      <h1 className="quote text-3xl">Activity</h1>
      <p className="text-sm text-ink-soft">Every action, attributed: AI proposals, merchant decisions, Kept system events and PayPal-confirmed outcomes.</p>
      <ol className="mt-4 divide-y divide-[var(--rule)] border-y border-rule text-sm">
        {rows.map((a) => (
          <li key={a.id} className="grid gap-1 py-2 sm:grid-cols-[10rem_9rem_1fr]">
            <time className="mono text-xs text-ink-soft">{a.createdAt.toISOString().slice(0, 19).replace("T", " ")}</time>
            <span className="eyebrow">{ACTOR[a.actor]}</span>
            <span>
              <span className="mono text-xs">{a.action}</span> <span className="text-xs">· {a.outcome}</span>
              {a.orderId && <> · <Link className="mono text-xs underline" href={`/merchant/orders/${a.orderId}`}>{a.orderId}</Link></>}
              {Object.keys(a.detail).length > 0 && <span className="block break-all text-xs text-ink-soft">{JSON.stringify(a.detail)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
