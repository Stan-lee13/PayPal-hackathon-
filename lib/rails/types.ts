/**
 * Provider-neutral financial rail contracts.
 *
 * Envelope's authority engine (`lib/envelope/core.ts`) and its budget engine
 * (`lib/gateway/service.ts`) do not need to know who moves the money. They need five things:
 * a hold that can back a budget, a capture that takes exactly what was authorized, a payout that
 * reaches a payee, a refund that gives money back, and a read-back of what the provider actually did.
 * This file is that contract, expressed as capabilities rather than as one enormous interface, because
 * rails genuinely differ:
 *
 *   • an authorization-hold rail can guarantee that a capture cannot exceed the hold;
 *   • a payout rail can pay out, but may not be able to reverse what it paid;
 *   • a ledger-only rail (an internal reservation) guarantees nothing outside this database;
 *   • custody and card issuing belong to a regulated partner and are not capabilities of a payment API.
 *
 * The rule that matters: **a rail must never report a guarantee it does not have.** A rail that cannot
 * hold funds cannot back an envelope; the gateway asks `rail.can("funding.authorize-hold")` before it
 * seals one, and the contract tests call every method a rail says it does not support and require an
 * explicit `UnsupportedCapabilityError` — never a silent success.
 *
 * Nothing here names a provider. PayPal appears only in `lib/rails/paypal-rail.ts`.
 */

/** An identifier a rail is registered under. Free-form so a partner integration can add its own. */
export type RailId = string;

/** What the rail is connected to. `mock` never leaves the process; `simulated` is a local emulator. */
export type RailMode = "sandbox" | "live" | "simulated" | "mock";

/**
 * One thing a rail may be able to do. Capabilities are declared, never inferred: a rail that lists
 * `hold.capture` must implement a real capture, and one that does not list it must refuse.
 */
export type Capability =
  /** Place a provider-side hold for a budget. The provider refuses captures beyond it. */
  | "funding.authorize-hold"
  /** Give the payer a link to approve a hold in the provider's own checkout. */
  | "funding.approval-link"
  /** Fund a hold without a payer present (sandbox/test instruments only; never live money). */
  | "funding.test-instrument"
  /** Read a hold's current state from the provider. */
  | "hold.read"
  /** Capture part of a hold, leaving the rest in place. */
  | "hold.capture"
  /** Release what is left of a hold. */
  | "hold.void"
  /** Send money to a payee. */
  | "payout.send"
  /** Read a payout's state from the provider. */
  | "payout.read"
  /** Cancel a payout the payee has not claimed. */
  | "payout.cancel"
  /** Refund a capture to the payer's funding source. */
  | "refund.capture"
  /** Read the provider's reported balance for this account. */
  | "reporting.balance"
  /** Read the provider's own statement of the account. */
  | "reporting.statement"
  /** Verify that an inbound event really came from the provider. */
  | "events.verify"
  /** List the events the provider says it reported. */
  | "events.list"
  /** Read disputes the payer raised. */
  | "dispute.read"
  /** Answer a dispute with evidence. Moves no money. */
  | "dispute.respond"
  /** Give back the calls this rail made for a set of domain records, for the audit trail a person reads. */
  | "observability.trail";

/**
 * What a rail actually guarantees, in words a risk officer can check.
 * The gateway's marketing and its receipts must not claim more than this set.
 */
export type Guarantee =
  /** The provider holds funds: a capture cannot exceed the authorized amount. */
  | "authorization-hold"
  /** A payout can be taken back while it is unclaimed. */
  | "reversible-payout"
  /** Amounts are reserved in this gateway's books only. No provider-side hold exists. */
  | "internal-reservation"
  /** Money held for others is safeguarded by a regulated institution. No adapter here has this. */
  | "safeguarded-funds"
  /** Network cards issued by a regulated issuer. Envelope's signed cards are not this. */
  | "card-issuing";

/** The kinds of identifier a rail hands back. Stored in today's columns by id; see the migration plan. */
export type RefKind = "order" | "authorization" | "capture" | "refund" | "payout" | "payout_item" | "dispute" | "event";

