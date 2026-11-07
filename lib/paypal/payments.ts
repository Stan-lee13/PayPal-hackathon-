/**
 * PayPal money movement for bounties.
 *
 *   Reserve   POST /v2/checkout/orders  (intent AUTHORIZE)  → company approves on PayPal
 *             POST /v2/checkout/orders/{id}/authorize        → authorization: funds held on the company's
 *                                                              account, not yet taken
 *   Release   POST /v2/payments/authorizations/{id}/capture  → money taken (only on approval)
 *             POST /v1/payments/payouts                       → developer paid to their PayPal account
 *   Cancel    POST /v2/payments/authorizations/{id}/void     → reservation released, company never charged
 *   Undo      POST /v2/payments/captures/{id}/refund         → e.g. payout returned unclaimed
 *   Extend    POST /v2/payments/authorizations/{id}/reauthorize
 *
 * Every mutating call carries a PayPal-Request-Id derived from the bounty, so a retry can never
 * capture, pay out or refund twice. Payouts are additionally de-duplicated by sender_batch_id.
 */
import type { PayPalClient } from "./client";
import { toDecimalString, toMinor } from "../money";

type Money = { currency_code: string; value: string };
type Link = { href: string; rel: string; method?: string };

export type AuthorizationFacts = { id: string; status: string; amountMinor: number; currency: string; expiresAt: string | null; customId: string | null };
export type CaptureFacts = { id: string; status: string; amountMinor: number; currency: string; netMinor: number | null; feeMinor: number | null };
export type PayoutFacts = { batchId: string; batchStatus: string; itemId: string | null; itemStatus: string | null; receiver: string | null; error: string | null };

export async function createBountyOrder(pp: PayPalClient, a: {
  bountyId: string; attempt: number; title: string; currency: string; bountyMinor: number; feeMinor: number; returnUrl: string; cancelUrl: string;
}): Promise<{ orderId: string; approveUrl: string }> {
  const c = a.currency;
  const v = (n: number) => toDecimalString(n, c);
  const order = await pp.request<{ id: string; status: string; links?: Link[] }>("POST", "/v2/checkout/orders", {
    requestId: `order-${a.bountyId}-${a.attempt}`,
    prefer: "return=representation",
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: a.bountyId,
        custom_id: a.bountyId,
        invoice_id: `${a.bountyId}-${a.attempt}`,
        description: `Bounty: ${a.title}`.slice(0, 127),
        amount: {
          currency_code: c, value: v(a.bountyMinor + a.feeMinor),
          breakdown: { item_total: { currency_code: c, value: v(a.bountyMinor + a.feeMinor) } },
        },
        items: [
          { name: `Bounty: ${a.title}`.slice(0, 127), quantity: "1", unit_amount: { currency_code: c, value: v(a.bountyMinor) }, category: "DIGITAL_GOODS" },
          ...(a.feeMinor > 0 ? [{ name: "MergePay platform fee", quantity: "1", unit_amount: { currency_code: c, value: v(a.feeMinor) }, category: "DIGITAL_GOODS" }] : []),
        ],
      }],
      payment_source: {
        paypal: { experience_context: { brand_name: "MergePay", user_action: "CONTINUE", shipping_preference: "NO_SHIPPING", return_url: a.returnUrl, cancel_url: a.cancelUrl } },
      },
    },
  });
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approve) throw new Error("PayPal created the order but returned no approval link.");
  return { orderId: order.id, approveUrl: approve };
}

