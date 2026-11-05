/**
 * Deterministic anti-hallucination validator.
 *
 * Nothing an extractor (LLM or rules) says is trusted. A promise only becomes
 * ENFORCEABLE when ALL of these hold:
 *   1. its source exists and belongs to this order/merchant;
 *   2. its quote occurs verbatim in that source (spans are re-derived here);
 *   3. in a chat, the quote was said by the merchant's assistant, not the customer;
 *   4. its numbers are re-parsed from the quote itself (the model's params are only hints);
 *   5. currency matches the order;
 *   6. its meaning is unambiguous (no hedges, explicit total semantics, …);
 *   7. extractor confidence ≥ the merchant's threshold;
 *   8. it does not conflict with another enforceable promise of the same type.
 * Anything that fails 4–8 becomes NEEDS_CONFIRMATION (merchant decides). Anything
 * that fails 1–3 is REJECTED and never stored. OTHER is always UNVERIFIABLE.
 */
import { toMinor } from "../money";
import { speakerAt } from "./transcript";
import type { Candidate, NormalizedParams, SourceDoc, ValidatedPromise, ValidationCheck } from "./types";

const HEDGES = [
  "about", "around", "approximately", "approx", "roughly", "~", "up to", "under", "less than", "no more than",
  "from", "starting at", "starts at", "at least", "estimated", "estimate", "usually", "typically", "normally",
  "generally", "aim to", "try to", "should", "may", "might", "hopefully", "possibly", "probably", "or so", "ish",
  "subject to", "give or take", "at our discretion", "if eligible", "where eligible", "we'll see", "depending",
];
const EXCLUSIONS = ["plus shipping", "+ shipping", "excluding", "excl", "before tax", "before shipping", "plus tax", "+ tax", "not including"];
const TOTAL_WORDS = /\b(total|all[- ]in|in total|altogether|grand total|comes to|including shipping|incl\.? shipping)\b/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30, "twenty-four": 24, "forty-eight": 48, "seventy-two": 72 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

type Money = { symbol: string; amount: string; currency: string | null };

/** Find every money mention in a quote. Symbol→currency mapping is explicit and conservative. */
export function findMoney(quote: string): Money[] {
  const out: Money[] = [];
  const re = /(US\$|USD\s?|\$|£|€|₦|NGN\s?|GBP\s?|EUR\s?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:\s?(USD|GBP|EUR|NGN|dollars?))?/gi;
  for (const m of quote.matchAll(re)) {
    const sym = m[1]!.trim().toUpperCase();
    const trailing = m[3]?.toUpperCase();
    let cur: string | null =
      sym === "$" ? (trailing && trailing !== "DOLLAR" && trailing !== "DOLLARS" ? trailing : "USD?") :
      sym === "US$" || sym === "USD" ? "USD" : sym === "£" || sym === "GBP" ? "GBP" : sym === "€" || sym === "EUR" ? "EUR" :
      sym === "₦" || sym === "NGN" ? "NGN" : null;
    if (trailing && cur && cur !== "USD?" && trailing !== cur && !trailing.startsWith("DOLLAR")) cur = "CONFLICT";
    out.push({ symbol: sym, amount: m[2]!.replace(/,/g, ""), currency: cur });
  }
  // bare amounts with a trailing currency word, e.g. "84 USD"
  for (const m of quote.matchAll(/(?<![\d$£€₦.])(\d+(?:\.\d{1,2})?)\s?(USD|GBP|EUR|NGN)\b/gi)) {
    out.push({ symbol: m[2]!.toUpperCase(), amount: m[1]!, currency: m[2]!.toUpperCase() });
  }
  return out;
}

function hasHedge(quote: string): string | null {
  const q = ` ${quote.toLowerCase()} `;
  for (const h of HEDGES) {
    // "may" the month (e.g. "by 3 May 2027") is not a hedge
    if (h === "may" && /\d\s+may\b|\bmay\s+\d/.test(q) && !/\bmay\s+(ship|be|take|arrive)/.test(q)) continue;
    const re = new RegExp(`(^|[^a-z])${h.replace(/[.*+?^${}()|[\]\\~]/g, "\\$&")}([^a-z]|$)`);
    if (re.test(q)) return h;
  }
  return null;
}

function hasExclusion(quote: string): string | null {
  const q = quote.toLowerCase();
  return EXCLUSIONS.find((e) => q.includes(e)) ?? null;
}

