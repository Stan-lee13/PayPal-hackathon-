/**
 * Rows for the merchant's Promise analytics (AG Studio). Computed only from Kept's own
 * records — commitments, orders, remedies and the audit trail — never sampled or invented.
 * Money is in major units here because it is for display only; Kept's own arithmetic
 * everywhere else stays in integer minor units.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog, commitments, orders, remedies, sources } from "../db/schema";

const TYPE: Record<string, string> = { PRICE_AS_QUOTED: "Price as quoted", SHIP_BY: "Ship by", REFUND_BY: "Refund by", OTHER: "Other", MANDATE_MAX_TOTAL: "Shopper limit · total", MANDATE_SHIP_WITHIN: "Shopper limit · shipping" };
const SOURCE: Record<string, string> = { CHAT_TRANSCRIPT: "AI sales chat", REFUND_POLICY: "Refund policy", SHIPPING_POLICY: "Shipping policy", PRODUCT_PAGE: "Product page", USER_MANDATE: "Shopper's mandate" };
const ATTR: Record<string, string> = { MERCHANT: "Merchant", AGENT: "Shopper's agent", UNKNOWN: "Unclear" };
const major = (minor: number | null | undefined) => (typeof minor === "number" ? minor / 100 : 0);

export type AnalyticsData = {
  asOf: string;
  promises: Array<{ id: string; orderId: string; type: string; outcome: string; source: string; attribution: string; one: number; enforced: number; resolved: number; kept: number; good: number; brokenOpen: number; madeGood: number; outstanding: number }>;
  orders: Array<{ id: string; createdAt: string; customer: string; paypalStatus: string; captured: number; refunded: number; honoredAtCheckout: number; warnedAtCheckout: number }>;
  remedies: Array<{ id: string; orderId: string; kind: string; state: string; proposedBy: string; amount: number; approved: number }>;
};

function outcome(state: string, madeGood: boolean) {
  if (state === "BROKEN") return madeGood ? "Broken · made good" : "Broken";
  return ({ KEPT: "Kept", AT_RISK: "At risk", PENDING: "Watching", NEEDS_CONFIRMATION: "Needs confirmation", UNVERIFIABLE: "Unverifiable", WAIVED: "Waived" } as Record<string, string>)[state] ?? state;
}

export async function promiseAnalytics(merchantId: string): Promise<AnalyticsData> {
  const db = getDb();
  const ords = await db.select().from(orders).where(eq(orders.merchantId, merchantId));
  const ids = [...ords.map((o) => o.id), "__none__"];
  const [cms, rems, guards] = await Promise.all([
    db.select().from(commitments).where(inArray(commitments.orderId, ids)),
    db.select().from(remedies).where(inArray(remedies.orderId, ids)),
    db.select().from(auditLog).where(and(eq(auditLog.merchantId, merchantId), inArray(auditLog.action, ["checkout_guard.honored", "checkout_guard.warned"]))),
  ]);
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
        one: 1, enforced, resolved: c.state === "KEPT" || c.state === "BROKEN" ? 1 : 0, kept: c.state === "KEPT" ? 1 : 0, good: c.state === "KEPT" || madeGood ? 1 : 0, brokenOpen: c.state === "BROKEN" && !madeGood ? 1 : 0, madeGood: madeGood ? 1 : 0,
        outstanding: major(typeof ev.outstandingMinor === "number" ? ev.outstandingMinor : 0),
      };
    }),
    orders: ords.map((o) => {
      const g = guards.filter((a) => a.orderId === o.id);
      const honored = g.find((a) => a.action === "checkout_guard.honored");
      return {
        id: o.id, createdAt: o.createdAt.toISOString().slice(0, 10), customer: o.buyerFirstName ?? "—", paypalStatus: o.captureStatus ?? o.status,
        captured: major(o.captureAmountMinor), refunded: major(o.refundedMinor),
        honoredAtCheckout: honored ? major(o.itemTotalMinor + o.shippingMinor + o.taxMinor - o.requestedTotalMinor) : 0,
        warnedAtCheckout: g.some((a) => a.action === "checkout_guard.warned") ? 1 : 0,
      };
    }),
    remedies: rems.filter((r) => r.state !== "SUPERSEDED").map((r) => ({
      id: r.id, orderId: r.orderId, kind: r.kind.replace(/_/g, " ").toLowerCase(), state: r.state, proposedBy: r.proposedBy === "ai" ? "AI (Claude)" : "Rules",
      amount: major(r.amountMinor), approved: r.decidedAt && r.state !== "REJECTED" ? 1 : 0,
    })),
  };
}