export async function getOrder(pp: PayPalClient, orderId: string) {
  return pp.request<{ id: string; status: string; purchase_units?: Array<{ custom_id?: string; payments?: { authorizations?: RawAuth[] } }> }>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

type RawAuth = { id: string; status: string; amount: Money; expiration_time?: string; custom_id?: string };

/** After the company approved: turn the order into an authorization (the reservation). */
export async function authorizeOrder(pp: PayPalClient, orderId: string, bountyId: string): Promise<AuthorizationFacts> {
  const r = await pp.request<{ id: string; status: string; purchase_units?: Array<{ custom_id?: string; payments?: { authorizations?: RawAuth[] } }> }>(
    "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { requestId: `authorize-${bountyId}-${orderId}`, prefer: "return=representation", body: {} });
  const pu = r.purchase_units?.[0];
  const auth = pu?.payments?.authorizations?.[0];
  if (!auth) throw new Error(`PayPal returned no authorization for order ${orderId} (status ${r.status}).`);
  return authFacts(auth, pu?.custom_id ?? null);
}

export async function getAuthorization(pp: PayPalClient, id: string): Promise<AuthorizationFacts> {
  const a = await pp.request<RawAuth>("GET", `/v2/payments/authorizations/${encodeURIComponent(id)}`);
  return authFacts(a, a.custom_id ?? null);
}

function authFacts(a: RawAuth, customId: string | null): AuthorizationFacts {
  return { id: a.id, status: a.status, amountMinor: toMinor(a.amount.value, a.amount.currency_code), currency: a.amount.currency_code, expiresAt: a.expiration_time ?? null, customId: a.custom_id ?? customId };
}

/** Take the reserved money. Idempotent per bounty. */
export async function captureAuthorization(pp: PayPalClient, authId: string, bountyId: string, note: string): Promise<CaptureFacts> {
  const c = await pp.request<{ id: string; status: string; amount?: Money; seller_receivable_breakdown?: { net_amount?: Money; paypal_fee?: Money } }>(
    "POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`,
    { requestId: `capture-${bountyId}`, prefer: "return=representation", body: { final_capture: true, note_to_payer: note.slice(0, 255) } });
  return captureFacts(c);
}

export async function getCapture(pp: PayPalClient, id: string): Promise<CaptureFacts> {
  return captureFacts(await pp.request("GET", `/v2/payments/captures/${encodeURIComponent(id)}`));
}

function captureFacts(c: { id: string; status: string; amount?: Money; seller_receivable_breakdown?: { net_amount?: Money; paypal_fee?: Money } }): CaptureFacts {
  const cur = c.amount?.currency_code ?? "USD";
  const m = (x?: Money) => (x ? toMinor(x.value, x.currency_code) : null);
  return { id: c.id, status: c.status, amountMinor: m(c.amount) ?? 0, currency: cur, netMinor: m(c.seller_receivable_breakdown?.net_amount), feeMinor: m(c.seller_receivable_breakdown?.paypal_fee) };
}

/** Release the reservation without charging anyone. */
export async function voidAuthorization(pp: PayPalClient, authId: string, bountyId: string): Promise<void> {
  await pp.request("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, { requestId: `void-${bountyId}` });
}

export async function reauthorize(pp: PayPalClient, authId: string, bountyId: string, n: number): Promise<AuthorizationFacts> {
  const a = await pp.request<RawAuth>("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/reauthorize`, { requestId: `reauth-${bountyId}-${n}`, prefer: "return=representation", body: {} });
  return authFacts(a, null);
}

export async function refundCapture(pp: PayPalClient, captureId: string, bountyId: string, reason: string): Promise<{ id: string; status: string }> {
  return pp.request("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { requestId: `refund-${bountyId}`, body: { note_to_payer: reason.slice(0, 255) } });
}

/** Pay the developer. sender_batch_id is unique per bounty, so PayPal refuses a second payout. */
export async function payout(pp: PayPalClient, a: { bountyId: string; receiverEmail: string; amountMinor: number; currency: string; note: string }): Promise<PayoutFacts> {
  const r = await pp.request<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
    requestId: `payout-${a.bountyId}`,
    body: {
      sender_batch_header: { sender_batch_id: `bounty-${a.bountyId}`, email_subject: "You've been paid for a MergePay bounty", email_message: a.note.slice(0, 1000) },
      items: [{ recipient_type: "EMAIL", receiver: a.receiverEmail, amount: { currency: a.currency, value: toDecimalString(a.amountMinor, a.currency) }, note: a.note.slice(0, 4000), sender_item_id: a.bountyId }],
    },
  });
  return getPayout(pp, r.batch_header.payout_batch_id).catch(() => ({ batchId: r.batch_header.payout_batch_id, batchStatus: r.batch_header.batch_status, itemId: null, itemStatus: null, receiver: a.receiverEmail, error: null }));
}

export async function getPayout(pp: PayPalClient, batchId: string): Promise<PayoutFacts> {
  const r = await pp.request<{ batch_header: { payout_batch_id: string; batch_status: string }; items?: Array<{ payout_item_id: string; transaction_status?: string; payout_item?: { receiver?: string }; errors?: { name?: string; message?: string } }> }>(
    "GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  const it = r.items?.[0];
  return { batchId: r.batch_header.payout_batch_id, batchStatus: r.batch_header.batch_status, itemId: it?.payout_item_id ?? null, itemStatus: it?.transaction_status ?? null, receiver: it?.payout_item?.receiver ?? null, error: it?.errors ? `${it.errors.name ?? ""} ${it.errors.message ?? ""}`.trim() : null };
}
