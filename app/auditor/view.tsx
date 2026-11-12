"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { liveAudit, scriptedAudit, type AuditAnswer, type AuditStep, type AuditTool, type AuditVerdict } from "@/lib/ai/auditor";
import { Stamp } from "@/components/stationery";

type Desk = { mode: string; locked: boolean; keyConfigured: boolean; proposals: string[]; tools: AuditTool[] };
const WRITES = ["create_refund", "pay_order", "create_order", "accept_dispute_claim"];
const SOURCE = { "paypal-agent-toolkit": "PayPal Agent Toolkit", envelope: "Envelope gateway" } as const;
const KIND_WORDS: Record<string, string> = { answer_dispute: "Answer the dispute", recall_payout: "Recall the payout", close_envelope: "Close the envelope", freeze_account: "Freeze the account" };

/**
 * The auditor's desk. Everything on this page is a read or a proposal: the page has no way to move
 * money, and neither has the agent it runs.
 */
export function AuditorView() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [model, setModel] = useState<{ available: boolean; model?: string } | null>(null);
  const [key, setKey] = useState("");
  const [steps, setSteps] = useState<AuditStep[]>([]);
  const [running, setRunning] = useState<false | "model" | "procedure">(false);
  const [note, setNote] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [refusal, setRefusal] = useState<{ tool: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);
  const stop = useRef(false);
  const headers = () => (key ? { authorization: `Bearer ${key}` } : undefined);
  const loadDesk = async () => { const r = await api<Desk>("/api/auditor", { headers: headers() }); if (r.ok) setDesk(r.json); };
  useEffect(() => {
    void loadDesk();
    void fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json()).then(setModel).catch(() => setModel({ available: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const io = {
    read: async (tool: string, args: Record<string, unknown>): Promise<AuditAnswer> => {
      const r = await api<AuditAnswer & { error?: string }>("/api/auditor/read", { body: { tool, args }, headers: headers() });
      return r.json?.brief ? r.json : { tool, source: null, ok: false, refused: r.status === 403, brief: r.json?.error ?? "The gateway did not answer.", data: null };
    },
    check: async (kind: string, target: string): Promise<AuditVerdict> => {
      const r = await api<AuditVerdict & { error?: string }>("/api/auditor/check", { body: { kind, target }, headers: headers() });
      return r.ok ? r.json : { kind, target, stands: false, why: r.json?.error ?? "The gateway did not answer.", signer: null, link: null };
    },
    step: (s: AuditStep) => setSteps((x) => [...x, s]),
    stopped: () => stop.current,
  };

  async function run(by: "model" | "procedure") {
    setRunning(by); setSteps([]); setNote(null); stop.current = false;
    try {
      if (by === "procedure") await scriptedAudit(io);
      else await liveAudit({ ...io, turn: async (turns) => {
        const r = await fetch("/api/ai/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: turns }) });
        const j = await r.json().catch(() => ({ error: "The model did not answer." }));
        return r.ok ? { ok: true as const, message: j.message } : { ok: false as const, error: j.error ?? "The model did not answer." };
      } });
    } catch (e) { io.step({ kind: "error", text: e instanceof Error ? e.message : "The audit stopped." }); }
    setRunning(false);
  }

  async function stage() {
    setBusy("stage");
    const r = await api("/api/demo/dispute", { body: {} });
    setNote(r.ok ? { text: `A payer has disputed payment ${r.json.payment} at the simulated PayPal (dispute ${r.json.dispute}). The gateway has not been told. Run the audit.`, tone: "info" } : { text: r.json?.error ?? "Could not stage a dispute.", tone: "bad" });
    if (r.ok) setStaged(true);
    setBusy(null);
  }
  async function sweep() {
    setBusy("sweep");
    const r = await api("/api/sweep", { body: {} });
    const sent = r.ok ? ((r.json?.disputes?.aboutPaymentsHere ?? []) as Array<{ dispute: string; evidenceSent: boolean; status: string }>).filter((d) => d.evidenceSent) : [];
    setNote(!r.ok ? { text: r.json?.error ?? "The sweep did not run.", tone: "bad" } : sent.length ? { text: `The gateway swept: it sent the signed evidence for ${sent.map((d) => d.dispute).join(", ")}; PayPal's status is now ${sent[0]!.status}. Run the audit again to see it confirmed.`, tone: "good" } : { text: "The gateway swept. No dispute was waiting for its answer.", tone: "info" });
    setBusy(null);
  }
  async function tryWrite(tool: string) {
    const r = await api<AuditAnswer & { error?: string }>("/api/auditor/read", { body: { tool, args: {} }, headers: headers() });
    setRefusal({ tool, text: `${r.status} · ${r.json?.brief ?? r.json?.error ?? "refused"}` });
  }

  if (!desk) return <p className="label py-10">Opening the auditor&rsquo;s desk…</p>;
  const paypalTools = desk.tools.filter((t) => t.source === "paypal-agent-toolkit");
  const ownTools = desk.tools.filter((t) => t.source === "envelope");
  const report = steps.find((s): s is Extract<AuditStep, { kind: "report" }> => s.kind === "report");
  const proposals = steps.filter((s): s is Extract<AuditStep, { kind: "proposal" }> => s.kind === "proposal");
  const simulated = desk.mode === "simulated";
  // a read that failed means the audit cannot vouch for anything, whatever the report goes on to say
  const incomplete = steps.some((s) => s.kind === "error" || (s.kind === "read" && !s.answer.ok && !s.answer.refused && s.tool !== "envelope_payment" && s.tool !== "get_order" && s.tool !== "get_refund"));

  return (
    <div className="space-y-12">
      <header className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="label">The auditor</p>
          <h1 className="display mt-2 text-[clamp(2.2rem,5vw,3.6rem)]">An agent that watches <em>the agents.</em></h1>
        </div>
        <p className="text-ink-2">Agents spend here all day with nobody watching each payment. So the checking is an agent&rsquo;s job too. The auditor asks PayPal directly, through PayPal&rsquo;s own Agent Toolkit, and compares the answers with the gateway&rsquo;s books. It can read and it can propose. It cannot pay, refund or sign, and a person or the gateway&rsquo;s own rules decide what happens to a proposal.</p>
      </header>

      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]">
        <section aria-labelledby="reach" data-testid="auditor-reach">
          <h2 id="reach" className="label">What it can reach</h2>
          <div className="mt-3 border-t-[1.5px] border-ink pt-4">
            <p className="title text-[1.05rem]">PayPal Agent Toolkit <span className="mono text-[.7rem] font-normal text-blue">@paypal/agent-toolkit</span></p>
            <p className="mt-1 text-[.86rem] text-ink-2">PayPal&rsquo;s package gives a model 47 tools. The auditor gets the {paypalTools.length} that read. The toolkit is handed no credential: the gateway&rsquo;s PayPal client carries its requests, and carries only reads.</p>
            <ul className="ledger mt-2">
              {paypalTools.map((t) => <li key={t.name} className="flex items-baseline justify-between gap-3 py-1.5"><span className="mono text-[.78rem] text-blue">{t.name}</span><span className="text-right text-[.8rem] text-ink-2">{t.title}</span></li>)}
            </ul>
          </div>
          <div className="mt-6 border-t border-rule pt-4">
            <p className="title text-[1.05rem]">The gateway&rsquo;s books</p>
            <ul className="ledger mt-2">
              {ownTools.map((t) => <li key={t.name} className="flex items-baseline justify-between gap-3 py-1.5"><span className="mono text-[.78rem]">{t.name}</span><span className="text-right text-[.8rem] text-ink-2">{t.title}</span></li>)}
            </ul>
          </div>
          <div className="mt-6 border-t border-rule pt-4">
            <p className="title text-[1.05rem]">And one thing it can say</p>
            <p className="mt-1 text-[.86rem] text-ink-2"><span className="mono text-[.78rem] text-ink">propose</span> · {desk.proposals.map((k) => KIND_WORDS[k]?.toLowerCase() ?? k).join(", ")}. The gateway checks each proposal against its records and names who would have to sign.</p>
          </div>
          <div className="mt-6 border-t border-rule pt-4" data-testid="auditor-refusal">
            <p className="title text-[1.05rem]">Hand it a tool it does not have</p>
            <p className="mt-1 text-[.86rem] text-ink-2">These are real tools of PayPal&rsquo;s toolkit. Ask for one as the auditor would.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {WRITES.map((w) => <button key={w} type="button" className="btn btn-sm mono !text-[.72rem]" onClick={() => void tryWrite(w)}>{w}</button>)}
            </div>
            {refusal ? <p className="mt-3 border-l-2 border-red pl-3 text-[.84rem] text-ink-2" role="status"><span className="mono text-[.72rem] text-red">{refusal.tool}</span><br />{refusal.text}</p> : null}
          </div>
        </section>

        <section aria-labelledby="run" className="min-w-0">
          <h2 id="run" className="label">Run the audit</h2>
          <div className="mt-3 border-t-[1.5px] border-ink pt-4">
            {desk.locked ? (
              <div className="mb-4 max-w-md">
                <p className="text-[.9rem] text-ink-2">{desk.keyConfigured ? "Against real PayPal the auditor's reads show the operator's whole account, so they need the operator's key." : "This gateway has no operator key (AUDITOR_SECRET), so the auditor is switched off here."}</p>
                {desk.keyConfigured ? <label className="label mt-3 block">Operator&rsquo;s key<input className="field mono mt-1" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => void loadDesk()} /></label> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {model?.available ? <button type="button" className="btn btn-ink" data-testid="auditor-run-model" disabled={Boolean(running) || desk.locked} onClick={() => void run("model")}>{running === "model" ? "Auditing…" : "Let a model audit"}</button> : null}
              <button type="button" className={`btn ${model?.available ? "" : "btn-ink"}`} data-testid="auditor-run" disabled={Boolean(running) || desk.locked} onClick={() => void run("procedure")}>{running === "procedure" ? "Auditing…" : "Audit by the fixed procedure"}</button>
              {running ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => { stop.current = true; }}>Stop</button> : null}
            </div>
            <p className="mt-3 text-[.82rem] text-ink-2">{model?.available ? <>A model ({model.model}) decides what to look at, or a fixed procedure makes the same reads in a set order. Both use the same tools.</> : <>No model is connected to this copy, so the audit runs by a fixed procedure over the same tools a model would use.</>}</p>
            {simulated ? (
              <p className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-[.86rem] text-ink-2">
                <button type="button" className="btn btn-sm" data-testid="auditor-stage-dispute" data-staged={staged ? "" : undefined} disabled={busy === "stage"} onClick={() => void stage()}>A payer disputes the latest payment</button>
                <span>Simulator only: gives the auditor something to find. On PayPal a payer does this in the Resolution Center.</span>
              </p>
            ) : null}
            {note ? <p role="status" className={`mt-4 border-l-2 pl-3 text-[.9rem] ${note.tone === "good" ? "border-green" : note.tone === "bad" ? "border-red" : "border-blue"}`} data-testid="auditor-note">{note.text}</p> : null}
          </div>

          {report ? (
            <div className="mt-8 border-[1.5px] border-ink bg-sheet p-5" data-testid="auditor-report">
              <div className="flex items-start justify-between gap-4">
                <p className="label">The auditor&rsquo;s report · written by {report.by === "model" ? `the model${model?.model ? ` (${model.model})` : ""}` : "the fixed procedure"}</p>
                <Stamp tone={incomplete ? "red" : proposals.some((p) => p.verdict.stands) ? "amber" : "green"} flat>{incomplete ? "incomplete" : proposals.some((p) => p.verdict.stands) ? "needs a person" : "agrees"}</Stamp>
              </div>
              <div className="mt-3 space-y-1.5">
                {report.text.split("\n").filter(Boolean).map((l, i) => <p key={i} className={i === 0 ? "title text-[1.2rem]" : "text-[.94rem] text-ink-2"}>{l}</p>)}
              </div>
            </div>
          ) : null}

          {proposals.length ? (
            <div className="mt-8" data-testid="auditor-proposals">
              <h3 className="label">Proposals · checked by the gateway against its records</h3>
              <ul className="ledger mt-3 border-t-[1.5px] border-ink">
                {proposals.map((p, i) => (
                  <li key={i} className="py-4" data-testid="auditor-proposal">
                    <div className="flex flex-wrap items-center gap-3">
                      <Stamp tone={p.verdict.stands ? "green" : "red"} flat>{p.verdict.stands ? "stands" : "does not stand"}</Stamp>
                      <span className="title text-[1.05rem]">{KIND_WORDS[p.verdict.kind] ?? p.verdict.kind}</span>
                      <span className="mono text-[.72rem] text-ink-3">{p.verdict.target}</span>
                    </div>
                    <p className="mt-2 text-[.9rem] text-ink-2"><span className="micro mr-1.5">the auditor</span>{p.reason}</p>
                    <p className="mt-1 text-[.9rem]"><span className="micro mr-1.5">the gateway</span>{p.verdict.why}</p>
                    {p.verdict.stands ? (
                      <p className="mt-2 flex flex-wrap items-center gap-3 text-[.86rem] text-ink-2">
                        <span>It takes <strong className="text-ink">{p.verdict.signer}</strong>, not the auditor.</span>
                        {p.verdict.signer === "the gateway's sweep" ? <button type="button" className="btn btn-sm" data-testid="auditor-sweep" disabled={busy === "sweep"} onClick={() => void sweep()}>{busy === "sweep" ? "Sweeping…" : "Run the gateway's sweep now"}</button> : null}
                        {p.verdict.link ? <Link className="link" href={p.verdict.link}>Open the record →</Link> : null}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {steps.length ? (
            <div className="mt-8" data-testid="auditor-steps">
              <h3 className="label">What it read, in order</h3>
              <ol className="ledger mt-3 border-t-[1.5px] border-ink">
                {steps.map((s, i) => s.kind === "read" ? (
                  <li key={i} className="py-3">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={`mono text-[.7rem] uppercase tracking-[.12em] ${s.source === "paypal-agent-toolkit" ? "text-blue" : "text-ink-2"}`}>{s.source ? SOURCE[s.source] : "refused"}</span>
                      <span className="mono text-[.8rem]">{s.tool}</span>
                      {Object.keys(s.args).length ? <span className="mono truncate text-[.7rem] text-ink-3">{JSON.stringify(s.args)}</span> : null}
                      {!s.answer.ok ? <Stamp tone="red" flat>{s.answer.refused ? "refused" : "failed"}</Stamp> : null}
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-[.86rem] text-ink-2">{s.answer.brief}</p>
                    {s.answer.data ? <details className="mt-1.5"><summary className="micro cursor-pointer">{s.source === "paypal-agent-toolkit" ? "PayPal's answer" : "the record"}</summary><pre className="mono mt-2 max-h-64 overflow-auto border border-rule bg-sheet p-3 text-[.68rem] leading-relaxed">{JSON.stringify(s.answer.data, null, 1).slice(0, 6000)}</pre></details> : null}
                  </li>
                ) : s.kind === "say" ? (
                  <li key={i} className="py-3 text-[.9rem]"><span className="micro mr-2">the model</span>{s.text}</li>
                ) : s.kind === "error" ? (
                  <li key={i} className="py-3 text-[.9rem] text-red" role="alert">{s.text}</li>
                ) : s.kind === "proposal" ? (
                  <li key={i} className="py-3 text-[.86rem] text-ink-2"><span className="mono mr-3 text-[.7rem] uppercase tracking-[.12em]">propose</span>{KIND_WORDS[s.verdict.kind] ?? s.verdict.kind} · {s.verdict.target} · {s.verdict.stands ? "stands" : "does not stand"}</li>
                ) : null)}
              </ol>
            </div>
          ) : (
            <p className="mt-8 text-[.9rem] text-ink-2">Nothing has been read yet. {simulated ? <>If nothing has been paid in this browser, <Link className="link" href="/console">seal an envelope and run the agents</Link> first, so there is something to audit.</> : null}</p>
          )}
        </section>
      </div>

      <p className="border-t border-rule pt-5 text-[.84rem] text-ink-2">The same checks, without an agent: <Link className="link" href="/bank">the books against PayPal&rsquo;s balance and statement →</Link> · Bring your own auditor: <span className="mono text-[.76rem]">npm run auditor</span> runs this from a terminal, and <span className="mono text-[.76rem]">ENVELOPE_ROLE=auditor npm run mcp</span> gives the same tools to any MCP client.</p>
    </div>
  );
}
