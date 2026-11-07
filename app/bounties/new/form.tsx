"use client";

import { useState } from "react";

export function NewBountyForm({ demo }: { demo: { repo: string; issue: string; criteria: string } }) {
  const [f, setF] = useState({ repo: demo.repo, issueNumber: demo.issue, title: "Rate-limit the public order API", summary: "One partner's script took our order API down last week. Add a per-API-key rate limit to POST /api/orders.", details: "", criteria: demo.criteria, skills: "TypeScript, Node.js", amount: "300.00", deadlineDays: "7", ndaRequired: false, ndaText: "", requiresTests: true, requiredChecks: "test" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const fee = Math.max(1, Math.ceil(Number(f.amount || 0) * 5) / 100);
  return (
    <form className="mt-6 space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const r = await fetch("/api/bounties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, issueNumber: f.issueNumber ? Number(f.issueNumber) : null, deadlineDays: f.deadlineDays ? Number(f.deadlineDays) : null, ndaText: f.ndaRequired ? f.ndaText : null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Couldn't post."); setBusy(false); return; }
      window.location.href = j.approveUrl; // PayPal (or the labelled simulator) to approve the hold
    }}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <label className="block text-sm font-medium">Repository<input className="field mt-1 mono" value={f.repo} onChange={set("repo")} required placeholder="owner/name" /></label>
        <label className="block text-sm font-medium">Issue #<input className="field mt-1" value={f.issueNumber} onChange={set("issueNumber")} inputMode="numeric" /></label>
      </div>
      <label className="block text-sm font-medium">Title<input className="field mt-1" value={f.title} onChange={set("title")} required /></label>
      <label className="block text-sm font-medium">Summary (public)<textarea className="field mt-1" rows={2} value={f.summary} onChange={set("summary")} required /></label>
      <label className="block text-sm font-medium">Acceptance criteria <span className="font-normal text-ink-soft">(one per line; each must be proven by a passing test)</span><textarea className="field mt-1" rows={4} value={f.criteria} onChange={set("criteria")} required /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium">Bounty (USD)<input className="field mt-1 money" value={f.amount} onChange={set("amount")} required inputMode="decimal" /></label>
        <label className="block text-sm font-medium">Deadline (days)<input className="field mt-1" value={f.deadlineDays} onChange={set("deadlineDays")} inputMode="numeric" /></label>
        <label className="block text-sm font-medium">Required CI checks<input className="field mt-1 mono" value={f.requiredChecks} onChange={set("requiredChecks")} /></label>
      </div>
      <label className="block text-sm font-medium">Skills<input className="field mt-1" value={f.skills} onChange={set("skills")} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresTests} onChange={set("requiresTests")} /> Require new tests</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ndaRequired} onChange={set("ndaRequired")} /> Private: developers sign an NDA before seeing details and claiming</label>
      {f.ndaRequired && <label className="block text-sm font-medium">NDA text<textarea className="field mt-1" rows={3} value={f.ndaText} onChange={set("ndaText")} /></label>}
      <p className="card p-3 text-sm">You&rsquo;ll authorize <strong className="money">${(Number(f.amount || 0) + fee).toFixed(2)}</strong>: the developer gets the full <span className="money">${Number(f.amount || 0).toFixed(2)}</span>; MergePay&rsquo;s fee is <span className="money">${fee.toFixed(2)}</span>.</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Opening PayPal…" : "Reserve funds with PayPal →"}</button>
    </form>
  );
}
