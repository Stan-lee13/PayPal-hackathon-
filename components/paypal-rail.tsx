"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Stamp, usd } from "./stationery";

type Call = { id: number; at: string; op: string; text: string; moves: boolean; method: string; path: string; httpStatus: number; paypalStatus: string | null; resourceId: string | null; amountMinor: number | null; debugId: string | null; ms: number; error: string | null; repeat: boolean };
type Rail = {
  mode: string; calls: Call[];
  summary: { total: number; changed: number; asked: number; repeats: number; refused: number; holds: number; captures: number; payouts: number; refunds: number; cancels: number; voids: number };
  events: Array<{ id: string; type: string; source: string; outcome: string; at: string }>;
};

const hms = (iso: string) => new Date(iso).toISOString().slice(11, 19);

/**
 * Everything PayPal did for one envelope, read from the gateway's record of its own PayPal calls.
 * It answers "what is PayPal doing here?" with the calls themselves: the hold, each capture, each
 * payout, every refund and release, and how often PayPal was simply asked.
 */
export function PayPalRail({ id, tick }: { id: string; tick?: unknown }) {
  const [r, setR] = useState<Rail | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(async () => { const x = await api(`/api/envelopes/${id}/paypal`); if (x.ok) setR(x.json); }, [id]);
  useEffect(() => { void load(); }, [load, tick]);
  if (!r || r.calls.length === 0) return null;
  const s = r.summary;
  const shown = all ? r.calls : r.calls.filter((c) => (c.moves && !c.repeat) || c.error);
  const counts: Array<[number, string]> = [[s.holds, s.holds === 1 ? "hold placed" : "holds placed"], [s.captures, s.captures === 1 ? "capture" : "captures"], [s.payouts, s.payouts === 1 ? "payout" : "payouts"], [s.refunds + s.cancels, "taken back"], [s.voids, "release"], [s.asked, "times asked"]];
  return (
    <section className="sheet p-5 sm:p-6" data-testid="paypal-rail" aria-label="What PayPal did">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="label">What PayPal did for this envelope</h2>
        <p className="mono text-[.68rem] text-ink-3">{r.mode === "sandbox" ? "PayPal sandbox · real API calls" : r.mode === "simulated" ? "PayPal simulator" : r.mode}</p>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-6">
        {counts.map(([n, label]) => (
          <div key={label}>
            <dt className="sr-only">{label}</dt>
            <dd><span className={`figure block text-[1.7rem] leading-none tabular-nums ${n === 0 ? "text-ink-3" : label === "times asked" ? "text-ink-2" : "text-blue"}`}>{n}</span><span className="mt-1.5 block text-[.72rem] leading-tight text-ink-2">{label}</span></dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-ink-2">
        Envelope decides who may ask, for how much and for whom. PayPal does the rest: it holds the owner&rsquo;s money, takes exactly what each approved payment needs, delivers it, and gives back what was never spent. Each line below is one call the gateway made to PayPal, with PayPal&rsquo;s own id for it.
      </p>
      <ol className="mt-4 border-t-[1.5px] border-ink" data-testid="paypal-calls">
        {shown.map((c) => {
          const ok = c.httpStatus >= 200 && c.httpStatus < 300;
          return (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-rule py-2.5">
              <p className="min-w-0 text-[.9rem]">
                <span className="mono mr-2 text-[.66rem] text-ink-3">{hms(c.at)}</span>
                <span className={c.moves && !c.repeat ? "title" : "text-ink-2"}>{c.text}</span>
                {c.amountMinor != null && c.moves && !c.repeat && <span className="money ml-2">{usd(c.amountMinor)}</span>}
                {c.repeat && <span className="ml-2 text-xs text-ink-3">same request sent again: PayPal returned its first answer and did nothing new</span>}
              </p>
              <p className="justify-self-end">{ok ? (c.paypalStatus ? <Stamp tone={c.moves && !c.repeat ? "blue" : "grey"} flat>{c.paypalStatus.replace(/_/g, " ")}</Stamp> : null) : <Stamp tone="red" flat>{c.error ?? `HTTP ${c.httpStatus}`}</Stamp>}</p>
              <p className="mono col-span-2 text-[.64rem] leading-snug text-ink-3 [overflow-wrap:anywhere]">{c.method} {c.path} · {c.httpStatus}{c.resourceId ? ` · ${c.resourceId}` : ""}{c.debugId ? ` · debug ${c.debugId}` : ""} · {c.ms} ms</p>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-2">{s.refused > 0 ? `${s.refused} call${s.refused === 1 ? "" : "s"} PayPal refused or could not serve; none of them moved money.` : "PayPal refused none of these calls."}{s.repeats > 0 ? ` ${s.repeats} ${s.repeats === 1 ? "was a retry" : "were retries"} of a request already made: each carries the same idempotency key, so PayPal did nothing twice.` : ""}{r.events.length > 0 ? ` ${r.events.length} event${r.events.length === 1 ? "" : "s"} from PayPal applied.` : ""}</p>
        {s.asked > 0 && <button type="button" className="btn btn-quiet btn-sm !text-[.78rem]" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? "Hide the reads" : `Show all ${r.calls.length} calls`}</button>}
      </div>
    </section>
  );
}
