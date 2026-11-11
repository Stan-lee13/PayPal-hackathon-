/**
 * Settlement that finishes on PayPal's word.
 *
 *   paypalTrail   every call the gateway made to PayPal for one envelope
 *   recall        the owner takes back a payout nobody claimed: PayPal cancels it, the capture is refunded
 *   event         PayPal reports something (webhook, or its own event feed): applied once
 *   sweep         everything unfinished is moved along by asking PayPal
 *
 * One rule runs through all of it: an event is a hint, never the truth. Whatever PayPal's message
 * says, the gateway finds the record it is about and asks PayPal for that record by id before it
 * changes anything. A forged or replayed event can therefore cause a read, and nothing else.
 *
 * No model output is read anywhere in this file.
 */
import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { paypalEvents, roots, spends, transfers, type PayPalCall, type Spend } from "../db/schema";
import * as E from "../envelope/core";
import { UserFacingError } from "../errors";
import { getPayPal, PayPalApiError, paypalMode } from "../paypal/client";
import { callsFor, MOVES, OP_TEXT } from "../paypal/journal";
import { cancelPayoutItem, listEvents, verifyWebhookSignature, type EventHeaders, type PayPalEventBody } from "../paypal/payments";
import { syncTransfer } from "./bank";
import { checkHold, sweepExpired, syncSpend, trail } from "./service";

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

// ---------------------------------------------------------------------------
// What PayPal did for one envelope
// ---------------------------------------------------------------------------

export type RailCall = Pick<PayPalCall, "id" | "op" | "method" | "path" | "httpStatus" | "paypalStatus" | "resourceId" | "amountMinor" | "currency" | "debugId" | "ms" | "error" | "requestId"> & { at: string; text: string; moves: boolean; /** The same request sent again (a retry): PayPal returned its first answer and did nothing new. */ repeat: boolean };

export async function paypalTrail(rootId: string) {
  const db = getDb();
  const root = await db.query.roots.findFirst({ where: eq(roots.id, rootId) });
  if (!root) return null;
  const ss = await db.select({ id: spends.id, captureId: spends.captureId, payoutBatchId: spends.payoutBatchId, payoutItemId: spends.payoutItemId }).from(spends).where(eq(spends.rootId, rootId));
  const keys = [root.id, root.authorizationId, root.paypalOrderId, ...ss.flatMap((s) => [s.id, s.captureId, s.payoutBatchId, s.payoutItemId])].filter((x): x is string => Boolean(x));
  const rows = await callsFor(keys);
  const first = new Set<string>();
  const again = (c: PayPalCall) => { if (!c.requestId || c.httpStatus >= 300) return false; const k = `${c.op}|${c.requestId}`; if (first.has(k)) return true; first.add(k); return false; };
  const calls: RailCall[] = rows.map((c) => ({ repeat: again(c), id: c.id, at: c.at.toISOString(), op: c.op, text: OP_TEXT[c.op] ?? c.op, moves: MOVES.includes(c.op), method: c.method, path: c.path, httpStatus: c.httpStatus, paypalStatus: c.paypalStatus, resourceId: c.resourceId, amountMinor: c.amountMinor, currency: c.currency, debugId: c.debugId, ms: c.ms, error: c.error, requestId: c.requestId }));
  const ok = calls.filter((c) => c.httpStatus >= 200 && c.httpStatus < 300 && !c.repeat);
  const count = (op: string) => ok.filter((c) => c.op === op).length;
  const events = await db.select().from(paypalEvents).where(inArray(paypalEvents.subject, keys)).orderBy(asc(paypalEvents.receivedAt)).limit(100);
  return {
    mode: paypalMode(), currency: root.currency, calls,
    summary: {
      total: calls.length, changed: ok.filter((c) => c.moves).length, asked: ok.filter((c) => !c.moves).length, repeats: calls.filter((c) => c.repeat).length, refused: calls.filter((c) => c.httpStatus < 200 || c.httpStatus >= 300).length,
      holds: count("hold.place"), captures: count("capture"), payouts: count("payout.send"), refunds: count("refund"), cancels: count("payout.cancel"), voids: count("hold.void"),
    },
    events: events.map((e) => ({ id: e.id, type: e.type, source: e.source, subject: e.subject, outcome: e.outcome, at: e.receivedAt.toISOString() })),
  };
}

// ---------------------------------------------------------------------------
// Recall: money that never arrived comes back
// ---------------------------------------------------------------------------

/**
 * A payout PayPal is holding because the payee has not claimed it stays out of the owner's hands for
 * up to 30 days. The owner can end that: PayPal cancels the payout item, the gateway refunds the
 * capture, and the budget returns to every envelope on the path. Only the owner's signature does this.
 */
