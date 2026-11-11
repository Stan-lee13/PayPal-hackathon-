"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fingerprint, verifyDetached, type Caps } from "@/lib/envelope/core";
import { Figure, Flap, Meter, Passport, Sigil, SpendStamp, Stamp, usd } from "@/components/stationery";

type Sponsor = { role: "owner" | "agent"; label: string; key: string };
type Account = { blockId: string; rootId: string; rootTitle: string; depth: number; label: string; openedBy: Sponsor; sponsors: Sponsor[]; caps: Caps; spentMinor: number; reservedMinor: number; availableMinor: number; state: "LIVE" | "REVOKED" | "CLOSED" | "EXPIRED"; issued: Array<{ blockId: string; label: string; key: string; limitMinor: number; revoked: boolean }>; openedAt: string };
type SpendT = { id: string; rootId: string; amountMinor: number; payee: string; purpose: string; memo: string; status: string; reasons: Array<{ code: string; detail: string }>; createdAt: string; hasReceipt: boolean };
type Profile = { key: string; account: string; label: string; firstSeenAt: string; mode: string; demo: boolean; accounts: Account[]; record: { payments: number; paidMinor: number; refused: number; refusedCodes: string[]; revoked: number; availableMinor: number }; statement: SpendT[] };
type Standing = { v: string; agent: string; agentLabel: string; account: string; sponsors: Sponsor[]; root: string; ask: { amount: number; currency: string; payee: string; purpose: string }; good: boolean; reasons: Array<{ code: string; detail: string }>; availableMinor: number; paypal: { mode: string; authorizationId: string | null; status: string | null; unusedMinor: number | null }; issuedAt: string; validUntil: string; gateway: string; sig: string };