function parseCount(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_NUM[t] ?? null;
}

/** "48 hours" → 48, "2 days"/"two days" → 48. Business days are deliberately NOT converted. */
export function parseShipWindow(quote: string): { hours: number } | { ambiguous: string } | null {
  const q = quote.toLowerCase();
  if (/business|working/.test(q)) return { ambiguous: "business/working days depend on an unstated calendar" };
  const m = q.match(/within\s+(\d+|[a-z-]+)\s+(hours?|hrs?|days?)/) ?? q.match(/in\s+(\d+|[a-z-]+)\s+(hours?|hrs?|days?)/);
  if (!m) return null;
  const n = parseCount(m[1]!);
  if (n === null || n <= 0 || n > 24 * 60) return { ambiguous: `cannot read a number from "${m[1]}"` };
  return { hours: m[2]!.startsWith("d") ? n * 24 : n };
}

/** Absolute date with month name AND year, e.g. "by 14 November 2026". Deadline = end of that day at UTC−12 (latest possible). */
export function parseByDate(quote: string): { iso: string } | { ambiguous: string } | null {
  const q = quote.toLowerCase();
  const mDayMonth = q.match(/by\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})/);
  const mMonthDay = q.match(/by\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  const pick = mDayMonth ? { d: mDayMonth[1]!, mo: mDayMonth[2]!, y: mDayMonth[3]! } : mMonthDay ? { d: mMonthDay[2]!, mo: mMonthDay[1]!, y: mMonthDay[3]! } : null;
  if (pick) {
    const mi = MONTHS.indexOf(pick.mo);
    const day = Number(pick.d);
    if (mi < 0 || day < 1 || day > 31) return { ambiguous: "unrecognised date" };
    const dt = new Date(Date.UTC(Number(pick.y), mi, day, 23, 59, 59));
    if (dt.getUTCMonth() !== mi) return { ambiguous: "invalid calendar date" };
    return { iso: new Date(dt.getTime() + 12 * 3600_000).toISOString() };
  }
  if (/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|the weekend|end of (the )?week)/.test(q)) {
    return { ambiguous: "relative date without a reference timezone" };
  }
  if (/by\s+\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/.test(q)) return { ambiguous: "numeric date is ambiguous (day/month order)" };
  return null;
}

export function parseRefundWindow(quote: string): { days: number } | { ambiguous: string } | null {
  const q = quote.toLowerCase();
  if (/business|working/.test(q)) return { ambiguous: "business/working days depend on an unstated calendar" };
  const m = q.match(/within\s+(\d+|[a-z-]+)\s+(days?|hours?)/);
  if (!m) return null;
  const n = parseCount(m[1]!);
  if (n === null || n <= 0) return { ambiguous: `cannot read a number from "${m[1]}"` };
  return { days: m[2]!.startsWith("h") ? Math.ceil(n / 24) : n };
}

function refundTrigger(quote: string): "RETURN_RECEIVED" | "CANCELLATION" | "REQUEST" | null {
  const q = quote.toLowerCase();
  if (/\b(receiv\w*|arriv\w*|get)\b[^.]*\breturn|\breturn\w*\b[^.]*\b(receiv\w*|arriv\w*)/.test(q)) return "RETURN_RECEIVED";
  if (/\bcancel/.test(q)) return "CANCELLATION";
  if (/\b(request|ask)/.test(q)) return "REQUEST";
  return null;
}

export type ValidateContext = {
  sources: SourceDoc[];
  merchantId: string;
  orderId: string | null;
  orderCurrency: string;
  minConfidence: number;
};

