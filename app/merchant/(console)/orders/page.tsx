import { currentMerchant } from "@/lib/security/session";
import { listOrdersWithPromises } from "@/lib/services/views";
import { LedgerGrid, type OrderRow } from "@/components/ledger-grid";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const merchantId = (await currentMerchant())!;
  const rows: OrderRow[] = (await listOrdersWithPromises(merchantId)).map(({ order: o, promises, broken, madeGood }) => ({
    id: o.id, createdAt: o.createdAt.toISOString(), customer: o.buyerFirstName ?? "—", email: o.buyerEmailRedacted ?? "", status: o.captureStatus ?? o.status,
    capturedMinor: o.captureAmountMinor, refundedMinor: o.refundedMinor, currency: o.captureCurrency ?? o.currency, promises, broken, madeGood,
  }));
  return (
    <>
      <h1 className="quote text-3xl">Orders</h1>
      <p className="text-sm text-ink-soft">Every PayPal order with its promises: how many were made, how many are broken, how many were made good.</p>
      {rows.length === 0 ? <p className="mt-4 text-sm text-ink-soft">No orders yet.</p> : <LedgerGrid kind="orders" rows={rows} searchLabel="Search orders…" />}
    </>
  );
}
