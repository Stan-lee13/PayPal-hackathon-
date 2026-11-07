"use client";

import { useRouter } from "next/navigation";

const OPTS = [["company", "Lagos Roast Coffee · company"], ["chidi", "Chidi Okafor · developer"], ["quickfix", "Quick Fix · developer"]] as const;

/** Demo only: act as the company or one of two developers. */
export function PersonaSwitch({ current }: { current: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-soft">Acting as</span>
      <select className="field w-auto py-1" value={current} onChange={async (e) => {
        await fetch("/api/persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: e.target.value }) });
        router.refresh();
      }}>
        {OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}
