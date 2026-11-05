/**
 * Pre-capture promise verification ("preflight").
 *
 * Before Kept captures a payment in its protected checkout, it fetches the AUTHORITATIVE
 * PayPal order (GET /v2/checkout/orders/{id}) and compares what PayPal is about to charge with
 * the enforceable price the merchant's assistant promised in the stored conversation.
 *
 * Patterns adapted from Graphite's execution boundary (docs/GRAPHITE_ADAPTATION.md):
 *  - the verdict is bound to a digest of the exact PayPal order (any later change → new digest);
 *  - only a coded verdict gates capture — the explanation text never does;
 *  - verdicts expire; capture always re-verifies immediately before calling PayPal;
 *  - the capture request is recorded on the audit chain before the irreversible call.
 *
 * Deterministic: rules extractor + validator over the immutable chat source, integer money.
 * A network or API failure is NEVER a pass (PRECHECK_FAILED).
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { preflights, sources, type Order, type Preflight } from "../db/schema";
import { newId } from "../ids";
import { canonicalJson } from "../ledger/chain";
import { formatMoney, toMinor } from "../money";
import { getPayPal } from "../paypal/client";
import { getOrder } from "../paypal/api";
import { extractWithRules } from "../promises/rules-extractor";
import { validateAll } from "../promises/validator";
import type { SourceDoc } from "../promises/types";
import { audit } from "./audit";

export const PREFLIGHT_TTL_MS = 10 * 60_000;

export type Verdict = "READY_TO_CAPTURE" | "BLOCKED_MISMATCH" | "NEEDS_CONFIRMATION" | "PRECHECK_FAILED";
export type ReasonCode =
  | "AMOUNT_AND_CURRENCY_MATCH" | "AMOUNT_ABOVE_PROMISE" | "AMOUNT_BELOW_PROMISE" | "CURRENCY_MISMATCH" | "CONFLICTING_PRICE_PROMISES"
  | "NO_PRICE_PROMISE" | "PRICE_APPROXIMATE_NOT_ENFORCED" | "PRICE_NOT_A_TOTAL" | "PRICE_STATEMENT_UNCLEAR"
  | "PAYPAL_ORDER_UNAVAILABLE" | "PAYPAL_ORDER_UNREADABLE" | "BINDING_MISMATCH" | "NOT_APPROVED_BY_BUYER" | "ALREADY_CAPTURED"
  | "ORDER_CHANGED_SINCE_LAST_CHECK" | "MERCHANT_CONFIRMED_AMOUNT";

export type PromiseRead = { kind: "EXACT"; amountMinor: number; currency: string; quote: string } | { kind: "CURRENCY"; amountMinor: number; currency: string; quote: string }
  | { kind: "CONFLICT"; quotes: string[] } | { kind: "NONE"; code: ReasonCode; quote: string | null };

const PayPalOrderView = z.object({
  id: z.string(),
  status: z.string(),
  intent: z.string().optional(),
  purchase_units: z.array(z.object({
    reference_id: z.string().optional(), custom_id: z.string().optional(), invoice_id: z.string().optional(),
    amount: z.object({ currency_code: z.string(), value: z.string(), breakdown: z.record(z.string(), z.unknown()).optional() }),
    payee: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).min(1),
}).passthrough();

/** SHA-256 over the money-relevant fields of the authoritative PayPal order (Graphite: bound artifact digest). */
export function orderDigest(o: z.infer<typeof PayPalOrderView>): string {
  const pu = o.purchase_units[0]!;
  const bound = { id: o.id, intent: o.intent ?? null, custom_id: pu.custom_id ?? null, invoice_id: pu.invoice_id ?? null, amount: pu.amount, payee: pu.payee ?? null, units: o.purchase_units.length };
  return createHash("sha256").update(canonicalJson(bound), "utf8").digest("hex");
}

