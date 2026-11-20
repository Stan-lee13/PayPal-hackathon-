/**
 * Where the money actually is, per financial provider and currency.
 *
 * Two different books answer two different questions, and conflating them is how a system that "balances"
 * runs out of money:
 *
 *   • the **ledger** (lib/gateway/bank.ts) is what this gateway *owes* an agent. It is an internal claim.
 *     Every row carries the rail and currency that funded the claim, so a claim knows where it came from.
 *   • **position entries** (here) are what actually *arrived at, or left*, a provider account for an
 *     organization: a capture, a payout, a refund, a fee. They are external facts, append-only, and each is
 *     unique per `(rail, currency, bucket, kind, ref)`, so no arrival is counted twice.
 *
 * The rule that follows from keeping them apart: an internally valid balance is not spendable at a rail
 * that never funded it. `requireProviderLiquidity` refuses to send a payout that the destination rail has no
 * settled funds for, before anything is called, and `reconcilePositions` (lib/gateway/books.ts) compares the
 * two books against the provider's own statement.
 *
 * Fees are in their own bucket. A fee is money the provider took, not money the organization can spend, and
 * mixing the two makes a fee look like available liquidity. Fee amounts are always reported as a **positive
 * cost** (`feesMinor: 200` means $2.00 was taken), and the arithmetic subtracts them:
 *
 *     spendable      = available - fees
 *     netAtProvider  = available + pending - fees
 *
 * The stored deltas in the `fee` bucket are negative (money left), but no caller ever sees that sign: one
 * convention, so a fee can never be added to liquidity by accident.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  accounts, ledger, positionAttributions, positionEntries, railAccounts, reconciliationRuns,
  type PositionBucket, type PositionKind, type RailAccount, type ReconciliationFinding,
} from "../db/schema";
import { UserFacingError } from "../errors";
import { rail } from "../rails";
import { assertTreasuryPolicy, treasuryMeaning, treasuryMode } from "./policy";

export type Custody = "provider" | "gateway-ledger" | "safeguarded-partner";

export type Movement = {
  /** The organization whose money moved: the principal that owns the envelope, or the account's owner. */
  owner: string;
  rail: string;
  currency: string;
  custody?: Custody;
  bucket: PositionBucket;
  kind: PositionKind;
  /** Signed: money in is positive, money out (a payout, a refund, a fee) is negative. */
  deltaMinor: number;
  /** The domain record that caused it. Unique per kind, so the same event is never counted twice. */
  ref: string;
  memo?: string;
  externalAccountId?: string | null;
};

/** Anything that can insert and read the account rows: the pool, or a transaction on it. */
export type Query = Pick<DB, "insert" | "query" | "update">;

const ISO = /^[A-Z]{3}$/;

/** The only combination of bucket and kind that means anything. A capture is not a fee. */
function coherent(bucket: PositionBucket, kind: PositionKind): boolean {
  switch (bucket) {
    case "available": return kind === "capture" || kind === "payout" || kind === "payout_return" || kind === "refund" || kind === "adjustment";
    case "pending": return kind === "capture_pending";
    case "fee": return kind === "fee";
  }
}

/**
 * Register (once) the provider account an organization's money sits in, and attach the provider's own account
 * identity as soon as it is known. Idempotent: the same identity returns the same row, so recording a movement
 * can call it every time.
 *
 * The identity is write-once. A row that already names an account is never rewritten to a different one: an
 * account change is not a bookkeeping detail, it means the money moved, and history must keep saying where it
 * actually was. A conflicting identity is refused instead.
 */
