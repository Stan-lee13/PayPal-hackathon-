import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { AgentView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent passport" };

export default async function AgentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4"><AgentView agentKey={key} /></main>
    </>
  );
}
