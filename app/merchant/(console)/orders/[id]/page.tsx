import Link from "next/link";
import { notFound } from "next/navigation";
import { currentMerchant } from "@/lib/security/session";
import { getOrderBundle } from "@/lib/services/views";
import { remedyRequestPreview } from "@/lib/services/remedies";
import { StateSeal } from "@/components/seal";
import { Money } from "@/components/money";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatMoney } from "@/lib/money";
import { paypalMode } from "@/lib/paypal/client";
import { CommitmentActions, OrderActions, RemedySheet } from "./actions";
import { orderChain } from "@/lib/services/evidence";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order ledger" };

const TYPE: Record<string, string> = { PRICE_AS_QUOTED: "Price as quoted", SHIP_BY: "Ship by", REFUND_BY: "Refund by", OTHER: "Other", MANDATE_MAX_TOTAL: "Shopper mandate · spending limit", MANDATE_SHIP_WITHIN: "Shopper mandate · shipping limit" };
const BLAME: Record<string, string> = { MERCHANT: "Accountable: merchant (the agent was quoted within the limit)", AGENT: "Accountable: the shopper's agent (it accepted an over-limit quote)", UNKNOWN: "Accountability unclear", NONE: "" };

export default async function OrderLedger({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const merchantId = (await currentMerchant())!;
  const b = await getOrderBundle(id);
  if (!b || b.order.merchantId !== merchantId) notFound();
  const o = b.order;
  const cur = o.captureCurrency ?? o.currency;
  const previews = Object.fromEntries(await Promise.all(b.remedies.map(async (r) => [r.id, await remedyRequestPreview(r)] as const)));
  const simulated = paypalMode() === "simulated";
  const chain = (await orderChain(o.merchantId, o.id)).verdict;

  return (
    <>
      <AutoRefresh seconds={10} />
      <Link href="/merchant" className="text-sm underline">← Promises</Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="quote text-3xl">Order {o.buyerFirstName ? `for ${o.buyerFirstName}` : ""}</h1>
          <p className="mono text-xs text-ink-soft">{o.id} · created {o.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
        </div>
        <OrderActions orderId={o.id} hasCapture={Boolean(o.paypalCaptureId)} receiptPath={`/r/${o.receiptToken}`} simulated={simulated} hasDispute={b.disputes.length > 0} />
      </div>

      {/* Payment header: authoritative PayPal facts */}
      <section className="paper mt-4 grid gap-4 p-4 text-sm sm:grid-cols-4" aria-label="PayPal payment">
        <div><p className="eyebrow">PayPal order</p><p className="mono break-all">{o.paypalOrderId ?? "—"}</p></div>
        <div><p className="eyebrow">Capture</p><p className="mono break-all">{o.paypalCaptureId ?? "—"}</p><p>{o.captureStatus ?? "not captured"}{o.captureStatusReason ? ` (${o.captureStatusReason})` : ""}</p></div>
        <div><p className="eyebrow">Captured · fee · net</p><p><Money minor={o.captureAmountMinor} currency={cur} /> · <Money minor={o.paypalFeeMinor} currency={cur} /> · <Money minor={o.netAmountMinor} currency={cur} /></p>{simulated && <p className="text-xs text-risk">fee is emulator-illustrative</p>}</div>
        <div><p className="eyebrow">Refunded (confirmed)</p><p><Money minor={o.refundedMinor} currency={cur} /></p><p className="text-xs text-ink-soft">{o.captureVerifiedAt ? `verified by GET ${o.captureVerifiedAt.toISOString().slice(11, 19)} UTC` : "not yet verified"}</p></div>
      </section>
      {o.extractionNote && <p className="mt-2 text-xs text-ink-soft">{o.extractionNote}</p>}
      {b.disputes.map((d) => {
        const resp = b.remedies.find((r) => r.kind === "DISPUTE_OFFER" && r.state !== "SUPERSEDED");
        return (
          <section key={d.paypalDisputeId} className="mt-4 rounded-lg border border-broken bg-broken-wash p-4 text-sm" aria-label="PayPal dispute">
            <p className="eyebrow text-broken">PayPal dispute · {d.stage} · {d.status}</p>
            <p className="mt-1">The buyer opened dispute <span className="mono">{d.paypalDisputeId}</span> ({(d.reason ?? "").toLowerCase().replace(/_/g, " ")}). {resp
              ? resp.state === "PROPOSED" ? "Kept has prepared a response from the promise ledger below. Nothing is sent to PayPal until you approve it." : `Your response was ${resp.state === "COMPLETED" ? "accepted by PayPal" : resp.state.toLowerCase()}.`
              : "Kept found nothing it could honestly propose."}</p>
          </section>
        );
      })}

      {/* SAID | SEAL | HAPPENED */}
      <section className="mt-8" aria-labelledby="said-h">
        <h2 id="said-h" className="eyebrow">Said · Happened</h2>
        {b.commitments.length === 0 && <p className="mt-2 text-sm text-ink-soft">{o.extractionStatus === "COMPLETED" ? "No promises were found in this order's sources." : "Promises are extracted once PayPal confirms the payment."}</p>}
        <ul className="mt-2 space-y-4">
          {b.commitments.map((c) => {
            const src = b.commitmentSources.find((s) => s.id === c.sourceId);
            const ev = (c.evaluation ?? {}) as Record<string, unknown>;
            const remedy = b.remedies.find((r) => r.commitmentId === c.id && r.state !== "SUPERSEDED");
            return (
              <li key={c.id} id={c.id} className="overflow-hidden rounded-lg border border-rule">
                <div className="grid sm:grid-cols-[1fr_auto_1fr]">
                  <div className="bg-raised p-4">
                    <p className="eyebrow">Said · {TYPE[c.type]}</p>
                    <blockquote className="quote mt-1 text-xl">&ldquo;{c.quote}&rdquo;</blockquote>
                    <p className="mt-1 text-xs text-ink-soft">{src?.kind === "CHAT_TRANSCRIPT" ? "AI sales chat" : src?.kind === "USER_MANDATE" ? "the shopper's own words to their agent" : src?.title} · chars {c.spanStart}–{c.spanEnd} · extractor {c.extractor} · confidence {c.confidence.toFixed(2)}</p>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-ink-soft">Validation ({c.validation.filter((v) => v.ok).length}/{c.validation.length} checks passed)</summary>
                      <ul className="mt-1 space-y-0.5">{c.validation.map((v, i) => <li key={i}><span aria-hidden="true">{v.ok ? "✓" : "✕"}</span><span className="sr-only">{v.ok ? "passed" : "failed"}</span> <span className="mono">{v.check}</span> — {v.detail}</li>)}</ul>
                    </details>
                  </div>
                  <div className="flex items-center justify-center border-y border-rule bg-paper p-3 sm:border-x sm:border-y-0"><StateSeal state={c.state} stamp madeGood={c.evaluation?.madeGood === true} /></div>
                  <div className="bg-raised p-4 text-sm">
                    <p className="eyebrow">Happened · PayPal records</p>
                    {c.type === "PRICE_AS_QUOTED" && (
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                        <dt className="text-ink-soft">Promised</dt><dd className="text-right"><Money minor={Number(ev.promisedMinor ?? c.params.amountMinor ?? 0)} currency={cur} /></dd>
                        <dt className="text-ink-soft">Captured</dt><dd className="text-right"><Money minor={ev.capturedMinor as number | undefined} currency={cur} /></dd>
                        {Number(ev.discrepancyMinor ?? 0) > 0 && <><dt className="font-semibold text-broken">Overcharge</dt><dd className="text-right font-semibold text-broken"><Money minor={Number(ev.discrepancyMinor)} currency={cur} /></dd></>}
                        {Number(ev.refundedMinor ?? 0) > 0 && <><dt className="text-kept">Refunded</dt><dd className="text-right text-kept"><Money minor={Number(ev.refundedMinor)} currency={cur} /></dd></>}
                      </dl>
                    )}
                    {c.type === "SHIP_BY" && <p className="mt-1">{ev.trackingNumber ? <>Tracker <span className="mono">{String(ev.trackingNumber)}</span> at <span className="mono">{String(ev.trackerRecordedAt).slice(0, 16).replace("T", " ")}</span></> : "No shipment tracker on the PayPal order."}{c.dueAt && <span className="mono block text-xs text-ink-soft">deadline {c.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>}</p>}
                    {c.type === "REFUND_BY" && <p className="mt-1">{ev.refundId ? <>Refund <span className="mono">{String(ev.refundId)}</span></> : ev.triggeredAt ? "No completed refund yet." : "Clock not started."}</p>}
                    {c.type === "OTHER" && <p className="mt-1 text-ink-soft">No PayPal record can confirm or deny this.</p>}
                    {c.type === "MANDATE_MAX_TOTAL" && (
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                        <dt className="text-ink-soft">Shopper&rsquo;s limit</dt><dd className="text-right"><Money minor={Number(c.params.maxMinor)} currency={cur} /></dd>
                        <dt className="text-ink-soft">Merchant quoted</dt><dd className="text-right"><Money minor={ev.merchantQuotedMinor as number | null} currency={cur} /></dd>
                        <dt className="text-ink-soft">PayPal captured</dt><dd className="text-right"><Money minor={ev.capturedMinor as number | undefined} currency={cur} /></dd>
                        <dt className="text-ink-soft">Net after refunds</dt><dd className="text-right"><Money minor={ev.netMinor as number | undefined} currency={cur} /></dd>
                      </dl>
                    )}
                    {(c.state === "BROKEN" || c.state === "AT_RISK") && typeof ev.attribution === "string" && BLAME[ev.attribution] && <p className="mt-1 font-semibold">{BLAME[ev.attribution]}</p>}
                    <p className="mt-2 text-ink-soft">{c.stateReason}</p>
                    {c.type.startsWith("MANDATE_") && (c.state === "BROKEN" || c.state === "AT_RISK") && <p className="mt-1 text-xs text-ink-soft">A shopper&rsquo;s mandate gets no remedy of its own: it is made good through the merchant promise it depends on (price or shipping), and Kept re-checks it after every PayPal update.</p>}
                    <CommitmentActions commitmentId={c.id} type={c.type} state={c.state} triggered={Boolean(c.params.triggeredAt)} canReopen={!c.type.startsWith("MANDATE_") && (!remedy || remedy.state === "REJECTED")} />
                  </div>
                </div>
                {remedy && (
                  <RemedySheet
                    remedy={{ id: remedy.id, kind: remedy.kind, state: remedy.state, amountMinor: remedy.amountMinor, currency: remedy.currency, customerMessage: remedy.customerMessage, rationale: remedy.rationale, citations: remedy.citations, proposedBy: remedy.proposedBy, policyChecks: remedy.policyChecks, paypalRefundId: remedy.paypalRefundId, paypalRefundStatus: remedy.paypalRefundStatus, errorCode: remedy.errorCode, errorDetail: remedy.errorDetail, decidedAt: remedy.decidedAt?.toISOString() ?? null }}
                    preview={previews[remedy.id] ?? null}
                    discrepancyLabel={Number(ev.discrepancyMinor ?? 0) > 0 ? formatMoney(Number(ev.outstandingMinor ?? ev.discrepancyMinor), cur) : null}
                    reviewThresholdMinor={b.merchant.policy.reviewThresholdMinor}
                    simulated={simulated}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Evidence */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="ev-h">
          <h2 id="ev-h" className="eyebrow">PayPal events (verified)</h2>
          {b.events.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No webhook events yet. Kept also reconciles with authoritative GETs.</p> : (
            <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-rule text-sm">
              {b.events.map((e) => (
                <li key={e.id} className="py-2">
                  <p className="mono text-xs">{e.eventType}</p>
                  <p className="text-xs text-ink-soft">{e.receivedAt.toISOString().slice(0, 19).replace("T", " ")} · {e.verification === "SUCCESS" ? "signature verified" : "SIMULATED (unsigned emulator event)"} · {e.processingStatus.toLowerCase()} · <span className="mono">{e.paypalEventId}</span></p>
                </li>
              ))}
            </ul>
          )}
          {b.disputes.length > 0 && <>
            <h3 className="eyebrow mt-6">Disputes</h3>
            <ul className="mt-2 text-sm">{b.disputes.map((d) => <li key={d.paypalDisputeId}><span className="mono">{d.paypalDisputeId}</span> · {d.reason} · {d.stage} · {d.status}</li>)}</ul>
          </>}
          <h3 className="eyebrow mt-6">Sources (immutable)</h3>
          {b.orderSources.map((s) => (
            <details key={s.id} className="mt-2 text-sm"><summary className="cursor-pointer">{s.title} · <span className="mono text-xs">sha256 {s.sha256.slice(0, 12)}…</span></summary><pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-paper p-2 text-xs">{s.text}</pre></details>
          ))}
        </section>
        <section aria-labelledby="audit-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="audit-h" className="eyebrow">Audit trail</h2>
            <a className="text-xs underline" href={`/api/merchant/orders/${o.id}/evidence`} download>Download evidence pack (JSON)</a>
          </div>
          <p className={`mt-1 text-xs ${chain.ok ? "text-kept" : "text-broken font-semibold"}`} role="status">
            {chain.ok
              ? <>Hash chain intact: {chain.length} entries, each linked to the one before by SHA-256 · head <span className="mono">{chain.head.slice(0, 16)}…</span></>
              : <>Hash chain BROKEN at entry {chain.brokenAtSeq}: {chain.reason}</>}
          </p>
          <ol className="mt-2 divide-y divide-[var(--rule)] border-y border-rule text-sm">
            {b.audit.map((a) => (
              <li key={a.id} className="grid grid-cols-[4.5rem_1fr] gap-2 py-2">
                <span className={`eyebrow ${a.actor === "ai" ? "text-accent" : a.actor === "paypal" ? "text-kept" : a.actor === "merchant" ? "text-ink" : ""}`}>{a.actor === "ai" ? "AI" : a.actor}</span>
                <span className="min-w-0">
                  <span className="mono text-xs">{a.action}</span> <span className="text-xs text-ink-soft">· {a.outcome} · {a.createdAt.toISOString().slice(11, 19)}</span>
                  {Object.keys(a.detail).length > 0 && <span className="block break-all text-xs text-ink-soft">{JSON.stringify(a.detail)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
