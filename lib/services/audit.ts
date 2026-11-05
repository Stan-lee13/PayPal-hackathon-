import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { auditLog } from "../db/schema";
import { entryHash, genesisHash } from "../ledger/chain";

type Actor = "ai" | "merchant" | "system" | "paypal" | "customer";
type Outcome = "OK" | "REJECTED" | "FAILED" | "PENDING" | "INFO";
/** The DB or an open transaction. Inside a transaction this becomes a savepoint, so the chain lock lasts until the outer commit. */
type Runner = { transaction: (fn: (tx: DB) => Promise<void>) => Promise<void> };

/**
 * Append an audit entry to its hash chain (one chain per order; merchant-level entries
 * share one chain). A transaction-scoped advisory lock serialises writers to the same
 * chain, and a unique index on (merchant, order, seq) makes a forked chain impossible.
 */
export async function audit(
  db: Runner | Pick<DB, "transaction">,
  e: { merchantId: string; orderId?: string | null; actor: Actor; action: string; ref?: string | null; outcome: Outcome; detail?: Record<string, unknown> },
) {
  const orderId = e.orderId ?? null;
  await (db as Runner).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`kept-audit|${e.merchantId}|${orderId ?? "-"}`}, 0))`);
    const [last] = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog)
      .where(and(eq(auditLog.merchantId, e.merchantId), orderId ? eq(auditLog.orderId, orderId) : isNull(auditLog.orderId), isNotNull(auditLog.hash)))
      .orderBy(desc(auditLog.seq)).limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? genesisHash(e.merchantId, orderId);
    const createdAt = new Date();
    const detail = JSON.parse(JSON.stringify(e.detail ?? {})) as Record<string, unknown>;
    const hash = entryHash({ seq, merchantId: e.merchantId, orderId, actor: e.actor, action: e.action, ref: e.ref ?? null, outcome: e.outcome, detail, createdAt: createdAt.toISOString(), prevHash });
    await tx.insert(auditLog).values({ merchantId: e.merchantId, orderId, actor: e.actor, action: e.action, ref: e.ref ?? null, outcome: e.outcome, detail, createdAt, seq, prevHash, hash });
  });
}
