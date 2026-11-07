import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeBanner } from "@/components/mode-banner";
import { paypalMode } from "@/lib/paypal/client";
import { ApproveButton } from "./approve";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulated PayPal approval", robots: { index: false } };

export default async function SimCheckout({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (paypalMode() !== "simulated" || !/^SIMORD[A-Z0-9]{8,32}$/.test(orderId)) notFound();
  const { simOrderSnapshot } = await import("@/lib/paypal/emulator-payments");
  const o = await simOrderSnapshot(orderId);
  if (!o) notFound();
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-md px-4 py-10">
        <p className="rounded-lg border border-dashed border-blocked/50 bg-blocked-wash px-3 py-2 text-sm"><strong>Simulated approval page.</strong> MergePay&rsquo;s stand-in for PayPal&rsquo;s own checkout when no PayPal credentials are configured. No money moves.</p>
        <div className="card card-lift mt-5 p-5">
          <p className="eyebrow">Authorize, don&rsquo;t charge</p>
          <p className="mt-1 font-semibold">{o.description}</p>
          <ul className="mt-3 space-y-1 text-sm">{o.items.map((i, k) => <li key={k} className="flex justify-between"><span>{i.name}</span><span className="money">${i.unit_amount.value}</span></li>)}</ul>
          <p className="mt-3 flex justify-between border-t border-rule pt-2 font-semibold"><span>Reserved on your account</span><span className="money">${o.amount.value}</span></p>
          <p className="mt-2 text-xs text-ink-soft">PayPal places an authorization hold. You&rsquo;re charged only if you approve a submission; cancelling releases it.</p>
          {o.status === "CREATED" ? <ApproveButton orderId={orderId} /> : <p className="mt-4 chip chip-PAID">Approved</p>}
        </div>
      </main>
    </>
  );
}
