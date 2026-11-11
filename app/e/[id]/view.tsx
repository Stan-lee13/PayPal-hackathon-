"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fingerprint, signRevoke, type Caps, type KeyPair } from "@/lib/envelope/core";
import { principalKey } from "@/lib/principal-key";

type BlockT = { id: string; parentId: string | null; depth: number; holder: string; holderLabel: string; caps: Caps; spentMinor: number; reservedMinor: number; revokedAt: string | null };
type SpendT = { id: string; leafLabel: string; amountMinor: number; payee: string; purpose: string; memo: string; agentNote: string | null; status: string; reasons: Array<{ code: string; detail: string }>; captureId: string | null; payoutBatchId: string | null; payoutStatus: string | null; createdAt: string; hasReceipt: boolean };
type Data = {
  mode: string; demoAgents: boolean;
  root: { id: string; principal: string; principalName: string; title: string; limitMinor: number; capturedMinor: number; releasedMinor: number | null; status: string; authorizationId: string | null; paypalOrderId: string | null; authorizationExpiresAt: string | null; closeReason: string | null };
  blocks: BlockT[]; spends: SpendT[];
  audit: { ok: boolean; length: number; entries: Array<{ seq: number; at: string; actor: string; action: string; ref: string | null; outcome: string }> };
};

const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const SPEND_LABEL: Record<string, string> = { PAID: "Paid", DENIED: "Denied", PAYOUT_PENDING: "Paid · PayPal processing", UNCLAIMED: "Paid · payee hasn't claimed", RESERVED: "In flight", CAPTURED: "In flight", FAILED: "Failed · refunded" };
const RUN = ["split-localization", "split-creative", "pay-translator", "pay-designer"] as const;
const ATTACK = ["attack-payee", "attack-overspend", "attack-forge"] as const;

