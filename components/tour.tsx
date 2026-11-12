"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * The two-minute tour: a strip along the bottom that says what to press next, rings the button, and
 * moves on when the step has really happened (the gateway's records or the page say so, not a timer).
 * It starts from the landing page or from any address with ?tour=1, and remembers where it is in this
 * browser. It only points: every press is the visitor's, on the same controls everyone else uses.
 */
type State = { step: number; env: string | null; base: number };
type Ctx = { path: string; state: State; envelope: () => Promise<{ root: { status: string; capturedMinor: number }; spends: Array<{ status: string }> } | null> };
type Step = {
  title: string;
  /** What to press, once on the right page. */
  press: string;
  /** Where this step happens, and whether we are there. */
  href: (s: State) => string;
  here: (path: string, s: State) => boolean;
  /** The control to ring. The first one found is used. */
  target: string[];
  done: (c: Ctx) => Promise<boolean> | boolean;
};

const KEY = "envelope:tour";
const has = (sel: string) => Boolean(document.querySelector(sel));
/** The agents have stopped working: the button that set them going can be pressed again (or is gone). */
const idle = (sel: string) => !(document.querySelector(sel) as HTMLButtonElement | null)?.textContent?.includes("…");
const onEnvelope = (path: string, s: State) => (s.env ? path === `/e/${s.env}` : path.startsWith("/e/"));
const envHref = (s: State) => (s.env ? `/e/${s.env}` : "/console");

const STEPS: Step[] = [
  { title: "You sign. PayPal holds the money.", press: "Press “Seal & hold on PayPal”. Your browser signs the limits, and PayPal places one hold for the whole budget.", href: () => "/console", here: (p) => p === "/console", target: ['[data-tour="seal"]'], done: ({ path }) => path.startsWith("/e/") },
  { title: "Agents split the budget and pay.", press: "Press “Run the launch”. Three agents cut smaller envelopes for each other and pay from that one hold.", href: envHref, here: onEnvelope, target: ['[data-tour="run"]'], done: async ({ envelope }) => idle('[data-tour="run"]') && ((await envelope())?.root.capturedMinor ?? 0) > 0 },
  { title: "Now try to rob it.", press: "Press “Compromise the creative agent”. Each attempt is refused with its reason, and no money moves.", href: envHref, here: onEnvelope, target: ['[data-tour="attack"]'], done: async ({ envelope, state }) => idle('[data-tour="attack"]') && ((await envelope())?.spends.filter((s) => s.status === "DENIED").length ?? 0) > state.base },
  { title: "Trace one payment back to your signature.", press: "Open any “Receipt & authority chain”. Your browser checks every signature itself, and PayPal is asked about the hold.", href: envHref, here: onEnvelope, target: ['[data-tour="receipt"]'], done: ({ path }) => path.startsWith("/r/") },
  { title: "Check the books against PayPal.", press: "Press “Compare with PayPal”. Every capture and payout is looked up on PayPal’s own statement.", href: () => "/bank", here: (p) => p === "/bank", target: ['[data-testid="bank-statement"] button'], done: () => has('[data-testid="bank-position"]') },
  { title: "Let an agent audit the agents.", press: "Press “A payer disputes the latest payment”, then “Audit”. The auditor asks PayPal through PayPal’s own Agent Toolkit. It can only read and propose.", href: () => "/auditor", here: (p) => p === "/auditor", target: ['[data-testid="auditor-stage-dispute"]:not([data-staged])', '[data-testid="auditor-run-model"]', '[data-testid="auditor-run"]'], done: () => has('[data-testid="auditor-report"]') },
  { title: "Close the envelope.", press: "Press “Close envelope & release the hold”. PayPal releases whatever was never spent.", href: envHref, here: onEnvelope, target: ['[data-tour="close"]'], done: async ({ envelope }) => (await envelope())?.root.status === "CLOSED" },
];

function load(): State | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null; return s && typeof s.step === "number" ? s : null; } catch { return null; }
}
function save(s: State | null) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: the tour then lasts one page */ }
}