/** What did the assistant promise about the total? Same extractor + validator Kept uses after capture. */
export function readPricePromise(src: SourceDoc, payCurrency: string): PromiseRead {
  const v = validateAll(extractWithRules([src], payCurrency), { sources: [src], merchantId: src.merchantId, orderId: src.orderId, orderCurrency: payCurrency, minConfidence: 0.7 })
    .filter((r) => r.candidate.type === "PRICE_AS_QUOTED");
  const exact = v.filter((r) => r.enforceable && r.params.kind === "PRICE_AS_QUOTED");
  const conflicting = v.filter((r) => r.checks.some((c) => c.check === "no_conflicting_promise" && !c.ok));
  if (conflicting.length) return { kind: "CONFLICT", quotes: conflicting.map((r) => r.candidate.quote) };
  const last = exact.at(-1);
  if (last && last.params.kind === "PRICE_AS_QUOTED") return { kind: "EXACT", amountMinor: last.params.amountMinor, currency: last.params.currency, quote: last.candidate.quote };
  // A firm total in ANOTHER currency is still a commitment — it is violated by a charge in this one.
  for (const r of v.slice().reverse()) {
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.check);
    if (failed.length === 1 && failed[0] === "currency_matches_order") {
      const m = r.candidate.quote.match(/(£|€|₦|US\$|\$)\s?(\d+(?:\.\d{1,2})?)/);
      const cur = m ? ({ "£": "GBP", "€": "EUR", "₦": "NGN", "US$": "USD", $: "USD" } as Record<string, string>)[m[1]!] : undefined;
      if (m && cur && cur !== payCurrency) return { kind: "CURRENCY", amountMinor: toMinor(m[2]!, cur), currency: cur, quote: r.candidate.quote };
    }
  }
  const any = v.at(-1);
  if (!any) return { kind: "NONE", code: "NO_PRICE_PROMISE", quote: null };
  const failed = new Set(any.checks.filter((c) => !c.ok).map((c) => c.check));
  const code: ReasonCode = failed.has("unambiguous_language") ? "PRICE_APPROXIMATE_NOT_ENFORCED" : failed.has("explicit_total_semantics") ? "PRICE_NOT_A_TOTAL" : "PRICE_STATEMENT_UNCLEAR";
  return { kind: "NONE", code, quote: any.candidate.quote };
}

export type PreflightResult = Preflight & { allowCapture: boolean; explanation: string };

/**
 * Run a preflight for the order's CURRENT PayPal order. Persists the verdict and audits it.
 * `enforced` = the merchant's protected checkout (BLOCK/HONOR); otherwise the verdict is recorded only.
 */
