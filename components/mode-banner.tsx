import { paypalMode } from "@/lib/paypal/client";
import { githubMode } from "@/lib/github/client";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { dailyBudgetUsd, spentTodayUsd } from "@/lib/ai/budget";

/** Always-visible honesty strip: which PayPal, GitHub and AI are actually in use. */
export async function ModeBanner() {
  const pp = paypalMode();
  const gh = githubMode();
  const simulated = pp === "simulated" || gh === "simulated";
  const parts = [
    pp === "simulated" ? "PayPal: SIMULATED (built-in, no money moves)" : pp === "sandbox" ? "PayPal: SANDBOX (test money)" : "PayPal: LIVE",
    gh === "simulated" ? "GitHub: SIMULATED repo" : "GitHub: live API",
    aiConfigured() ? `AI: Claude ${aiModel()} · ${await budgetLine()}` : "AI: rules only (no Claude key)",
  ];
  return (
    <div className={`border-b text-xs ${simulated ? "bg-blocked-wash text-ink border-rule" : "bg-sunken text-ink-soft border-rule"}`} role="note">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        {parts.map((p, i) => <span key={i} className={i === 0 && pp === "simulated" ? "font-semibold" : ""}>{p}</span>)}
      </div>
    </div>
  );
}

async function budgetLine(): Promise<string> {
  const cap = dailyBudgetUsd().toFixed(2);
  try {
    return `$${(await spentTodayUsd()).toFixed(2)} of $${cap} daily cap`;
  } catch {
    return `capped at $${cap}/day`;
  }
}
