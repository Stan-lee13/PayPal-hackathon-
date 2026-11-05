/**
 * Promise ledger orchestration: extraction → validation → storage → evaluation.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { commitments, merchants, orders, refunds, remedies, sources, trackers, type Commitment, type CommitmentState, type Order } from "../db/schema";
import { newId } from "../ids";
import { aiConfigured } from "../ai/client";
import { extractWithLlm } from "../promises/llm-extractor";
import { extractWithRules } from "../promises/rules-extractor";
import { validateAll } from "../promises/validator";
import type { NormalizedParams, SourceDoc } from "../promises/types";
import { evaluate, type CaptureEvidence } from "../ledger/evaluator";
import { effectiveNow } from "../clock";
import { formatMoney } from "../money";
import { audit } from "./audit";

/** Which sources can carry per-order promises (catalogue/promo/shipping policy copy are context only). */
const PROMISE_SOURCE_KINDS = ["CHAT_TRANSCRIPT", "REFUND_POLICY"] as const;

function toParams(p: NormalizedParams): Record<string, unknown> {
  const { kind: _kind, ...rest } = p as NormalizedParams & Record<string, unknown>;
  return rest;
}

/** Extract + validate + store commitments for an order. Idempotent. */
export async function runExtraction(orderId: string): Promise<{ stored: number; rejected: number; extractor: "llm" | "rules" }> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new Error("order not found");
  if (order.extractionStatus === "COMPLETED") return { stored: 0, rejected: 0, extractor: "rules" };
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }))!;
  const srcRows = await db.select().from(sources).where(and(
    eq(sources.merchantId, order.merchantId),
    or(eq(sources.orderId, order.id), isNull(sources.orderId)),
    inArray(sources.kind, [...PROMISE_SOURCE_KINDS]),
  ));
  const docs: SourceDoc[] = srcRows.map((s) => ({ id: s.id, kind: s.kind, title: s.title, text: s.text, merchantId: s.merchantId, orderId: s.orderId }));

  let extractor: "llm" | "rules" = "rules";
  let candidates = extractWithRules(docs, order.currency);
  let note = aiConfigured() ? null : "AI provider not configured — rule-based extractor used.";
  if (aiConfigured()) {
    try {
      candidates = await extractWithLlm(docs, { orderCurrency: order.currency, orderCreatedAt: order.createdAt.toISOString(), orderSummary: `${order.lines.length} line(s)` });
      extractor = "llm";
    } catch (e) {
      note = `AI extraction failed (${String(e).slice(0, 120)}) — rule-based extractor used.`;
    }
  }
  const validated = validateAll(candidates, { sources: docs, merchantId: order.merchantId, orderId: order.id, orderCurrency: order.currency, minConfidence: merchant.policy.minConfidence });
  const kept = validated.filter((v) => v.outcome !== "REJECTED");
  const rejected = validated.filter((v) => v.outcome === "REJECTED");

  await db.transaction(async (tx) => {
    const fresh = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (fresh?.extractionStatus === "COMPLETED") return;
    for (const v of kept) {
      const state: CommitmentState = v.outcome === "ENFORCEABLE" ? "PENDING" : v.outcome === "UNVERIFIABLE" ? "UNVERIFIABLE" : "NEEDS_CONFIRMATION";
      await tx.insert(commitments).values({
        id: newId("cm"),
        orderId: order.id,
        merchantId: order.merchantId,
        type: v.candidate.type,
        params: v.params.kind === "NONE" ? { extractorParams: v.candidate.params } : toParams(v.params),
        quote: v.candidate.quote,
        sourceId: v.candidate.source_id,
        spanStart: v.spanStart,
        spanEnd: v.spanEnd,
        confidence: v.candidate.confidence,
        enforceable: v.enforceable,
        validation: v.checks,
        extractor,
        state,
        stateReason: v.summary,
      });
    }
    for (const r of rejected) {
      await audit(tx, { merchantId: order.merchantId, orderId: order.id, actor: extractor === "llm" ? "ai" : "system", action: "promise.candidate_rejected", outcome: "REJECTED",
        detail: { quote: r.candidate.quote.slice(0, 200), type: r.candidate.type, reason: r.summary, checks: r.checks } });
    }
    await tx.update(orders).set({ extractionStatus: "COMPLETED", extractionNote: note, updatedAt: new Date() }).where(eq(orders.id, order.id));
    await audit(tx, { merchantId: order.merchantId, orderId: order.id, actor: extractor === "llm" ? "ai" : "system", action: "promises.extracted", outcome: "OK",
      detail: { extractor, enforceable: kept.filter((k) => k.enforceable).length, needsConfirmation: kept.filter((k) => k.outcome === "NEEDS_CONFIRMATION").length, unverifiable: kept.filter((k) => k.outcome === "UNVERIFIABLE").length, rejected: rejected.length, note } });
  });
  return { stored: kept.length, rejected: rejected.length, extractor };
}

