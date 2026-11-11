import type { GatewayReason } from "./types";

/**
 * The one error the SDK throws.
 *
 * - `kind: "local"`   refused before anything was signed or sent (a bad amount, no envelope held, a split that widens).
 * - `kind: "network"` the gateway could not be reached, or did not answer in time.
 * - `kind: "gateway"` the gateway answered and the thing asked for did not happen.
 *
 * For a refusal by the gateway, `outcome` is its verdict ("DENIED", "FAILED", "LAPSED") and `reasons`
 * says why, with stable codes such as `PAYEE_NOT_ALLOWED` or `OVER_ENVELOPE_LIMIT`. A denial moves no money.
 */
export class EnvelopeError extends Error {
  readonly kind: "local" | "network" | "gateway";
  /** HTTP status from the gateway; 0 when there was no answer or nothing was sent. */
  readonly status: number;
  /** The gateway's verdict when it gave one, e.g. "DENIED". */
  readonly outcome: string | null;
  readonly reasons: GatewayReason[];
  /** The gateway's answer, unchanged, when there was one. */
  readonly body: unknown;

  constructor(message: string, init: { kind: EnvelopeError["kind"]; status?: number; outcome?: string | null; reasons?: GatewayReason[]; body?: unknown }) {
    super(message);
    this.name = "EnvelopeError";
    this.kind = init.kind;
    this.status = init.status ?? 0;
    this.outcome = init.outcome ?? null;
    this.reasons = init.reasons ?? [];
    this.body = init.body;
  }

  /** Reason codes only. */
  get codes(): string[] { return this.reasons.map((r) => r.code); }
  /** True when the gateway refused the request on its merits. Nothing moved. */
  get denied(): boolean { return this.outcome === "DENIED"; }
  /**
   * True when sending the same thing again might work: the gateway was unreachable, busy or rate limiting.
   * The SDK already resends the identical signed request a few times in that case, which can never pay twice.
   */
  get retryable(): boolean { return this.kind === "network" || this.status === 429 || this.status === 503; }
  /** What the gateway said, or the HTTP status when it said nothing. */
  get detail(): string {
    const e = (this.body as { error?: unknown } | null | undefined)?.error;
    return typeof e === "string" ? e : String(this.status);
  }
  has(code: string): boolean { return this.reasons.some((r) => r.code === code); }
}

export const refuseLocally = (message: string, code = "INVALID_INPUT"): EnvelopeError =>
  new EnvelopeError(message, { kind: "local", outcome: "REFUSED_LOCALLY", reasons: [{ code, detail: message }] });
