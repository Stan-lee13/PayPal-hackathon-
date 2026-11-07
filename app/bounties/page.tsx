import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { BountyHeader } from "@/components/bounty-header";
import { currentPersona } from "@/lib/security/persona";
import { companyStats, listOpenBounties } from "@/lib/services/bounties";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties" };

const LABEL: Record<string, [string, string]> = { OPEN: ["Open · funds reserved", "chip-PAID"], CLAIMED: ["Someone's on it", "chip-SENT"], IN_REVIEW: ["In review", "chip-SENT"], PAYING: ["Paying", "chip-MERGED"], PAID: ["Paid", "chip-MERGED"], DISPUTED: ["Disputed", "chip-MERGE_BLOCKED"] };

export default async function Board() {
  const p = await currentPersona();
  const rows = await listOpenBounties();
  const stats = new Map<string, Awaited<ReturnType<typeof companyStats>>>();
  for (const r of rows) if (!stats.has(r.company.id)) stats.set(r.company.id, await companyStats(r.company.id));
  return (
    <>
      <ModeBanner />
      <BountyHeader persona={p.key} />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold sm:text-3xl">Paid engineering tasks, funded before you start</h1>
            <p className="mt-1.5 text-ink-soft">Every bounty here has its money <strong>reserved on PayPal</strong> before anyone can claim it. Submissions are checked against CI on the exact commit, tampering with tests is caught, and the company approves before PayPal pays you.</p>
          </div>
          {p.kind === "company" && <Link className="btn btn-primary" href="/bounties/new">Post a bounty</Link>}
        </div>
        {rows.length === 0 ? (
          <div className="card mt-8 p-6 text-sm text-ink-soft">No funded bounties yet. {p.kind === "company" ? <Link className="link" href="/bounties/new">Post the first one</Link> : "Switch to the company persona to post one."}</div>
        ) : (
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {rows.map(({ b, company }) => {
              const s = stats.get(company.id)!;
              const [label, cls] = LABEL[b.status] ?? [b.status, "chip-DRAFT"];
              return (
                <li key={b.id}>
                  <Link href={`/bounties/${b.id}`} className="card block p-5 transition-shadow hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-semibold">{b.title}</p><p className="text-sm text-ink-soft">{company.name} · <span className="mono">{b.repo}</span></p></div>
                      <p className="money shrink-0 text-xl font-semibold">{formatMoney(b.amountMinor, b.currency)}</p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm">{b.summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`chip ${cls}`}>{label}</span>
                      {b.ndaRequired && <span className="kbd">NDA</span>}
                      {b.skills.map((k) => <span key={k} className="kbd">{k}</span>)}
                      <span className="ml-auto text-ink-soft">{b.criteria.length} criteria · {s.paid} paid · {s.rejectedPassing} rejected-against-verification</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