/**
 * A provider's identifier, with the provider named. `id` is opaque: never parse it, never build it.
 * Legacy columns (`roots.authorization_id`, `spends.capture_id`, …) hold `ref.id`; which rail produced
 * it is recorded in `lib/rails/paypal-rail.ts`'s docs and will move to its own column in migration 0009.
 */
export type RailRef<K extends RefKind = RefKind> = { readonly provider: RailId; readonly kind: K; readonly id: string };

export function railRef<K extends RefKind>(provider: RailId, kind: K, id: string): RailRef<K> {
  if (!provider || !id) throw new Error("A rail reference needs a provider and an id.");
  return Object.freeze({ provider, kind, id });
}

/** The id inside a reference, for the columns that already exist. */
export const refId = (r: RailRef | null | undefined): string | null => (r ? r.id : null);

/** An amount: integer minor units and an explicit currency. Never a float, never a bare number. */
export type Amount = { readonly minor: number; readonly currency: string };

export function amount(minor: number, currency: string): Amount {
  if (!Number.isSafeInteger(minor)) throw new Error(`Money must be an integer number of minor units, got ${minor}`);
  if (minor < 0) throw new Error(`A rail amount cannot be negative, got ${minor}`);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`A rail amount needs an ISO-4217 currency, got ${currency}`);
  return Object.freeze({ minor, currency });
}

// ---------------------------------------------------------------------------
// Requests. Every mutating call carries a `reference`: the domain's idempotency key. It is the spend,
// transfer, promise or envelope id that caused the call, and the same reference must never produce a
// second effect, however many times it is presented and whatever the network did in between.
// ---------------------------------------------------------------------------

export type AuthorizeHoldRequest = {
  /** Domain idempotency key, e.g. the root envelope id. */
  reference: string;
  title: string;
  amount: Amount;
};

export type ApprovalRequestArgs = AuthorizeHoldRequest & { returnUrl: string; cancelUrl: string };

export type CaptureRequest = {
  hold: RailRef<"authorization">;
  reference: string;
  amount: Amount;
  note: string;
};

export type VoidRequest = { hold: RailRef<"authorization">; reference: string };

export type PayoutRequest = {
  reference: string;
  receiver: string;
  amount: Amount;
  note: string;
};

export type RefundRequest = {
  capture: RailRef<"capture">;
  reference: string;
  note: string;
};

export type WebhookRequest = {
  /** Provider signature headers, exactly as received. */
  headers: Record<string, string>;
  /** The body byte for byte: providers sign the bytes they sent, not a re-serialization. */
  rawBody: string;
  /** The endpoint's own id at the provider (PayPal calls this the webhook id). */
  endpointId: string;
};

export type StatementRange = { from: Date; to: Date };

// ---------------------------------------------------------------------------
// Facts. What the provider says happened, in neutral terms. Status strings are the provider's own,
// passed through unmapped on purpose: the gateway's state machine (`payoutState`, `PAYOUT_DEAD`) is
// where their meaning lives, and a rail must not silently reinterpret them.
// ---------------------------------------------------------------------------

export type HoldFacts = {
  ref: RailRef<"authorization">;
  orderRef: RailRef<"order"> | null;
  status: string;
  amount: Amount;
  expiresAt: string | null;
  /** The reference the hold was placed for, as the provider echoes it back. */
  externalRef: string | null;
};

export type OrderFacts = {
  ref: RailRef<"order">;
  status: string;
  intent: string | null;
  externalRef: string | null;
  amount: Amount | null;
  payerId: string | null;
  payerEmail: string | null;
};

export type ApprovalFacts = { orderRef: RailRef<"order">; status: string; approvalUrl: string };

export type CaptureFacts = {
  ref: RailRef<"capture">;
  status: string;
  amount: Amount;
  externalRef: string | null;
};

