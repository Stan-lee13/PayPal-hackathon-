import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { BountyHeader } from "@/components/bounty-header";
import { currentPersona } from "@/lib/security/persona";
import { BOUNTY_CRITERIA, BOUNTY_ISSUE, BOUNTY_REPO } from "@/lib/github/bounty-fixtures";
import { githubMode } from "@/lib/github/client";
import { NewBountyForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post a bounty" };

export default async function NewBounty() {
  const p = await currentPersona();
  const demo = githubMode() === "simulated" ? { repo: BOUNTY_REPO, issue: String(BOUNTY_ISSUE) } : { repo: process.env.DEMO_BOUNTY_REPO ?? "", issue: "" };
  return (
    <>
      <ModeBanner />
      <BountyHeader persona={p.key} />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="text-2xl font-semibold">Post a bounty</h1>
        <p className="mt-1 text-ink-soft">You&rsquo;ll approve a PayPal <strong>authorization</strong> for the bounty plus MergePay&rsquo;s 5% fee. Nothing is charged until you approve a verified submission; cancelling releases the hold.</p>
        {p.kind !== "company" ? <p className="card mt-6 p-4 text-sm">Switch to the company persona (top right) to post.</p> : <NewBountyForm demo={{ ...demo, criteria: BOUNTY_CRITERIA.join("\n") }} />}
      </main>
    </>
  );
}
