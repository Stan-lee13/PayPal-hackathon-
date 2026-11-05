import { currentMerchant } from "@/lib/security/session";
import { merchantAudit } from "@/lib/services/views";
import { LedgerGrid, type ActivityRow } from "@/components/ledger-grid";

export const metadata = { title: "Activity" };

const ACTOR: Record<string, string> = { ai: "AI proposal", merchant: "Merchant decision", system: "Kept system", paypal: "PayPal-confirmed", customer: "Customer" };

export default async function ActivityPage() {
  const merchantId = (await currentMerchant())!;
  const rows: ActivityRow[] = (await merchantAudit(merchantId, 500)).map((a) => ({
    id: a.id, at: a.createdAt.toISOString(), actor: ACTOR[a.actor] ?? a.actor, action: a.action, outcome: a.outcome, orderId: a.orderId,
    detail: Object.keys(a.detail).length ? JSON.stringify(a.detail) : "",
  }));
  return (
    <>
      <h1 className="quote text-3xl">Activity</h1>
      <p className="text-sm text-ink-soft">Every action, attributed: AI proposals, merchant decisions, Kept system events and PayPal-confirmed outcomes. Filter by who acted or by outcome.</p>
      <LedgerGrid kind="activity" rows={rows} searchLabel="Search the audit trail…" />
    </>
  );
}
