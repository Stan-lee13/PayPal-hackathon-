/**
 * The PayPal calls behind an envelope.
 *
 *   Seal    POST /v2/checkout/orders (intent AUTHORIZE)       a hold for the envelope's whole limit
 *   Spend   POST /v2/payments/authorizations/{id}/capture     partial capture: exactly what the agent spent
 *           POST /v1/payments/payouts                          pay the payee
 *   Close   POST /v2/payments/authorizations/{id}/void         release whatever was never spent
 *   Undo    POST /v2/payments/captures/{id}/refund             if a payout can't be sent after a capture
 *   Recall  POST /v1/payments/payouts-item/{id}/cancel         take back a payout the payee never claimed
 *   Events  POST /v1/notifications/verify-webhook-signature    is this event really from PayPal?
 *           GET  /v1/notifications/webhooks-events             PayPal's own list of the events it reported
 *
 * Verified against the PayPal sandbox on 2026-11-11: twelve partial captures of one authorization
 * all completed, an over-capture was refused by PayPal (MAX_CAPTURE_AMOUNT_EXCEEDED), and a void
 * after partial captures released the remainder.
 *
 * Every mutating call carries a PayPal-Request-Id derived from our own ids, so a retry can never
 * capture, pay or refund twice. Payouts are also de-duplicated by sender_batch_id.
 */
import { PayPalApiError, type PayPalClient } from "./client";
import { toDecimalString, toMinor } from "../money";

type Money = { currency_code: string; value: string };
type RawAuth = { id: string; status: string; amount: Money; expiration_time?: string; custom_id?: string };

export type AuthorizationFacts = { id: string; orderId: string | null; status: string; amountMinor: number; currency: string; expiresAt: string | null; customId: string | null };
export type CaptureFacts = { id: string; status: string; amountMinor: number; currency: string; invoiceId: string | null };
export type PayoutFacts = { batchId: string; batchStatus: string; itemId: string | null; itemStatus: string | null; transactionId: string | null; receiver: string | null; error: string | null };

/**
 * PayPal's documented sandbox test cards (developer.paypal.com/tools/sandbox/card-testing: any future
 * expiry, any 3-digit CVV). In the sandbox one of them stands in for the principal's funding instrument,
 * so a hold can be placed without a browser; they are refused outside the sandbox. In production the
 * principal approves the hold in PayPal's own checkout (or a vaulted wallet is used).
 *
 * The sandbox sometimes stops honouring a test card after many holds (PAYER_CANNOT_PAY). When it does,
 * the next card on the list is tried. PAYPAL_SANDBOX_TEST_CARD puts a card of your choice first.
 */
const SANDBOX_TEST_CARDS = [process.env.PAYPAL_SANDBOX_TEST_CARD, "4012888888881881", "4005519200000004", "2223000048400011", "4032039317984658"].filter((x): x is string => Boolean(x && /^\d{13,19}$/.test(x)));
const testCard = (number: string) => ({
  number, expiry: "2030-12", security_code: "123", name: "Sandbox Principal",
  billing_address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
});

/** Place the hold that backs a root envelope. */
export async function authorizeHold(pp: PayPalClient, a: { rootId: string; title: string; currency: string; amountMinor: number }): Promise<AuthorizationFacts> {
  if (pp.env !== "sandbox") throw new Error("Holds on the sandbox test card are only available in sandbox mode.");
  let refused: unknown = null;
  for (const [i, number] of SANDBOX_TEST_CARDS.entries()) {
    try {
      const r = await pp.request<{ id: string; status: string; purchase_units?: Array<{ payments?: { authorizations?: RawAuth[] } }> }>("POST", "/v2/checkout/orders", {
        // One idempotency key per card tried: the same key with a different card would be a different request.
        requestId: i === 0 ? `seal-${a.rootId}` : `seal-${a.rootId}-c${i}`,
        prefer: "return=representation",
        body: {
          intent: "AUTHORIZE",
          purchase_units: [{ reference_id: a.rootId, custom_id: a.rootId, description: `Envelope: ${a.title}`.slice(0, 127), amount: { currency_code: a.currency, value: toDecimalString(a.amountMinor, a.currency) } }],
          payment_source: { card: testCard(number) },
        },
      });
      const auth = r.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!auth) throw new Error(`PayPal returned no authorization (order ${r.id}, status ${r.status}).`);
      return { ...authFacts(auth), orderId: r.id, customId: auth.custom_id ?? a.rootId };
    } catch (e) {
      // Only a decline of this card moves on to the next one; anything else is a real failure.
      if (!(e instanceof PayPalApiError) || !["PAYER_CANNOT_PAY", "CARD_TYPE_NOT_SUPPORTED", "TRANSACTION_REFUSED"].includes(e.issue ?? "")) throw e;
      refused = e;
    }
  }
  throw refused ?? new Error("No sandbox test card is configured.");
}

export async function getAuthorization(pp: PayPalClient, id: string): Promise<AuthorizationFacts> {
  return authFacts(await pp.request<RawAuth>("GET", `/v2/payments/authorizations/${encodeURIComponent(id)}`));
}

function authFacts(a: RawAuth): AuthorizationFacts {
  return { id: a.id, orderId: null, status: a.status, amountMinor: toMinor(a.amount.value, a.amount.currency_code), currency: a.amount.currency_code, expiresAt: a.expiration_time ?? null, customId: a.custom_id ?? null };
}

