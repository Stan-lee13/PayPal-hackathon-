import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { InvoiceCard } from "@/components/invoice-card";
import { getDb } from "@/lib/db";
import { auditLog, invoices } from "@/lib/db/schema";
import { currentFreelancer } from "@/lib/security/session";
import { invoiceView } from "@/lib/services/views";
import { verifyChain, type ChainEntry } from "@/lib/ledger/chain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice" };

const ACTION: Record<string, string> = {
  "invoice.drafted": "Draft written from the PR and the contract", "invoice.redrafted": "Draft refreshed", "invoice.sent": "Sent via PayPal",
  "invoice.paid": "PayPal confirmed full payment", "pr.merged": "Merged on GitHub", "merge.blocked": "Merge refused", "invoice.cancelled": "Cancelled",
  "invoice.reminded": "Reminder sent by PayPal", "invoice.send_failed": "PayPal refused the invoice", "invoice.payment_incomplete": "Payment not complete yet",
  "invoice.marked_paid_externally": "Marked paid outside PayPal", "invoice.amount_mismatch": "Paid amount didn't match", "pr.comment_failed": "Couldn't comment on the PR",
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const fl = await currentFreelancer();
  if (!fl) redirect("/app/login");
  const { id } = await params;
  const inv = await getDb().query.invoices.findFirst({ where: and(eq(invoices.id, id), eq(invoices.freelancerId, fl)) });
  if (!inv) notFound();
  const trail = await getDb().select().from(auditLog).where(eq(auditLog.subjectId, inv.id)).orderBy(asc(auditLog.seq));
  const verdict = verifyChain(fl, inv.id, trail.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) as ChainEntry[]);
  const v = invoiceView(inv);
  return (
    <>
      <ModeBanner />
      <AppHeader current="invoices" />
      {(inv.status === "SENT" || inv.status === "PAID") && <AutoRefresh seconds={4} />}
      <main id="main" className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Link href="/app" className="link text-sm">← Invoices</Link>
          <InvoiceCard inv={v} />
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="btn btn-sm" href={v.prUrl} target="_blank" rel="noreferrer">Pull request ↗</a>
            {v.previewUrl && <a className="btn btn-sm" href={v.previewUrl} target="_blank" rel="noreferrer">Preview ↗</a>}
            {v.paypal?.payerUrl && <a className="btn btn-sm" href={v.paypal.payerUrl} target="_blank" rel="noreferrer">Client&rsquo;s PayPal page ↗</a>}
          </div>
        </div>
        <section aria-labelledby="trail">
          <div className="flex items-center justify-between gap-2">
            <h2 id="trail" className="font-semibold">Audit trail</h2>
            {verdict.ok
              ? <span className="chip chip-PAID" title={`Head ${verdict.head}`}>Chain intact · {verdict.length} entries</span>
              : <span className="chip chip-MERGE_BLOCKED">Chain broken at #{verdict.brokenAtSeq}</span>}
          </div>
          <p className="mt-1 text-xs text-ink-soft">Each entry is SHA-256 linked to the one before it, so editing or deleting any of them breaks the chain.</p>
          <ol className="mt-4 space-y-4">
            {trail.map((t) => (
              <li key={t.id} className="step">
                <span className={`dot ${t.outcome === "OK" ? "dot-done" : t.outcome === "REJECTED" || t.outcome === "FAILED" ? "dot-bad" : "dot-now"}`} aria-hidden="true" />
                <p className="text-sm font-medium">{ACTION[t.action] ?? t.action}</p>
                <p className="text-xs text-ink-soft">{t.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC · by {t.actor}{t.ref ? <> · <span className="mono">{t.ref.length > 40 ? t.ref.slice(0, 40) + "…" : t.ref}</span></> : null}</p>
                {typeof t.detail.reason === "string" && <p className="mt-1 text-xs">{t.detail.reason}</p>}
                <p className="mono mt-1 text-[10px] text-ink-soft">#{t.seq} {t.hash.slice(0, 16)}…</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
