import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { CardsView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cards" };

export default function CardsPage() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4"><CardsView /></main>
    </>
  );
}
