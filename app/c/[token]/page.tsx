import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { StatusChip } from "@/components/invoice-card";
import { getDb } from "@/lib/db";
import { freelancers, invoices } from "@/lib/db/schema";
import { contractByClientToken } from "@/lib/services/contracts";
import { formatMoney } from "@/lib/money";
import { AcceptButton } from "./accept-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your contract", robots: { index: false } };

export default async function ClientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await contractByClientToken(token);
  if (!found) notFound();
  const { c, client } = found;
  const fl = (await getDb().query.freelancers.findFirst({ where: eq(freelancers.id, c.freelancerId) }))!;
  const list = await getDb().query.invoices.findMany({ where: eq(invoices.contractId, c.id), orderBy: desc(invoices.createdAt), limit: 20 });
  const m = (n: number) => formatMoney(n, c.currency);
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        <p className="eyebrow">For {client.name}{client.company ? `, ${client.company}` : ""}</p>
        <h1 className="mt-1 text-2xl font-semibold">{c.title}</h1>
        <p className="mt-1 text-ink-soft">with {fl.name} · code in <span className="mono">{c.repo}</span></p>

        <section className="card mt-6 p-5">
          <h2 className="font-semibold">What you&rsquo;re agreeing to</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li><strong>Agreed prices.</strong> {c.pricing === "FIXED_PER_ISSUE"
              ? <>You pay a fixed price per issue: {Object.entries(c.issuePrices).slice(0, 6).map(([k, v]) => `#${k} ${m(v)}`).join(", ")}. Issues without a price are never billed.</>
              : <>{c.hourlyRateMinor ? m(c.hourlyRateMinor) : "—"} an hour, at most {c.maxHoursPerInvoice ?? "—"} hours per invoice without asking you.</>}</li>
            <li><strong>One invoice per pull request</strong>, sent through PayPal. You can open the preview before you pay.</li>
            {c.mergeOnPayment && <li><strong>Merge on payment.</strong> When PayPal confirms you&rsquo;ve paid an invoice in full, MergePay merges that pull request into your repository. Only the exact commit on the invoice is merged; if anything changed after the invoice was sent, nothing merges and you&rsquo;re both told.</li>}
            <li><strong>Extra work is never slipped in.</strong> Anything outside the agreed issues is flagged and not billed, unless it&rsquo;s listed separately as a change request you can see.</li>
          </ul>
          <div className="mt-5">
            {c.clientAcceptedAt
              ? <p className="chip chip-PAID">You accepted on {c.clientAcceptedAt.toISOString().slice(0, 10)}</p>
              : <AcceptButton token={token} />}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold">Invoices</h2>
          {list.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None yet.</p> : (
            <ul className="mt-3 space-y-2">
              {list.map((i) => (
                <li key={i.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div>
                    <p className="font-medium">{i.paypalInvoiceNumber ?? "Draft"} · PR #{i.prNumber} {i.prTitle}</p>
                    <p className="text-xs text-ink-soft">{m(i.amountMinor)} · commit <span className="mono">{i.headSha.slice(0, 7)}</span>{i.previewUrl ? <> · <a className="link" href={i.previewUrl} target="_blank" rel="noreferrer">preview ↗</a></> : null}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip status={i.status} />
                    {i.status === "SENT" && i.payerViewUrl && <a className="btn btn-sm btn-primary" href={i.payerViewUrl} target="_blank" rel="noreferrer">Pay with PayPal ↗</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
