/**
 * A record of every call this gateway makes to PayPal: what was asked, what PayPal answered, and
 * PayPal's own debug id for the call. It is what lets an envelope's page say exactly what PayPal did
 * for it, and what Envelope decided on its own.
 *
 * Only facts are kept: the operation, PayPal's ids and statuses, the amount, the timing. Request and
 * response bodies are not stored (the hold request carries a card number in the sandbox).
 * Writing is best effort and never delays or fails a payment.
 */
import { arrayOverlaps, asc } from "drizzle-orm";
import { getDb } from "../db";
import { paypalCalls, type PayPalCall } from "../db/schema";
import { toMinor } from "../money";
import { paypalMode, setPayPalObserver, type CallRecord } from "./client";

/** method + path → the operation, in the words the pages use. */
const OPS: Array<[string, RegExp, string]> = [
  ["POST", /^\/v2\/checkout\/orders$/, "hold.place"],
  ["GET", /^\/v2\/payments\/authorizations\/[^/]+$/, "hold.read"],
  ["POST", /^\/v2\/payments\/authorizations\/[^/]+\/capture$/, "capture"],
  ["POST", /^\/v2\/payments\/authorizations\/[^/]+\/void$/, "hold.void"],
  ["GET", /^\/v2\/payments\/captures\/[^/]+$/, "capture.read"],
  ["POST", /^\/v2\/payments\/captures\/[^/]+\/refund$/, "refund"],
  ["POST", /^\/v1\/payments\/payouts$/, "payout.send"],
  ["GET", /^\/v1\/payments\/payouts\/[^/]+$/, "payout.read"],
  ["POST", /^\/v1\/payments\/payouts-item\/[^/]+\/cancel$/, "payout.cancel"],
  ["POST", /^\/v1\/notifications\/verify-webhook-signature$/, "event.verify"],
  ["GET", /^\/v1\/notifications\/webhooks-events$/, "event.feed"],
];
export const OP_TEXT: Record<string, string> = {
  "hold.place": "Placed the hold", "hold.read": "Read the hold", "hold.void": "Released the rest of the hold",
  capture: "Captured part of the hold", "capture.read": "Read a capture", refund: "Refunded a capture",
  "payout.send": "Sent a payout", "payout.read": "Read a payout", "payout.cancel": "Cancelled an unclaimed payout",
  "event.verify": "Verified an event's signature", "event.feed": "Read its event feed",
};
/** Operations that change something at PayPal, as opposed to asking. */
export const MOVES = ["hold.place", "capture", "hold.void", "refund", "payout.send", "payout.cancel"];

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

function describe(c: CallRecord): Omit<PayPalCall, "id" | "at"> | null {
  const op = OPS.find(([m, re]) => m === c.method && re.test(c.path))?.[2];
  if (!op) return null;
  const req = (c.request ?? {}) as Loose, res = (c.response ?? {}) as Loose;
  const ok = c.status >= 200 && c.status < 300;
  const inPath = c.path.split("/").filter((x) => /^[A-Za-z0-9_-]{8,}$/.test(x) && !["payments", "authorizations", "captures", "checkout", "notifications", "payouts-item"].includes(x));
  const auth = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  const item = res.items?.[0];
  // Our own ids travel in the idempotency key: seal-<envelope>, capture-<payment>, payout-<payment>, refund-<payment>, close-<envelope>.
  const ours = c.requestId ? c.requestId.replace(/^(seal|capture|payout|refund|close)-/, "").replace(op === "hold.place" ? /-c\d+$/ : /$^/, "") : null;
  const keys = [...new Set([
    ...inPath, ours, str(res.id), str(auth?.id), str(res.batch_header?.payout_batch_id), str(item?.payout_item_id), str(res.payout_item_id), str(res.payout_batch_id),
    str(res.invoice_id), str(res.custom_id), str(req.purchase_units?.[0]?.custom_id), str(req.sender_batch_header?.sender_batch_id), str(req.invoice_id),
  ].filter((x): x is string => Boolean(x)))];
  const money = req.amount ?? req.purchase_units?.[0]?.amount ?? req.items?.[0]?.amount ?? res.amount ?? item?.payout_item?.amount ?? res.payout_item?.amount;
  const currency = str(money?.currency_code) ?? str(money?.currency);
  let amountMinor: number | null = null;
  try { if (currency && str(money?.value)) amountMinor = toMinor(money.value, currency); } catch { /* not an amount we understand */ }
  const paypalStatus = ok
    ? (op === "hold.place" ? str(auth?.status) : op === "hold.void" ? "VOIDED" : str(item?.transaction_status) ?? str(res.transaction_status) ?? str(res.status) ?? str(res.batch_header?.batch_status) ?? str(res.verification_status) ?? (op === "event.feed" ? `${res.events?.length ?? 0} events` : null))
    : null;
  return {
    mode: paypalMode(), op, method: c.method, path: c.path.replace(/\/[A-Za-z0-9_-]{12,}(?=\/|$)/g, "/{id}"), requestId: c.requestId, httpStatus: c.status, paypalStatus,
    resourceId: ok ? (op === "hold.place" ? str(auth?.id) : str(res.id) ?? str(res.batch_header?.payout_batch_id) ?? str(res.payout_item_id) ?? inPath[inPath.length - 1] ?? null) : inPath[inPath.length - 1] ?? null,
    amountMinor, currency, debugId: c.debugId, ms: c.ms,
    error: ok ? null : [str(res.name), str(res.details?.[0]?.issue)].filter(Boolean).join("/") || `HTTP ${c.status}`,
    keys,
  };
}

const pending = new Set<Promise<unknown>>();
setPayPalObserver((c) => {
  const row = describe(c);
  if (!row) return;
  const p = Promise.resolve().then(() => getDb().insert(paypalCalls).values(row)).catch(() => undefined);
  pending.add(p);
  void p.finally(() => pending.delete(p));
});

/** Wait for records still being written (end of a request, end of a script, before reading them back). */
export async function flushJournal(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/** Every recorded call that touched any of these ids (ours or PayPal's), oldest first. */
export async function callsFor(keys: string[], limit = 400): Promise<PayPalCall[]> {
  await flushJournal();
  if (!keys.length) return [];
  return getDb().select().from(paypalCalls).where(arrayOverlaps(paypalCalls.keys, keys)).orderBy(asc(paypalCalls.id)).limit(limit);
}
