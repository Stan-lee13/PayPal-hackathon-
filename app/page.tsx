export const dynamic = "force-dynamic";

import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { HeroLedger } from "@/components/hero-ledger";

const MOMENTS = [
  {
    tag: "Before payment", title: "Stop the mismatch", tone: "broken" as const,
    lines: ["The assistant promises $84.00", "PayPal is about to charge $93.33", "Kept fetches the order from PayPal and blocks the capture", "The merchant corrects it; the buyer approves $84.00"],
    result: "Nothing is charged until the amount matches the promise.",
  },
  {
    tag: "After payment", title: "Repair what was already paid", tone: "kept" as const,
    lines: ["A payment captured elsewhere: $93.33 against $84.00", "Kept proves the $9.33 gap from PayPal’s own records", "The merchant approves one exact refund", "PayPal confirms it; the customer’s receipt updates"],
    result: "The broken promise is made good, with evidence.",
  },
];

const DECIDES = [
  ["AI reads the words", "Claude finds promises in the chat. It never decides money."],
  ["The validator decides what’s real", "The quote must appear verbatim, from the merchant, with no hedges."],
  ["PayPal is the truth", "Every order, capture and refund is re-fetched with GET."],
  ["Code does the maths", "Integer cents. No floats, no model."],
  ["A person approves every cent", "The merchant sees the exact PayPal request first."],
  ["The record can’t be rewritten", "Every step is on a SHA-256 hash chain anyone can verify."],
];

const PAYPAL = ["Orders v2 · custom_id binding", "Authoritative GET before capture", "Capture · PayPal-Request-Id", "Partial refunds · confirmed by GET", "Order tracking", "Disputes API", "Verified webhooks (CRC32 + RSA)"];
const KEPT = ["Promise validator · 46/46 golden", "Capture gate · coded verdicts", "Deterministic evaluator", "Policy engine", "Hash-chained evidence packs", "MCP promise record for agents", "AG Grid + AG Studio Intelligence"];

export default function Home() {
  return (
    <>
      <ModeBanner />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="quote text-2xl">Kept</Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm font-semibold">
          <Link href="/tour" className="hidden sm:inline">Tour</Link>
          <Link href="/store" className="hidden sm:inline">Store</Link>
          <Link href="/record/adaeze-studio" className="hidden md:inline">Promise record</Link>
          <Link href="/merchant" className="btn min-h-9 px-3 py-1">Merchant console</Link>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-20">
        <section className="grid items-center gap-10 py-8 sm:py-14 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="eyebrow">PayPal + AI · promise-to-payment accountability</p>
            <h1 className="quote mt-3 text-5xl leading-[1.04] sm:text-6xl">Every payment is a promise. <span className="text-accent">Kept</span> makes sure it&rsquo;s kept.</h1>
            <p className="measure mt-6 text-lg text-ink-soft">Merchants are now answerable for what their AI assistants say. Kept checks those promises against the PayPal order <strong className="text-ink">before money moves</strong>, and repairs them <strong className="text-ink">after</strong>, with a person approving every cent.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn btn-primary px-5" href="/tour">Take the 6-minute tour</Link>
              <Link className="btn px-5" href="/store">Try it as a customer</Link>
            </div>
            <p className="mt-5 text-xs text-ink-soft">Adaeze Studio is a demonstration merchant. Kept is an MVP, not production banking infrastructure.</p>
          </div>
          <HeroLedger />
        </section>

        <section aria-labelledby="moments-h" className="mt-10">
          <h2 id="moments-h" className="eyebrow">Two moments that matter</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {MOMENTS.map((m) => (
              <article key={m.title} className="paper p-6">
                <p className={`eyebrow ${m.tone === "broken" ? "text-broken" : "text-kept"}`}>{m.tag}</p>
                <h3 className="quote mt-1 text-3xl">{m.title}</h3>
                <ol className="mt-4 space-y-2 text-sm">
                  {m.lines.map((l, i) => (
                    <li key={l} className="flex gap-3"><span className="mono mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--hairline)] text-[0.65rem] text-ink-soft">{i + 1}</span><span>{l}</span></li>
                  ))}
                </ol>
                <p className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${m.tone === "broken" ? "bg-broken-wash text-broken" : "bg-kept-wash text-kept"}`}>{m.result}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="decides-h" className="mt-16">
          <h2 id="decides-h" className="quote text-3xl">The model reads. Code decides. PayPal is the truth.</h2>
          <ul className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--hairline)] sm:grid-cols-2 lg:grid-cols-3">
            {DECIDES.map(([t, d]) => <li key={t} className="bg-[var(--paper-raised)] p-5"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-ink-soft">{d}</p></li>)}
          </ul>
        </section>

        <section aria-labelledby="hood-h" className="mt-16 grid gap-6 md:grid-cols-2">
          <h2 id="hood-h" className="sr-only">Under the hood</h2>
          {([["PayPal, load-bearing", PAYPAL], ["Kept, deterministic", KEPT]] as const).map(([t, items]) => (
            <div key={t}>
              <p className="eyebrow">{t}</p>
              <ul className="mt-3 flex flex-wrap gap-2">{items.map((i) => <li key={i} className="mono rounded-full border border-[var(--hairline)] bg-[var(--paper-raised)] px-3 py-1 text-xs">{i}</li>)}</ul>
            </div>
          ))}
        </section>

        <section className="paper mt-16 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="quote text-2xl">See both moments in six minutes.</p>
            <p className="text-sm text-ink-soft">The tour says exactly what this instance runs: simulated or sandbox PayPal, Claude or labelled fallbacks.</p>
          </div>
          <Link className="btn btn-primary px-5" href="/tour">Start the tour</Link>
        </section>
      </main>
    </>
  );
}
