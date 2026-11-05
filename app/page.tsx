export const dynamic = "force-dynamic";

import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { StateSeal } from "@/components/seal";

export default function Home() {
  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <p className="eyebrow">Payment accountability for PayPal merchants</p>
        <h1 className="quote mt-3 text-4xl leading-tight sm:text-6xl">Every payment is a promise.<br />Kept makes sure it&rsquo;s kept.</h1>
        <p className="mt-6 max-w-2xl text-lg text-ink-soft">
          Kept reads what a merchant — or the merchant&rsquo;s AI sales assistant — promised, binds those promises to the PayPal order, watches PayPal&rsquo;s own records, and proposes a fix when they disagree. The merchant approves every cent.
        </p>

        <div className="mt-10 grid gap-0 overflow-hidden rounded-lg border border-rule sm:grid-cols-[1fr_auto_1fr]">
          <div className="bg-raised p-5">
            <p className="eyebrow">Said</p>
            <blockquote className="quote mt-2 text-xl">&ldquo;Your total is $84.00.&rdquo;</blockquote>
            <p className="mt-1 text-sm text-ink-soft">Adaeze Studio&rsquo;s AI assistant</p>
          </div>
          <div className="flex items-center justify-center border-y border-rule bg-paper p-4 sm:border-x sm:border-y-0"><StateSeal state="BROKEN" size="lg" /></div>
          <div className="bg-raised p-5">
            <p className="eyebrow">Happened</p>
            <p className="money mt-2 text-xl">$93.33 captured</p>
            <p className="mt-1 text-sm text-ink-soft">PayPal capture · overcharged $9.33</p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/store">Shop at Adaeze Studio (customer)</Link>
          <Link className="btn" href="/merchant">Open the merchant console</Link>
        </div>
        <p className="mt-4 text-sm text-ink-soft">Adaeze Studio is a demonstration merchant. Kept is an MVP: not production banking infrastructure.</p>

        <ol className="mt-14 grid gap-6 sm:grid-cols-3">
          {[
            ["Capture the promise", "Promises are extracted from the sales chat and policies, and only enforced if the exact words are found verbatim in the merchant's own source."],
            ["Watch PayPal", "Signed webhooks and authoritative GETs of the capture, refunds and tracking — the webhook body is never treated as payment truth."],
            ["Fix it with consent", "A deterministic engine computes the gap; AI drafts the remedy; the merchant sees the exact PayPal request and approves it."],
          ].map(([t, d], i) => (
            <li key={t} className="rule-t pt-4">
              <span className="mono text-sm text-ink-soft">0{i + 1}</span>
              <h2 className="mt-1 font-semibold">{t}</h2>
              <p className="mt-1 text-sm text-ink-soft">{d}</p>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
