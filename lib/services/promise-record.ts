/**
 * A merchant's promise record: how often the business kept what it (or its AI assistant,
 * or its policies) promised, judged by deterministic code against PayPal's own records.
 * Public and read-only, for shoppers and their AI agents to check before buying.
 *
 * It is computed from aggregates only — no customer, order or chat data leaves Kept —
 * and it is honest about its limits: small samples are flagged, simulated data is labelled,
 * and every order's audit chain is re-verified when the record is produced.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog, commitments, merchants, orders } from "../db/schema";
import { verifyChain, type ChainEntry } from "../ledger/chain";
import { paypalMode } from "../paypal/client";

const MERCHANT_PROMISE_TYPES = ["PRICE_AS_QUOTED", "SHIP_BY", "REFUND_BY"] as const;
const LABEL: Record<string, string> = { PRICE_AS_QUOTED: "price as quoted", SHIP_BY: "ships on time", REFUND_BY: "refunds on time" };
export const SMALL_SAMPLE = 20;

export type PromiseRecord = {
  format: "kept-promise-record/1";
  merchant: { slug: string; name: string };
  asOf: string;
  data: "SIMULATED" | "PAYPAL_SANDBOX" | "PAYPAL_LIVE";
  /** Merchant promises that have resolved (kept, or broken) — promises still being watched are excluded. */
  resolved: number;
  keptAsPromised: number;
  brokenThenMadeGood: number;
  brokenStillOpen: number;
  watching: number;
  keptAsPromisedRate: number | null;
  keptOrMadeGoodRate: number | null;
  byType: Array<{ type: string; label: string; resolved: number; keptAsPromised: number; brokenThenMadeGood: number; brokenStillOpen: number }>;
  orders: number;
  auditChains: { verified: number; intact: boolean };
  caveats: string[];
  method: string;
};

const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

export async function promiseRecord(slug: string): Promise<PromiseRecord | null> {
  const db = getDb();
  const m = await db.query.merchants.findFirst({ where: eq(merchants.slug, slug) });
  if (!m) return null;
  const [cms, ords, audits] = await Promise.all([
    db.select({ type: commitments.type, state: commitments.state, evaluation: commitments.evaluation }).from(commitments)
      .where(and(eq(commitments.merchantId, m.id), inArray(commitments.type, [...MERCHANT_PROMISE_TYPES]))),
    db.select({ id: orders.id }).from(orders).where(and(eq(orders.merchantId, m.id), isNotNull(orders.paypalCaptureId))),
    db.select().from(auditLog).where(and(eq(auditLog.merchantId, m.id), isNotNull(auditLog.orderId), isNotNull(auditLog.hash))),
  ]);

  const tally = (rows: typeof cms) => {
    const kept = rows.filter((c) => c.state === "KEPT").length;
    const broken = rows.filter((c) => c.state === "BROKEN");
    const madeGood = broken.filter((c) => (c.evaluation as Record<string, unknown> | null)?.madeGood === true).length;
    return { resolved: kept + broken.length, keptAsPromised: kept, brokenThenMadeGood: madeGood, brokenStillOpen: broken.length - madeGood };
  };
  const all = tally(cms);

  // Re-verify every order's chain: the record is only as trustworthy as the history behind it.
  const byOrder = new Map<string, ChainEntry[]>();
  for (const r of audits) {
    const list = byOrder.get(r.orderId!) ?? [];
    list.push({ seq: r.seq!, merchantId: r.merchantId, orderId: r.orderId, actor: r.actor, action: r.action, ref: r.ref, outcome: r.outcome, detail: r.detail, createdAt: r.createdAt.toISOString(), prevHash: r.prevHash!, hash: r.hash! });
    byOrder.set(r.orderId!, list);
  }
  const verdicts = [...byOrder.entries()].map(([orderId, entries]) => verifyChain(m.id, orderId, entries));

  const mode = paypalMode();
  const caveats: string[] = [];
  if (mode === "simulated") caveats.push("SIMULATED: these outcomes come from Kept's local PayPal emulator, not from real PayPal transactions.");
  if (all.resolved < SMALL_SAMPLE) caveats.push(`Small sample: ${all.resolved} resolved promise${all.resolved === 1 ? "" : "s"}. Treat the rates as indicative only.`);
  caveats.push("Only promises Kept could verify against PayPal records are counted; vague promises (e.g. 'we'll sort you out') are never scored.");
  caveats.push("Shipping is 'kept' when tracking was added to the PayPal order before the deadline — that shows the parcel was reported shipped, not delivered.");

  return {
    format: "kept-promise-record/1",
    merchant: { slug: m.slug, name: m.name },
    asOf: new Date().toISOString(),
    data: mode === "simulated" ? "SIMULATED" : mode === "sandbox" ? "PAYPAL_SANDBOX" : "PAYPAL_LIVE",
    ...all,
    watching: cms.filter((c) => c.state === "PENDING" || c.state === "AT_RISK").length,
    keptAsPromisedRate: rate(all.keptAsPromised, all.resolved),
    keptOrMadeGoodRate: rate(all.keptAsPromised + all.brokenThenMadeGood, all.resolved),
    byType: MERCHANT_PROMISE_TYPES.map((t) => ({ type: t, label: LABEL[t]!, ...tally(cms.filter((c) => c.type === t)) })),
    orders: ords.length,
    auditChains: { verified: verdicts.length, intact: verdicts.every((v) => v.ok) },
    caveats,
    method: "Promises are extracted from the merchant's sales chat and policies, enforced only when the exact words are found in the source, and judged by deterministic code against PayPal's captures, refunds and order tracking. 'Made good' means a merchant-approved fix that PayPal confirmed.",
  };
}

/** One line a shopping agent (or a person) can read. */
export function summarizeRecord(r: PromiseRecord): string {
  if (r.resolved === 0) return `${r.merchant.name} has no resolved promises on record yet.`;
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  return `${r.merchant.name}'s PayPal-verified promise record: ${r.keptAsPromised} of ${r.resolved} resolved promises kept as promised (${pct(r.keptAsPromisedRate)}), ${r.brokenThenMadeGood} broken then made good, ${r.brokenStillOpen} still open${r.resolved < SMALL_SAMPLE ? " — small sample" : ""}${r.data === "SIMULATED" ? " (simulated data)" : ""}.`;
}