export async function ensureRailAccount(a: {
  owner: string;
  rail?: string;
  currency: string;
  custody?: Custody;
  externalAccountId?: string | null;
  label?: string;
}, q: Query = getDb()): Promise<RailAccount> {
  const railId = a.rail ?? rail().id;
  const custody = a.custody ?? "provider";
  if (!a.owner) throw new Error("A provider position needs an owner.");
  if (!ISO.test(a.currency)) throw new Error(`A provider position needs an ISO-4217 currency, got ${a.currency}`);
  const id = a.externalAccountId ?? null;
  const values = { owner: a.owner, rail: railId, currency: a.currency, custody, externalAccountId: id, label: a.label ?? "" };
  await q.insert(railAccounts).values({ id: `ra_${railId}_${a.currency}_${a.owner.slice(0, 16)}`, ...values }).onConflictDoNothing();
  const where = and(eq(railAccounts.owner, a.owner), eq(railAccounts.rail, railId), eq(railAccounts.currency, a.currency), eq(railAccounts.custody, custody));
  const rows = await q.query.railAccounts.findMany({ where });
  // First identity wins. This is what makes "the same account" a fact instead of an assumption.
  if (id && rows.some((r) => r.externalAccountId && r.externalAccountId !== id)) {
    const other = rows.find((r) => r.externalAccountId && r.externalAccountId !== id)!.externalAccountId!;
    throw new UserFacingError(
      `The ${railId} ${a.currency} provider account for this organization is recorded as ${other.slice(0, 12)}, ` +
      `but the provider now reports ${id.slice(0, 12)}. A position cannot migrate between provider accounts: ` +
      `nothing was recorded against the new one.`,
      409,
    );
  }
  const known = rows.find((r) => r.externalAccountId) ?? rows[0]!;
  if (!known.externalAccountId && id) {
    // Fill the identity in once. Historical rows that never had it stay distinguishable in the audit trail; the row
    // itself is not rewritten to a different account, only completed from null to the provider's answer.
    await q.update(railAccounts).set({ externalAccountId: id }).where(and(eq(railAccounts.id, known.id), sql`${railAccounts.externalAccountId} is null`));
    return (await q.query.railAccounts.findFirst({ where: eq(railAccounts.id, known.id) }))!;
  }
  return known;
}

/** The provider account identity already on record for this rail and currency, or null when none is known. */
export async function railAccountIdentity(a: { rail: string; currency: string }): Promise<string | null> {
  const rows = await getDb().select({ id: railAccounts.externalAccountId }).from(railAccounts)
    .where(and(eq(railAccounts.rail, a.rail), eq(railAccounts.currency, a.currency), sql`${railAccounts.externalAccountId} is not null`)).limit(1);
  return rows[0]?.id ?? null;
}

/**
 * This gateway supports **one provider account per rail and currency**. Positions are keyed by rail and
 * currency, so a second external account at the same rail would make two accounts' funds interchangeable —
 * which is exactly the bug that attribution is meant to prevent. Rather than pretend the model supports
 * more, a second distinct account id fails closed: no payout is sent until the operator resolves it.
 *
 * The day a partner offers per-organization accounts, this becomes a real attribution key on positions;
 * until then, one rail + currency maps to one account, and that is enforced here, not assumed.
 */
export async function assertProviderAccountAttribution(a: { rail: string; currency: string; requireIdentity?: boolean }): Promise<string | null> {
  const rows = await getDb().select({ externalAccountId: railAccounts.externalAccountId }).from(railAccounts)
    .where(and(eq(railAccounts.rail, a.rail), eq(railAccounts.currency, a.currency)));
  const ids = [...new Set(rows.map((r) => r.externalAccountId).filter((x): x is string => Boolean(x)))];
  if (ids.length > 1) {
    throw new UserFacingError(
      `This deployment supports one ${a.rail} ${a.currency} provider account, but ${ids.length} distinct accounts are recorded ` +
      `(${ids.map((i) => i.slice(0, 12)).join(", ")}). A provider position cannot be attributed to the account a payout would ` +
      `leave from, so nothing was sent. Move every organization onto one account, or split the deployment per account.`,
      409,
    );
  }
  // Positions exist for this rail and currency, but at least one of them does not name the provider account it sits
  // in. That is not a verified attribution, and money must not leave on the strength of it.
  if (a.requireIdentity && rows.some((r) => !r.externalAccountId)) {
    throw new UserFacingError(
      `A ${a.rail} ${a.currency} position is recorded without the provider's account identity. This deployment cannot ` +
      `show that the funds it would pay from are the funds it recorded, so nothing was sent. Establish the account ` +
      `identity from the provider (a balance read) before paying out.`,
      409,
    );
  }
  return ids[0] ?? null;
}

