/**
 * Simulated PayPal (PAYPAL_MODE=simulated), used by the automated tests and when no PayPal
 * credentials are configured. It implements only the routes lib/paypal/payments.ts calls, with the
 * behaviours we observed in the real sandbox: partial captures leave the hold open
 * (PARTIALLY_CAPTURED), captures beyond the hold are refused, void releases the remainder, repeated
 * PayPal-Request-Ids return the first answer, and a reused sender_batch_id is rejected. It also keeps
 * an event feed shaped like PayPal's (one event per capture, payout, refund, void and cancellation),
 * cancels unclaimed payout items, and "verifies" an event only when it is one it issued, unchanged.
 * Every page shows a SIMULATED banner in this mode; no money moves.
 */
import { simState, withSimState } from "../sim/store";
import { toDecimalString, toMinor } from "../money";

type Money = { currency_code: string; value: string };
type SimAuth = { id: string; order_id: string; status: "CREATED" | "PARTIALLY_CAPTURED" | "CAPTURED" | "VOIDED"; amount: Money; custom_id: string; expiration_time: string; create_time: string; captured: number };
type SimCapture = { id: string; authorization_id: string; status: "COMPLETED" | "PENDING" | "DECLINED" | "REFUNDED"; amount: Money; invoice_id?: string; custom_id: string; refund_id?: string };
type SimPayout = { batch_id: string; sender_batch_id: string; item_id: string; transaction_id: string; item_status: "SUCCESS" | "UNCLAIMED" | "RETURNED" | "FAILED"; receiver: string; amount: { currency: string; value: string } };
export type SimEvent = { id: string; event_type: string; create_time: string; resource_type: string; resource: Record<string, unknown> };
type SimDispute = { dispute_id: string; status: string; reason: string; dispute_life_cycle_stage: string; create_time: string; dispute_amount: Money; capture_id: string; evidence?: string };
type Sim = { disputes?: Record<string, SimDispute>; events?: SimEvent[]; auths: Record<string, SimAuth>; captures: Record<string, SimCapture>; payouts: Record<string, SimPayout>; idem: Record<string, { status: number; body: unknown }>; calls: string[]; failNext: string | null; failLeft?: number; nextCapture?: "PENDING" | null; refuseRefunds?: boolean; fees?: boolean };

function state(): Sim {
  return simState<Sim>("paypal", () => ({ auths: {}, captures: {}, payouts: {}, idem: {}, calls: [], failNext: null }));
}

const id = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
let last: { status: number; body: unknown } | null = null;
const reply = (status: number, body: unknown) => { last = { status, body }; return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); };
const err = (status: number, name: string, issue: string, description: string) => reply(status, { name, message: description, debug_id: "sim", details: [{ issue, description }] });

/** What a webhook from the simulator must carry to verify. Real PayPal signs with a certificate; this stands in for it. */
export const SIM_WEBHOOK_ID = "SIM-WEBHOOK";
export const SIM_SIGNATURE = "SIM-VALID";
function emit(s: Sim, event_type: string, resource_type: string, resource: Record<string, unknown>) {
  (s.events ??= []).push({ id: id("WH-SIM"), event_type, create_time: new Date().toISOString(), resource_type, resource: structuredClone(resource) });
  if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
}
const captureResource = (c: SimCapture) => ({ id: c.id, status: c.status, amount: c.amount, invoice_id: c.invoice_id, custom_id: c.custom_id, supplementary_data: { related_ids: { authorization_id: c.authorization_id } } });
const itemResource = (po: SimPayout) => ({ payout_item_id: po.item_id, transaction_id: po.transaction_id, transaction_status: po.item_status, payout_batch_id: po.batch_id, sender_batch_id: po.sender_batch_id, payout_item: { receiver: po.receiver, amount: po.amount, sender_item_id: po.sender_batch_id } });
const ITEM_EVENT: Record<SimPayout["item_status"], string> = { SUCCESS: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", UNCLAIMED: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", RETURNED: "PAYMENT.PAYOUTS-ITEM.RETURNED", FAILED: "PAYMENT.PAYOUTS-ITEM.FAILED" };
/** Tests: the events the simulator has reported, oldest first. */
export async function simEvents(): Promise<SimEvent[]> { return withSimState(() => structuredClone(state().events ?? [])); }
/** Tests: PayPal changes its mind about a payout later (claimed, returned after 30 days, failed) and reports it. */
export async function simSetPayout(batchId: string, status: SimPayout["item_status"]) { await withSimState(() => { const s = state(); const po = s.payouts[batchId]; if (po) { po.item_status = status; emit(s, ITEM_EVENT[status], "payouts_item", itemResource(po)); } }); }