const STATE: Record<Account["state"], { text: string; tone: "green" | "red" | "grey" | "amber" }> = { LIVE: { text: "Live", tone: "green" }, REVOKED: { text: "Revoked", tone: "red" }, CLOSED: { text: "Closed", tone: "grey" }, EXPIRED: { text: "Expired", tone: "amber" } };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${new Date(iso).toISOString().slice(11, 16)}`.replace(/ /g, "\u00A0");

export function AgentView({ agentKey }: { agentKey: string }) {
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [ask, setAsk] = useState({ payee: "", amount: "", purpose: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ s: Standing; signed: boolean } | null>(null);
  const seeded = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/agents/${agentKey}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setMissing(j.error ?? "No such agent."); return; }
    setP(j);
    if (!seeded.current) {
      seeded.current = true;
      const live = (j as Profile).accounts.find((a) => a.state === "LIVE") ?? (j as Profile).accounts[0];
      if (live) setAsk({ payee: live.caps.payees?.[0] ?? "", purpose: live.caps.purposes?.[0] ?? "", amount: (Math.max(100, Math.min(live.caps.perPayment, live.availableMinor || live.caps.perPayment)) / 100).toFixed(2) });
    }
  }, [agentKey]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const amountMinor = Math.round(Number(ask.amount) * 100);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new Error("Enter an amount.");
      // 1. the agent introduces itself (a demo agent's key is on this server; a real agent does this itself)
      const h = await fetch("/api/demo/hello", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: agentKey, amountMinor, payee: ask.payee.trim(), purpose: ask.purpose.trim() }) });
      const hj = await h.json();
      if (!h.ok) throw new Error(hj.error ?? "The agent could not introduce itself.");
      // 2. the payee hands that introduction to the gateway, exactly as any outsider would
      const r = await fetch("/api/gateway/standing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: hj.hello }) });
      const rj = await r.json();
      if (!r.ok) throw new Error(rj.error ?? "The gateway refused.");
      // 3. and checks the gateway's signature here, in the browser
      const s = rj.standing as Standing;
      const { sig, ...body } = s;
      setAnswer({ s, signed: await verifyDetached(s.gateway, "envelope-standing/1", body, sig) });
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  if (missing) return <p className="sheet p-6 text-sm">{missing} <Link className="link" href="/console">Back to the console</Link>.</p>;
  if (!p) return <p className="label py-10">Pulling the agent's file…</p>;
  const live = p.accounts.filter((a) => a.state === "LIVE");
  const best = live[0] ?? p.accounts[0]!;
  const standing = live.length > 0 ? { text: "In good standing", tone: "green" as const } : p.accounts.some((a) => a.state === "REVOKED") ? { text: "Revoked", tone: "red" as const } : { text: "No live envelope", tone: "grey" as const };

  return (
    <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <div className="space-y-9">
        <header>
          <p className="label">Agent on file</p>
          <h1 className="sr-only">{p.label}</h1>
          <div className="mt-3"><Passport k={p.key} label={p.label} sponsors={best.sponsors.map((s) => s.label)} state={standing} since={day(p.firstSeenAt)} /></div>
        </header>

        <section aria-label="Record" className="grid grid-cols-2 gap-x-6 gap-y-6 border-y-[1.5px] border-ink py-5 sm:grid-cols-4">
          <div><Figure minor={p.record.availableMinor} className="text-[1.9rem] text-blue" /><p className="label mt-1.5">Can spend now</p></div>
          <div><Figure minor={p.record.paidMinor} className="text-[1.9rem]" /><p className="label mt-1.5">Paid so far</p></div>
          <div><p className="figure text-[1.9rem]">{p.record.payments}</p><p className="label mt-1.5">Payments</p></div>
          <div><p className={`figure text-[1.9rem] ${p.record.refused ? "text-red" : ""}`}>{p.record.refused}</p><p className="label mt-1.5">Refused</p></div>
        </section>

        <section className="space-y-4">
          <h2 className="label">Envelopes it holds</h2>
          {p.accounts.map((a) => (
            <div key={a.blockId} className={`envl px-4 pb-4 pt-10 sm:px-5 ${a.state === "LIVE" ? "" : "envl-dead"}`}>
              <Flap />
              <div className="flex flex-wrap items-end justify-between gap-3">
                <Link href={`/e/${a.rootId}`} className="envl-label px-3 py-1.5 transition-transform duration-150 ease-out active:scale-[.98]">
                  <span className="micro block">From the envelope</span>
                  <span className="title block text-[1.05rem] leading-tight">{a.rootTitle}</span>
                </Link>
                <p className="text-right leading-none"><Figure minor={a.availableMinor} className="text-[1.8rem]" /><span className="mono ml-1.5 text-[.72rem]">left of {usd(a.caps.limit)}</span></p>
              </div>
              <div className="mt-3"><Meter spent={a.spentMinor} held={a.reservedMinor} of={a.caps.limit} label={`${usd(a.spentMinor)} of ${usd(a.caps.limit)} spent`} /></div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap gap-1.5">{(a.caps.payees ?? ["any payee"]).map((x) => <span key={x} className="tag">{x}</span>)}{(a.caps.purposes ?? ["any purpose"]).map((x) => <span key={x} className="tag">{x}</span>)}</p>
                <Stamp tone={STATE[a.state].tone}>{STATE[a.state].text}</Stamp>
              </div>
              <p className="mono mt-2.5 text-[.68rem] leading-relaxed opacity-85">
                opened {stamp(a.openedAt)} UTC by {a.openedBy.role === "owner" ? `${a.openedBy.label}, its owner` : <Link className="underline underline-offset-2" href={`/a/${a.openedBy.key}`}>{a.openedBy.label}</Link>} · max {usd(a.caps.perPayment)} per payment · expires {stamp(a.caps.notAfter)} UTC
              </p>
              {a.issued.length > 0 && <p className="mono mt-1 text-[.68rem] leading-relaxed opacity-85">has opened envelopes for: {a.issued.map((x, i) => <span key={x.blockId}>{i ? ", " : ""}<Link className="underline underline-offset-2" href={`/a/${x.key}`}>{x.label}</Link> ({usd(x.limitMinor)}{x.revoked ? ", revoked" : ""})</span>)}</p>}
            </div>
          ))}
        </section>

        <section>
          <h2 className="label">Its statement</h2>
          {p.statement.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">It has not asked to pay anyone yet.</p> : (
            <ul className="ledger mt-3 border-t-[1.5px] border-ink">
              {p.statement.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-[.93rem]"><span className="mono mr-2 text-[.7rem] text-ink-3">{stamp(s.createdAt)}</span><span className="mono text-[.78rem] break-all">{s.payee}</span> <span className="text-xs text-ink-2">· {s.purpose}{s.memo ? ` · ${s.memo}` : ""}</span></p>
                    <Figure minor={s.amountMinor} className={`shrink-0 text-[1.2rem] ${s.status === "DENIED" ? "text-ink-3 line-through decoration-red decoration-2" : ""}`} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><SpendStamp status={s.status} />{s.reasons.length > 0 && <span className="mono text-[.7rem] text-red">{s.reasons.map((r) => r.code).join(" · ")}</span>}{s.hasReceipt && <Link className="link text-[.78rem]" href={`/r/${s.id}`}>receipt →</Link>}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        <section className="sheet sheet-lift p-5 sm:p-6" data-testid="check">
          <p className="label">Know your agent</p>
          <h2 className="title mt-2 text-[1.7rem]">Is it good for the money?</h2>
          <p className="mt-2 text-sm text-ink-2">You are a payee this agent wants to hire. Before you do any work, ask the gateway. It checks the agent's key, who stands behind it, and asks PayPal whether the hold is still there.</p>
          {p.demo ? (
            <form onSubmit={check} className="mt-5 space-y-5">
              <label className="label block">You are (payee's PayPal email)<input className="field mono mt-1 !text-[.9rem]" value={ask.payee} onChange={(e) => setAsk({ ...ask, payee: e.target.value })} required /></label>
              <div className="grid grid-cols-2 gap-x-6">
                <label className="label block">For (USD)<input className="field figure mt-1 !text-[1.6rem]" value={ask.amount} onChange={(e) => setAsk({ ...ask, amount: e.target.value })} inputMode="decimal" required /></label>
                <label className="label block">Purpose<input className="field mt-1" value={ask.purpose} onChange={(e) => setAsk({ ...ask, purpose: e.target.value })} required /></label>
              </div>
              <button className="btn btn-ink w-full" disabled={busy}>{busy ? "Asking the gateway and PayPal…" : "Ask the gateway"}</button>
              <p className="text-xs text-ink-3">This is a built-in demo agent, so this server signs the introduction for it. The answer comes from the public endpoint any payee would call.</p>
            </form>
          ) : (
            <div className="mt-4 space-y-2 text-sm text-ink-2">
              <p>This agent keeps its own key, so only it can introduce itself. It runs:</p>
              <pre className="code overflow-x-auto p-3 text-[.72rem]">npx tsx scripts/agent.ts hello --as {p.label} \{"\n"}  --payee you@example.com --amount 45 --purpose translation</pre>
              <p>and you check the token it gives you:</p>
              <pre className="code overflow-x-auto p-3 text-[.72rem]">npx tsx scripts/agent.ts check &lt;token&gt;</pre>
            </div>
          )}
          {err && <p role="alert" className="mt-3 text-sm text-red">{err}</p>}
        </section>

        {answer && (
          <section className="sheet sheet-lift enter relative rotate-[.6deg] p-5 sm:p-6" data-testid="standing" aria-live="polite">
            <Stamp tone={answer.s.good ? "green" : "red"} size="lg" land className="absolute -top-4 right-3">{answer.s.good ? "Good" : "Not good"}</Stamp>
            <p className="micro">Statement of standing</p>
            <p className="title mt-2 max-w-[17rem] text-xl">{answer.s.good ? <>Good for <span className="money">{usd(answer.s.ask.amount)}</span> to {answer.s.ask.payee}</> : <>Would not pay <span className="money">{usd(answer.s.ask.amount)}</span> to {answer.s.ask.payee}</>}</p>
            <ul className="mt-4 space-y-1.5 text-[.88rem]">
              <li className="leader"><span className="text-ink-2">Agent</span><i /><span className="mono text-[.78rem]">{answer.s.agentLabel} · {answer.s.account}</span></li>
              <li className="leader"><span className="text-ink-2">Controls its key</span><i /><span className={`mono text-[.78rem] ${answer.s.reasons.some((r) => r.code === "NOT_THE_HOLDER") ? "text-red" : "text-green"}`}>{answer.s.reasons.some((r) => r.code === "NOT_THE_HOLDER") ? "not proved" : "proved"}</span></li>
              <li className="leader"><span className="text-ink-2">Stands behind it</span><i /><span className="mono text-[.78rem]">{answer.s.sponsors.map((x) => x.label).join(" → ")}</span></li>
              <li className="leader"><span className="text-ink-2">PayPal hold</span><i /><span className="mono text-[.78rem]">{answer.s.paypal.status ?? "not confirmed"}{answer.s.paypal.unusedMinor !== null ? ` · ${usd(answer.s.paypal.unusedMinor)} unused` : ""}</span></li>
              <li className="leader"><span className="text-ink-2">Authorization</span><i /><span className="mono text-[.78rem]">{answer.s.paypal.authorizationId ?? "none"}</span></li>
              {answer.s.good && <li className="leader"><span className="text-ink-2">Could pay you up to</span><i /><span className="mono text-[.78rem]">{usd(answer.s.availableMinor)} in one payment</span></li>}
              <li className="leader"><span className="text-ink-2">Valid until</span><i /><span className="mono text-[.78rem]">{new Date(answer.s.validUntil).toISOString().slice(11, 19)} UTC</span></li>
            </ul>
            {answer.s.reasons.length > 0 && <ul className="mono mt-3 space-y-0.5 border-t border-rule pt-3 text-[.72rem] leading-snug text-red">{answer.s.reasons.map((r, i) => <li key={i}><b>{r.code}</b> · {r.detail}</li>)}</ul>}
            <p className="mt-4 flex items-center gap-2 border-t border-dashed border-ink pt-3 text-xs text-ink-2">
              <span className="text-blue"><Sigil k={answer.s.gateway} size={26} /></span>
              <span>Signed by the gateway <span className="mono">{fingerprint(answer.s.gateway)}</span>. <b className={answer.signed ? "text-green" : "text-red"}>{answer.signed ? "Signature checked in your browser." : "Signature INVALID."}</b> Nothing was reserved and no money moved.</span>
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
