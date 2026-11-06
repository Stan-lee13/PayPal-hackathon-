import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { AppHeader } from "@/components/app-header";
import { InvoiceGrid, type InvoiceRow } from "@/components/invoice-grid";
import { getDb } from "@/lib/db";
import { clients, contracts, invoices } from "@/lib/db/schema";
import { currentFreelancer } from "@/lib/security/session";
import { formatMoney } from "@/lib/money";
import { ResetDemo } from "./reset-demo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices" };

export default async function Dashboard() {
  const fl = await currentFreelancer();
  if (!fl) redirect("/app/login");
  const db = getDb();
  const list = await db.query.invoices.findMany({ where: eq(invoices.freelancerId, fl), orderBy: desc(invoices.createdAt), limit: 500 });
  const cs = await db.select({ c: contracts, client: clients }).from(contracts).innerJoin(clients, eq(clients.id, contracts.clientId)).where(eq(contracts.freelancerId, fl));
  const sum = (s: string[]) => list.filter((i) => s.includes(i.status)).reduce((a, i) => a + (i.paidAmountMinor ?? i.amountMinor), 0);
  const cur = list[0]?.currency ?? cs[0]?.c.currency ?? "USD";
  const rows: InvoiceRow[] = list.map((i) => ({ id: i.id, number: i.paypalInvoiceNumber, repo: i.repo, pr: i.prNumber, title: i.prTitle, status: i.status, amountMinor: i.amountMinor, amount: formatMoney(i.amountMinor, i.currency), currency: i.currency, createdAt: i.createdAt.toISOString(), paidAt: i.paidAt?.toISOString() ?? null, mergedAt: i.mergedAt?.toISOString() ?? null, outOfScope: i.scope.outOfScope.length }));
  const stats = [
    { label: "Awaiting payment", value: formatMoney(sum(["SENT"]), cur), n: list.filter((i) => i.status === "SENT").length },
    { label: "Paid via PayPal", value: formatMoney(list.filter((i) => i.paidAt).reduce((a, i) => a + (i.paidAmountMinor ?? 0), 0), cur), n: list.filter((i) => i.paidAt).length },
    { label: "Merged on payment", value: String(list.filter((i) => i.status === "MERGED").length), n: null },
    { label: "Need your attention", value: String(list.filter((i) => i.status === "MERGE_BLOCKED").length), n: null },
  ];
  return (
    <>
      <ModeBanner />
      <AppHeader current="invoices" />
      <main id="main" className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Invoices</h1>
            <p className="text-sm text-ink-soft">Every pull request you&rsquo;ve billed, and where its money and merge stand.</p>
          </div>
          <ResetDemo />
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="card p-4">
              <dt className="text-xs text-ink-soft">{s.label}</dt>
              <dd className="money mt-1 text-xl font-semibold">{s.value}{s.n !== null && <span className="ml-1.5 text-xs font-normal text-ink-soft">{s.n} invoice{s.n === 1 ? "" : "s"}</span>}</dd>
            </div>
          ))}
        </dl>
        <InvoiceGrid rows={rows} />
        <section>
          <h2 className="font-semibold">Contracts</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {cs.map(({ c, client }) => (
              <li key={c.id} className="card p-4 text-sm">
                <p className="font-semibold">{c.title}</p>
                <p className="text-ink-soft">{client.name}{client.company ? `, ${client.company}` : ""} · <span className="mono">{c.repo}</span> · invoices go to {client.email}</p>
                <p className="mt-2 text-xs">{c.pricing === "FIXED_PER_ISSUE" ? Object.entries(c.issuePrices).map(([k, v]) => `#${k} ${formatMoney(v, c.currency)}`).join(" · ") : `${formatMoney(c.hourlyRateMinor ?? 0, c.currency)}/h, max ${c.maxHoursPerInvoice}h per invoice`}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {c.clientAcceptedAt ? <span className="chip chip-PAID">Client accepted {c.clientAcceptedAt.toISOString().slice(0, 10)}</span> : <span className="chip chip-MERGE_BLOCKED">Waiting for the client to accept</span>}
                  <Link className="link text-xs" href={`/c/${c.clientToken}`} target="_blank">Client&rsquo;s page (send them this link) ↗</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
