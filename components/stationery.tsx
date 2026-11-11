/**
 * The stationery kit. Everything on screen is made from these few objects: a rubber stamp, a
 * postmark, a kraft envelope, a ruler, an agent passport and its engraved sigil. No hooks, so both
 * server and client components can use them.
 */
import type { ReactNode } from "react";
import { accountNumber, unb64u } from "@/lib/envelope/core";

type Tone = "green" | "red" | "blue" | "amber" | "grey";

/** Define once per page (in the layout): the worn-ink filter the stamps use. */
export function InkDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <filter id="ink" x="-6%" y="-12%" width="112%" height="124%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="7" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -5.2 3.5" result="wear" />
        <feComposite in="SourceGraphic" in2="wear" operator="in" result="worn" />
        <feDisplacementMap in="worn" in2="n" scale="1.4" />
      </filter>
      {/* small type needs lighter wear to stay legible */}
      <filter id="ink-s" x="-4%" y="-10%" width="108%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.6 3.1" result="wear" />
        <feComposite in="SourceGraphic" in2="wear" operator="in" result="worn" />
        <feDisplacementMap in="worn" in2="n" scale="0.6" />
      </filter>
    </svg>
  );
}

export function Stamp({ tone, children, size, flat, land, className = "" }: { tone: Tone; children: ReactNode; size?: "lg"; flat?: boolean; land?: boolean; className?: string }) {
  return <span className={`stamp stamp-${tone} ${size === "lg" ? "stamp-lg" : ""} ${flat ? "stamp-flat" : ""} ${land ? "thunk" : ""} ${className}`}>{children}</span>;
}

const SPEND: Record<string, { text: string; tone: Tone }> = {
  PAID: { text: "Paid", tone: "green" },
  PAYOUT_PENDING: { text: "Paid · in transit", tone: "green" },
  UNCLAIMED: { text: "Paid · unclaimed", tone: "green" },
  DENIED: { text: "Denied", tone: "red" },
  FAILED: { text: "Failed · refunded", tone: "amber" },
  RESERVED: { text: "In flight", tone: "blue" },
  CAPTURED: { text: "In flight", tone: "blue" },
  PROMISED: { text: "Set aside", tone: "blue" },
  LAPSED: { text: "Released", tone: "grey" },
};
export function SpendStamp({ status, land }: { status: string; land?: boolean }) {
  const s = SPEND[status] ?? { text: status, tone: "grey" as Tone };
  return <Stamp tone={s.tone} land={land}>{s.text}</Stamp>;
}

/** A round cancellation mark, the kind a post office puts over a stamp. */
export function Postmark({ top, bottom, line1, line2, tone = "blue", size = 120, className = "" }: { top: string; bottom: string; line1: string; line2?: string; tone?: Tone; size?: number; className?: string }) {
  const id = `pm-${(top + bottom + line1).replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
  return (
    <svg viewBox="0 0 170 120" width={size * 1.42} height={size} className={`stamp-${tone} ${className}`} style={{ filter: "url(#ink)", mixBlendMode: "multiply" }} role="img" aria-label={`${top} ${line1} ${line2 ?? ""} ${bottom}`}>
      <defs>
        <path id={`${id}-t`} d="M 14 60 A 46 46 0 0 1 106 60" />
        <path id={`${id}-b`} d="M 10 60 A 50 50 0 0 0 110 60" />
      </defs>
      <g fill="none" stroke="currentColor">
        <circle cx="60" cy="60" r="56" strokeWidth="2.6" />
        <circle cx="60" cy="60" r="34" strokeWidth="1.4" />
        {[38, 50, 62, 74, 86].map((y, i) => <path key={y} d={`M 112 ${y} q 9 -6 18 0 t 18 0 t ${i % 2 ? 16 : 12} 0`} strokeWidth="2" strokeLinecap="round" />)}
      </g>
      <g fill="currentColor" fontFamily="var(--font-mono)" fontWeight="600">
        <text fontSize="9.5" letterSpacing="2.2"><textPath href={`#${id}-t`} startOffset="50%" textAnchor="middle">{top}</textPath></text>
        <text fontSize="9.5" letterSpacing="2.2"><textPath href={`#${id}-b`} startOffset="50%" textAnchor="middle" dominantBaseline="hanging">{bottom}</textPath></text>
        <text x="60" y={line2 ? 58 : 63} fontSize="10.5" textAnchor="middle" letterSpacing=".6">{line1}</text>
        {line2 && <text x="60" y="71" fontSize="8.5" textAnchor="middle" letterSpacing=".8">{line2}</text>}
      </g>
    </svg>
  );
}

