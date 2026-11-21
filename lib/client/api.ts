"use client";

/**
 * How pages talk to the gateway. Normally that is this site's HTTP API. When the site was deployed
 * without a database, the gateway itself is loaded into the browser and called directly: same code,
 * same rules, PayPal simulated, nothing leaves the tab.
 */
export type ApiResult<T = any> = { ok: boolean; status: number; json: T }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const gatewayInBrowser = (): boolean => typeof document !== "undefined" && document.documentElement.dataset.gateway === "browser";

export async function api<T = any>(path: string, init: { method?: "GET" | "POST"; body?: unknown; /** Sent only over the network. The in-browser gateway is the simulator, which asks for no key. */ headers?: Record<string, string> } = {}): Promise<ApiResult<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  if (gatewayInBrowser()) {
    const { dispatch } = await import("../local/router");
    // If the in-browser gateway has not answered in a while, the page says so (components/gateway-stall.tsx) rather than sit silent.
    const slow = setTimeout(() => window.dispatchEvent(new Event("envelope:stalled")), 20_000);
    let out: Awaited<ReturnType<typeof dispatch>>;
    try { out = await dispatch(method, path, init.body === undefined ? undefined : JSON.parse(JSON.stringify(init.body))); }
    finally { clearTimeout(slow); }
    window.dispatchEvent(new Event("envelope:answered"));
    // Same shape a network round trip would give: dates become strings.
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: JSON.parse(JSON.stringify(out.body)) as T };
  }
  let r: Response;
  // A request that never reached the gateway is an answer too: the caller shows it and its button comes back, instead of a rejected promise leaving the page busy.
  try { r = await fetch(path, { method, cache: "no-store", headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }); }
  catch { return { ok: false, status: 0, json: { error: "The gateway could not be reached. Check the connection and try again; nothing was changed by this attempt unless the page says otherwise." } as T }; }
  let json: unknown = null;
  try { json = await r.json(); } catch { json = { error: "The gateway did not answer." }; }
  return { ok: r.ok, status: r.status, json: json as T };
}