/** Take exactly `amountMinor` from the hold and leave the rest in place. Idempotent per spend. */
export async function capturePart(pp: PayPalClient, authId: string, a: { spendId: string; amountMinor: number; currency: string; note: string }): Promise<CaptureFacts> {
  const c = await pp.request<{ id: string; status: string; amount?: Money; invoice_id?: string }>("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
    requestId: `capture-${a.spendId}`,
    prefer: "return=representation",
    body: { amount: { currency_code: a.currency, value: toDecimalString(a.amountMinor, a.currency) }, final_capture: false, invoice_id: a.spendId, note_to_payer: a.note.slice(0, 255) },
  });
  return { id: c.id, status: c.status, amountMinor: c.amount ? toMinor(c.amount.value, c.amount.currency_code) : a.amountMinor, currency: c.amount?.currency_code ?? a.currency, invoiceId: c.invoice_id ?? a.spendId };
}

export async function getCapture(pp: PayPalClient, id: string): Promise<CaptureFacts> {
  const c = await pp.request<{ id: string; status: string; amount: Money; invoice_id?: string }>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`);
  return { id: c.id, status: c.status, amountMinor: toMinor(c.amount.value, c.amount.currency_code), currency: c.amount.currency_code, invoiceId: c.invoice_id ?? null };
}

/** Release whatever is left of the hold. */
export async function voidAuthorization(pp: PayPalClient, authId: string, rootId: string): Promise<void> {
  await pp.request("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, { requestId: `close-${rootId}` });
}

export async function refundCapture(pp: PayPalClient, captureId: string, spendId: string, reason: string): Promise<{ id: string; status: string }> {
  return pp.request("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { requestId: `refund-${spendId}`, body: { note_to_payer: reason.slice(0, 255) } });
}

/** Pay the payee. sender_batch_id is the spend id, so PayPal itself refuses a second payout for it. */
export async function payout(pp: PayPalClient, a: { spendId: string; receiverEmail: string; amountMinor: number; currency: string; note: string }): Promise<PayoutFacts> {
  const r = await pp.request<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
    requestId: `payout-${a.spendId}`,
    body: {
      sender_batch_header: { sender_batch_id: a.spendId, email_subject: "You've been paid through an Envelope", email_message: a.note.slice(0, 1000) },
      items: [{ recipient_type: "EMAIL", receiver: a.receiverEmail, amount: { currency: a.currency, value: toDecimalString(a.amountMinor, a.currency) }, note: a.note.slice(0, 1000), sender_item_id: a.spendId }],
    },
  });
  const id = r.batch_header.payout_batch_id;
  return getPayout(pp, id).catch(() => ({ batchId: id, batchStatus: r.batch_header.batch_status, itemId: null, itemStatus: null, transactionId: null, receiver: a.receiverEmail, error: null }));
}

export async function getPayout(pp: PayPalClient, batchId: string): Promise<PayoutFacts> {
  const r = await pp.request<{ batch_header: { payout_batch_id: string; batch_status: string }; items?: Array<{ payout_item_id: string; transaction_id?: string; transaction_status?: string; payout_item?: { receiver?: string }; errors?: { name?: string; message?: string } }> }>(
    "GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  const it = r.items?.[0];
  return { batchId: r.batch_header.payout_batch_id, batchStatus: r.batch_header.batch_status, itemId: it?.payout_item_id ?? null, itemStatus: it?.transaction_status ?? null, transactionId: it?.transaction_id ?? null, receiver: it?.payout_item?.receiver ?? null, error: it?.errors?.name ?? null };
}

/** Cancel a payout item PayPal is holding unclaimed. PayPal returns the money to the sender and reports the item RETURNED. */
export async function cancelPayoutItem(pp: PayPalClient, itemId: string): Promise<{ itemId: string; itemStatus: string | null }> {
  const r = await pp.request<{ payout_item_id?: string; transaction_status?: string }>("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`);
  return { itemId: r.payout_item_id ?? itemId, itemStatus: r.transaction_status ?? null };
}

export type EventHeaders = { authAlgo: string; certUrl: string; transmissionId: string; transmissionSig: string; transmissionTime: string };
/**
 * Ask PayPal whether an event it supposedly sent is genuine. The event is passed on byte for byte:
 * PayPal signs the exact text it sent, so a re-serialized copy can fail to verify.
 */
export async function verifyWebhookSignature(pp: PayPalClient, webhookId: string, h: EventHeaders, rawEvent: string): Promise<boolean> {
  const head = JSON.stringify({ auth_algo: h.authAlgo, cert_url: h.certUrl, transmission_id: h.transmissionId, transmission_sig: h.transmissionSig, transmission_time: h.transmissionTime, webhook_id: webhookId });
  const r = await pp.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", { rawBody: `${head.slice(0, -1)},"webhook_event":${rawEvent}}` });
  return r.verification_status === "SUCCESS";
}

export type PayPalEventBody = { id: string; event_type: string; create_time?: string; resource?: Record<string, unknown> };
/** PayPal's own record of the events it reported for this app, newest first. Empty unless a webhook is registered. */
export async function listEvents(pp: PayPalClient, since?: Date): Promise<PayPalEventBody[]> {
  const r = await pp.request<{ events?: PayPalEventBody[] }>("GET", "/v1/notifications/webhooks-events", { query: { page_size: "50", ...(since ? { start_time: since.toISOString().replace(/\.\d+Z$/, "Z") } : {}) } });
  return r.events ?? [];
}
