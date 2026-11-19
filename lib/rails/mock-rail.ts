/**
 * A deterministic financial rail that never leaves the process.
 *
 * It exists for one purpose: to let the provider-independent contracts in `./types` be tested without
 * PayPal, without credentials and without a network — and to prove that a rail which lacks a capability
 * says so instead of pretending. It is not a payment provider and no page may offer it as one.
 *
 * Determinism: ids come from a counter (`MOCK-AUTH-000001`), the clock is injectable, and every state
 * transition is synchronous, so the same script of calls always produces the same facts. Failures are
 * injected rather than simulated by luck, which is what makes the recovery paths testable:
 *
 *   failNext("hold.capture")   → the next capture is "in doubt" (retryable, effect unknown)
 *   declineNext("payout.send") → the next payout is definitively refused
 *
 * The behaviours it copies from the real rail are the ones the gateway depends on: a capture can never
 * exceed its hold, a duplicate reference returns the first answer instead of taking money twice, a
 * refund does not restore the hold, and an unclaimed payout can be cancelled.
 */
import {
  RailError, amount, declined, inDoubt, notFound, railRef, unsupported,
  type Amount, type ApprovalFacts, type ApprovalRequestArgs, type AuthorizeHoldRequest, type BalanceFacts,
  type Capability, type CaptureFacts, type CaptureRequest, type DisputeFacts, type Guarantee, type HoldFacts,
  type OrderFacts, type PayoutFacts, type PayoutRequest, type Rail, type RailCall, type RailErrorCode, type RailEvent, type RailRef,
  type RefundFacts, type RefundRequest, type StatementLine, type StatementRange, type VoidRequest, type WebhookRequest,
} from "./types";

const PROVIDER = "mock";

type MockHold = { id: string; reference: string; status: "CREATED" | "PARTIALLY_CAPTURED" | "CAPTURED" | "VOIDED"; limit: Amount; capturedMinor: number; orderId: string | null; expiresAt: string };
type MockOrder = { id: string; reference: string; status: "PAYER_ACTION_REQUIRED" | "APPROVED" | "COMPLETED"; limit: Amount };
type MockCapture = { id: string; reference: string; holdId: string; amount: Amount; status: "COMPLETED" | "PENDING" | "REFUNDED"; invoiceId: string };
type MockPayout = { batchId: string; itemId: string; reference: string; amount: Amount; receiver: string; itemStatus: "SUCCESS" | "UNCLAIMED" | "RETURNED" | "FAILED"; transactionId: string };
type MockRefund = { id: string; reference: string; captureId: string; amount: Amount; status: "COMPLETED" | "PENDING" };
type MockDispute = { id: string; captureId: string; status: string; reason: string; amount: Amount; evidence: string | null };
type MockEvent = { id: string; type: string; createdAt: string; resource: Record<string, unknown> };

/** Which capabilities this instance claims. Anything false must throw, not silently succeed. */
export type MockProfile = Partial<Record<Capability, boolean>>;

export type MockRailOptions = {
  profile?: MockProfile;
  now?: () => number;
  /** Charge a fee on captures and payouts, as a real rail would. Off by default so amounts stay exact. */
  fees?: boolean;
  guarantees?: Guarantee[];
};

const ALL: Capability[] = [
  "funding.authorize-hold", "funding.approval-link", "funding.test-instrument",
  "hold.read", "hold.capture", "hold.void",
  "payout.send", "payout.read", "payout.cancel", "refund.capture",
  "reporting.balance", "reporting.statement", "events.verify", "events.list", "dispute.read", "dispute.respond",
  "observability.trail",
];

export class MockRail implements Rail {
  readonly id = PROVIDER;
  readonly label = "Deterministic mock rail (no money, no network)";
  readonly mode = "mock" as const;
  readonly capabilities: ReadonlySet<Capability>;
  readonly guarantees: ReadonlySet<Guarantee>;
  // The simulator can promise this: it returns the recorded payout for the same reference, including
  // while a first call is still in flight. Real providers have to be described honestly (see paypal-rail).
  readonly idempotency = {
    sameReferenceIsSameOperation: true, retryWhileInFlight: true, memoryMs: null, duplicateIsAnError: false, lookupByReference: true,
    note: "The simulator returns the same payout for the same reference, for the life of the process, including while the first call is in flight.",
  } as const;

