"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MerchantPolicy } from "@/lib/db/schema";

const KINDS = ["PARTIAL_REFUND", "FULL_REFUND", "ADD_TRACKING_REMINDER", "MESSAGE_ONLY", "DISPUTE_OFFER"] as const;

export function PolicyForm({ policy }: { policy: MerchantPolicy }) {
  const router = useRouter();
  const [p, setP] = useState(policy);
  const [msg, setMsg] = useState<string | null>(null);
  const dollars = (minor: number) => (minor / 100).toFixed(2);
  const toMinor = (v: string) => Math.round(Number(v) * 100);
  return (
    <form className="mt-3 space-y-3 text-sm" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const res = await fetch("/api/merchant/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowedRemedies: p.allowedRemedies, maxRefundMinor: p.maxRefundMinor, reviewThresholdMinor: p.reviewThresholdMinor, minConfidence: p.minConfidence, shipAtRiskHours: p.shipAtRiskHours, refundAtRiskDays: p.refundAtRiskDays }) });
      setMsg(res.ok ? "Saved." : ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed");
      router.refresh();
    }}>
      <fieldset>
        <legend className="font-semibold">Allowed remedies</legend>
        {KINDS.map((k) => (
          <label key={k} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" checked={p.allowedRemedies.includes(k)} onChange={(e) => setP({ ...p, allowedRemedies: e.target.checked ? [...p.allowedRemedies, k] : p.allowedRemedies.filter((x) => x !== k) })} /> <span className="mono text-xs">{k}</span></label>
        ))}
      </fieldset>
      <label className="block">Maximum single refund (USD)<input className="field mt-1" type="number" step="0.01" min="0" value={dollars(p.maxRefundMinor)} onChange={(e) => setP({ ...p, maxRefundMinor: toMinor(e.target.value) })} /></label>
      <label className="block">Extra confirmation above (USD)<input className="field mt-1" type="number" step="0.01" min="0" value={dollars(p.reviewThresholdMinor)} onChange={(e) => setP({ ...p, reviewThresholdMinor: toMinor(e.target.value) })} /></label>
      <label className="block">Minimum extractor confidence<input className="field mt-1" type="number" step="0.05" min="0.5" max="1" value={p.minConfidence} onChange={(e) => setP({ ...p, minConfidence: Number(e.target.value) })} /></label>
      <label className="block">Shipping AT RISK window (hours before deadline)<input className="field mt-1" type="number" min="1" value={p.shipAtRiskHours} onChange={(e) => setP({ ...p, shipAtRiskHours: Number(e.target.value) })} /></label>
      <label className="block">Refund AT RISK window (days before deadline)<input className="field mt-1" type="number" min="0" value={p.refundAtRiskDays} onChange={(e) => setP({ ...p, refundAtRiskDays: Number(e.target.value) })} /></label>
      <button className="btn btn-primary">Save policy</button>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </form>
  );
}
