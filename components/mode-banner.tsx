import { paypalMode } from "@/lib/paypal/client";

/** Always-visible honesty strip: which PayPal is actually in use. */
export function ModeBanner() {
  const pp = paypalMode();
  const sim = pp === "simulated";
  return (
    <div className={`border-b border-ink ${sim ? "bg-red text-sheet" : "bg-ink text-sheet"}`} role="note">
      <div className="micro mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-0.5 px-5 py-1.5 !text-[.6rem] !text-sheet">
        <span>{sim ? "PayPal simulated · built-in simulator · no money moves" : pp === "sandbox" ? "PayPal sandbox · real API calls · test money only" : "PayPal live"}</span>
        <span className="opacity-70">Agents hold signed envelopes, never PayPal credentials</span>
      </div>
    </div>
  );
}
