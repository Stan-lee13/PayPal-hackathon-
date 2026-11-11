import { paypalMode } from "@/lib/paypal/client";

/** Always-visible honesty strip: which PayPal is actually in use. */
export function ModeBanner() {
  const pp = paypalMode();
  const sim = pp === "simulated";
  return (
    <div className={`border-b text-xs ${sim ? "bg-blocked-wash text-ink border-rule" : "bg-sunken text-ink-soft border-rule"}`} role="note">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <span className={sim ? "font-semibold" : ""}>
          {sim ? "PayPal: SIMULATED (built-in simulator, no PayPal involved, no money moves)" : pp === "sandbox" ? "PayPal: SANDBOX — real PayPal API calls, test money only" : "PayPal: LIVE"}
        </span>
        <span>Agents never hold PayPal credentials: only signed envelopes.</span>
      </div>
    </div>
  );
}
