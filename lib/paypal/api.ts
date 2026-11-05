/**
 * Typed PayPal operations + parsers that convert PayPal resources into Kept's
 * domain (integer minor units). Parsers are strict: if a field Kept relies on is
 * missing or malformed they throw instead of guessing.
 */
import { z } from "zod";
import { toDecimalString, toMinor } from "../money";
import type { PayPalClient } from "./client";
import type { DisputeAction } from "../db/schema";

const Money = z.object({ currency_code: z.string().length(3), value: z.string() });

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type CreateOrderInput = {
  keptOrderId: string;
  currency: string;
  itemTotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  shippingDiscountMinor: number;
  /** Order-level discount, e.g. Kept honouring a total the merchant's assistant promised. */
  discountMinor?: number;
  totalMinor: number;
  lines: Array<{ name: string; sku: string; qty: number; unitMinor: number }>;
  description: string;
  requestId: string;
  returnUrl: string;
  cancelUrl: string;
};

export async function createOrder(pp: PayPalClient, input: CreateOrderInput) {
  const c = input.currency;
  const discount = input.discountMinor ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > input.itemTotalMinor) throw new Error("Invalid order discount");
  if (input.itemTotalMinor + input.shippingMinor + input.taxMinor - input.shippingDiscountMinor - discount !== input.totalMinor) {
    throw new Error("Order breakdown does not add up to total");
  }
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.keptOrderId,
        custom_id: input.keptOrderId, // the binding: PayPal echoes this on captures/refunds/webhooks
        invoice_id: input.keptOrderId,
        description: input.description.slice(0, 127),
        soft_descriptor: "ADAEZE STUDIO",
        amount: {
          currency_code: c,
          value: toDecimalString(input.totalMinor, c),
          breakdown: {
            item_total: { currency_code: c, value: toDecimalString(input.itemTotalMinor, c) },
            shipping: { currency_code: c, value: toDecimalString(input.shippingMinor, c) },
            tax_total: { currency_code: c, value: toDecimalString(input.taxMinor, c) },
            ...(input.shippingDiscountMinor > 0 ? { shipping_discount: { currency_code: c, value: toDecimalString(input.shippingDiscountMinor, c) } } : {}),
            ...(discount > 0 ? { discount: { currency_code: c, value: toDecimalString(discount, c) } } : {}),
          },
        },
        items: input.lines.map((l) => ({
          name: l.name.slice(0, 127),
          sku: l.sku,
          quantity: String(l.qty),
          unit_amount: { currency_code: c, value: toDecimalString(l.unitMinor, c) },
          category: "PHYSICAL_GOODS",
        })),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Adaeze Studio (Kept demo)",
          user_action: "PAY_NOW",
          shipping_preference: "GET_FROM_FILE",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  };
  const res = await pp.request<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
    body,
    requestId: input.requestId,
    prefer: "return=representation",
  });
  if (!res.id) throw new Error("PayPal create order returned no id");
  return res;
}

export async function getOrder(pp: PayPalClient, paypalOrderId: string) {
  return pp.request<Record<string, unknown>>("GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export async function captureOrder(pp: PayPalClient, paypalOrderId: string, requestId: string) {
  return pp.request<Record<string, unknown>>("POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    requestId,
    prefer: "return=representation",
    body: {},
  });
}

const OrderCaptureRef = z.object({
  id: z.string(),
  purchase_units: z.array(z.object({
    custom_id: z.string().optional(),
    payments: z.object({ captures: z.array(z.object({ id: z.string(), status: z.string() })).optional() }).optional(),
  })).min(1),
  payer: z.object({
    name: z.object({ given_name: z.string().optional() }).optional(),
    email_address: z.string().optional(),
  }).optional(),
});

