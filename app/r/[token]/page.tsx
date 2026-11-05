import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReceipt } from "@/lib/services/views";
import { StateSeal } from "@/components/seal";
import { Money } from "@/components/money";
import { ModeBanner } from "@/components/mode-banner";
import { formatMoney } from "@/lib/money";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your receipt", robots: { index: false, follow: false } };

const TYPE_LABEL: Record<string, string> = { PRICE_AS_QUOTED: "Price", SHIP_BY: "Shipping", REFUND_BY: "Refund", OTHER: "Other", MANDATE_MAX_TOTAL: "Your spending limit", MANDATE_SHIP_WITHIN: "Your shipping limit" };

function moneyWhere(r: NonNullable<Awaited<ReturnType<typeof getReceipt>>>) {
  const o = r.order;
  if (!o.captureStatus) return "PayPal has not confirmed your payment yet.";
  if (o.captureStatus === "PENDING") return "PayPal has your payment on hold (PENDING) — it is not final yet.";
  if (o.captureStatus === "DECLINED" || o.captureStatus === "FAILED") return "PayPal did not take the payment.";
  const completed = r.refunds.filter((x) => x.status === "COMPLETED");
  const pending = r.refunds.filter((x) => x.status === "PENDING");
  const parts = [`PayPal captured ${formatMoney(o.captureAmountMinor!, o.captureCurrency!)} from you.`];
  if (completed.length) parts.push(`PayPal confirms ${formatMoney(completed.reduce((s, x) => s + x.amountMinor, 0), o.captureCurrency!)} has been refunded to your original PayPal payment method. Depending on that method, it can take a few days to appear on a bank or card statement.`);
  if (pending.length) parts.push(`A refund of ${formatMoney(pending.reduce((s, x) => s + x.amountMinor, 0), o.captureCurrency!)} is PENDING at PayPal — it has not completed yet.`);
  return parts.join(" ");
}

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getReceipt(token);
  if (!r) notFound();
  const o = r.order;
  const cur = o.captureCurrency ?? o.currency;
  const refundRemedies = r.remedies.filter((x) => x.kind === "PARTIAL_REFUND" || x.kind === "FULL_REFUND");
  const disputeResponses = r.remedies.filter((x) => x.kind === "DISPUTE_OFFER" && x.state !== "PROPOSED");
  const messages = r.remedies.filter((x) => x.customerMessage && x.state !== "REJECTED");

  return (
    <>
      <ModeBanner />
      <AutoRefresh seconds={8} />
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <p className="eyebrow">Living receipt · {r.merchantName}</p>
        <h1 className="quote mt-2 text-3xl">{o.buyerFirstName ? `${o.buyerFirstName}, here's` : "Here's"} what you were promised — and what happened.</h1>
        <p className="mt-2 text-sm text-ink-soft">Order <span className="mono">{o.id}</span> · {o.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC{r.simulatedClock ? " · simulated demo clock in use" : ""}</p>

        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Promise summary">
          {(["BROKEN", "AT_RISK", "KEPT", "PENDING", "UNVERIFIABLE"] as const).map((st) => {
            const n = r.promises.filter((p) => p.state === st).length;
            const good = r.promises.filter((p) => p.state === st && (p.evaluation as Record<string, unknown> | null)?.madeGood === true).length;
            return n ? <li key={st} className="flex items-center gap-1.5 text-xs"><StateSeal state={st} size="sm" madeGood={st === "BROKEN" && good === n} /><span className="mono">{n}</span></li> : null;
          })}
        </ul>

        <section className="paper mt-6 p-4" aria-labelledby="money-h">
          <h2 id="money-h" className="eyebrow">Where your money is</h2>
          <p className="mt-2">{moneyWhere(r)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-soft">Charged</dt><dd className="text-right"><Money minor={o.captureAmountMinor} currency={cur} /></dd>
            <dt className="text-ink-soft">Refunded (confirmed)</dt><dd className="text-right"><Money minor={o.refundedMinor} currency={cur} /></dd>
            <dt className="text-ink-soft">PayPal payment ID</dt><dd className="mono truncate text-right text-xs">{o.captureId ?? "—"}</dd>
          </dl>
        </section>

        <section className="mt-8" aria-labelledby="promises-h">
          <h2 id="promises-h" className="eyebrow">Promises</h2>
          {r.promises.length === 0 && <p className="mt-2 text-sm text-ink-soft">Kept is still reading your conversation…</p>}
          <ul className="mt-2 space-y-3">
            {r.promises.map((p) => (
              <li key={p.id} className="paper p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">{TYPE_LABEL[p.type]} · {p.sourceKind === "CHAT_TRANSCRIPT" ? "said in chat" : p.sourceKind === "REFUND_POLICY" ? "refund policy" : p.sourceKind === "USER_MANDATE" ? "your instruction to your agent" : "merchant source"}</span>
                  <StateSeal state={p.state} size="sm" madeGood={(p.evaluation as Record<string, unknown> | null)?.madeGood === true} />
                </div>
                <blockquote className="quote mt-2 text-lg">&ldquo;{p.quote}&rdquo;</blockquote>
                <p className="mt-1 text-sm text-ink-soft">{p.reason}</p>
              </li>
            ))}
          </ul>
        </section>

        {(refundRemedies.length > 0 || messages.length > 0) && (
          <section className="mt-8" aria-labelledby="fix-h">
            <h2 id="fix-h" className="eyebrow">What the merchant is doing about it</h2>
            <ul className="mt-2 space-y-3">
              {refundRemedies.map((m) => (
                <li key={m.id} className="paper p-4 text-sm">
                  <p className="font-semibold">
                    Refund of <Money minor={m.amountMinor} currency={m.currency} />:{" "}
                    {m.state === "PROPOSED" && "proposed, waiting for the merchant to approve."}
                    {m.state === "EXECUTING" && "approved by the merchant; waiting for PayPal to confirm."}
                    {m.state === "PENDING" && "approved; PayPal reports it as PENDING (not completed yet)."}
                    {m.state === "COMPLETED" && "approved by the merchant and confirmed COMPLETED by PayPal."}
                    {m.state === "FAILED" && "PayPal did not complete this refund. The merchant has been alerted."}
                    {m.state === "REJECTED" && "the merchant chose a different resolution."}
                  {m.state === "SUPERSEDED" && "replaced by the merchant's response to your PayPal dispute."}
                  </p>
                  {m.refundId && <p className="mt-1 text-ink-soft">PayPal refund ID <span className="mono">{m.refundId}</span></p>}
                </li>
              ))}
              {messages.map((m) => (
                <li key={`msg-${m.id}`} className="rule-t pt-3 text-sm"><p className="eyebrow">Message from {r.merchantName}</p><p className="quote mt-1 text-base">{m.customerMessage}</p></li>
              ))}
            </ul>
          </section>
        )}

        {r.disputes.length > 0 && (
          <section className="mt-8" aria-labelledby="disp-h">
            <h2 id="disp-h" className="eyebrow">Your PayPal dispute</h2>
            {r.disputes.map((d) => <p key={d.id} className="mt-2 text-sm">Dispute <span className="mono">{d.id}</span> ({d.reason?.toLowerCase().replace(/_/g, " ")}) — PayPal status <strong>{d.status}</strong>, stage {d.stage}.</p>)}
            {disputeResponses.map((x) => <p key={x.id} className="mt-1 text-sm text-ink-soft">The merchant responded through PayPal{x.amountMinor ? <> with a refund offer of <Money minor={x.amountMinor} currency={x.currency} /> (money moves only if you accept it in PayPal)</> : ""}.</p>)}
          </section>
        )}

        {r.trackers.length > 0 && (
          <section className="mt-8" aria-labelledby="ship-h">
            <h2 id="ship-h" className="eyebrow">Shipping</h2>
            {r.trackers.map((t) => <p key={t.trackingNumber} className="mt-2 text-sm">{t.carrier} tracking <span className="mono">{t.trackingNumber}</span> added to your PayPal order. Tracking shows the parcel was reported shipped — not that it has been delivered.</p>)}
          </section>
        )}

        <section className="mt-8" aria-labelledby="tl-h">
          <h2 id="tl-h" className="eyebrow">Timeline</h2>
          <ol className="mt-2 border-l border-rule pl-4 text-sm">
            {r.timeline.map((t, i) => (
              <li key={i} className="relative pb-3">
                <span aria-hidden="true" className="absolute -left-[1.32rem] top-1.5 h-2 w-2 rounded-full bg-[var(--ink-soft)]" />
                <time className="mono text-xs text-ink-soft">{t.at.toISOString().replace("T", " ").slice(0, 16)} UTC</time>
                <p>{describe(t.action, t.detail as Record<string, unknown>, r.merchantName)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="paper mt-8 p-4">
          <h2 className="font-semibold">Something&rsquo;s wrong?</h2>
          <p className="mt-1 text-sm text-ink-soft">Tell {r.merchantName} directly — mention order <span className="mono">{o.id}</span>. You also keep all your rights with PayPal.</p>
          <a className="btn mt-3" href={`mailto:${r.supportEmail}?subject=${encodeURIComponent(`Order ${o.id}`)}`}>Email {r.merchantName}</a>
        </section>
        {r.fingerprint && (
          <section className="mt-6 text-xs text-ink-soft" aria-labelledby="fp-h">
            <h2 id="fp-h" className="eyebrow">Evidence fingerprint</h2>
            <p className="mt-1">Every step above is recorded in a tamper-evident chain ({r.fingerprint.entries} entries so far). Its current fingerprint is:</p>
            <p className="mono mt-1 break-all text-ink">{r.fingerprint.head}</p>
            <p className="mt-1">Save it. If the record is ever changed or cut short, this fingerprint will no longer match the merchant&rsquo;s evidence pack.</p>
          </section>
        )}
        <p className="mt-6 text-xs text-ink-soft">This page is private to you: anyone with the link can see it, so don&rsquo;t share it publicly.</p>
      </main>
    </>
  );
}

function describe(action: string, d: Record<string, unknown>, merchantName: string): string {
  switch (action) {
    case "order.created": return "You placed the order.";
    case "paypal.order.created": return "PayPal order created.";
    case "preflight.verdict": return d.verdict === "READY_TO_CAPTURE" ? `Before capture, Kept checked the PayPal order against the promise: ${d.paypalOrder ?? ""} — verified.` : d.verdict === "BLOCKED_MISMATCH" ? `Before capture, Kept found the PayPal order (${d.paypalOrder}) did not match the promise (${d.promised}) and ${d.enforced ? "stopped the payment. Nothing was charged" : "recorded it; this checkout is not one Kept controls"}.` : d.verdict === "NEEDS_CONFIRMATION" ? "Before capture, Kept asked the shop to confirm the amount." : "Kept could not verify the PayPal order, so it did not capture.";
    case "checkout.corrected": return `The shop corrected the order to the promised ${d.to}. The earlier PayPal order was never charged.`;
    case "order.external_checkout": return "This payment was taken outside Kept's checkout, so Kept checks it after payment.";
    case "checkout_guard.honored": return `Before you paid, Kept checked the chat: ${merchantName} honoured the promised ${d.promised} instead of ${d.checkout}.`;
    case "checkout_guard.warned": return `Before you paid, Kept warned that checkout (${d.checkout}) was more than the promised ${d.promised}.`;
    case "paypal.capture.verified": return d.status === "PARTIALLY_REFUNDED" || d.status === "REFUNDED" ? `PayPal updated the payment status to ${d.status}.` : `PayPal confirmed the payment: ${d.status} ${d.amount ?? ""}.`;
    case "promises.extracted": return "Kept recorded the promises made to you.";
    case "commitment.state_changed": return `A promise is now ${String(d.to).toLowerCase().replace("_", " ")}: ${d.reason}`;
    case "remedy.proposed": return "A fix was proposed to the merchant.";
    case "remedy.approved": return "The merchant approved a fix.";
    case "remedy.rejected": return "The merchant chose a different resolution.";
    case "paypal.refund.requested": return `Refund sent to PayPal (PayPal reported ${d.reportedStatus}).`;
    case "paypal.refund.verified": return `PayPal confirms refund ${d.status}: ${d.amount}.`;
    case "paypal.refund.failed": return "PayPal did not complete a refund.";
    case "paypal.tracking.added": return "Shipment tracking was added to your PayPal order.";
    case "paypal.dispute.verified": return "A PayPal dispute was recorded on this order.";
    case "dispute.response_approved": return "The merchant approved a response to your dispute.";
    case "paypal.dispute_action.accepted": return `PayPal accepted the merchant's dispute response (dispute now ${d.disputeStatus}).`;
    default: return action;
  }
}
