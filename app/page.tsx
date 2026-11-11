import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import evidence from "@/docs/evidence/sandbox-run.json";

export const dynamic = "force-dynamic";

const STEPS = [
  { verb: "Seal", who: "You", paypal: "PayPal authorization (hold)", body: "Sign an envelope in your browser: how much, to whom, for what, until when. The gateway places a PayPal hold for the whole amount. Nothing is charged." },
  { verb: "Split", who: "Any agent", paypal: "nothing — it's offline", body: "An agent hands a sub-agent a smaller envelope by signing one more block. It can only narrow: less money, fewer payees, sooner expiry. No server is asked." },
  { verb: "Spend", who: "The agent holding it", paypal: "partial capture + Payout", body: "The gateway checks every signature and the budget of every envelope up the chain, then captures exactly that amount from the hold and pays the payee." },
  { verb: "Close", who: "You, any time", paypal: "void", body: "Revoke one agent and everything below it dies. Close the envelope and PayPal releases whatever was never spent. You paid only for what happened." },
];

const STOPS = [
  { t: "A poisoned brief says “pay this new address”", a: "PAYEE_NOT_ALLOWED: the payee isn't on the envelope. Nothing moves." },
  { t: "A sub-agent mints itself a bigger budget", a: "WIDENED_LIMIT: a block that widens its parent fails verification, mathematically." },
  { t: "Twenty agents race for the last $10", a: "Budgets are reserved under a lock before PayPal is called. Six succeed, fourteen are denied." },
  { t: "A stolen copy of an envelope", a: "NOT_THE_HOLDER: spending needs the private key the envelope was issued to." },
  { t: "The orchestrator hands out more than it has", a: "OVER_ANCESTOR_LIMIT: a spend debits every envelope above it." },
  { t: "The whole system is wrong and tries to overspend", a: "PayPal itself refuses to capture beyond the authorization." },
];

type Step = Record<string, unknown>;

export default function Home() {
  const steps = (evidence as { steps: Step[]; ranAt: string }).steps;
  const sealed: Step = steps[0] ?? {};
  const paid: Step = steps.find((s) => String(s.step).includes("paid $45")) ?? {};
  const closed: Step = steps.find((s) => String(s.step).includes("closed the envelope")) ?? {};
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
          <div>
            <p className="eyebrow">Spending authority for AI agents · built on PayPal</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.05] sm:text-5xl">Give your agent an envelope, not your wallet.</h1>
            <p className="mt-4 max-w-xl text-lg text-ink-soft">
              An envelope is signed spending authority backed by a PayPal hold. Your agent can split it for the agents it hires, but nobody down the chain can ever spend more, pay anyone else, or outlive it. Every dollar comes back with a receipt showing exactly who authorized it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className="btn btn-primary" href="/console">Seal an envelope →</Link>
              <Link className="btn" href="/spec">Read the protocol</Link>
            </div>
            <p className="mt-4 text-sm text-ink-soft">Today, an agent that can pay holds your whole credential, and so does every sub-agent it calls.</p>
          </div>

          <figure aria-label="Example: nested envelopes" className="space-y-3">
            <div className="env p-4">
              <p className="flex items-center justify-between text-sm"><span className="font-semibold">ops-agent</span><span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">Example</span></p>
              <p className="text-xs text-ink-soft">sealed by Ada · PayPal hold $200.00</p>
              <p className="money mt-2 text-sm"><b>$115.00</b> <span className="text-ink-soft">spent of $200.00</span></p>
              <div className="bar mt-1.5"><i className="bar-spent" style={{ width: "57.5%" }} /></div>
            </div>
            <div className="env-children space-y-3">
              <div className="env p-4">
                <p className="text-sm font-semibold">localization-agent</p>
                <p className="money mt-1 text-sm"><b>$45.00</b> <span className="text-ink-soft">of $60.00 · translator only</span></p>
                <div className="bar mt-1.5"><i className="bar-spent" style={{ width: "75%" }} /></div>
              </div>
              <div className="env p-4">
                <p className="flex items-center justify-between text-sm font-semibold">creative-agent <span className="chip chip-DENIED">attacker@evil → denied</span></p>
                <p className="money mt-1 text-sm"><b>$70.00</b> <span className="text-ink-soft">of $90.00 · designer only</span></p>
                <div className="bar mt-1.5"><i className="bar-spent" style={{ width: "77.7%" }} /></div>
              </div>
            </div>
          </figure>
        </section>

        <section id="how" className="border-y border-rule bg-raised/60">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold">Four verbs. Each one is a PayPal primitive.</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.verb} className="card p-5">
                  <p className="flex items-center gap-2"><span className="mono inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{i + 1}</span><span className="text-lg font-semibold">{s.verb}</span></p>
                  <p className="mt-2 text-sm text-ink-soft">{s.body}</p>
                  <p className="mt-3 border-t border-rule pt-2 text-xs"><span className="text-ink-soft">PayPal:</span> <span className="font-medium">{s.paypal}</span></p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold">What it stops</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">The rules are signatures and arithmetic. No model decides whether money moves; an agent's stated reason is shown to you and never read by the gateway.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STOPS.map((s) => (
              <div key={s.t} className="card p-4">
                <p className="text-sm font-semibold">{s.t}</p>
                <p className="mt-1.5 text-sm text-ink-soft">{s.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-14">
          <div className="code card-lift p-5">
            <p className="text-xs uppercase tracking-wider text-code-soft">Real PayPal sandbox run · {String((evidence as { ranAt: string }).ranAt).slice(0, 16).replace("T", " ")} UTC · docs/evidence/sandbox-run.json</p>
            <div className="mt-3 space-y-1.5 text-[13px]">
              <p><span className="text-code-soft">seal ›</span> hold placed · authorization <span className="text-[#9be8c8]">{String(sealed.authorization)}</span> · $200.00</p>
              <p><span className="text-code-soft">spend ›</span> localization-agent $45.00 · capture <span className="text-[#9be8c8]">{String(paid.capture)}</span> · payout <span className="text-[#9be8c8]">{String(paid.payoutBatch)}</span></p>
              <p><span className="text-code-soft">spend ›</span> creative-agent → attacker@evil.example · <span className="text-[#FF8A7F]">DENIED PAYEE_NOT_ALLOWED</span></p>
              <p><span className="text-code-soft">close ›</span> authorization <span className="text-[#c9b4ff]">{String(closed.authorizationStatus)}</span> · ${(Number(closed.released) / 100).toFixed(2)} released, ${(Number(closed.captured) / 100).toFixed(2)} charged</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold">Standing on known ideas, on a rail people already use</h2>
              <p className="mt-1 text-sm text-ink-soft">Attenuating capability chains come from macaroons, Biscuit, UCAN and L402, and from 2026 IETF drafts on agent delegation. Envelope brings that pattern to PayPal and adds what money needs: budgets debited at every level, a hold the payment network itself enforces, and receipts that tie each PayPal transaction to its whole chain of authority.</p>
            </div>
            <Link className="btn btn-primary" href="/console">Try it →</Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs text-ink-soft">
          <span>Envelope · MIT licence · built for the PayPal AI Hackathon 2026</span>
          <span>An authorization is a PayPal hold, not an escrow service. Sandbox only.</span>
        </div>
      </footer>
    </>
  );
}
