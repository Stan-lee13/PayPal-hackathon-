import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeBanner } from "@/components/mode-banner";
import { promiseRecord } from "@/lib/services/promise-record";
import { appBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Promise record" };

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default async function RecordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) notFound();
  const r = await promiseRecord(slug);
  if (!r) notFound();
  const base = appBaseUrl();
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        <p className="eyebrow">Promise record · verified by Kept against PayPal</p>
        <h1 className="quote mt-2 text-4xl">{r.merchant.name}</h1>
        <p className="mt-2 text-ink-soft">How often this shop kept what it — or its AI sales assistant — promised: the price quoted, shipping on time, refunds on time.</p>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["Kept as promised", pct(r.keptAsPromisedRate)], ["Kept or made good", pct(r.keptOrMadeGoodRate)], ["Resolved promises", String(r.resolved)], ["Still broken", String(r.brokenStillOpen)]] as const).map(([k, v]) => (
            <div key={k} className="paper p-3"><dt className="eyebrow">{k}</dt><dd className="money mt-1 text-2xl">{v}</dd></div>
          ))}
        </dl>

        <table className="mt-6 w-full text-left text-sm">
          <thead className="rule-b"><tr className="eyebrow"><th className="py-2 font-semibold">Promise</th><th className="text-right font-semibold">Kept</th><th className="text-right font-semibold">Made good</th><th className="text-right font-semibold">Open</th></tr></thead>
          <tbody>{r.byType.map((t) => <tr key={t.type} className="rule-b"><td className="py-2">{t.label}</td><td className="money text-right">{t.keptAsPromised}</td><td className="money text-right">{t.brokenThenMadeGood}</td><td className="money text-right">{t.brokenStillOpen}</td></tr>)}</tbody>
        </table>

        <p className={`mt-4 text-sm ${r.auditChains.intact ? "text-kept" : "text-broken font-semibold"}`}>
          {r.auditChains.intact ? `✓ ${r.auditChains.verified === 1 ? "The 1 order history" : `All ${r.auditChains.verified} order histories`} behind this record re-verified intact (SHA-256 audit chains) just now.` : "✕ An order history behind this record failed verification."}
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-soft">{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>

        <section className="paper mt-8 p-4 text-sm" aria-labelledby="agents-h">
          <h2 id="agents-h" className="font-semibold">For AI shopping agents</h2>
          <p className="mt-1 text-ink-soft">Read this record before buying. JSON: <span className="mono break-all">GET {base}/api/promise-record/{r.merchant.slug}</span>. MCP (Streamable HTTP): <span className="mono break-all">{base}/api/mcp</span>, tool <span className="mono">get_promise_record</span> with <span className="mono">{`{"merchant":"${r.merchant.slug}"}`}</span>. Read-only; aggregates only — no customer data.</p>
        </section>
        <p className="mt-6 text-xs text-ink-soft">{r.method} As of {r.asOf.slice(0, 16).replace("T", " ")} UTC.</p>
      </main>
    </>
  );
}