export type PayoutFacts = {
  batchRef: RailRef<"payout">;
  itemRef: RailRef<"payout_item"> | null;
  batchStatus: string;
  itemStatus: string | null;
  transactionId: string | null;
  receiver: string | null;
  /** The provider's own error name when it could not deliver, e.g. RECEIVER_UNREGISTERED. */
  error: string | null;
};

export type RefundFacts = { ref: RailRef<"refund">; status: string };

export type BalanceFacts = {
  currency: string;
  totalMinor: number;
  availableMinor: number;
  withheldMinor: number;
  asOf: string | null;
  accountId: string | null;
};

/** One line of the provider's statement. `amountMinor` is signed (money out is negative). */
export type StatementLine = {
  id: string;
  code: string;
  at: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  status: string | null;
  invoiceId: string | null;
  customField: string | null;
  reference: string | null;
};

/**
 * One call a rail made, as a person should read it. Bodies are never included: a provider request can
 * carry a funding instrument. `moved` distinguishes "asked" from "changed something".
 */
export type RailCall = {
  at: string;
  /** The provider operation, in this adapter's own vocabulary (e.g. `hold.place`, `capture`). */
  op: string;
  /** The same operation in words a person reads, built by the adapter. */
  text: string;
  /** True when the operation changes something at the provider, as opposed to asking. */
  moves: boolean;
  /** The same request sent again (a retry): the provider answered as it did the first time and did nothing new. */
  repeat: boolean;
  method: string;
  path: string;
  httpStatus: number;
  /** The provider's status for the object it was asked about, when it gave one. */
  providerStatus: string | null;
  /** The provider's refusal, as `NAME/ISSUE` or `HTTP n`. Null when the call succeeded. */
  error: string | null;
  /** The provider's own id for debugging this call, when it issues one. */
  providerDebugId: string | null;
  resourceId: string | null;
  amountMinor: number | null;
  currency: string | null;
  ms: number;
  requestId: string | null;
};

export type DisputeFacts = {
  ref: RailRef<"dispute">;
  status: string;
  reason: string | null;
  stage: string | null;
  amountMinor: number | null;
  currency: string | null;
  createdAt: string | null;
  /** Provider transaction ids (captures) the dispute is about. */
  transactionIds: string[];
};

