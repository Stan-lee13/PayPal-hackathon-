"use client";

import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/poll";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fingerprint, verifyDetached, type Caps } from "@/lib/envelope/core";
import { Figure, Flap, Meter, Passport, Sigil, SpendStamp, Stamp, usd } from "@/components/stationery";

type Sponsor = { role: "owner" | "agent"; label: string; key: string };
type Account = { blockId: string; rootId: string; rootTitle: string; depth: number; label: string; openedBy: Sponsor; sponsors: Sponsor[]; caps: Caps; spentMinor: number; reservedMinor: number; availableMinor: number; state: "LIVE" | "REVOKED" | "CLOSED" | "EXPIRED"; issued: Array<{ blockId: string; label: string; key: string; limitMinor: number; revoked: boolean }>; openedAt: string };
type SpendT = { id: string; rootId: string; leafLabel: string; amountMinor: number; payee: string; purpose: string; memo: string; status: string; reasons: Array<{ code: string; detail: string }>; createdAt: string; hasReceipt: boolean; promiseExpiresAt: string | null };
type Profile = {
  key: string; account: string; label: string; firstSeenAt: string; mode: string; demo: boolean; bankDemo: boolean; accounts: Account[];
  receives: { payee: string; owner: { label: string; key: string }; settlesTo: string; openedAt: string; holds: boolean } | null;
  cards: CardT[];
  balance: { minor: number; frozen: boolean; perPaymentMinor: number | null; perDayMinor: number | null; ledger: Array<{ id: number; kind: string; ref: string; deltaMinor: number; balanceAfterMinor: number; counterparty: string | null; memo: string; at: string }> } | null;
  record: { payments: number; paidMinor: number; refused: number; refusedCodes: string[]; revoked: number; availableMinor: number; promisesKept: number; promisesLapsed: number; received: number; receivedMinor: number; setAsideForItMinor: number };
  statement: SpendT[]; incoming: SpendT[];
};
type CardT = {
  id: string; number: string; label: string; state: "ACTIVE" | "USED_UP" | "CANCELLED" | "EXPIRED";
  merchant: { key: string; label: string; account: string | null };
  perChargeMinor: number; maxCharges: number; everySeconds: number; notAfter: string; charges: number; chargedMinor: number;
  nextChargeFrom: string | null; cancelledBy: string | null;
  attempts: Array<{ id: string; at: string; amountMinor: number; status: string; reasons: string[]; memo: string; payoutBatchId: string | null; payoutStatus: string | null }>;
};
const CARD_STATE: Record<CardT["state"], { text: string; tone: "green" | "red" | "grey" | "amber" }> = { ACTIVE: { text: "Active", tone: "green" }, USED_UP: { text: "Ended itself", tone: "grey" }, CANCELLED: { text: "Cancelled", tone: "red" }, EXPIRED: { text: "Expired", tone: "amber" } };
const period = (s: number) => (s === 0 ? "none" : s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);
type Standing = { v: string; agent: string; agentLabel: string; account: string; sponsors: Sponsor[]; root: string; ask: { amount: number; currency: string; payee: string; purpose: string }; good: boolean; reasons: Array<{ code: string; detail: string }>; availableMinor: number; paypal: { mode: string; authorizationId: string | null; status: string | null; unusedMinor: number | null; honoredUntil?: string | null; authorizedUntil?: string | null }; issuedAt: string; validUntil: string; gateway: string; sig: string };