export function EnvelopeView({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<KeyPair | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<Array<{ text: string; tone: "info" | "good" | "bad" }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/envelopes/${id}`, { cache: "no-store" });
    if (r.status === 404) { setMissing(true); return; }
    if (r.ok) setD(await r.json());
  }, [id]);
  useEffect(() => {
    void load(); void principalKey(false).then(setMe);
    timer.current = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  if (missing) return <p className="card p-6 text-sm">No such envelope. <Link className="link" href="/console">Seal one</Link>.</p>;
  if (!d) return <p className="card p-6 text-sm text-ink-soft">Loading…</p>;
  const { root, blocks, spends } = d;
  const isOwner = me?.publicKey === root.principal;
  const open = root.status === "ACTIVE";
  const say = (text: string, tone: "info" | "good" | "bad" = "info") => setLines((l) => [...l, { text, tone }]);

  async function script(actions: readonly string[], label: string) {
    setBusy(label); setErr(null);
    try {
      for (const action of actions) {
        const r = await fetch("/api/demo/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rootId: id, action }) });
        const j = await r.json();
        if (!r.ok) { setErr(j.error ?? "That step failed."); break; }
        say(j.narration);
        if (j.status === "DENIED") say(`Gateway: DENIED — ${j.reasons.map((x: { meaning: string }) => x.meaning).join(" ")}`, "bad");
        else if (j.status) say(`Gateway: ${SPEND_LABEL[j.status] ?? j.status} — captured from the PayPal hold and paid out.`, "good");
        await load();
        await new Promise((res) => setTimeout(res, 700));
      }
    } finally { setBusy(null); }
  }

  async function revoke(blockId: string, label: string) {
    if (!me) return;
    setBusy("revoke"); setErr(null);
    try {
      const r = await fetch("/api/gateway/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed: await signRevoke(me, blockId) }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Couldn't revoke."); return; }
      if (blockId === id) say(`You closed the envelope. PayPal released ${usd(j.root.releasedMinor ?? 0)} of the hold; you were charged ${usd(j.root.capturedMinor)}.`, "good");
      else say(`You revoked ${label}'s envelope. It, and anything split from it, is dead as of now.`, "good");
      await load();
    } finally { setBusy(null); }
  }

  const held = open ? root.limitMinor - root.capturedMinor : 0;
  const children = (parent: string | null) => blocks.filter((b) => b.parentId === parent);
  const Node = ({ b }: { b: BlockT }) => {
    const dead = Boolean(b.revokedAt) || !open;
    const kids = children(b.id);
    const used = b.spentMinor + b.reservedMinor;
    return (
      <div className="space-y-3">
        <div className={`env p-4 ${dead ? "env-dead" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{b.holderLabel} <span className="mono text-xs font-normal text-ink-soft">{fingerprint(b.holder)}</span></p>
              <p className="text-xs text-ink-soft">{b.depth === 0 ? `sealed by ${root.principalName}` : "split off by the envelope above, offline"} · expires {new Date(b.caps.notAfter).toISOString().slice(5, 16).replace("T", " ")} UTC · {b.caps.splits > 0 ? `can split ${b.caps.splits}×` : "cannot split"}</p>
            </div>
            <div className="flex items-center gap-2">
              {b.revokedAt && b.depth > 0 ? <span className="chip chip-REVOKED">Revoked</span> : null}
              {isOwner && open && !b.revokedAt && b.depth > 0 ? <button type="button" className="btn btn-sm btn-danger" disabled={Boolean(busy)} onClick={() => revoke(b.id, b.holderLabel)}>Revoke</button> : null}
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between text-sm"><span className="money font-semibold">{usd(b.spentMinor)} <span className="font-normal text-ink-soft">spent of {usd(b.caps.limit)}</span></span><span className="text-xs text-ink-soft">max {usd(b.caps.perPayment)} per payment</span></div>
          <div className="bar mt-1.5" role="img" aria-label={`${usd(used)} of ${usd(b.caps.limit)} used`}><i className="bar-spent" style={{ width: `${(b.spentMinor / b.caps.limit) * 100}%` }} /><i className="bar-reserved" style={{ width: `${(b.reservedMinor / b.caps.limit) * 100}%` }} /></div>
          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {(b.caps.payees ?? ["any payee"]).map((p) => <span key={p} className="kbd">{p}</span>)}
            {(b.caps.purposes ?? ["any purpose"]).map((p) => <span key={p} className="kbd">{p}</span>)}
          </p>
        </div>
        {kids.length > 0 && <div className="env-children space-y-3">{kids.map((k) => <Node key={k.id} b={k} />)}</div>}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div>
          <p className="text-sm text-ink-soft">Envelope · owner {root.principalName} <span className="mono text-xs">{fingerprint(root.principal)}</span>{isOwner ? " (you)" : ""}</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">{root.title} <span className={`chip chip-${root.status}`}>{open ? "Open" : "Closed"}</span></h1>
        </div>

        <section className="card p-5" aria-label="PayPal hold">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="eyebrow">PayPal hold backing this envelope</p>
            <p className="mono text-xs text-ink-soft">authorization {root.authorizationId}</p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div><p className="money text-xl font-semibold">{usd(root.capturedMinor)}</p><p className="text-xs text-ink-soft">captured: what agents actually spent</p></div>
            <div><p className="money text-xl font-semibold">{usd(held)}</p><p className="text-xs text-ink-soft">still held, not charged</p></div>
            <div><p className="money text-xl font-semibold">{usd(root.releasedMinor ?? 0)}</p><p className="text-xs text-ink-soft">released back by PayPal</p></div>
          </div>
          <div className="bar mt-3"><i className="bar-spent" style={{ width: `${(root.capturedMinor / root.limitMinor) * 100}%` }} /><i className="bar-released" style={{ width: `${((root.releasedMinor ?? 0) / root.limitMinor) * 100}%` }} /></div>
          <p className="mt-2 text-xs text-ink-soft">Each spend is a partial capture of this one authorization; PayPal itself refuses to capture beyond it. Closing the envelope voids the rest. {d.mode === "sandbox" ? "Sandbox: the hold is on PayPal's test card." : ""}</p>
        </section>

        <section aria-label="Envelopes" className="space-y-3">
          <h2 className="font-semibold">Who holds what</h2>
          {children(null).map((b) => <Node key={b.id} b={b} />)}
        </section>

        {(d.demoAgents || isOwner) && (
          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Controls</h2>
            <div className="flex flex-wrap gap-2">
              {d.demoAgents && <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !open} onClick={() => script(RUN, "run")}>{busy === "run" ? "Agents working…" : "Run the launch (agents split & pay)"}</button>}
              {d.demoAgents && <button type="button" className="btn" disabled={Boolean(busy) || !open} onClick={() => script(ATTACK, "attack")}>{busy === "attack" ? "Attacking…" : "Compromise the creative agent"}</button>}
              {isOwner && <button type="button" className="btn btn-danger" disabled={Boolean(busy) || !open} onClick={() => revoke(id, "the root")}>Close envelope & release the hold</button>}
            </div>
            {d.demoAgents && <p className="text-xs text-ink-soft">The built-in agents are scripted and their keys live on this demo server. External agents (see the README) hold their own keys and call the same gateway.</p>}
            {!isOwner && <p className="text-xs text-ink-soft">Only the owner's browser holds the key that can revoke or close this envelope.</p>}
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            {lines.length > 0 && <ol className="space-y-1.5 rounded-lg bg-sunken p-3 text-sm" aria-live="polite">{lines.map((l, i) => <li key={i} className={`enter ${l.tone === "bad" ? "text-danger" : l.tone === "good" ? "text-paid" : ""}`}>{l.text}</li>)}</ol>}
          </section>
        )}
      </div>

      <aside className="space-y-5">
        <section>
          <h2 className="font-semibold">Activity</h2>
          {spends.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No spend requests yet.</p> : (
            <ul className="mt-3 space-y-2">
              {spends.map((s) => (
                <li key={s.id} className="card enter p-3.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p><span className="font-semibold">{s.leafLabel}</span> → <span className="mono text-xs">{s.payee}</span></p>
                    <span className="money shrink-0 font-semibold">{usd(s.amountMinor)}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2"><span className={`chip chip-${s.status}`}>{SPEND_LABEL[s.status] ?? s.status}</span><span className="text-xs text-ink-soft">{s.purpose}{s.memo ? ` · ${s.memo}` : ""}</span></p>
                  {s.agentNote && <p className="mt-1.5 text-xs italic text-ink-soft">Agent: “{s.agentNote}”</p>}
                  {s.reasons.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs text-danger">{s.reasons.map((r, i) => <li key={i}><span className="mono">{r.code}</span> · {r.detail}</li>)}</ul>}
                  {s.captureId && <p className="mono mt-1.5 text-[11px] text-ink-soft">capture {s.captureId} · payout {s.payoutBatchId}{s.payoutStatus ? ` (${s.payoutStatus})` : ""}</p>}
                  {s.hasReceipt && <Link className="link mt-1 inline-block text-xs" href={`/r/${s.id}`}>Receipt & authority chain →</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Audit trail</h2><span className={`chip ${d.audit.ok ? "chip-PAID" : "chip-DENIED"}`}>{d.audit.ok ? `Hash chain intact · ${d.audit.length}` : "Chain broken"}</span></div>
          <ol className="mt-3 space-y-1 text-xs">{d.audit.entries.map((e) => <li key={e.seq}><span className="mono text-ink-soft">#{e.seq}</span> {e.action.replace(/\./g, " › ")} <span className="text-ink-soft">· {e.actor}{e.ref ? ` · ${e.ref.slice(0, 22)}` : ""}</span></li>)}</ol>
        </section>
      </aside>
    </div>
  );
}