export function validateCandidate(c: Candidate, ctx: ValidateContext): ValidatedPromise {
  const checks: ValidationCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => (checks.push({ check, ok, detail }), ok);
  const reject = (summary: string): ValidatedPromise => ({ candidate: c, outcome: "REJECTED", enforceable: false, params: { kind: "NONE" }, spanStart: -1, spanEnd: -1, checks, summary });

  // 1. source exists and belongs to this order or merchant
  const src = ctx.sources.find((s) => s.id === c.source_id);
  if (!add("source_exists", Boolean(src), src ? `${src.kind} "${src.title}"` : `unknown source ${c.source_id}`)) return reject("Quote refers to a source that does not exist.");
  const belongs = src!.merchantId === ctx.merchantId && (src!.orderId === null || src!.orderId === ctx.orderId);
  if (!add("source_belongs_to_order", belongs, belongs ? "source is this merchant's / this order's" : "source belongs to another merchant or order")) return reject("Source does not belong to this order.");

  // 2. verbatim quote; spans re-derived, the model's offsets are not trusted
  const quote = c.quote;
  let start = -1;
  if (quote.trim().length >= 4) {
    if (c.span_start >= 0 && src!.text.slice(c.span_start, c.span_end) === quote) start = c.span_start;
    else start = src!.text.indexOf(quote);
  }
  if (!add("quote_verbatim", start >= 0, start >= 0 ? `found at ${start}` : "quote not found verbatim in source")) return reject("Quote does not appear in the source (fabricated or paraphrased).");
  const end = start + quote.length;

  // 3. speaker: in a chat, only the assistant can make a merchant promise
  if (src!.kind === "CHAT_TRANSCRIPT") {
    const who = speakerAt(src!.text, start, end);
    if (!add("said_by_merchant", who === "assistant", who === "assistant" ? "said by the merchant's assistant" : who === "customer" ? "said by the customer, not the merchant" : "quote spans multiple messages")) {
      return reject(who === "customer" ? "The customer said this, not the merchant." : "Quote spans more than one message.");
    }
  }

  // 3b. who may make which commitment: merchant promises only from merchant sources,
  //     mandates only from the shopper's own instruction to their agent.
  const isMandate = c.type === "MANDATE_MAX_TOTAL" || c.type === "MANDATE_SHIP_WITHIN";
  const fromMandate = src!.kind === "USER_MANDATE";
  if (!add("commitment_from_right_party", isMandate === fromMandate, isMandate ? (fromMandate ? "shopper's own mandate" : "a mandate must come from the shopper's instruction") : fromMandate ? "a merchant promise cannot come from the shopper's mandate" : "merchant source")) {
    return reject(isMandate ? "A mandate can only come from the shopper's own instruction." : "The shopper's instruction is not a merchant promise.");
  }
  if (isMandate) return validateMandate(c, ctx, checks, add, start, end);

  const needsConfirmation = (summary: string, params: NormalizedParams = { kind: "NONE" }): ValidatedPromise =>
    ({ candidate: c, outcome: "NEEDS_CONFIRMATION", enforceable: false, params, spanStart: start, spanEnd: end, checks, summary });

  // OTHER is retained for the merchant but never enforced.
  if (c.type === "OTHER") {
    add("verifiable_type", false, "no PayPal-witnessable condition");
    return { candidate: c, outcome: "UNVERIFIABLE", enforceable: false, params: { kind: "NONE" }, spanStart: start, spanEnd: end, checks, summary: "Kept cannot verify this from PayPal records, so it is not enforced." };
  }

  const hedge = hasHedge(quote);
  add("unambiguous_language", !hedge, hedge ? `hedge word "${hedge}"` : "no hedging");

  let params: NormalizedParams = { kind: "NONE" };
  let semanticOk = !hedge;
  let semanticDetail = hedge ? `Hedged ("${hedge}") — not an exact promise.` : "";

  if (c.type === "PRICE_AS_QUOTED") {
    const monies = findMoney(quote);
    const oneAmount = add("single_amount", monies.length === 1, `${monies.length} amount(s) in quote`);
    if (!oneAmount) {
      semanticOk = false;
      semanticDetail ||= monies.length === 0 ? "No amount in the quote." : "Several amounts in one statement — ambiguous.";
    } else {
      const m = monies[0]!;
      const cur = m.currency === "USD?" ? (ctx.orderCurrency === "USD" ? "USD" : null) : m.currency;
      const curOk = add("currency_matches_order", cur === ctx.orderCurrency, `quote currency ${m.currency ?? "unknown"} vs order ${ctx.orderCurrency}`);
      let minor: number | null = null;
      try { minor = toMinor(m.amount, ctx.orderCurrency); } catch { minor = null; }
      const derived = minor !== null && (c.params.amount === undefined || safeMinor(c.params.amount, ctx.orderCurrency) === minor);
      add("amount_derived_from_quote", derived, minor === null ? "amount unreadable" : `quote says ${m.amount}; extractor said ${c.params.amount ?? "(none)"}`);
      const total = TOTAL_WORDS.test(quote);
      add("explicit_total_semantics", total, total ? "quote states an order total" : "no explicit total (could be an item price)");
      const excl = hasExclusion(quote);
      add("all_inclusive", !excl, excl ? `excludes something ("${excl}")` : "no exclusions");
      if (!curOk) { semanticOk = false; semanticDetail ||= "Currency does not match the order (or is ambiguous)."; }
      if (!derived) { semanticOk = false; semanticDetail ||= "The amount could not be derived from the quote."; }
      if (!total) { semanticOk = false; semanticDetail ||= "Not explicitly an all-inclusive order total."; }
      if (excl) { semanticOk = false; semanticDetail ||= "Total excludes shipping or tax."; }
      if (minor !== null && cur === ctx.orderCurrency) params = { kind: "PRICE_AS_QUOTED", amountMinor: minor, currency: ctx.orderCurrency, scope: "ORDER_TOTAL" };
    }
  } else if (c.type === "SHIP_BY") {
    const verb = /\b(ship|ships|shipped|shipping|dispatch\w*|send\w* (it )?out|post\w*)\b/i.test(quote);
    add("mentions_shipping", verb, verb ? "quote is about shipping" : "no shipping verb");
    const win = parseShipWindow(quote);
    const date = win ? null : parseByDate(quote);
    if (!verb) { semanticOk = false; semanticDetail ||= "Not a shipping statement."; }
    if (win && "hours" in win) {
      const agrees = c.params.within_hours === undefined || c.params.within_hours === win.hours;
      add("window_derived_from_quote", agrees, `quote → ${win.hours}h; extractor said ${c.params.within_hours ?? "(none)"}`);
      if (!agrees) { semanticOk = false; semanticDetail ||= "Extractor's deadline disagrees with the quote."; }
      params = { kind: "SHIP_BY", withinHours: win.hours };
    } else if (date && "iso" in date) {
      add("date_parsed", true, `deadline ${date.iso} (end of day, latest timezone)`);
      params = { kind: "SHIP_BY", byDate: date.iso };
    } else {
      const why = (win && "ambiguous" in win && win.ambiguous) || (date && "ambiguous" in date && date.ambiguous) || "no deadline in the quote";
      add("deadline_interpretable", false, why);
      semanticOk = false; semanticDetail ||= `Deadline cannot be interpreted reliably: ${why}.`;
    }
  } else if (c.type === "REFUND_BY") {
    const verb = /\brefund/i.test(quote);
    add("mentions_refund", verb, verb ? "quote is about a refund" : "no refund wording");
    const win = parseRefundWindow(quote);
    const trig = refundTrigger(quote);
    add("trigger_explicit", Boolean(trig), trig ? `trigger ${trig}` : "no explicit trigger (return received / cancellation / request)");
    if (!verb) { semanticOk = false; semanticDetail ||= "Not a refund statement."; }
    if (!trig) { semanticOk = false; semanticDetail ||= "Refund condition is ambiguous."; }
    if (win && "days" in win) {
      add("window_derived_from_quote", true, `${win.days} days`);
      if (trig) params = { kind: "REFUND_BY", withinDays: win.days, trigger: trig };
    } else {
      const why = win && "ambiguous" in win ? win.ambiguous : "no refund window";
      add("deadline_interpretable", false, why);
      semanticOk = false; semanticDetail ||= `Refund deadline cannot be interpreted: ${why}.`;
    }
  }

  const confOk = add("confidence_threshold", c.confidence >= ctx.minConfidence, `${c.confidence.toFixed(2)} vs threshold ${ctx.minConfidence}`);
  if (!semanticOk) return needsConfirmation(semanticDetail, params);
  if (!confOk) return needsConfirmation("Extractor confidence below threshold.", params);
  return { candidate: c, outcome: "ENFORCEABLE", enforceable: true, params, spanStart: start, spanEnd: end, checks, summary: "Verified against the source; Kept will check it against PayPal." };
}

