import Link from "next/link";

/**
 * One payment, start to finish: each step hands the next one a record it can check, and names the
 * page where that record can be seen. This is the product in one column, and the reason its parts
 * are not separate features.
 */
const STEPS: Array<{ step: string; what: string; record: string; paypal: string; see?: { href: string; label: string } }> = [
  { step: "The owner seals", what: "Signs how much, to whom, for what, until when. Approves the hold in PayPal, or uses the sandbox card.", record: "A signed envelope and a PayPal authorization for its whole limit", paypal: "Order · authorize", see: { href: "/console", label: "Seal one" } },
  { step: "The agent splits", what: "Cuts a narrower envelope for each agent it hires. Each can only be smaller than the one above.", record: "A chain of signatures back to the owner", paypal: "nothing" },
  { step: "A payee checks", what: "Before working, asks whether this agent can pay. The answer is signed and carries PayPal's word on the hold.", record: "A statement of standing, good for five minutes", paypal: "Authorization · show" },
  { step: "The agent pays", what: "Signs a request. Every envelope above it is debited under one lock, then PayPal takes exactly that amount.", record: "A capture, and a receipt naming everyone who authorized it", paypal: "Partial capture" },
  { step: "The payee is paid", what: "A person gets a payout. An agent with an account keeps a balance it can spend, card or transfer, inside its own owner's limits.", record: "A payout, or one line on the agent's ledger", paypal: "Payouts", see: { href: "/bank", label: "Accounts" } },
  { step: "PayPal has the last word", what: "Nothing is called paid until PayPal says it arrived. Its own events finish a settlement; each is verified and applied once.", record: "PayPal's event, and the status read back from PayPal", paypal: "Webhooks · events" },
  { step: "Anyone can follow it", what: "Pick a payment and trace it to the owner's signature. Your browser checks every signature itself.", record: "The proof graph", paypal: "Capture · show" },
  { step: "The books are checked", what: "What agents are owed against PayPal's reported balance; every record against PayPal's own statement, fees included.", record: "Reserves and a statement match", paypal: "Reporting · Disputes", see: { href: "/bank", label: "The books" } },
  { step: "An agent audits the agents", what: "The auditor asks PayPal directly, through PayPal's own Agent Toolkit, and compares. It can read and propose. It cannot pay, refund or sign.", record: "A report, and proposals that name who must sign", paypal: "Agent Toolkit · reads", see: { href: "/auditor", label: "The auditor" } },
  { step: "The owner closes", what: "PayPal releases whatever was never spent. A refund returns money, never budget.", record: "A void, and the final figures", paypal: "Void · refund", see: { href: "/treasury", label: "Treasury" } },
];

export function Journey() {
  return (
    <section className="border-t-[1.5px] border-ink" aria-labelledby="journey">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <p className="label">One payment, start to finish</p>
        <h2 id="journey" className="title mt-3 max-w-3xl text-[2.2rem]">Each step hands the next a record it can check.</h2>
        <p className="mt-4 max-w-2xl text-ink-2">Accounts, cards, the treasury, receipts and the books are not separate features. They are the same payment seen at different moments, and every one of them rests on the step before it.</p>
        <ol className="mt-10 border-t-[1.5px] border-ink">
          {STEPS.map((s, i) => (
            <li key={s.step} className="grid grid-cols-[2.2rem_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-rule py-4 md:grid-cols-[2.2rem_minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.5fr)_9.5rem] md:items-baseline md:gap-x-6">
              <span className="mono text-sm text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="title text-[1.15rem]">{s.step}</span>
              <span className="col-start-2 text-[.92rem] text-ink-2 md:col-start-auto">{s.what}</span>
              <span className="col-start-2 text-[.82rem] text-ink-3 md:col-start-auto"><span className="micro mr-1.5">leaves</span>{s.record}{s.see ? <> · <Link className="link" href={s.see.href}>{s.see.label} →</Link></> : null}</span>
              <span className="col-start-2 mono text-[.7rem] text-blue md:col-start-auto md:text-right">{s.paypal === "nothing" ? <span className="text-ink-3">no PayPal call</span> : s.paypal}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
