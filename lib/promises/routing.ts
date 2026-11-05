/**
 * Rules first, the model only where it earns its place.
 *
 * The deterministic rules extractor settles plain promises ("Your total is $84.00.").
 * Claude is asked only when a merchant-side sentence looks like a promise — it mentions money,
 * shipping, a refund or a deadline — but the rules produced nothing for it: compound sentences,
 * "posted" instead of "shipped", Nigerian Pidgin, a second amount in the sentence
 * (see tests/fixtures/ai-eval.ts for why these are exactly the rules' blind spots).
 */
import type { Candidate, SourceDoc } from "./types";

const SIGNAL = /(\$|£|€|₦|\bUSD\b|\bNGN\b|\b(ship|ships|shipped|shipping|send|sent|post|posted|dispatch\w*|deliver\w*|refund\w*|money back|total|within|by \d)\b)/i;

/** Merchant-side sentences that look like commitments, with their character offsets. */
export function signalSentences(src: SourceDoc): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let lineStart = 0;
  for (const line of src.text.split("\n")) {
    let body = line; let offset = lineStart;
    if (src.kind === "CHAT_TRANSCRIPT") {
      const h = line.match(/^(ASSISTANT|CUSTOMER|BUYER_AGENT) \[[^\]]*\]: /);
      if (!h || h[1] !== "ASSISTANT") { lineStart += line.length + 1; continue; }
      body = line.slice(h[0].length); offset += h[0].length;
    }
    if (src.kind === "USER_MANDATE" || src.kind === "PRODUCT_PAGE") { lineStart += line.length + 1; continue; }
    // Same boundary rule as the rules extractor: punctuation ends a sentence only before whitespace
    // or the end of the line, so "$9.33" stays inside its sentence.
    let from = 0;
    const push = (to: number) => {
      const raw = body.slice(from, to); const t = raw.trim();
      if (t && SIGNAL.test(t)) out.push({ text: t, start: offset + from + (raw.length - raw.trimStart().length) });
    };
    for (let i = 0; i < body.length; i++) {
      if (/[.!?]/.test(body[i]!) && (i + 1 === body.length || /\s/.test(body[i + 1]!))) { push(i + 1); from = i + 1; }
    }
    push(body.length);
    lineStart += line.length + 1;
  }
  return out;
}

/** Does any promise-like sentence lack a rules candidate inside it? Returns the uncovered sentences. */
export function uncoveredByRules(docs: SourceDoc[], rules: Candidate[]): Array<{ sourceId: string; text: string }> {
  const gaps: Array<{ sourceId: string; text: string }> = [];
  for (const d of docs) {
    const mine = rules.filter((c) => c.source_id === d.id);
    for (const s of signalSentences(d)) {
      const end = s.start + s.text.length;
      const inside = mine.filter((c) => c.span_start >= s.start && c.span_end <= end);
      // a sentence with two promise words (price AND shipping) needs two candidates
      const kinds = [/\$|£|€|₦|total/i.test(s.text), /ship|send|sent|post|dispatch|deliver/i.test(s.text), /refund|money back/i.test(s.text)].filter(Boolean).length;
      if (inside.length < Math.max(1, kinds)) gaps.push({ sourceId: d.id, text: s.text });
    }
  }
  return gaps;
}