function safeMinor(v: string, cur: string): number | null {
  try { return toMinor(v.replace(/[^0-9.]/g, ""), cur); } catch { return null; }
}

/** Validate a batch, then demote conflicting enforceable promises of the same type. */
export function validateAll(cands: Candidate[], ctx: ValidateContext): ValidatedPromise[] {
  const out = cands.map((c) => validateCandidate(c, ctx));
  // de-duplicate identical anchored promises (same type + span)
  const seen = new Set<string>();
  const unique = out.filter((v) => {
    if (v.outcome === "REJECTED") return true;
    const k = `${v.candidate.type}|${v.candidate.source_id}|${v.spanStart}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const type of ["PRICE_AS_QUOTED", "SHIP_BY", "REFUND_BY", "MANDATE_MAX_TOTAL", "MANDATE_SHIP_WITHIN"] as const) {
    const enf = unique.filter((v) => v.enforceable && v.candidate.type === type);
    const distinct = new Set(enf.map((v) => JSON.stringify(v.params)));
    if (distinct.size > 1) {
      for (const v of enf) {
        v.enforceable = false;
        v.outcome = "NEEDS_CONFIRMATION";
        v.checks.push({ check: "no_conflicting_promise", ok: false, detail: `${enf.length} different ${type} promises in this order` });
        v.summary = "Conflicts with another promise of the same kind — the merchant must confirm which one stands.";
      }
    }
  }
  return unique;
}

const MANDATE_HEDGES = ["about", "around", "roughly", "approximately", "or so", "ish", "give or take", "ideally", "preferably", "if possible", "try to"];

/** Shopper → agent mandate: "keep the total under $90", "it must ship within 2 days". */
export function validateMandate(c: Candidate, ctx: ValidateContext, checks: ValidationCheck[], add: (check: string, ok: boolean, detail: string) => boolean, start: number, end: number): ValidatedPromise {
  const q = ` ${c.quote.toLowerCase()} `;
  const hedge = MANDATE_HEDGES.find((h) => q.includes(` ${h} `) || q.includes(` ${h},`));
  add("unambiguous_mandate", !hedge, hedge ? `soft limit ("${hedge}")` : "hard limit");
  let params: NormalizedParams = { kind: "NONE" };
  let ok = !hedge;
  let why = hedge ? `Soft preference ("${hedge}") — not a hard limit for the agent.` : "";
  if (c.type === "MANDATE_MAX_TOTAL") {
    const monies = findMoney(c.quote);
    add("single_amount", monies.length === 1, `${monies.length} amount(s)`);
    const strict = /\b(under|below|less than)\b/.test(q);
    const inclusive = /\b(no more than|at most|max|maximum|up to|not exceed|not to exceed|budget|cap|limit|tops)\b/.test(q);
    add("limit_semantics", strict || inclusive, strict ? "strict upper limit" : inclusive ? "inclusive upper limit" : "no limit wording");
    if (monies.length !== 1) { ok = false; why ||= "The mandate must name exactly one amount."; }
    if (!strict && !inclusive) { ok = false; why ||= "No clear spending limit wording."; }
    const m = monies[0];
    if (m) {
      const cur = m.currency === "USD?" ? (ctx.orderCurrency === "USD" ? "USD" : null) : m.currency;
      if (!add("currency_matches_order", cur === ctx.orderCurrency, `mandate ${m.currency ?? "unknown"} vs order ${ctx.orderCurrency}`)) { ok = false; why ||= "Mandate currency differs from the order."; }
      try {
        const minor = toMinor(m.amount, ctx.orderCurrency);
        if (cur === ctx.orderCurrency) params = { kind: "MANDATE_MAX_TOTAL", maxMinor: minor, currency: ctx.orderCurrency, inclusive: !strict };
      } catch { ok = false; why ||= "Amount unreadable."; }
    }
  } else {
    const win = parseShipWindow(c.quote.replace(/\bmust\b|\bhas to\b|\bneeds? to\b/gi, ""));
    if (win && "hours" in win) { add("window_derived_from_quote", true, `${win.hours}h`); params = { kind: "MANDATE_SHIP_WITHIN", withinHours: win.hours }; }
    else { add("deadline_interpretable", false, win && "ambiguous" in win ? win.ambiguous : "no window"); ok = false; why ||= "Shipping limit cannot be interpreted."; }
  }
  const confOk = add("confidence_threshold", c.confidence >= ctx.minConfidence, `${c.confidence.toFixed(2)} vs ${ctx.minConfidence}`);
  const base = { candidate: c, params, spanStart: start, spanEnd: end, checks };
  if (!ok || !confOk) return { ...base, outcome: "NEEDS_CONFIRMATION", enforceable: false, summary: why || "Extractor confidence below threshold." };
  return { ...base, outcome: "ENFORCEABLE", enforceable: true, summary: "The shopper's hard limit for their agent; Kept checks the PayPal result against it." };
}
