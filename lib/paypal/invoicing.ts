/**
 * PayPal Invoicing API v2 (and webhook management) — the only PayPal surface MergePay needs.
 *
 *   POST /v2/invoicing/generate-next-invoice-number
 *   POST /v2/invoicing/invoices                    create a DRAFT (Prefer: return=representation)
 *   POST /v2/invoicing/invoices/{id}/send          email it to the client; PayPal hosts the payer page
 *   GET  /v2/invoicing/invoices/{id}               authoritative status + paid amount (never trust a webhook body)
 *   POST /v2/invoicing/invoices/{id}/remind
 *   POST /v2/invoicing/invoices/{id}/cancel
 *   POST /v1/notifications/webhooks · GET list     register INVOICING.INVOICE.* events
 */
import type { PayPalClient } from "./client";
import { toDecimalString, toMinor } from "../money";
import type { LineItem } from "../db/schema";

export const INVOICE_EVENTS = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
  "INVOICING.INVOICE.UPDATED",
  // bounties: reservation lapsed or voided, capture outcome, payout outcome
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
] as const;

export type PayPalInvoiceStatus =
  | "DRAFT" | "SENT" | "SCHEDULED" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED" | "MARKED_AS_REFUNDED" | "UNPAID" | "PAYMENT_PENDING" | "AUTO_CANCELLED" | "PAID_EXTERNAL"
  | "REFUNDED_EXTERNAL" | "SHARED";

export type InvoiceFacts = {
  id: string;
  status: PayPalInvoiceStatus;
  number: string | null;
  reference: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  recipientViewUrl: string | null;
  /** True only when PayPal itself took the payment (not "marked as paid" by the invoicer). */
  paidThroughPayPal: boolean;
  lastPaymentId: string | null;
};

export type DraftInput = {
  invoiceNumber: string;
  /** MergePay's invoice id; PayPal echoes it back as detail.reference. */
  reference: string;
  currency: string;
  businessName: string | null;
  recipient: { name: string; email: string };
  note: string;
  terms: string;
  memo: string;
  items: LineItem[];
};

type RawInvoice = {
  id: string;
  status: PayPalInvoiceStatus;
  detail?: { invoice_number?: string; reference?: string; currency_code?: string; metadata?: { recipient_view_url?: string } };
  amount?: { currency_code?: string; value?: string };
  due_amount?: { currency_code?: string; value?: string };
  payments?: { paid_amount?: { currency_code?: string; value?: string }; transactions?: Array<{ payment_id?: string; method?: string; type?: string }> };
};

export async function nextInvoiceNumber(pp: PayPalClient): Promise<string> {
  const r = await pp.request<{ invoice_number: string }>("POST", "/v2/invoicing/generate-next-invoice-number", { body: {} });
  return r.invoice_number;
}

export function draftBody(d: DraftInput) {
  const c = d.currency;
  return {
    detail: {
      invoice_number: d.invoiceNumber,
      reference: d.reference,
      currency_code: c,
      note: d.note.slice(0, 4000),
      terms_and_conditions: d.terms.slice(0, 4000),
      memo: d.memo.slice(0, 500),
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    ...(d.businessName ? { invoicer: { business_name: d.businessName.slice(0, 300) } } : {}),
    primary_recipients: [{ billing_info: { name: splitName(d.recipient.name), email_address: d.recipient.email } }],
    items: d.items.map((i) => ({
      name: i.name.slice(0, 200),
      description: i.description.slice(0, 1000),
      quantity: i.quantity,
      unit_amount: { currency_code: c, value: toDecimalString(i.unitAmountMinor, c) },
      unit_of_measure: i.kind === "HOURS" ? "HOURS" : "QUANTITY",
    })),
    configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false, partial_payment: { allow_partial_payment: false } },
  };
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? { given_name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] } : { given_name: parts[0] ?? full };
}

export async function createDraftInvoice(pp: PayPalClient, d: DraftInput, requestId: string): Promise<InvoiceFacts> {
  const raw = await pp.request<RawInvoice>("POST", "/v2/invoicing/invoices", { body: draftBody(d), requestId, prefer: "return=representation" });
  if (!raw.id) throw new Error("PayPal created the invoice but returned no id (expected a representation).");
  return facts(raw);
}

/** Email the invoice. 200 = sent now, 202 = accepted for later; either way re-read the invoice for its payer link. */
export async function sendInvoice(pp: PayPalClient, id: string, opts: { subject: string; note: string }, requestId: string): Promise<void> {
  await pp.request<{ href?: string }>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    body: { subject: opts.subject.slice(0, 4000), note: opts.note.slice(0, 4000), send_to_invoicer: true, send_to_recipient: true },
    requestId,
  });
}

export async function getInvoice(pp: PayPalClient, id: string): Promise<InvoiceFacts> {
  return facts(await pp.request<RawInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`));
}

export async function remindInvoice(pp: PayPalClient, id: string, note: string, requestId: string): Promise<void> {
  await pp.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    body: { subject: "Reminder: invoice awaiting payment", note: note.slice(0, 4000), send_to_invoicer: false, send_to_recipient: true }, requestId,
  });
}

export async function cancelInvoice(pp: PayPalClient, id: string, note: string, requestId: string): Promise<void> {
  await pp.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    body: { subject: "Invoice cancelled", note: note.slice(0, 4000), send_to_invoicer: true, send_to_recipient: true }, requestId,
  });
}

export function facts(raw: RawInvoice): InvoiceFacts {
  const currency = raw.detail?.currency_code ?? raw.amount?.currency_code ?? "USD";
  const minor = (v?: string) => (v ? toMinor(v, currency) : 0);
  const txs = raw.payments?.transactions ?? [];
  // MARKED_AS_PAID / PAID_EXTERNAL mean the invoicer recorded money PayPal never saw.
  const viaPayPal = !txs.some((t) => t.type === "EXTERNAL");
  return {
    id: raw.id,
    status: raw.status,
    number: raw.detail?.invoice_number ?? null,
    reference: raw.detail?.reference ?? null,
    currency,
    totalMinor: minor(raw.amount?.value),
    paidMinor: minor(raw.payments?.paid_amount?.value),
    dueMinor: minor(raw.due_amount?.value),
    recipientViewUrl: raw.detail?.metadata?.recipient_view_url ?? null,
    paidThroughPayPal: raw.status === "PAID" && viaPayPal && minor(raw.due_amount?.value) === 0,
    lastPaymentId: txs[txs.length - 1]?.payment_id ?? null,
  };
}

export async function createWebhook(pp: PayPalClient, url: string) {
  return pp.request<{ id: string }>("POST", "/v1/notifications/webhooks", { body: { url, event_types: INVOICE_EVENTS.map((name) => ({ name })) } });
}

export async function listWebhooks(pp: PayPalClient) {
  return pp.request<{ webhooks?: Array<{ id: string; url: string }> }>("GET", "/v1/notifications/webhooks");
}

/** The invoice id in an INVOICING.INVOICE.* webhook, whichever way the resource is shaped. */
export function invoiceIdFromEvent(resource: Record<string, unknown> | undefined): string | null {
  const inner = (resource?.invoice ?? resource) as { id?: unknown } | undefined;
  return typeof inner?.id === "string" ? inner.id : null;
}
