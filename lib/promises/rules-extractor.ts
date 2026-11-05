/**
 * Deterministic baseline extractor. Used when no AI provider is configured (and
 * as a cross-check). It proposes candidates only; the validator decides.
 * It is intentionally simple and is labelled "rules" everywhere it is shown.
 */
import { findMoney, parseRefundWindow, parseShipWindow } from "./validator";
import type { Candidate, SourceDoc } from "./types";

const PROMISE_ISH = /\b(we('| wi)ll (sort|make|take care|look after|fix)|guarantee|we promise|don't worry|make it right|no problem|we've got you)\b/i;

/** Split a source into sentence-sized spans with absolute offsets (assistant lines only for chats). */
function sentences(src: SourceDoc): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let lineStart = 0;
  for (const line of src.text.split("\n")) {
    let body = line;
    let bodyStart = lineStart;
    if (src.kind === "CHAT_TRANSCRIPT") {
      const h = line.match(/^(ASSISTANT|CUSTOMER) \[[^\]]*\]: /);
      if (!h || h[1] !== "ASSISTANT") { lineStart += line.length + 1; continue; }
      body = line.slice(h[0].length);
      bodyStart = lineStart + h[0].length;
    }
    // sentence boundary = . ! ? followed by whitespace or end (so "$84.00" stays whole)
    let segStart = 0;
    const push = (from: number, to: number) => {
      const raw = body.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (text) out.push({ text, start: bodyStart + from + lead });
    };
    for (let i = 0; i < body.length; i++) {
      if (/[.!?]/.test(body[i]!) && (i + 1 === body.length || /\s/.test(body[i + 1]!))) {
        push(segStart, i + 1);
        segStart = i + 1;
      }
    }
    push(segStart, body.length);
    lineStart += line.length + 1;
  }
  return out;
}

export function extractWithRules(sources: SourceDoc[], orderCurrency: string): Candidate[] {
  const out: Candidate[] = [];
  for (const src of sources) {
    if (src.kind === "PRODUCT_PAGE") continue; // catalogue copy is not a per-order promise
    for (const s of sentences(src)) {
      const base = { quote: s.text, source_id: src.id, span_start: s.start, span_end: s.start + s.text.length };
      const lower = s.text.toLowerCase();
      const monies = findMoney(s.text);
      if (monies.length > 0 && src.kind === "CHAT_TRANSCRIPT") {
        const isTotal = /\btotal|all[- ]in|comes to\b/.test(lower);
        out.push({
          ...base, type: "PRICE_AS_QUOTED",
          params: { amount: monies[0]!.amount, currency: orderCurrency, scope: isTotal ? "ORDER_TOTAL" : "ITEM_PRICE" },
          confidence: isTotal ? 0.9 : 0.6, verifiable: isTotal,
          reason: isTotal ? "assistant stated an order total" : "assistant mentioned a price",
        });
        continue;
      }
      if (/\b(ship|dispatch)/.test(lower)) {
        const w = parseShipWindow(s.text);
        if (w) {
          out.push({ ...base, type: "SHIP_BY", params: "hours" in w ? { within_hours: w.hours } : {}, confidence: "hours" in w ? 0.9 : 0.5, verifiable: "hours" in w, reason: "shipping timeframe" });
          continue;
        }
        if (/\bby\s+/.test(lower)) {
          out.push({ ...base, type: "SHIP_BY", params: {}, confidence: 0.7, verifiable: true, reason: "shipping date" });
          continue;
        }
      }
      if (/\brefund/.test(lower)) {
        const w = parseRefundWindow(s.text);
        if (w) {
          out.push({ ...base, type: "REFUND_BY", params: "days" in w ? { within_days: w.days } : {}, confidence: 0.85, verifiable: true, reason: "refund timeframe" });
          continue;
        }
      }
      if (PROMISE_ISH.test(s.text) && src.kind === "CHAT_TRANSCRIPT") {
        out.push({ ...base, type: "OTHER", params: {}, confidence: 0.8, verifiable: false, reason: "general reassurance with no checkable condition" });
      }
    }
  }
  return out;
}
