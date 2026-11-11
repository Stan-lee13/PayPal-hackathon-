"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Flap, Meter, Sigil, Stamp, usd } from "@/components/stationery";
import { api } from "@/lib/client/api";

type RootT = { id: string; title: string; principalName: string; createdAt: string; status: string; capturedMinor: number; limitMinor: number; releasedMinor: number | null };
type AgentT = { key: string; label: string; account: string; receives: boolean; envelopes: number };

const when = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${d.toISOString().slice(11, 16)} UTC`; };

/** Envelopes and agents the gateway has on file. */
export function OnFile() {
  const [roots, setRoots] = useState<RootT[] | null>(null);
  const [agents, setAgents] = useState<AgentT[]>([]);
  useEffect(() => {
    void (async () => {
      const [r, a] = await Promise.all([api("/api/envelopes"), api("/api/agents")]);
      setRoots(r.ok ? (r.json.roots as RootT[]).slice(0, 5) : []);
      if (a.ok) setAgents((a.json.agents as AgentT[]).slice(0, 8));
    })();
  }, []);
  return (
    <aside className="space-y-10 lg:pt-10">
      <section>
        <h2 className="label">Envelopes on file</h2>
        {roots === null ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-3">Looking…</p>
          : roots.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">None yet. Seal the first one.</p> : (
            <ul className="mt-4 space-y-4">
              {roots.map((r) => (
                <li key={r.id}>
                  <Link href={`/e/${r.id}`} className={`envl block px-4 pb-3.5 pt-9 transition-transform duration-150 ease-out active:scale-[.985] ${r.status === "ACTIVE" ? "" : "envl-dead"}`}>
                    <Flap />
                    <span className="flex items-end justify-between gap-3">
                      <span className="envl-label min-w-0 px-2.5 py-1.5"><span className="title block truncate text-[1.02rem] leading-tight">{r.title}</span><span className="mono block text-[.66rem] text-ink-2">{r.principalName} · {when(r.createdAt)}</span></span>
                      <span className="shrink-0 text-right"><span className="mono block text-[.78rem]">{usd(r.capturedMinor)} of {usd(r.limitMinor)}</span><Stamp tone={r.status === "ACTIVE" ? "green" : "grey"} className="mt-1">{r.status === "ACTIVE" ? "Open" : "Closed"}</Stamp></span>
                    </span>
                    <span className="mt-2.5 block"><Meter spent={r.capturedMinor} freed={r.releasedMinor ?? 0} of={r.limitMinor} label={`${usd(r.capturedMinor)} of ${usd(r.limitMinor)} spent`} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>
      {agents.length > 0 && (
        <section>
          <h2 className="label">Agents on file</h2>
          <ul className="ledger mt-3 border-t-[1.5px] border-ink">
            {agents.map((a) => (
              <li key={a.key}>
                <Link href={`/a/${a.key}`} className="flex items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-sheet">
                  <span className="text-blue"><Sigil k={a.key} size={34} /></span>
                  <span className="min-w-0 flex-1"><span className="title block truncate">{a.label}</span><span className="mono block text-[.68rem] tracking-[.06em] text-ink-2">{a.account}{a.receives ? " · can be paid" : ""}</span></span>
                  <span className="mono text-[.7rem] text-ink-3">passport →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
