import { currentMerchant } from "@/lib/security/session";
import { promiseAnalytics } from "@/lib/services/analytics";
import { PromiseStudio } from "./studio";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const merchantId = (await currentMerchant())!;
  const data = await promiseAnalytics(merchantId);
  const licensed = Boolean(process.env.AG_STUDIO);
  return (
    <>
      <h1 className="quote text-3xl">Promise analytics</h1>
      <p className="text-sm text-ink-soft">How often your business keeps its word, where promises are made, and what it cost to make broken ones good. Built only from Kept&rsquo;s own records and PayPal-confirmed amounts.{licensed ? "" : " AG Studio is running without a licence key (evaluation mode)."}</p>
      {data.promises.length === 0
        ? <div className="paper mt-6 p-8 text-center"><p className="quote text-xl">No promises yet.</p><p className="mt-1 text-sm text-ink-soft">Place a demo order at the store; analytics fill in from real ledger data.</p></div>
        : <PromiseStudio data={data} licenseKey={process.env.AG_STUDIO} />}
    </>
  );
}