export type RailEvent = {
  id: string;
  type: string;
  createdAt: string | null;
  resource: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Errors. One vocabulary for every rail, so the gateway's recovery paths do not have to know which
// provider refused. `retryable` means exactly what it means in `lib/paypal/client.ts`: the call may or
// may not have been applied, so the same reference must be presented again before anything is undone.
// ---------------------------------------------------------------------------

export type RailErrorCode =
  /** The rail does not have this capability. It did nothing. */
  | "unsupported_capability"
  /** The request is malformed or impossible for this rail (wrong currency, missing amount). */
  | "invalid_request"
  /** The provider refused: the operation did not happen and will not happen for this reference. */
  | "declined"
  /** The provider says this reference already produced its effect. */
  | "duplicate"
  /** The provider has no such record. */
  | "not_found"
  /**
   * The provider is not able to answer yet (a batch it is still closing, a settlement window that has
   * not opened). The caller's next step is to try the same reference again shortly; nothing is undone.
   */
  | "not_ready"
  /** The provider would not authenticate us. */
  | "auth"
  /** The provider failed or the network did; the effect is unknown (`retryable`). */
  | "in_doubt";

export type RailErrorDetail = {
  code: RailErrorCode;
  provider: RailId;
  /** True when the call may or may not have been applied: retry the same reference, never compensate first. */
  retryable: boolean;
  /** The provider's own machine-readable code, e.g. MAX_CAPTURE_AMOUNT_EXCEEDED. */
  providerCode?: string | null;
  debugId?: string | null;
  httpStatus?: number | null;
  capability?: Capability;
};

export class RailError extends Error {
  readonly code: RailErrorCode;
  readonly provider: RailId;
  readonly retryable: boolean;
  readonly providerCode: string | null;
  readonly debugId: string | null;
  readonly httpStatus: number | null;
  readonly capability: Capability | null;

  constructor(detail: RailErrorDetail, message: string) {
    super(message);
    this.name = "RailError";
    this.code = detail.code;
    this.provider = detail.provider;
    this.retryable = detail.retryable;
    this.providerCode = detail.providerCode ?? null;
    this.debugId = detail.debugId ?? null;
    this.httpStatus = detail.httpStatus ?? null;
    this.capability = detail.capability ?? null;
  }
}

/** The rail cannot do this. Nothing was called, nothing changed, and the caller must not fake success. */
export class UnsupportedCapabilityError extends RailError {
  constructor(provider: RailId, capability: Capability) {
    super(
      { code: "unsupported_capability", provider, retryable: false, capability },
      `The ${provider} rail does not support ${capability}. Nothing was sent and nothing changed.`,
    );
    this.name = "UnsupportedCapabilityError";
  }
}

export const unsupported = (provider: RailId, capability: Capability) => new UnsupportedCapabilityError(provider, capability);

/** A provider-neutral refusal: the operation did not happen. */
export function declined(provider: RailId, providerCode: string | null, message: string, extra: Partial<RailErrorDetail> = {}): RailError {
  return new RailError({ code: "declined", provider, retryable: false, providerCode, ...extra }, message);
}

/** The effect is unknown: retry the same reference, never compensate first. */
export function inDoubt(provider: RailId, message: string, extra: Partial<RailErrorDetail> = {}): RailError {
  return new RailError({ code: "in_doubt", provider, retryable: true, ...extra }, message);
}

export function notFound(provider: RailId, what: string, providerCode: string | null = "NOT_FOUND"): RailError {
  return new RailError({ code: "not_found", provider, retryable: false, providerCode }, `The ${provider} rail has no ${what}.`);
}

export const isRailError = (e: unknown): e is RailError => e instanceof RailError;
export const retryable = (e: unknown): boolean => e instanceof RailError && e.retryable;

/** The provider's own code, falling back to nothing. Used where the gateway reacts to a specific refusal. */
export function railCode(e: unknown): string | null {
  if (!(e instanceof RailError)) return null;
  return e.providerCode ?? e.code;
}

/** True when the error is one of `codes` (the provider's code or the neutral one). */
export function railIs(e: unknown, ...codes: string[]): boolean {
  const c = railCode(e);
  return c !== null && codes.includes(c);
}

// ---------------------------------------------------------------------------
// The rails themselves. Every method is present so the gateway's calls type-check; whether a rail may
// be asked is decided by `capabilities`, and a rail that does not have a capability must throw
// UnsupportedCapabilityError from that method. `requireCapability` is the guard both sides use.
// ---------------------------------------------------------------------------

export interface HoldsRail {
  authorize(r: AuthorizeHoldRequest): Promise<HoldFacts>;
  requestApproval(r: ApprovalRequestArgs): Promise<ApprovalFacts>;
  readOrder(order: RailRef<"order">): Promise<OrderFacts>;
  authorizeApproved(r: { order: RailRef<"order">; reference: string }): Promise<HoldFacts>;
  read(hold: RailRef<"authorization">): Promise<HoldFacts>;
  capture(r: CaptureRequest): Promise<CaptureFacts>;
  readCapture(capture: RailRef<"capture">): Promise<CaptureFacts>;
  void(r: VoidRequest): Promise<void>;
}

export interface PayoutRail {
  send(r: PayoutRequest): Promise<PayoutFacts>;
  read(payout: RailRef<"payout">): Promise<PayoutFacts>;
  cancel(item: RailRef<"payout_item">): Promise<{ itemRef: RailRef<"payout_item">; itemStatus: string | null }>;
}

export interface RefundRail {
  refund(r: RefundRequest): Promise<RefundFacts>;
}

export interface ReportingRail {
  balance(currency: string): Promise<BalanceFacts | null>;
  statement(range: StatementRange): Promise<StatementLine[]>;
}

export interface EventsRail {
  /**
   * Reduce an inbound body to the three things the gateway uses, or null when it is not this provider's
   * event shape. The shape is provider knowledge, so it lives in the adapter, not in the HTTP layer.
   */
  parse(body: unknown): { id: string; type: string; resource: Record<string, unknown> } | null;
  /** True only when the provider itself confirms the event it signed. */
  verify(r: WebhookRequest): Promise<boolean>;
  list(since?: Date): Promise<RailEvent[]>;
}

/** The calls a rail made for a set of domain records (envelope ids, spend ids, provider ids). */
export interface TrailRail {
  calls(keys: string[]): Promise<RailCall[]>;
}

export interface DisputesRail {
  forCapture(capture: RailRef<"capture">): Promise<DisputeFacts[]>;
  list(): Promise<DisputeFacts[]>;
  respond(dispute: RailRef<"dispute">, notes: string): Promise<void>;
}

/**
 * What a rail actually promises about repeating a mutating request — the adapter's own words, not the
 * gateway's assumption. Fencing protects the database; the provider's idempotency is what protects the
 * money after a request has already left.
 */
export type IdempotencyContract = {
  /** Repeating a request with the same reference returns the original operation, not a second one. */
  readonly sameReferenceIsSameOperation: boolean;
  /** Repeating it while the first is still in flight is safe (no duplicate, no spurious refusal). */
  readonly retryWhileInFlight: boolean;
  /** How long the provider remembers the reference, in ms; null when it publishes no such guarantee. */
  readonly memoryMs: number | null;
  /** The operation can be found again from our own reference alone, without the provider's id. */
  readonly lookupByReference: boolean;
  /** Plain words for receipts, docs and refusals. */
  readonly note: string;
};

/**
 * May an interrupted call be sent again automatically? Only when the adapter says a repeat is the same
 * operation *and* that a repeat during the first attempt cannot double-charge. Everything else is parked
 * as in-doubt and reconciled against the provider first.
 */
export function mayRetryAutomatically(r: Rail): boolean {
  return r.idempotency.sameReferenceIsSameOperation && r.idempotency.retryWhileInFlight;
}

export type Rail = {
  readonly id: RailId;
  /** A human label for the interface, e.g. "PayPal (sandbox)". */
  readonly label: string;
  readonly mode: RailMode;
  readonly capabilities: ReadonlySet<Capability>;
  readonly guarantees: ReadonlySet<Guarantee>;
  /** What this provider promises about repeating a request. Governs automatic retry after a doubt. */
  readonly idempotency: IdempotencyContract;
  readonly holds: HoldsRail;
  readonly payouts: PayoutRail;
  readonly refunds: RefundRail;
  readonly reporting: ReportingRail;
  readonly events: EventsRail;
  readonly disputes: DisputesRail;
  readonly trail: TrailRail;
  /** Wait for any record of this rail's calls still being written (a no-op for a rail that keeps none). */
  flush(): Promise<void>;
};

/** Fail loudly, and before anything is sent, when a rail is asked for something it does not have. */
export function requireCapability(r: Rail, capability: Capability): void {
  if (!r.capabilities.has(capability)) throw new UnsupportedCapabilityError(r.id, capability);
}

/** What a rail promises, as plain sentences. Receipts and pages must not say more than this. */
export function guaranteeStatements(r: Rail): string[] {
  const out: string[] = [];
  if (r.guarantees.has("authorization-hold")) out.push("The provider holds the funds: a capture cannot exceed the amount it authorized.");
  if (r.guarantees.has("reversible-payout")) out.push("A payout can be taken back while the payee has not claimed it.");
  if (r.guarantees.has("internal-reservation")) out.push("Amounts are reserved in this gateway's books only; no provider-side hold exists.");
  if (r.guarantees.has("safeguarded-funds")) out.push("Money held for others is safeguarded by a regulated institution.");
  if (r.guarantees.has("card-issuing")) out.push("Network cards are issued by a regulated issuer.");
  return out;
}
