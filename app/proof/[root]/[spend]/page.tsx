import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { ProofView } from "../../view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proof of one payment" };

export default async function PaymentProofPage({ params }: { params: Promise<{ root: string; spend: string }> }) {
  const { root, spend } = await params;
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1340px] px-5 pb-20 pt-4"><ProofView rootId={root} spendId={spend} /></main>
    </>
  );
}
