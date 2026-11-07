import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "1", title: "Agree once", body: "The client accepts the prices (per issue, or an hourly rate) and merge-on-payment on their own page. MergePay won't invoice under terms they haven't seen." },
  { n: "2", title: "Bill from your editor", body: "Tell the agent “bill this PR”. It reads the PR and the issues it closes, prices it from the contract, writes line items the client can understand, and flags work nobody agreed to." },
  { n: "3", title: "Paid, then merged", body: "You approve; PayPal emails the invoice. The client checks the preview and pays. PayPal's webhook arrives, MergePay re-reads the invoice from PayPal, and merges exactly the commit that was paid for." },
];

const GUARANTEES = [
  { title: "The contract sets the numbers", body: "Amounts come from the agreed prices, in code. The AI writes descriptions and a scope check, never an amount, and hours always come from you." },
  { title: "Nothing goes out without you", body: "Sending, reminding and cancelling need your explicit yes. The agent shows you the draft first; the tool refuses without confirm: true." },
  { title: "Paid means paid", body: "Before touching the repo, MergePay asks PayPal directly: status PAID, nothing due. A partial payment, a pending one, or “marked as paid” by hand never merges." },
  { title: "Only what was paid for", body: "The merge is pinned to the invoiced commit. Push anything after the invoice and it won't merge. Every step lands on a SHA-256 chained, tamper-evident trail." },
];

export default function Home() {
  return (
    <>
      <ModeBanner />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <span className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></span>
        <nav className="flex items-center gap-1 text-sm">
          <a className="btn btn-ghost btn-sm" href="#how">How it works</a>
          <Link className="btn btn-ghost btn-sm" href="/bounties">Bounties</Link>
          <Link className="btn btn-ghost btn-sm" href="/connect">Connect your editor</Link>
          <Link className="btn btn-sm" href="/app">Dashboard</Link>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <p className="eyebrow seq">For freelance developers · PayPal Invoicing · MCP</p>
            <h1 className="seq mt-3 text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ animationDelay: "60ms" }}>Get paid before you merge.</h1>
            <p className="seq mt-4 max-w-xl text-lg text-ink-soft" style={{ animationDelay: "120ms" }}>
              Ask your editor&rsquo;s agent to bill a pull request. MergePay drafts a PayPal invoice from the price you agreed with the client, sends it when you say so, and merges the PR the moment PayPal confirms the payment.
            </p>
            <div className="seq mt-7 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
              <Link className="btn btn-primary" href="/demo">Try it in your browser →</Link>
              <Link className="btn" href="/connect">Connect Cursor or Claude Code</Link>
            </div>
            <p className="seq mt-4 text-sm text-ink-soft" style={{ animationDelay: "240ms" }}>No install needed for the demo. It runs the same tools your editor would.</p>
          </div>

          <figure className="code card-lift seq overflow-hidden" style={{ animationDelay: "160ms" }}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-code-soft">
              <span>agent · mergepay</span><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">Example</span>
            </div>
            <div className="space-y-2.5 px-4 py-4 text-[13px]">
              <p><span className="text-code-soft">you ›</span> bill Lagos Roast for PR #18</p>
              <p><span className="text-[#9be8c8]">✓ draft_invoice</span> <span className="text-code-soft">{'{ repo: "lagosroast/storefront", pr: 18 }'}</span></p>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="flex justify-between"><span>#12 Add PayPal checkout to the cart page</span><span>$450.00</span></p>
                <p className="flex justify-between"><span>#14 Menu overflows on small phones</span><span>$80.00</span></p>
                <p className="mt-1 flex justify-between border-t border-white/10 pt-1 font-semibold"><span>Total</span><span>$530.00</span></p>
                <p className="mt-1.5 text-[12px] text-[#f6cf93]">Not billed: analytics rewrite in lib/analytics.ts (no issue asked for it)</p>
              </div>
              <p><span className="text-code-soft">you ›</span> looks right, send it</p>
              <p><span className="text-[#9be8c8]">✓ send_invoice</span> <span className="text-code-soft">MP-0001 sent via PayPal to the client</span></p>
              <p className="text-code-soft">paypal › INVOICING.INVOICE.PAID · re-read: PAID, $0.00 due</p>
              <p className="text-[#c9b4ff]">✓ merged 9f3c2ab into main · comment posted on the PR</p>
            </div>
          </figure>
        </section>

        <section id="how" className="border-y border-rule bg-raised/60">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold">How it works</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="card p-5">
                  <span className="mono inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{s.n}</span>
                  <h3 className="mt-3 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-ink-soft">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold">An agent that moves money has to be boring about it</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">The AI makes billing effortless. Everything that decides money or touches your client&rsquo;s code is deterministic, checked against PayPal and GitHub, and logged.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="card p-5">
                <h3 className="font-semibold">{g.title}</h3>
                <p className="mt-1.5 text-sm text-ink-soft">{g.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-lg font-semibold">See a PR go from invoice to merged in about a minute</h2>
              <p className="text-sm text-ink-soft">Built on the PayPal Invoicing API v2, signature-verified PayPal webhooks, the Model Context Protocol, the GitHub API and Claude (optional, capped).</p>
            </div>
            <Link className="btn btn-primary" href="/demo">Open the live demo →</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-ink-soft">
          <span>MergePay · MIT licence · built for the PayPal AI Hackathon 2026</span>
          <span>Sandbox and simulated modes are labelled on every page.</span>
        </div>
      </footer>
    </>
  );
}
