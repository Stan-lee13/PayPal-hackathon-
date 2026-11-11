import { gatewayRunsInBrowser } from "@/lib/deployment";
import { paypalMode } from "@/lib/paypal/client";

/** Always-visible honesty strip: which PayPal is actually in use, and where the gateway is running. */
export function ModeBanner() {
  const local = gatewayRunsInBrowser();
  const pp = local ? "simulated" : paypalMode();
  const sim = pp === "simulated";
  return (
    <div className={`border-b border-ink ${sim ? "bg-red text-sheet" : "bg-ink text-sheet"}`} role="note">
      <div className="micro mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-0.5 px-5 py-1.5 !text-[.6rem] !text-sheet">
        <span>{local ? "Try-it copy · the whole gateway runs in your browser · PayPal simulated · no money moves" : sim ? "PayPal simulated · built-in simulator · no money moves" : pp === "sandbox" ? "PayPal sandbox · real API calls · test money only" : "PayPal live"}</span>
        <span className="opacity-70">{local ? "Real sandbox runs: see the video and docs/evidence" : "Agents hold signed envelopes, never PayPal credentials"}</span>
      </div>
    </div>
  );
}
