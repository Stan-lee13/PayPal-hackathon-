import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { getDb } from "@/lib/db";
import { roots } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { SealForm } from "./seal-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Console" };

export default async function Console() {
  const list = await getDb().select().from(roots).orderBy(desc(roots.createdAt)).limit(12);
  const payees = [process.env.ENVELOPE_PAYEE_1 || "translator@example.com", process.env.ENVELOPE_PAYEE_2 || "designer@example.com"];
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section>
          <h1 className="text-2xl font-semibold sm:text-3xl">Seal an envelope</h1>
          <p className="mt-1.5 text-ink-soft">You sign it in this browser. The gateway places a PayPal hold for the whole amount, so the money is guaranteed and can never be exceeded. Your agent gets the envelope, not your wallet.</p>
          <SealForm defaultPayees={payees} />
        </section>
        <section>
          <h2 className="font-semibold">Recent envelopes</h2>
          {list.length === 0 ? <p className="mt-3 text-sm text-ink-soft">None yet. Seal the first one.</p> : (
            <ul className="mt-3 space-y-2">
              {list.map((r) => (
                <li key={r.id}>
                  <Link href={`/e/${r.id}`} className="card flex items-center justify-between gap-3 p-4 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{r.title}</span><span className="text-xs text-ink-soft">{r.principalName} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span></span>
                    <span className="flex shrink-0 items-center gap-2"><span className="money">{formatMoney(r.capturedMinor, r.currency)} / {formatMoney(r.limitMinor, r.currency)}</span><span className={`chip chip-${r.status}`}>{r.status === "ACTIVE" ? "Open" : "Closed"}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
