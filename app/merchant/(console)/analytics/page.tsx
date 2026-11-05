import { currentMerchant } from "@/lib/security/session";
import { promiseAnalytics } from "@/lib/services/analytics";
import { PromiseStudio } from "./studio";

export const metadata = { title: "Kept Intelligence" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const merchantId = (await currentMerchant())!;
  const data = await promiseAnalytics(merchantId);
  const licensed = Boolean(process.env.AG_STUDIO);
  return (
    <>
      <h1 className="quote text-3xl">Kept Intelligence</h1>
      <p className="text-sm text-ink-soft">How often your business keeps its word; what Kept stopped before payment and repaired after; and how reliable the promise extraction is. Built only from Kept&rsquo;s persisted records and PayPal-confirmed amounts; money is shown per currency, never summed across currencies. In simulated mode every figure comes from the local PayPal emulator.{licensed ? "" : " AG Studio is running without a licence key (evaluation mode)."}</p>
      {data.orders.length === 0
        ? <div className="paper mt-6 p-8 text-center"><p className="quote text-xl">No promises yet.</p><p className="mt-1 text-sm text-ink-soft">Place a demo order at the store; analytics fill in from real ledger data.</p></div>
        : <PromiseStudio data={data} licenseKey={process.env.AG_STUDIO} />}
    </>
  );
}