const STATE: Record<Account["state"], { text: string; tone: "green" | "red" | "grey" | "amber" }> = { LIVE: { text: "Live", tone: "green" }, REVOKED: { text: "Revoked", tone: "red" }, CLOSED: { text: "Closed", tone: "grey" }, EXPIRED: { text: "Expired", tone: "amber" } };
const ENTRY: Record<string, string> = { income: "Paid in from", transfer_in: "Received from", transfer_out: "Paid to", payout: "Paid out by PayPal to", withdrawal: "Withdrawn to its owner at", reversal: "Put back: payout failed to", refund: "Refunded to the payer, via", refund_reversal: "Put back: PayPal refused the refund to" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${new Date(iso).toISOString().slice(11, 16)}`.replace(/ /g, "\u00A0");

export function AgentView({ agentKey }: { agentKey: string }) {
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [ask, setAsk] = useState({ payee: "", amount: "", purpose: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ s: Standing; signed: boolean } | null>(null);
  const [ref, setRef] = useState<{ token: string; signed: boolean; asOf: string; gateway: string } | null>(null);
  async function getReference() {
    const r = await api(`/api/agents/${agentKey}/reference`);
    if (!r.ok) return;
    const { sig, ...body } = r.json.reference;
    setRef({ token: btoa(unescape(encodeURIComponent(JSON.stringify(r.json.reference)))), signed: await verifyDetached(r.json.reference.gateway, "envelope-reference/1", body, sig), asOf: r.json.reference.asOf, gateway: r.json.reference.gateway });
  }
  const seeded = useRef(false);

  const load = useCallback(async () => {
    const r = await api(`/api/agents/${agentKey}`);
    const j = r.json;
    if (!r.ok) { setMissing(j.error ?? "No such agent."); return; }
    setP(j);
    if (!seeded.current) {
      seeded.current = true;
      const live = (j as Profile).accounts.find((a) => a.state === "LIVE") ?? (j as Profile).accounts[0];
      if (live) setAsk({ payee: live.caps.payees?.[0] ?? "", purpose: live.caps.purposes?.[0] ?? "", amount: (Math.max(100, Math.min(live.caps.perPayment, live.availableMinor || live.caps.perPayment)) / 100).toFixed(2) });
    }
  }, [agentKey]);
  usePoll(load, 4000, agentKey);

  const [moving, setMoving] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ action?: string; narration: string; status: string; reasons: Array<{ code: string; meaning?: string; detail: string }> } | null>(null);
  async function bank(action: string) {
    setMoving(action); setMoved(null);
    try {
      const r = await api("/api/demo/bank", { body: { action } });
      setMoved(r.ok ? r.json : { action, narration: r.json.error ?? "That did not work.", status: "FAILED", reasons: [] });
      await load();
    } finally { setMoving(null); }
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const amountMinor = Math.round(Number(ask.amount) * 100);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new Error("Enter an amount.");
      // 1. the agent introduces itself (a demo agent's key is on this server; a real agent does this itself)
      const h = await api("/api/demo/hello", { body: { agent: agentKey, amountMinor, payee: ask.payee.trim(), purpose: ask.purpose.trim() } });
      const hj = h.json;
      if (!h.ok) throw new Error(hj.error ?? "The agent could not introduce itself.");
      // 2. the payee hands that introduction to the gateway, exactly as any outsider would
      const r = await api("/api/gateway/standing", { body: { hello: hj.hello } });
      const rj = r.json;
      if (!r.ok) throw new Error(rj.error ?? "The gateway refused.");
      // 3. and checks the gateway's signature here, in the browser
      const s = rj.standing as Standing;
      const { sig, ...body } = s;
      setAnswer({ s, signed: await verifyDetached(s.gateway, "envelope-standing/1", body, sig) });
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  const movedCard = Boolean(moved?.action?.startsWith("card-"));
  if (missing) return <p className="sheet p-6 text-sm">{missing} <Link className="link" href="/console">Back to the console</Link>.</p>;
  if (!p) return <p className="label py-10">Pulling the agent's file…</p>;
  const live = p.accounts.filter((a) => a.state === "LIVE");
  const best = live[0] ?? p.accounts[0];
  const standing = live.length > 0 ? { text: "In good standing", tone: "green" as const } : p.accounts.some((a) => a.state === "REVOKED") ? { text: "Revoked", tone: "red" as const } : p.receives ? { text: "Account open", tone: "green" as const } : { text: "No live envelope", tone: "grey" as const };
  const behind = best ? best.sponsors.map((s) => s.label) : p.receives ? [p.receives.owner.label] : [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <div className="space-y-9">
        <header>
          <p className="label">Agent on file</p>
          <h1 className="sr-only">{p.label}</h1>
          <div className="mt-3"><Passport k={p.key} label={p.label} sponsors={behind} state={standing} since={day(p.firstSeenAt)} /></div>
        </header>

        <section aria-label="Record" className="grid grid-cols-2 gap-x-6 gap-y-6 border-y-[1.5px] border-ink py-5 sm:grid-cols-4">
          {p.accounts.length > 0 && <>
            <div><Figure minor={p.record.availableMinor} className="text-[1.9rem] text-blue" /><p className="label mt-1.5">Can spend now</p></div>
            <div><Figure minor={p.record.paidMinor} className="text-[1.9rem]" /><p className="label mt-1.5">Paid so far</p></div>
            <div><p className="figure text-[1.9rem]">{p.record.payments}</p><p className="label mt-1.5">Payments</p></div>
            <div><p className={`figure text-[1.9rem] ${p.record.refused ? "text-red" : ""}`}>{p.record.refused}</p><p className="label mt-1.5">Refused</p></div>
          </>}
          {p.receives && <>
            <div><Figure minor={p.record.receivedMinor} className="text-[1.9rem] text-green" /><p className="label mt-1.5">Earned so far</p></div>
            {p.balance && <div data-testid="balance-figure"><Figure minor={p.balance.minor} className="text-[1.9rem] text-blue" /><p className="label mt-1.5">Balance now</p></div>}
            <div><p className="figure text-[1.9rem]">{p.record.received}</p><p className="label mt-1.5">Times paid</p></div>
            <div><Figure minor={p.record.setAsideForItMinor} className="text-[1.9rem] text-blue" /><p className="label mt-1.5">Set aside for it</p></div>
          </>}
          {(p.record.promisesKept > 0 || p.record.promisesLapsed > 0) && <div><p className="figure text-[1.9rem]">{p.record.promisesKept}<span className="text-ink-3">/{p.record.promisesKept + p.record.promisesLapsed}</span></p><p className="label mt-1.5">Promises kept</p></div>}
        </section>

        <section data-testid="reference" className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="label">A record it can take anywhere</h2>
            <p className="mt-1.5 text-sm text-ink-2">The figures above, signed by the gateway: payments settled, promises kept, requests refused, money earned. Facts only, no score. Anyone can check the signature without asking this site.</p>
            {ref && <p className="mt-2 text-xs text-ink-2">Signed {new Date(ref.asOf).toISOString().slice(11, 19)} UTC by the gateway <span className="mono">{fingerprint(ref.gateway)}</span>. <b className={ref.signed ? "text-green" : "text-red"}>{ref.signed ? "Signature checked in your browser." : "Signature INVALID."}</b></p>}
            {ref && <pre className="code mt-2 max-h-24 overflow-auto p-2.5 text-[.62rem] leading-snug break-all whitespace-pre-wrap">{ref.token}</pre>}
          </div>
          <button type="button" className="btn btn-sm" onClick={getReference}>{ref ? "Sign a fresh one" : "Get a signed reference"}</button>
        </section>

        {p.receives && (
          <section className="sheet p-5 sm:p-6" data-testid="receives">
            <div className="flex items-start justify-between gap-3"><h2 className="label">An account of its own</h2><Stamp tone="green">Can be paid</Stamp></div>
            <p className="mt-2 text-sm text-ink-2">Other agents pay this one by naming its account number on their envelope. The gateway captures from the payer&rsquo;s PayPal hold{p.receives.holds ? " and the money stays here as this agent\u2019s balance, to spend or send home." : " and PayPal pays out to its owner."}</p>
            <ul className="mt-4 space-y-1.5 text-[.88rem]">
              <li className="leader"><span className="text-ink-2">Pay it as</span><i /><span className="mono text-[.8rem]">{p.receives.payee}</span></li>
              <li className="leader"><span className="text-ink-2">Answers for it</span><i /><span className="mono text-[.78rem]">{p.receives.owner.label} · {fingerprint(p.receives.owner.key)}</span></li>
              <li className="leader"><span className="text-ink-2">{p.receives.holds ? "Withdraws to PayPal" : "Settles to PayPal"}</span><i /><span className="mono text-[.78rem]">{p.receives.settlesTo}</span></li>
              {p.balance && <li className="leader"><span className="text-ink-2">Most it may pay at once</span><i /><span className="mono text-[.78rem]">{p.balance.perPaymentMinor === null ? "no cap set" : `${usd(p.balance.perPaymentMinor)}, set by ${p.receives.owner.label}`}</span></li>}
              {p.balance && p.balance.perDayMinor !== null && <li className="leader"><span className="text-ink-2">Most it may spend in a day</span><i /><span className="mono text-[.78rem]">{usd(p.balance.perDayMinor)}, set by {p.receives.owner.label}</span></li>}
              <li className="leader"><span className="text-ink-2">Opened</span><i /><span className="mono text-[.78rem]">{day(p.receives.openedAt)}, signed by the agent and its owner</span></li>
            </ul>
          </section>
        )}

        {p.balance && (
          <section data-testid="balance">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="label">Its balance</h2>
                <p className="mt-1 leading-none"><Figure minor={p.balance.minor} className="text-[2.6rem] text-blue" /></p>
              </div>
              <Stamp tone={p.balance.frozen ? "red" : "green"}>{p.balance.frozen ? `Frozen by ${p.receives?.owner.label ?? "its owner"}` : "Open"}</Stamp>
            </div>
            <p className="mt-2 max-w-prose text-sm text-ink-2">Money this agent earned and kept. It moves only on the agent&rsquo;s own signature: to another agent&rsquo;s account at once, with no PayPal call, or out through a PayPal payout. Its owner can cap a payment and freeze the account. Every change is one line below, and no line can be written twice.</p>
            {p.bankDemo && (
              <div className="mt-4 flex flex-wrap gap-2" data-testid="bank-actions">
                <button type="button" className="btn btn-sm btn-ink" disabled={Boolean(moving)} onClick={() => bank("pay-proofreader")}>{moving === "pay-proofreader" ? "Signing…" : "Pay proofreader-agent $12"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving)} onClick={() => bank("withdraw")}>{moving === "withdraw" ? "Asking PayPal…" : "Withdraw $20 to its owner"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving)} onClick={() => bank("drain")}>{moving === "drain" ? "Signing…" : "Compromised: drain to a stranger"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving)} onClick={() => bank("refund")}>{moving === "refund" ? "Asking PayPal…" : "Give its last payment back"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving)} onClick={() => bank(p.balance!.frozen ? "unfreeze" : "freeze")}>{p.balance.frozen ? "Owner lifts the freeze" : "Owner freezes it"}</button>
              </div>
            )}
            {moved && !movedCard && (
              <p className="mt-3 text-sm" role="status" data-testid="bank-result">
                <b className={moved.status === "DENIED" || moved.status === "FAILED" ? "text-red" : "text-green"}>{moved.status === "DENIED" ? "Refused." : moved.status === "BOOKED" ? "Moved." : moved.status === "FROZEN" ? "Frozen." : moved.status === "OPEN" ? "Open again." : moved.status === "FAILED" ? "Failed." : moved.status === "PAID" ? "Paid by PayPal." : moved.status === "REFUNDED" ? "Refunded by PayPal." : moved.status === "PENDING" ? "Debited; PayPal will be asked again." : "Sent to PayPal."}</b> {moved.narration}
                {moved.reasons.length > 0 && <span className="mono mt-1 block text-[.72rem] text-red">{moved.reasons.map((r) => `${r.code} · ${r.detail}`).join("  ")}</span>}
              </p>
            )}
            {p.bankDemo && <p className="mt-2 text-xs text-ink-3">This is a built-in demo agent, so the demo signs for it and for its owner. A real agent signs with its own key: <span className="mono">npx tsx scripts/agent.ts transfer</span>.</p>}
            {p.balance.ledger.length === 0 ? <p className="mt-4 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">Nothing has been paid in yet.</p> : (
              <ul className="ledger mt-4 border-t-[1.5px] border-ink" data-testid="ledger">
                {p.balance.ledger.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <p className="min-w-0 text-[.9rem]"><span className="mono mr-2 text-[.7rem] text-ink-3">{stamp(l.at)}</span>{ENTRY[l.kind] ?? l.kind} <span className="title">{l.counterparty ?? "—"}</span>{l.memo && <span className="text-xs text-ink-2"> · {l.memo}</span>}{/^(sp|pr)_/.test(l.ref) && <> · <Link className="link text-xs" href={`/r/${l.ref}`}>receipt →</Link></>}</p>
                    <p className="shrink-0 text-right leading-tight"><span className={`figure text-[1.1rem] ${l.deltaMinor < 0 ? "" : "text-green"}`}>{l.deltaMinor < 0 ? "−" : "+"}{usd(Math.abs(l.deltaMinor))}</span><span className="mono block text-[.66rem] text-ink-3">{usd(l.balanceAfterMinor)}</span></p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-2">This balance is one line of the gateway&rsquo;s books. <Link className="link" href="/bank">All accounts, checked against PayPal&rsquo;s own balance and statement →</Link></p>
          </section>
        )}

        {p.balance && (p.bankDemo || p.cards.length > 0) && (
          <section data-testid="cards" id="cards" className="scroll-mt-6">
            <h2 className="label">Its card</h2>
            <p className="mt-1.5 max-w-prose text-sm text-ink-2">A Xenoncard is not a number to keep secret. It is this agent&rsquo;s signed permission for <b>one merchant</b> to charge its balance: so much a charge, so many charges, no more often than a billing period, and then it ends by itself. Only that merchant&rsquo;s key can charge it, so the card&rsquo;s details are worth nothing to anyone else. Nobody&rsquo;s bank card is handed to anyone.</p>
            {p.cards[0] && (() => {
              const c = p.cards[0]!;
              return (
                <div className="mt-4 grid items-center gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
                  <div className={`xcard ${c.state === "ACTIVE" ? "" : "xcard-dead"}`} data-testid="xenoncard">
                    <Sigil k={p.key} size={210} className="pointer-events-none absolute -right-12 -top-10 opacity-[.13]" />
                    <div className="relative flex items-start justify-between"><p className="micro !text-[#C9C2B2]">Xenoncard · for agents</p><span className={`micro rounded-[3px] border px-1.5 py-[3px] ${c.state === "ACTIVE" ? "border-[#8FD3A8] !text-[#8FD3A8]" : "border-[#E5A49A] !text-[#E5A49A]"}`}>{CARD_STATE[c.state].text}</span></div>
                    <p className="mono relative mt-7 text-[1.12rem] tracking-[.14em]">{c.number}</p>
                    <div className="relative mt-5 flex items-end justify-between gap-3">
                      <div className="min-w-0"><p className="micro !text-[#C9C2B2]">Locked to</p><p className="title truncate text-[1.15rem] leading-tight">{c.merchant.label}</p></div>
                      <div className="text-right"><p className="micro !text-[#C9C2B2]">Held by</p><p className="mono text-[.74rem]">{p.label}</p></div>
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-[.86rem]">
                    <li className="leader"><span className="text-ink-2">Per charge</span><i /><span className="mono text-[.78rem]">{usd(c.perChargeMinor)}</span></li>
                    <li className="leader"><span className="text-ink-2">Used</span><i /><span className="mono text-[.78rem]" data-testid="card-used">{c.charges} of {c.maxCharges} charges</span></li>
                    <li className="leader"><span className="text-ink-2">Period</span><i /><span className="mono text-[.78rem]">{period(c.everySeconds)}{p.bankDemo ? " (demo)" : ""}</span></li>
                    <li className="leader"><span className="text-ink-2">Until</span><i /><span className="mono text-[.78rem]">{stamp(c.notAfter)}</span></li>
                    <li className="leader"><span className="text-ink-2">Merchant key</span><i /><span className="mono text-[.78rem]">{fingerprint(c.merchant.key)}</span></li>
                    {c.nextChargeFrom && <li className="leader"><span className="text-ink-2">Next from</span><i /><span className="mono text-[.78rem]">{new Date(c.nextChargeFrom).toISOString().slice(11, 19)}</span></li>}
                  </ul>
                </div>
              );
            })()}
            {p.bankDemo && (
              <div className="mt-4 flex flex-wrap gap-2" data-testid="card-actions">
                <button type="button" className="btn btn-sm btn-ink" disabled={Boolean(moving)} onClick={() => bank("card-subscribe")}>{moving === "card-subscribe" ? "Signing…" : "Subscribe to Lexica Pro with its card"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving) || !p.cards[0]} onClick={() => bank("card-charge")}>{moving === "card-charge" ? "Charging…" : "Merchant charges the next period"}</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving) || !p.cards[0]} onClick={() => bank("card-overcharge")}>Merchant overcharges $19</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving) || !p.cards[0]} onClick={() => bank("card-thief")}>A thief uses the card details</button>
                <button type="button" className="btn btn-sm" disabled={Boolean(moving) || !p.cards[0] || p.cards[0].state !== "ACTIVE"} onClick={() => bank("card-cancel")}>Agent cancels the card</button>
              </div>
            )}
            {movedCard && (
              <p className="mt-3 text-sm" role="status" data-testid="card-result">
                <b className={moved!.status === "DENIED" || moved!.status === "FAILED" || moved!.status === "CANCELLED" ? "text-red" : "text-green"}>{moved!.status === "DENIED" ? "Declined." : moved!.status === "CANCELLED" ? "Cancelled." : moved!.status === "FAILED" ? "Failed." : moved!.status === "PAID" ? "Charged; PayPal paid the merchant." : moved!.status === "BOOKED" ? "Charged." : "Charged; sent to PayPal."}</b> {moved!.narration}
                {moved!.reasons.length > 0 && <span className="mono mt-1 block text-[.72rem] text-red">{moved!.reasons.map((r) => `${r.code} · ${r.detail}`).join("  ")}</span>}
              </p>
            )}
            {p.cards[0] && p.cards[0].attempts.length > 0 && (
              <ul className="ledger mt-4 border-t-[1.5px] border-ink" data-testid="card-attempts">
                {p.cards[0].attempts.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                    <p className="min-w-0 text-[.86rem]"><span className="mono mr-2 text-[.7rem] text-ink-3">{stamp(a.at)}</span>{a.status === "DENIED" ? "Declined" : a.status === "FAILED" ? "Failed" : "Charged"}{a.memo && <span className="text-xs text-ink-2"> · {a.memo}</span>}{a.reasons.length > 0 && <span className="mono ml-2 text-[.68rem] text-red">{a.reasons.join(" · ")}</span>}{a.payoutBatchId && <span className="mono ml-2 text-[.68rem] text-ink-3">payout {a.payoutBatchId}{a.payoutStatus ? ` (${a.payoutStatus})` : ""}</span>}</p>
                    <span className={`figure shrink-0 text-[1.02rem] ${a.status === "DENIED" || a.status === "FAILED" ? "text-ink-3 line-through decoration-red decoration-2" : ""}`}>{usd(a.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.cards.length > 1 && <p className="mt-2 text-xs text-ink-3">Earlier cards: {p.cards.slice(1).map((c) => `${c.label} (${CARD_STATE[c.state].text.toLowerCase()}, ${c.charges} of ${c.maxCharges})`).join(" · ")}</p>}
            <p className="mt-3 text-xs text-ink-3">A Xenoncard works where the merchant has an account on this gateway. It is not a Visa, Mastercard or Verve card and cannot be typed into a checkout that expects one.</p>
          </section>
        )}

        {p.incoming.length > 0 && (
          <section data-testid="incoming">
            <h2 className="label">Money in</h2>
            <ul className="ledger mt-3 border-t-[1.5px] border-ink">
              {p.incoming.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-[.93rem]"><span className="mono mr-2 text-[.7rem] text-ink-3">{stamp(s.createdAt)}</span>from <span className="title">{s.leafLabel}</span> <span className="text-xs text-ink-2">· {s.purpose}{s.memo ? ` · ${s.memo}` : ""}</span></p>
                    <Figure minor={s.amountMinor} className={`shrink-0 text-[1.2rem] ${s.status === "LAPSED" || s.status === "FAILED" ? "text-ink-3 line-through" : ""}`} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><SpendStamp status={s.status} />{s.status === "PROMISED" && s.promiseExpiresAt && <span className="text-xs text-ink-2">held for it until {stamp(s.promiseExpiresAt)} UTC</span>}<Link className="link text-[.78rem]" href={`/e/${s.rootId}`}>the payer&rsquo;s envelope →</Link>{s.hasReceipt && <Link className="link text-[.78rem]" href={`/r/${s.id}`}>receipt →</Link>}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {p.accounts.length > 0 && <section className="space-y-4">
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
        </section>}

        {p.accounts.length > 0 && <section>
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
        </section>}
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        {p.accounts.length === 0 && p.receives && (
          <section className="sheet sheet-lift p-5 sm:p-6">
            <p className="label">An agent that earns</p>
            <h2 className="title mt-2 text-[1.7rem]">It holds no envelope. It gets paid.</h2>
            <p className="mt-2 text-sm text-ink-2">{p.label} works for other agents. Before it starts, it can ask the paying agent to set the fee aside: the money is then reserved for this account at every level of the payer&rsquo;s envelope, and PayPal has confirmed the hold. When the work is done the payer pays it{p.receives.holds ? ": the money is captured from the payer\u2019s hold and lands in this agent\u2019s balance." : ` and PayPal pays ${p.receives.owner.label}.`}</p>
            <pre className="code mt-4 overflow-x-auto p-3 text-[.72rem]">{`# the paying agent\nnpx tsx scripts/agent.ts promise --as <payer> \\\n  --payee ${p.receives.payee} --amount 45 --purpose translation\nnpx tsx scripts/agent.ts keep <promise-id>`}</pre>
          </section>
        )}
        {p.accounts.length > 0 && <section className="sheet sheet-lift p-5 sm:p-6" data-testid="check">
          <p className="label">Know your agent</p>
          <h2 className="title mt-2 text-[1.7rem]">Is it good for the money?</h2>
          <p className="mt-2 text-sm text-ink-2">You are a payee this agent wants to hire. Before you do any work, ask the gateway. It checks the agent's key, who stands behind it, and asks PayPal whether the hold is still there.</p>
          {p.demo ? (
            <form onSubmit={check} className="mt-5 space-y-5">
              <label className="label block">You are (payee: account or PayPal email)<input className="field mono mt-1 !text-[.9rem]" value={ask.payee} onChange={(e) => setAsk({ ...ask, payee: e.target.value })} required /></label>
              <div className="grid grid-cols-2 gap-x-6">
                <label className="label block">For (USD)<input className="field figure mt-1 !text-[1.6rem]" value={ask.amount} onChange={(e) => setAsk({ ...ask, amount: e.target.value })} inputMode="decimal" required /></label>
                <label className="label block">Purpose<input className="field mt-1" value={ask.purpose} onChange={(e) => setAsk({ ...ask, purpose: e.target.value })} required /></label>
              </div>
              <button className="btn btn-ink w-full" disabled={busy}>{busy ? "Asking the gateway and PayPal…" : "Ask the gateway"}</button>
              <p className="text-xs text-ink-3">This is a built-in demo agent, so the demo signs the introduction for it. The answer comes from the public endpoint any payee would call.</p>
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
        </section>}

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
              {answer.s.paypal.honoredUntil && <li className="leader"><span className="text-ink-2" title="PayPal recommends capturing within three days of the authorization. After that a capture is still attempted, subject to the funds being available, until the authorization ends on day 29.">PayPal&rsquo;s honor period</span><i /><span className={`mono text-[.78rem] ${Date.parse(answer.s.paypal.honoredUntil) > Date.now() ? "" : "text-red"}`}>{Date.parse(answer.s.paypal.honoredUntil) > Date.now() ? `until ${new Date(answer.s.paypal.honoredUntil).toISOString().slice(0, 16).replace("T", " ")} UTC` : "ended: captures no longer assured"}</span></li>}
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
