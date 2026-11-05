/**
 * Minimal, dependency-free PayPal REST client (server-side only).
 *
 * Endpoints used (PayPal REST, verified against paypal/paypal-rest-api-specifications):
 *   POST /v1/oauth2/token                              OAuth client-credentials
 *   POST /v2/checkout/orders                           Orders v2 create (custom_id = Kept order id)
 *   GET  /v2/checkout/orders/{id}
 *   POST /v2/checkout/orders/{id}/capture
 *   POST /v2/checkout/orders/{id}/track                Add shipment tracker
 *   GET  /v2/payments/captures/{id}                    Authoritative capture
 *   POST /v2/payments/captures/{id}/refund             Partial/full refund (PayPal-Request-Id)
 *   GET  /v2/payments/refunds/{id}
 *   GET  /v1/customer/disputes?disputed_transaction_id=
 *   GET  /v1/customer/disputes/{id}
 *   POST /v1/notifications/verify-webhook-signature
 *   POST /v1/notifications/webhooks / GET list
 *
 * Secrets never leave the server. Every mutating call takes an explicit
 * PayPal-Request-Id so retries are idempotent on PayPal's side.
 */
import { setTimeout as sleep } from "node:timers/promises";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
  fetchImpl?: FetchLike;
  /** Retries for network errors / 5xx / 429 on idempotent requests. */
  maxRetries?: number;
};

export class PayPalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly paypalName: string,
    public readonly issue: string | undefined,
    public readonly debugId: string | undefined,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
  }
  /** Retryable = PayPal or the network hiccuped; the request may not have been applied. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function paypalBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

type RequestOptions = {
  body?: unknown;
  /** multipart/form-data body (e.g. Disputes provide-evidence). Mutually exclusive with body. */
  form?: FormData;
  requestId?: string;
  prefer?: "return=representation" | "return=minimal";
  /** Sandbox negative testing only (PayPal-Mock-Response). Ignored on live. */
  mockResponse?: string;
  query?: Record<string, string>;
};

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenInflight: Promise<string> | null = null;
  private readonly fetchImpl: FetchLike;
  readonly baseUrl: string;

  constructor(private readonly cfg: PayPalConfig) {
    this.fetchImpl = cfg.fetchImpl ?? ((i, init) => fetch(i, init));
    this.baseUrl = paypalBaseUrl(cfg.env);
  }

  get env() {
    return this.cfg.env;
  }

  /** Client-credentials token, cached until 60s before expiry; concurrent callers share one fetch. */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = (async () => {
      const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
      const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
      if (!res.ok || !json.access_token) {
        throw new PayPalApiError(res.status, "AUTHENTICATION_FAILURE", undefined, res.headers.get("paypal-debug-id") ?? undefined,
          `PayPal OAuth failed (${res.status}): ${json.error_description ?? "no access token"}`, json);
      }
      this.token = { value: json.access_token, expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 300) - 60) * 1000 };
      return json.access_token;
    })();
    try {
      return await this.tokenInflight;
    } finally {
      this.tokenInflight = null;
    }
  }

  async request<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH", path: string, opts: RequestOptions = {}): Promise<T> {
    // A mutating call is only safely retryable if PayPal can deduplicate it.
    const idempotent = method === "GET" || Boolean(opts.requestId);
    const maxRetries = idempotent ? (this.cfg.maxRetries ?? 2) : 0;
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(method, path, opts);
      } catch (err) {
        const e = err instanceof PayPalApiError ? err : new PayPalApiError(0, "NETWORK_ERROR", undefined, undefined, String(err), null);
        if (e.status === 401 && attempt === 0) {
          this.token = null; // token revoked/expired early
        } else if (!(e.retryable && attempt < maxRetries)) {
          throw e;
        }
        attempt++;
        await sleep(250 * 2 ** attempt);
      }
    }
  }

  private async once<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (!opts.form) headers["Content-Type"] = "application/json";
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    if (opts.mockResponse && this.cfg.env === "sandbox") {
      headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: opts.mockResponse });
    }
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, {
      method,
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    const json = text ? safeJson(text) : {};
    if (!res.ok) {
      const j = json as { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }>; debug_id?: string };
      const issue = j.details?.[0]?.issue;
      throw new PayPalApiError(res.status, j.name ?? `HTTP_${res.status}`, issue, j.debug_id ?? res.headers.get("paypal-debug-id") ?? undefined,
        `${j.name ?? res.status}${issue ? `/${issue}` : ""}: ${j.details?.[0]?.description ?? j.message ?? "PayPal request failed"}`, json);
    }
    return json as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

let shared: PayPalClient | null = null;

export type PayPalMode = "sandbox" | "live" | "simulated";

/**
 * PAYPAL_MODE=sandbox|live uses the real PayPal REST API with PAYPAL_CLIENT_ID/SECRET.
 * PAYPAL_MODE=simulated uses the local emulator (lib/paypal/emulator.ts) — clearly
 * labelled in the UI; webhooks are unsigned and only accepted in this mode.
 * If PAYPAL_MODE is unset: sandbox when credentials exist, otherwise simulated.
 */
export function paypalMode(): PayPalMode {
  const m = process.env.PAYPAL_MODE;
  if (m === "sandbox" || m === "live" || m === "simulated") return m;
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "simulated";
}

export function paypalConfigured(): boolean {
  return paypalMode() === "simulated" || Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/** Process-wide client for the active mode. */
export function getPayPal(): PayPalClient {
  if (!shared) {
    const mode = paypalMode();
    if (mode === "simulated") {
      // lazy import keeps the emulator out of real-mode code paths
      shared = new PayPalClient({ clientId: "SIMULATED", clientSecret: "SIMULATED", env: "sandbox", fetchImpl: (i, init) => import("./emulator").then((m) => m.emulatorFetch(i, init)) });
    } else {
      const clientId = process.env.PAYPAL_CLIENT_ID;
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
      shared = new PayPalClient({ clientId, clientSecret, env: mode });
    }
  }
  return shared;
}

/** Test hook: replace the shared client (e.g. with one backed by a fake transport). */
export function setPayPalForTesting(client: PayPalClient | null) {
  shared = client;
}
