/**
 * PayPal as one rail among others.
 *
 * This is the only module in the financial domain allowed to import `lib/paypal/payments.ts`. Every
 * PayPal-specific idea stops here and is translated into the neutral vocabulary of `./types`:
 *
 *   PayPal authorization  → HoldFacts (a hold with a limit and an expiry)
 *   PayPal capture        → CaptureFacts (part of the hold, taken once per reference)
 *   PayPal Payouts        → PayoutFacts (a batch, an item, its status)
 *   PayPal Reporting      → BalanceFacts / StatementLine
 *   PayPal webhooks       → EventsRail.verify (the provider's own signature check)
 *   PayPal disputes       → DisputeFacts
 *
 * The wire behaviour is unchanged: the same endpoints, the same `PayPal-Request-Id` values
 * (`seal-<envelope>`, `capture-<payment>`, `payout-<payment>`, `refund-<payment>`, `close-<envelope>`),
 * the same sandbox test-card rotation, so receipts, journals and the existing tests keep their meaning.
 *
 * Declared capabilities are honest, not aspirational:
 *
 *   • `funding.test-instrument` exists only in sandbox mode. Live mode requires the payer to approve a
 *     hold in PayPal's checkout (`funding.approval-link`).
 *   • `safeguarded-funds` and `card-issuing` are deliberately absent. PayPal is not our custodian and
 *     Envelope's signed cards are not network cards.
 */
import { PayPalApiError, getPayPal, paypalMode, type PayPalClient } from "../paypal/client";
// The journal records every call this adapter makes, and renders those calls for the audit trail. Both
// are PayPal-shaped facts, so both live here; the engine only sees `trail.calls` and `flush()`.
import { callsFor, flushJournal, MOVES, OP_TEXT } from "../paypal/journal";
import {
  authorizeApprovedOrder, authorizeHold, cancelPayoutItem, capturePart, disputesFor, getAuthorization, getBalance,
  getCapture, getOrder, getPayout, listDisputes, listEvents, listTransactions, payout, provideEvidence,
  refundCapture, requestHoldApproval, verifyWebhookSignature, voidAuthorization, type EventHeaders,
} from "../paypal/payments";
import {
  RailError, amount, declined, inDoubt, notFound, railRef, unsupported,
  type Amount, type ApprovalFacts, type ApprovalRequestArgs, type AuthorizeHoldRequest, type BalanceFacts, type Capability,
  type CaptureFacts, type CaptureRequest, type DisputeFacts, type Guarantee, type HoldFacts, type OrderFacts,
  type PayoutFacts, type PayoutRequest, type Rail, type RailCall, type RailErrorCode, type RailEvent, type RailRef, type RefundFacts,
  type RefundRequest, type StatementLine, type VoidRequest, type WebhookRequest,
} from "./types";

const PROVIDER = "paypal";

/**
 * Provider codes that mean "this same request already produced its effect", so the answer is to read the
 * record rather than to compensate. Codes that mean "the hold is used up" are deliberately NOT here:
 * they are ordinary refusals, and treating them as duplicates would let a caller assume money moved.
 */
const ALREADY_DONE = new Set(["DUPLICATE_REQUEST_ID", "DUPLICATE_INVOICE_ID", "CAPTURE_FULLY_REFUNDED", "PREVIOUSLY_VOIDED"]);
/** Provider codes that mean "not able to answer yet": the same reference will work shortly. */
const NOT_READY = new Set(["BATCH_NOT_COMPLETED", "TRANSACTION_REFUSED_TEMPORARILY"]);

/** PayPal's errors, in the rail's vocabulary. `retryable` is PayPal's own answer to "did that happen?". */
export function toRailError(e: unknown): RailError {
  if (e instanceof RailError) return e;
  if (e instanceof PayPalApiError) {
    const providerCode = e.issue ?? e.paypalName;
    const code: RailErrorCode =
      e.status === 401 ? "auth"
        : e.retryable ? "in_doubt"
        : e.status === 404 ? "not_found"
        // "Already done" refusals are the same neutral condition, whatever the provider calls them:
        // the caller's next step is to read the record, not to compensate.
        : ALREADY_DONE.has(providerCode) ? "duplicate"
        // "Not yet" means try the same reference again shortly, and is retryable by definition.
        : NOT_READY.has(providerCode) ? "not_ready"
        : "declined";
    return new RailError({
      code, provider: PROVIDER,
      retryable: code === "not_ready" ? true : e.retryable,
      providerCode, debugId: e.debugId ?? null, httpStatus: e.status,
    }, e.message);
  }
  // Unknown failure: treat it as in doubt. The caller re-presents the same reference and PayPal's
  // idempotency key settles the question; nothing is compensated on a guess.
  return inDoubt(PROVIDER, String(e), { providerCode: "UNKNOWN" });
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toRailError(e);
  }
}

