"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Failed (${res.status})`);
  return data;
}

export function ConsoleTools({ demo, simulated, offsetHours }: { demo: boolean; simulated: boolean; offsetHours: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(`${label}: done${r && typeof r === "object" && "report" in r ? "" : ""}`); router.refresh(); }
    catch (e) { setMsg(`${label}: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button className="btn min-h-9 px-3 py-1" disabled={busy} onClick={() => run("Checked PayPal", () => post("/api/merchant/reconcile"))} title="Authoritative GETs for anything missing or pending">Check PayPal now</button>
      {demo && (
        <details className="relative">
          <summary className="btn min-h-9 cursor-pointer list-none px-3 py-1">Demo tools</summary>
          <div className="paper absolute right-0 z-20 mt-1 w-72 space-y-2 p-3">
            <p className="eyebrow">Simulated clock {offsetHours ? `(+${offsetHours}h)` : ""}</p>
            <div className="flex flex-wrap gap-1">
              {[12, 24, 40].map((h) => <button key={h} className="btn min-h-9 px-2 py-1" disabled={busy} onClick={() => run(`Clock +${h}h`, () => post("/api/merchant/clock", { hours: h }))}>+{h}h</button>)}
              <button className="btn min-h-9 px-2 py-1" disabled={busy} onClick={() => run("Clock reset", () => post("/api/merchant/clock", { hours: 0 }))}>Reset</button>
            </div>
            {simulated && <>
              <p className="eyebrow pt-2">Simulated PayPal</p>
              <button className="btn min-h-9 w-full px-2 py-1" disabled={busy} onClick={() => run("Settled pending refunds", () => post("/api/sim/deliver", { settlePending: true }))}>Settle pending refunds</button>
            </>}
            <p className="eyebrow pt-2">Data</p>
            <button className="btn btn-danger min-h-9 w-full px-2 py-1" disabled={busy} onClick={() => { if (confirm("Delete all demo orders, promises and events?")) void run("Reset", () => post("/api/merchant/reset")); }}>Reset demo data</button>
            <button className="btn min-h-9 w-full px-2 py-1" onClick={async () => { await post("/api/merchant/logout"); router.push("/merchant/login"); }}>Sign out</button>
          </div>
        </details>
      )}
      {msg && <span role="status" className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
