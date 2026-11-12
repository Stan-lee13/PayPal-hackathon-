"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/poll";
import { Figure, Stamp, usd } from "@/components/stationery";

type Books = {
  mode: string;
  accounts: Array<{ agent: string; account: string; label: string; owner: string; mode: "settle" | "hold"; balanceMinor: number; frozen: boolean; perPaymentMinor: number | null }>;
  totals: { accounts: number; holding: number; balancesMinor: number; capturedInMinor: number; paidOutMinor: number; refundedMinor: number; bookTransfers: number; bookTransferredMinor: number };
  checks: Array<{ name: string; ok: boolean }>;
  reserves: { owed: { balancesMinor: number; refundsDueMinor: number; totalMinor: number; atPayPalsTimeMinor: number }; paypal: { availableMinor: number; asOf: string | null } | null; covered: boolean | null; surplusMinor: number | null };
};
type Statement = { paypalLines: number; ours: number; listed: number; differs: number; notListedYet: number; otherActivity: number; ok: boolean; from: string; matches: Array<{ paypalId: string; what: string; spend: string; amountMinor: number; listedMinor: number | null; verdict: string }> };
const hm = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`;

export function BankView() {
  const [d, setD] = useState<Books | null>(null);
  const [st, setSt] = useState<Statement | "asking" | "failed" | null>(null);
  const compare = async () => { setSt("asking"); const r = await api("/api/bank/statement"); setSt(r.ok ? r.json : "failed"); };
  const load = useCallback(async () => {
    await api("/api/demo/counterparty");
    const r = await api("/api/bank");
    if (r.ok) setD(r.json);
  }, []);
  usePoll(load, 4000);

  if (!d) return <p className="label py-10">Opening the books…</p>;
  const t = d.totals;
  const sound = d.checks.every((c) => c.ok);

  return (
    <div className="space-y-12">
      <header className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="label">The books</p>
          <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.6rem)]">Accounts for agents, <em>on PayPal&rsquo;s rails.</em></h1>
        </div>
        <p className="text-ink-2">An agent&rsquo;s account can keep what the agent earns. Money comes in as a capture from a payer&rsquo;s PayPal hold. It moves between agents here, on their signatures, with no PayPal call. It leaves through a PayPal payout. This page is the whole ledger added up.</p>
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-x-8 gap-y-8 border-y-[1.5px] border-ink py-7 lg:grid-cols-4" data-testid="bank-totals">
        <div><Figure minor={t.balancesMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-blue" /><p className="label mt-2">Held for agents now</p><p className="mt-1 text-xs text-ink-2">{t.holding} account{t.holding === 1 ? "" : "s"} that keep a balance</p></div>
        <div><Figure minor={t.capturedInMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-green" /><p className="label mt-2">Paid in</p><p className="mt-1 text-xs text-ink-2">captured from payers&rsquo; PayPal holds</p></div>
        <div><Figure minor={t.bookTransferredMinor} className="text-[clamp(2rem,4.2vw,3rem)]" /><p className="label mt-2">Moved agent to agent</p><p className="mt-1 text-xs text-ink-2">{t.bookTransfers} transfer{t.bookTransfers === 1 ? "" : "s"}, no PayPal call</p></div>
        <div><Figure minor={t.paidOutMinor} className="text-[clamp(2rem,4.2vw,3rem)] text-ink-3" /><p className="label mt-2">Paid out</p><p className="mt-1 text-xs text-ink-2">PayPal payouts and withdrawals to owners</p></div>
      </section>

      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section data-testid="bank-accounts">
          <h2 className="label">Accounts</h2>
          {d.accounts.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">No agent has opened an account yet.</p> : (
            <ul className="ledger mt-3 border-t-[1.5px] border-ink">
              {d.accounts.map((a) => (
                <li key={a.agent} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[.98rem]"><Link className="title link" href={`/a/${a.agent}`}>{a.label}</Link> <span className="text-xs text-ink-2">· answers for it: {a.owner}</span></p>
                    <p className="mono mt-0.5 text-[.7rem] text-ink-3">acct:{a.account.toLowerCase()} · {a.mode === "hold" ? "keeps its income" : "income paid straight out"}{a.perPaymentMinor !== null ? ` · max ${usd(a.perPaymentMinor)} a payment` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {a.frozen && <Stamp tone="red">Frozen</Stamp>}
                    <Figure minor={a.balanceMinor} className={`text-[1.45rem] ${a.mode === "hold" ? "" : "text-ink-3"}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <section className="sheet sheet-lift relative p-5 sm:p-6" data-testid="bank-checks">
            <Stamp tone={sound ? "green" : "red"} className="absolute -top-3.5 right-4">{sound ? "Books balance" : "Out of balance"}</Stamp>
            <p className="label">Do the books add up?</p>
            <ul className="mt-4 space-y-2.5 text-[.9rem]">
              {d.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2.5"><span className={`mono mt-0.5 text-[.78rem] ${c.ok ? "text-green" : "text-red"}`}>{c.ok ? "✓" : "✗"}</span><span>{c.name}</span></li>
              ))}
            </ul>
            <p className="mono mt-4 border-t border-dashed border-ink pt-3 text-[.72rem] leading-relaxed text-ink-2">{usd(t.capturedInMinor)} in − {usd(t.paidOutMinor)} out{t.refundedMinor > 0 ? ` − ${usd(t.refundedMinor)} refunded` : ""} = {usd(t.balancesMinor)} held</p>
          </section>

          <section className="sheet sheet-lift relative p-5 sm:p-6" data-testid="bank-reserves">
            <Stamp tone={d.reserves.covered === null ? "grey" : d.reserves.covered ? "blue" : "red"} className="absolute -top-3.5 right-4">{d.reserves.covered === null ? "PayPal not asked" : d.reserves.covered ? "Covered at PayPal" : "Not covered"}</Stamp>
            <p className="label">Is the money really there?</p>
            <dl className="mt-4 space-y-2 text-[.92rem]">
              <div className="leader"><dt>Owed to agents</dt><i /><dd className="money">{usd(d.reserves.owed.balancesMinor)}</dd></div>
              {d.reserves.owed.refundsDueMinor > 0 && <div className="leader"><dt>Refunds due to owners</dt><i /><dd className="money">{usd(d.reserves.owed.refundsDueMinor)}</dd></div>}
              <div className="leader"><dt>PayPal says the account holds</dt><i /><dd className="money text-blue">{d.reserves.paypal ? usd(d.reserves.paypal.availableMinor) : "—"}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-2">
              {d.reserves.paypal
                ? <>The second figure is not ours: it is the balance PayPal&rsquo;s Reporting API gives for the gateway&rsquo;s account{d.reserves.paypal.asOf ? `, as of ${hm(d.reserves.paypal.asOf)}` : ""}. It is compared with what was owed at that same moment ({usd(d.reserves.owed.atPayPalsTimeMinor)}), taken from the ledger.{d.mode === "sandbox" ? " On the sandbox this account also holds test money from earlier runs, so it covers many times over." : ""}</>
                : "PayPal could not be asked for the account's balance just now."}
            </p>
          </section>

          <section className="sheet p-5 sm:p-6" data-testid="bank-statement">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label">PayPal&rsquo;s own statement</p>
              <button type="button" className="btn btn-sm" onClick={compare} disabled={st === "asking"}>{st === "asking" ? "Asking PayPal…" : "Compare with PayPal"}</button>
            </div>
            {st === null && <p className="mt-3 text-xs leading-relaxed text-ink-2">Every capture and payout recorded here, looked up in PayPal&rsquo;s statement of the account (Transaction Search): a second source, separate from the calls that moved the money.</p>}
            {st === "failed" && <p className="mt-3 text-sm text-red" role="alert">PayPal could not be asked for its statement just now.</p>}
            {st && typeof st === "object" && (
              <div className="mt-3" aria-live="polite">
                <p className="text-[.92rem]"><b className={st.ok ? "text-green" : "text-red"}>{st.ok ? "No disagreement." : `${st.differs} record${st.differs === 1 ? "" : "s"} disagree.`}</b> {st.listed} of {st.ours} of our records are on PayPal&rsquo;s statement with the same amount{st.notListedYet > 0 ? `; ${st.notListedYet} not listed yet (PayPal's statement can lag by up to three hours)` : ""}.</p>
                <p className="mono mt-2 text-[.68rem] leading-relaxed text-ink-3">PayPal lists {st.paypalLines} line{st.paypalLines === 1 ? "" : "s"} since {hm(st.from)} on {new Date(st.from).toISOString().slice(5, 10)}; {st.otherActivity} are not from this ledger.</p>
                {st.matches.length > 0 && (
                  <ul className="mono mt-3 max-h-56 space-y-1 overflow-y-auto border-t border-rule pt-2 text-[.7rem] leading-snug">
                    {st.matches.slice(0, 40).map((m) => <li key={`${m.what}${m.paypalId}`} className="leader"><span>{m.what} {m.paypalId}</span><i /><span className={m.verdict === "listed" ? "text-green" : m.verdict === "amount differs" ? "text-red" : "text-ink-3"}>{usd(m.amountMinor)} · {m.verdict}</span></li>)}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section className="text-sm text-ink-2">
            <h2 className="label">What this is and is not</h2>
            <p className="mt-2">This is the mechanics of accounts for AI agents, running on the PayPal {d.mode === "sandbox" ? "sandbox" : "simulator"}. It is not a licensed bank. Keeping balances for others is regulated; a real deployment would hold these funds with a licensed partner.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
