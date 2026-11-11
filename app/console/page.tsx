import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { OnFile } from "./on-file";
import { SealForm } from "./seal-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seal an envelope" };

export default function Console() {
  const designer = process.env.ENVELOPE_PAYEE_2 || "designer@example.com";
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-6xl gap-x-12 gap-y-12 px-5 pb-20 pt-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
        <section>
          <p className="label">Form E-1 · an account for your agent</p>
          <h1 className="display mt-3 text-[clamp(2.2rem,5vw,3.4rem)]">Seal an envelope</h1>
          <p className="mt-4 max-w-xl text-ink-2">You sign it in this browser. PayPal places a hold for the whole amount, so the money is really there and can never be exceeded. Your agent gets the envelope, not your wallet.</p>
          <SealForm designer={designer} />
        </section>

        <OnFile />
      </main>
    </>
  );
}
