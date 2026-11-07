"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetDemo() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={async () => {
      if (!confirm("Reset the demo? This deletes every invoice and the audit trail, and the client has to accept the terms again.")) return;
      setBusy(true); await fetch("/api/app/reset", { method: "POST" }); setBusy(false); router.refresh();
    }}>{busy ? "Resetting…" : "Reset demo data"}</button>
  );
}
