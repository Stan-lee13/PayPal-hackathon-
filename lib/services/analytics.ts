/**
 * Rows for the merchant's Promise analytics (AG Studio). Computed only from Kept's own
 * records — commitments, orders, remedies and the audit trail — never sampled or invented.
 * Money is in major units here because it is for display only; Kept's own arithmetic
 * everywhere else stays in integer minor units.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import fs from "node:fs";
import path from "node:path";
import { auditLog, commitments, orders, paypalEvents, preflights, refunds, remedies, sources } from "../db/schema";

const TYPE: Record<string, string> = { PRICE_AS_QUOTED: "Price as quoted", SHIP_BY: "Ship by", REFUND_BY: "Refund by", OTHER: "Other", MANDATE_MAX_TOTAL: "Shopper limit · total", MANDATE_SHIP_WITHIN: "Shopper limit · shipping" };
const SOURCE: Record<string, string> = { CHAT_TRANSCRIPT: "AI sales chat", REFUND_POLICY: "Refund policy", SHIPPING_POLICY: "Shipping policy", PRODUCT_PAGE: "Product page", USER_MANDATE: "Shopper's mandate" };
const ATTR: Record<string, string> = { MERCHANT: "Merchant", AGENT: "Shopper's agent", UNKNOWN: "Unclear" };
const major = (minor: number | null | undefined) => (typeof minor === "number" ? minor / 100 : 0);

export type AnalyticsData = {
  asOf: string;
  promises: Array<{ id: string; orderId: string; type: string; outcome: string; source: string; attribution: string; extractor: string; currency: string; one: number; enforced: number; resolved: number; kept: number; good: number; brokenOpen: number; madeGood: number; atRisk: number; unverifiable: number; needsConfirmation: number; outstanding: number }>;
  orders: Array<{ id: string; createdAt: string; customer: string; currency: string; channel: string; paypalStatus: string; captured: number; refunded: number; honoredAtCheckout: number; warnedAtCheckout: number; extractionFailed: number }>;
  remedies: Array<{ id: string; orderId: string; kind: string; state: string; proposedBy: string; currency: string; amount: number; one: number; approved: number }>;
  preflights: Array<{ id: string; orderId: string; verdict: string; outcome: string; currency: string; one: number; enforced: number; ready: number; blocked: number; recordedMismatch: number; held: number; failed: number; mismatch: number; stoppedBeforeCapture: number }>;
  refunds: Array<{ id: string; orderId: string; status: string; currency: string; amount: number; one: number; completed: number; pending: number; failed: number }>;
  events: Array<{ id: string; orderId: string | null; type: string; verification: string; processing: string; receivedAt: string; one: number; failed: number }>;
  aiEval: Array<{ id: string; metric: string; value: number; of: number; result: string; ranAt: string }>;
};

function outcome(state: string, madeGood: boolean) {
  if (state === "BROKEN") return madeGood ? "Broken · made good" : "Broken";
  return ({ KEPT: "Kept", AT_RISK: "At risk", PENDING: "Watching", NEEDS_CONFIRMATION: "Needs confirmation", UNVERIFIABLE: "Unverifiable", WAIVED: "Waived" } as Record<string, string>)[state] ?? state;
}

export async function promiseAnalytics(merchantId: string): Promise<AnalyticsData> {
  const db = getDb();
  const ords = await db.select().from(orders).where(eq(orders.merchantId, merchantId));
  const ids = [...ords.map((o) => o.id), "__none__"];
  const [cms, rems, guards, pfs, refs, evs] = await Promise.all([
    db.select().from(commitments).where(inArray(commitments.orderId, ids)),
    db.select().from(remedies).where(inArray(remedies.orderId, ids)),
    db.select().from(auditLog).where(and(eq(auditLog.merchantId, merchantId), inArray(auditLog.action, ["checkout_guard.honored", "checkout_guard.warned"]))),
    db.select().from(preflights).where(eq(preflights.merchantId, merchantId)),
    db.select().from(refunds).where(inArray(refunds.orderId, ids)),
    db.select().from(paypalEvents).where(inArray(paypalEvents.orderId, ids)),
  ]);
  const currencyOf = new Map(ords.map((o) => [o.id, o.captureCurrency ?? o.currency]));
  const srcs = await db.select({ id: sources.id, kind: sources.kind }).from(sources).where(inArray(sources.id, [...new Set(cms.map((c) => c.sourceId)), "__none__"]));

  return {
    asOf: new Date().toISOString(),
    promises: cms.map((c) => {
      const ev = (c.evaluation ?? {}) as Record<string, unknown>;
      const madeGood = ev.madeGood === true;
      const enforced = ["UNVERIFIABLE", "WAIVED", "NEEDS_CONFIRMATION"].includes(c.state) ? 0 : 1;
      const kind = srcs.find((s) => s.id === c.sourceId)?.kind;
      return {
        id: c.id, orderId: c.orderId, type: TYPE[c.type] ?? c.type, outcome: outcome(c.state, madeGood), source: kind ? SOURCE[kind] ?? kind : "Unknown",
        attribution: typeof ev.attribution === "string" ? ATTR[ev.attribution] ?? "—" : "—",
        extractor: c.extractor === "llm" ? "Claude" : "Rules", currency: currencyOf.get(c.orderId) ?? "USD",
        atRisk: c.state === "AT_RISK" ? 1 : 0, unverifiable: c.state === "UNVERIFIABLE" ? 1 : 0, needsConfirmation: c.state === "NEEDS_CONFIRMATION" ? 1 : 0,
        one: 1, enforced, resolved: c.state === "KEPT" || c.state === "BROKEN" ? 1 : 0, kept: c.state === "KEPT" ? 1 : 0, good: c.state === "KEPT" || madeGood ? 1 : 0, brokenOpen: c.state === "BROKEN" && !madeGood ? 1 : 0, madeGood: madeGood ? 1 : 0,
        outstanding: major(typeof ev.outstandingMinor === "number" ? ev.outstandingMinor : 0),
      };
    }),
    orders: ords.map((o) => {
      const g = guards.filter((a) => a.orderId === o.id);
      const honored = g.find((a) => a.action === "checkout_guard.honored");
      return {
        id: o.id, createdAt: o.createdAt.toISOString().slice(0, 10), customer: o.buyerFirstName ?? "—", currency: o.captureCurrency ?? o.currency,
        channel: o.checkoutChannel === "EXTERNAL" ? "Outside Kept's checkout" : "Kept protected checkout", paypalStatus: o.captureStatus ?? o.status, extractionFailed: o.extractionStatus === "FAILED" ? 1 : 0,
        captured: major(o.captureAmountMinor), refunded: major(o.refundedMinor),
        honoredAtCheckout: honored ? major(o.itemTotalMinor + o.shippingMinor + o.taxMinor - o.requestedTotalMinor) : 0,
        warnedAtCheckout: g.some((a) => a.action === "checkout_guard.warned") ? 1 : 0,
      };
    }),
    remedies: rems.filter((r) => r.state !== "SUPERSEDED").map((r) => ({
      id: r.id, orderId: r.orderId, kind: r.kind.replace(/_/g, " ").toLowerCase(), state: r.state, proposedBy: r.proposedBy === "ai" ? "AI (Claude)" : "Rules",
      currency: r.currency ?? currencyOf.get(r.orderId) ?? "USD", amount: major(r.amountMinor), one: 1, approved: r.decidedAt && r.state !== "REJECTED" ? 1 : 0,
    })),
    preflights: pfs.map((p) => {
      const blocked = p.verdict === "BLOCKED_MISMATCH" ? 1 : 0;
      return {
        id: p.id, orderId: p.orderId, verdict: p.verdict, currency: p.orderCurrency ?? currencyOf.get(p.orderId) ?? "USD", one: 1, enforced: p.enforced ? 1 : 0,
        outcome: !p.enforced ? "Recorded only (outside Kept's checkout or monitor-only)" : ({ READY_TO_CAPTURE: "Verified, ready to capture", BLOCKED_MISMATCH: "Blocked before capture", NEEDS_CONFIRMATION: "Held for confirmation", PRECHECK_FAILED: "Check failed — not captured" } as Record<string, string>)[p.verdict]!,
        // "blocked" counts only Kept's protected checkout; a mismatch on an external capture was recorded, not stopped
        ready: p.verdict === "READY_TO_CAPTURE" ? 1 : 0, blocked: p.enforced ? blocked : 0, recordedMismatch: p.enforced ? 0 : blocked, held: p.verdict === "NEEDS_CONFIRMATION" ? 1 : 0, failed: p.verdict === "PRECHECK_FAILED" ? 1 : 0,
        mismatch: blocked && p.diffMinor ? major(Math.abs(p.diffMinor)) : 0,
        // value stopped: the over-charge on a protected checkout that Kept refused to capture
        stoppedBeforeCapture: p.enforced && blocked && p.diffMinor && p.diffMinor > 0 ? major(p.diffMinor) : 0,
      };
    }),
    refunds: refs.map((r) => ({ id: r.paypalRefundId, orderId: r.orderId, status: r.status, currency: r.currency, amount: major(r.amountMinor), one: 1,
      completed: r.status === "COMPLETED" ? major(r.amountMinor) : 0, pending: r.status === "PENDING" ? 1 : 0, failed: r.status === "FAILED" || r.status === "CANCELLED" ? 1 : 0 })),
    events: evs.map((e) => ({ id: e.id, orderId: e.orderId, type: e.eventType, verification: e.verification === "SIMULATED" ? "Simulated (unsigned)" : "Signature verified", processing: e.processingStatus,
      receivedAt: e.receivedAt.toISOString().slice(0, 10), one: 1, failed: e.processingStatus === "FAILED" ? 1 : 0 })),
    aiEval: readAiEval(),
  };
}

/** The last AI-vs-rules evaluation run (docs/evidence/ai-eval-results.json), if present. */
function readAiEval(): AnalyticsData["aiEval"] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/evidence/ai-eval-results.json"), "utf8")) as { summary: { ranAt: string; validatorCeiling: { found: number; expected: number }; rules: { beyondRules: { found: number; expected: number }; controls: { found: number; expected: number }; falseEnforceableOnTraps: number }; claudeResult: null | { beyondRules: { found: number; expected: number }; falseEnforceableOnTraps: number } } };
    const s = j.summary; const at = s.ranAt.slice(0, 10);
    const rows: Array<Omit<AnalyticsData["aiEval"][number], "result">> = [
      { id: "rules-beyond", metric: "Rules: harder promises found", value: s.rules.beyondRules.found, of: s.rules.beyondRules.expected, ranAt: at },
      { id: "rules-controls", metric: "Rules: plain promises found", value: s.rules.controls.found, of: s.rules.controls.expected, ranAt: at },
      { id: "rules-false", metric: "Rules: false promises on traps", value: s.rules.falseEnforceableOnTraps, of: 0, ranAt: at },
      { id: "ceiling", metric: "Validator ceiling (perfect extraction)", value: s.validatorCeiling.found, of: s.validatorCeiling.expected, ranAt: at },
    ];
    if (s.claudeResult) rows.push({ id: "claude-beyond", metric: "Claude: harder promises found", value: s.claudeResult.beyondRules.found, of: s.rules.beyondRules.expected, ranAt: at },
      { id: "claude-false", metric: "Claude: false promises on traps", value: s.claudeResult.falseEnforceableOnTraps, of: 0, ranAt: at });
    return rows.map((r) => ({ ...r, result: r.id.endsWith("false") ? String(r.value) : `${r.value} of ${r.of}` }));
  } catch { return []; }
}
