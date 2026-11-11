"use client";

/**
 * How pages talk to the gateway. Normally that is this site's HTTP API. When the site was deployed
 * without a database, the gateway itself is loaded into the browser and called directly: same code,
 * same rules, PayPal simulated, nothing leaves the tab.
 */
export type ApiResult<T = any> = { ok: boolean; status: number; json: T }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const gatewayInBrowser = (): boolean => typeof document !== "undefined" && document.documentElement.dataset.gateway === "browser";

export async function api<T = any>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<ApiResult<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  if (gatewayInBrowser()) {
    const { dispatch } = await import("../local/router");
    const out = await dispatch(method, path, init.body === undefined ? undefined : JSON.parse(JSON.stringify(init.body)));
    // Same shape a network round trip would give: dates become strings.
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: JSON.parse(JSON.stringify(out.body)) as T };
  }
  const r = await fetch(path, { method, cache: "no-store", headers: init.body === undefined ? undefined : { "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  let json: unknown = null;
  try { json = await r.json(); } catch { json = { error: "The gateway did not answer." }; }
  return { ok: r.ok, status: r.status, json: json as T };
}