export async function runPreflight(order: Order, opts: { enforced: boolean; actor?: "system" | "customer" }): Promise<PreflightResult> {
  const db = getDb();
  const paypalOrderId = order.paypalOrderId!;
  const chat = await db.query.sources.findFirst({ where: and(eq(sources.orderId, order.id), eq(sources.kind, "CHAT_TRANSCRIPT")) });
  const previous = await db.query.preflights.findFirst({ where: and(eq(preflights.orderId, order.id), eq(preflights.paypalOrderId, paypalOrderId)), orderBy: desc(preflights.checkedAt) });

  let verdict: Verdict; const reasons: ReasonCode[] = [];
  let orderMinor: number | null = null; let payCurrency: string | null = null; let digest: string | null = null; let paypalStatus: string | null = null;
  let promise: PromiseRead = { kind: "NONE", code: "NO_PRICE_PROMISE", quote: null };

  let view: z.infer<typeof PayPalOrderView> | null = null;
  try {
    const raw = await getOrder(getPayPal(), paypalOrderId);
    const parsed = PayPalOrderView.safeParse(raw);
    if (!parsed.success) reasons.push("PAYPAL_ORDER_UNREADABLE"); else view = parsed.data;
  } catch {
    reasons.push("PAYPAL_ORDER_UNAVAILABLE");
  }

  if (!view) verdict = "PRECHECK_FAILED";
  else {
    const pu = view.purchase_units[0]!;
    paypalStatus = view.status; payCurrency = pu.amount.currency_code; digest = orderDigest(view);
    try { orderMinor = toMinor(pu.amount.value, payCurrency); } catch { orderMinor = null; }
    if (previous?.orderDigest && previous.orderDigest !== digest) reasons.push("ORDER_CHANGED_SINCE_LAST_CHECK");
    if (orderMinor === null) { verdict = "PRECHECK_FAILED"; reasons.push("PAYPAL_ORDER_UNREADABLE"); }
    else if (pu.custom_id !== order.id) { verdict = "PRECHECK_FAILED"; reasons.push("BINDING_MISMATCH"); }
    else if (view.status === "COMPLETED") { verdict = "PRECHECK_FAILED"; reasons.push("ALREADY_CAPTURED"); }
    else if (view.status !== "APPROVED") { verdict = "PRECHECK_FAILED"; reasons.push("NOT_APPROVED_BY_BUYER"); }
    else {
      promise = chat ? readPricePromise({ id: chat.id, kind: "CHAT_TRANSCRIPT", title: chat.title, text: chat.text, merchantId: chat.merchantId, orderId: chat.orderId }, payCurrency) : { kind: "NONE", code: "NO_PRICE_PROMISE", quote: null };
      if (promise.kind === "EXACT") {
        if (orderMinor === promise.amountMinor) { verdict = "READY_TO_CAPTURE"; reasons.push("AMOUNT_AND_CURRENCY_MATCH"); }
        else if (orderMinor > promise.amountMinor) { verdict = "BLOCKED_MISMATCH"; reasons.push("AMOUNT_ABOVE_PROMISE"); }
        else { verdict = "NEEDS_CONFIRMATION"; reasons.push("AMOUNT_BELOW_PROMISE"); }
      } else if (promise.kind === "CURRENCY") { verdict = "BLOCKED_MISMATCH"; reasons.push("CURRENCY_MISMATCH"); }
      else if (promise.kind === "CONFLICT") { verdict = "NEEDS_CONFIRMATION"; reasons.push("CONFLICTING_PRICE_PROMISES"); }
      else { verdict = "READY_TO_CAPTURE"; reasons.push(promise.code); }
    }
  }

  // A merchant may confirm an amount the BUYER already approved when no enforceable promise contradicts it
  // (below-promise, conflicting promises). It is bound to this exact order digest. It can never clear a BLOCKED_MISMATCH.
  let resolution: Preflight["resolution"] = null; let resolvedBy: string | null = null; let resolvedAt: Date | null = null;
  if (verdict === "NEEDS_CONFIRMATION" && digest) {
    const confirmed = await db.query.preflights.findFirst({ where: and(eq(preflights.orderId, order.id), eq(preflights.orderDigest, digest), eq(preflights.resolution, "MERCHANT_CONFIRMED_AMOUNT")) });
    if (confirmed) { resolution = "MERCHANT_CONFIRMED_AMOUNT"; resolvedBy = confirmed.resolvedBy; resolvedAt = confirmed.resolvedAt; reasons.push("MERCHANT_CONFIRMED_AMOUNT"); }
  }
  const allowCapture = !opts.enforced ? verdict !== "PRECHECK_FAILED" || reasons.includes("ALREADY_CAPTURED")
    : verdict === "READY_TO_CAPTURE" || (verdict === "NEEDS_CONFIRMATION" && resolution === "MERCHANT_CONFIRMED_AMOUNT");

  const promisedMinor = promise.kind === "EXACT" || promise.kind === "CURRENCY" ? promise.amountMinor : null;
  const promisedCurrency = promise.kind === "EXACT" || promise.kind === "CURRENCY" ? promise.currency : null;
  const diffMinor = promisedMinor !== null && orderMinor !== null && promisedCurrency === payCurrency ? orderMinor - promisedMinor : null;
  const quote = promise.kind === "EXACT" || promise.kind === "CURRENCY" ? promise.quote : promise.kind === "CONFLICT" ? promise.quotes.join(" | ") : promise.quote;
  const now = new Date();
  const [row] = await db.insert(preflights).values({
    id: newId("pf"), orderId: order.id, merchantId: order.merchantId, paypalOrderId, verdict, reasonCodes: reasons, enforced: opts.enforced,
    promisedMinor, promisedCurrency, orderMinor, orderCurrency: payCurrency, diffMinor, quote, sourceId: chat?.id ?? null, sourceSha256: chat?.sha256 ?? null,
    orderDigest: digest, paypalStatus, checkedAt: now, expiresAt: new Date(now.getTime() + PREFLIGHT_TTL_MS), resolution, resolvedBy, resolvedAt,
  }).returning();
  const explanation = explain(row!);
  await audit(db, { merchantId: order.merchantId, orderId: order.id, actor: opts.actor ?? "system", action: "preflight.verdict", ref: paypalOrderId,
    outcome: verdict === "READY_TO_CAPTURE" ? "OK" : verdict === "PRECHECK_FAILED" ? "FAILED" : "REJECTED",
    detail: { verdict, reasons, enforced: opts.enforced, promised: promisedMinor !== null ? formatMoney(promisedMinor, promisedCurrency!) : null, paypalOrder: orderMinor !== null && payCurrency ? formatMoney(orderMinor, payCurrency) : null,
      difference: diffMinor ? formatMoney(Math.abs(diffMinor), payCurrency!) : null, quote, orderDigest: digest, paypalStatus } });
  return { ...row!, allowCapture, explanation };
}