  private seq = 0;
  private readonly holdRows = new Map<string, MockHold>();
  private readonly holdByRef = new Map<string, string>();
  private readonly orders = new Map<string, MockOrder>();
  private readonly captures = new Map<string, MockCapture>();
  private readonly captureByRef = new Map<string, string>();
  private readonly payoutRows = new Map<string, MockPayout>();
  private readonly payoutByRef = new Map<string, string>();
  private readonly refundRows = new Map<string, MockRefund>();
  private readonly refundByRef = new Map<string, string>();
  private readonly disputeRows = new Map<string, MockDispute>();
  private readonly feed: MockEvent[] = [];
  private failures: { op: string | null; left: number; code: RailErrorCode } = { op: null, left: 0, code: "in_doubt" };
  private readonly log: string[] = [];
  private readonly now: () => number;

  constructor(private readonly opts: MockRailOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    const profile = opts.profile ?? {};
    this.capabilities = new Set(ALL.filter((c) => profile[c] !== false));
    this.guarantees = new Set<Guarantee>(opts.guarantees ?? ["authorization-hold", "reversible-payout", "internal-reservation"]);
  }

  // ---------------------------------------------------------------- test controls (not part of Rail)

  /** Make the next `times` calls whose operation name contains `op` fail. `in_doubt` by default. */
  failNext(op: string, times = 1, code: RailErrorCode = "in_doubt"): void {
    this.failures = { op, left: times, code };
    this.log.length = 0;
  }
  /** Make the next call to `op` a definitive refusal. */
  declineNext(op: string, times = 1): void { this.failNext(op, times, "declined"); }
  /** Mutating operations actually executed (idempotent replays are not counted). */
  calls(): string[] { return [...this.log]; }
  /** The payer presses approve in the mock checkout. */
  approveOrder(orderId: string): boolean {
    const o = this.orders.get(orderId);
    if (!o || o.status !== "PAYER_ACTION_REQUIRED") return false;
    o.status = "APPROVED";
    return true;
  }
  /** The rail changes its mind about a payout later (claimed, returned, failed). */
  setPayoutStatus(batchId: string, status: MockPayout["itemStatus"]): boolean {
    const p = this.payoutRows.get(batchId);
    if (!p) return false;
    p.itemStatus = status;
    this.emit(`PAYMENT.PAYOUTS-ITEM.${status}`, { payout_batch_id: p.batchId, payout_item_id: p.itemId, transaction_status: status });
    return true;
  }
  setHoldStatus(holdId: string, status: MockHold["status"]): boolean {
    const h = this.holdRows.get(holdId);
    if (!h) return false;
    h.status = status;
    return true;
  }
  setCaptureStatus(captureId: string, status: MockCapture["status"]): boolean {
    const c = this.captures.get(captureId);
    if (!c) return false;
    c.status = status;
    return true;
  }
  /** A payer opens a dispute against a capture. */
  openDispute(captureId: string, reason = "UNAUTHORISED"): string | null {
    const c = this.captures.get(captureId);
    if (!c) return null;
    const id = this.nextId("MOCK-DSP");
    this.disputeRows.set(id, { id, captureId, status: "WAITING_FOR_SELLER_RESPONSE", reason, amount: c.amount, evidence: null });
    this.emit("CUSTOMER.DISPUTE.CREATED", { dispute_id: id, status: "WAITING_FOR_SELLER_RESPONSE", reason, disputed_transactions: [{ seller_transaction_id: captureId }] });
    return id;
  }
  dispute(id: string): MockDispute | null { return this.disputeRows.get(id) ?? null; }
  /** Every capture the rail holds, for "the money moved exactly once" assertions. */
  captureCount(reference?: string): number {
    return [...this.captures.values()].filter((c) => !reference || c.reference === reference).length;
  }
  /** Every payout the rail sent, for the same reason. */
  payoutCount(reference?: string): number {
    return [...this.payoutRows.values()].filter((p) => !reference || p.reference === reference).length;
  }
  /** Every refund the rail made. */
  refundCount(reference?: string): number {
    return [...this.refundRows.values()].filter((f) => !reference || f.reference === reference).length;
  }

