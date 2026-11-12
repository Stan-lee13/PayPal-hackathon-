"use client";

import { api } from "@/lib/client/api";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fingerprint, PROMISE_VERSION, verifyChain, verifyDetached, verifyPromise, verifySpend, type Envelope } from "@/lib/envelope/core";
import { Figure, Stamp, usd } from "@/components/stationery";

type ReceiptT = { v: string; spend: string; request: { amount: number; currency: string; payee: string; purpose: string; memo: string; at: string; leaf: string; nonce: string; v: string }; requestSig: string; releasedBy?: { key: string; work: string; note: string; at: string }; paidTo?: { account: string; agent: string; agentLabel: string; settledTo: string; held?: { ledgerEntry: number; balanceAfterMinor: number } }; chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>; principal: string; paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string | null; payoutItemId: string | null }; issuedAt: string; gateway: string; sig: string };
type Data = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; receipt: ReceiptT; chain: Envelope; spend: { id: string; status: string; payoutStatus: string | null; payoutTransactionId: string | null; agentNote: string | null } };

/** A barcode drawn from the spend id: decoration, but the same id always draws the same bars. */
function Bars({ id }: { id: string }) {
  const bars = [...id].flatMap((c) => { const n = c.charCodeAt(0); return [1 + (n & 3), 1 + ((n >> 2) & 1), 1 + ((n >> 3) & 3), 1 + ((n >> 5) & 1)]; });
  let x = 0;
  return (
    <svg viewBox={`0 0 ${bars.reduce((a, b) => a + b, 0)} 20`} preserveAspectRatio="none" className="h-9 w-full" aria-hidden="true">
      {bars.map((w, i) => { const r = i % 2 === 0 ? <rect key={i} x={x} y="0" width={w} height="20" fill="var(--ink)" /> : null; x += w; return r; })}
    </svg>
  );
}

