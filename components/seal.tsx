import type { CommitmentState } from "@/lib/db/schema";

const SEALS: Record<CommitmentState, { label: string; icon: string; cls: string; desc: string }> = {
  KEPT: { label: "Kept", icon: "✓", cls: "text-kept bg-kept-wash border-kept", desc: "PayPal records show the promise was kept" },
  AT_RISK: { label: "At risk", icon: "◷", cls: "text-risk bg-risk-wash border-risk", desc: "Deadline approaching without evidence" },
  BROKEN: { label: "Broken", icon: "✕", cls: "text-broken bg-broken-wash border-broken", desc: "PayPal records contradict the promise" },
  UNVERIFIABLE: { label: "Unverifiable", icon: "?", cls: "text-unverifiable bg-unverifiable-wash border-unverifiable", desc: "Cannot be checked against PayPal records; not enforced" },
  NEEDS_CONFIRMATION: { label: "Needs confirmation", icon: "!", cls: "text-risk bg-paper border-risk border-dashed", desc: "Ambiguous; the merchant must confirm before it is enforced" },
  PENDING: { label: "Watching", icon: "…", cls: "text-ink-soft bg-paper border-rule", desc: "Waiting for PayPal evidence or a deadline" },
  WAIVED: { label: "Waived", icon: "–", cls: "text-ink-soft bg-paper border-rule", desc: "Waived by the merchant" },
};

export function StateSeal({ state, size = "md", stamp = false }: { state: CommitmentState; size?: "sm" | "md" | "lg"; stamp?: boolean }) {
  const s = SEALS[state];
  const pad = size === "lg" ? "px-3 py-1.5 text-sm" : size === "sm" ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs";
  return (
    <span title={s.desc} className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wider whitespace-nowrap ${pad} ${s.cls} ${stamp ? "stamp" : ""}`}>
      <span aria-hidden="true">{s.icon}</span>
      <span>{s.label}</span>
      <span className="sr-only">: {s.desc}</span>
    </span>
  );
}

export function sealLabel(state: CommitmentState) {
  return SEALS[state].label;
}