  // ---------------------------------------------------------------- helpers

  private nextId(prefix: string): string { return `${prefix}-${String(++this.seq).padStart(6, "0")}`; }
  private at(): string { return new Date(this.now()).toISOString(); }
  private emit(type: string, resource: Record<string, unknown>) {
    this.feed.push({ id: this.nextId("MOCK-EVT"), type, createdAt: this.at(), resource });
    if (this.feed.length > 400) this.feed.splice(0, this.feed.length - 400);
  }
  private has(c: Capability) { if (!this.capabilities.has(c)) throw unsupported(PROVIDER, c); }
  private maybeFail(op: string) {
    if (this.failures.op && op.includes(this.failures.op) && this.failures.left > 0) {
      this.failures.left -= 1;
      const code = this.failures.code;
      if (code === "declined") throw declined(PROVIDER, `MOCK_${op.toUpperCase().replace(/\W/g, "_")}_DECLINED`, `The mock rail refused ${op}.`);
      throw inDoubt(PROVIDER, `The mock rail was interrupted during ${op}: the effect is unknown.`, { providerCode: "MOCK_IN_DOUBT" });
    }
  }
  private charge(op: string) { this.log.push(op); }
  private capture(captureId: string): MockCapture {
    const c = this.captures.get(captureId);
    if (!c) throw notFound(PROVIDER, `capture ${captureId}`, "INVALID_RESOURCE_ID");
    return c;
  }
  /** The rail's own arithmetic: money in, less money out, less refunds and fees. */
  private balanceMinor(currency: string): number {
    let n = 0;
    for (const c of this.captures.values()) {
      if (c.amount.currency !== currency || c.status === "PENDING") continue;
      n += c.amount.minor;
      if (this.opts.fees) n -= Math.round(c.amount.minor * 0.0259) + 49;
      if (c.status === "REFUNDED") n -= c.amount.minor;
    }
    for (const p of this.payoutRows.values()) {
      if (p.amount.currency !== currency || p.itemStatus === "RETURNED" || p.itemStatus === "FAILED") continue;
      n -= p.amount.minor + (this.opts.fees ? Math.round(p.amount.minor * 0.02) : 0);
    }
    return Math.max(0, n);
  }

  // ---------------------------------------------------------------- holds