export function explain(p: Preflight): string {
  const m = (v: number | null, c: string | null) => (v === null || !c ? "—" : formatMoney(v, c));
  const r = p.reasonCodes as ReasonCode[];
  if (p.verdict === "PRECHECK_FAILED") {
    if (r.includes("ALREADY_CAPTURED")) return "PayPal reports this order is already captured.";
    if (r.includes("NOT_APPROVED_BY_BUYER")) return `The buyer has not approved this PayPal order yet (PayPal status ${p.paypalStatus}). Nothing was captured.`;
    if (r.includes("BINDING_MISMATCH")) return "The PayPal order is not bound to this Kept order (custom_id differs). Nothing was captured.";
    return "Kept could not read the PayPal order from PayPal, so it did not capture. Nothing was charged; try again.";
  }
  if (p.verdict === "BLOCKED_MISMATCH") {
    if (r.includes("CURRENCY_MISMATCH")) return `You were promised ${m(p.promisedMinor, p.promisedCurrency)}, but the PayPal order is in ${p.orderCurrency} (${m(p.orderMinor, p.orderCurrency)}). Capture blocked.`;
    return `You were promised ${m(p.promisedMinor, p.promisedCurrency)}; the PayPal order is ${m(p.orderMinor, p.orderCurrency)} — ${m(Math.abs(p.diffMinor ?? 0), p.orderCurrency)} more. Capture blocked.`;
  }
  if (p.verdict === "NEEDS_CONFIRMATION") {
    if (r.includes("MERCHANT_CONFIRMED_AMOUNT")) return `The merchant confirmed the approved amount of ${m(p.orderMinor, p.orderCurrency)}.`;
    if (r.includes("AMOUNT_BELOW_PROMISE")) return `The PayPal order (${m(p.orderMinor, p.orderCurrency)}) is ${m(Math.abs(p.diffMinor ?? 0), p.orderCurrency)} LESS than promised (${m(p.promisedMinor, p.promisedCurrency)}). The merchant must confirm before capture.`;
    return "The conversation states different totals. The merchant must confirm which one stands before capture.";
  }
  if (r.includes("AMOUNT_AND_CURRENCY_MATCH")) return `Promise verified: ${m(p.promisedMinor, p.promisedCurrency)} promised, PayPal order ${m(p.orderMinor, p.orderCurrency)}.`;
  if (r.includes("PRICE_APPROXIMATE_NOT_ENFORCED")) return "The only price stated was approximate, so it is not enforced as an exact amount.";
  if (r.includes("PRICE_NOT_A_TOTAL")) return "The price mentioned was an item price, not an order total, so the order amount is not compared with it.";
  return "No enforceable total was promised in this conversation.";
}

export async function latestPreflight(orderId: string): Promise<Preflight | null> {
  return (await getDb().query.preflights.findFirst({ where: eq(preflights.orderId, orderId), orderBy: desc(preflights.checkedAt) })) ?? null;
}

export function orderStatusAfter(verdict: Verdict): Order["status"] {
  return verdict === "BLOCKED_MISMATCH" ? "CAPTURE_BLOCKED" : verdict === "NEEDS_CONFIRMATION" ? "NEEDS_CONFIRMATION" : verdict === "PRECHECK_FAILED" ? "PRECHECK_FAILED" : "READY_TO_CAPTURE";
}