/**
 * Record one external movement. Returns true when this call is the one that recorded it, false when the same
 * movement was already on the books — the answer to "did this money already arrive?".
 *
 * It never guesses: a movement that is not an integer number of minor units, or whose bucket does not match
 * its kind, is a programming error and throws, because quietly dropping an accounting row is how books drift.
 */
export async function recordExternalMovement(m: Movement, q: Query = getDb()): Promise<boolean> {
  if (!Number.isSafeInteger(m.deltaMinor)) throw new Error(`A position movement must be integer minor units, got ${m.deltaMinor}`);
  if (m.deltaMinor === 0) return false;
  if (!ISO.test(m.currency)) throw new Error(`A position movement needs an ISO-4217 currency, got ${m.currency}`);
  if (!m.owner || !m.rail || !m.ref) throw new Error("A position movement needs an owner, a rail and a reference.");
  if (!coherent(m.bucket, m.kind)) throw new Error(`A ${m.kind} cannot be recorded in the ${m.bucket} bucket.`);
  const [row] = await q.insert(positionEntries).values({
    owner: m.owner, rail: m.rail, currency: m.currency, custody: m.custody ?? "provider",
    externalAccountId: m.externalAccountId ?? null, bucket: m.bucket, kind: m.kind,
    deltaMinor: m.deltaMinor, ref: m.ref, memo: (m.memo ?? "").slice(0, 200),
  }).onConflictDoNothing().returning();
  return Boolean(row);
}

type Post = Omit<Movement, "bucket" | "kind" | "deltaMinor">;

/** A capture arrived at the provider, or is only pending there. */
export const postCapture = (a: Post & { amountMinor: number; pending?: boolean }, q?: Query) =>
  recordExternalMovement({ ...a, deltaMinor: a.amountMinor, bucket: a.pending ? "pending" : "available", kind: a.pending ? "capture_pending" : "capture" }, q);

/** A capture the provider was still reviewing has completed: the pending amount becomes settled. */
export async function postCaptureSettled(a: Post & { amountMinor: number }, q?: Query): Promise<void> {
  await recordExternalMovement({ ...a, ref: `${a.ref}:settled`, deltaMinor: a.amountMinor, bucket: "available", kind: "adjustment", memo: "capture completed" }, q);
  await recordExternalMovement({ ...a, deltaMinor: -a.amountMinor, bucket: "pending", kind: "capture_pending", memo: "capture completed" }, q);
}

/** A payout left the provider's account. */
export const postPayout = (a: Post & { amountMinor: number }, q?: Query) =>
  recordExternalMovement({ ...a, deltaMinor: -a.amountMinor, bucket: "available", kind: "payout" }, q);

/** A payout came back (returned, cancelled, refused): the money is at the provider again. */
export const postPayoutReturn = (a: Post & { amountMinor: number }, q?: Query) =>
  recordExternalMovement({ ...a, deltaMinor: a.amountMinor, bucket: "available", kind: "payout_return" }, q);

/** A refund left the provider to the payer's funding source. */
export const postRefund = (a: Post & { amountMinor: number }, q?: Query) =>
  recordExternalMovement({ ...a, deltaMinor: -a.amountMinor, bucket: "available", kind: "refund" }, q);

/** A provider's own fee, from its statement. `ref` is the statement line, so it is counted once. */
export const postFee = (a: Post & { feeMinor: number }, q?: Query) =>
  recordExternalMovement({ ...a, deltaMinor: -Math.abs(a.feeMinor), bucket: "fee", kind: "fee" }, q);