export async function recall(spendId: string, signed: E.SignedRead): Promise<Spend> {
  const db = getDb();
  const s0 = await db.query.spends.findFirst({ where: eq(spends.id, spendId) });
  if (!s0) throw new UserFacingError("No such payment.", 404);
  const root = (await db.query.roots.findFirst({ where: eq(roots.id, s0.rootId) }))!;
  if (signed?.by !== root.principal || !(await E.verifyReadSignature(signed, "recall", spendId))) throw new UserFacingError("Only the owner who sealed this envelope can recall a payment.", 401);
  const s = await syncSpend(spendId); // PayPal's current word first
  if (s.status === "FAILED" && s.refundId) return s; // already back
  if (s.status !== "UNCLAIMED" || !s.payoutItemId) throw new UserFacingError(s.status === "PAID" ? "PayPal has delivered this payment; it cannot be recalled." : "Only a payout PayPal is holding unclaimed can be recalled.", 409);
  try {
    await cancelPayoutItem(getPayPal(), s.payoutItemId);
  } catch (e) {
    // Seen on the sandbox: for a short while after a payout is sent, PayPal holds the item unclaimed but is still closing the batch, and refuses to cancel.
    if (e instanceof PayPalApiError && (e.issue === "BATCH_NOT_COMPLETED" || e.paypalName === "BATCH_NOT_COMPLETED")) throw new UserFacingError("PayPal is still processing this payout batch and will not cancel it yet. Nothing changed; try again in a minute.", 409);
    // PayPal may have moved on in the meantime (claimed, already returned): its current word decides.
    const now = await syncSpend(spendId);
    if (now.status === "UNCLAIMED") throw new UserFacingError(`PayPal would not cancel the payout${e instanceof PayPalApiError ? ` (${e.issue ?? e.paypalName})` : ""}. Nothing changed.`, 502);
    return now;
  }
  await trail(root, "principal", "payout.recalled", "OK", s.payoutItemId, { spend: s.id, payee: s.payee, amount: s.amountMinor });
  // PayPal now reports the item returned, and the usual path for a payout that did not arrive runs: refund the capture, give the budget back.
  const after = await syncSpend(spendId);
  if (after.status !== "FAILED") return after; // e.g. REFUND_DUE: the refund is retried later, and says so
  const why: E.Violation = { code: "RECALLED_BY_OWNER", at: root.id, detail: "the owner took this payout back before anyone claimed it; PayPal cancelled it and the capture was refunded" };
  const [u] = await db.update(spends).set({ reasons: [why, ...after.reasons] }).where(and(eq(spends.id, spendId), eq(spends.status, "FAILED"))).returning();
  return u ?? after;
}

// ---------------------------------------------------------------------------
// Events from PayPal
// ---------------------------------------------------------------------------

/** Is this webhook really from PayPal? PayPal itself answers, given the headers it signed with and the body exactly as received. */
export async function genuineEvent(headers: Record<string, string>, raw: string): Promise<"yes" | "no" | "unconfigured"> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || (paypalMode() === "simulated" ? "SIM-WEBHOOK" : null);
  if (!webhookId) return "unconfigured";
  const h = { authAlgo: headers["paypal-auth-algo"], certUrl: headers["paypal-cert-url"], transmissionId: headers["paypal-transmission-id"], transmissionSig: headers["paypal-transmission-sig"], transmissionTime: headers["paypal-transmission-time"] };
  if (Object.values(h).some((x) => !x)) return "no";
  try { return (await verifyWebhookSignature(getPayPal(), webhookId, h as EventHeaders, raw)) ? "yes" : "no"; } catch { return "no"; }
}

export type EventOutcome = { event: string; type: string; duplicate: boolean; subject: string | null; outcome: string };

/**
 * Apply one PayPal event, once. The event only tells the gateway where to look: the payment,
 * transfer or hold it names is then read from PayPal by id, and that reading is what changes the books.
 */
