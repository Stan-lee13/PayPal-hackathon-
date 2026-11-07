"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InvoiceCard, StatusChip, type InvoiceView } from "@/components/invoice-card";

type DemoState = {
  modes: { paypal: string; github: string };
  contract: { repo: string; title: string; client: string; company: string | null; clientEmail: string; accepted: string | null; clientLink: string; prices: Array<{ issue: string; price: string }> };
  pr: { number: number; title: string; state: string; merged: boolean; headSha: string; url: string; comments: Array<{ id: number; body: string; at: string }> } | null;
  invoice: InvoiceView | null;
};
type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: unknown };
type Entry =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string; tool?: { name: string; request: unknown; response: unknown }; invoice?: InvoiceView; error?: boolean }
  | { kind: "event"; text: string; tone: "good" | "bad" | "info" };

export function Playground({ paypal, github }: { paypal: string; github: string }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [prNo, setPrNo] = useState<number | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lastStatus = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (pr?: number | null) => {
    const r = await fetch(`/api/demo/state${pr ? `?pr=${pr}` : ""}`, { cache: "no-store" });
    if (!r.ok) { setProblem((await r.json().catch(() => ({}))).error ?? "The demo isn't available right now."); return null; }
    const s = (await r.json()) as DemoState;
    setState(s);
    if (s.pr && !pr) setPrNo(s.pr.number);
    return s;
  }, []);

  useEffect(() => { void load(null); }, [load]);

  // Watch for PayPal → MergePay → GitHub happening on its own (webhook), and narrate it.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || !prNo) return;
      const s = await load(prNo);
      const st = s?.invoice?.status ?? null;
      const prev = lastStatus.current;
      if (prev === "SENT" && st && st !== "SENT") {
        if (st === "MERGED") push({ kind: "event", tone: "good", text: `PayPal webhook INVOICING.INVOICE.PAID → MergePay re-read the invoice from PayPal: PAID, nothing due → merged commit ${s!.invoice!.commit.slice(0, 7)} into ${s!.contract.repo}.` });
        else if (st === "MERGE_BLOCKED") push({ kind: "event", tone: "bad", text: `PayPal webhook INVOICING.INVOICE.PAID → paid, but not merged: ${s!.invoice!.blockReason}` });
        else if (st === "PAID") push({ kind: "event", tone: "info", text: "PayPal confirmed payment; merging…" });
      }
      lastStatus.current = st;
    }, 2500);
    return () => clearInterval(t);
  }, [prNo, load]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [log.length]);

  function push(e: Entry) { setLog((l) => [...l, e]); }

  async function tool(prompt: string, name: string, args: Record<string, unknown>, lead: string) {
    setBusy(name); setProblem(null);
    push({ kind: "you", text: prompt });
    try {
      const r = await fetch("/api/demo/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) });
      const j = await r.json();
      if (!r.ok) { push({ kind: "agent", text: j.error ?? "That didn't work.", error: true }); return; }
      const res = j.response.result as ToolResult;
      const sc = res.structuredContent as (InvoiceView & { id?: string }) | undefined;
      const invoice = sc && typeof sc.id === "string" && sc.id.startsWith("inv_") ? (sc as InvoiceView) : undefined;
      const text = res.isError ? res.content[0]?.text ?? "Error" : invoice ? lead : res.content.map((c) => c.text).join("\n");
      push({ kind: "agent", text, tool: { name, request: j.request, response: j.response }, invoice, error: res.isError });
      const s = await load(prNo);
      lastStatus.current = s?.invoice?.status ?? null;
    } finally { setBusy(null); }
  }

  async function post(url: string, body: unknown, label: string) {
    setBusy(label); setProblem(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem(j.error ?? "That didn't work."); return null; }
      return j;
    } finally { setBusy(null); }
  }

  if (!state) return <div className="card p-6 text-sm text-ink-soft">{problem ?? "Loading the demo…"}</div>;
  const { contract, pr, invoice } = state;
  const sim = { paypal: paypal === "simulated", github: github === "simulated" };
  const n = pr?.number ?? prNo;
  const token = contract.clientLink.split("/").pop()!;

  const chips: Array<{ label: string; run: () => void; primary?: boolean }> = [];
  if (pr && pr.state === "open" && !invoice) chips.push({ primary: true, label: `Bill ${contract.company ?? contract.client} for PR #${n}`, run: () => tool(`Bill ${contract.company ?? contract.client} for PR #${n}`, "draft_invoice", { repo: contract.repo, pr: n }, `Here's the draft, priced from your contract with ${contract.company ?? contract.client}. Nothing has been sent yet. Send it?`) });
  if (invoice?.status === "DRAFT") {
    chips.push({ primary: true, label: "Looks right — send it", run: () => tool("Looks right, send it.", "send_invoice", { invoice_id: invoice.id, confirm: true }, `Sent through PayPal to ${contract.clientEmail}. The PR will merge by itself once PayPal confirms the payment in full.`) });
    chips.push({ label: "Refresh the draft", run: () => tool("Refresh that draft.", "draft_invoice", { repo: contract.repo, pr: invoice.pr }, "Refreshed from the PR and the contract.") });
  }
  if (invoice?.status === "SENT") {
    chips.push({ label: `Has ${contract.client.split(" ")[0]} paid?`, run: () => tool(`Has ${contract.client.split(" ")[0]} paid yet?`, "invoice_status", { invoice_id: invoice.id }, "Checked with PayPal.") });
    if (sim.github) chips.push({ label: "Sneak in one more commit", run: async () => { if (await post("/api/demo/late-commit", { pr: invoice.pr }, "late")) { push({ kind: "event", tone: "info", text: `A new commit was pushed to PR #${invoice.pr} after the invoice went out. The client only agreed to pay for ${invoice.commit.slice(0, 7)}.` }); await load(prNo); } } });
  }
  if (invoice && ["MERGED", "MERGE_BLOCKED", "CANCELLED"].includes(invoice.status) || pr?.state === "closed") {
    chips.push({ primary: true, label: "Start again with a new pull request", run: async () => { const j = await post("/api/demo/new-pr", {}, "newpr"); if (j) { setLog([]); setPrNo(j.pr); lastStatus.current = null; await load(j.pr); push({ kind: "event", tone: "info", text: `New pull request #${j.pr} in ${j.repo}, closing issues #${j.issues.join(" and #")} (agreed prices copied from the contract).` }); } } });
  }
  chips.push({ label: "What are my contracts?", run: () => tool("What are my contracts?", "list_contracts", {}, "") });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* The editor */}
      <section aria-label="Agent conversation" className="code card-lift flex min-h-[560px] flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-code-soft">
          <span className="flex gap-1.5" aria-hidden="true"><i className="h-2.5 w-2.5 rounded-full bg-white/15" /><i className="h-2.5 w-2.5 rounded-full bg-white/15" /><i className="h-2.5 w-2.5 rounded-full bg-white/15" /></span>
          <span className="ml-2">Agent · MCP server <span className="text-code-ink">mergepay</span> connected</span>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 font-sans text-sm" aria-live="polite">
          {log.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-code-soft">
              <p className="text-code-ink">You just opened PR #{n} in <span className="mono">{contract.repo}</span>. It closes two issues {contract.company} agreed to pay for, and also changes some analytics code nobody asked for.</p>
              <p className="mt-2">Ask the agent to bill it. {contract.accepted ? null : <span className="text-[#F2B15A]">First, the client needs to accept the merge-on-payment terms (right panel).</span>}</p>
            </div>
          )}
          {log.map((e, i) => <Bubble key={i} e={e} />)}
          {busy && <p className="text-code-soft"><span className="mono">…</span> {busy === "draft_invoice" ? "reading the PR and the contract" : busy === "send_invoice" ? "creating the PayPal invoice" : "working"}</p>}
          <div ref={endRef} />
        </div>
        <div className="border-t border-white/10 p-3">
          <div className="flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <button key={i} type="button" disabled={Boolean(busy)} onClick={c.run}
                className={`btn btn-sm ${c.primary ? "btn-primary" : "border-white/15 bg-white/5 text-code-ink"}`}>{c.label}</button>
            ))}
          </div>
          {problem && <p role="alert" className="mt-2 text-xs text-[#FF8A7F]">{problem}</p>}
        </div>
      </section>

      {/* What actually happened */}
      <aside className="space-y-4" aria-label="What happened">
        <div className="card p-4">
          <p className="eyebrow">Contract</p>
          <p className="mt-1 font-semibold">{contract.title}</p>
          <p className="text-sm text-ink-soft">{contract.client}, {contract.company} · <span className="mono">{contract.repo}</span></p>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {contract.prices.slice(0, 4).map((p) => <li key={p.issue} className="kbd">#{p.issue} {p.price}</li>)}
            {contract.prices.length > 4 && <li className="text-ink-soft">+{contract.prices.length - 4} more</li>}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {contract.accepted
              ? <span className="chip chip-PAID">Client accepted merge-on-payment</span>
              : <>
                  <span className="chip chip-MERGE_BLOCKED">Client hasn&rsquo;t accepted yet</span>
                  <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(busy)} onClick={async () => { if (await post("/api/contracts/accept", { token }, "accept")) { push({ kind: "event", tone: "good", text: `${contract.client} accepted: a PR merges once its invoice is paid in full, and only the commit that was invoiced.` }); await load(prNo); } }}>Accept as {contract.client.split(" ")[0]}</button>
                </>}
            <a className="link text-xs" href={contract.clientLink} target="_blank" rel="noreferrer">Client&rsquo;s page ↗</a>
          </div>
        </div>

        {pr && (
          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">Pull request</p>
              <span className={`chip ${pr.merged ? "chip-MERGED" : pr.state === "open" ? "chip-SENT" : "chip-DRAFT"}`}>{pr.merged ? "Merged" : pr.state === "open" ? "Open" : "Closed"}</span>
            </div>
            <p className="mt-1 font-semibold">#{pr.number} {pr.title}</p>
            <p className="text-xs text-ink-soft">head <span className="mono">{pr.headSha.slice(0, 7)}</span> · <a className="link" href={pr.url} target="_blank" rel="noreferrer">{sim.github ? "open simulated PR ↗" : "open on GitHub ↗"}</a></p>
            {pr.comments.length > 0 && (
              <ul className="mt-3 space-y-2">
                {pr.comments.slice(-2).map((c) => <li key={c.id} className="rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed">{c.body.split("\n\n")[0]!.replace(/\*\*/g, "").replace(/`/g, "")}</li>)}
              </ul>
            )}
          </div>
        )}

        {invoice && (
          <div className="space-y-2">
            <InvoiceCard inv={invoice} compact />
            {invoice.status === "SENT" && invoice.paypal?.payerUrl && (
              <div className="card enter p-4 text-sm">
                <p className="font-semibold">Now pay it as the client</p>
                <p className="mt-1 text-ink-soft">{sim.paypal ? "This opens the simulated PayPal page (no money moves)." : "This opens the real PayPal sandbox invoice. Log in with the sandbox buyer account from the testing instructions."} Come back here: the merge shows up by itself.</p>
                <a className="btn btn-primary mt-3" href={invoice.paypal.payerUrl} target="_blank" rel="noreferrer">Open the PayPal invoice ↗</a>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Bubble({ e }: { e: Entry }) {
  if (e.kind === "you") return <div className="enter ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[#2a2f45] px-3.5 py-2 text-code-ink">{e.text}</div>;
  if (e.kind === "event") {
    const c = e.tone === "good" ? "border-[#4FD1A1]/40 text-[#9be8c8]" : e.tone === "bad" ? "border-[#F2B15A]/50 text-[#f6cf93]" : "border-white/15 text-code-soft";
    return <p className={`enter rounded-lg border border-dashed px-3 py-2 text-xs ${c}`}>{e.text}</p>;
  }
  return (
    <div className="enter space-y-2">
      {e.tool && <ToolCall t={e.tool} error={e.error} />}
      {e.text && <p className={`whitespace-pre-wrap ${e.error ? "text-[#FF8A7F]" : "text-code-ink"}`}>{e.text}</p>}
      {e.invoice && <div className="text-ink"><InvoiceCard inv={e.invoice} /></div>}
    </div>
  );
}

function ToolCall({ t, error }: { t: { name: string; request: unknown; response: unknown }; error?: boolean }) {
  const args = (t.request as { params: { arguments: unknown } }).params.arguments;
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs text-code-soft">
        <span className={error ? "text-[#FF8A7F]" : "text-[#9be8c8]"}>{error ? "✕" : "✓"}</span>
        <span className="mono text-code-ink">{t.name}</span>
        <span className="mono truncate">{JSON.stringify(args)}</span>
        <span className="ml-auto shrink-0 group-open:hidden">show MCP call</span>
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-white/10 px-3 py-2 text-[11px] leading-snug text-code-soft">{`→ ${JSON.stringify(t.request, null, 2)}\n\n← ${JSON.stringify(t.response, null, 2).slice(0, 6000)}`}</pre>
    </details>
  );
}