/** Tests: the payer opens a dispute against a capture, as they could in PayPal's Resolution Center. */
export async function simOpenDispute(captureId: string, reason = "UNAUTHORISED"): Promise<string | null> {
  return withSimState(() => {
    const s = state(); const c = s.captures[captureId];
    if (!c) return null;
    const d: SimDispute = { dispute_id: id("PP-D-"), status: "WAITING_FOR_SELLER_RESPONSE", reason, dispute_life_cycle_stage: "INQUIRY", create_time: new Date().toISOString(), dispute_amount: c.amount, capture_id: captureId };
    (s.disputes ??= {})[d.dispute_id] = d;
    emit(s, "CUSTOMER.DISPUTE.CREATED", "dispute", { dispute_id: d.dispute_id, status: d.status, reason, disputed_transactions: [{ seller_transaction_id: captureId }] });
    return d.dispute_id;
  });
}
export async function simDispute(disputeId: string) { return withSimState(() => structuredClone(state().disputes?.[disputeId] ?? null)); }
const pubDispute = (d: SimDispute) => ({ dispute_id: d.dispute_id, status: d.status, reason: d.reason, dispute_life_cycle_stage: d.dispute_life_cycle_stage, create_time: d.create_time, dispute_amount: d.dispute_amount, disputed_transactions: [{ seller_transaction_id: d.capture_id }] });
/**
 * Fees, when switched on (simChargeFees). The figures copy what the sandbox charged this account on
 * 11 November 2026: 2.59% + $0.49 on a card capture; 2% on a payout that was delivered; a flat $0.25
 * on one held unclaimed. They are not PayPal's price list. Off by default: the simulator then charges
 * nothing, and the Accounts page says so.
 */
const captureFee = (s: Sim, minor: number) => (s.fees ? Math.round(minor * 0.0259 + 49) : 0);
const payoutFee = (s: Sim, po: SimPayout) => (!s.fees ? 0 : po.item_status === "SUCCESS" ? Math.round(toMinor(po.amount.value, po.amount.currency) * 0.02) : 25);
/** The simulated account: every completed capture came in, every refund and every payout not returned went out, less any fees. A refund does not return the capture's fee. */
function simBalance(s: Sim, currency: string): number {
  let n = 0;
  for (const c of Object.values(s.captures)) if (c.amount.currency_code === currency && (c.status === "COMPLETED" || c.status === "REFUNDED")) n += (c.status === "COMPLETED" ? toMinor(c.amount.value, currency) : 0) - captureFee(s, toMinor(c.amount.value, currency));
  for (const po of Object.values(s.payouts)) if (po.amount.currency === currency && po.item_status !== "RETURNED" && po.item_status !== "FAILED") n -= toMinor(po.amount.value, currency) + payoutFee(s, po);
  return n;
}

/** Tests: make the next call whose path contains `fragment` fail with a 500. */
export async function simFailNext(fragment: string | null, times = 1) { await withSimState(() => { state().failNext = fragment; state().failLeft = times; }); }
/** Tests: the next capture comes back PENDING (PayPal is still reviewing it) and stays so until simSetCapture. */
export async function simNextCapturePending() { await withSimState(() => { state().nextCapture = "PENDING"; }); }
export async function simSetCapture(id: string, status: "COMPLETED" | "DECLINED") { await withSimState(() => { const c = state().captures[id]; if (c) c.status = status; }); }
/** Tests: PayPal refuses every refund until switched off. */
export async function simRefuseRefunds(on: boolean) { await withSimState(() => { state().refuseRefunds = on; }); }
/** Tests: charge fees on captures and payouts from now on, as PayPal does (see captureFee above). */
export async function simChargeFees(on: boolean) { await withSimState(() => { state().fees = on; }); }
/** Tests: mutating calls the simulator executed (not idempotent replays), e.g. to prove nothing was captured twice. */
export async function simCalls(): Promise<string[]> { return withSimState(() => [...state().calls]); }
export async function simAuthorization(authId: string) { return withSimState(() => structuredClone(state().auths[authId] ?? null)); }

export function emulatorFetch(input: string, init: RequestInit): Promise<Response> {
  return withSimState(() => route(input, init));
}

