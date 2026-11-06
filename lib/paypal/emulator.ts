/**
 * Simulated PayPal (PAYPAL_MODE=simulated): the Invoicing v2 routes MergePay calls, over one plain
 * JSON state object (lib/sim/store.ts). It is only reachable when no PayPal credentials are set,
 * every page shows a SIMULATED banner, and no money moves. Its "payer page" lives at /sim/pay/{id}.
 *
 * Paying an invoice here queues an INVOICING.INVOICE.PAID event in an outbox, which the app
 * delivers to its own webhook handler (unsigned, accepted only in simulated mode).
 */
import { randomUUID } from "node:crypto";
import { appBaseUrl } from "../base-url";
import { simState, withSimState } from "../sim/store";
import { toDecimalString, toMinor } from "../money";

type SimItem = { name: string; description?: string; quantity: string; unit_amount: { currency_code: string; value: string }; unit_of_measure?: string };
type SimInvoice = {
  id: string;
  status: string;
  detail: { invoice_number: string; reference?: string; currency_code: string; note?: string; memo?: string; terms_and_conditions?: string; invoice_date: string; metadata: { recipient_view_url: string; create_time: string } };
  invoicer?: { business_name?: string };
  primary_recipients: Array<{ billing_info: { email_address: string; name?: { given_name?: string; surname?: string } } }>;
  items: SimItem[];
  amount: { currency_code: string; value: string };
  due_amount: { currency_code: string; value: string };
  payments?: { paid_amount: { currency_code: string; value: string }; transactions: Array<{ payment_id: string; method: string; type: string; payment_date: string; amount: { currency_code: string; value: string } }> };
};
type PayPalSim = {
  invoices: Record<string, SimInvoice>;
  /** PayPal-Request-Id → invoice id (create is idempotent, like PayPal). */
  requestIds: Record<string, string>;
  nextNumber: number;
  outbox: Array<Record<string, unknown>>;
  webhooks: Array<{ id: string; url: string }>;
};

function state(): PayPalSim {
  return simState<PayPalSim>("paypal", () => ({ invoices: {}, requestIds: {}, nextNumber: 1, outbox: [], webhooks: [] }));
}

const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": "sim-" + randomUUID().slice(0, 8) } });
const err = (status: number, name: string, issue: string, description: string) => reply(status, { name, message: description, debug_id: "sim", details: [{ issue, description }] });

function itemsTotalMinor(items: SimItem[], currency: string): number {
  let total = 0;
  for (const i of items) {
    const qtyHundredths = toMinor(i.quantity, "USD"); // quantity as hundredths, exact
    const unit = toMinor(i.unit_amount.value, currency);
    total += Math.round((unit * qtyHundredths) / 100);
  }
  return total;
}

function queueEvent(eventType: string, inv: SimInvoice, summary: string) {
  state().outbox.push({
    id: `WH-SIM-${randomUUID()}`,
    event_version: "1.0",
    create_time: new Date().toISOString(),
    resource_type: "invoices",
    event_type: eventType,
    summary,
    resource: { invoice: structuredClone(inv) },
  });
}

// ---------------------------------------------------------------------------
// Simulated payer actions (called by the /sim/pay page and tests)
// ---------------------------------------------------------------------------

export async function simPayInvoice(id: string): Promise<{ ok: boolean; message: string }> {
  return withSimState(() => {
    const inv = state().invoices[id];
    if (!inv) return { ok: false, message: "No such invoice." };
    if (inv.status === "PAID") return { ok: false, message: "This invoice is already paid." };
    if (inv.status !== "SENT" && inv.status !== "UNPAID") return { ok: false, message: `This invoice can't be paid (status ${inv.status}).` };
    const c = inv.detail.currency_code;
    inv.status = "PAID";
    inv.payments = { paid_amount: { ...inv.amount }, transactions: [{ payment_id: `SIMPAY-${randomUUID().slice(0, 12).toUpperCase()}`, method: "PAYPAL", type: "PAYPAL", payment_date: new Date().toISOString().slice(0, 10), amount: { ...inv.amount } }] };
    inv.due_amount = { currency_code: c, value: toDecimalString(0, c) };
    queueEvent("INVOICING.INVOICE.PAID", inv, `An invoice was paid (simulated). Invoice ${inv.detail.invoice_number}`);
    return { ok: true, message: "Paid (simulated — no money moved)." };
  });
}

export async function simInvoiceSnapshot(id: string): Promise<SimInvoice | null> {
  return withSimState(() => structuredClone(state().invoices[id] ?? null));
}

/** Take queued webhook events (the caller delivers them to the app's own handler). */
export async function takeSimOutbox(): Promise<Array<Record<string, unknown>>> {
  return withSimState(() => state().outbox.splice(0));
}

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------

export function emulatorFetch(input: string, init: RequestInit): Promise<Response> {
  return withSimState(() => route(input, init));
}