  readonly holds = {
    authorize: async (r: AuthorizeHoldRequest): Promise<HoldFacts> => {
      this.has("funding.test-instrument");
      this.maybeFail("hold.authorize");
      const seen = this.holdByRef.get(r.reference);
      if (seen) return this.holdFacts(this.holdsById(seen));
      const h: MockHold = {
        id: this.nextId("MOCK-AUTH"), reference: r.reference, status: "CREATED", limit: r.amount,
        capturedMinor: 0, orderId: null, expiresAt: new Date(this.now() + 29 * 86_400_000).toISOString(),
      };
      this.holdRows.set(h.id, h);
      this.holdByRef.set(r.reference, h.id);
      this.charge("hold.authorize");
      this.emit("PAYMENT.AUTHORIZATION.CREATED", { id: h.id, status: h.status, custom_id: r.reference });
      return this.holdFacts(h);
    },
    requestApproval: async (r: ApprovalRequestArgs): Promise<ApprovalFacts> => {
      this.has("funding.approval-link");
      this.maybeFail("hold.requestApproval");
      const o: MockOrder = { id: this.nextId("MOCK-ORD"), reference: r.reference, status: "PAYER_ACTION_REQUIRED", limit: r.amount };
      this.orders.set(o.id, o);
      this.charge("hold.requestApproval");
      return { orderRef: railRef(PROVIDER, "order", o.id), status: o.status, approvalUrl: `mock://approve/${o.id}` };
    },
    readOrder: async (order: RailRef<"order">): Promise<OrderFacts> => {
      const o = this.orders.get(order.id);
      if (!o) throw notFound(PROVIDER, `order ${order.id}`, "INVALID_RESOURCE_ID");
      return {
        ref: railRef(PROVIDER, "order", o.id), status: o.status, intent: "AUTHORIZE", externalRef: o.reference,
        amount: o.limit, payerId: o.status === "PAYER_ACTION_REQUIRED" ? null : "MOCK-PAYER", payerEmail: o.status === "PAYER_ACTION_REQUIRED" ? null : "payer@mock.example",
      };
    },
    authorizeApproved: async (r: { order: RailRef<"order">; reference: string }): Promise<HoldFacts> => {
      this.has("funding.approval-link");
      this.maybeFail("hold.authorizeApproved");
      const o = this.orders.get(r.order.id);
      if (!o) throw notFound(PROVIDER, `order ${r.order.id}`, "INVALID_RESOURCE_ID");
      if (o.status === "PAYER_ACTION_REQUIRED") throw declined(PROVIDER, "ORDER_NOT_APPROVED", "The payer has not approved this hold.");
      if (o.status === "COMPLETED") throw declined(PROVIDER, "ORDER_ALREADY_AUTHORIZED", "The order was already authorized.");
      const h: MockHold = {
        id: this.nextId("MOCK-AUTH"), reference: r.reference, status: "CREATED", limit: o.limit,
        capturedMinor: 0, orderId: o.id, expiresAt: new Date(this.now() + 29 * 86_400_000).toISOString(),
      };
      this.holdRows.set(h.id, h);
      this.holdByRef.set(r.reference, h.id);
      o.status = "COMPLETED";
      this.charge("hold.authorizeApproved");
      this.emit("PAYMENT.AUTHORIZATION.CREATED", { id: h.id, status: h.status, custom_id: r.reference });
      return this.holdFacts(h);
    },
    read: async (hold: RailRef<"authorization">): Promise<HoldFacts> => {
      this.has("hold.read");
      return this.holdFacts(this.holdsById(hold.id));
    },
    capture: async (r: CaptureRequest): Promise<CaptureFacts> => {
      this.has("hold.capture");
      this.maybeFail("hold.capture");
      const seen = this.captureByRef.get(r.reference);
      if (seen) return this.captureFacts(this.capture(seen), r.reference);
      const h = this.holdsById(r.hold.id);
      if (h.status === "VOIDED") throw declined(PROVIDER, "AUTHORIZATION_VOIDED", "A voided authorization cannot be captured.");
      if (h.status === "CAPTURED") throw declined(PROVIDER, "AUTHORIZATION_ALREADY_CAPTURED", "The authorization is fully captured.");
      const left = h.limit.minor - h.capturedMinor;
      if (r.amount.minor <= 0) throw declined(PROVIDER, "INVALID_PARAMETER_VALUE", "A capture must be positive.");
      if (r.amount.minor > left) throw declined(PROVIDER, "MAX_CAPTURE_AMOUNT_EXCEEDED", `The hold has ${left} minor units left.`);
      if (r.amount.currency !== h.limit.currency) throw declined(PROVIDER, "CURRENCY_MISMATCH", "The capture currency does not match the hold.");
      h.capturedMinor += r.amount.minor;
      h.status = h.capturedMinor === h.limit.minor ? "CAPTURED" : "PARTIALLY_CAPTURED";
      const c: MockCapture = { id: this.nextId("MOCK-CAP"), reference: r.reference, holdId: h.id, amount: r.amount, status: "COMPLETED", invoiceId: r.reference };
      this.captures.set(c.id, c);
      this.captureByRef.set(r.reference, c.id);
      this.charge("hold.capture");
      this.emit("PAYMENT.CAPTURE.COMPLETED", { id: c.id, status: c.status, amount: { currency_code: c.amount.currency, value: String(c.amount.minor) }, invoice_id: c.invoiceId });
      return this.captureFacts(c, r.reference);
    },
    readCapture: async (capture: RailRef<"capture">): Promise<CaptureFacts> => {
      this.has("hold.read");
      return this.captureFacts(this.capture(capture.id), this.capture(capture.id).reference);
    },
    void: async (r: VoidRequest): Promise<void> => {
      this.has("hold.void");
      this.maybeFail("hold.void");
      const h = this.holdsById(r.hold.id);
      if (h.status === "VOIDED") throw declined(PROVIDER, "PREVIOUSLY_VOIDED", "The authorization was already voided.");
      if (h.status === "CAPTURED") throw declined(PROVIDER, "PREVIOUSLY_CAPTURED", "The authorization is fully captured.");
      h.status = "VOIDED";
      this.charge("hold.void");
      this.emit("PAYMENT.AUTHORIZATION.VOIDED", { id: h.id, status: h.status });
    },
  };