export async function applyPayPalEvent(ev: PayPalEventBody, source: "webhook" | "feed"): Promise<EventOutcome> {
  const db = getDb();
  const r = (ev.resource ?? {}) as Loose;
  const type = String(ev.event_type);
  const resourceId = str(r.id) ?? str(r.payout_item_id) ?? str(r.batch_header?.payout_batch_id);
  const [fresh] = await db.insert(paypalEvents).values({ id: ev.id, type, source, resourceId, outcome: "received" }).onConflictDoNothing().returning();
  if (!fresh) return { event: ev.id, type, duplicate: true, subject: null, outcome: "already applied" };

  const ours = [r.invoice_id, r.payout_item?.sender_item_id, r.sender_batch_id, r.batch_header?.sender_batch_header?.sender_batch_id].map(str).filter((x): x is string => Boolean(x));
  const batch = str(r.payout_batch_id) ?? str(r.batch_header?.payout_batch_id);
  const isHold = type.startsWith("PAYMENT.AUTHORIZATION.");
  let subject: string | null = null, outcome = "matches nothing this gateway did";

  const spendIs: SQL[] = [];
  if (ours.length) spendIs.push(inArray(spends.id, ours));
  if (!isHold && str(r.id)) spendIs.push(eq(spends.captureId, r.id));
  if (batch) spendIs.push(eq(spends.payoutBatchId, batch));
  const spend = spendIs.length ? await db.query.spends.findFirst({ where: or(...spendIs) }) : undefined;
  const transferIs: SQL[] = [];
  if (ours.length) transferIs.push(inArray(transfers.id, ours));
  if (batch) transferIs.push(eq(transfers.payoutBatchId, batch));
  const transfer = !spend && transferIs.length ? await db.query.transfers.findFirst({ where: or(...transferIs) }) : undefined;

  if (spend) {
    subject = spend.id;
    const after = await syncSpend(spend.id);
    outcome = after.status === spend.status ? `payment unchanged (${after.status})` : `payment ${spend.status} → ${after.status}`;
    if (/\.CAPTURE\.(REFUNDED|REVERSED)$/.test(type) && ["PAID", "UNCLAIMED", "PAYOUT_PENDING"].includes(after.status)) {
      // Money came back to the owner outside the gateway (a dispute, a manual refund) while the payee was also paid. A person has to look.
      const root = (await db.query.roots.findFirst({ where: eq(roots.id, spend.rootId) }))!;
      await trail(root, "paypal", "capture.reversed_outside", "INFO", str(r.id), { spend: spend.id, event: type });
      outcome = `flagged for the owner: PayPal reports ${type.split(".").pop()} while the payment stands as ${after.status}`;
    }
  } else if (transfer) {
    subject = transfer.id;
    const after = await syncTransfer(transfer.id);
    outcome = !after || after.status === transfer.status ? `transfer unchanged (${transfer.status})` : `transfer ${transfer.status} → ${after.status}`;
  } else {
    const authId = isHold ? str(r.id) : str(r.supplementary_data?.related_ids?.authorization_id);
    const rootIs: SQL[] = [];
    if (authId) rootIs.push(eq(roots.authorizationId, authId));
    if (str(r.custom_id)) rootIs.push(eq(roots.id, r.custom_id));
    const root = rootIs.length ? await db.query.roots.findFirst({ where: or(...rootIs) }) : undefined;
    if (root) {
      subject = root.id;
      const c = await checkHold(root.id);
      outcome = c?.closed ? `envelope closed: PayPal reports the hold ${c.hold}` : `hold read from PayPal: ${c?.hold ?? "unknown"}`;
    }
  }
  await db.update(paypalEvents).set({ subject, outcome }).where(eq(paypalEvents.id, ev.id));
  return { event: ev.id, type, duplicate: false, subject, outcome };
}

/** Read PayPal's own event feed and apply what has not been seen. Works without an inbound endpoint. */
export async function pullPayPalEvents(): Promise<{ seen: number; applied: EventOutcome[] }> {
  const events = await listEvents(getPayPal(), new Date(Date.now() - 3 * 86400_000));
  const applied: EventOutcome[] = [];
  for (const ev of [...events].reverse()) { // oldest first
    if (!ev?.id || !ev.event_type) continue;
    const out = await applyPayPalEvent(ev, "feed");
    if (!out.duplicate) applied.push(out);
  }
  return { seen: events.length, applied };
}

// ---------------------------------------------------------------------------
// Sweep: nothing waits for somebody to open a page
// ---------------------------------------------------------------------------

/** Move along everything unfinished: read PayPal's event feed, then ask PayPal about each payment and transfer still in flight, and lapse promises that ran out. */
export async function sweepUnfinished(limit = 40) {
  const db = getDb();
  const feed = await pullPayPalEvents().catch(() => ({ seen: 0, applied: [] as EventOutcome[] }));
  const openSpends = await db.select({ id: spends.id, status: spends.status }).from(spends).where(inArray(spends.status, ["RESERVED", "CAPTURED", "PAYOUT_PENDING", "UNCLAIMED", "REFUND_DUE"])).orderBy(asc(spends.createdAt)).limit(limit);
  const moved: Array<{ id: string; from: string; to: string }> = [];
  for (const s of openSpends) {
    const after = await syncSpend(s.id).catch(() => null);
    if (after && after.status !== s.status) moved.push({ id: s.id, from: s.status, to: after.status });
  }
  const openTransfers = await db.select({ id: transfers.id, status: transfers.status }).from(transfers).where(inArray(transfers.status, ["PAYOUT_PENDING", "UNCLAIMED"])).orderBy(asc(transfers.createdAt)).limit(limit);
  for (const t of openTransfers) {
    const after = await syncTransfer(t.id).catch(() => null);
    if (after && after.status !== t.status) moved.push({ id: t.id, from: t.status, to: after.status });
  }
  const promised = await db.selectDistinct({ rootId: spends.rootId }).from(spends).where(eq(spends.status, "PROMISED")).limit(limit);
  for (const p of promised) await sweepExpired(p.rootId).catch(() => undefined);
  return { mode: paypalMode(), events: { seen: feed.seen, applied: feed.applied.length, outcomes: feed.applied.map((e) => ({ type: e.type, subject: e.subject, outcome: e.outcome })) }, checked: openSpends.length + openTransfers.length, moved };
}
