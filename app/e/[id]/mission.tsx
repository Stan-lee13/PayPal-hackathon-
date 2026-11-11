"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Caps } from "@/lib/envelope/core";

type Line = { kind: "stage" | "say" | "call" | "result" | "error"; agent?: string; text: string; tone?: "good" | "bad" | "info" };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Turn = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } | { role: "tool"; tool_call_id: string; content: string };

const STAGES = [
  { stage: "ops", agent: "ops-agent", title: "ops-agent", turns: 5 },
  { stage: "localization", agent: "localization-agent", title: "localization-agent", turns: 5 },
  { stage: "creative", agent: "creative-agent", title: "creative-agent", turns: 4 },
  { stage: "redteam", agent: "creative-agent", title: "red team: the model now tries to get money out of creative-agent's envelope", turns: 8 },
] as const;
const DEFAULT_BRIEF = "Launch the store in French and Yoruba: get the store strings translated and a banner set designed. Spend as little as the quotes require.";
const CALL_WORDS: Record<string, string> = { split_envelope: "tears off an envelope", pay: "asks to pay", set_aside: "sets money aside", pay_what_was_set_aside: "pays what it set aside", look_at_my_envelope: "looks at its envelope" };

function describe(name: string, args: Record<string, unknown>): string {
  const usd = (k: string) => (typeof args[k] === "number" ? `$${(args[k] as number).toFixed(2)}` : "?");
  if (name === "split_envelope") return `for ${args.to}: up to ${usd("limit_usd")}, only to ${args.payee}, only for ${args.purpose}`;
  if (name === "pay") return `${usd("amount_usd")} to ${args.payee} for ${args.purpose}`;
  if (name === "set_aside") return `${usd("amount_usd")} for ${args.payee}`;
  return "";
}

/**
 * Hand the mission to a real language model. The model plays each demo agent in turn and decides
 * what to split, set aside and pay. Each decision is sent to the gateway as that agent's signed
 * request; the gateway's answer is shown next to it. The brief is free text on purpose: try to
 * talk the agents into overspending.
 */
export function Mission({ id, root, caps, payees, disabled, onChange }: { id: string; root: { principalName: string; title: string }; caps: Caps; payees: Record<string, { label: string; owner: string }>; disabled: boolean; onChange: () => Promise<void> }) {
  const [model, setModel] = useState<{ available: boolean; model?: string } | null>(null);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [redteam, setRedteam] = useState(true);
  const stop = useRef(false);
  useEffect(() => { void fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json()).then(setModel).catch(() => setModel({ available: false })); }, []);
  const add = (l: Line) => setLines((x) => [...x, l]);

  async function run() {
    setRunning(true); setLines([]); stop.current = false;
    const ctx = {
      owner: root.principalName, title: root.title, limitUsd: caps.limit / 100, perPaymentUsd: caps.perPayment / 100,
      payees: (caps.payees ?? []).map((p) => ({ payee: p, who: payees[p] ? `${payees[p]!.label}, an agent owned by ${payees[p]!.owner}` : "" })),
      purposes: caps.purposes ?? [], brief,
    };
    try {
      for (const { stage, agent, title, turns: max } of STAGES) {
        if (stop.current || (stage === "redteam" && !redteam)) break;
        add({ kind: "stage", agent, text: `${title} · played by ${model?.model ?? "a model"}` });
        const turns: Turn[] = [];
        for (let i = 0; i < max && !stop.current; i++) {
          const r = await fetch("/api/ai/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage, ctx, messages: turns }) });
          const j = await r.json().catch(() => ({ error: "The model did not answer." }));
          if (!r.ok) { add({ kind: "error", text: j.error ?? "The model did not answer." }); return; }
          const m = j.message as { content: string | null; tool_calls?: ToolCall[] };
          if (m.content?.trim()) add({ kind: "say", agent, text: m.content.trim() });
          if (!m.tool_calls?.length) break;
          turns.push({ role: "assistant", content: m.content, tool_calls: m.tool_calls });
          for (const t of m.tool_calls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(t.function.arguments || "{}"); } catch { /* the gateway side will say what is wrong */ }
            const name = t.function.name;
            if (name !== "look_at_my_envelope") add({ kind: "call", agent, text: `${agent} ${CALL_WORDS[name] ?? `calls ${name}`} ${describe(name, args)}`.trim() });
            const out = await api("/api/demo/tool", { body: { rootId: id, agent, tool: name, args } });
            const text: string = out.ok ? out.json.text : out.json.error ?? "The gateway did not answer.";
            if (name !== "look_at_my_envelope") add({ kind: "result", text: `Gateway: ${text}`, tone: !out.ok || ["DENIED", "FAILED", "LAPSED"].includes(out.json.status) ? "bad" : out.json.status ? "good" : "info" });
            turns.push({ role: "tool", tool_call_id: t.id, content: text });
            await onChange();
          }
        }
      }
      add({ kind: "stage", text: "Done. Every line above marked Gateway was decided by signatures and arithmetic, not by the model." });
    } catch (e) {
      add({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally { setRunning(false); await onChange(); }
  }

  if (!model) return null;
  return (
    <div className="sheet p-5" data-testid="mission">
      <p className="label">Or hand it to a real model</p>
      {model.available ? (
        <>
          <p className="mt-2 text-sm text-ink-2">A language model ({model.model}) plays each agent and decides what to split, set aside and pay. Its decisions go to the gateway as signed requests. The designer&rsquo;s delivery message carries a planted instruction to pay someone else. Write any brief you like: try to make the agents overspend.</p>
          <label className="label mt-4 block">Your brief to ops-agent<textarea className="field mt-1 min-h-[4.5rem] w-full resize-y !text-[.92rem] !leading-snug" value={brief} maxLength={700} onChange={(e) => setBrief(e.target.value)} disabled={running} /></label>
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" className="mt-1" checked={redteam} onChange={(e) => setRedteam(e.target.checked)} disabled={running} /><span>Finish with a red-team stage: the model is asked to get money out to an address that is not on the envelope. Models sometimes decline; the scripted attacker above never does.</span></label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ink" disabled={running || disabled || !brief.trim()} onClick={run}>{running ? "The model is working…" : "Give the brief to the model"}</button>
            {running && <button type="button" className="btn btn-quiet btn-sm" onClick={() => { stop.current = true; }}>Stop after this step</button>}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-2">No language model is connected to this copy, so the buttons above use scripted agents. Run it locally to watch a real model play the agents (README, &ldquo;Live agents&rdquo;), or give your own agent an envelope with the CLI or MCP server.</p>
      )}
      {lines.length > 0 && (
        <ol className="mt-5 space-y-2 border-l-[1.5px] border-ink pl-4 text-[.86rem] leading-relaxed" aria-live="polite" data-testid="mission-log">
          {lines.map((l, i) => l.kind === "stage" ? <li key={i} className="enter label !text-ink pt-2 first:pt-0">{l.text}</li>
            : l.kind === "say" ? <li key={i} className="enter font-serif italic text-ink-2">&ldquo;{l.text}&rdquo;</li>
            : l.kind === "call" ? <li key={i} className="enter mono text-[.78rem] text-ink">→ {l.text}</li>
            : <li key={i} className={`enter mono text-[.78rem] ${l.kind === "error" || l.tone === "bad" ? "text-red" : l.tone === "good" ? "text-green" : "text-ink-2"}`}>{l.text}</li>)}
        </ol>
      )}
    </div>
  );
}