/** From an order (create/get/capture response) pull the capture id and custom_id. */
export function parseOrderCaptureRef(order: unknown) {
  const o = OrderCaptureRef.parse(order);
  const pu = o.purchase_units[0]!;
  const cap = pu.payments?.captures?.[0];
  return {
    paypalOrderId: o.id,
    customId: pu.custom_id ?? null,
    captureId: cap?.id ?? null,
    captureStatus: cap?.status ?? null,
    payerFirstName: o.payer?.name?.given_name ?? null,
    payerEmail: o.payer?.email_address ?? null,
  };
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

const CaptureSchema = z.object({
  id: z.string(),
  status: z.enum(["COMPLETED", "DECLINED", "PARTIALLY_REFUNDED", "PENDING", "REFUNDED", "FAILED"]),
  status_details: z.object({ reason: z.string() }).optional(),
  amount: Money,
  custom_id: z.string().optional(),
  invoice_id: z.string().optional(),
  seller_receivable_breakdown: z.object({
    gross_amount: Money,
    paypal_fee: Money.optional(),
    net_amount: Money.optional(),
  }).optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
});

export type CaptureFacts = {
  captureId: string;
  status: z.infer<typeof CaptureSchema>["status"];
  statusReason: string | null;
  amountMinor: number;
  currency: string;
  feeMinor: number | null;
  netMinor: number | null;
  customId: string | null;
  paypalOrderId: string | null;
  createdAt: Date | null;
};

export function parseCapture(raw: unknown): CaptureFacts {
  const c = CaptureSchema.parse(raw);
  const cur = c.amount.currency_code;
  const fee = c.seller_receivable_breakdown?.paypal_fee;
  const net = c.seller_receivable_breakdown?.net_amount;
  return {
    captureId: c.id,
    status: c.status,
    statusReason: c.status_details?.reason ?? null,
    amountMinor: toMinor(c.amount.value, cur),
    currency: cur,
    feeMinor: fee ? toMinor(fee.value, fee.currency_code) : null,
    netMinor: net ? toMinor(net.value, net.currency_code) : null,
    customId: c.custom_id ?? null,
    paypalOrderId: c.supplementary_data?.related_ids?.order_id ?? null,
    createdAt: c.create_time ? new Date(c.create_time) : null,
  };
}

export async function getCapture(pp: PayPalClient, captureId: string): Promise<CaptureFacts> {
  return parseCapture(await pp.request("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`));
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

const RefundSchema = z.object({
  id: z.string(),
  status: z.enum(["CANCELLED", "FAILED", "PENDING", "COMPLETED"]),
  status_details: z.object({ reason: z.string() }).optional(),
  amount: Money.optional(),
  custom_id: z.string().optional(),
  invoice_id: z.string().optional(),
  create_time: z.string().optional(),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
});

export type RefundFacts = {
  refundId: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  statusReason: string | null;
  amountMinor: number | null;
  currency: string | null;
  customId: string | null;
  captureId: string | null;
  createdAt: Date | null;
};

export function parseRefund(raw: unknown): RefundFacts {
  const r = RefundSchema.parse(raw);
  const up = r.links?.find((l) => l.rel === "up")?.href ?? "";
  const capMatch = up.match(/\/captures\/([^/?]+)/);
  return {
    refundId: r.id,
    status: r.status,
    statusReason: r.status_details?.reason ?? null,
    amountMinor: r.amount ? toMinor(r.amount.value, r.amount.currency_code) : null,
    currency: r.amount?.currency_code ?? null,
    customId: r.custom_id ?? null,
    captureId: capMatch?.[1] ?? null,
    createdAt: r.create_time ? new Date(r.create_time) : null,
  };
}

export type RefundRequest = {
  captureId: string;
  amountMinor: number;
  currency: string;
  keptOrderId: string;
  noteToPayer: string;
  requestId: string;
  mockResponse?: string;
};

/** The exact request Kept will send — shown verbatim to the merchant before approval. */
export function buildRefundRequest(r: RefundRequest) {
  return {
    method: "POST" as const,
    path: `/v2/payments/captures/${r.captureId}/refund`,
    headers: { "PayPal-Request-Id": r.requestId, Prefer: "return=representation" },
    body: {
      amount: { currency_code: r.currency, value: toDecimalString(r.amountMinor, r.currency) },
      custom_id: r.keptOrderId,
      note_to_payer: r.noteToPayer.slice(0, 255),
    },
  };
}

export async function refundCapture(pp: PayPalClient, r: RefundRequest): Promise<RefundFacts> {
  const req = buildRefundRequest(r);
  const raw = await pp.request("POST", req.path, {
    body: req.body,
    requestId: r.requestId,
    prefer: "return=representation",
    mockResponse: r.mockResponse,
  });
  return parseRefund(raw);
}

export async function getRefund(pp: PayPalClient, refundId: string): Promise<RefundFacts> {
  return parseRefund(await pp.request("GET", `/v2/payments/refunds/${encodeURIComponent(refundId)}`));
}

// ---------------------------------------------------------------------------
// Shipment tracking (Orders v2 /track)
// ---------------------------------------------------------------------------

export const CARRIERS = ["DHL", "UPS", "FEDEX", "USPS", "OTHER"] as const;

export async function addTracking(pp: PayPalClient, args: {
  paypalOrderId: string; captureId: string; trackingNumber: string; carrier: (typeof CARRIERS)[number]; requestId: string;
}) {
  const body: Record<string, unknown> = {
    capture_id: args.captureId,
    tracking_number: args.trackingNumber,
    carrier: args.carrier,
    notify_payer: true,
  };
  if (args.carrier === "OTHER") body.carrier_name_other = "Local courier";
  const order = await pp.request<Record<string, unknown>>("POST", `/v2/checkout/orders/${encodeURIComponent(args.paypalOrderId)}/track`, {
    body,
    requestId: args.requestId,
  });
  return parseTrackers(order).find((t) => t.trackingNumber === args.trackingNumber) ?? null;
}

const TrackerSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  create_time: z.string().optional(),
  items: z.array(z.unknown()).optional(),
});

/** Trackers as PayPal reports them on the order resource. */
export function parseTrackers(order: unknown): Array<{ trackerId: string | null; trackingNumber: string | null; status: string; createdAt: Date | null }> {
  const pus = (order as { purchase_units?: Array<{ shipping?: { trackers?: unknown[] } }> })?.purchase_units ?? [];
  const out: Array<{ trackerId: string | null; trackingNumber: string | null; status: string; createdAt: Date | null }> = [];
  for (const pu of pus) {
    for (const raw of pu.shipping?.trackers ?? []) {
      const t = TrackerSchema.parse(raw);
      // PayPal tracker ids are "<captureId>-<trackingNumber>"
      const num = t.id?.includes("-") ? t.id.slice(t.id.indexOf("-") + 1) : null;
      out.push({ trackerId: t.id ?? null, trackingNumber: num, status: t.status ?? "UNKNOWN", createdAt: t.create_time ? new Date(t.create_time) : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

const DisputeSchema = z.object({
  dispute_id: z.string(),
  reason: z.string().optional(),
  status: z.string().optional(),
  dispute_life_cycle_stage: z.string().optional(),
  dispute_amount: Money.optional(),
  create_time: z.string().optional(),
  disputed_transactions: z.array(z.object({ seller_transaction_id: z.string().optional(), custom: z.string().optional() })).optional(),
});

export type DisputeFacts = {
  disputeId: string;
  reason: string | null;
  status: string | null;
  stage: string | null;
  amountMinor: number | null;
  currency: string | null;
  createdAt: Date | null;
  sellerTransactionIds: string[];
};

export function parseDispute(raw: unknown): DisputeFacts {
  const d = DisputeSchema.parse(raw);
  return {
    disputeId: d.dispute_id,
    reason: d.reason ?? null,
    status: d.status ?? null,
    stage: d.dispute_life_cycle_stage ?? null,
    amountMinor: d.dispute_amount ? toMinor(d.dispute_amount.value, d.dispute_amount.currency_code) : null,
    currency: d.dispute_amount?.currency_code ?? null,
    createdAt: d.create_time ? new Date(d.create_time) : null,
    sellerTransactionIds: (d.disputed_transactions ?? []).map((t) => t.seller_transaction_id).filter((x): x is string => Boolean(x)),
  };
}

export async function getDispute(pp: PayPalClient, disputeId: string): Promise<DisputeFacts> {
  return parseDispute(await pp.request("GET", `/v1/customer/disputes/${encodeURIComponent(disputeId)}`));
}

export async function listDisputesForTransaction(pp: PayPalClient, captureId: string) {
  const res = await pp.request<{ items?: Array<{ dispute_id: string }> }>("GET", "/v1/customer/disputes", {
    query: { disputed_transaction_id: captureId },
  });
  return (res.items ?? []).map((i) => i.dispute_id);
}

// ---------------------------------------------------------------------------
// Webhooks (management)
// ---------------------------------------------------------------------------

export const SUBSCRIBED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.REFUND.PENDING",
  "PAYMENT.REFUND.FAILED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
] as const;

export async function createWebhook(pp: PayPalClient, url: string) {
  return pp.request<{ id: string }>("POST", "/v1/notifications/webhooks", {
    body: { url, event_types: SUBSCRIBED_EVENTS.map((name) => ({ name })) },
  });
}

export async function listWebhooks(pp: PayPalClient) {
  return pp.request<{ webhooks?: Array<{ id: string; url: string }> }>("GET", "/v1/notifications/webhooks");
}

// ---------------------------------------------------------------------------
// Disputes — seller actions (Disputes API v1)
// ---------------------------------------------------------------------------


/** The exact request each dispute action sends — shown to the merchant before approval. */
export function buildDisputeRequest(a: DisputeAction) {
  const base = `/v1/customer/disputes/${a.disputeId}`;
  if (a.type === "MAKE_OFFER") {
    return { method: "POST" as const, path: `${base}/make-offer`, contentType: "application/json", body: { note: a.note.slice(0, 2000), offer_type: "REFUND", offer_amount: { currency_code: a.currency, value: toDecimalString(a.amountMinor, a.currency) } } };
  }
  if (a.type === "PROVIDE_EVIDENCE") {
    return { method: "POST" as const, path: `${base}/provide-evidence`, contentType: "multipart/form-data", body: { input: { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: a.carrier, tracking_number: a.trackingNumber }] }, notes: a.note.slice(0, 2000) }] } } };
  }
  return { method: "POST" as const, path: `${base}/send-message`, contentType: "application/json", body: { message: a.message.slice(0, 2000) } };
}

export async function executeDisputeAction(pp: PayPalClient, a: DisputeAction, requestId: string) {
  const req = buildDisputeRequest(a);
  if (req.contentType === "multipart/form-data") {
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify((req.body as { input: unknown }).input)], { type: "application/json" }), "input.json");
    return pp.request("POST", req.path, { form, requestId });
  }
  return pp.request("POST", req.path, { body: req.body, requestId });
}
