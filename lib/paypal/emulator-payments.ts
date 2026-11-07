/**
 * Simulated PayPal, payments side: Orders v2 (AUTHORIZE), Authorizations, Captures, Refunds and
 * Payouts, for PAYPAL_MODE=simulated only. Same state object as the invoicing simulator. The
 * "company approves on PayPal" step is the labelled page /sim/checkout/{orderId}.
 */
import { randomUUID } from "node:crypto";
import { appBaseUrl } from "../base-url";
import { simState, withSimState } from "../sim/store";
import { toDecimalString, toMinor } from "../money";

type Money = { currency_code: string; value: string };
type SimOrder = { id: string; status: "CREATED" | "APPROVED" | "COMPLETED"; intent: string; custom_id: string; description: string; amount: Money; items: Array<{ name: string; unit_amount: Money; quantity: string }>; return_url: string; cancel_url: string; authorization_id?: string };
type SimAuth = { id: string; status: "CREATED" | "CAPTURED" | "VOIDED" | "EXPIRED"; amount: Money; custom_id: string; expiration_time: string; create_time: string; capture_id?: string; reauthorized: number };
type SimCapture = { id: string; status: "COMPLETED" | "REFUNDED"; amount: Money; custom_id: string; fee: number; refund_id?: string };
type SimPayout = { batch_id: string; sender_batch_id: string; status: "PENDING" | "SUCCESS"; item_id: string; item_status: "PENDING" | "SUCCESS" | "UNCLAIMED"; receiver: string; amount: { currency: string; value: string } };
type PaySim = { orders: Record<string, SimOrder>; auths: Record<string, SimAuth>; captures: Record<string, SimCapture>; payouts: Record<string, SimPayout>; idem: Record<string, unknown>; balanceMinor: number; outbox: Array<Record<string, unknown>> };

function state(): PaySim {
  const s = simState<Record<string, unknown>>("paypal", () => ({}));
  const p = s as unknown as Partial<PaySim>;
  p.orders ??= {}; p.auths ??= {}; p.captures ??= {}; p.payouts ??= {}; p.idem ??= {}; p.balanceMinor ??= 0; p.outbox ??= [];
  return p as PaySim;
}

const id = (prefix: string) => `${prefix}${randomUUID().replace(/-/g, "").slice(0, 17).toUpperCase()}`;
let last: { status: number; body: unknown } | null = null;
const reply = (status: number, body: unknown) => { last = { status, body }; return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); };
const err = (status: number, name: string, issue: string, description: string) => reply(status, { name, message: description, debug_id: "sim", details: [{ issue, description }] });

function event(type: string, resource: Record<string, unknown>, summary: string) {
  state().outbox.push({ id: `WH-SIM-${randomUUID()}`, event_version: "1.0", create_time: new Date().toISOString(), event_type: type, resource_type: type.split(".")[1]?.toLowerCase(), summary, resource });
}

/** The company "logs in to PayPal and approves" (simulated payer page). */
export async function simApproveOrder(orderId: string): Promise<{ ok: boolean; returnUrl?: string; message?: string }> {
  return withSimState(() => {
    const o = state().orders[orderId];
    if (!o) return { ok: false, message: "No such order." };
    if (o.status !== "CREATED") return { ok: false, message: `Order is ${o.status}.` };
    o.status = "APPROVED";
    return { ok: true, returnUrl: `${o.return_url}${o.return_url.includes("?") ? "&" : "?"}token=${o.id}` };
  });
}

export async function simOrderSnapshot(orderId: string): Promise<SimOrder | null> {
  return withSimState(() => structuredClone(state().orders[orderId] ?? null));
}

/** Expire an authorization now (to demonstrate expiry handling). */
export async function simExpireAuthorization(authId: string) {
  return withSimState(() => { const a = state().auths[authId]; if (a && a.status === "CREATED") a.status = "EXPIRED"; });
}

