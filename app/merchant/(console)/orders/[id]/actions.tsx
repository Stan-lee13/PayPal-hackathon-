"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "../../console-tools";

const usd = (m: number | null, c: string | null) => (m === null || !c ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(m / 100));

type RemedyView = {
  id: string; kind: string; state: string; amountMinor: number | null; currency: string | null; customerMessage: string; rationale: string;
  citations: string[]; proposedBy: "ai" | "rules"; policyChecks: Array<{ check: string; ok: boolean; detail: string }>;
  paypalRefundId: string | null; paypalRefundStatus: string | null; errorCode: string | null; errorDetail: string | null; decidedAt: string | null;
};

export function RemedySheet({ remedy: r, preview, discrepancyLabel, reviewThresholdMinor, simulated }: {
  remedy: RemedyView; preview: unknown; discrepancyLabel: string | null; reviewThresholdMinor: number; simulated: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState(r.customerMessage);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [simulate, setSimulate] = useState<"" | "REFUND_FAILED_INSUFFICIENT_FUNDS" | "REFUND_PENDING">("");
  const policyOk = r.policyChecks.every((c) => c.ok);
  const isRefund = r.kind === "PARTIAL_REFUND" || r.kind === "FULL_REFUND";
  const isDispute = r.kind === "DISPUTE_OFFER";
  const large = isRefund && (r.amountMinor ?? 0) > reviewThresholdMinor;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="rule-t bg-paper p-4" aria-label="Remedy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Remedy · {r.proposedBy === "ai" ? "proposed by AI (Claude), checked by policy" : "proposed by rules, checked by policy"}</p>
        <span className={`text-xs font-semibold ${r.state === "COMPLETED" ? "text-kept" : r.state === "FAILED" ? "text-broken" : "text-ink"}`}>{label(r)}</span>
      </div>
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 text-sm">
          <p className="text-lg font-semibold">{kindLabel(r.kind)} {(isRefund || (isDispute && r.amountMinor)) && <span className="money">{usd(r.amountMinor, r.currency)}</span>}</p>
          {discrepancyLabel && <p>Deterministic outstanding overcharge: <span className="money font-semibold">{discrepancyLabel}</span> <span className="text-ink-soft">(computed by code, not by AI)</span></p>}
          <p className="text-ink-soft">{r.rationale}</p>
          <details>
            <summary className="cursor-pointer text-ink-soft">Policy checks: {policyOk ? "all passed" : "FAILED"} ({r.policyChecks.filter((c) => c.ok).length}/{r.policyChecks.length})</summary>
            <ul className="mt-1 space-y-0.5 text-xs">{r.policyChecks.map((c, i) => <li key={i}><span aria-hidden="true">{c.ok ? "✓" : "✕"}</span><span className="sr-only">{c.ok ? "passed" : "failed"}</span> <span className="mono">{c.check}</span> — {c.detail}</li>)}</ul>
          </details>
          {r.state === "PROPOSED" ? (
            <>
              <label className="block font-semibold" htmlFor={`msg-${r.id}`}>{isDispute ? "Note to PayPal and the buyer (editable)" : "Message to the customer (editable)"}</label>
              <textarea id={`msg-${r.id}`} className="field min-h-24" value={message} maxLength={600} onChange={(e) => setMessage(e.target.value)} />
            </>
          ) : <p className="quote">&ldquo;{r.customerMessage}&rdquo;</p>}
          {r.paypalRefundId && <p className="text-xs">PayPal refund <span className="mono">{r.paypalRefundId}</span> · PayPal status <strong>{r.paypalRefundStatus}</strong></p>}
          {r.errorCode && <p className="text-xs text-broken">PayPal error: <span className="mono">{r.errorCode}</span> {r.errorDetail}</p>}
        </div>
        <div className="text-sm">
          {(isRefund || isDispute) && preview ? (
            <>
              <p className="eyebrow">Exact PayPal {isDispute ? "Disputes API " : ""}request on approval</p>
              {isDispute && <p className="mb-1 text-xs text-ink-soft">Sent to PayPal&rsquo;s Disputes API. An offer moves money only if the buyer accepts it; PayPal then reports the refund.</p>}
              <pre className="mono mt-1 overflow-x-auto rounded border border-rule bg-raised p-3 text-xs">{JSON.stringify(preview, null, 2)}</pre>
            </>
          ) : !isRefund ? <p className="text-ink-soft">This remedy moves no money. Approving records the decision and shows the message on the customer&rsquo;s receipt (Kept does not send email).</p> : null}
          {r.state === "PROPOSED" && (
            <div className="mt-3 space-y-2">
              {large && <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" /> <span>I confirm this refund is above my review threshold.</span></label>}
              {isRefund && (
                <label className="block text-xs text-ink-soft">{simulated ? "Simulate PayPal outcome" : "Sandbox negative test (PayPal-Mock-Response)"}{" "}
                  <select className="field mt-1 min-h-9 py-1 text-xs" value={simulate} onChange={(e) => setSimulate(e.target.value as typeof simulate)}>
                    <option value="">Normal</option>
                    <option value="REFUND_FAILED_INSUFFICIENT_FUNDS">Refund fails (insufficient funds)</option>
                    {simulated && <option value="REFUND_PENDING">Refund stays PENDING</option>}
                  </select>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={busy || !policyOk || (large && !ack) || !message.trim()}
                  onClick={() => act(() => post(`/api/merchant/remedies/${r.id}/approve`, { customerMessage: message, acknowledgeLarge: ack, simulate: simulate || undefined }))}>
                  {busy ? "Working…" : isRefund ? `Approve & refund ${usd(r.amountMinor, r.currency)}` : isDispute ? "Approve & send to PayPal" : "Approve"}
                </button>
                <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/merchant/remedies/${r.id}/reject`, { note: "" }))}>Reject</button>
              </div>
              {!policyOk && <p className="text-xs text-broken">The policy engine blocked this proposal; it cannot be approved.</p>}
            </div>
          )}
          {err && <p role="alert" className="mt-2 text-xs text-broken">{err}</p>}
        </div>
      </div>
    </section>
  );
}

function kindLabel(k: string) {
  return ({ PARTIAL_REFUND: "Partial refund", FULL_REFUND: "Full refund", ADD_TRACKING_REMINDER: "Add tracking", MESSAGE_ONLY: "Message only", DISPUTE_OFFER: "PayPal dispute response" } as Record<string, string>)[k] ?? k;
}

function label(r: RemedyView) {
  switch (r.state) {
    case "PROPOSED": return "Awaiting your decision";
    case "EXECUTING": return "Sent to PayPal — awaiting confirmation";
    case "PENDING": return "PayPal reports PENDING — not completed";
    case "COMPLETED": return r.kind.includes("REFUND") ? "Refund COMPLETED — confirmed by PayPal" : r.kind === "DISPUTE_OFFER" ? `Accepted by PayPal — dispute now ${r.paypalRefundStatus ?? ""}` : "Done";
    case "FAILED": return "FAILED at PayPal";
    case "REJECTED": return "Rejected by you";
    default: return r.state;
  }
}

export function CommitmentActions({ commitmentId, type, state, triggered, canReopen }: { commitmentId: string; type: string; state: string; triggered: boolean; canReopen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (url: string, body: unknown = {}) => {
    setBusy(true); setErr(null);
    try { await post(url, body); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {state === "NEEDS_CONFIRMATION" && <>
        <button className="btn min-h-9 px-3 py-1 text-xs" disabled={busy} onClick={() => act(`/api/merchant/commitments/${commitmentId}/decide`, { decision: "CONFIRM" })}>Confirm &amp; enforce</button>
        <button className="btn min-h-9 px-3 py-1 text-xs" disabled={busy} onClick={() => act(`/api/merchant/commitments/${commitmentId}/decide`, { decision: "WAIVE" })}>Waive</button>
      </>}
      {type === "REFUND_BY" && !triggered && state === "PENDING" && <button className="btn min-h-9 px-3 py-1 text-xs" disabled={busy} onClick={() => act(`/api/merchant/commitments/${commitmentId}/trigger`)}>Mark return received</button>}
      {(state === "BROKEN" || state === "AT_RISK") && canReopen && <button className="btn min-h-9 px-3 py-1 text-xs" disabled={busy} onClick={() => act(`/api/merchant/commitments/${commitmentId}/propose`)}>Propose a remedy</button>}
      {err && <p role="alert" className="w-full text-xs text-broken">{err}</p>}
    </div>
  );
}

export function OrderActions({ orderId, hasCapture, receiptPath, simulated = false, hasDispute = false }: { orderId: string; hasCapture: boolean; receiptPath: string; simulated?: boolean; hasDispute?: boolean }) {
  const router = useRouter();
  const [num, setNum] = useState("");
  const [carrier, setCarrier] = useState("DHL");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (label: string, url: string, body: unknown = {}) => {
    setBusy(true); setMsg(null);
    try { await post(url, body); setMsg(`${label} ✓`); router.refresh(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <Link className="btn min-h-9 px-3 py-1" href={receiptPath} target="_blank">Customer receipt ↗</Link>
      <button className="btn min-h-9 px-3 py-1" disabled={busy || !hasCapture} onClick={() => act("Checked with PayPal", `/api/merchant/orders/${orderId}/refresh`)}>Re-check capture</button>
      {hasCapture && (
        <form className="flex flex-wrap items-end gap-1" onSubmit={(e) => { e.preventDefault(); void act("Tracking added to PayPal", `/api/merchant/orders/${orderId}/track`, { trackingNumber: num, carrier }); }}>
          <label className="sr-only" htmlFor="carrier">Carrier</label>
          <select id="carrier" className="field min-h-9 w-24 py-1" value={carrier} onChange={(e) => setCarrier(e.target.value)}>{["DHL", "UPS", "FEDEX", "USPS", "OTHER"].map((c) => <option key={c}>{c}</option>)}</select>
          <label className="sr-only" htmlFor="trk">Tracking number</label>
          <input id="trk" className="field min-h-9 w-36 py-1" placeholder="Tracking no." value={num} onChange={(e) => setNum(e.target.value)} />
          <button className="btn min-h-9 px-3 py-1" disabled={busy || num.trim().length < 4}>Add tracking</button>
        </form>
      )}
      {simulated && hasCapture && !hasDispute && (
        <details className="relative">
          <summary className="btn min-h-9 cursor-pointer list-none px-3 py-1">Play the buyer: open a dispute</summary>
          <div className="popover paper paper-lift absolute right-0 z-20 mt-1 w-72 space-y-2 p-3 text-xs">
            <p className="text-ink-soft">Simulated PayPal only. In the sandbox, the buyer opens disputes in PayPal&rsquo;s Resolution Center.</p>
            <button className="btn min-h-9 w-full px-2 py-1" disabled={busy} onClick={() => void act("Dispute opened: item not received", "/api/sim/dispute", { orderId, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" })}>&ldquo;I never received it&rdquo;</button>
            <button className="btn min-h-9 w-full px-2 py-1" disabled={busy} onClick={() => void act("Dispute opened: incorrect amount", "/api/sim/dispute", { orderId, reason: "INCORRECT_AMOUNT" })}>&ldquo;I was charged the wrong amount&rdquo;</button>
          </div>
        </details>
      )}
      {msg && <span role="status" className="w-full text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}

export function GateActions({ orderId, status, promisedLabel, orderLabel }: { orderId: string; status: string; promisedLabel: string; orderLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (url: string, ok: string) => {
    setBusy(true); setMsg(null);
    try { await post(url); setMsg(ok); router.refresh(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "CAPTURE_BLOCKED" && <button className="btn btn-primary min-h-9 px-3 py-1" disabled={busy} onClick={() => act(`/api/merchant/orders/${orderId}/correct`, "Corrected order created — the buyer must approve it in PayPal.")}>Correct the order to the promised {promisedLabel}</button>}
      {status === "NEEDS_CONFIRMATION" && <button className="btn min-h-9 px-3 py-1" disabled={busy} onClick={() => act(`/api/merchant/orders/${orderId}/confirm-amount`, "Confirmed. The buyer can continue the payment.")}>Confirm {orderLabel} is the right amount</button>}
      {msg && <span role="status" className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