function capabilitiesFor(mode: ReturnType<typeof paypalMode>): Set<Capability> {
  const caps = new Set<Capability>([
    "funding.authorize-hold", "funding.approval-link",
    "hold.read", "hold.capture", "hold.void",
    "payout.send", "payout.read", "payout.cancel",
    "refund.capture",
    "reporting.balance", "reporting.statement",
    "events.verify", "events.list",
    "dispute.read", "dispute.respond",
    // The adapter's journal is the record of what PayPal did for one envelope, in every mode.
    "observability.trail",
  ]);
  // Placing a hold with PayPal's documented sandbox test cards is a sandbox-only convenience. In live
  // mode the payer must approve the hold themselves, so the capability is absent and asking for it fails.
  if (mode === "sandbox" || mode === "simulated") caps.add("funding.test-instrument");
  return caps;
}

const GUARANTEES: ReadonlySet<Guarantee> = new Set<Guarantee>(["authorization-hold", "reversible-payout"]);

export class PayPalRail implements Rail {
  readonly id = PROVIDER;
  readonly label = "PayPal";
  readonly guarantees = GUARANTEES;
  // The one payout promise PayPal publishes: a sender_batch_id used in the last 30 days is rejected as a
  // duplicate (with a link to the original batch), and a 5xx may be retried with the same sender_batch_id.
  // It publishes nothing about a repeat while the batch is still being created, and offers no lookup by our
  // reference. PayPal-Request-Id's longer retention (up to 45 days, where an API supports it) is a different
  // mechanism and is not what this adapter relies on for payouts. So an interrupted payout is parked and
  // reconciled, never re-sent automatically.
  readonly idempotency = {
    sameReferenceIsSameOperation: true, retryWhileInFlight: false, memoryMs: 30 * 24 * 60 * 60 * 1000, duplicateIsAnError: true, lookupByReference: false,
    note: "PayPal pays a sender_batch_id at most once within 30 days and answers a repeat with a duplicate error plus a link to the original batch. It does not promise that a repeat during processing is safe, and cannot be looked up by our reference. An interrupted payout is reconciled item by item, not retried blindly.",
  } as const;
  private memo: { mode: string; caps: Set<Capability> } | null = null;

  constructor(private readonly client?: () => PayPalClient) {}

  get mode(): ReturnType<typeof paypalMode> {
    return paypalMode();
  }

  get capabilities(): ReadonlySet<Capability> {
    const mode = paypalMode();
    if (this.memo?.mode !== mode) this.memo = { mode, caps: capabilitiesFor(mode) };
    return this.memo.caps;
  }

  private pp(): PayPalClient {
    return this.client ? this.client() : getPayPal();
  }

  private has(c: Capability) {
    if (!this.capabilities.has(c)) throw unsupported(PROVIDER, c);
  }

  readonly holds = {
    authorize: (r: AuthorizeHoldRequest): Promise<HoldFacts> => {
      this.has("funding.test-instrument");
      return call(async () => {
        const f = await authorizeHold(this.pp(), { rootId: r.reference, title: r.title, currency: r.amount.currency, amountMinor: r.amount.minor });
        return holdFacts(f);
      });
    },
    requestApproval: (r: ApprovalRequestArgs): Promise<ApprovalFacts> => {
      this.has("funding.approval-link");
      return call(async () => {
        const f = await requestHoldApproval(this.pp(), {
          rootId: r.reference, title: r.title, currency: r.amount.currency, amountMinor: r.amount.minor,
          returnUrl: r.returnUrl, cancelUrl: r.cancelUrl,
        });
        return { orderRef: railRef(PROVIDER, "order", f.orderId), status: f.status, approvalUrl: f.approveUrl };
      });
    },
    readOrder: (order: RailRef<"order">): Promise<OrderFacts> => call(async () => {
      const o = await getOrder(this.pp(), order.id);
      return {
        ref: railRef(PROVIDER, "order", o.id), status: o.status, intent: o.intent, externalRef: o.customId,
        amount: o.amountMinor === null || o.currency === null ? null : amount(o.amountMinor, o.currency),
        payerId: o.payerId, payerEmail: o.payerEmail,
      };
    }),
    authorizeApproved: (r: { order: RailRef<"order">; reference: string }): Promise<HoldFacts> => {
      this.has("funding.approval-link");
      return call(async () => holdFacts(await authorizeApprovedOrder(this.pp(), r.order.id, r.reference)));
    },
    read: (hold: RailRef<"authorization">): Promise<HoldFacts> => call(async () => holdFacts(await getAuthorization(this.pp(), hold.id))),
    capture: (r: CaptureRequest): Promise<CaptureFacts> => {
      this.has("hold.capture");
      return call(async () => {
        const c = await capturePart(this.pp(), r.hold.id, { spendId: r.reference, amountMinor: r.amount.minor, currency: r.amount.currency, note: r.note });
        return { ref: railRef(PROVIDER, "capture", c.id), status: c.status, amount: amount(c.amountMinor, c.currency), externalRef: c.invoiceId };
      });
    },
    readCapture: (capture: RailRef<"capture">): Promise<CaptureFacts> => call(async () => {
      const c = await getCapture(this.pp(), capture.id);
      return { ref: railRef(PROVIDER, "capture", c.id), status: c.status, amount: amount(c.amountMinor, c.currency), externalRef: c.invoiceId };
    }),
    void: (r: VoidRequest): Promise<void> => {
      this.has("hold.void");
      return call(async () => { await voidAuthorization(this.pp(), r.hold.id, r.reference); });
    },
  };

