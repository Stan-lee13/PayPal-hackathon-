import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { SimCheckout } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PayPal simulator: approve a hold" };

/** Stands in for PayPal's own checkout on the simulator: the page where the payer approves the hold. */
export default function SimPayPal() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-xl px-5 pb-24 pt-8">
        <SimCheckout />
      </main>
    </>
  );
}
