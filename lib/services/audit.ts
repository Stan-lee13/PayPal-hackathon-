import type { DB } from "../db";
import { auditLog } from "../db/schema";

type Actor = "ai" | "merchant" | "system" | "paypal" | "customer";
type Outcome = "OK" | "REJECTED" | "FAILED" | "PENDING" | "INFO";

export async function audit(
  db: Pick<DB, "insert">,
  e: { merchantId: string; orderId?: string | null; actor: Actor; action: string; ref?: string | null; outcome: Outcome; detail?: Record<string, unknown> },
) {
  await db.insert(auditLog).values({
    merchantId: e.merchantId,
    orderId: e.orderId ?? null,
    actor: e.actor,
    action: e.action,
    ref: e.ref ?? null,
    outcome: e.outcome,
    detail: e.detail ?? {},
  });
}
