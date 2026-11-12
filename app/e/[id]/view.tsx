"use client";

import { api, gatewayInBrowser } from "@/lib/client/api";
import { usePoll } from "@/lib/client/poll";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { accountNumber, fingerprint, signAccept, signRead, signRevoke, type Caps, type KeyPair } from "@/lib/envelope/core";
import { principalKey } from "@/lib/principal-key";
import { Mission } from "./mission";
import { PayPalRail } from "@/components/paypal-rail";
import { Figure, Flap, Meter, Postmark, Sigil, SpendStamp, Stamp, usd } from "@/components/stationery";

type BlockT = { id: string; parentId: string | null; depth: number; holder: string; holderLabel: string; caps: Caps; spentMinor: number; reservedMinor: number; revokedAt: string | null };
type SpendT = { id: string; leafLabel: string; amountMinor: number; payee: string; purpose: string; memo: string; agentNote: string | null; status: string; reasons: Array<{ code: string; detail: string }>; captureId: string | null; payoutBatchId: string | null; payoutStatus: string | null; refundId: string | null; disputeId: string | null; disputeStatus: string | null; createdAt: string; hasReceipt: boolean; promiseExpiresAt: string | null; delivery: { by: string; work: string; note: string } | null; releaseBy: string | null; signed?: never };
type Data = {
  mode: string; demoAgents: boolean;
  root: { id: string; principal: string; principalName: string; title: string; limitMinor: number; capturedMinor: number; refundedMinor: number; releasedMinor: number | null; status: string; authorizationId: string | null; paypalOrderId: string | null; authorizationExpiresAt: string | null; closeReason: string | null; createdAt: string };
  blocks: BlockT[]; spends: SpendT[];
  /** Payees that are agents' accounts: who they are. */
  payees: Record<string, { label: string; key: string; owner: string }>;
  audit: { ok: boolean; length: number; entries: Array<{ seq: number; at: string; actor: string; action: string; ref: string | null; outcome: string }> };
};

const SPEND_LABEL: Record<string, string> = { PAID: "Paid", DENIED: "Denied", PAYOUT_PENDING: "Paid · PayPal processing", UNCLAIMED: "Paid · payee hasn't claimed", RESERVED: "In flight", CAPTURED: "In flight", FAILED: "Failed · refunded", PROMISED: "Set aside", LAPSED: "Released" };
const RUN = ["split-localization", "split-creative", "promise-translator", "accept-translator", "pay-designer"] as const;
const ATTACK = ["attack-payee", "attack-overspend", "attack-forge"] as const;
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);
/** "11 Nov 14:17 UTC" with non-breaking spaces, so a date never wraps in the middle. */
const when = (iso: string) => `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${hhmm(iso)} UTC`.replace(/ /g, "\u00A0");