function route(input: string, init: RequestInit): Response {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const p = url.pathname;
  const s = state();
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof init.body === "string" && init.body && (headers.get("content-type") ?? "").includes("json")) {
    try { body = JSON.parse(init.body); } catch { return err(400, "MALFORMED_REQUEST_JSON", "MALFORMED_REQUEST_JSON", "The request JSON is not well formed."); }
  }
  if (p === "/v1/oauth2/token" && method === "POST") return reply(200, { access_token: "SIMULATED-TOKEN", token_type: "Bearer", expires_in: 32400 });
  if (s.failNext && p.includes(s.failNext) && method !== "GET") { s.failLeft = (s.failLeft ?? 1) - 1; if (s.failLeft <= 0) s.failNext = null; return err(500, "INTERNAL_SERVER_ERROR", "INTERNAL_SERVICE_ERROR", "Simulated PayPal outage."); }

  const rid = headers.get("PayPal-Request-Id");
  const key = `${method} ${p} ${rid}`;
  const mutate = (fn: () => Response): Response => {
    if (rid && s.idem[key]) return reply(s.idem[key]!.status, s.idem[key]!.body);
    last = null;
    const res = fn();
    if (res.status < 300) { s.calls.push(`${method} ${p}`); if (rid && last) s.idem[key] = structuredClone(last); }
    return res;
  };
  let m: RegExpMatchArray | null;

  if (p === "/v2/checkout/orders" && method === "POST") return mutate(() => {
    const pu = body?.purchase_units?.[0];
    if (body?.intent !== "AUTHORIZE") return err(422, "UNPROCESSABLE_ENTITY", "UNSUPPORTED_INTENT", "The simulator supports intent=AUTHORIZE.");
    if (!pu?.amount?.value || !pu?.amount?.currency_code) return err(422, "UNPROCESSABLE_ENTITY", "MISSING_REQUIRED_PARAMETER", "amount is required.");
    if (!body?.payment_source?.card?.number) return err(422, "UNPROCESSABLE_ENTITY", "PAYER_ACTION_REQUIRED", "The simulator only authorizes orders with a card payment source.");
    const now = new Date();
    const orderId = id("SIMORD");
    const a: SimAuth = { id: id("SIMAUTH"), order_id: orderId, status: "CREATED", amount: pu.amount, custom_id: pu.custom_id ?? "", create_time: now.toISOString(), expiration_time: new Date(now.getTime() + 29 * 86400_000).toISOString(), captured: 0 };
    s.auths[a.id] = a;
    emit(s, "PAYMENT.AUTHORIZATION.CREATED", "authorization", pub(a));
    return reply(201, { id: orderId, status: "COMPLETED", purchase_units: [{ reference_id: pu.reference_id, payments: { authorizations: [pub(a)] } }] });
  });
  if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)$/)) && method === "GET") {
    const a = s.auths[m[1]!];
    return a ? reply(200, pub(a)) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Authorization not found.");
  }
  if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/(capture|void)$/)) && method === "POST") return mutate(() => {
    const a = s.auths[m![1]!];
    if (!a) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Authorization not found.");
    if (a.status === "VOIDED") return err(422, "UNPROCESSABLE_ENTITY", m![2] === "void" ? "PREVIOUSLY_VOIDED" : "AUTHORIZATION_VOIDED", "A voided authorization cannot be captured or voided again.");
    if (a.status === "CAPTURED") return err(422, "UNPROCESSABLE_ENTITY", m![2] === "void" ? "PREVIOUSLY_CAPTURED" : "AUTHORIZATION_ALREADY_CAPTURED", "Authorization has been fully captured.");
    if (m![2] === "void") { a.status = "VOIDED"; emit(s, "PAYMENT.AUTHORIZATION.VOIDED", "authorization", pub(a)); return reply(204, null); }
    const cur = a.amount.currency_code;
    const total = toMinor(a.amount.value, cur);
    const want = body?.amount?.value ? toMinor(body.amount.value, cur) : total - a.captured;
    if (want <= 0) return err(422, "UNPROCESSABLE_ENTITY", "INVALID_PARAMETER_VALUE", "Capture amount must be positive.");
    if (a.captured + want > total) return err(422, "UNPROCESSABLE_ENTITY", "MAX_CAPTURE_AMOUNT_EXCEEDED", "Capture amount exceeds allowable limit."); // stricter than PayPal's 115% tolerance
    if (body.invoice_id && Object.values(s.captures).some((c) => c.invoice_id === body.invoice_id)) return err(422, "UNPROCESSABLE_ENTITY", "DUPLICATE_INVOICE_ID", "Duplicate invoice id.");
    a.captured += want;
    a.status = body.final_capture || a.captured === total ? "CAPTURED" : "PARTIALLY_CAPTURED";
    const pending = s.nextCapture === "PENDING"; s.nextCapture = null;
    const c: SimCapture = { id: id("SIMCAP"), authorization_id: a.id, status: pending ? "PENDING" : "COMPLETED", amount: { currency_code: cur, value: toDecimalString(want, cur) }, invoice_id: body.invoice_id, custom_id: a.custom_id };
    s.captures[c.id] = c;
    emit(s, pending ? "PAYMENT.CAPTURE.PENDING" : "PAYMENT.CAPTURE.COMPLETED", "capture", captureResource(c));
    return reply(201, { id: c.id, status: c.status, amount: c.amount, invoice_id: c.invoice_id, custom_id: c.custom_id, final_capture: Boolean(body.final_capture) });
  });
  if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)$/)) && method === "GET") {
    const c = s.captures[m[1]!];
    return c ? reply(200, { id: c.id, status: c.status, amount: c.amount, invoice_id: c.invoice_id, custom_id: c.custom_id }) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found.");
  }
  if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/)) && method === "POST") return mutate(() => {
    const c = s.captures[m![1]!];
    if (!c) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Capture not found.");
    if (s.refuseRefunds) return err(422, "UNPROCESSABLE_ENTITY", "REFUND_FAILED_INSUFFICIENT_FUNDS", "The refund could not be made.");
    if (c.status === "REFUNDED") return err(422, "UNPROCESSABLE_ENTITY", "CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.");
    c.status = "REFUNDED";
    const refund = { id: id("SIMREF"), status: "COMPLETED" };
    c.refund_id = refund.id;
    emit(s, "PAYMENT.CAPTURE.REFUNDED", "refund", { ...refund, amount: c.amount, invoice_id: c.invoice_id, custom_id: c.custom_id });
    return reply(201, refund);
  });
  if (p === "/v1/payments/payouts" && method === "POST") return mutate(() => {
    const sbid = body?.sender_batch_header?.sender_batch_id;
    const it = body?.items?.[0];
    if (!sbid || !it?.receiver || !it?.amount?.value) return err(400, "VALIDATION_ERROR", "VALIDATION_ERROR", "sender_batch_id, receiver and amount are required.");
    // Tests: an address containing "refused" makes PayPal reject the payout outright.
    if (/refused/i.test(it.receiver)) return err(422, "UNPROCESSABLE_ENTITY", "RECEIVER_ACCOUNT_LOCKED", "The receiver cannot be paid.");
    if (Object.values(s.payouts).some((x) => x.sender_batch_id === sbid)) return err(400, "USER_BUSINESS_ERROR", "DUPLICATE_REQUEST_ID", "Batch with given sender_batch_id already exists.");
    const po: SimPayout = { batch_id: id("SIMBATCH"), sender_batch_id: sbid, item_id: id("SIMITEM"), transaction_id: id("SIMTXN"), item_status: /unclaimed/i.test(it.receiver) ? "UNCLAIMED" : "SUCCESS", receiver: it.receiver, amount: it.amount };
    s.payouts[po.batch_id] = po;
    emit(s, ITEM_EVENT[po.item_status], "payouts_item", itemResource(po));
    return reply(201, { batch_header: { payout_batch_id: po.batch_id, batch_status: "PENDING", sender_batch_header: body.sender_batch_header } });
  });
  if ((m = p.match(/^\/v1\/payments\/payouts\/([^/]+)$/)) && method === "GET") {
    const po = s.payouts[m[1]!];
    if (!po) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Payout batch not found.");
    return reply(200, { batch_header: { payout_batch_id: po.batch_id, batch_status: "SUCCESS" }, items: [{ payout_item_id: po.item_id, transaction_id: po.transaction_id, transaction_status: po.item_status, payout_item: { receiver: po.receiver, amount: po.amount, sender_item_id: po.sender_batch_id }, ...(po.item_status === "UNCLAIMED" ? { errors: { name: "RECEIVER_UNREGISTERED" } } : {}) }] });
  }
  if ((m = p.match(/^\/v1\/payments\/payouts-item\/([^/]+)\/cancel$/)) && method === "POST") return mutate(() => {
    const po = Object.values(s.payouts).find((x) => x.item_id === m![1]);
    if (!po) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Payout item not found.");
    if (po.item_status !== "UNCLAIMED") return err(400, "ITEM_INCORRECT_STATUS", "ITEM_INCORRECT_STATUS", "Only an unclaimed payout item can be cancelled.");
    po.item_status = "RETURNED";
    emit(s, "PAYMENT.PAYOUTS-ITEM.CANCELED", "payouts_item", itemResource(po));
    return reply(200, itemResource(po));
  });
  if (p === "/v1/reporting/balances" && method === "GET") {
    const cur = url.searchParams.get("currency_code") ?? "USD";
    const v = toDecimalString(Math.max(0, simBalance(s, cur)), cur);
    return reply(200, { balances: [{ currency: cur, total_balance: { currency_code: cur, value: v }, available_balance: { currency_code: cur, value: v }, withheld_balance: { currency_code: cur, value: toDecimalString(0, cur) } }], account_id: "SIMULATED", as_of_time: new Date().toISOString() });
  }
  if (p === "/v1/reporting/transactions" && method === "GET") {
    // Unlike PayPal's, this statement does not lag. A refunded capture stays listed, followed by its refund.
    const now = new Date().toISOString();
    const fee = (minor: number, currency: string) => (minor ? { fee_amount: { currency_code: currency, value: `-${toDecimalString(minor, currency)}` } } : {});
    const lines = [
      ...Object.values(s.captures).filter((c) => c.status === "COMPLETED" || c.status === "REFUNDED").flatMap((c) => [
        { transaction_info: { transaction_id: c.id, transaction_event_code: "T0006", transaction_initiation_date: now, transaction_amount: c.amount, ...fee(captureFee(s, toMinor(c.amount.value, c.amount.currency_code)), c.amount.currency_code), transaction_status: "S", invoice_id: c.invoice_id } },
        ...(c.status === "REFUNDED" ? [{ transaction_info: { transaction_id: c.refund_id ?? `R${c.id}`, paypal_reference_id: c.id, transaction_event_code: "T1107", transaction_initiation_date: now, transaction_amount: { ...c.amount, value: `-${c.amount.value}` }, transaction_status: "S", invoice_id: c.invoice_id } }] : []),
      ]),
      // PayPal puts the sender's own item id on a payout's line; here that is the payment's or the transfer's id
      ...Object.values(s.payouts).map((po) => ({ transaction_info: { transaction_id: po.transaction_id, transaction_event_code: "T0001", transaction_initiation_date: now, transaction_amount: { currency_code: po.amount.currency, value: `-${po.amount.value}` }, ...fee(payoutFee(s, po), po.amount.currency), transaction_status: po.item_status === "SUCCESS" ? "S" : "P", custom_field: po.sender_batch_id } })),
    ];
    return reply(200, { transaction_details: lines, total_pages: 1, page: 1 });
  }
  if (p === "/v1/customer/disputes" && method === "GET") {
    const about = url.searchParams.get("disputed_transaction_id");
    return reply(200, { items: Object.values(s.disputes ?? {}).filter((d) => !about || d.capture_id === about).map(pubDispute) });
  }
  if ((m = p.match(/^\/v1\/customer\/disputes\/([^/]+)$/)) && method === "GET") {
    const d = s.disputes?.[m[1]!];
    return d ? reply(200, pubDispute(d)) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Dispute not found.");
  }
  if ((m = p.match(/^\/v1\/customer\/disputes\/([^/]+)\/provide-evidence$/)) && method === "POST") {
    const d = s.disputes?.[m[1]!];
    if (!d) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Dispute not found.");
    if (d.status !== "WAITING_FOR_SELLER_RESPONSE") return err(422, "UNPROCESSABLE_ENTITY", "ACTION_NOT_ALLOWED", "The dispute is not waiting for the seller.");
    d.status = "UNDER_REVIEW"; d.evidence = "received"; s.calls.push(`${method} ${p}`);
    return reply(200, { links: [] });
  }
  if (p === "/v1/notifications/verify-webhook-signature" && method === "POST") {
    // Genuine = the stand-in signature, this simulator's webhook id, and an event it issued with its type and resource id untouched.
    const ev = body?.webhook_event;
    const mine = (s.events ?? []).find((e) => e.id === ev?.id);
    const same = Boolean(mine && mine.event_type === ev?.event_type && JSON.stringify(mine.resource) === JSON.stringify(ev?.resource));
    return reply(200, { verification_status: body?.transmission_sig === SIM_SIGNATURE && body?.webhook_id === SIM_WEBHOOK_ID && same ? "SUCCESS" : "FAILURE" });
  }
  if (p === "/v1/notifications/webhooks-events" && method === "GET") {
    const evs = [...(s.events ?? [])].reverse().slice(0, Number(url.searchParams.get("page_size") ?? 10));
    return reply(200, { events: evs, count: evs.length });
  }
  return err(404, "NOT_FOUND", "UNSUPPORTED_ROUTE", `The simulator does not implement ${method} ${p}.`);
}

function pub(a: SimAuth) {
  return { id: a.id, status: a.status, amount: a.amount, custom_id: a.custom_id, expiration_time: a.expiration_time, create_time: a.create_time };
}
