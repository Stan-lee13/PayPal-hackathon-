"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { fingerprint, PROMISE_VERSION, verifyAccount, verifyChain, verifyDetached, verifyPromise, verifySpend } from "@/lib/envelope/core";
import type { Check, ProofEdge, ProofNode, ProofRow, Tone } from "@/lib/gateway/proof";
import { Sigil, usd } from "@/components/stationery";

type Graph = {
  root: { id: string; title: string; owner: string; ownerKey: string; status: string; limitMinor: number; capturedMinor: number; releasedMinor: number | null; authorizationId: string | null };
  focus: { spend: string; amountMinor: number; payee: string } | null;
  mode: string; gateway: string; at: string;
  rows: ProofRow[]; nodes: ProofNode[]; edges: ProofEdge[];
};
/** What this browser found when it checked a node's evidence itself. */
type Verdict = "checked" | "failed" | "paypal" | "record";
type Asked = { ok: boolean; lines: Array<{ name: string; ok: boolean; detail?: string }> };

const TONE: Record<Tone, { bar: string; text: string }> = {
  ink: { bar: "bg-ink", text: "text-ink" }, blue: { bar: "bg-blue", text: "text-blue" }, green: { bar: "bg-green", text: "text-green" },
  red: { bar: "bg-red", text: "text-red" }, amber: { bar: "bg-amber", text: "text-amber" }, grey: { bar: "bg-ink-3", text: "text-ink-3" },
};
const KIND: Record<ProofNode["kind"], string> = {
  owner: "Person", hold: "PayPal", envelope: "Envelope", refused: "Refused", request: "Payment request", commitment: "Commitment", acceptance: "Acceptance",
  capture: "PayPal", payout: "PayPal", credit: "Ledger", receipt: "Receipt", account: "Account", transfer: "Transfer", card: "Card", charge: "Card charge",
};
const MARK: Record<Verdict, { sign: string; text: string; cls: string }> = {
  checked: { sign: "✓", text: "signature checked here", cls: "text-green" },
  failed: { sign: "✗", text: "did NOT verify", cls: "text-red" },
  paypal: { sign: "◇", text: "PayPal's record", cls: "text-blue" },
  record: { sign: "·", text: "gateway's record", cls: "text-ink-3" },
};
const stamp = (iso: string) => `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${new Date(iso).toISOString().slice(11, 19)} UTC`;

/** Run one check in this browser. Signature checks use the same code the gateway uses; nothing is taken on the server's word. */
async function run(c: Check, ownerKey: string): Promise<Verdict> {
  try {
    if (c.kind === "chain") { const v = await verifyChain(c.chain, new Date(c.at)); return v.ok && v.principal === ownerKey ? "checked" : "failed"; }
    if (c.kind === "request") { const v = await (c.version === PROMISE_VERSION ? verifyPromise : verifySpend)(c.signed as never, new Date(c.at)); return v.ok ? "checked" : "failed"; }
    if (c.kind === "detached") return (await verifyDetached(c.key, c.domain, c.body, c.sig)) ? "checked" : "failed";
    if (c.kind === "account") return (await verifyAccount(c.signed)) ? "checked" : "failed";
    return c.kind;
  } catch { return "failed"; }
}