function route(input: string, init: RequestInit): Response {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof init.body === "string" && init.body && (headers.get("content-type") ?? "").includes("json")) {
    try { body = JSON.parse(init.body); } catch { return err(400, "MALFORMED_REQUEST_JSON", "MALFORMED_REQUEST_JSON", "The request JSON is not well formed."); }
  }
  const p = url.pathname;
  const s = state();

  if (p === "/v1/oauth2/token" && method === "POST") return reply(200, { access_token: "SIMULATED-TOKEN", token_type: "Bearer", expires_in: 32400 });

  if (p === "/v2/invoicing/generate-next-invoice-number" && method === "POST") {
    return reply(200, { invoice_number: `MP-${String(s.nextNumber).padStart(4, "0")}` });
  }

  if (p === "/v2/invoicing/invoices" && method === "POST") {
    const rid = headers.get("PayPal-Request-Id");
    if (rid && s.requestIds[rid]) return reply(200, s.invoices[s.requestIds[rid]!]);
    const c = body?.detail?.currency_code;
    const items: SimItem[] = Array.isArray(body?.items) ? body.items : [];
    const email = body?.primary_recipients?.[0]?.billing_info?.email_address;
    if (!c) return err(422, "UNPROCESSABLE_ENTITY", "MISSING_CURRENCY_CODE", "detail.currency_code is required.");
    if (items.length === 0) return err(422, "UNPROCESSABLE_ENTITY", "ITEMS_REQUIRED", "At least one item is required.");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(422, "UNPROCESSABLE_ENTITY", "INVALID_EMAIL", "Recipient email is invalid.");
    for (const i of items) {
      if (!i.name || !i.quantity || i.unit_amount?.currency_code !== c) return err(422, "UNPROCESSABLE_ENTITY", "INVALID_ITEM", "Every item needs a name, a quantity and a unit amount in the invoice currency.");
    }
    const number = body.detail.invoice_number ?? `MP-${String(s.nextNumber).padStart(4, "0")}`;
    if (Object.values(s.invoices).some((x) => x.detail.invoice_number === number)) return err(422, "UNPROCESSABLE_ENTITY", "DUPLICATE_INVOICE_NUMBER", "Invoice number already exists.");
    s.nextNumber++;
    const id = `INV2-SIM-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const total = toDecimalString(itemsTotalMinor(items, c), c);
    const inv: SimInvoice = {
      id,
      status: "DRAFT",
      detail: { ...body.detail, invoice_number: number, invoice_date: new Date().toISOString().slice(0, 10), metadata: { recipient_view_url: `${appBaseUrl()}/sim/pay/${id}`, create_time: new Date().toISOString() } },
      invoicer: body.invoicer,
      primary_recipients: body.primary_recipients,
      items,
      amount: { currency_code: c, value: total },
      due_amount: { currency_code: c, value: total },
    };
    s.invoices[id] = inv;
    if (rid) s.requestIds[rid] = id;
    return reply(201, inv);
  }

  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/v2\/invoicing\/invoices\/([^/]+)$/)) && method === "GET") {
    const inv = s.invoices[decodeURIComponent(m[1]!)];
    return inv ? reply(200, inv) : err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Invoice not found.");
  }
  if ((m = p.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/(send|remind|cancel)$/)) && method === "POST") {
    const inv = s.invoices[decodeURIComponent(m[1]!)];
    if (!inv) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID", "Invoice not found.");
    const action = m[2]!;
    if (action === "send") {
      if (inv.status === "SENT") return reply(200, { rel: "payer-view", href: inv.detail.metadata.recipient_view_url, method: "GET" }); // idempotent resend
      if (inv.status !== "DRAFT") return err(422, "UNPROCESSABLE_ENTITY", "CANT_SEND_INVOICE", `Invoice in status ${inv.status} can't be sent.`);
      inv.status = "SENT";
      return reply(200, { rel: "payer-view", href: inv.detail.metadata.recipient_view_url, method: "GET" });
    }
    if (action === "remind") {
      if (inv.status !== "SENT" && inv.status !== "UNPAID") return err(422, "UNPROCESSABLE_ENTITY", "CANT_REMIND", "Only unpaid sent invoices can be reminded.");
      return reply(204, null);
    }
    if (inv.status === "PAID" || inv.status === "CANCELLED") return err(422, "UNPROCESSABLE_ENTITY", "CANT_CANCEL", `Invoice in status ${inv.status} can't be cancelled.`);
    inv.status = "CANCELLED";
    queueEvent("INVOICING.INVOICE.CANCELLED", inv, `An invoice was cancelled (simulated). Invoice ${inv.detail.invoice_number}`);
    return reply(204, null);
  }

  if (p === "/v1/notifications/webhooks" && method === "POST") {
    const w = { id: `WH-SIM-${s.webhooks.length + 1}`, url: String(body.url) };
    s.webhooks.push(w);
    return reply(201, w);
  }
  if (p === "/v1/notifications/webhooks" && method === "GET") return reply(200, { webhooks: s.webhooks });

  return err(404, "NOT_FOUND", "UNSUPPORTED_ROUTE", `The simulator does not implement ${method} ${p}.`);
}