export function EnvelopeView({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<KeyPair | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<Array<{ text: string; tone: "info" | "good" | "bad" }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [recallNote, setRecallNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await api(`/api/envelopes/${id}`);
    if (r.status === 404) { setMissing(true); return; }
    if (r.ok) setD(r.json);
  }, [id]);
  useEffect(() => { void principalKey(false).then(setMe); }, []);
  usePoll(load, 3000, id);

  if (missing) return <p className="sheet p-6 text-sm">No such envelope. <Link className="link" href="/console">Seal one</Link>.</p>;
  if (!d) return <p className="label py-10">Fetching the envelope…</p>;
  const { root, blocks, spends } = d;
  const isOwner = me?.publicKey === root.principal;
  const open = root.status === "ACTIVE";
  const say = (text: string, tone: "info" | "good" | "bad" = "info") => setLines((l) => [...l, { text, tone }]);

  async function script(actions: readonly string[], label: string) {
    setBusy(label); setErr(null);
    try {
      for (const action of actions) {
        if (!me) { setErr("The built-in agents act only for the owner. Open this envelope in the browser that sealed it."); break; }
        const r = await api("/api/demo/act", { body: { rootId: id, action, owner: await signRead(me, "demo", id) } });
        const j = r.json;
        if (!r.ok) { setErr(j.error ?? "That step failed."); break; }
        say(j.narration);
        if (j.status === "DENIED") say(`Gateway: DENIED — ${j.reasons.map((x: { meaning: string }) => x.meaning).join(" ")}`, "bad");
        else if (j.status === "PROMISED") say("Gateway: SET ASIDE — reserved at every level and PayPal confirmed the hold. No money has moved yet.", "good");
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
      const r = await api("/api/gateway/revoke", { body: { signed: await signRevoke(me, blockId) } });
      const j = r.json;
      if (!r.ok) { setErr(j.error ?? "Couldn't revoke."); return; }
      if (blockId === id) say(`You closed the envelope. PayPal released ${usd(j.root.releasedMinor ?? 0)} of the hold; you were charged ${usd(j.root.capturedMinor)}.`, "good");
      else say(`You revoked ${label}'s envelope. It, and anything split from it, is dead as of now.`, "good");
      await load();
    } finally { setBusy(null); }
  }

  /** The owner signs (or refuses) a payment an agent asked for above the approval threshold. */
  async function decide(spendId: string, decline: boolean) {
    if (!me) return;
    setBusy("decide"); setErr(null);
    try {
      const r = await api("/api/gateway/accept", { body: { signed: await signAccept(me, spendId, { decline, note: decline ? "Declined by the owner." : "Approved by the owner." }) } });
      if (!r.ok && r.status !== 409) setErr(r.json.error ?? "Couldn't record your decision.");
      else say(decline ? "You declined. The money went back into the envelope." : "You signed. PayPal captured it from the hold and paid the payee.", "good");
      await load();
    } finally { setBusy(null); }
  }
  /** The owner takes back a payout PayPal is holding because nobody claimed it. */
  async function recall(spendId: string) {
    if (!me) return;
    setBusy("recall");
    try {
      const r = await api(`/api/spends/${spendId}/recall`, { body: { signed: await signRead(me, "recall", spendId) } });
      setRecallNote((n) => ({ ...n, [spendId]: r.ok && r.json.refundId ? "PayPal cancelled the payout and refunded the capture. The money is back in the envelope." : r.json.error ?? "PayPal has not finished; this page will update." }));
      await load();
    } finally { setBusy(null); }
  }
  const recalled = (s: SpendT) => s.reasons[0]?.code === "RECALLED_BY_OWNER";
  const waiting = spends.filter((s) => s.status === "PROMISED" && s.releaseBy === root.principal);
  const held = open ? root.limitMinor - root.capturedMinor - root.refundedMinor : 0;
  /** A payee as people should read it: an agent's name when it is an account, the address otherwise. */
  const Payee = ({ p, tag }: { p: string; tag?: boolean }) => {
    const a = d.payees?.[p];
    if (!a) return <span className={tag ? "tag" : "mono break-all text-[.78rem]"}>{p}</span>;
    return <Link href={`/a/${a.key}`} className={tag ? "tag underline decoration-dotted underline-offset-2" : "underline decoration-dotted underline-offset-2"} title={`${p} · an agent owned by ${a.owner}`}><span className={tag ? "" : "title"}>{a.label}</span>{tag ? ` · ${p.slice(5).toUpperCase()}` : <span className="mono ml-1.5 text-[.68rem] text-ink-3">{a.owner}&rsquo;s agent</span>}</Link>;
  };
  const children = (parent: string | null) => blocks.filter((b) => b.parentId === parent);
  const Node = ({ b }: { b: BlockT }) => {
    const dead = Boolean(b.revokedAt) || !open;
    const kids = children(b.id);
    const used = b.spentMinor + b.reservedMinor;
    return (
      <div className="space-y-4" data-testid={`node-${b.holderLabel}`}>
        <div className={`envl px-4 pb-4 pt-11 sm:px-5 ${dead ? "envl-dead" : ""}`}>
          <Flap />
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <Link href={`/a/${b.holder}`} className="envl-label flex items-center gap-2.5 py-1.5 pl-1.5 pr-3 transition-transform duration-150 ease-out active:scale-[.98]" title="Open this agent's passport">
              <span className="text-blue"><Sigil k={b.holder} size={38} /></span>
              <span>
                <span className="title block text-[1.08rem] leading-tight">{b.holderLabel}</span>
                <span className="mono block text-[.68rem] tracking-[.06em] text-ink-2">{accountNumber(b.holder)}</span>
              </span>
            </Link>
            <p className="text-right leading-none">
              <Figure minor={b.spentMinor} className="text-[1.9rem]" />
              <span className="mono ml-1.5 text-[.74rem]">of {usd(b.caps.limit)}</span>
            </p>
          </div>
          <div className="mt-3"><Meter spent={b.spentMinor} held={b.reservedMinor} of={b.caps.limit} label={`${usd(used)} of ${usd(b.caps.limit)} used`} /></div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap gap-1.5">
              {(b.caps.payees ?? ["any payee"]).map((p) => <Payee key={p} p={p} tag />)}
              {(b.caps.purposes ?? ["any purpose"]).map((p) => <span key={p} className="tag">{p}</span>)}
            </p>
            <div className="flex items-center gap-2">
              {b.revokedAt && b.depth > 0 ? <Stamp tone="red" land>Revoked</Stamp> : null}
              {isOwner && open && !b.revokedAt && b.depth > 0 ? <button type="button" className="btn btn-sm btn-red" disabled={Boolean(busy)} onClick={() => revoke(b.id, b.holderLabel)}>Revoke</button> : null}
            </div>
          </div>
          <p className="mono mt-2.5 text-[.66rem] leading-relaxed opacity-80">
            {b.depth === 0 ? `sealed by ${root.principalName}` : "split off by the envelope above, offline"} · max {usd(b.caps.perPayment)} per payment · expires {when(b.caps.notAfter)} · {b.caps.splits > 0 ? `can split ${b.caps.splits}×` : "cannot split"}{b.caps.approveOver !== undefined ? ` · owner signs above ${usd(b.caps.approveOver)}` : ""}
          </p>
        </div>
        {kids.length > 0 && <div className="envl-kids space-y-4">{kids.map((k) => <Node key={k.id} b={k} />)}</div>}
      </div>
    );
  };

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,1fr)]">
      <div className="space-y-8">
        <header>
          <p className="label">Envelope · owner {root.principalName} <span className="normal-case tracking-normal">{fingerprint(root.principal)}</span>{isOwner ? " (you)" : ""}</p>
          <h1 className="display mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[clamp(2rem,4.4vw,3rem)]">{root.title} <Stamp tone={open ? "green" : "grey"}>{open ? "Open" : "Closed"}</Stamp></h1>
          <p className="mt-2"><Link className="link text-[.9rem]" href={`/proof/${root.id}`} data-testid="proof-link">Proof graph: trace every dollar back to {isOwner ? "your" : `${root.principalName}'s`} signature →</Link></p>
        </header>

        <section className="sheet overflow-hidden p-5 sm:p-6" aria-label="PayPal hold">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label">PayPal hold backing this envelope</p>
              <p className="mono mt-1 text-[.72rem] text-ink-2">authorization {root.authorizationId}</p>
            </div>
            <Postmark className="-mr-4 -mt-4 shrink-0 rotate-[7deg]" size={104} tone={open ? "blue" : "grey"} top="PAYPAL · HOLD" bottom={open ? "AUTHORIZED" : "VOIDED"} line1={usd(root.limitMinor)} line2={d.mode === "sandbox" ? "SANDBOX" : d.mode.toUpperCase()} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-4">
            <div><Figure minor={root.capturedMinor} className="text-[clamp(1.7rem,3.6vw,2.5rem)]" /><p className="mt-1.5 text-xs leading-snug text-ink-2">captured: what agents actually spent</p></div>
            <div><Figure minor={held} className="text-[clamp(1.7rem,3.6vw,2.5rem)] text-blue" /><p className="mt-1.5 text-xs leading-snug text-ink-2">still held, not charged</p></div>
            <div><Figure minor={root.releasedMinor ?? 0} className="text-[clamp(1.7rem,3.6vw,2.5rem)] text-ink-3" /><p className="mt-1.5 text-xs leading-snug text-ink-2">released back by PayPal</p></div>
          </div>
          <div className="mt-4 text-ink"><Meter spent={root.capturedMinor + root.refundedMinor} freed={root.releasedMinor ?? 0} of={root.limitMinor} label={`${usd(root.capturedMinor)} captured of ${usd(root.limitMinor)}`} /></div>
          {root.refundedMinor > 0 && <p className="mt-3 text-xs text-ink-2" data-testid="refunded"><span className="money text-ink">{usd(root.refundedMinor)}</span> was captured and then refunded to {isOwner ? "you" : "the owner"}. PayPal does not return a refunded amount to the hold, so it is not spendable again from this envelope.</p>}
          <p className="mt-3 text-xs text-ink-2">Each spend is a partial capture of this one authorization; PayPal itself refuses to capture beyond it. Closing the envelope voids the rest. {d.mode === "sandbox" ? "Sandbox: the hold is on PayPal's test card." : ""}</p>
        </section>

        <PayPalRail id={id} tick={`${spends.length}:${spends.map((x) => x.status).join("")}:${root.status}`} />

        {waiting.map((s) => (
          <section key={s.id} className="sheet sheet-lift enter relative border-l-[5px] !border-l-amber p-5 sm:p-6" data-testid="approval" aria-live="polite">
            <p className="label">Waiting for {isOwner ? "your" : "the owner's"} signature</p>
            <p className="title mt-2 text-[1.5rem] leading-snug"><span>{s.leafLabel}</span> asks to pay <Payee p={s.payee} /> <span className="money">{usd(s.amountMinor)}</span></p>
            <p className="mt-1.5 text-sm text-ink-2">{s.purpose}{s.memo ? ` · ${s.memo}` : ""}. Over the {usd(blocks[0]?.caps.approveOver ?? 0)} you asked to sign for, so the agent cannot pay it. The money is set aside until {hhmm(s.promiseExpiresAt ?? s.createdAt)} UTC.</p>
            {s.agentNote && <p className="mt-2 font-serif text-[.95rem] italic leading-snug text-ink-2">Agent: “{s.agentNote}”</p>}
            {isOwner ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="btn btn-ink" disabled={Boolean(busy)} onClick={() => decide(s.id, false)}>{busy === "decide" ? "Signing…" : `Sign & pay ${usd(s.amountMinor)}`}</button>
                <button type="button" className="btn btn-red" disabled={Boolean(busy)} onClick={() => decide(s.id, true)}>Decline</button>
              </div>
            ) : <p className="mt-3 text-xs text-ink-2">Only the owner&rsquo;s browser holds the key that can sign this.</p>}
          </section>
        ))}

        <section aria-label="Envelopes" className="space-y-4">
          <h2 className="label">Who holds what</h2>
          {children(null).map((b) => <Node key={b.id} b={b} />)}
        </section>

        {(d.demoAgents || isOwner) && (
          <section className="space-y-4 border-t-[1.5px] border-ink pt-5" data-testid="controls">
            <h2 className="label">Controls</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-4">
              {d.demoAgents && <button type="button" className="btn btn-ink" disabled={Boolean(busy) || !open} onClick={() => script(RUN, "run")}>{busy === "run" ? "Agents working…" : "Run the launch (agents split & pay)"}</button>}
              {d.demoAgents && <button type="button" className="btn" disabled={Boolean(busy) || !open} onClick={() => script(ATTACK, "attack")}>{busy === "attack" ? "Attacking…" : "Compromise the creative agent"}</button>}
              {d.demoAgents && blocks[0]?.caps.approveOver !== undefined && <button type="button" className="btn" disabled={Boolean(busy) || !open || waiting.length > 0} onClick={() => script(["ask-owner"], "ask")}>{busy === "ask" ? "Asking…" : "Agent asks for a bigger payment"}</button>}
              {isOwner && <button type="button" className="btn btn-red" disabled={Boolean(busy) || !open} onClick={() => revoke(id, "the root")}>Close envelope & release the hold</button>}
            </div>
            {d.demoAgents && <p className="text-xs text-ink-2">The built-in agents are scripted and their keys live {gatewayInBrowser() ? "in this browser" : "on this demo server"}. External agents (see the README) hold their own keys and call the same gateway.</p>}
            {!isOwner && <p className="text-xs text-ink-2">Only the owner's browser holds the key that can revoke or close this envelope.</p>}
            {d.demoAgents && open && blocks[0] && <Mission id={id} root={root} caps={blocks[0].caps} payees={d.payees ?? {}} disabled={Boolean(busy)} onChange={load} />}
            {err && <p role="alert" className="text-sm text-red">{err}</p>}
            {lines.length > 0 && (
              <ol className="mono space-y-1.5 border-l-[1.5px] border-ink pl-4 text-[.8rem] leading-relaxed" aria-live="polite">
                {lines.map((l, i) => <li key={i} className={`enter ${l.tone === "bad" ? "text-red" : l.tone === "good" ? "text-green" : "text-ink-2"}`}>{l.text}</li>)}
              </ol>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-8">
        <section data-testid="statement">
          <h2 className="label">Statement</h2>
          {spends.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">No spend requests yet.</p> : (
            <ul className="ledger mt-3 border-t-[1.5px] border-ink">
              {spends.map((s) => (
                <li key={s.id} className="enter py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-[.95rem]"><span className="mono mr-2 text-[.7rem] text-ink-3">{hhmm(s.createdAt)}</span><span className="title">{s.leafLabel}</span> <span className="text-ink-3">→</span> <Payee p={s.payee} /></p>
                    <Figure minor={s.amountMinor} className={`shrink-0 text-[1.35rem] ${s.status === "DENIED" ? "text-ink-3 line-through decoration-red decoration-2" : ""}`} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">{recalled(s) ? <Stamp tone="grey" land>Recalled · refunded</Stamp> : s.reasons[0]?.code === "REFUNDED_BY_PAYEE" ? <Stamp tone="grey" land>Refunded by the payee</Stamp> : <SpendStamp status={s.status} land />}{s.disputeId && <Stamp tone="red" flat>Disputed at PayPal</Stamp>}<span className="text-xs text-ink-2">{s.purpose}{s.memo ? ` · ${s.memo}` : ""}{s.status === "PROMISED" && s.promiseExpiresAt ? ` · held for this payee until ${hhmm(s.promiseExpiresAt)} UTC` : ""}</span></p>
                  {s.delivery && <p className="mono mt-2 text-[.7rem] leading-snug text-green">released by {s.delivery.by === root.principal ? "the owner" : blocks.find((b) => b.holder === s.delivery!.by)?.holderLabel ?? fingerprint(s.delivery.by)}&rsquo;s signature{s.delivery.work ? ` · work ${s.delivery.work.slice(0, 12)}…` : ""}</p>}
                  {s.agentNote && <p className="mt-2 font-serif text-[.9rem] italic leading-snug text-ink-2">Agent: “{s.agentNote}”</p>}
                  {s.reasons.length > 0 && <ul className="mono mt-2 space-y-0.5 text-[.72rem] leading-snug text-red">{s.reasons.map((r, i) => <li key={i}><b>{r.code}</b> · {r.detail}</li>)}</ul>}
                  {s.captureId && <p className="mono mt-2 text-[.68rem] text-ink-2">capture {s.captureId} · {s.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the agent\u2019s balance, no payout" : <>payout {s.payoutBatchId}{s.payoutStatus ? ` (${s.payoutStatus})` : ""}</>}</p>}
                  {s.disputeId && <p className="mono mt-2 text-[.7rem] leading-snug text-red">PayPal dispute {s.disputeId} · {(s.disputeStatus ?? "open").replace(/_/g, " ").toLowerCase()} · the gateway answers with this payment&rsquo;s signed chain of authority</p>}
                  {s.hasReceipt && <Link className="link mt-1.5 inline-block text-[.8rem]" href={`/r/${s.id}`}>Receipt & authority chain →</Link>}
                  {s.status === "UNCLAIMED" && isOwner && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => recall(s.id)} data-testid="recall">{busy === "recall" ? "Asking PayPal…" : "Recall this payment"}</button>
                      <span className="text-xs text-ink-2">Nobody has claimed it. PayPal cancels the payout and the capture is refunded.</span>
                    </p>
                  )}
                  {recallNote[s.id] && <p className="mt-1.5 text-xs text-ink-2" role="status">{recallNote[s.id]}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="sheet p-4">
          <div className="flex items-center justify-between gap-2"><h2 className="label">Audit trail</h2><Stamp tone={d.audit.ok ? "green" : "red"} flat>{d.audit.ok ? `Hash chain intact · ${d.audit.length}` : "Chain broken"}</Stamp></div>
          <ol className="mono mt-3 space-y-1 text-[.7rem] leading-relaxed">{d.audit.entries.map((e) => <li key={e.seq} className="leader"><span><span className="text-ink-3">#{String(e.seq).padStart(2, "0")}</span> {e.action.replace(/\./g, " › ")}</span><i /><span className="text-ink-2">{e.actor}{e.ref ? ` · ${e.ref.slice(0, 17)}` : ""}</span></li>)}</ol>
        </section>
      </aside>
    </div>
  );
}