  readonly payouts = {
    send: (r: PayoutRequest): Promise<PayoutFacts> => {
      this.has("payout.send");
      return call(async () => payoutFacts(await payout(this.pp(), {
        spendId: r.reference, receiverEmail: r.receiver, amountMinor: r.amount.minor, currency: r.amount.currency, note: r.note,
      }), r.receiver));
    },
    read: (p: RailRef<"payout">): Promise<PayoutFacts> => call(async () => payoutFacts(await getPayout(this.pp(), p.id), null)),
    cancel: (item: RailRef<"payout_item">) => {
      this.has("payout.cancel");
      return call(async () => {
        const r = await cancelPayoutItem(this.pp(), item.id);
        return { itemRef: railRef(PROVIDER, "payout_item", r.itemId), itemStatus: r.itemStatus };
      });
    },
  };

  readonly refunds = {
    refund: (r: RefundRequest): Promise<RefundFacts> => {
      this.has("refund.capture");
      return call(async () => {
        const f = await refundCapture(this.pp(), r.capture.id, r.reference, r.note);
        return { ref: railRef(PROVIDER, "refund", f.id), status: f.status };
      });
    },
  };

  readonly reporting = {
    balance: (currency: string): Promise<BalanceFacts | null> => {
      this.has("reporting.balance");
      return call(async () => {
        const b = await getBalance(this.pp(), currency);
        return b ? { currency: b.currency, totalMinor: b.totalMinor, availableMinor: b.availableMinor, withheldMinor: b.withheldMinor, asOf: b.asOf, accountId: b.accountId } : null;
      });
    },
    statement: (range: { from: Date; to: Date }): Promise<StatementLine[]> => {
      this.has("reporting.statement");
      return call(async () => (await listTransactions(this.pp(), range.from, range.to)).map((l) => ({
        id: l.id, code: l.code, at: l.at, amountMinor: l.amountMinor, feeMinor: l.feeMinor, currency: l.currency,
        status: l.status, invoiceId: l.invoiceId, customField: l.customField, reference: l.reference,
      })));
    },
  };

  readonly events = {
    /** PayPal's event shape. The only place that knows it. */
    parse: (body: unknown): { id: string; type: string; resource: Record<string, unknown> } | null => {
      const b = body as { id?: unknown; event_type?: unknown; resource?: unknown } | null;
      if (!b || typeof b.id !== "string" || !b.id || b.id.length > 100) return null;
      if (typeof b.event_type !== "string" || !b.event_type || b.event_type.length > 100) return null;
      if (b.resource !== undefined && (typeof b.resource !== "object" || b.resource === null)) return null;
      return { id: b.id, type: b.event_type, resource: (b.resource ?? {}) as Record<string, unknown> };
    },
    verify: (r: WebhookRequest): Promise<boolean> => {
      this.has("events.verify");
      return call(async () => {
        const h: EventHeaders = {
          authAlgo: r.headers["paypal-auth-algo"] ?? "",
          certUrl: r.headers["paypal-cert-url"] ?? "",
          transmissionId: r.headers["paypal-transmission-id"] ?? "",
          transmissionSig: r.headers["paypal-transmission-sig"] ?? "",
          transmissionTime: r.headers["paypal-transmission-time"] ?? "",
        };
        // PayPal signs the headers it sent; without all of them there is nothing to verify.
        if (Object.values(h).some((x) => !x)) return false;
        return verifyWebhookSignature(this.pp(), r.endpointId, h, r.rawBody);
      });
    },
    list: (since?: Date): Promise<RailEvent[]> => {
      this.has("events.list");
      return call(async () => (await listEvents(this.pp(), since)).map((e) => ({
        id: e.id, type: e.event_type, createdAt: e.create_time ?? null, resource: e.resource ?? {},
      })));
    },
  };

