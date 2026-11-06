/**
 * LOCAL PAYPAL EMULATOR — NOT PAYPAL.
 *
 * A faithful-but-tiny in-process imitation of the PayPal REST endpoints Kept
 * uses, so the whole loop can be run and tested without sandbox credentials.
 * It is only reachable when PAYPAL_MODE=simulated, every record it produces is
 * labelled SIMULATED in the UI, and its "webhooks" carry no PayPal signature and
 * are rejected outright in sandbox/live mode.
 *
 * Behaviour mirrors the documented API where Kept depends on it:
 *  - PayPal-Request-Id idempotency on create/capture/refund
 *  - capture amount = order amount; custom_id echoed on captures and refunds
 *  - refunds cannot exceed the remaining captured amount
 *  - PayPal-Mock-Response style negative testing via `mockResponse`
 */
import { randomBytes } from "node:crypto";
import { toDecimalString, toMinor } from "../money";
import type { FetchLike } from "./client";
import { withEmulatorState } from "./emulator-store";

type Amount = { currency_code: string; value: string };
type EmOrder = { id: string; status: string; purchase_units: Array<Record<string, unknown>>; captureId?: string; trackers: Array<Record<string, unknown>> };
type EmCapture = { id: string; orderId: string; status: string; amountMinor: number; currency: string; customId: string; refundedMinor: number; createdAt: string };
type EmRefund = { id: string; captureId: string; status: string; amountMinor: number; currency: string; customId: string; createdAt: string; statusReason?: string };
export type EmEvent = { id: string; event_type: string; resource_type: string; resource: Record<string, unknown>; create_time: string; summary: string };

type State = {
  orders: Map<string, EmOrder>;
  captures: Map<string, EmCapture>;
  refunds: Map<string, EmRefund>;
  idem: Map<string, { status: number; body: unknown }>;
  outbox: EmEvent[];
  /** Refunds created in "pending" mock mode, completed by `settlePendingRefunds`. */
};

declare global {
  // eslint-disable-next-line no-var
  var __keptPayPalEmulator: State | undefined;
}

function state(): State {
  if (!globalThis.__keptPayPalEmulator) {
    globalThis.__keptPayPalEmulator = { orders: new Map(), captures: new Map(), refunds: new Map(), idem: new Map(), outbox: [] };
  }
  return globalThis.__keptPayPalEmulator;
}

export function resetEmulator() {
  globalThis.__keptPayPalEmulator = undefined;
}

const pid = (prefix: string) => `${prefix}${randomBytes(8).toString("hex").toUpperCase()}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": "SIMULATED" } });
const err = (status: number, name: string, issue: string, description: string) => json(status, { name, message: description, debug_id: "SIMULATED", details: [{ issue, description }] });

function captureResource(c: EmCapture) {
  const fee = Math.round(c.amountMinor * 0.0349) + 49; // illustrative fee, labelled simulated
  return {
    id: c.id,
    status: c.status,
    amount: { currency_code: c.currency, value: toDecimalString(c.amountMinor, c.currency) },
    custom_id: c.customId,
    invoice_id: c.customId,
    seller_receivable_breakdown: {
      gross_amount: { currency_code: c.currency, value: toDecimalString(c.amountMinor, c.currency) },
      paypal_fee: { currency_code: c.currency, value: toDecimalString(fee, c.currency) },
      net_amount: { currency_code: c.currency, value: toDecimalString(c.amountMinor - fee, c.currency) },
    },
    supplementary_data: { related_ids: { order_id: c.orderId } },
    create_time: c.createdAt,
    update_time: new Date().toISOString(),
  };
}

function refundResource(r: EmRefund) {
  return {
    id: r.id,
    status: r.status,
    ...(r.statusReason ? { status_details: { reason: r.statusReason } } : {}),
    amount: { currency_code: r.currency, value: toDecimalString(r.amountMinor, r.currency) },
    custom_id: r.customId,
    create_time: r.createdAt,
    links: [{ rel: "up", href: `https://emulator.invalid/v2/payments/captures/${r.captureId}` }],
  };
}

