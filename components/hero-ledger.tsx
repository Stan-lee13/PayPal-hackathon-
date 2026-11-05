"use client";

import { useState } from "react";

/**
 * The whole product in one card, played once: what was promised, what PayPal was about to
 * charge, Kept stamping the capture BLOCKED, the corrected order, and the seal turning KEPT.
 * CSS keyframes with delays (off the main thread); replay remounts the card.
 */
const d = (ms: number) => ({ animationDelay: `${ms}ms` });

export function HeroLedger() {
  const [run, setRun] = useState(0);
  return (
    <div className="relative">
      <div key={run} className="seq paper paper-lift overflow-hidden" aria-label="Example: Kept blocks a capture that contradicts the promise, then the corrected order is kept">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3">
          <p className="eyebrow">Example · Adaeze Studio checkout</p>
          <span className="mono text-[0.7rem] text-ink-soft">PayPal order read by GET</span>
        </div>

        <div className="grid gap-0 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4 p-5">
            <div className="seq" style={d(250)}>
              <p className="eyebrow">Said · AI sales assistant</p>
              <p className="quote mt-1 text-2xl leading-snug">&ldquo;Your total is <span className="money">$84.00</span>.&rdquo;</p>
            </div>
            <div className="seq flex items-baseline justify-between gap-3 rounded-lg bg-broken-wash px-3 py-2" style={d(750)}>
              <span className="text-sm">PayPal order, before capture</span>
              <span className="money whitespace-nowrap text-lg font-semibold">$93.33 <span className="ml-1 rounded-full bg-[var(--paper-raised)] px-1.5 py-0.5 text-xs text-broken">+$9.33</span></span>
            </div>
            <div className="seq flex items-baseline justify-between gap-3 rounded-lg bg-kept-wash px-3 py-2" style={d(1850)}>
              <span className="text-sm">Corrected order · approved by the buyer</span>
              <span className="money text-lg font-semibold">$84.00</span>
            </div>
          </div>

          <div className="relative flex min-h-28 items-center justify-center border-t border-[var(--hairline)] bg-paper px-6 sm:border-l sm:border-t-0">
            <div className="grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1">
              <span className="seq-stamp" style={d(1250)}>
                <span className="seq-out inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-broken bg-broken-wash px-3 py-1.5 text-sm font-semibold uppercase tracking-wider text-broken" style={d(2350)}>
                  <span aria-hidden="true">✕</span> Capture blocked
                </span>
              </span>
              <span className="seq-stamp flex flex-col items-center gap-1.5" style={d(2450)}>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-kept bg-kept-wash px-3 py-1.5 text-sm font-semibold uppercase tracking-wider text-kept"><span aria-hidden="true">✓</span> Kept</span>
                <span className="text-[0.7rem] text-ink-soft">after blocking $93.33</span>
              </span>
            </div>
          </div>
        </div>

        <div className="seq flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline)] px-5 py-3 text-xs text-ink-soft" style={d(2700)}>
          <span>Nothing was charged until the amount matched the promise.</span>
          <span className="mono">every step hash-chained</span>
        </div>
      </div>
      <button type="button" onClick={() => setRun((r) => r + 1)} className="btn mt-3 min-h-9 px-3 py-1 text-xs">Replay</button>
    </div>
  );
}
