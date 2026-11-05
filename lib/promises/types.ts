import { z } from "zod";

/** What an extractor (LLM or rules) proposes. Untrusted until validated. */
export const CandidateSchema = z.object({
  type: z.enum(["PRICE_AS_QUOTED", "SHIP_BY", "REFUND_BY", "OTHER"]),
  params: z.object({
    amount: z.string().optional().describe("Decimal amount exactly as written, e.g. '84.00' (PRICE_AS_QUOTED)"),
    currency: z.string().optional().describe("ISO currency the quote refers to, e.g. 'USD'"),
    scope: z.enum(["ORDER_TOTAL", "ITEM_PRICE", "UNKNOWN"]).optional(),
    within_hours: z.number().optional(),
    by_date: z.string().optional(),
    within_days: z.number().optional(),
    trigger: z.enum(["RETURN_RECEIVED", "CANCELLATION", "REQUEST", "UNKNOWN"]).optional(),
  }),
  quote: z.string().describe("Verbatim substring of the source text"),
  source_id: z.string(),
  span_start: z.number().int(),
  span_end: z.number().int(),
  confidence: z.number().min(0).max(1),
  verifiable: z.boolean(),
  reason: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const ExtractionSchema = z.object({ promises: z.array(CandidateSchema) });

export type SourceDoc = { id: string; kind: string; title: string; text: string; merchantId: string; orderId: string | null };

export type ValidationCheck = { check: string; ok: boolean; detail: string };

/** Normalised, deterministic parameters Kept enforces. */
export type NormalizedParams =
  | { kind: "PRICE_AS_QUOTED"; amountMinor: number; currency: string; scope: "ORDER_TOTAL" }
  | { kind: "SHIP_BY"; withinHours: number }
  | { kind: "SHIP_BY"; byDate: string }
  | { kind: "REFUND_BY"; withinDays: number; trigger: "RETURN_RECEIVED" | "CANCELLATION" | "REQUEST" }
  | { kind: "NONE" };

export type ValidatedPromise = {
  candidate: Candidate;
  /** REJECTED = not anchored to a real source (fabricated / misattributed). Never stored as a commitment. */
  outcome: "ENFORCEABLE" | "NEEDS_CONFIRMATION" | "UNVERIFIABLE" | "REJECTED";
  enforceable: boolean;
  params: NormalizedParams;
  spanStart: number;
  spanEnd: number;
  checks: ValidationCheck[];
  summary: string;
};