  // ---------------------------------------------------------------- payouts

  readonly payouts = {
    send: async (r: PayoutRequest): Promise<PayoutFacts> => {
      this.has("payout.send");
      this.maybeFail("payout.send");
      const seen = this.payoutByRef.get(r.reference);
      if (seen) return this.payoutFacts(this.payoutRows.get(seen)!);
      if (/refused/i.test(r.receiver)) throw declined(PROVIDER, "RECEIVER_ACCOUNT_LOCKED", "The receiver cannot be paid.");
      const p: MockPayout = {
        batchId: this.nextId("MOCK-BATCH"), itemId: this.nextId("MOCK-ITEM"), reference: r.reference, amount: r.amount, receiver: r.receiver,
        itemStatus: /unclaimed/i.test(r.receiver) ? "UNCLAIMED" : "SUCCESS", transactionId: this.nextId("MOCK-TXN"),
      };
      this.payoutRows.set(p.batchId, p);
      this.payoutByRef.set(r.reference, p.batchId);
      this.charge("payout.send");
      this.emit(`PAYMENT.PAYOUTS-ITEM.${p.itemStatus}`, { payout_batch_id: p.batchId, payout_item_id: p.itemId, transaction_status: p.itemStatus, sender_batch_id: p.reference });
      return this.payoutFacts(p);
    },
    read: async (payout: RailRef<"payout">): Promise<PayoutFacts> => {
      this.has("payout.read");
      const p = this.payoutRows.get(payout.id);
      if (!p) throw notFound(PROVIDER, `payout ${payout.id}`, "INVALID_RESOURCE_ID");
      return this.payoutFacts(p);
    },
    cancel: async (item: RailRef<"payout_item">) => {
      this.has("payout.cancel");
      this.maybeFail("payout.cancel");
      const p = [...this.payoutRows.values()].find((x) => x.itemId === item.id);
      if (!p) throw notFound(PROVIDER, `payout item ${item.id}`, "INVALID_RESOURCE_ID");
      if (p.itemStatus !== "UNCLAIMED") throw declined(PROVIDER, "ITEM_INCORRECT_STATUS", "Only an unclaimed payout item can be cancelled.");
      p.itemStatus = "RETURNED";
      this.charge("payout.cancel");
      this.emit("PAYMENT.PAYOUTS-ITEM.CANCELED", { payout_batch_id: p.batchId, payout_item_id: p.itemId, transaction_status: p.itemStatus });
      return { itemRef: railRef(PROVIDER, "payout_item", p.itemId), itemStatus: p.itemStatus };
    },
  };

  // ---------------------------------------------------------------- refunds

  readonly refunds = {
    refund: async (r: RefundRequest): Promise<RefundFacts> => {
      this.has("refund.capture");
      this.maybeFail("refund.capture");
      const seen = this.refundByRef.get(r.reference);
      if (seen) return { ref: railRef(PROVIDER, "refund", seen), status: this.refundRows.get(seen)!.status };
      const c = this.capture(r.capture.id);
      if (c.status === "REFUNDED") throw new RailError({ code: "duplicate", provider: PROVIDER, retryable: false, providerCode: "CAPTURE_FULLY_REFUNDED" }, "The capture has already been refunded.");
      c.status = "REFUNDED";
      const f: MockRefund = { id: this.nextId("MOCK-REF"), reference: r.reference, captureId: c.id, amount: c.amount, status: "COMPLETED" };
      this.refundRows.set(f.id, f);
      this.refundByRef.set(r.reference, f.id);
      this.charge("refund.capture");
      this.emit("PAYMENT.CAPTURE.REFUNDED", { id: f.id, status: f.status, amount: { currency_code: c.amount.currency, value: String(c.amount.minor) }, invoice_id: c.invoiceId });
      return { ref: railRef(PROVIDER, "refund", f.id), status: f.status };
    },
  };

