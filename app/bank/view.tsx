"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Figure, Stamp, usd } from "@/components/stationery";

type Books = {
  mode: string;
  accounts: Array<{ agent: string; account: string; label: string; owner: string; mode: "settle" | "hold"; balanceMinor: number; frozen: boolean; perPaymentMinor: number | null }>;
  totals: { accounts: number; holding: number; balancesMinor: number; capturedInMinor: number; paidOutMinor: number; bookTransfers: number; bookTransferredMinor: number };
  checks: Array<{ name: string; ok: boolean }>;
};

export function BankView() {
  const [d, setD] = useState<Books | null>(null);
  const load = useCallback(async () => {
    await api("/api/demo/counterparty");
    const r = await api("/api/bank");
    if (r.ok) setD(r.json);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => clearInterval(t);
  }, [load]);

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
            <p className="mono mt-4 border-t border-dashed border-ink pt-3 text-[.72rem] leading-relaxed text-ink-2">{usd(t.capturedInMinor)} in − {usd(t.paidOutMinor)} out = {usd(t.balancesMinor)} held</p>
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
