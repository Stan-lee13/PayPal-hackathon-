"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/poll";
import { Sigil, usd } from "@/components/stationery";

type CardRow = {
  id: string; number: string; label: string; state: "ACTIVE" | "USED_UP" | "CANCELLED" | "EXPIRED";
  holder: { key: string; label: string; owner: string | null; frozen: boolean };
  merchant: { key: string; label: string; account: string | null };
  perChargeMinor: number; maxCharges: number; charges: number; chargedMinor: number; notAfter: string; attempts: number;
};
type Data = { mode: string; cards: CardRow[]; accounts: Array<{ agent: string; label: string; owner: string; balanceMinor: number; keepsIncome: boolean; demo: boolean }> };
const STATE: Record<CardRow["state"], string> = { ACTIVE: "Active", USED_UP: "Used up", CANCELLED: "Cancelled", EXPIRED: "Expired" };

/** Every card agents have issued on this gateway, and the way to get one when there is none yet. */
export function CardsView() {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(async () => { const r = await api<Data>("/api/cards"); if (r.ok) setD(r.json); }, []);
  usePoll(load, 5000);
  if (!d) return <p className="label py-10">Looking for cards…</p>;
  // the built-in earning agent first: its page has the buttons
  const earners = d.accounts.filter((a) => a.keepsIncome).sort((a, b) => Number(b.demo) - Number(a.demo));
  const demo = earners.find((a) => a.demo);

  return (
    <div className="space-y-12">
      <header className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="label">Cards</p>
          <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.6rem)]">A card an agent issues, <em>for one merchant.</em></h1>
        </div>
        <p className="text-ink-2">A Xenoncard is an agent&rsquo;s signed permission for one merchant to charge its balance: so much a time, so many times, until a date. Only that merchant&rsquo;s key can charge it, so the number is nothing to keep secret. The money is the agent&rsquo;s own balance, which came from a PayPal capture.</p>
      </header>

      {d.cards.length ? (
        <section aria-label="Cards issued" data-testid="cards-list">
          <h2 className="label">Issued on this gateway · {d.cards.length}</h2>
          <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {d.cards.map((c) => (
              <li key={c.id}>
                <Link href={`/a/${c.holder.key}#cards`} className="block" aria-label={`${c.holder.label}'s card for ${c.merchant.label}`}>
                  <div className={`xcard ${c.state === "ACTIVE" ? "" : "xcard-dead"}`}>
                    <Sigil k={c.holder.key} size={210} className="pointer-events-none absolute -right-12 -top-10 opacity-[.13]" />
                    <div className="relative flex items-start justify-between"><p className="micro !text-[#C9C2B2]">Xenoncard · for agents</p><span className={`micro rounded-[3px] border px-1.5 py-[3px] ${c.state === "ACTIVE" ? "border-[#8FD3A8] !text-[#8FD3A8]" : "border-[#E5A49A] !text-[#E5A49A]"}`}>{STATE[c.state]}</span></div>
                    <p className="mono relative mt-7 text-[1.12rem] tracking-[.14em]">{c.number}</p>
                    <div className="relative mt-5 flex items-end justify-between gap-3">
                      <div className="min-w-0"><p className="micro !text-[#C9C2B2]">Locked to</p><p className="title truncate text-[1.15rem] leading-tight">{c.merchant.label}</p></div>
                      <div className="text-right"><p className="micro !text-[#C9C2B2]">Held by</p><p className="mono text-[.74rem]">{c.holder.label}</p></div>
                    </div>
                  </div>
                </Link>
                <p className="mt-3 text-[.86rem] text-ink-2">{usd(c.perChargeMinor)} a charge · {c.charges} of {c.maxCharges} used · {usd(c.chargedMinor)} charged so far{c.attempts > c.charges ? ` · ${c.attempts - c.charges} attempt${c.attempts - c.charges === 1 ? "" : "s"} declined` : ""}</p>
                <p className="mt-1 text-[.86rem]"><Link className="link" href={`/a/${c.holder.key}#cards`}>Open it on {c.holder.label}&rsquo;s page →</Link></p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="border-y-[1.5px] border-ink py-8" data-testid="cards-empty">
          <h2 className="title text-[1.5rem]">No agent here has issued a card yet.</h2>
          <p className="mt-2 max-w-2xl text-ink-2">A card is issued by an agent that has earned money and kept it. Three steps get you one in this {d.mode === "simulated" ? "copy" : "gateway"}:</p>
          <ol className="mt-5 grid gap-5 md:grid-cols-3">
            <li className="border-t border-rule pt-3"><p className="mono text-sm text-ink-3">01</p><p className="title mt-1 text-[1.1rem]">Seal an envelope</p><p className="mt-1 text-[.9rem] text-ink-2">Sign a budget; PayPal holds it.</p><Link className="link mt-2 inline-block text-[.9rem]" href="/console">Seal one →</Link></li>
            <li className="border-t border-rule pt-3"><p className="mono text-sm text-ink-3">02</p><p className="title mt-1 text-[1.1rem]">Let the agents pay</p><p className="mt-1 text-[.9rem] text-ink-2">On the envelope&rsquo;s page, press &ldquo;Run the launch&rdquo;. The translator agent is paid and keeps its income.</p></li>
            <li className="border-t border-rule pt-3"><p className="mono text-sm text-ink-3">03</p><p className="title mt-1 text-[1.1rem]">Open the earning agent</p><p className="mt-1 text-[.9rem] text-ink-2">On its page, under &ldquo;Its card&rdquo;, press &ldquo;Subscribe to Lexica Pro with its card&rdquo;. The card appears here.</p>{demo ? <Link className="link mt-2 inline-block text-[.9rem]" href={`/a/${demo.agent}#cards`} data-testid="cards-go-demo">Open {demo.label} →</Link> : null}</li>
          </ol>
        </section>
      )}

      <section aria-label="Agents that can issue a card" data-testid="cards-earners">
        <h2 className="label">Agents that can issue a card</h2>
        {earners.length ? (
          <ul className="ledger mt-3 border-t-[1.5px] border-ink">
            {earners.map((a) => (
              <li key={a.agent} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="text-[.98rem]"><span className="title">{a.label}</span> <span className="text-xs text-ink-2">· answers for it: {a.owner} · holds {usd(a.balanceMinor)}</span></p>
                {a.demo ? <Link className="btn btn-sm btn-ink" href={`/a/${a.agent}#cards`} data-testid="cards-issue-here">Issue a card on its page →</Link> : <Link className="btn btn-sm" href={`/a/${a.agent}`}>Its page →</Link>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">No agent keeps a balance here yet. An agent opens an account, earns from an envelope, and can then issue a card. <Link className="link" href="/bank">Accounts →</Link></p>}
        <p className="mt-4 text-[.84rem] text-ink-2">The built-in demo agent has buttons for this. An agent of your own issues a card by signing with its own key: <span className="mono text-[.76rem]">envelope_card_issue</span> over MCP, or <span className="mono text-[.76rem]">agent.issueCard()</span> in the SDK. <Link className="link" href="/developers">Developers →</Link></p>
        <p className="mt-2 text-xs text-ink-3">A Xenoncard works where the merchant has an account on this gateway. It is not a Visa, Mastercard or Verve card and cannot be typed into a checkout.</p>
      </section>
    </div>
  );
}