export type Position = {
  rail: string;
  currency: string;
  custody: string;
  /** Settled money recorded as arriving at this rail, **gross of fees**. */
  availableMinor: number;
  /** Accepted by the provider, not settled: not spendable, not yet lost. */
  pendingMinor: number;
  /** What the provider took, as a **positive cost**. Never spendable: `spendable = available - feesMinor`. */
  feesMinor: number;
  /**
   * Available money recorded before the provider account's identity was known, with no separate attribution.
   * It is tracked, but not proven to sit in the account a payout would leave from, so it is **not spendable**.
   */
  unverifiedMinor: number;
  /** available + pending − fees: what the provider should actually be holding for this organization. */
  netAtProviderMinor: number;
  entries: number;
};

const ZERO = { availableMinor: 0, pendingMinor: 0, feesMinor: 0, unverifiedMinor: 0, netAtProviderMinor: 0, entries: 0 };

/**
 * Every provider position, one row per rail and currency. Pass an owner to see one organization's slice; pass
 * null for the provider account itself, which is where liquidity actually is.
 */
export async function positionsFor(owner: string | null): Promise<Position[]> {
  const db = getDb();
  const rows = await db.select({
    rail: positionEntries.rail, currency: positionEntries.currency, custody: positionEntries.custody,
    available: sql<number>`coalesce(sum(${positionEntries.deltaMinor}) filter (where ${positionEntries.bucket} = 'available'), 0)::int`,
    pending: sql<number>`coalesce(sum(${positionEntries.deltaMinor}) filter (where ${positionEntries.bucket} = 'pending'), 0)::int`,
    // Stored negative (money taken); reported positive so callers never add a cost to liquidity.
    fees: sql<number>`coalesce(sum(-${positionEntries.deltaMinor}) filter (where ${positionEntries.bucket} = 'fee'), 0)::int`,
    // Money recorded without the provider's account identity, and with no separate proof for this exact
    // movement. It stays visible in the position, and it never counts as liquidity. The proof is joined rather
    // than tested with a correlated `not exists`: inside an aggregate FILTER a correlated subquery is not
    // evaluated per row the way this needs, and one attribution would silently cover every movement.
    unverified: sql<number>`coalesce(sum(${positionEntries.deltaMinor}) filter (where ${positionEntries.bucket} = 'available' and ${positionEntries.externalAccountId} is null and ${positionAttributions.id} is null), 0)::int`,
    entries: sql<number>`count(distinct ${positionEntries.id})::int`,
  }).from(positionEntries)
    // At most one attribution per movement (unique index), so this join neither multiplies rows nor changes a sum.
    .leftJoin(positionAttributions, eq(positionAttributions.positionEntryId, positionEntries.id))
    .where(owner ? eq(positionEntries.owner, owner) : sql`true`)
    .groupBy(positionEntries.rail, positionEntries.currency, positionEntries.custody);
  return rows.map((r) => ({
    rail: r.rail, currency: r.currency, custody: r.custody,
    availableMinor: r.available, pendingMinor: r.pending, feesMinor: r.fees, unverifiedMinor: r.unverified,
    netAtProviderMinor: r.available + r.pending - r.fees, entries: r.entries,
  }));
}

/** One position, or zeroes when nothing has moved at that rail in that currency. */
export async function positionOf(owner: string | null, railId: string, currency: string): Promise<Position> {
  const all = await positionsFor(owner);
  const p = all.find((x) => x.rail === railId && x.currency === currency);
  return p ?? { rail: railId, currency, custody: "provider", ...ZERO };
}

/**
 * What an agent's internal balance was funded by, per rail and currency. This is the liability side: an
 * agent may have a balance of $100 that arrived through one provider and nothing through another.
 */
export async function fundedByFor(agent: string): Promise<Array<{ rail: string; currency: string; minor: number }>> {
  const db = getDb();
  const rows = await db.select({
    rail: ledger.rail, currency: ledger.currency,
    minor: sql<number>`coalesce(sum(${ledger.deltaMinor}), 0)::int`,
  }).from(ledger).where(eq(ledger.agent, agent)).groupBy(ledger.rail, ledger.currency);
  return rows.filter((r) => r.minor !== 0);
}