/** Route payments calls; returns null if the path isn't a payments route. */
export function routePayments(url: URL, method: string, headers: Headers, body: Record<string, any>): Response | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = url.pathname;
  const s = state();
  const rid = headers.get("PayPal-Request-Id");
  const idem = (fn: () => Response): Response => {
    if (rid && s.idem[`${method} ${p} ${rid}`]) { const r = s.idem[`${method} ${p} ${rid}`] as { status: number; body: unknown }; return reply(r.status, r.body); }
    last = null;
    const res = fn();
    if (rid && res.status < 300 && last) s.idem[`${method} ${p} ${rid}`] = structuredClone(last); // same request id → same answer, no second effect
    return res;
  };
  let m: RegExpMatchArray | null;

  if (p === "/v2/checkout/orders" && method === "POST") return idem(() => {
    const pu = body?.purchase_units?.[0];
    if (body?.intent !== "AUTHORIZE" && body?.intent !== "CAPTURE") return err(422, "UNPROCESSABLE_ENTITY", "INVALID_INTENT", "intent must be CAPTURE or AUTHORIZE.");
    if (!pu?.amount?.value || !pu?.amount?.currency_code) return err(422, "UNPROCESSABLE_ENTITY", "AMOUNT_REQUIRED", "amount is required.");
    const ctx = body?.payment_source?.paypal?.experience_context ?? {};
    const o: SimOrder = { id: id("SIMORD"), status: "CREATED", intent: body.intent, custom_id: pu.custom_id ?? "", description: pu.description ?? "", amount: pu.amount, items: pu.items ?? [], return_url: ctx.return_url ?? appBaseUrl(), cancel_url: ctx.cancel_url ?? appBaseUrl() };
    s.orders[o.id] = o;
    return reply(200, { id: o.id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: `/v2/checkout/orders/${o.id}` }, { rel: "payer-action", href: `${appBaseUrl()}/sim/checkout/${o.id}` }] });
  });
  if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/)) && method === "GET") {
    const o = s.orders[m[1]!];
    if (!o) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Order not found.");
    const auth = o.authorization_id ? s.auths[o.authorization_id] : undefined;
    return reply(200, { id: o.id, status: o.status, intent: o.intent, purchase_units: [{ custom_id: o.custom_id, amount: o.amount, payments: auth ? { authorizations: [auth] } : undefined }] });
  }
  if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/)) && method === "POST") return idem(() => {
    const o = s.orders[m![1]!];
    if (!o) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Order not found.");
    if (o.status === "CREATED") return err(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.");
    if (o.status === "COMPLETED") return err(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_AUTHORIZED", "Order already authorized.");
    const now = new Date();
    const a: SimAuth = { id: id("SIMAUTH"), status: "CREATED", amount: o.amount, custom_id: o.custom_id, create_time: now.toISOString(), expiration_time: new Date(now.getTime() + 29 * 86400_000).toISOString(), reauthorized: 0 };
    s.auths[a.id] = a;
    o.status = "COMPLETED";
    o.authorization_id = a.id;
    event("PAYMENT.AUTHORIZATION.CREATED", { ...a }, `Payment authorized (simulated) for ${a.amount.value} ${a.amount.currency_code}`);
    return reply(201, { id: o.id, status: "COMPLETED", purchase_units: [{ custom_id: o.custom_id, payments: { authorizations: [a] } }] });
  });
  if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)$/)) && method === "GET") {
    const a = s.auths[m[1]!];
    return a ? reply(200, a) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Authorization not found.");
  }
  if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/(capture|void|reauthorize)$/)) && method === "POST") return idem(() => {
    const a = s.auths[m![1]!];
    if (!a) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Authorization not found.");
    const action = m![2]!;
    if (a.status === "EXPIRED") return err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_EXPIRED", "Authorization has expired.");
    if (a.status === "VOIDED") return err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_VOIDED", "Authorization has been voided.");
    if (a.status === "CAPTURED") return err(422, "UNPROCESSABLE_ENTITY", action === "capture" ? "AUTHORIZATION_ALREADY_CAPTURED" : "CANNOT_BE_VOIDED", "Authorization has already been captured.");
    if (action === "void") { a.status = "VOIDED"; event("PAYMENT.AUTHORIZATION.VOIDED", { ...a }, "Authorization voided (simulated)"); return reply(200, { ...a }); }
    if (action === "reauthorize") { a.reauthorized++; a.expiration_time = new Date(Date.now() + 29 * 86400_000).toISOString(); return reply(201, { ...a }); }
    const c = a.amount.currency_code;
    const gross = toMinor(a.amount.value, c);
    const fee = Math.round(gross * 0.0349) + 49; // sandbox-like fee, so payouts have to fit within net
    const cap: SimCapture = { id: id("SIMCAP"), status: "COMPLETED", amount: a.amount, custom_id: a.custom_id, fee };
    s.captures[cap.id] = cap;
    a.status = "CAPTURED";
    a.capture_id = cap.id;
    s.balanceMinor += gross - fee;
    event("PAYMENT.CAPTURE.COMPLETED", { id: cap.id, status: cap.status, amount: cap.amount, custom_id: cap.custom_id }, "Payment completed (simulated)");
    return reply(201, { id: cap.id, status: cap.status, amount: cap.amount, final_capture: true, seller_receivable_breakdown: { gross_amount: cap.amount, paypal_fee: { currency_code: c, value: toDecimalString(fee, c) }, net_amount: { currency_code: c, value: toDecimalString(gross - fee, c) } } });
  });
  if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)$/)) && method === "GET") {
    const c = s.captures[m[1]!];
    if (!c) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found.");
    const cur = c.amount.currency_code;
    return reply(200, { id: c.id, status: c.status, amount: c.amount, custom_id: c.custom_id, seller_receivable_breakdown: { paypal_fee: { currency_code: cur, value: toDecimalString(c.fee, cur) }, net_amount: { currency_code: cur, value: toDecimalString(toMinor(c.amount.value, cur) - c.fee, cur) } } });
  }
  if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/)) && method === "POST") return idem(() => {
    const c = s.captures[m![1]!];
    if (!c) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found.");
    if (c.status === "REFUNDED") return err(422, "UNPROCESSABLE_ENTITY", "CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.");
    c.status = "REFUNDED";
    c.refund_id = id("SIMREF");
    s.balanceMinor -= toMinor(c.amount.value, c.amount.currency_code) - c.fee;
    event("PAYMENT.CAPTURE.REFUNDED", { id: c.id, status: c.status, custom_id: c.custom_id }, "Payment refunded (simulated)");
    return reply(201, { id: c.refund_id, status: "COMPLETED" });
  });
  if (p === "/v1/payments/payouts" && method === "POST") return idem(() => {
    const sbid = body?.sender_batch_header?.sender_batch_id;
    const it = body?.items?.[0];
    if (!sbid || !it?.receiver || !it?.amount?.value) return err(400, "VALIDATION_ERROR", "VALIDATION_ERROR", "sender_batch_id, receiver and amount are required.");
    if (Object.values(s.payouts).some((x) => x.sender_batch_id === sbid)) return err(400, "USER_BUSINESS_ERROR", "DUPLICATE_REQUEST_ID", "Batch with given sender_batch_id already exists.");
    const amt = toMinor(it.amount.value, it.amount.currency);
    if (amt > s.balanceMinor) return err(422, "INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS", "Sender does not have sufficient funds.");
    s.balanceMinor -= amt;
    const po: SimPayout = { batch_id: id("SIMBATCH"), sender_batch_id: sbid, status: "SUCCESS", item_id: id("SIMITEM"), item_status: /unclaimed/i.test(it.receiver) ? "UNCLAIMED" : "SUCCESS", receiver: it.receiver, amount: it.amount };
    s.payouts[po.batch_id] = po;
    event(po.item_status === "SUCCESS" ? "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" : "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", { payout_item_id: po.item_id, payout_batch_id: po.batch_id, transaction_status: po.item_status, payout_item: { sender_item_id: it.sender_item_id, receiver: po.receiver } }, `Payout item ${po.item_status.toLowerCase()} (simulated)`);
    return reply(201, { batch_header: { payout_batch_id: po.batch_id, batch_status: "PENDING", sender_batch_header: body.sender_batch_header } });
  });
  if ((m = p.match(/^\/v1\/payments\/payouts\/([^/]+)$/)) && method === "GET") {
    const po = s.payouts[m[1]!];
    if (!po) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Payout batch not found.");
    return reply(200, { batch_header: { payout_batch_id: po.batch_id, batch_status: po.status }, items: [{ payout_item_id: po.item_id, transaction_status: po.item_status, payout_item: { receiver: po.receiver, amount: po.amount } }] });
  }
  return null;
}

/** Move queued payments events into the shared simulator outbox (delivered like invoice events). */
export function drainPaymentEvents(): Array<Record<string, unknown>> {
  return state().outbox.splice(0);
}