function emit(event_type: string, resource_type: string, resource: Record<string, unknown>, summary: string) {
  state().outbox.push({ id: `WH-SIM-${randomBytes(8).toString("hex").toUpperCase()}`, event_type, resource_type, resource, create_time: new Date().toISOString(), summary });
}

/** Drain queued simulated webhook events (the app delivers them to its own ingest path). */
export function drainEmulatorEvents(): EmEvent[] {
  const s = state();
  const out = s.outbox;
  s.outbox = [];
  return out;
}

/** Complete refunds that were created as PENDING (simulates PayPal settling later). */
export function settlePendingRefunds() {
  for (const r of state().refunds.values()) {
    if (r.status === "PENDING") {
      r.status = "COMPLETED";
      delete r.statusReason;
      emit("PAYMENT.CAPTURE.REFUNDED", "refund", refundResource(r), `A ${r.currency} ${toDecimalString(r.amountMinor, r.currency)} capture payment was refunded`);
    }
  }
}

/** Buyer approval happens in PayPal's UI; the emulator's checkout page calls this. */
export function approveEmulatorOrder(orderId: string, payer = { given_name: "Tom", email: "tom.buyer@example.com" }) {
  const o = state().orders.get(orderId);
  if (!o) throw new Error("unknown simulated order");
  if (o.status === "CREATED" || o.status === "PAYER_ACTION_REQUIRED") {
    o.status = "APPROVED";
    (o as unknown as Record<string, unknown>).payer = { name: { given_name: payer.given_name }, email_address: payer.email };
    emit("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: o.id, status: o.status, purchase_units: o.purchase_units }, `An order has been approved by buyer`);
  }
}

/** Open a dispute on a capture (normally done by the buyer in PayPal's Resolution Center). */
/** Test/demo helper: another system changes an order's amount (as a PATCH would) after Kept verified it. */
export function mutateEmulatorOrderAmount(paypalOrderId: string, value: string, currency?: string) {
  const o = state().orders.get(paypalOrderId);
  if (!o) throw new Error("unknown simulated order");
  const pu = o.purchase_units[0] as { amount: Amount };
  pu.amount = { ...pu.amount, value, ...(currency ? { currency_code: currency } : {}) };
}

export function openEmulatorDispute(captureId: string, reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
  const c = state().captures.get(captureId);
  if (!c) throw new Error("unknown simulated capture");
  const d = { dispute_id: pid("PP-D-SIM-"), reason, status: "OPEN", dispute_life_cycle_stage: "INQUIRY", dispute_amount: { currency_code: c.currency, value: toDecimalString(c.amountMinor, c.currency) }, create_time: new Date().toISOString(), disputed_transactions: [{ seller_transaction_id: c.id }] };
  (state() as unknown as { disputes?: Map<string, unknown> }).disputes ??= new Map();
  (state() as unknown as { disputes: Map<string, unknown> }).disputes.set(d.dispute_id, d);
  emit("CUSTOMER.DISPUTE.CREATED", "dispute", d, "A new dispute opened");
  return d.dispute_id;
}

/** Loaded from / saved to Postgres around each call when KEPT_EMULATOR_PERSIST=1. */
export const emulatorFetch: FetchLike = (input, init) => withEmulatorState(() => emulatorFetchInner(input, init));

const emulatorFetchInner: FetchLike = async (input, init) => {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  const path = url.pathname;
  const headers = new Headers(init.headers);
  const s = state();
  if (path === "/v1/oauth2/token") return json(200, { access_token: "SIMULATED-TOKEN", expires_in: 32400, token_type: "Bearer" });
  let body: Record<string, unknown> & { [k: string]: any } = {};
  if (init.body instanceof FormData) {
    const part = init.body.get("input");
    body = part ? JSON.parse(typeof part === "string" ? part : await (part as Blob).text()) : {};
  } else if (init.body) body = JSON.parse(String(init.body));
  const requestId = headers.get("PayPal-Request-Id");
  const mock = headers.get("PayPal-Mock-Response");

  const idemKey = requestId ? `${method} ${path} ${requestId}` : null;
  if (idemKey && s.idem.has(idemKey)) {
    const prev = s.idem.get(idemKey)!;
    return json(prev.status, prev.body);
  }
  const remember = (status: number, b: unknown) => {
    if (idemKey && status < 500) s.idem.set(idemKey, { status, body: b });
    return json(status, b);
  };

  if (mock) {
    const code = (JSON.parse(mock) as { mock_application_codes?: string }).mock_application_codes ?? "INTERNAL_SERVER_ERROR";
    if (code === "INTERNAL_SERVER_ERROR") return err(500, "INTERNAL_SERVER_ERROR", code, "Simulated PayPal outage");
    if (code !== "REFUND_PENDING") return remember(422, { name: "UNPROCESSABLE_ENTITY", message: "Simulated failure", debug_id: "SIMULATED", details: [{ issue: code, description: `Simulated ${code}` }] });
  }

  // ---- Orders
  if (method === "POST" && path === "/v2/checkout/orders") {
    const id = pid("SIM");
    const o: EmOrder = { id, status: "PAYER_ACTION_REQUIRED", purchase_units: body.purchase_units, trackers: [] };
    s.orders.set(id, o);
    return remember(201, { id, status: o.status, purchase_units: o.purchase_units, links: [{ rel: "payer-action", href: `/emulator/checkout/${id}` }] });
  }
  let m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
  if (m && method === "GET") {
    const o = s.orders.get(m[1]!);
    if (!o) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Order not found");
    return json(200, orderView(o));
  }
  m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
  if (m && method === "POST") {
    const o = s.orders.get(m[1]!);
    if (!o) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Order not found");
    if (o.status === "COMPLETED") return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "ORDER_ALREADY_CAPTURED", description: "Order already captured" }] });
    if (o.status !== "APPROVED") return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "ORDER_NOT_APPROVED", description: "Payer has not approved the order" }] });
    const pu = o.purchase_units[0] as { amount: Amount; custom_id: string };
    const cap: EmCapture = { id: pid("SIMCAP"), orderId: o.id, status: "COMPLETED", amountMinor: toMinor(pu.amount.value, pu.amount.currency_code), currency: pu.amount.currency_code, customId: pu.custom_id, refundedMinor: 0, createdAt: new Date().toISOString() };
    s.captures.set(cap.id, cap);
    o.status = "COMPLETED";
    o.captureId = cap.id;
    emit("PAYMENT.CAPTURE.COMPLETED", "capture", captureResource(cap), `Payment completed for ${cap.currency} ${toDecimalString(cap.amountMinor, cap.currency)}`);
    return remember(201, orderView(o));
  }
  m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/track$/);
  if (m && method === "POST") {
    const o = s.orders.get(m[1]!);
    if (!o || !o.captureId) return err(422, "UNPROCESSABLE_ENTITY", "CAPTURE_NOT_FOUND", "No capture on order");
    if (body.capture_id !== o.captureId) return err(422, "UNPROCESSABLE_ENTITY", "INVALID_CAPTURE_ID", "Capture does not belong to order");
    o.trackers.push({ id: `${o.captureId}-${body.tracking_number}`, status: "SHIPPED", create_time: new Date().toISOString() });
    return remember(201, orderView(o));
  }

  // ---- Captures & refunds
  m = path.match(/^\/v2\/payments\/captures\/([^/]+)$/);
  if (m && method === "GET") {
    const c = s.captures.get(m[1]!);
    return c ? json(200, captureResource(c)) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found");
  }
  m = path.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
  if (m && method === "POST") {
    const c = s.captures.get(m[1]!);
    if (!c) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found");
    const amt = body.amount ? toMinor(body.amount.value, body.amount.currency_code) : c.amountMinor - c.refundedMinor;
    if (body.amount && body.amount.currency_code !== c.currency) return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "REFUND_CAPTURE_CURRENCY_MISMATCH", description: "Currency mismatch" }] });
    if (c.refundedMinor >= c.amountMinor) return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "CAPTURE_FULLY_REFUNDED", description: "Capture already fully refunded" }] });
    if (amt > c.amountMinor - c.refundedMinor) return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "REFUND_AMOUNT_EXCEEDED", description: "Refund exceeds captured amount" }] });
    const pending = mock && JSON.parse(mock).mock_application_codes === "REFUND_PENDING";
    const r: EmRefund = { id: pid("SIMREF"), captureId: c.id, status: pending ? "PENDING" : "COMPLETED", amountMinor: amt, currency: c.currency, customId: body.custom_id ?? c.customId, createdAt: new Date().toISOString(), ...(pending ? { statusReason: "ECHECK" } : {}) };
    s.refunds.set(r.id, r);
    c.refundedMinor += amt;
    c.status = c.refundedMinor >= c.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (r.status === "COMPLETED") emit("PAYMENT.CAPTURE.REFUNDED", "refund", refundResource(r), `A ${r.currency} ${toDecimalString(amt, r.currency)} capture payment was refunded`);
    else emit("PAYMENT.REFUND.PENDING", "refund", refundResource(r), "A refund is pending");
    return remember(201, refundResource(r));
  }
  m = path.match(/^\/v2\/payments\/refunds\/([^/]+)$/);
  if (m && method === "GET") {
    const r = s.refunds.get(m[1]!);
    return r ? json(200, refundResource(r)) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Refund not found");
  }

  // ---- Disputes
  m = path.match(/^\/v1\/customer\/disputes\/([^/]+)\/(make-offer|provide-evidence|send-message)$/);
  if (m && method === "POST") {
    const ds = (state() as unknown as { disputes?: Map<string, Record<string, unknown>> }).disputes;
    const d = ds?.get(m[1]!);
    if (!d) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Dispute not found");
    if (m[2] === "make-offer") {
      if (d.dispute_life_cycle_stage !== "INQUIRY") return remember(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "SIMULATED", details: [{ issue: "INVALID_STAGE", description: "Offers are only allowed in the INQUIRY stage" }] });
      d.status = "WAITING_FOR_BUYER_RESPONSE";
      d.offer = body.offer_amount;
    } else if (m[2] === "provide-evidence") {
      d.status = "UNDER_REVIEW";
      d.evidences = body.evidences;
    } else {
      (d.messages as unknown[] | undefined)?.push(body.message) ?? (d.messages = [body.message]);
    }
    emit("CUSTOMER.DISPUTE.UPDATED", "dispute", d, "A dispute was updated");
    return remember(200, { links: [{ rel: "self", href: `/v1/customer/disputes/${d.dispute_id}` }] });
  }
  m = path.match(/^\/v1\/customer\/disputes\/([^/]+)$/);
  if (m && method === "GET") {
    const d = (state() as unknown as { disputes?: Map<string, unknown> }).disputes?.get(m[1]!);
    return d ? json(200, d) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Dispute not found");
  }

  return err(404, "NOT_SUPPORTED_BY_EMULATOR", "NOT_FOUND", `${method} ${path} is not emulated`);
};

function orderView(o: EmOrder) {
  const cap = o.captureId ? state().captures.get(o.captureId) : undefined;
  return {
    id: o.id,
    status: o.status,
    payer: (o as unknown as Record<string, unknown>).payer,
    purchase_units: o.purchase_units.map((pu) => ({
      ...pu,
      ...(cap ? { payments: { captures: [captureResource(cap)] } } : {}),
      ...(o.trackers.length ? { shipping: { trackers: o.trackers } } : {}),
    })),
  };
}
