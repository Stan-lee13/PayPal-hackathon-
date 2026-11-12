"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/poll";
import { fingerprint, signAccept, signRead, signRevoke, type KeyPair } from "@/lib/envelope/core";
import { principalKey } from "@/lib/principal-key";
import { Figure, Meter, Sigil, SpendStamp, Stamp, usd } from "@/components/stationery";

type AgentRow = { blockId: string; rootId: string; rootTitle: string; depth: number; key: string; label: string; account: string; under: string[]; limitMinor: number; spentMinor: number; setAsideMinor: number; leftMinor: number; refused: number; state: "LIVE" | "REVOKED" | "CLOSED" | "EXPIRED" };
type Activity = { id: string; rootId: string; at: string; agent: string; payee: string; who: string | null; purpose: string; amountMinor: number; status: string; reasons: string[]; captureId: string | null; payoutBatchId: string | null; payoutStatus: string | null; hasReceipt: boolean };
type Data = {
  principal: string; mode: string; ownerName: string;
  totals: { envelopes: number; open: number; heldNowMinor: number; spentMinor: number; setAsideMinor: number; releasedMinor: number; payments: number; refused: number; agents: number };
  envelopes: Array<{ id: string; title: string; status: string; limitMinor: number; capturedMinor: number; releasedMinor: number | null; authorizationId: string | null; createdAt: string }>;
  agents: AgentRow[];
  approvals: Array<{ id: string; rootId: string; rootTitle: string; agent: string; payee: string; who: string | null; purpose: string; memo: string; agentNote: string | null; amountMinor: number; expiresAt: string }>;
  payees: Array<{ payee: string; who: string | null; key: string | null; owner: string | null; totalMinor: number; payments: number }>;
  activity: Activity[];
};
type Books = { checked: number; matched: number; matchedMinor: number; mode: string; at: string; results: Array<{ id: string; ok: boolean; failed: string[] }> };

const STATE: Record<AgentRow["state"], "green" | "red" | "grey" | "amber"> = { LIVE: "green", REVOKED: "red", CLOSED: "grey", EXPIRED: "amber" };
const when = (iso: string) => `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${new Date(iso).toISOString().slice(11, 16)}`.replace(/ /g, " ");

