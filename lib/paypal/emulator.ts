/**
 * Simulated PayPal (PAYPAL_MODE=simulated), used by the automated tests and when no PayPal
 * credentials are configured. It implements only the routes lib/paypal/payments.ts calls, with the
 * behaviours we observed in the real sandbox: partial captures leave the hold open
 * (PARTIALLY_CAPTURED), captures beyond the hold are refused, void releases the remainder, repeated
 * PayPal-Request-Ids return the first answer, and a reused sender_batch_id is rejected.
 * Every page shows a SIMULATED banner in this mode; no money moves.
 */
import { simState, withSimState } from "../sim/store";
import { toDecimalString, toMinor } from "../money";

type Money = { currency_code: string; value: string };
type SimAuth = { id: string; order_id: string; status: "CREATED" | "PARTIALLY_CAPTURED" | "CAPTURED" | "VOIDED"; amount: Money; custom_id: string; expiration_time: string; create_time: string; captured: number };
type SimCapture = { id: string; authorization_id: string; status: "COMPLETED" | "PENDING" | "DECLINED" | "REFUNDED"; amount: Money; invoice_id?: string; custom_id: string };
type SimPayout = { batch_id: string; sender_batch_id: string; item_id: string; transaction_id: string; item_status: "SUCCESS" | "UNCLAIMED"; receiver: string; amount: { currency: string; value: string } };
type Sim = { auths: Record<string, SimAuth>; captures: Record<string, SimCapture>; payouts: Record<string, SimPayout>; idem: Record<string, { status: number; body: unknown }>; calls: string[]; failNext: string | null; failLeft?: number; nextCapture?: "PENDING" | null; refuseRefunds?: boolean };

function state(): Sim {
  return simState<Sim>("paypal", () => ({ auths: {}, captures: {}, payouts: {}, idem: {}, calls: [], failNext: null }));
}

const id = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
let last: { status: number; body: unknown } | null = null;
const reply = (status: number, body: unknown) => { last = { status, body }; return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); };
const err = (status: number, name: string, issue: string, description: string) => reply(status, { name, message: description, debug_id: "sim", details: [{ issue, description }] });

/** Tests: make the next call whose path contains `fragment` fail with a 500. */
export async function simFailNext(fragment: string | null, times = 1) { await withSimState(() => { state().failNext = fragment; state().failLeft = times; }); }
/** Tests: the next capture comes back PENDING (PayPal is still reviewing it) and stays so until simSetCapture. */
export async function simNextCapturePending() { await withSimState(() => { state().nextCapture = "PENDING"; }); }
export async function simSetCapture(id: string, status: "COMPLETED" | "DECLINED") { await withSimState(() => { const c = state().captures[id]; if (c) c.status = status; }); }
/** Tests: PayPal refuses every refund until switched off. */
export async function simRefuseRefunds(on: boolean) { await withSimState(() => { state().refuseRefunds = on; }); }
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
    if (m![2] === "void") { a.status = "VOIDED"; return reply(204, null); }
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
    return reply(201, { id: id("SIMREF"), status: "COMPLETED" });
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
    return reply(201, { batch_header: { payout_batch_id: po.batch_id, batch_status: "PENDING", sender_batch_header: body.sender_batch_header } });
  });
  if ((m = p.match(/^\/v1\/payments\/payouts\/([^/]+)$/)) && method === "GET") {
    const po = s.payouts[m[1]!];
    if (!po) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Payout batch not found.");
    return reply(200, { batch_header: { payout_batch_id: po.batch_id, batch_status: "SUCCESS" }, items: [{ payout_item_id: po.item_id, transaction_id: po.transaction_id, transaction_status: po.item_status, payout_item: { receiver: po.receiver, amount: po.amount, sender_item_id: po.sender_batch_id }, ...(po.item_status === "UNCLAIMED" ? { errors: { name: "RECEIVER_UNREGISTERED" } } : {}) }] });
  }
  return err(404, "NOT_FOUND", "UNSUPPORTED_ROUTE", `The simulator does not implement ${method} ${p}.`);
}

function pub(a: SimAuth) {
  return { id: a.id, status: a.status, amount: a.amount, custom_id: a.custom_id, expiration_time: a.expiration_time, create_time: a.create_time };
}
