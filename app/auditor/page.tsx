import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { AuditorView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The auditor" };

export default function AuditorPage() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4"><AuditorView /></main>
    </>
  );
}
