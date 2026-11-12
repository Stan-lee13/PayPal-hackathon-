/**
 * PayPal's own Agent Toolkit (@paypal/agent-toolkit), with its hands tied to reading.
 *
 * Out of the box the toolkit gives a model PayPal credentials and up to 47 tools, among them
 * create_order, pay_order and create_refund. That is the arrangement Envelope exists to replace for
 * agents that spend. It is the right tool for a different job: an agent on the operator's side that
 * audits what the spending agents did, by asking PayPal directly.
 *
 * So the toolkit runs here, inside the gateway, under three restrictions that do not depend on the
 * model or on the toolkit's own configuration:
 *
 *   1. It is given no credential. Its access token is a placeholder; every request it builds is
 *      carried by the gateway's one PayPal client (./client.ts), which holds the real one.
 *   2. Only the tools named in TOOLKIT_READS can be run. Any other name is refused before the
 *      toolkit is called.
 *   3. Whatever tool asked, the carrier sends only GET requests to the paths in READ_PATHS. A
 *      toolkit tool that tried to write would be stopped here, with no request sent.
 *
 * The same code runs against the sandbox, live PayPal and the built-in simulator, because the
 * carrier is the gateway's client in every mode.
 */
import type { AxiosAdapter, AxiosStatic, InternalAxiosRequestConfig } from "axios";
import shared from "./axios-shared.cjs";
import { getPayPal, PayPalApiError } from "./client";

/** The toolkit tools the auditor may run. All of them are reads. */
export const TOOLKIT_READS = ["list_transactions", "list_disputes", "get_dispute", "get_order", "get_refund"] as const;
export type ToolkitRead = (typeof TOOLKIT_READS)[number];

/** The toolkit's own switchboard, set to the same list (its product.action names). */
const ACTIONS = { transactions: { list: true }, disputes: { list: true, get: true }, orders: { get: true }, payments: { getRefunds: true } };

/** What the carrier will send to PayPal on the toolkit's behalf. GET only. */
export const READ_PATHS: RegExp[] = [
  /^\/v1\/reporting\/transactions$/,
  /^\/v1\/customer\/disputes$/,
  /^\/v1\/customer\/disputes\/[A-Za-z0-9_-]{1,255}$/,
  /^\/v2\/checkout\/orders\/[A-Z0-9]{8,36}$/,
  /^\/v2\/payments\/refunds\/[A-Za-z0-9_-]{8,36}$/,
];
const PAYPAL_HOSTS = new Set(["api.sandbox.paypal.com", "api.paypal.com", "api-m.sandbox.paypal.com", "api-m.paypal.com"]);
const NO_CREDENTIAL = "held-by-the-gateway";

export type CarriedRequest = { method: string; path: string; sent: boolean; status: number };
let watcher: ((r: CarriedRequest) => void) | null = null;
/** Tests and the evidence script watch what the toolkit tried to send. */
export function watchToolkit(fn: ((r: CarriedRequest) => void) | null) { watcher = fn; }

let installed = false;
/** Route the toolkit's HTTP (it uses the shared axios instance) through the gateway's PayPal client. Other hosts are untouched. */
function installCarrier() {
  if (installed) return;
  installed = true;
  const axios = shared as unknown as AxiosStatic;
  const { AxiosError } = axios;
  const usual = axios.getAdapter(axios.defaults.adapter as Parameters<typeof axios.getAdapter>[0]);
  const carrier: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = new URL(axios.getUri(config));
    if (!PAYPAL_HOSTS.has(url.host)) return usual(config);
    const method = (config.method ?? "get").toUpperCase();
    const answer = (status: number, data: unknown) => ({ data, status, statusText: "", headers: {}, config, request: {} });
    if (method !== "GET" || !READ_PATHS.some((p) => p.test(url.pathname))) {
      watcher?.({ method, path: url.pathname, sent: false, status: 403 });
      throw new AxiosError("The gateway carries reads only.", "ERR_BAD_REQUEST", config, {}, answer(403, { name: "NOT_PERMITTED_BY_GATEWAY", message: `Envelope's gateway does not send ${method} ${url.pathname} for the auditor. It carries reads only; nothing was sent to PayPal.` }));
    }
    try {
      const data = await getPayPal().request("GET", url.pathname, { query: Object.fromEntries(url.searchParams) });
      watcher?.({ method, path: url.pathname, sent: true, status: 200 });
      return answer(200, data);
    } catch (e) {
      const status = e instanceof PayPalApiError ? e.status : 0;
      watcher?.({ method, path: url.pathname, sent: true, status });
      if (e instanceof PayPalApiError && status) throw new AxiosError(e.message, "ERR_BAD_RESPONSE", config, {}, answer(status, e.body));
      throw new AxiosError(e instanceof Error ? e.message : "PayPal did not answer", "ERR_NETWORK", config, {});
    }
  };
  axios.defaults.adapter = carrier;
}

