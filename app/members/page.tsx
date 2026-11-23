import type { Metadata } from "next";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { MembersView } from "./view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <p className="label">The organization</p>
        <h1 className="display mt-3 text-[clamp(2.2rem,5vw,3.4rem)]">Members</h1>
        <p className="mt-4 max-w-2xl text-ink-2">
          Everyone who can act for this organization, with the role that decides what they may do. An invitation
          is a single-use link bound to one address: the person who opens it joins at the role it names, and only
          if they are signed in as that address.
        </p>
        <MembersView />
      </main>
    </>
  );
}
