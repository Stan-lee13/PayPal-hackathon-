import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { AuditView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit trail" };

export default function AuditPage() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <p className="label">The organization</p>
        <h1 className="display mt-3 text-[clamp(2.2rem,5vw,3.4rem)]">Audit trail</h1>
        <p className="mt-4 max-w-2xl text-ink-2">
          Every administrative decision this organization has made — an invitation issued, withdrawn or accepted, a
          role changed, a member removed — in the order it was made. Each entry is linked to the one before it, so an
          edit in the middle shows up here instead of going unnoticed. Nothing on this page changes anything.
        </p>
        <AuditView />
      </main>
    </>
  );
}