type Kit = { tools: Array<{ method: string; name: string; description: string; parameters: unknown }>; run: (method: string, args: unknown) => Promise<string> };
let kit: Promise<Kit> | null = null;
function getKit(): Promise<Kit> {
  kit ??= (async () => {
    installCarrier();
    const { PayPalMCPToolkit } = await import("@paypal/agent-toolkit/mcp");
    const { paypalMode } = await import("./client");
    const tk = new PayPalMCPToolkit({ accessToken: NO_CREDENTIAL, configuration: { actions: ACTIONS, context: { sandbox: paypalMode() !== "live" } } });
    const api = tk.getPaypalAPIService();
    return { tools: tk.getTools(), run: (m, a) => api.run(m, a) };
  })();
  return kit;
}

export type ToolkitTool = { tool: ToolkitRead; title: string; description: string; parameters: Record<string, unknown> };

/** The read tools, described in PayPal's own words (name, description and parameters come from the toolkit). */
export async function toolkitTools(): Promise<ToolkitTool[]> {
  const [{ tools }, { zodToJsonSchema }] = await Promise.all([getKit(), import("zod-to-json-schema")]);
  return tools.filter((t) => (TOOLKIT_READS as readonly string[]).includes(t.method)).map((t) => {
    const { $schema: _s, ...parameters } = zodToJsonSchema(t.parameters as Parameters<typeof zodToJsonSchema>[0], { $refStrategy: "none" }) as Record<string, unknown>;
    return { tool: t.method as ToolkitRead, title: t.name, description: String(t.description).trim(), parameters };
  });
}

export type ToolkitAnswer = { ok: true; tool: ToolkitRead; data: unknown } | { ok: false; tool: string; refused: boolean; error: string };

/** Run one toolkit tool. Anything outside TOOLKIT_READS is refused here; the toolkit is not called. */
export async function toolkitRead(tool: string, args: unknown): Promise<ToolkitAnswer> {
  if (!(TOOLKIT_READS as readonly string[]).includes(tool)) return { ok: false, tool, refused: true, error: `"${tool}" is not a tool the auditor has. It can read from PayPal (${TOOLKIT_READS.join(", ")}); it cannot create, pay, refund or change anything.` };
  const k = await getKit();
  const def = k.tools.find((t) => t.method === tool);
  // the toolkit's own schema fills in its defaults and rejects malformed ids before any request is built
  const parsed = (def?.parameters as { safeParse?: (x: unknown) => { success: boolean; data?: unknown; error?: { issues?: Array<{ path: Array<string | number>; message: string }> } } } | undefined)?.safeParse?.(args ?? {});
  if (parsed && !parsed.success) return { ok: false, tool, refused: false, error: `Invalid arguments: ${(parsed.error?.issues ?? []).slice(0, 3).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` };
  const out = JSON.parse(await k.run(tool, parsed?.data ?? args ?? {})) as Record<string, unknown> | null;
  // the toolkit reports a failure as { error: { message } } or as { ok: false, code, message }
  if (out && typeof out === "object" && (out.error || out.ok === false)) {
    const e = (out as { error?: { message?: string }; message?: string }).error?.message ?? (out as { message?: string }).message ?? "PayPal refused the request";
    return { ok: false, tool, refused: false, error: String(e).slice(0, 300) };
  }
  return { ok: true, tool: tool as ToolkitRead, data: out };
}

/** Every tool name the installed toolkit knows, whatever its configuration. Used to prove the refusals. */
export async function everyToolkitTool(): Promise<string[]> {
  installCarrier();
  const { PayPalMCPToolkit } = await import("@paypal/agent-toolkit/mcp");
  const all = new Proxy({}, { get: () => new Proxy({}, { get: () => true }), has: () => true, ownKeys: () => [] });
  return new PayPalMCPToolkit({ accessToken: NO_CREDENTIAL, configuration: { actions: all as never, context: { sandbox: true } } }).getTools().map((t) => t.method);
}

/** Test hook: run a toolkit tool with no allowlist, to show the carrier stops a write on its own. */
export async function runUnguardedForTesting(tool: string, args: unknown): Promise<string> {
  installCarrier();
  const { PayPalAPI } = await import("@paypal/agent-toolkit/mcp");
  return new PayPalAPI(NO_CREDENTIAL, { sandbox: true }).run(tool, args);
}
