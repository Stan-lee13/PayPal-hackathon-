"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Stamp } from "@/components/stationery";

/** Only ever send the payer back to this site: the link's parameters come from the address bar. */
const here = (to: string | null): string | null => {
  if (!to) return null;
  try { const u = new URL(to, location.origin); return u.origin === location.origin ? u.pathname + u.search : null; } catch { return null; }
};

export function SimCheckout() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setQ(new URLSearchParams(location.search)); }, []);
  if (!q) return <p className="mt-10 text-sm text-ink-2" role="status">Opening the simulated checkout…</p>;
  const token = q.get("token"), back = here(q.get("back")), cancel = here(q.get("cancel"));
  const amount = Number(q.get("amount") ?? 0), what = q.get("for") || "an envelope";
  if (!token || !back) return <p className="mt-10 text-sm text-red" role="alert">This approval link is incomplete. Go back to the console and start again.</p>;

  async function approve() {
    setBusy(true); setErr(null);
    const r = await api("/api/sim/paypal/approve", { body: { orderId: token } });
    if (!r.ok) { setErr(r.json?.error ?? "The simulator could not approve this order."); setBusy(false); return; }
    location.href = `${back}${back!.includes("?") ? "&" : "?"}token=${encodeURIComponent(token!)}&PayerID=SIMPAYER7Q2`;
  }

  return (
    <section className="sheet sheet-lift relative p-6 sm:p-8" data-testid="sim-checkout">
      <Stamp tone="red" className="absolute -top-3.5 right-4">Simulator</Stamp>
      <p className="label">PayPal checkout · simulated</p>
      <h1 className="display mt-3 text-[clamp(1.9rem,5vw,2.6rem)]">Approve a hold of <span className="text-blue">${amount.toFixed(2)}</span>?</h1>
      <p className="mt-4 text-ink-2"><span className="title text-ink">Envelope</span> asks to hold this amount on your PayPal account for: <span className="text-ink">{what}</span>.</p>
      <ul className="mt-4 space-y-2 border-t border-rule pt-4 text-[.92rem] text-ink-2">
        <li>Nothing is charged now. The amount is held.</li>
        <li>Each payment your agents make takes exactly its own amount from the hold, and PayPal refuses anything past it.</li>
        <li>Closing the envelope releases whatever was never spent.</li>
      </ul>
      <div className="perforated mt-6 flex flex-wrap items-center gap-3 pt-6">
        <button type="button" className="btn btn-ink" disabled={busy} onClick={approve}>{busy ? "Approving…" : "Approve the hold"}</button>
        {cancel && <a className="btn" href={cancel}>Cancel and go back</a>}
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-red">{err}</p>}
      <p className="mt-6 text-xs leading-relaxed text-ink-3">This page stands in for PayPal&rsquo;s own checkout. Against the real PayPal sandbox the payer is sent to sandbox.paypal.com, signs in there and approves; the gateway never sees their password, and reads the approval back from PayPal before it places the hold.</p>
    </section>
  );
}