  // ---------------------------------------------------------------- reporting

  readonly reporting = {
    balance: async (currency: string): Promise<BalanceFacts | null> => {
      this.has("reporting.balance");
      this.maybeFail("reporting.balance");
      const n = this.balanceMinor(currency);
      return { currency, totalMinor: n, availableMinor: n, withheldMinor: 0, asOf: this.at(), accountId: "MOCK-ACCOUNT" };
    },
    statement: async (range: StatementRange): Promise<StatementLine[]> => {
      this.has("reporting.statement");
      this.maybeFail("reporting.statement");
      const inside = (d: string) => { const t = new Date(d).getTime(); return t >= range.from.getTime() && t <= range.to.getTime(); };
      const lines: StatementLine[] = [];
      for (const c of this.captures.values()) {
        lines.push({ id: c.id, code: "T0006", at: this.at(), amountMinor: c.amount.minor, feeMinor: this.opts.fees ? -(Math.round(c.amount.minor * 0.0259) + 49) : 0, currency: c.amount.currency, status: "S", invoiceId: c.invoiceId, customField: null, reference: c.holdId });
        if (c.status === "REFUNDED") {
          const f = [...this.refundRows.values()].find((x) => x.captureId === c.id);
          if (f) lines.push({ id: f.id, code: "T1107", at: this.at(), amountMinor: -c.amount.minor, feeMinor: 0, currency: c.amount.currency, status: "S", invoiceId: c.invoiceId, customField: null, reference: c.id });
        }
      }
      for (const p of this.payoutRows.values()) {
        lines.push({ id: p.transactionId, code: "T0001", at: this.at(), amountMinor: -p.amount.minor, feeMinor: this.opts.fees ? -Math.round(p.amount.minor * 0.02) : 0, currency: p.amount.currency, status: p.itemStatus === "SUCCESS" ? "S" : "P", invoiceId: null, customField: p.reference, reference: p.itemId });
      }
      return lines.filter((l) => inside(l.at));
    },
  };

  // ---------------------------------------------------------------- events

