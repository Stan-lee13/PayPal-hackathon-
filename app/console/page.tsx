import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { Flap, Meter, Sigil, Stamp, usd } from "@/components/stationery";
import { getDb } from "@/lib/db";
import { roots } from "@/lib/db/schema";
import { recentAgents } from "@/lib/gateway/service";
import { SealForm } from "./seal-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seal an envelope" };

export default async function Console() {
  const [list, agents] = await Promise.all([getDb().select().from(roots).orderBy(desc(roots.createdAt)).limit(5), recentAgents(8)]);
  const payees = [process.env.ENVELOPE_PAYEE_1 || "translator@example.com", process.env.ENVELOPE_PAYEE_2 || "designer@example.com"];
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-6xl gap-x-12 gap-y-12 px-5 pb-20 pt-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
        <section>
          <p className="label">Form E-1 · an account for your agent</p>
          <h1 className="display mt-3 text-[clamp(2.2rem,5vw,3.4rem)]">Seal an envelope</h1>
          <p className="mt-4 max-w-xl text-ink-2">You sign it in this browser. PayPal places a hold for the whole amount, so the money is really there and can never be exceeded. Your agent gets the envelope, not your wallet.</p>
          <SealForm defaultPayees={payees} />
        </section>

        <aside className="space-y-10 lg:pt-10">
          <section>
            <h2 className="label">Envelopes on file</h2>
            {list.length === 0 ? <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">None yet. Seal the first one.</p> : (
              <ul className="mt-4 space-y-4">
                {list.map((r) => (
                  <li key={r.id}>
                    <Link href={`/e/${r.id}`} className={`envl block px-4 pb-3.5 pt-9 transition-transform duration-150 ease-out active:scale-[.985] ${r.status === "ACTIVE" ? "" : "envl-dead"}`}>
                      <Flap />
                      <span className="flex items-end justify-between gap-3">
                        <span className="envl-label min-w-0 px-2.5 py-1.5"><span className="title block truncate text-[1.02rem] leading-tight">{r.title}</span><span className="mono block text-[.66rem] text-ink-2">{r.principalName} · {r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} {r.createdAt.toISOString().slice(11, 16)} UTC</span></span>
                        <span className="shrink-0 text-right"><span className="mono block text-[.78rem]">{usd(r.capturedMinor)} of {usd(r.limitMinor)}</span><Stamp tone={r.status === "ACTIVE" ? "green" : "grey"} className="mt-1">{r.status === "ACTIVE" ? "Open" : "Closed"}</Stamp></span>
                      </span>
                      <span className="mt-2.5 block"><Meter spent={r.capturedMinor} freed={r.releasedMinor ?? 0} of={r.limitMinor} label={`${usd(r.capturedMinor)} of ${usd(r.limitMinor)} spent`} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {agents.length > 0 && (
            <section>
              <h2 className="label">Agents on file</h2>
              <ul className="ledger mt-3 border-t-[1.5px] border-ink">
                {agents.map((a) => (
                  <li key={a.key}>
                    <Link href={`/a/${a.key}`} className="flex items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-sheet">
                      <span className="text-blue"><Sigil k={a.key} size={34} /></span>
                      <span className="min-w-0 flex-1"><span className="title block truncate">{a.label}</span><span className="mono block text-[.68rem] tracking-[.06em] text-ink-2">{a.account}</span></span>
                      <span className="mono text-[.7rem] text-ink-3">passport →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </main>
    </>
  );
}
