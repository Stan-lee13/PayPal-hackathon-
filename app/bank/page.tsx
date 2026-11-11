import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { BankView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The books" };

export default function BankPage() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4"><BankView /></main>
    </>
  );
}