export function Tour() {
  const path = usePathname();
  const [state, setState] = useState<State | null>(null);
  const [ticked, setTicked] = useState(false);
  const ringed = useRef<Element | null>(null);
  const set = useCallback((s: State | null) => { save(s); setState(s); }, []);

  // Start from ?tour=1 or from a button anywhere on the site; otherwise pick up where this browser left off.
  useEffect(() => {
    const wants = new URLSearchParams(location.search).get("tour") === "1";
    const kept = load();
    if (wants && (!kept || kept.step >= STEPS.length)) set({ step: 0, env: null, base: 0 });
    else if (kept) setState(kept);
    const start = () => set({ step: 0, env: null, base: 0 });
    window.addEventListener("envelope:tour", start);
    return () => window.removeEventListener("envelope:tour", start);
  }, [set]);

  const step = state && state.step < STEPS.length ? STEPS[state.step]! : null;
  const here = Boolean(step && state && step.here(path, state));

  // Has the step happened? Asked of the page and of the gateway's records, every second and a half.
  useEffect(() => {
    if (!state || !step) return;
    let stop = false;
    const envelope = async () => { if (!state.env) return null; const r = await api(`/api/envelopes/${state.env}`); return r.ok ? r.json : null; };
    const check = async () => {
      if (stop) return;
      let done = false;
      try { done = await step.done({ path, state, envelope }); } catch { /* ask again */ }
      if (stop || !done) return;
      stop = true;
      const env = state.env ?? (path.startsWith("/e/") ? path.split("/")[2] ?? null : null);
      // the next step, "try to rob it", counts refusals from here on
      let base = 0;
      if (state.step === 1 && env) { const r = await api(`/api/envelopes/${env}`); base = r.ok ? (r.json.spends as Array<{ status: string }>).filter((s) => s.status === "DENIED").length : 0; }
      setTicked(true);
      setTimeout(() => { setTicked(false); set({ step: state.step + 1, env, base }); }, 900);
    };
    const t = setInterval(() => void check(), 1500);
    void check();
    return () => { stop = true; clearInterval(t); };
  }, [state, step, path, set]);

  // Ring the control to press, and bring it into view once.
  useEffect(() => {
    const clear = () => { ringed.current?.removeAttribute("data-tour-on"); ringed.current = null; };
    if (!step || !here || ticked) { clear(); return; }
    let scrolled = false;
    const ring = () => {
      const el = step.target.map((sel) => document.querySelector(sel)).find(Boolean) ?? null;
      if (el === ringed.current) return;
      clear();
      if (!el) return;
      el.setAttribute("data-tour-on", "");
      ringed.current = el;
      if (!scrolled) { scrolled = true; el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
    };
    const t = setInterval(ring, 600);
    ring();
    return () => { clearInterval(t); clear(); };
  }, [step, here, ticked]);

  useEffect(() => {
    if (state) document.documentElement.dataset.tour = "on"; else delete document.documentElement.dataset.tour;
  }, [state]);

  if (!state) return null;
  const n = STEPS.length;
  const finished = state.step >= n;

  return (
    <aside className="tour" aria-label="Guided tour" data-testid="tour">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="mono text-[.66rem] uppercase tracking-[.16em] opacity-70">{finished ? "Tour done" : `Tour · ${state.step + 1} of ${n}`}</span>
          <span className="flex gap-1" aria-hidden>
            {STEPS.map((_, i) => <span key={i} className={`tour-dot ${i < state.step ? "is-done" : i === state.step ? "is-now" : ""}`} />)}
          </span>
        </div>
        <div className="min-w-0 flex-1 basis-72" aria-live="polite">
          {finished ? (
            <p className="text-[.92rem]"><strong className="font-semibold">That was the whole loop.</strong> <span className="opacity-80">One budget: signed by you, held at PayPal, split and spent by agents, attacked, traced, checked against PayPal, audited by an agent, closed.</span></p>
          ) : ticked ? (
            <p className="text-[.95rem] font-semibold" data-testid="tour-tick">✓ Done. {step!.title}</p>
          ) : (
            <p className="text-[.92rem] leading-snug"><strong className="font-semibold">{step!.title}</strong> <span className="opacity-80">{here ? step!.press : "This step is on another page."}</span></p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {finished ? <Link className="tour-btn tour-btn-main" href="/#rail" onClick={() => set(null)}>What is proven where →</Link>
            : !here && !ticked ? <Link className="tour-btn tour-btn-main" href={step!.href(state)} data-testid="tour-go">Take me there →</Link>
            : null}
          {!finished ? <button type="button" className="tour-btn" onClick={() => set({ ...state, step: state.step + 1 })} data-testid="tour-skip">Skip</button> : null}
          <button type="button" className="tour-btn" onClick={() => set(null)} aria-label="End the tour" data-testid="tour-end">{finished ? "Close" : "End"}</button>
        </div>
      </div>
    </aside>
  );
}

/** A button that starts the tour from wherever it is placed. */
export function TourStart({ className = "btn", children = "Take the two-minute tour" }: { className?: string; children?: React.ReactNode }) {
  return <Link className={className} href="/console?tour=1" onClick={() => window.dispatchEvent(new Event("envelope:tour"))} data-testid="tour-start">{children}</Link>;
}
