"use client";

import { useState } from "react";

export function ApproveButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/sim/approve-order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.error ?? "Failed."); setBusy(false); return; }
        window.location.href = j.returnUrl;
      }}>{busy ? "Approving…" : "Approve the hold (simulated)"}</button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