export function ProofView({ rootId, spendId }: { rootId: string; spendId?: string }) {
  const [g, setG] = useState<Graph | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict[]>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [asked, setAsked] = useState<Record<string, Asked | "asking">>({});
  const [paths, setPaths] = useState<Array<{ key: string; d: string; on: boolean; label: string; x: number; y: number }>>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    void (async () => {
      const r = await api(spendId ? `/api/proof/${rootId}/${spendId}` : `/api/proof/${rootId}`);
      if (!r.ok) { setMissing(r.json.error ?? "No such envelope."); return; }
      const graph = r.json as Graph;
      setG(graph);
      const first = graph.nodes.filter((n) => n.kind === "receipt")[0] ?? graph.nodes[graph.nodes.length - 1];
      setSel(first?.id ?? null);
      const out: Record<string, Verdict[]> = {};
      await Promise.all(graph.nodes.map(async (n) => { out[n.id] = await Promise.all(n.checks.map((c) => run(c, graph.root.ownerKey))); }));
      setVerdicts(out);
    })();
  }, [rootId, spendId]);

  /** Everything the selected record rests on, back to the person. */
  const trail = useMemo(() => {
    const on = new Set<string>();
    if (!g || !sel) return on;
    const stack = [sel];
    while (stack.length) { const id = stack.pop()!; if (on.has(id)) continue; on.add(id); for (const e of g.edges) if (e.to === id) stack.push(e.from); }
    return on;
  }, [g, sel]);

  const draw = useCallback(() => {
    const box = wrap.current?.getBoundingClientRect();
    if (!g || !box) return;
    setPaths(g.edges.flatMap((e) => {
      const a = els.current.get(e.from)?.getBoundingClientRect(), b = els.current.get(e.to)?.getBoundingClientRect();
      if (!a || !b) return [];
      const x1 = a.left + a.width / 2 - box.left, y1 = a.bottom - box.top, x2 = b.left + b.width / 2 - box.left, y2 = b.top - box.top;
      const mid = (y1 + y2) / 2;
      return [{ key: `${e.from}>${e.to}`, d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`, on: trail.has(e.from) && trail.has(e.to), label: e.label, x: (x1 + x2) / 2, y: mid }];
    }));
  }, [g, trail]);
  useLayoutEffect(() => { draw(); }, [draw, verdicts]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrap.current) ro.observe(wrap.current);
    window.addEventListener("resize", draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); };
  }, [draw]);

  async function askPayPal(spend: string) {
    setAsked((a) => ({ ...a, [spend]: "asking" }));
    const r = await api(`/api/spends/${spend}`);
    setAsked((a) => ({ ...a, [spend]: r.ok ? { ok: r.json.ok, lines: (r.json.checks as Asked["lines"]).filter((c) => /PayPal|hold|Credited/.test(c.name)) } : { ok: false, lines: [{ name: r.json.error ?? "PayPal could not be asked just now", ok: false }] } }));
  }

  if (missing) return <p className="sheet p-6 text-sm">{missing} <Link className="link" href="/console">Back to the console</Link>.</p>;
  if (!g) return <p className="label py-10">Gathering the records…</p>;

  const all = Object.values(verdicts).flat();
  const count = (v: Verdict) => all.filter((x) => x === v).length;
  const done = Object.keys(verdicts).length === g.nodes.length;
  const columns = [...new Set(g.nodes.filter((n) => n.column).map((n) => n.column!))];
  const picked = g.nodes.find((n) => n.id === sel) ?? null;
  const worst = (id: string): Verdict | null => { const v = verdicts[id]; return !v ? null : v.includes("failed") ? "failed" : v.includes("checked") ? "checked" : v.includes("paypal") ? "paypal" : "record"; };
  const back = picked ? g.nodes.filter((n) => trail.has(n.id)).sort((a, b) => a.row - b.row) : [];

  return (
    <div className="space-y-8">
      <header className="grid items-end gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="label">Proof graph · <Link className="link" href={`/e/${g.root.id}`}>{g.root.title}</Link>{g.focus ? " · one payment" : ""}</p>
          <h1 className="display mt-2 text-[clamp(2rem,4.6vw,3.3rem)]">{g.focus ? <>This {usd(g.focus.amountMinor)}, <em>traced back to a person.</em></> : <>Every dollar here traces back to <em>one signature.</em></>}</h1>
        </div>
        <p className="text-ink-2">{g.focus
          ? "This page shows one payment and what authorized it: the owner's signature, each envelope it passed through, PayPal's capture and payout. Nothing else about the owner's money is on it."
          : `Each box is a record that exists: a signed envelope, a signed request, a PayPal operation, a ledger entry. Each line is what made the next thing allowed. Pick any box to follow it back to ${g.root.owner}.`}</p>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-5 border-y-[1.5px] border-ink py-5 lg:grid-cols-4" data-testid="proof-summary" aria-live="polite">
        <div><p className="figure text-[2rem] text-green">{done ? count("checked") : "…"}</p><p className="label mt-1">Signatures checked in your browser</p></div>
        <div><p className={`figure text-[2rem] ${count("failed") ? "text-red" : ""}`}>{done ? count("failed") : "…"}</p><p className="label mt-1">Failed to verify</p></div>
        <div><p className="figure text-[2rem] text-blue">{done ? count("paypal") : "…"}</p><p className="label mt-1">PayPal records you can ask about</p></div>
        <div><p className="figure text-[2rem] text-ink-3">{g.nodes.length}</p><p className="label mt-1">Records · {g.mode === "sandbox" ? "PayPal sandbox" : "simulator"}</p></div>
      </section>

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto pb-2">
          <div ref={wrap} className="relative" style={{ minWidth: Math.max(520, columns.length * 150 + 116) }} data-testid="proof-graph">
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              {paths.filter((p) => !p.on).map((p) => <path key={p.key} d={p.d} fill="none" stroke="var(--rule-2)" strokeWidth={1.25} />)}
              {paths.filter((p) => p.on).map((p) => <path key={p.key} d={p.d} fill="none" stroke="var(--ink)" strokeWidth={2.25} />)}
            </svg>
            {paths.filter((p) => p.on).map((p) => <span key={p.key} className="micro pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-paper px-1 !tracking-[.08em] !text-ink" style={{ left: p.x, top: p.y }}>{p.label}</span>)}
            <div className="relative space-y-9">
              {g.rows.map((row) => {
                const inRow = g.nodes.filter((n) => n.row === row.row);
                const grid = inRow.some((n) => n.column);
                return (
                  <div key={row.row} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3">
                    <div><p className="label !text-ink">{row.label}</p><p className="mt-1 text-[.68rem] leading-snug text-ink-3">{row.hint}</p></div>
                    <div className={grid ? "grid gap-3" : "flex flex-wrap justify-center gap-3"} style={grid ? { gridTemplateColumns: `repeat(${columns.length}, minmax(132px, 1fr))` } : undefined}>
                      {inRow.map((n) => {
                        const v = worst(n.id);
                        const on = trail.has(n.id);
                        return (
                          <button key={n.id} type="button" ref={(el) => { if (el) els.current.set(n.id, el); else els.current.delete(n.id); }} onClick={() => setSel(n.id)} aria-pressed={sel === n.id} data-testid={`node-${n.kind}`}
                            style={grid && n.column ? { gridColumnStart: columns.indexOf(n.column) + 1 } : undefined}
                            className={`sheet relative w-full max-w-[220px] justify-self-center overflow-hidden p-2.5 pl-3.5 text-left transition-[opacity,transform,box-shadow] duration-150 ease-out active:scale-[.98] ${grid ? "" : "min-w-[168px]"} ${sel === n.id ? "!border-ink shadow-[0_0_0_1.5px_var(--ink)]" : ""} ${sel && !on ? "opacity-45 hover:opacity-90" : ""}`}>
                            <span className={`absolute inset-y-0 left-0 w-[5px] ${TONE[n.tone].bar}`} />
                            <span className="micro block">{KIND[n.kind]}{v && <span className={`float-right !tracking-normal ${MARK[v].cls}`} title={MARK[v].text}>{MARK[v].sign}</span>}</span>
                            <span className="title mt-1 block text-[.98rem] leading-tight">{n.title}</span>
                            <span className="mono mt-0.5 block truncate text-[.66rem] text-ink-2">{n.subtitle}</span>
                            {n.state && <span className={`mono mt-1.5 block text-[.62rem] font-semibold tracking-[.06em] ${TONE[n.tone].text}`}>{n.state.replace(/_/g, " ")}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
            {(["checked", "paypal", "record"] as Verdict[]).map((v) => <span key={v}><b className={MARK[v].cls}>{MARK[v].sign}</b> {MARK[v].text}</span>)}
            <span>Heavy lines: what the selected record rests on.</span>
          </p>
        </div>

        <aside className="sheet sheet-lift p-5 lg:sticky lg:top-6" data-testid="proof-inspector" aria-live="polite">
          {!picked ? <p className="text-sm text-ink-2">Pick a record.</p> : (
            <>
              <p className="micro">{KIND[picked.kind]}{picked.at ? ` · ${stamp(picked.at)}` : ""}</p>
              <h2 className="title mt-1.5 text-[1.45rem] leading-tight">{picked.title}</h2>
              <p className="mono mt-1 break-all text-[.72rem] text-ink-2">{picked.subtitle}</p>
              {picked.signer && (
                <p className="mt-3 flex items-center gap-2 text-xs text-ink-2"><span className="text-blue"><Sigil k={picked.signer.key} size={26} /></span><span>Signed by <b className="text-ink">{picked.signer.label}</b> <span className="mono">{fingerprint(picked.signer.key)}</span></span></p>
              )}
              <ul className="mt-4 space-y-2 border-t border-rule pt-3 text-[.82rem]">
                {picked.facts.map(([k, v], i) => <li key={i}><span className="label block !text-[.6rem]">{k}</span><span className="break-words">{v}</span></li>)}
              </ul>
              <div className="mt-4 space-y-2.5 border-t border-dashed border-ink pt-3">
                <p className="label">How you know</p>
                {picked.checks.map((c, i) => {
                  const v = verdicts[picked.id]?.[i];
                  const a = c.kind === "paypal" ? asked[c.spend] : undefined;
                  return (
                    <div key={i} className="text-[.82rem]">
                      <p><b className={v ? MARK[v].cls : "text-ink-3"}>{v ? MARK[v].sign : "…"}</b> {c.label}{v === "checked" && <span className="text-green"> · checked in your browser just now</span>}{v === "failed" && <span className="text-red"> · this did not verify</span>}</p>
                      {c.kind === "paypal" && (
                        a && a !== "asking" ? (
                          <ul className="mono mt-1.5 space-y-1 text-[.7rem]" data-testid="paypal-answer">{a.lines.map((l, j) => <li key={j} className={l.ok ? "text-green" : "text-red"}>{l.ok ? "✓" : "✗"} {l.name}{l.detail ? <span className="block text-ink-2">{l.detail}</span> : null}</li>)}</ul>
                        ) : <button type="button" className="btn btn-sm mt-1.5" disabled={a === "asking"} onClick={() => askPayPal(c.spend)}>{a === "asking" ? "Asking PayPal…" : "Ask PayPal now"}</button>
                      )}
                    </div>
                  );
                })}
              </div>
              {back.length > 1 && (
                <div className="mt-4 border-t border-rule pt-3" data-testid="proof-trail">
                  <p className="label">Back to the person</p>
                  <ol className="mt-1.5 space-y-0.5 text-[.8rem]">
                    {back.map((n) => <li key={n.id} className={n.id === picked.id ? "font-semibold" : "text-ink-2"}><button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSel(n.id)}>{KIND[n.kind]} · {n.title}</button></li>)}
                  </ol>
                </div>
              )}
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[.8rem]">
                {picked.href && <Link className="link" href={picked.href}>Open it →</Link>}
                {!g.focus && picked.column && !picked.column.startsWith("refused:") && <Link className="link" href={`/proof/${g.root.id}/${picked.column}`} data-testid="proof-share">A page with only this payment →</Link>}
                {g.focus && <Link className="link" href={`/e/${g.root.id}`}>The envelope →</Link>}
              </p>
            </>
          )}
        </aside>
      </div>

      <p className="max-w-3xl text-xs text-ink-3">What this page can and cannot show. A signature proves who signed and that nothing was changed since; your browser checked those itself with the gateway&rsquo;s public key <span className="mono">{fingerprint(g.gateway)}</span> and the signers&rsquo; own keys. PayPal&rsquo;s side is PayPal&rsquo;s record: press &ldquo;Ask PayPal&rdquo; and the gateway fetches it. A fingerprint of delivered work says which file was accepted, not that the work was good. Records read {stamp(g.at)}.</p>
    </div>
  );
}
