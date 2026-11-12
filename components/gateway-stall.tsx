"use client";

import { useEffect, useState } from "react";

/**
 * The try-it copy keeps its database in the browser and shares it between tabs. If another tab of this
 * site is closed or reloaded at the wrong moment, the shared database can be left waiting on it, and
 * every request here stalls. When a request has gone unanswered for a while, say so and say what to do.
 */
export function GatewayStall() {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const on = () => setStalled(true), off = () => setStalled(false);
    window.addEventListener("envelope:stalled", on);
    window.addEventListener("envelope:answered", off);
    return () => { window.removeEventListener("envelope:stalled", on); window.removeEventListener("envelope:answered", off); };
  }, []);
  if (!stalled) return null;
  return (
    <div role="alert" className="sheet fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl border-l-[5px] !border-l-amber p-4 text-sm shadow-lg" data-testid="gateway-stall">
      <p className="title text-[1.05rem]">The gateway in this browser has stopped answering.</p>
      <p className="mt-1.5 text-ink-2">This copy keeps its database in your browser and shares it between tabs. If this site is open in another tab, close that tab, then reload this one. Nothing is lost: everything is stored in the browser.</p>
      <p className="mt-3"><button type="button" className="btn btn-sm btn-ink" onClick={() => window.location.reload()}>Reload this tab</button></p>
    </div>
  );
}
