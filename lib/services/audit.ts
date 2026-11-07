import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { auditLog } from "../db/schema";
import { entryHash, genesisHash } from "../ledger/chain";

type Actor = "ai" | "freelancer" | "client" | "system" | "paypal" | "github" | "company" | "developer";
type Outcome = "OK" | "REJECTED" | "FAILED" | "PENDING" | "INFO";
/** The DB or an open transaction. Inside a transaction this becomes a savepoint, so the chain lock lasts until the outer commit. */
type Runner = { transaction: (fn: (tx: DB) => Promise<void>) => Promise<void> };

/**
 * Append an audit entry to its hash chain (one chain per subject: an invoice or a bounty; account-level entries
 * share one chain). A transaction-scoped advisory lock serialises writers to the same
 * chain, and a unique index on (freelancer, invoice, seq) makes a forked chain impossible.
 */
export async function audit(
  db: Runner | Pick<DB, "transaction">,
  e: { freelancerId: string; subjectId?: string | null; /** alias of subjectId for invoice entries */ invoiceId?: string | null; actor: Actor; action: string; ref?: string | null; outcome: Outcome; detail?: Record<string, unknown> },
) {
  const subjectId = e.subjectId ?? e.invoiceId ?? null;
  await (db as Runner).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mergepay-audit|${e.freelancerId}|${subjectId ?? "-"}`}, 0))`);
    const [last] = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog)
      .where(and(eq(auditLog.freelancerId, e.freelancerId), subjectId ? eq(auditLog.subjectId, subjectId) : isNull(auditLog.subjectId)))
      .orderBy(desc(auditLog.seq)).limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? genesisHash(e.freelancerId, subjectId);
    const createdAt = new Date();
    const detail = JSON.parse(JSON.stringify(e.detail ?? {})) as Record<string, unknown>;
    const hash = entryHash({ seq, freelancerId: e.freelancerId, subjectId, actor: e.actor, action: e.action, ref: e.ref ?? null, outcome: e.outcome, detail, createdAt: createdAt.toISOString(), prevHash });
    await tx.insert(auditLog).values({ freelancerId: e.freelancerId, subjectId, actor: e.actor, action: e.action, ref: e.ref ?? null, outcome: e.outcome, detail, createdAt, seq, prevHash, hash });
  });
}