/**
 * The rule the whole module exists for. A payout may only be sent through a rail that actually holds the
 * organization's money in that currency. An internal ledger entry is not liquidity at another provider.
 *
 * Returns the amount spendable at that rail so a caller can say what *is* available, and never throws here:
 * callers decide whether a shortfall is a refusal or a payment the operator funds itself.
 */
export async function liquidityAt(a: { owner?: string | null; rail: string; currency: string; amountMinor: number }): Promise<{
  ok: boolean; availableMinor: number; pendingMinor: number; detail: string;
}> {
  const p = await positionOf(a.owner ?? null, a.rail, a.currency);
  // A fee the provider already took is not money that can be paid out, and neither is a movement whose
  // provider account was never established: it cannot be shown to be the money the payout would leave from.
  const spendable = p.availableMinor - p.feesMinor - p.unverifiedMinor;
  const ok = spendable >= a.amountMinor;
  const detail = ok
    ? `${spendable} minor units settled at ${a.rail} in ${a.currency}`
    : `${a.rail} holds ${p.availableMinor} minor units available in ${a.currency}` +
      (p.pendingMinor ? `, ${p.pendingMinor} still pending` : "") +
      (p.feesMinor ? `, ${p.feesMinor} taken in fees` : "") +
      (p.unverifiedMinor ? `, ${p.unverifiedMinor} recorded without the provider's account identity (unverified, so not spendable)` : "") +
      `, leaving ${spendable}; ${a.amountMinor} was asked for`;
  return { ok, availableMinor: spendable, pendingMinor: p.pendingMinor, detail };
}

/**
 * Refuse a payout the destination rail has no settled funds for, before anything is sent.
 *
 * This is what stops the failure mode that passes every application test: an agent whose balance was
 * credited through one provider withdrawing at another, creating money that exists only in this database.
 */
export async function requireProviderLiquidity(a: {
  /** Omit to check the provider account itself, which is where the money is. */
  owner?: string | null; rail: string; currency: string; amountMinor: number; what: string;
  /** The rail that funded the record being paid out. Used only when nothing is tracked for this rail yet. */
  fundedByRail?: string;
}): Promise<void> {
  // Nothing tracked for this rail (a database from before migration 0010, or a balance credited directly):
  // fall back to the provenance on the record itself, and say so rather than guessing.
  // A production install must have chosen its treasury model, and one rail must map to one account. The payout
  // also requires that account's identity to be established: an unattributed position is not liquidity.
  assertTreasuryPolicy();
  await assertProviderAccountAttribution({ rail: a.rail, currency: a.currency, requireIdentity: true });
  const tracked = await positionsFor(null);
  if (tracked.length === 0) {
    if (a.fundedByRail === a.rail) return;
    throw new UserFacingError(
      `${a.what} cannot be paid: no settled funds are recorded at ${a.rail} for this organization, ` +
      `and the balance was funded at ${a.fundedByRail ?? "another rail"}. Nothing was sent.`,
      409,
    );
  }
  // In allocated mode the tenant's own slice must cover it too — on top of the provider account.
  if (treasuryMode() === "allocated" && a.owner) {
    const slice = await liquidityAt({ owner: a.owner, rail: a.rail, currency: a.currency, amountMinor: a.amountMinor });
    if (!slice.ok) {
      throw new UserFacingError(
        `${a.what} cannot be paid: this deployment allocates liquidity per organization (ENVELOPE_TREASURY_MODE=allocated) ` +
        `and this organization's own position at ${a.rail} does not cover it. ${slice.detail}. Nothing was sent. ` +
        `Funding it from another organization's money is a treasury transfer, which is not implemented.`,
        409,
      );
    }
  }
  const l = await liquidityAt({ rail: a.rail, currency: a.currency, amountMinor: a.amountMinor });
  if (l.ok) return;
  throw new UserFacingError(
    `${a.what} cannot be paid: this rail has no settled funds for it. ${l.detail}. Nothing was sent. ` +
    `Money credited here through another financial provider is an internal balance, not liquidity at ${a.rail}; ` +
    `fund the ${a.rail} account first (see docs/MULTI_RAIL_ACCOUNTING.md). ` +
    treasuryMeaning(),
    409,
  );
}

