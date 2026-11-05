import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { StateSeal } from "@/components/seal";
import { paypalMode } from "@/lib/paypal/client";
import { aiConfigured } from "@/lib/ai/client";
import { demoModeEnabled } from "@/lib/clock";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Judge's tour" };

type Step = { text: React.ReactNode };
type Scenario = { n: string; title: string; minutes: string; why: string; steps: Step[]; see: string };

export default function Tour() {
  const mode = paypalMode();
  const ai = aiConfigured();
  const demo = demoModeEnabled();
  const simulated = mode === "simulated";

  const scenarios: Scenario[] = [
    {
      n: "01", title: "The AI assistant's promise vs PayPal's charge", minutes: "≈ 2 min",
      why: "In Moffatt v. Air Canada (2024), a tribunal held the airline to what its chatbot told a customer. Merchants are now accountable for what their AI says, and nobody checks it against the payment.",
      steps: [
        { text: <>Open the <Link className="underline" href="/store">store</Link>. Set Ada Wrap Dress to 1, choose <strong>Express</strong>, and ask <em>&ldquo;What&rsquo;s my total with express shipping?&rdquo;</em></> },
        { text: <>The assistant says <em>&ldquo;Your total is $84.00&rdquo;</em> (it applies the published free-express promo). Before you pay, Kept&rsquo;s <strong>price check</strong> warns that checkout is $93.33. Pay anyway. {simulated ? "The simulated PayPal approval is labelled." : "Use the sandbox Personal account."}</> },
        { text: <>Open the <Link className="underline" href="/merchant">merchant console</Link>{demo ? <> (passcode in the README / submission notes)</> : null}. PayPal captured <strong>$93.33</strong>: the promise is <strong>BROKEN</strong> by $9.33, computed by code.</> },
        { text: <>Open the order. Read the exact PayPal refund request, then <strong>Approve &amp; refund $9.33</strong>. Kept confirms it with a GET on the refund.</> },
        { text: <>Click <strong>Customer receipt ↗</strong>: the promise now reads <em>Broken · made good</em>, with PayPal&rsquo;s refund id.</> },
        { text: <>Optional: in <strong>Settings</strong>, set the price check to <strong>Honour the promise</strong> and repeat. Now the PayPal order is created at $84.00 and the promise is simply <strong>KEPT</strong>. Then open <strong>Analytics</strong> (AG Studio) to see the kept-as-promised and kept-or-made-good rates.</> },
      ],
      see: "Prevent (price check before payment) and repair (after capture) · verbatim-quote validation · integer-money evaluator · policy engine · human approval · idempotent refund · authoritative confirmation.",
    },
    {
      n: "02", title: "Agent-to-agent: the shopper sends their own AI", minutes: "≈ 2 min",
      why: "When agents buy from agents, two sets of words matter: what the merchant's agent promised, and the limits the shopper gave their own agent. Kept keeps both as evidence.",
      steps: [
        { text: <>In the store, choose <strong>Send my AI agent</strong>. First try a limit of <em>under $60</em>: the deterministic guard <strong>declines</strong> and no pay button appears.</> },
        { text: <>Now use the default mandate (<em>under $90, ship within 2 days</em>). The guard <strong>clears</strong> the $84.00 quote. You still approve the payment yourself.</> },
        { text: <>In the console, the shopper&rsquo;s mandate is <strong>BROKEN</strong> too ($93.33 &gt; $90), with <strong>Accountable: merchant</strong>, because the agent was quoted within the limit.</> },
        { text: <>Approve the $9.33 refund. The mandate becomes <em>Broken · made good</em> (net $84.00) without a second refund.</> },
      ],
      see: "The model can't say PROCEED; only the guard can · fault attribution · one remedy repairs both promises.",
    },
    {
      n: "03", title: "Disputes: answer PayPal from the promise ledger", minutes: "≈ 1 min",
      why: "When a buyer disputes, the merchant usually starts from nothing. Kept already holds what was promised and what PayPal recorded.",
      steps: [
        { text: <>Place an Express order (scenario 01), then on the order page add a tracking number (e.g. DHL, <span className="mono">DHL7654321</span>). It is sent to PayPal&rsquo;s tracking API.</> },
        { text: simulated
          ? <>Use <strong>Play the buyer: open a dispute → &ldquo;I never received it&rdquo;</strong> (simulated PayPal only).</>
          : <>As the sandbox buyer, open a &ldquo;not received&rdquo; dispute in PayPal&rsquo;s Resolution Center.</> },
        { text: <>Kept proposes <strong>proof of fulfilment</strong> with the carrier, the tracking number and a factual note, and shows the exact Disputes API request. Approve it, and PayPal moves the dispute to <strong>UNDER_REVIEW</strong>.</> },
        { text: <>Without a tracker, Kept refuses to fake a defence. It proposes an honest refund offer, which moves money only if the buyer accepts it in PayPal.</> },
      ],
      see: "Rules (not AI) choose the response · the merchant approves every Disputes API call · supersedes any pending refund so nobody is paid twice.",
    },
  ];

  return (
    <>
      <ModeBanner />
      <main id="main" className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow">Judge&rsquo;s tour · about 5 minutes</p>
        <h1 className="quote mt-2 text-4xl leading-tight">Three promises, checked against PayPal&rsquo;s own records.</h1>
        <p className="mt-4 text-ink-soft">Kept turns what a merchant, its AI assistant, or a shopper&rsquo;s agent said into commitments bound to the PayPal order. It watches PayPal and proposes a fix when the two disagree. A person approves every cent.</p>

        <section className="paper mt-6 p-4 text-sm" aria-labelledby="mode-h">
          <h2 id="mode-h" className="eyebrow">What this instance is running right now</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-soft">PayPal</dt>
            <dd>{mode === "simulated" ? <><strong>Simulated</strong>: a labelled local emulator of PayPal&rsquo;s REST API. No PayPal is involved and no money moves.</> : mode === "sandbox" ? <><strong>PayPal sandbox</strong>: real PayPal APIs with test money and signed webhooks.</> : <strong>PayPal live</strong>}</dd>
            <dt className="text-ink-soft">AI</dt>
            <dd>{ai ? <><strong>Claude</strong> drafts chat replies, extracts promises, drives the shopper&rsquo;s agent and drafts remedies. Code validates everything it produces.</> : <><strong>Not configured.</strong> Labelled deterministic fallbacks are used, and the validator, guard and policy engine are identical.</>}</dd>
            <dt className="text-ink-soft">Demo</dt>
            <dd>{demo ? "Demo mode: the checkout ignores the chat's promo on purpose, so the $9.33 gap is reproducible. A simulated clock is available for deadlines." : "Demo mode is off."}</dd>
          </dl>
        </section>

        <ol className="mt-10 space-y-10">
          {scenarios.map((s) => (
            <li key={s.n} className="rule-t pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold"><span className="mono mr-2 text-sm text-ink-soft">{s.n}</span>{s.title}</h2>
                <span className="mono text-xs text-ink-soft">{s.minutes}</span>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{s.why}</p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">{s.steps.map((st, i) => <li key={i}>{st.text}</li>)}</ol>
              <p className="mt-3 text-xs"><span className="eyebrow">What to look for · </span>{s.see}</p>
            </li>
          ))}
        </ol>

        <section className="mt-12 rule-t pt-5" aria-labelledby="who-h">
          <h2 id="who-h" className="eyebrow">Who decides what</h2>
          <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Is it a real promise?", "The validator. The quote must appear verbatim, come from the right speaker, and have no hedges."],
              ["What did PayPal do?", "PayPal only. Every webhook is signature-checked and the resource is re-fetched with GET."],
              ["How big is the gap?", "The deterministic evaluator, in integer cents."],
              ["Warn or honour before payment?", "The merchant's rule. Honour only applies when the quote matches published pricing for that exact cart."],
              ["Where do the analytics come from?", "Only Kept's own records and PayPal-confirmed amounts. Nothing is sampled or invented."],
              ["May the shopper's agent pay?", "A deterministic guard. The shopper still approves in PayPal."],
              ["Is the remedy allowed?", "The policy engine, checked at proposal and again at approval."],
              ["Does money move?", "The merchant, with one explicit click after seeing the exact request."],
            ].map(([q, a]) => <li key={q} className="paper p-3"><p className="font-semibold">{q}</p><p className="text-ink-soft">{a}</p></li>)}
          </ul>
        </section>

        <section className="mt-10 flex flex-wrap items-center gap-3">
          <Link className="btn btn-primary" href="/store">Start at the store</Link>
          <Link className="btn" href="/merchant">Merchant console</Link>
          <span className="flex items-center gap-2 text-xs text-ink-soft"><StateSeal state="KEPT" size="sm" /> <StateSeal state="BROKEN" size="sm" /> <StateSeal state="BROKEN" madeGood size="sm" /> <StateSeal state="UNVERIFIABLE" size="sm" /></span>
        </section>
        <p className="mt-6 text-xs text-ink-soft">Adaeze Studio is a demonstration merchant. Kept is an MVP, not production banking infrastructure.</p>
      </main>
    </>
  );
}
