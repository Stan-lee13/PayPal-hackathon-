import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { ProofView } from "../view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proof graph" };

export default async function ProofPage({ params }: { params: Promise<{ root: string }> }) {
  const { root } = await params;
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1340px] px-5 pb-20 pt-4"><ProofView rootId={root} /></main>
    </>
  );
}
