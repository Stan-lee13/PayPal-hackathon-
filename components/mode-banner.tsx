import { paypalMode } from "@/lib/paypal/client";
import { aiConfigured, aiModel } from "@/lib/ai/client";

/** Always-visible honesty strip: which PayPal and AI are actually in use. */
export function ModeBanner({ simulatedClockHours }: { simulatedClockHours?: number }) {
  const mode = paypalMode();
  const pp = mode === "simulated"
    ? { text: "SIMULATED PAYPAL — local emulator, no PayPal involved, no money moves", cls: "bg-risk-wash text-risk border-risk" }
    : mode === "sandbox"
      ? { text: "PayPal SANDBOX — test money only", cls: "bg-unverifiable-wash text-ink border-rule" }
      : { text: "PayPal LIVE", cls: "bg-broken-wash text-broken border-broken" };
  return (
    <div className={`border-b text-xs ${pp.cls}`} role="note">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <strong className="font-semibold tracking-wide">{pp.text}</strong>
        <span>AI: {aiConfigured() ? aiModel() : "not configured — deterministic fallbacks (labelled)"}</span>
        {simulatedClockHours ? <span className="font-semibold">Simulated clock: +{simulatedClockHours}h (demo only)</span> : null}
      </div>
    </div>
  );
}