/** The V of an envelope's flap. Put it first inside an element with class "envl". */
export function Flap() {
  return (
    <svg className="envl-flap" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0 L50 19 L100 0 Z" fill="var(--kraft-2)" opacity=".55" />
      <path d="M0 0 L50 19 L100 0" fill="none" stroke="var(--kraft-3)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A ruler that fills. Colour comes from the text colour around it. */
export function Meter({ spent, held = 0, freed = 0, of, label }: { spent: number; held?: number; freed?: number; of: number; label: string }) {
  const pct = (n: number) => `${of > 0 ? Math.max(0, Math.min(100, (n / of) * 100)) : 0}%`;
  return <div className="meter" role="img" aria-label={label}><i className="meter-spent" style={{ width: pct(spent) }} /><i className="meter-held" style={{ width: pct(held) }} /><i className="meter-freed" style={{ width: pct(freed) }} /></div>;
}

function keyBytes(k: string): number[] {
  try { return [...unb64u(k)]; } catch { return [...k].map((c) => c.charCodeAt(0)); }
}

/** An engraved rosette drawn from the agent's public key: its face. Same key, same sigil, always. */
export function Sigil({ k, size = 96, className = "" }: { k: string; size?: number; className?: string }) {
  const b = keyBytes(k);
  const at = (i: number) => b[i % Math.max(1, b.length)] ?? 0;
  const layer = (i: number) => {
    const petals = 5 + (at(i) % 11);
    const R = 38 - i * 9.5;
    const amp = 3 + (at(i + 5) % 6) + (2 - i);
    const phase = (at(i + 9) / 255) * Math.PI * 2;
    const twist = 1 + (at(i + 13) % 3);
    let d = "";
    for (let s = 0; s <= 360; s++) {
      const t = (s / 360) * Math.PI * 2;
      const r = R + amp * Math.sin(petals * t + phase) * Math.cos(twist * t);
      d += `${s === 0 ? "M" : "L"}${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
    }
    return d + "Z";
  };
  // lines are drawn in viewBox units, so a small sigil needs heavier ones to stay visible
  const w = size >= 90 ? 1 : size >= 50 ? 1.5 : 2.6;
  return (
    <svg viewBox="-50 -50 100 100" width={size} height={size} className={className} aria-hidden="true">
      <circle r="48.5" fill="none" stroke="currentColor" strokeWidth={0.7 * w} />
      {size >= 50 && <circle r="46" fill="none" stroke="currentColor" strokeWidth=".35" strokeDasharray="1 1.6" />}
      {[0, 1, 2].map((i) => <path key={i} d={layer(i)} fill="none" stroke="currentColor" strokeWidth={(0.75 - i * 0.12) * w} opacity={1 - i * 0.12} />)}
      {size >= 50 && [0, 1, 2].map((i) => <path key={`e${i}`} d={layer(i)} fill="none" stroke="currentColor" strokeWidth=".3" opacity=".55" transform={`rotate(${7 + at(20 + i) % 23})`} />)}
      <circle r={3 + (at(3) % 4)} fill="currentColor" opacity=".85" />
    </svg>
  );
}

const mrz = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "<");

/** The agent's identity document. */
export function Passport({ k, label, sponsors, state, since, children, compact }: { k: string; label: string; sponsors?: string[]; state?: { text: string; tone: Tone }; since?: string; children?: ReactNode; compact?: boolean }) {
  const acct = accountNumber(k);
  const line1 = `AG<ENVELOPE<<${mrz(label)}`.padEnd(40, "<").slice(0, 40);
  const line2 = `${acct.replace(/-/g, "")}<${mrz(k).slice(0, 26)}`.padEnd(40, "<").slice(0, 40);
  return (
    <div className="passport">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 240" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => <path key={i} d={`M -10 ${20 + i * 14} C 60 ${-4 + i * 14}, 120 ${44 + i * 14}, 200 ${20 + i * 14} S 340 ${-4 + i * 14}, 410 ${20 + i * 14}`} fill="none" stroke="#1F3FA8" strokeOpacity={i % 2 ? 0.07 : 0.11} strokeWidth=".7" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <Sigil k={k} size={260} className="pointer-events-none absolute -right-16 -top-14 text-[#1F3FA8] opacity-[.09]" />
      <div className={`relative ${compact ? "p-4" : "p-5 sm:p-6"}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="micro !text-[#3D5347]">Envelope · Agent passport</p>
          {state && <Stamp tone={state.tone}>{state.text}</Stamp>}
        </div>
        <div className={`mt-3 flex items-center ${compact ? "gap-3" : "gap-4 sm:gap-6"}`}>
          <div className="shrink-0 rounded-md border border-[#B9C9BE] bg-white/60 p-1.5 text-[#1F3FA8]"><Sigil k={k} size={compact ? 66 : 104} /></div>
          <div className="min-w-0">
            <p className={`title truncate ${compact ? "text-xl" : "text-2xl sm:text-3xl"}`}>{label}</p>
            <p className="micro mt-2 !text-[#3D5347]">Account no.</p>
            <p className={`mono font-semibold tracking-[.08em] ${compact ? "text-sm" : "text-lg"}`}>{acct}</p>
            {sponsors && sponsors.length > 0 && <>
              <p className="micro mt-2 !text-[#3D5347]">Stands behind it</p>
              <p className="text-sm">{sponsors.join("  →  ")}</p>
            </>}
            {since && <p className="micro mt-2 !text-[#3D5347]">On file since {since}</p>}
          </div>
        </div>
        {children}
      </div>
      <div className="passport-mrz px-5 py-2" aria-hidden="true"><div>{line1}</div><div>{line2}</div></div>
    </div>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
        <rect x="1" y="1" width="24" height="18" rx="1.5" fill="var(--kraft)" stroke="var(--ink)" strokeWidth="1.5" />
        <path d="M1.5 2 L13 11.5 L24.5 2" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="13" cy="12.6" r="2.4" fill="var(--red)" />
      </svg>
      <span className="title text-[1.32rem] leading-none">Envelope</span>
    </span>
  );
}

export const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "$112" and ".00" set apart, the way a cheque writes a figure. */
export function Figure({ minor, className = "" }: { minor: number; className?: string }) {
  const [whole, cents] = usd(minor).split(".");
  return <span className={`figure ${className}`}>{whole}<span className="text-[.52em] align-[.62em] ml-[.06em] tracking-normal">{cents}</span></span>;
}