export function captureEvidence(order: Order): CaptureEvidence | null {
  if (!order.captureStatus || order.captureAmountMinor === null || !order.captureCurrency || !order.capturedAt) return null;
  return { status: order.captureStatus, amountMinor: order.captureAmountMinor, currency: order.captureCurrency, capturedAt: order.capturedAt, verified: Boolean(order.captureVerifiedAt) };
}

/**
 * Re-evaluate every commitment on an order against current PayPal evidence.
 * Writes an audit entry for each state change. Returns commitments needing a remedy.
 */
export async function evaluateOrder(orderId: string): Promise<Commitment[]> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new Error("order not found");
  const merchant = (await db.query.merchants.findFirst({ where: eq(merchants.id, order.merchantId) }))!;
  const [cms, refs, trks] = await Promise.all([
    db.select().from(commitments).where(eq(commitments.orderId, orderId)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)),
    db.select().from(trackers).where(eq(trackers.orderId, orderId)),
  ]);
  const now = effectiveNow(merchant.demoClockOffsetMs);
  const needsRemedy: Commitment[] = [];
  for (const c of cms) {
    const r = evaluate({
      type: c.type, params: c.params, enforceable: c.enforceable, currentState: c.state,
      capture: captureEvidence(order),
      refunds: refs.map((x) => ({ refundId: x.paypalRefundId, amountMinor: x.amountMinor, currency: x.currency, status: x.status, createdAt: x.paypalCreatedAt, verifiedAt: x.verifiedAt })),
      trackers: trks.map((t) => ({ trackingNumber: t.trackingNumber, recordedAt: t.recordedAt })),
      now,
      policy: merchant.policy,
    });
    const changed = r.state !== c.state || r.reason !== c.stateReason || JSON.stringify(r.evaluation) !== JSON.stringify(c.evaluation ?? {});
    if (changed) {
      await db.update(commitments).set({ state: r.state, stateReason: r.reason, dueAt: r.dueAt, evaluation: r.evaluation, updatedAt: new Date() }).where(eq(commitments.id, c.id));
      if (r.state !== c.state) {
        await audit(db, { merchantId: order.merchantId, orderId, actor: "system", action: "commitment.state_changed", ref: c.id, outcome: r.state === "BROKEN" ? "FAILED" : r.state === "KEPT" ? "OK" : "INFO",
          detail: { type: c.type, from: c.state, to: r.state, reason: r.reason, discrepancy: r.evaluation.discrepancyMinor !== undefined && order.captureCurrency ? formatMoney(Number(r.evaluation.discrepancyMinor), order.captureCurrency) : undefined } });
      }
    }
    const outstanding = Number(r.evaluation.outstandingMinor ?? 0);
    const needs = (r.state === "BROKEN" && (c.type !== "PRICE_AS_QUOTED" || outstanding > 0)) || r.state === "AT_RISK";
    if (needs) needsRemedy.push({ ...c, state: r.state, stateReason: r.reason, evaluation: r.evaluation, dueAt: r.dueAt });
  }
  return needsRemedy;
}

/** Commitments with a live (non-terminal) remedy. */
export async function activeRemedyFor(commitmentId: string) {
  const db = getDb();
  return db.query.remedies.findFirst({ where: and(eq(remedies.commitmentId, commitmentId), inArray(remedies.state, ["PROPOSED", "APPROVED", "EXECUTING", "PENDING"])) });
}