/** The owner's control room: every envelope sealed with this browser's key, and every agent under them. */
export function TreasuryView() {
  const [me, setMe] = useState<KeyPair | null | undefined>(undefined);
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [books, setBooks] = useState<Books | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (key: KeyPair) => {
    const r = await api(`/api/treasury/${key.publicKey}`, { method: "POST", body: { signed: await signRead(key, "treasury", key.publicKey) } });
    setD(r.ok ? r.json : null);
  }, []);
  useEffect(() => { void principalKey(false).then((k) => { setMe(k); if (!k) setD(null); }); }, []);
  usePoll(async () => { if (me) await load(me); }, 4000, me?.publicKey);

  async function revoke(a: AgentRow) {
    if (!me) return;
    setBusy(a.blockId); setErr(null);
    try {
      const r = await api("/api/gateway/revoke", { body: { signed: await signRevoke(me, a.blockId) } });
      if (!r.ok) setErr(r.json.error ?? "Couldn't revoke.");
      await load(me);
    } finally { setBusy(null); }
  }
  async function decide(id: string, decline: boolean) {
    if (!me) return;
    setBusy(id); setErr(null);
    try {
      const r = await api("/api/gateway/accept", { body: { signed: await signAccept(me, id, { decline, note: decline ? "Declined by the owner." : "Approved by the owner." }) } });
      if (!r.ok && r.status !== 409) setErr(r.json.error ?? "Couldn't record your decision.");
      await load(me);
    } finally { setBusy(null); }
  }
  async function reconcile() {
    if (!me) return;
    setBusy("books"); setErr(null);
    try {
      const r = await api(`/api/treasury/${me.publicKey}/reconcile`, { method: "POST", body: { signed: await signRead(me, "treasury", me.publicKey) } });
      if (r.ok) setBooks(r.json); else setErr(r.json.error ?? "Couldn't reconcile.");
    } finally { setBusy(null); }
  }
  function exportCsv() {
    if (!d) return;
    const rows = [["time_utc", "envelope", "agent", "payee", "purpose", "amount_usd", "status", "paypal_capture", "paypal_payout_batch", "payout_status", "refused_for"], ...d.activity.map((x) => [x.at, x.rootId, x.agent, x.payee, x.purpose, (x.amountMinor / 100).toFixed(2), x.status, x.captureId ?? "", x.payoutBatchId ?? "", x.payoutStatus ?? "", x.reasons.join(" ")])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "envelope-treasury.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (d === undefined) return <p className="label py-10">Opening the books…</p>;
  if (!d) return (
    <div className="sheet mx-auto max-w-xl p-8 text-center">
      <p className="label">Treasury</p>
      <h1 className="display mt-3 text-4xl">Nothing sealed yet.</h1>
      <p className="mt-3 text-ink-2">The treasury shows every envelope sealed with this browser&rsquo;s key, the agents under them, and where the money went. Seal one to begin.</p>
      <Link className="btn btn-ink mt-6" href="/console">Seal an envelope →</Link>
    </div>
  );
  const t = d.totals;
  const groups = d.envelopes.map((e) => ({ e, agents: d.agents.filter((a) => a.rootId === e.id) }));

  return (
    <div className="space-y-12">
      <header className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="label">Treasury · {d.ownerName} <span className="normal-case tracking-normal">{fingerprint(d.principal)}</span></p>
          <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.6rem)]">Everything your agents can touch, <em>and nothing else.</em></h1>
        </div>
        <p className="text-ink-2">Each figure is the sum of PayPal authorizations you sealed with this key and the captures your agents made from them. You hold the only key that can revoke an agent or close an envelope.</p>
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-x-8 gap-y-8 border-y-[1.5px] border-ink py-7 lg:grid-cols-4" data-testid="totals">
        <div><Figure minor={t.heldNowMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-blue" /><p className="label mt-2">Held by PayPal now</p><p className="mt-1 text-xs text-ink-2">authorized, not charged · {t.open} open envelope{t.open === 1 ? "" : "s"}</p></div>
        <div><Figure minor={t.spentMinor} className="text-[clamp(2rem,4.2vw,3rem)]" /><p className="label mt-2">Spent by agents</p><p className="mt-1 text-xs text-ink-2">{t.payments} payment{t.payments === 1 ? "" : "s"}, each a partial capture</p></div>
        <div><Figure minor={t.setAsideMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-amber" /><p className="label mt-2">Set aside</p><p className="mt-1 text-xs text-ink-2">promised to a payee, not yet paid</p></div>
        <div><Figure minor={t.releasedMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-ink-3" /><p className="label mt-2">Released back</p><p className="mt-1 text-xs text-ink-2">voided when envelopes were closed</p></div>
      </section>

      {d.approvals.length > 0 && (
        <section data-testid="approvals" aria-live="polite">
          <h2 className="title text-2xl">Waiting for your signature</h2>
          <p className="mt-1 text-sm text-ink-2">Payments over the amount you asked to sign for. The agent cannot pay them; the money is set aside until you decide or the time runs out.</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {d.approvals.map((a) => (
              <li key={a.id} className="sheet sheet-lift border-l-[5px] !border-l-amber p-5">
                <p className="flex items-baseline justify-between gap-3"><span className="title text-[1.15rem]">{a.agent} <span className="text-ink-3">→</span> {a.who ?? <span className="mono text-[.82rem]">{a.payee}</span>}</span><Figure minor={a.amountMinor} className="text-[1.6rem]" /></p>
                <p className="mt-1 text-sm text-ink-2">{a.purpose}{a.memo ? ` · ${a.memo}` : ""} · <Link className="underline decoration-dotted underline-offset-2" href={`/e/${a.rootId}`}>{a.rootTitle}</Link> · held until {when(a.expiresAt)} UTC</p>
                {a.agentNote && <p className="mt-2 font-serif text-[.92rem] italic leading-snug text-ink-2">Agent: “{a.agentNote}”</p>}
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className="btn btn-ink btn-sm" disabled={Boolean(busy)} onClick={() => decide(a.id, false)}>{busy === a.id ? "Signing…" : "Sign & pay"}</button>
                  <button type="button" className="btn btn-red btn-sm" disabled={Boolean(busy)} onClick={() => decide(a.id, true)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section data-testid="agents">
          <div className="flex items-end justify-between gap-3"><h2 className="title text-2xl">Agents under your signature</h2><p className="micro">{t.agents} agent{t.agents === 1 ? "" : "s"} · {t.refused} request{t.refused === 1 ? "" : "s"} refused</p></div>
          {groups.map(({ e, agents }) => (
            <div key={e.id} className="mt-6">
              <p className="flex flex-wrap items-baseline justify-between gap-2 border-b-[1.5px] border-ink pb-1.5">
                <Link href={`/e/${e.id}`} className="title text-[1.1rem] underline decoration-dotted underline-offset-4">{e.title}</Link>
                <span className="mono text-[.7rem] text-ink-2">{usd(e.capturedMinor)} of {usd(e.limitMinor)} · hold {e.authorizationId} · {e.status === "ACTIVE" ? "open" : "closed"}</span>
              </p>
              <ul className="ledger">
                {agents.map((a) => (
                  <li key={a.blockId} className="py-3" style={{ paddingLeft: `${a.depth * 1.4}rem` }}>
                    <div className="flex items-center gap-3">
                      <Link href={`/a/${a.key}`} className="shrink-0 text-blue" title="Passport"><Sigil k={a.key} size={34} /></Link>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span><Link href={`/a/${a.key}`} className="title text-[1.02rem]">{a.label}</Link> <span className="mono ml-1 text-[.66rem] text-ink-3">{a.account}{a.under.length ? ` · under ${a.under[a.under.length - 1]}` : " · sealed by you"}</span></span><span className="mono text-[.76rem]">{usd(a.spentMinor)} of {usd(a.limitMinor)}{a.setAsideMinor ? ` · ${usd(a.setAsideMinor)} set aside` : ""}</span></p>
                        <div className="mt-1.5"><Meter spent={a.spentMinor} held={a.setAsideMinor} of={a.limitMinor} label={`${usd(a.spentMinor)} of ${usd(a.limitMinor)} spent`} /></div>
                      </div>
                      <div className="flex w-[7.2rem] shrink-0 flex-col items-end gap-1.5">
                        <Stamp tone={STATE[a.state]}>{a.state === "LIVE" ? `${usd(a.leftMinor)} left` : a.state.toLowerCase()}</Stamp>
                        {a.refused > 0 && <span className="mono text-[.66rem] text-red">{a.refused} refused</span>}
                        {a.state === "LIVE" && a.depth > 0 && <button type="button" className="btn btn-sm btn-red !min-h-[28px] !px-2.5 !text-[.72rem]" disabled={Boolean(busy)} onClick={() => revoke(a)}>{busy === a.blockId ? "Revoking…" : "Revoke"}</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {err && <p role="alert" className="mt-3 text-sm text-red">{err}</p>}
        </section>

        <aside className="space-y-10">
          <section className="sheet sheet-lift p-5 sm:p-6" data-testid="books">
            <div className="flex items-start justify-between gap-3"><h2 className="label">The books</h2>{books && <Stamp tone={books.matched === books.checked ? "green" : "red"} land>{books.matched} of {books.checked} match PayPal</Stamp>}</div>
            <p className="mt-2 text-sm text-ink-2">Ask PayPal for every capture and payout by id and compare them with what the gateway recorded.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className="btn btn-ink" disabled={Boolean(busy) || t.payments === 0} onClick={reconcile}>{busy === "books" ? "Asking PayPal…" : "Reconcile with PayPal"}</button>
              <button type="button" className="btn" disabled={d.activity.length === 0} onClick={exportCsv}>Export ledger (CSV)</button>
            </div>
            {books && <p className="mono mt-3 text-[.72rem] text-ink-2">{usd(books.matchedMinor)} matched across {books.matched} payment{books.matched === 1 ? "" : "s"} · {books.mode === "sandbox" ? "PayPal sandbox" : `PayPal ${books.mode}`} · {when(books.at)} UTC{books.results.filter((r) => !r.ok).map((r) => ` · ${r.id}: ${r.failed.join("; ")}`).join("")}</p>}
          </section>

          <section data-testid="payees">
            <h2 className="label">Where the money went</h2>
            {d.payees.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">Nothing has been paid yet.</p> : (
              <ul className="mt-3 space-y-2 border-t-[1.5px] border-ink pt-3 text-[.95rem]">
                {d.payees.map((p) => (
                  <li key={p.payee} className="leader">
                    <span>{p.who && p.key ? <><Link href={`/a/${p.key}`} className="title underline decoration-dotted underline-offset-2">{p.who}</Link> <span className="mono text-[.68rem] text-ink-3">{p.owner}&rsquo;s agent</span></> : <span className="mono text-[.8rem]">{p.payee}</span>}</span><i /><span className="mono text-[.82rem]">{usd(p.totalMinor)} · {p.payments}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-testid="activity">
            <h2 className="label">Latest requests</h2>
            <ul className="ledger mt-3 border-t-[1.5px] border-ink">
              {d.activity.slice(0, 10).map((x) => (
                <li key={x.id} className="py-2.5">
                  <p className="flex items-baseline justify-between gap-3 text-[.9rem]"><span className="min-w-0"><span className="mono mr-2 text-[.68rem] text-ink-3">{when(x.at)}</span><span className="title">{x.agent}</span> <span className="text-ink-3">→</span> {x.who ?? <span className="mono text-[.74rem] break-all">{x.payee}</span>}</span><span className={`mono shrink-0 text-[.82rem] ${x.status === "DENIED" ? "text-ink-3 line-through decoration-red" : ""}`}>{usd(x.amountMinor)}</span></p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><SpendStamp status={x.status} />{x.reasons.length > 0 && <span className="mono text-[.66rem] text-red">{x.reasons.join(" · ")}</span>}{x.hasReceipt && <Link className="link text-[.76rem]" href={`/r/${x.id}`}>receipt →</Link>}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
