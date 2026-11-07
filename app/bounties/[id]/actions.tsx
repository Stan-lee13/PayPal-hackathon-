"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function useAct(bountyId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/bounties/${bountyId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "That didn't work."); return null; }
    if (j.approveUrl) { window.location.href = j.approveUrl; return j; }
    router.refresh();
    return j;
  };
  return { act, busy, err };
}

export function Actions(p: { bountyId: string; status: string; persona: "company" | "developer"; isCompany: boolean; isClaimer: boolean; ndaRequired: boolean; ndaText: string | null; devName: string; hasCapture: boolean }) {
  const { act, busy, err } = useAct(p.bountyId);
  const [pr, setPr] = useState("32");
  const [name, setName] = useState("");
  const btn = "btn btn-primary w-full";
  let body: React.ReactNode = null;
  if (p.isCompany) {
    if (p.status === "DRAFT" || p.status === "AWAITING_FUNDS") body = <button className={btn} disabled={busy} onClick={() => act({ action: "fund" })}>Reserve funds with PayPal →</button>;
    else if (["OPEN", "CLAIMED"].includes(p.status)) body = <button className="btn btn-danger w-full" disabled={busy} onClick={() => act({ action: "cancel", reason: "Cancelled by the company" })}>Cancel and release the hold</button>;
    else if (p.status === "PAYOUT_FAILED") body = <button className={btn} disabled={busy} onClick={() => act({ action: "refund" })}>Refund me in full</button>;
    else if (p.status === "PAYING") body = <button className="btn w-full" disabled={busy} onClick={() => act({ action: "sync_payout" })}>Check the payout with PayPal</button>;
  } else if (p.persona === "developer") {
    if (p.status === "OPEN" && p.ndaRequired) body = (
      <div className="space-y-2 text-sm"><p className="font-semibold">NDA</p><p className="max-h-32 overflow-auto rounded bg-sunken p-2 text-xs">{p.ndaText}</p>
        <input className="field" placeholder={`Type "${p.devName}" to sign`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className={btn} disabled={busy || !name} onClick={() => act({ action: "sign_nda", name })}>Sign the NDA</button></div>);
    else if (p.status === "OPEN") body = <button className={btn} disabled={busy} onClick={() => act({ action: "claim" })}>Claim this bounty</button>;
    else if (p.status === "CLAIMED" && p.isClaimer) body = (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act({ action: "submit", pr: Number(pr) }); }}>
        <label className="block text-sm font-medium">Your pull request #<input className="field mt-1" value={pr} onChange={(e) => setPr(e.target.value)} inputMode="numeric" /></label>
        <p className="text-xs text-ink-soft">Demo repo: #32 is the honest work, #33 games CI.</p>
        <button className={btn} disabled={busy}>{busy ? "Verifying against CI…" : "Submit for verification"}</button></form>);
    else if (p.status === "CLAIMED") body = <p className="text-sm text-ink-soft">Someone else is working on this.</p>;
  }
  if (!body && !err) return null;
  return <section className="card space-y-2 p-5">{body}{err && <p role="alert" className="text-sm text-danger">{err}</p>}</section>;
}

export function Decision({ bountyId, submissionId, recommendation, failed, dispute }: { bountyId: string; submissionId: string; recommendation: string; failed: boolean; dispute?: boolean }) {
  const { act, busy, err } = useAct(bountyId);
  const [note, setNote] = useState("");
  if (dispute) return (
    <div className="space-y-2 border-t border-rule pt-3"><textarea className="field" rows={2} placeholder="Why the rejection is wrong" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" disabled={busy} onClick={() => act({ action: "dispute", submissionId, reason: note })}>Dispute the rejection</button>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>);
  return (
    <div className="space-y-2 border-t border-rule pt-3">
      <textarea className="field" rows={2} placeholder="Note to the developer (required to request changes or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || failed} title={failed ? "Failed checks: request changes or reject" : undefined} onClick={() => act({ action: "decide", submissionId, decision: "APPROVE", note })}>{busy ? "Paying via PayPal…" : "Approve & pay via PayPal"}</button>
        <button className="btn" disabled={busy} onClick={() => act({ action: "decide", submissionId, decision: "REQUEST_CHANGES", note })}>Request changes</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => act({ action: "decide", submissionId, decision: "REJECT", note: note || (recommendation === "REJECT" ? "Failed integrity checks." : "") })}>Reject</button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
