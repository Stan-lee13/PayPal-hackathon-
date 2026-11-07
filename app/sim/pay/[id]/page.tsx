import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeBanner } from "@/components/mode-banner";
import { paypalMode } from "@/lib/paypal/client";
import { formatMoney, toMinor } from "@/lib/money";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulated payment page", robots: { index: false } };

export default async function SimPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (paypalMode() !== "simulated" || !/^INV2-SIM-[A-Z0-9]{8,32}$/.test(id)) notFound();
  const { simInvoiceSnapshot } = await import("@/lib/paypal/emulator");
  const inv = await simInvoiceSnapshot(id);
  if (!inv) notFound();
  const c = inv.detail.currency_code;
  const total = toMinor(inv.amount.value, c);
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-xl px-4 py-10">
        <p className="rounded-lg border border-dashed border-blocked/50 bg-blocked-wash px-3 py-2 text-sm">
          <strong>Simulated payment page.</strong> MergePay&rsquo;s stand-in for the invoice page PayPal hosts when real PayPal credentials are configured. No money moves.
        </p>
        <div className="card card-lift mt-5 overflow-hidden">
          <div className="border-b border-rule px-5 py-4">
            <p className="eyebrow">Invoice {inv.detail.invoice_number}</p>
            <p className="mt-1 text-lg font-semibold">{inv.invoicer?.business_name ?? "Your freelancer"}</p>
            <p className="text-sm text-ink-soft">to {inv.primary_recipients[0]?.billing_info.email_address}</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {inv.items.map((i, k) => (
                <tr key={k} className="border-b border-rule/70 align-top">
                  <td className="px-5 py-3"><p className="font-medium">{i.name}</p>{i.description && <p className="text-xs text-ink-soft">{i.description}</p>}</td>
                  <td className="money px-5 py-3 text-right">{formatMoney(Math.round(toMinor(i.unit_amount.value, c) * Number(i.quantity)), c)}</td>
                </tr>
              ))}
              <tr><td className="px-5 py-3 text-right text-xs uppercase tracking-wider text-ink-soft">Total due</td><td className="money px-5 py-3 text-right text-lg font-semibold">{formatMoney(inv.status === "PAID" ? 0 : total, c)}</td></tr>
            </tbody>
          </table>
          {inv.detail.note && <p className="whitespace-pre-wrap border-t border-rule px-5 py-3 text-sm text-ink-soft">{inv.detail.note}</p>}
          {inv.detail.terms_and_conditions && <p className="border-t border-rule bg-sunken px-5 py-3 text-xs"><span className="font-semibold">Terms: </span>{inv.detail.terms_and_conditions}</p>}
          <div className="border-t border-rule px-5 py-4">
            {inv.status === "PAID"
              ? <div><p className="chip chip-PAID">Paid {formatMoney(total, c)}</p><p className="mt-2 text-sm text-ink-soft" role="status">Paid. PayPal&rsquo;s INVOICING.INVOICE.PAID event went to MergePay; go back to the demo to watch the merge.</p></div>
              : inv.status === "SENT" ? <PayButton id={id} label={`Pay ${formatMoney(total, c)} (simulated)`} /> : <p className="text-sm text-ink-soft">This invoice is {inv.status.toLowerCase()}.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
