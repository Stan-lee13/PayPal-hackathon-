import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { AcceptInvitation } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "An invitation", robots: { index: false, follow: false } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <p className="label">An invitation to an organization</p>
        <h1 className="display mt-3 text-[clamp(2.2rem,5vw,3.4rem)]">Join them</h1>
        <AcceptInvitation token={token} />
      </main>
    </>
  );
}
