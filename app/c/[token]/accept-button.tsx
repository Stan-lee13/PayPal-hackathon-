"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await fetch("/api/contracts/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        setBusy(false);
        if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't record that."); return; }
        router.refresh();
      }}>{busy ? "Saving…" : "I agree to these terms"}</button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