/** Sum of every agent balance this organization answers for, per currency. The internal liability. */
export async function internalLiabilities(owner: string, currency?: string): Promise<{ minor: number; accounts: number; byCurrency: Array<{ currency: string; minor: number }> }> {
  const db = getDb();
  const rows = await db.select({ total: sql<number>`coalesce(sum(${accounts.balanceMinor}), 0)::int`, n: sql<number>`count(*)::int` })
    .from(accounts).where(eq(accounts.owner, owner));
  // Accounts are USD today; the currency dimension is on their ledger entries, so report it from there.
  const by = await db.select({ currency: ledger.currency, minor: sql<number>`coalesce(sum(${ledger.deltaMinor}), 0)::int` })
    .from(ledger).innerJoin(accounts, eq(accounts.agent, ledger.agent)).where(eq(accounts.owner, owner)).groupBy(ledger.currency);
  const total = rows[0]?.total ?? 0;
  return {
    minor: currency ? (by.find((b) => b.currency === currency)?.minor ?? 0) : total,
    accounts: rows[0]?.n ?? 0,
    byCurrency: by,
  };
}

/** Keep one reconciliation attempt, so "it was reconciled" has a timestamp and a verdict behind it. */
export async function recordReconciliation(r: {
  owner: string | null; rail: string; currency: string; from: Date; to: Date;
  available: boolean; ok: boolean; findings: ReconciliationFinding[];
}): Promise<void> {
  await getDb().insert(reconciliationRuns).values({
    owner: r.owner, rail: r.rail, currency: r.currency, fromAt: r.from, toAt: r.to,
    available: r.available, ok: r.ok, findings: r.findings,
  });
}

/** The last reconciliation per rail, for a health page or a person asking when this was last checked. */
export async function lastReconciliations(limit = 10) {
  return getDb().select().from(reconciliationRuns).orderBy(sql`${reconciliationRuns.at} desc`).limit(limit);
}

/** Tests only: the ledger and position rows for one reference, so a test can compare both books. */
export async function movementsFor(ref: string) {
  return getDb().select().from(positionEntries).where(eq(positionEntries.ref, ref)).orderBy(positionEntries.id);
}

/**
 * The movements this deployment tracks at a rail that are not proven to belong to a known provider account:
 * recorded before the identity was available, and with no attribution of their own.
 *
 * They stay on the books — history is not rewritten — but `liquidityAt` does not count them, so they cannot
 * fund a payout until each one is matched to a provider record.
 */
export async function unverifiedMovements(a: { rail: string; currency: string; owner?: string | null; limit?: number }): Promise<Array<{
  id: number; owner: string; kind: PositionKind; ref: string; deltaMinor: number; at: Date;
}>> {
  const where = and(
    eq(positionEntries.rail, a.rail), eq(positionEntries.currency, a.currency),
    sql`${positionEntries.bucket} = 'available'`,
    sql`${positionEntries.externalAccountId} is null`,
    sql`not exists (select 1 from ${positionAttributions} pa where pa.position_entry_id = ${positionEntries.id})`,
    ...(a.owner ? [eq(positionEntries.owner, a.owner)] : []),
  );
  const rows = await getDb().select({
    id: positionEntries.id, owner: positionEntries.owner, kind: positionEntries.kind,
    ref: positionEntries.ref, deltaMinor: positionEntries.deltaMinor, at: positionEntries.at,
  }).from(positionEntries).where(where).orderBy(positionEntries.id).limit(Math.min(500, Math.max(1, a.limit ?? 100)));
  return rows;
}