  readonly trail = {
    calls: (keys: string[]): Promise<RailCall[]> => {
      this.has("observability.trail");
      return call(async () => {
        const rows = await callsFor(keys);
        const first = new Set<string>();
        const repeat = (c: { requestId: string | null; op: string; httpStatus: number }) => {
          if (!c.requestId || c.httpStatus >= 300) return false;
          const k = `${c.op}|${c.requestId}`;
          if (first.has(k)) return true;
          first.add(k);
          return false;
        };
        return rows.map((c) => ({
          at: c.at.toISOString(), op: c.op, text: OP_TEXT[c.op] ?? c.op,
          moves: MOVES.includes(c.op), repeat: repeat(c),
          method: c.method, path: c.path, httpStatus: c.httpStatus,
          providerStatus: c.paypalStatus, error: c.error, providerDebugId: c.debugId,
          resourceId: c.resourceId, amountMinor: c.amountMinor, currency: c.currency,
          ms: c.ms, requestId: c.requestId,
        }));
      });
    },
  };

  /** Records of this adapter's calls are written in the background; wait for them. */
  async flush(): Promise<void> {
    await flushJournal();
  }

  readonly disputes = {
    forCapture: (capture: RailRef<"capture">): Promise<DisputeFacts[]> => {
      this.has("dispute.read");
      return call(async () => (await disputesFor(this.pp(), capture.id)).map(disputeFacts));
    },
    list: (): Promise<DisputeFacts[]> => {
      this.has("dispute.read");
      return call(async () => (await listDisputes(this.pp())).map(disputeFacts));
    },
    respond: (dispute: RailRef<"dispute">, notes: string): Promise<void> => {
      this.has("dispute.respond");
      return call(async () => { await provideEvidence(this.pp(), dispute.id, notes); });
    },
  };
}

function holdFacts(a: { id: string; orderId: string | null; status: string; amountMinor: number; currency: string; expiresAt: string | null; customId: string | null }): HoldFacts {
  return {
    ref: railRef(PROVIDER, "authorization", a.id),
    orderRef: a.orderId ? railRef(PROVIDER, "order", a.orderId) : null,
    status: a.status, amount: amount(a.amountMinor, a.currency), expiresAt: a.expiresAt, externalRef: a.customId,
  };
}

function payoutFacts(p: { batchId: string; batchStatus: string; itemId: string | null; itemStatus: string | null; amount: Amount | null; transactionId: string | null; receiver: string | null; error: string | null }, receiver: string | null): PayoutFacts {
  return {
    batchRef: railRef(PROVIDER, "payout", p.batchId),
    itemRef: p.itemId ? railRef(PROVIDER, "payout_item", p.itemId) : null,
    batchStatus: p.batchStatus, itemStatus: p.itemStatus, amount: p.amount, transactionId: p.transactionId,
    receiver: p.receiver ?? receiver, error: p.error,
  };
}

function disputeFacts(d: { id: string; status: string; reason: string | null; stage: string | null; amountMinor: number | null; currency: string | null; createdAt: string | null; transactionIds: string[] }): DisputeFacts {
  return {
    ref: railRef(PROVIDER, "dispute", d.id), status: d.status, reason: d.reason, stage: d.stage,
    amountMinor: d.amountMinor, currency: d.currency, createdAt: d.createdAt, transactionIds: d.transactionIds,
  };
}

/** Named refusals the gateway reacts to, kept in one place so no caller compares bare strings. */
export const PAYPAL_CODES = {
  duplicatePayout: "DUPLICATE_REQUEST_ID",
  alreadyRefunded: "CAPTURE_FULLY_REFUNDED",
  batchNotCompleted: "BATCH_NOT_COMPLETED",
  overCapture: "MAX_CAPTURE_AMOUNT_EXCEEDED",
  orderNotApproved: "ORDER_NOT_APPROVED",
} as const;

/** Exposed for the recovery paths that must tell "PayPal has no such record" from "PayPal refused". */
export const missing = (what: string) => notFound(PROVIDER, what);
export const refused = (code: string, message: string) => declined(PROVIDER, code, message);

export function paypalRail(client?: () => PayPalClient): PayPalRail {
  return new PayPalRail(client);
}
