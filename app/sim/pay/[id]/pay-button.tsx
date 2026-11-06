"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PayButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        const r = await fetch("/api/sim/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: id }) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) { setMsg(j.error ?? "Payment failed."); return; }
        setMsg("Paid. PayPal's INVOICING.INVOICE.PAID event went to MergePay — go back to the demo to see the merge.");
        router.refresh();
      }}>{busy ? "Paying…" : label}</button>
      {msg && <p role="status" className="mt-2 text-sm text-ink-soft">{msg}</p>}
    </div>
  );
}