/**
 * Record the provider evidence that **one specific movement** belongs to a provider account.
 *
 * This is the only way an unverified historical movement becomes spendable. It does not touch the movement:
 * the original row keeps its null identity, and the proof is a separate row beside it. A selector that matches
 * more than one movement is refused (pass the entry id, or the reference and kind), and an attribution that
 * contradicts the account on record is refused.
 */
export async function attributePositionMovement(a: {
  rail: string;
  currency: string;
  /** The exact entry. Preferred: an attribution is about one movement, not a group. */
  positionEntryId?: number;
  /** Or the domain reference plus its kind, which must identify exactly one entry. */
  ref?: string;
  kind?: PositionKind;
  externalAccountId: string;
  /** Where the matching provider record was read. */
  source: string;
  /** The provider's own id for that record. */
  evidence: string;
  attributedBy?: string | null;
}, q: Query = getDb()): Promise<{ positionEntryId: number; alreadyVerified: boolean }> {
  if (!a.externalAccountId?.trim()) throw new UserFacingError("An attribution needs the provider's account id.", 400);
  if (!a.source?.trim() || !a.evidence?.trim()) {
    throw new UserFacingError("An attribution needs the provider record it matches (source) and that record's own id (evidence).", 400);
  }
  if (!a.positionEntryId && !a.ref) throw new UserFacingError("An attribution names one movement: give its entry id, or its reference and kind.", 400);
  const where = and(
    eq(positionEntries.rail, a.rail), eq(positionEntries.currency, a.currency),
    ...(a.positionEntryId ? [eq(positionEntries.id, a.positionEntryId)] : []),
    ...(!a.positionEntryId && a.ref ? [eq(positionEntries.ref, a.ref)] : []),
    ...(!a.positionEntryId && a.kind ? [eq(positionEntries.kind, a.kind)] : []),
  );
  const rows = await q.query.positionEntries.findMany({ where });
  if (rows.length === 0) throw new UserFacingError(`No ${a.rail} ${a.currency} movement matches that reference, so there is nothing to attribute.`, 404);
  if (rows.length > 1) {
    throw new UserFacingError(
      `${rows.length} movements match that reference (${rows.map((r) => `${r.kind}#${r.id}`).join(", ")}). ` +
      `An attribution proves one movement belongs to the account: name the entry id, or the reference and kind.`,
      409,
    );
  }
  const entry = rows[0]!;
  if (entry.externalAccountId && entry.externalAccountId !== a.externalAccountId) {
    throw new UserFacingError(
      `Movement ${entry.id} is already recorded as belonging to provider account ${entry.externalAccountId.slice(0, 12)}; ` +
      `it cannot also be attributed to ${a.externalAccountId.slice(0, 12)}. History is not rewritten.`,
      409,
    );
  }
  // The account on record is the one the provider reported; an attribution may not invent a different one.
  const known = (await q.query.railAccounts.findMany({ where: and(eq(railAccounts.rail, a.rail), eq(railAccounts.currency, a.currency)) }))
    .map((r) => r.externalAccountId).find((x): x is string => Boolean(x));
  if (known && known !== a.externalAccountId) {
    throw new UserFacingError(
      `The ${a.rail} ${a.currency} account on record is ${known.slice(0, 12)}, but this proof names ${a.externalAccountId.slice(0, 12)}. ` +
      `Refusing to attribute a movement to an account this deployment has not established.`,
      409,
    );
  }
  if (entry.externalAccountId === a.externalAccountId) return { positionEntryId: entry.id, alreadyVerified: true };
  const [row] = await q.insert(positionAttributions).values({
    positionEntryId: entry.id, rail: a.rail, currency: a.currency, externalAccountId: a.externalAccountId,
    source: a.source.slice(0, 200), evidence: a.evidence.slice(0, 200), attributedBy: a.attributedBy?.slice(0, 200) ?? null,
  }).onConflictDoNothing().returning({ id: positionAttributions.id });
  return { positionEntryId: entry.id, alreadyVerified: !row };
}
