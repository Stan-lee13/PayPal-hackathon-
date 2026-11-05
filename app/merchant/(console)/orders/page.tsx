import Link from "next/link";
import { currentMerchant } from "@/lib/security/session";
import { listOrders } from "@/lib/services/views";
import { Money } from "@/components/money";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const merchantId = (await currentMerchant())!;
  const rows = await listOrders(merchantId);
  return (
    <>
      <h1 className="quote text-3xl">Orders</h1>
      {rows.length === 0 ? <p className="mt-4 text-sm text-ink-soft">No orders yet.</p> : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="rule-b"><tr className="eyebrow"><th className="py-2 pr-3 font-semibold">Order</th><th className="pr-3 font-semibold">Customer</th><th className="pr-3 font-semibold">PayPal status</th><th className="pr-3 text-right font-semibold">Captured</th><th className="text-right font-semibold">Refunded</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="rule-b">
                  <td className="py-2 pr-3"><Link className="mono underline" href={`/merchant/orders/${o.id}`}>{o.id}</Link><span className="block text-xs text-ink-soft">{o.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span></td>
                  <td className="pr-3">{o.buyerFirstName ?? "—"}<span className="block text-xs text-ink-soft">{o.buyerEmailRedacted ?? ""}</span></td>
                  <td className="pr-3">{o.captureStatus ?? o.status}</td>
                  <td className="pr-3 text-right"><Money minor={o.captureAmountMinor} currency={o.captureCurrency} /></td>
                  <td className="text-right"><Money minor={o.refundedMinor} currency={o.captureCurrency ?? o.currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