  readonly events = {
    parse: (body: unknown): { id: string; type: string; resource: Record<string, unknown> } | null => {
      const b = body as { id?: unknown; event_type?: unknown; resource?: unknown } | null;
      if (!b || typeof b.id !== "string" || !b.id || typeof b.event_type !== "string" || !b.event_type) return null;
      if (b.resource !== undefined && (typeof b.resource !== "object" || b.resource === null)) return null;
      return { id: b.id, type: b.event_type, resource: (b.resource ?? {}) as Record<string, unknown> };
    },
    /** Genuine = this rail issued the event, with this id and this type, unchanged. */
    verify: async (r: WebhookRequest): Promise<boolean> => {
      this.has("events.verify");
      if (r.headers["mock-signature"] !== "MOCK-VALID") return false;
      let body: { id?: string; event_type?: string };
      try { body = JSON.parse(r.rawBody) as { id?: string; event_type?: string }; } catch { return false; }
      const mine = this.feed.find((e) => e.id === body.id);
      // Same id, same type, same resource: anything altered is not what this rail issued.
      const same = Boolean(mine && mine.type === body.event_type && JSON.stringify(mine.resource) === JSON.stringify((body as { resource?: unknown }).resource));
      return same;
    },
    list: async (since?: Date): Promise<RailEvent[]> => {
      this.has("events.list");
      const after = since ? since.getTime() : -Infinity;
      return [...this.feed].reverse().filter((e) => new Date(e.createdAt).getTime() >= after).map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt, resource: structuredClone(e.resource) }));
    },
  };

  // ---------------------------------------------------------------- disputes

  readonly disputes = {
    forCapture: async (capture: RailRef<"capture">): Promise<DisputeFacts[]> => {
      this.has("dispute.read");
      return [...this.disputeRows.values()].filter((d) => d.captureId === capture.id).map((d) => this.disputeFacts(d));
    },
    list: async (): Promise<DisputeFacts[]> => {
      this.has("dispute.read");
      return [...this.disputeRows.values()].map((d) => this.disputeFacts(d));
    },
    respond: async (dispute: RailRef<"dispute">, notes: string): Promise<void> => {
      this.has("dispute.respond");
      this.maybeFail("dispute.respond");
      const d = this.disputeRows.get(dispute.id);
      if (!d) throw notFound(PROVIDER, `dispute ${dispute.id}`, "INVALID_RESOURCE_ID");
      if (d.status !== "WAITING_FOR_SELLER_RESPONSE") throw declined(PROVIDER, "ACTION_NOT_ALLOWED", "The dispute is not waiting for the seller.");
      d.status = "UNDER_REVIEW";
      d.evidence = notes.slice(0, 2000);
      this.charge("dispute.respond");
    },
  };

  // ---------------------------------------------------------------- trail

  readonly trail = {
    /** Every mutating call this rail executed, in order. It keeps no bodies: there are none. */
    calls: async (keys: string[]): Promise<RailCall[]> => {
      this.has("observability.trail");
      void keys;
      return this.log.map((op, i) => ({
        at: this.at(), op, text: op, method: "MOCK", path: op, httpStatus: 200,
        providerStatus: "COMPLETED", error: null, providerDebugId: null, resourceId: null, amountMinor: null, currency: null,
        ms: 0, requestId: `${op}#${i + 1}`, moves: true, repeat: false,
      }));
    },
  };

  async flush(): Promise<void> { /* nothing is queued: every effect is synchronous */ }

  // ---------------------------------------------------------------- mappers

  private holdsById(id: string): MockHold {
    const h = this.holdRows.get(id);
    if (!h) throw notFound(PROVIDER, `authorization ${id}`, "INVALID_RESOURCE_ID");
    return h;
  }
  private holdFacts(h: MockHold): HoldFacts {
    return {
      ref: railRef(PROVIDER, "authorization", h.id), orderRef: h.orderId ? railRef(PROVIDER, "order", h.orderId) : null,
      status: h.status, amount: h.limit, expiresAt: h.expiresAt, externalRef: h.reference,
    };
  }
  private captureFacts(c: MockCapture, reference: string): CaptureFacts {
    void reference;
    return { ref: railRef(PROVIDER, "capture", c.id), status: c.status, amount: c.amount, externalRef: c.invoiceId };
  }
  /** The mock's own batch is one item, and its echo of the sender references is its own record, not the request. */
  private payoutFacts(p: MockPayout): PayoutFacts {
    return {
      batchRef: railRef(PROVIDER, "payout", p.batchId),
      // A batch status of its own, independent of the item: it says nothing about this recipient.
      batchStatus: p.itemStatus === "SUCCESS" ? "SUCCESS" : "PENDING",
      senderBatchId: p.reference,
      items: [{
        itemRef: railRef(PROVIDER, "payout_item", p.itemId), senderItemId: p.reference, status: p.itemStatus,
        amount: p.amount, receiver: p.receiver, transactionId: p.transactionId,
        error: p.itemStatus === "UNCLAIMED" ? "RECEIVER_UNREGISTERED" : p.itemStatus === "FAILED" ? "RECEIVER_ACCOUNT_LOCKED" : null,
      }],
      itemCount: 1,
    };
  }
  private disputeFacts(d: MockDispute): DisputeFacts {
    return {
      ref: railRef(PROVIDER, "dispute", d.id), status: d.status, reason: d.reason, stage: "INQUIRY",
      amountMinor: d.amount.minor, currency: d.amount.currency, createdAt: this.at(), transactionIds: [d.captureId],
    };
  }
}

export function mockRail(opts: MockRailOptions = {}): MockRail {
  return new MockRail(opts);
}

/** A rail that can only reserve and pay out: used to prove capability negotiation is enforced. */
export function mockPayoutOnlyRail(): MockRail {
  const profile: MockProfile = {};
  for (const c of ALL) profile[c] = false;
  profile["payout.send"] = true;
  profile["payout.read"] = true;
  return new MockRail({ profile, guarantees: ["internal-reservation"] });
}

/** Exposed for tests that need a rail which claims nothing at all. */
export function mockEmptyRail(): MockRail {
  const profile: MockProfile = {};
  for (const c of ALL) profile[c] = false;
  return new MockRail({ profile, guarantees: [] });
}

export const mockAmount = amount;
export const mockRailError = RailError;