export function ReceiptView({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ summary: string; proves: string } | null>(null);
  const [local, setLocal] = useState<Array<{ name: string; ok: boolean }> | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await api(`/api/spends/${id}`);
      const j = r.json;
      if (!r.ok) { setErr(j.error ?? "No receipt."); return; }
      setD(j);
      // Independent verification in THIS browser: nothing below trusts the server's answer.
      const data = j as Data;
      const at = new Date(data.receipt.request.at);
      const { sig, ...body } = data.receipt;
      const [chain, spend, rec] = await Promise.all([
        verifyChain(data.chain, at),
        (data.receipt.request.v === PROMISE_VERSION ? verifyPromise : verifySpend)({ request: data.receipt.request as never, sig: data.receipt.requestSig, chain: data.chain }, at),
        verifyDetached(data.receipt.gateway, "envelope-receipt/1", body, sig),
      ]);
      setLocal([
        { name: "Every block in the chain is signed by the holder above it, and only narrows it", ok: chain.ok },
        { name: "The root is signed by the owner's key named on the receipt", ok: chain.principal === data.receipt.principal },
        { name: `The ${data.receipt.request.v === PROMISE_VERSION ? "promise" : "spend request"} is signed by the agent the last envelope was given to, and fits its limits`, ok: spend.ok },
        { name: "The receipt is signed by the gateway", ok: rec },
      ]);
    })();
  }, [id]);

  if (err) return <p className="sheet p-6 text-sm">{err}</p>;
  if (!d) return <p className="label py-10">Fetching the receipt and checking it against PayPal…</p>;
  const r = d.receipt;
  const Check = ({ ok, name, detail }: { ok: boolean; name: string; detail?: string }) => (
    <li className="flex gap-2.5 border-t border-rule py-2.5 first:border-t-0"><span className={`mono w-4 shrink-0 font-semibold ${ok ? "text-green" : "text-red"}`}>{ok ? "✓" : "✕"}</span><span>{name}{detail ? <span className="mono mt-0.5 block text-[.7rem] text-ink-2">{detail}</span> : null}</span></li>
  );
  const localOk = local?.every((c) => c.ok);
  return (
    <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      <div>
        <Link className="link text-sm" href={`/e/${d.chain[0]!.body.id}`}>← Envelope</Link>
        <Link className="link ml-5 text-sm" href={`/proof/${d.chain[0]!.body.id}/${id}`}>This payment in the proof graph →</Link>
        <article className="receipt relative mt-4 px-6 pt-7 text-[.8rem] leading-relaxed sm:px-8" aria-label="Receipt">
          <p className="text-center text-[.68rem] tracking-[.34em]">ENVELOPE · RECEIPT</p>
          <h1 className="mt-5 text-center font-sans"><span className="sr-only">Receipt: </span><Figure minor={r.request.amount} className="text-[3.4rem]" /></h1>
          <p className="mt-2 text-center">to {r.paidTo ? <><Link href={`/a/${r.paidTo.agent}`} className="link !text-ink"><b>{r.paidTo.agentLabel}</b></Link> <span className="text-ink-2">account {r.paidTo.account}</span></> : <b className="break-all">{r.request.payee}</b>}</p>
          {r.request.v === PROMISE_VERSION && <p className="text-center text-ink-2">{r.releasedBy ? (r.releasedBy.key === r.principal ? "over the owner's threshold: set aside, then signed by the owner" : "set aside first, released when the work was accepted") : "set aside first, paid when the work was done"}</p>}
          <p className="text-center text-ink-2">{r.request.purpose}{r.request.memo ? ` · ${r.request.memo}` : ""}</p>
          <p className="text-center text-ink-2">{new Date(r.request.at).toISOString().replace("T", " ").slice(0, 19)} UTC</p>
          <Stamp tone="green" size="lg" land className="absolute right-4 top-[5.2rem]">Paid</Stamp>

          <h2 className="mt-6 border-t border-dashed border-ink pt-4 text-[.68rem] tracking-[.2em]">WHO AUTHORIZED THIS DOLLAR</h2>
          <ol className="chain mt-3">
            <li><p><b>Owner</b> <span className="text-ink-2">{fingerprint(r.principal)}</span></p><p className="text-ink-2">sealed the root envelope: {usd(d.chain[0]!.body.caps.limit)} in total</p></li>
            {d.chain.map((b, i) => (
              <li key={b.body.id}>
                <p><Link href={`/a/${b.body.holder}`} className="link !text-ink"><b>{b.body.holderLabel}</b></Link> <span className="text-ink-2">{fingerprint(b.body.holder)}</span></p>
                <p className="text-ink-2">{i === 0 ? "received the root envelope" : `was given a narrower envelope by ${d.chain[i - 1]!.body.holderLabel}`}: up to {usd(b.body.caps.limit)}, {b.body.caps.payees ? `only to ${b.body.caps.payees.join(", ")}` : "any payee"}, {b.body.caps.purposes ? `only for ${b.body.caps.purposes.join(", ")}` : "any purpose"}</p>
              </li>
            ))}
            <li className="is-end"><p><b>{r.paidTo ? r.paidTo.agentLabel : r.request.payee}</b> received {usd(r.request.amount)}</p>{r.paidTo && <p className="text-ink-2">an agent with its own account ({r.paidTo.account}); {r.paidTo.held ? `credited to its balance (ledger entry ${r.paidTo.held.ledgerEntry}), not paid out` : `PayPal paid its owner at ${r.paidTo.settledTo}`}</p>}{d.spend.agentNote && <p className="text-ink-2">Agent's stated reason: “{d.spend.agentNote}”</p>}</li>
          </ol>

          {r.releasedBy && (
            <>
              <h2 className="mt-3 border-t border-dashed border-ink pt-4 text-[.68rem] tracking-[.2em]">{r.releasedBy.key === r.principal ? "SIGNED BY THE OWNER" : "RELEASED ON ACCEPTED WORK"}</h2>
              <dl className="mt-2 space-y-1">
                <div className="leader"><dt className="text-ink-2">Accepted by</dt><i /><dd>{r.releasedBy.key === r.principal ? "the owner" : d.chain.find((b) => b.body.holder === r.releasedBy!.key)?.body.holderLabel ?? "named key"} · {fingerprint(r.releasedBy.key)}</dd></div>
                {r.releasedBy.work && <div className="leader"><dt className="text-ink-2">Work fingerprint</dt><i /><dd>{r.releasedBy.work.slice(0, 20)}…</dd></div>}
                <div className="leader"><dt className="text-ink-2">Signed at</dt><i /><dd>{new Date(r.releasedBy.at).toISOString().replace("T", " ").slice(0, 19)} UTC</dd></div>
              </dl>
              {r.releasedBy.note && <p className="mt-1.5 text-ink-2">“{r.releasedBy.note}”</p>}
            </>
          )}

          <h2 className="mt-3 border-t border-dashed border-ink pt-4 text-[.68rem] tracking-[.2em]">PAYPAL</h2>
          <dl className="mt-2 space-y-1">
            <div className="leader"><dt className="text-ink-2">Hold</dt><i /><dd>{r.paypal.authorizationId}</dd></div>
            <div className="leader"><dt className="text-ink-2">Capture</dt><i /><dd>{r.paypal.captureId}</dd></div>
            <div className="leader"><dt className="text-ink-2">Payout batch</dt><i /><dd>{r.paypal.payoutBatchId ? <>{r.paypal.payoutBatchId}{d.spend.payoutStatus ? ` · ${d.spend.payoutStatus}` : ""}</> : "none: kept in the agent\u2019s balance"}</dd></div>
            {d.spend.payoutTransactionId && <div className="leader"><dt className="text-ink-2">Payout txn</dt><i /><dd>{d.spend.payoutTransactionId}</dd></div>}
            <div className="leader"><dt className="text-ink-2">Environment</dt><i /><dd>{r.paypal.mode === "sandbox" ? "sandbox (real API, test money)" : r.paypal.mode}</dd></div>
          </dl>
          <div className="mt-6"><Bars id={r.spend} /></div>
          <p className="mt-1.5 text-center text-[.68rem] tracking-[.14em] text-ink-2">{r.spend}</p>
        </article>
      </div>

      <div className="space-y-8 lg:pt-10">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-ink pb-3"><h2 className="title text-2xl">Checked against PayPal just now</h2><Stamp tone={d.ok ? "green" : "red"} land>{d.ok ? "All checks pass" : "Mismatch"}</Stamp></div>
          <p className="mt-3 text-sm text-ink-2">The gateway asked PayPal for the capture and the payout by id and compared them with this receipt.</p>
          <ul className="mt-2 text-[.92rem]">{d.checks.map((c, i) => <Check key={i} {...c} />)}</ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-2">If the payer ever disputes this payment at PayPal, the gateway answers with the payer&rsquo;s own signature on the envelope and every signature between it and this payment. <button type="button" className="link" data-testid="evidence-link" onClick={async () => { const r = await api(`/api/spends/${id}/evidence`); setEvidence(r.ok ? { summary: r.json.summary, proves: r.json.whatItProves } : { summary: r.json?.error ?? "The evidence could not be put together just now.", proves: "" }); }}>Show what would be sent</button></p>
          {evidence && (
            <div className="mt-3" data-testid="evidence">
              <pre className="code max-h-72 overflow-auto whitespace-pre-wrap p-3 text-[.7rem] leading-relaxed">{evidence.summary}</pre>
              {evidence.proves && <p className="mt-2 text-xs leading-relaxed text-ink-3">{evidence.proves}</p>}
            </div>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-ink pb-3"><h2 className="title text-2xl">Verified in your browser</h2>{local && <Stamp tone={localOk ? "green" : "red"} land>{localOk ? "Signatures valid" : "Invalid"}</Stamp>}</div>
          <p className="mt-3 text-sm text-ink-2">Your browser re-ran the Ed25519 checks on the raw chain. This doesn't rely on the gateway being honest.</p>
          <ul className="mt-2 text-[.92rem]">{(local ?? []).map((c, i) => <Check key={i} {...c} />)}</ul>
          <details className="mt-4 text-xs"><summary className="label cursor-pointer">Raw receipt</summary><pre className="code mt-2 max-h-80 overflow-auto p-3 text-[11px]">{JSON.stringify(r, null, 2)}</pre></details>
        </section>
      </div>
    </div>
  );
}
