/**
 * Evidence packs: everything Kept knows about one order, in one self-verifying JSON file —
 * the immutable sources (with SHA-256), the promises and how they were judged, the
 * PayPal-confirmed facts, the remedies, and the order's hash-chained audit trail.
 * A merchant can attach it to a PayPal dispute or hand it to anyone who asks.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { auditLog } from "../db/schema";
import { verifyChain, CHAIN_VERSION, type ChainEntry, type ChainVerdict } from "../ledger/chain";
import { paypalMode } from "../paypal/client";
import { getOrderBundle } from "./views";

export const PACK_FORMAT = "kept-evidence-pack/1";

export async function orderChain(merchantId: string, orderId: string): Promise<{ entries: ChainEntry[]; verdict: ChainVerdict }> {
  const rows = await getDb().select().from(auditLog)
    .where(and(eq(auditLog.merchantId, merchantId), eq(auditLog.orderId, orderId), isNotNull(auditLog.hash)))
    .orderBy(asc(auditLog.seq));
  const entries: ChainEntry[] = rows.map((r) => ({
    seq: r.seq!, merchantId: r.merchantId, orderId: r.orderId, actor: r.actor, action: r.action, ref: r.ref, outcome: r.outcome,
    detail: r.detail, createdAt: r.createdAt.toISOString(), prevHash: r.prevHash!, hash: r.hash!,
  }));
  return { entries, verdict: verifyChain(merchantId, orderId, entries) };
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function evidencePack(orderId: string) {
  const b = await getOrderBundle(orderId);
  if (!b) return null;
  const o = b.order;
  const chain = await orderChain(o.merchantId, o.id);
  return {
    format: PACK_FORMAT,
    generatedAt: new Date().toISOString(),
    paypalMode: paypalMode(),
    notice: paypalMode() === "simulated" ? "SIMULATED: produced against Kept's local PayPal emulator. No PayPal was involved and no money moved." : null,
    merchant: { id: b.merchant.id, name: b.merchant.name },
    order: {
      keptOrderId: o.id, createdAt: o.createdAt.toISOString(), currency: o.currency, lines: o.lines, requestedTotalMinor: o.requestedTotalMinor,
      paypal: { orderId: o.paypalOrderId, customId: o.id, captureId: o.paypalCaptureId, captureStatus: o.captureStatus, capturedMinor: o.captureAmountMinor,
        captureCurrency: o.captureCurrency, capturedAt: o.capturedAt?.toISOString() ?? null, verifiedByGetAt: o.captureVerifiedAt?.toISOString() ?? null, refundedMinor: o.refundedMinor },
    },
    sources: [...new Map([...b.orderSources, ...b.commitmentSources].map((s) => [s.id, s])).values()]
      .map((s) => ({ id: s.id, kind: s.kind, title: s.title, scope: s.orderId ? "order" : "merchant policy", sha256: s.sha256, text: s.text })),
    promises: b.commitments.map((c) => ({
      id: c.id, type: c.type, quote: c.quote, sourceId: c.sourceId, sourceSha256: b.commitmentSources.find((s) => s.id === c.sourceId)?.sha256 ?? null,
      state: c.state, reason: c.stateReason, dueAt: c.dueAt?.toISOString() ?? null, params: c.params, evaluation: c.evaluation,
    })),
    paypalRecords: {
      events: b.events.map((e) => ({ paypalEventId: e.paypalEventId, type: e.eventType, verification: e.verification, receivedAt: e.receivedAt.toISOString() })),
      refunds: b.refunds.map((r) => ({ paypalRefundId: r.paypalRefundId, amountMinor: r.amountMinor, currency: r.currency, status: r.status, verifiedByGetAt: r.verifiedAt.toISOString() })),
      trackers: b.trackers.map((t) => ({ carrier: t.carrier, trackingNumber: t.trackingNumber, status: t.status, recordedAt: t.recordedAt.toISOString() })),
      disputes: b.disputes.map((d) => ({ paypalDisputeId: d.paypalDisputeId, reason: d.reason, status: d.status, stage: d.stage })),
    },
    remedies: b.remedies.map((r) => ({ id: r.id, kind: r.kind, state: r.state, amountMinor: r.amountMinor, currency: r.currency, proposedBy: r.proposedBy,
      paypalRequestId: r.paypalRequestId, paypalRefundId: r.paypalRefundId, decidedAt: r.decidedAt?.toISOString() ?? null, customerMessage: r.customerMessage })),
    auditChain: { version: CHAIN_VERSION, merchantId: o.merchantId, orderId: o.id, entries: chain.entries, verdictAtExport: chain.verdict },
    howToVerify: "Run `npx tsx scripts/verify-evidence.ts <this file>` from the Kept repository. It recomputes every audit hash from genesis and every source SHA-256. Compare the head hash with the evidence fingerprint shown on the customer's receipt to detect truncation.",
  };
}

export type EvidencePack = NonNullable<Awaited<ReturnType<typeof evidencePack>>>;

/** Offline verification of a pack (used by the CLI and the tests). */
export function verifyPack(pack: EvidencePack): { ok: boolean; chain: ChainVerdict; sources: Array<{ id: string; ok: boolean }>; promiseSourcesOk: boolean } {
  const chain = verifyChain(pack.auditChain.merchantId, pack.auditChain.orderId, pack.auditChain.entries);
  const sources = pack.sources.map((s) => ({ id: s.id, ok: sha256(s.text) === s.sha256 }));
  // every promise must point at a source in the pack, with the same fingerprint
  const promiseSourcesOk = pack.promises.every((p) => pack.sources.some((s) => s.id === p.sourceId && s.sha256 === p.sourceSha256));
  return { ok: chain.ok && sources.every((s) => s.ok) && promiseSourcesOk, chain, sources, promiseSourcesOk };
}
