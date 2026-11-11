"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fingerprint, verifyChain, verifyDetached, verifySpend, type Envelope } from "@/lib/envelope/core";

type ReceiptT = { v: string; spend: string; request: { amount: number; currency: string; payee: string; purpose: string; memo: string; at: string; leaf: string; nonce: string; v: string }; requestSig: string; chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>; principal: string; paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string; payoutItemId: string | null }; issuedAt: string; gateway: string; sig: string };
type Data = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }>; receipt: ReceiptT; chain: Envelope; spend: { id: string; status: string; payoutStatus: string | null; payoutTransactionId: string | null; agentNote: string | null } };

export function ReceiptView({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<Array<{ name: string; ok: boolean }> | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/spends/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "No receipt."); return; }
      setD(j);
      // Independent verification in THIS browser: nothing below trusts the server's answer.
      const data = j as Data;
      const at = new Date(data.receipt.request.at);
      const { sig, ...body } = data.receipt;
      const [chain, spend, rec] = await Promise.all([
        verifyChain(data.chain, at),
        verifySpend({ request: data.receipt.request as never, sig: data.receipt.requestSig, chain: data.chain }, at),
        verifyDetached(data.receipt.gateway, "envelope-receipt/1", body, sig),
      ]);
      setLocal([
        { name: "Every block in the chain is signed by the holder above it, and only narrows it", ok: chain.ok },
        { name: "The root is signed by the owner's key named on the receipt", ok: chain.principal === data.receipt.principal },
        { name: "The spend request is signed by the agent the last envelope was given to, and fits its limits", ok: spend.ok },
        { name: "The receipt is signed by the gateway", ok: rec },
      ]);
    })();
  }, [id]);

  if (err) return <p className="card p-6 text-sm">{err}</p>;
  if (!d) return <p className="card p-6 text-sm text-ink-soft">Fetching the receipt and checking it against PayPal…</p>;
  const r = d.receipt;
  const usd = `$${(r.request.amount / 100).toFixed(2)}`;
  const Check = ({ ok, name, detail }: { ok: boolean; name: string; detail?: string }) => (
    <li className="flex gap-2"><span className={`mono w-5 shrink-0 font-semibold ${ok ? "text-paid" : "text-danger"}`}>{ok ? "✓" : "✕"}</span><span>{name}{detail ? <span className="mono block text-xs text-ink-soft">{detail}</span> : null}</span></li>
  );
  return (
    <div className="space-y-5">
      <div>
        <Link className="link text-sm" href={`/e/${d.chain[0]!.body.id}`}>← Envelope</Link>
        <h1 className="mt-2 text-2xl font-semibold">Receipt: {usd} to <span className="mono text-xl">{r.request.payee}</span></h1>
        <p className="text-sm text-ink-soft">{r.request.purpose}{r.request.memo ? ` · ${r.request.memo}` : ""} · {new Date(r.request.at).toISOString().replace("T", " ").slice(0, 19)} UTC</p>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Who authorized this dollar</h2>
        <ol className="mt-4 space-y-4">
          <li className="step"><span className="dot dot-done" /><p className="text-sm font-medium">Owner <span className="mono text-xs font-normal text-ink-soft">{fingerprint(r.principal)}</span></p><p className="text-xs text-ink-soft">sealed the root envelope: {`$${(d.chain[0]!.body.caps.limit / 100).toFixed(2)}`} in total</p></li>
          {d.chain.map((b, i) => (
            <li key={b.body.id} className="step"><span className="dot dot-done" /><p className="text-sm font-medium">{b.body.holderLabel} <span className="mono text-xs font-normal text-ink-soft">{fingerprint(b.body.holder)}</span></p>
              <p className="text-xs text-ink-soft">{i === 0 ? "received the root envelope" : `was given a narrower envelope by ${d.chain[i - 1]!.body.holderLabel}`}: up to {`$${(b.body.caps.limit / 100).toFixed(2)}`}, {b.body.caps.payees ? `only to ${b.body.caps.payees.join(", ")}` : "any payee"}, {b.body.caps.purposes ? `only for ${b.body.caps.purposes.join(", ")}` : "any purpose"}</p></li>
          ))}
          <li className="step"><span className="dot dot-done" /><p className="text-sm font-medium">{r.request.payee} received {usd}</p>{d.spend.agentNote && <p className="text-xs italic text-ink-soft">Agent's stated reason: “{d.spend.agentNote}”</p>}</li>
        </ol>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">PayPal</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-soft">Hold (authorization)</dt><dd className="mono">{r.paypal.authorizationId}</dd>
          <dt className="text-ink-soft">Capture</dt><dd className="mono">{r.paypal.captureId}</dd>
          <dt className="text-ink-soft">Payout batch</dt><dd className="mono">{r.paypal.payoutBatchId}{d.spend.payoutStatus ? ` · ${d.spend.payoutStatus}` : ""}</dd>
          {d.spend.payoutTransactionId && <><dt className="text-ink-soft">Payout transaction</dt><dd className="mono">{d.spend.payoutTransactionId}</dd></>}
          <dt className="text-ink-soft">Environment</dt><dd>{r.paypal.mode === "sandbox" ? "PayPal sandbox (real API, test money)" : r.paypal.mode}</dd>
        </dl>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Checked against PayPal just now</h2><span className={`chip ${d.ok ? "chip-PAID" : "chip-DENIED"}`}>{d.ok ? "All checks pass" : "Mismatch"}</span></div>
        <ul className="mt-3 space-y-2 text-sm">{d.checks.map((c, i) => <Check key={i} {...c} />)}</ul>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Verified in your browser</h2>{local && <span className={`chip ${local.every((c) => c.ok) ? "chip-PAID" : "chip-DENIED"}`}>{local.every((c) => c.ok) ? "Signatures valid" : "Invalid"}</span>}</div>
        <p className="mt-1 text-xs text-ink-soft">Your browser re-ran the Ed25519 checks on the raw chain. This doesn't rely on the gateway being honest.</p>
        <ul className="mt-3 space-y-2 text-sm">{(local ?? []).map((c, i) => <Check key={i} {...c} />)}</ul>
        <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-soft">Raw receipt</summary><pre className="code mt-2 max-h-80 overflow-auto p-3 text-[11px]">{JSON.stringify(r, null, 2)}</pre></details>
      </section>
    </div>
  );
}
