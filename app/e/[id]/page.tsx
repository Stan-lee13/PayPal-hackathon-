import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { EnvelopeView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Envelope" };

export default async function EnvelopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16"><EnvelopeView id={id} /></main>
    </>
  );
}
