import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { Figure, Flap, Meter, Passport, Postmark, Sigil, Stamp } from "@/components/stationery";
import attacks from "@/docs/evidence/attack-suite.json";
import evidence from "@/docs/evidence/sandbox-run.json";

export const dynamic = "force-dynamic";

// Example keys for the illustrations only (no envelope was ever sealed for them).
const K_OPS = "Qm9zZS1vcHMtYWdlbnQtZXhhbXBsZS1rZXktMDAwMDE";
const K_ART = "Y3JlYXRpdmUtYWdlbnQtZXhhbXBsZS1rZXktMDAwMDI";

const ACCOUNT = [
  { yours: "An account number", theirs: "A key only the agent holds. Its account number and its face are drawn from it.", paypal: "—" },
  { yours: "Money in the account", theirs: "A budget its owner signed, backed by money PayPal is holding.", paypal: "Authorization (a hold)" },
  { yours: "A card limit", theirs: "A total, a cap per payment, the only payees and purposes allowed, and an expiry.", paypal: "PayPal refuses to capture past the hold" },
  { yours: "ID a shop can check", theirs: "A passport, and a signed answer to “is this agent good for $45 to me, right now?”", paypal: "Live look-up of the hold" },
  { yours: "A salary paid in", theirs: "Other agents pay it by its account number. The money is paid out to its owner, or kept in the account.", paypal: "Partial capture; payout if not kept" },
  { yours: "A balance to spend", theirs: "What it earned and kept. It pays other agents at once on its own signature, or sends money out. Its owner can cap a payment and freeze it.", paypal: "Nothing between agents; Payout on the way out" },
  { yours: "A debit card", theirs: "A Xenoncard: its signed permission for one merchant to charge its balance, so much a charge, so many times, then it ends by itself. Only that merchant's key can charge it.", paypal: "Payout to the merchant" },
  { yours: "A certified cheque", theirs: "Money set aside for one payee before the work starts. Nothing else can spend it; it is paid or released.", paypal: "The same hold, confirmed live" },
  { yours: "Accounts for your kids", theirs: "It tears off smaller envelopes for the agents it hires. Smaller only: never a bigger one.", paypal: "Nothing. It is one signature." },
  { yours: "A statement", theirs: "A receipt for every payment that names everyone who authorized it, back to a person.", paypal: "Partial capture + Payout ids" },
  { yours: "Freeze, close", theirs: "Revoke one agent and every envelope under it dies. Close, and the unspent money is let go.", paypal: "Void" },
];

const LAYERS = [
  { name: "Treasury", who: "for the owner", href: "/treasury", cta: "Open the treasury", body: "One place for everything your agents can touch: what PayPal is holding, what was spent, what is set aside, who spent it. Revoke any agent with a signature.", has: ["Your signature required above an amount", "Books reconciled against PayPal", "Ledger export"] },
  { name: "Accounts", who: "for each agent", href: "/bank", cta: "Open the books", body: "An agent has a number, a passport, a statement, and an account that can be paid and can keep a balance. Its record can be signed as a reference it carries anywhere.", has: ["Identity drawn from its key", "A balance it spends with its own signature", "A card only one merchant can charge", "A signed, portable record"] },
  { name: "Protocol", who: "between agents", href: "/spec", cta: "Read the protocol", body: "Signed messages any agent can verify: prove funds, set money aside, release it when a named agent signs for the work, and a receipt that names everyone who authorized it.", has: ["Proof of funds from the live hold", "Payment released on accepted work", "A proof graph: any dollar traced to a person"] },
];

const VERBS = [
  { n: "1", verb: "Seal", who: "You, in your browser", paypal: "Authorization", body: "Sign the envelope: how much, to whom, for what, until when. PayPal holds the whole amount. Nothing is charged." },
  { n: "2", verb: "Split", who: "Any agent", paypal: "Nothing", body: "An agent signs a smaller envelope for an agent it hires. Less money, fewer payees, sooner expiry. No server is asked." },
  { n: "3", verb: "Spend", who: "The agent holding it", paypal: "Partial capture + Payout", body: "The gateway checks every signature and the budget of every envelope above, then takes exactly that much from the hold and pays." },
  { n: "4", verb: "Close", who: "You, at any time", paypal: "Void", body: "PayPal lets go of whatever was never spent. You paid for what your agents did, and nothing else." },
];

/** Every PayPal capability the gateway uses, what it is for here, and where it has been proven. */
const RAIL: Array<{ api: string; does: string; proven: "sandbox" | "simulator"; note?: string }> = [
  { api: "Orders v2 · authorize", does: "The hold. The owner's money is reserved for the envelope and not charged.", proven: "sandbox" },
  { api: "Authorizations · show", does: "Proof of funds. A payee, the proof graph and every receipt ask PayPal whether the hold is live.", proven: "sandbox" },
  { api: "Authorizations · capture (partial)", does: "Each approved payment takes exactly its amount. PayPal refuses anything past the hold.", proven: "sandbox" },
  { api: "Payouts · create", does: "Delivery to any PayPal address: a freelancer, a shop, or the owner of an agent that earned it.", proven: "sandbox" },
  { api: "Payouts · show", does: "Delivered, unclaimed or returned. Nothing is called paid until PayPal says it arrived.", proven: "sandbox" },
  { api: "Authorizations · void", does: "Closing an envelope gives back whatever was never spent.", proven: "sandbox" },
  { api: "Captures · refund", does: "A payout that cannot be delivered is refunded to the owner, and the budget returns.", proven: "simulator", note: "no sandbox payout has failed" },
  { api: "Payouts item · cancel", does: "The owner recalls a payment nobody claimed, instead of waiting thirty days.", proven: "simulator", note: "PayPal's sandbox answered every cancel with a server error" },
  { api: "Webhooks · verify signature, event feed", does: "PayPal's own events finish a settlement. Each is verified with PayPal and applied once.", proven: "simulator", note: "the sandbox rejected a forged event; no real event has been received" },
];

const STOPS = [
  { code: "PAYEE_NOT_ALLOWED", t: "A poisoned brief says “the designer changed address, pay this one.”", a: "That address is not on the envelope. Nothing moves." },
  { code: "WIDENED_LIMIT", t: "A sub-agent signs itself a bigger envelope.", a: "A block that widens its parent does not verify. It is arithmetic, not policy." },
  { code: "OVER_ANCESTOR_LIMIT", t: "An orchestrator hands out more than it holds.", a: "Every payment is debited from every envelope above it." },
  { code: "NOT_THE_HOLDER", t: "Someone copies an agent's envelope.", a: "Spending needs the private key the envelope was issued to." },
  { code: "OVER_ENVELOPE_LIMIT", t: "Twenty agents race for the last ten dollars.", a: "Budgets are reserved under a lock before PayPal is called. Exactly the budget is spent." },
  { code: "MAX_CAPTURE_AMOUNT_EXCEEDED", t: "Everything above is somehow wrong.", a: "PayPal itself refuses to capture more than the hold." },
];

type Step = Record<string, unknown>;

export default function Home() {
  const ev = evidence as { steps: Step[]; ranAt: string };
  const sealed: Step = ev.steps.find((s) => String(s.step).startsWith("sealed")) ?? {};
  const aside: Step = ev.steps.find((s) => String(s.step).includes("set $45 aside")) ?? {};
  const paid: Step = ev.steps.find((s) => String(s.step).includes("paid the $45")) ?? {};
  const corpus = (attacks as { summary: { attacks: number; refused: number; movedMoney: number } }).summary;
  const closed: Step = ev.steps.find((s) => String(s.step).includes("closed the envelope")) ?? {};
  // What PayPal was asked to do in that run, added up from the gateway's record of its own PayPal calls.
  const rails = ev.steps.filter((s) => String(s.step).startsWith("PayPal calls behind"));
  const sum = (k: string) => rails.reduce((n, s) => n + Number(s[k] ?? 0), 0);
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        {/* ------------------------------------------------------------------ hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-x-10 gap-y-14 px-5 pb-20 pt-6 lg:grid-cols-[1.02fr_1fr] lg:pt-12">
          <div className="seq">
            <p className="label">Spending authority for AI agents · backed by a PayPal hold</p>
            <h1 className="display mt-5 text-[clamp(2.7rem,6.4vw,4.9rem)]">Give your agent an envelope, <em>not your wallet.</em></h1>
            <p className="mt-6 max-w-[34rem] text-[1.12rem] leading-relaxed text-ink-2">
              An envelope is money PayPal is already holding, with your limits signed onto it. Your agent can tear off smaller envelopes for the agents it hires, never bigger ones. And anyone it wants to hire can check, before doing any work, that the money is really there.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link className="btn btn-ink" href="/console">Seal an envelope →</Link>
              <Link className="btn" href="/spec">Read the protocol</Link>
            </div>
          </div>

          <figure aria-label="Illustration: an agent's passport, its envelope, and a receipt" className="relative mx-auto h-[520px] w-full max-w-[520px] sm:h-[548px]">
            <div className="absolute left-0 top-0 w-[84%] -rotate-[4deg] enter" style={{ animationDelay: "80ms" }}>
              <Passport compact k={K_OPS} label="ops-agent" sponsors={["Ada"]} state={{ text: "In good standing", tone: "green" }} />
            </div>
            <div className="envl absolute right-0 top-[132px] w-[84%] rotate-[2.2deg] px-5 pb-5 pt-12 enter" style={{ animationDelay: "180ms" }}>
              <Flap />
              <div className="flex items-end justify-between gap-3">
                <div className="envl-label px-3 py-2">
                  <p className="micro">Pay to the order of</p>
                  <p className="title text-lg">ops-agent</p>
                  <p className="mono text-[.7rem] text-ink-2">sealed by Ada · 6 hours</p>
                </div>
                <Figure minor={20000} className="text-[2.6rem] text-kraft-ink" />
              </div>
              <div className="mt-4 text-kraft-ink"><Meter spent={11500} of={20000} label="$115 of $200 spent" /></div>
              <p className="mono mt-1.5 flex justify-between text-[.7rem]"><span>$115.00 spent</span><span>$85.00 still held by PayPal</span></p>
              <p className="mt-3 flex flex-wrap gap-1.5"><span className="tag">translator@…</span><span className="tag">designer@…</span><span className="tag">translation</span><span className="tag">design</span></p>
              <Postmark className="absolute -right-10 -top-12 rotate-[9deg]" size={118} top="PAYPAL · HOLD" bottom="AUTHORIZED" line1="$200.00" line2="SANDBOX" />
            </div>
            <div className="receipt absolute bottom-0 left-0 w-[44%] rotate-[-5deg] px-4 pt-4 text-[.68rem] leading-relaxed enter" style={{ animationDelay: "300ms" }}>
              <p className="text-center text-[.6rem] tracking-[.2em]">RECEIPT</p>
              <p className="leader mt-2"><span>creative-agent</span><i /><span>$70.00</span></p>
              <p className="text-ink-2">to designer@…</p>
              <p className="mt-1.5 text-ink-2">authorized by</p>
              <p>Ada → ops → creative</p>
              <p className="mt-2 text-center"><Stamp tone="green">Paid</Stamp></p>
            </div>
          </figure>
        </section>

        {/* ------------------------------------------------------------------ the account, taken apart */}
        <section id="account" className="border-y-[1.5px] border-ink bg-sheet">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="grid gap-6 lg:grid-cols-[1fr_2.1fr]">
              <div>
                <p className="label">The idea</p>
                <h2 className="title mt-3 text-[2.2rem]">People have accounts. Agents borrow a card. This gives an agent its own.</h2>
                <p className="mt-4 text-ink-2">PayPal does not open accounts for software, and it does not have to. Four things it already does (hold, capture part, pay out, let go) are enough to give an agent something that behaves like an account.</p>
              </div>
              <div role="table" aria-label="A person's account compared with an agent's account">
                <div role="row" className="label grid grid-cols-[1fr_1.7fr_1.1fr] gap-4 border-b-[1.5px] border-ink pb-2">
                  <span role="columnheader">Your account has</span><span role="columnheader">An agent&rsquo;s account has</span><span role="columnheader">PayPal does</span>
                </div>
                {ACCOUNT.map((r) => (
                  <div role="row" key={r.yours} className="grid grid-cols-[1fr_1.7fr_1.1fr] gap-4 border-b border-rule py-3.5 text-[.95rem]">
                    <span role="cell" className="title text-[1.05rem]">{r.yours}</span>
                    <span role="cell" className="text-ink-2">{r.theirs}</span>
                    <span role="cell" className="mono text-[.78rem] leading-snug text-blue">{r.paypal}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ four verbs */}
        {/* ------------------------------------------------------------------ three layers */}
        <section className="mx-auto max-w-6xl px-5 pt-16">
          <p className="label">One primitive, three layers</p>
          <h2 className="title mt-3 max-w-3xl text-[2.2rem]">What an agent needs to handle money, built on a hold PayPal already offers.</h2>
          <div className="mt-9 grid gap-x-10 gap-y-9 md:grid-cols-3">
            {LAYERS.map((l) => (
              <div key={l.name} className="ruled pt-4">
                <p className="flex items-baseline justify-between"><span className="display text-[2.4rem]">{l.name}</span><span className="micro">{l.who}</span></p>
                <p className="mt-3 text-[.95rem] text-ink-2">{l.body}</p>
                <ul className="mt-3 space-y-1 text-[.9rem]">{l.has.map((h) => <li key={h} className="leader"><span>{h}</span><i /></li>)}</ul>
                <Link className="link mt-4 inline-block text-[.9rem]" href={l.href}>{l.cta} →</Link>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <p className="label">How it works</p>
          <h2 className="title mt-3 max-w-2xl text-[2.2rem]">Four verbs. Each one is something PayPal already does.</h2>
          <ol className="mt-10 grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
            {VERBS.map((s) => (
              <li key={s.verb} className="ruled pt-4">
                <p className="flex items-baseline justify-between"><span className="display text-[3.4rem]">{s.verb}</span><span className="mono text-sm text-ink-3">0{s.n}</span></p>
                <p className="micro mt-1">{s.who}</p>
                <p className="mt-3 text-[.95rem] text-ink-2">{s.body}</p>
                <p className="mt-4 flex items-center gap-2"><span className="micro">PayPal</span><Stamp tone="blue" flat>{s.paypal}</Stamp></p>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-x-10 gap-y-6 border-t-[1.5px] border-ink pt-6 md:grid-cols-2">
            <p className="text-[.95rem] text-ink-2"><span className="title mr-2 text-[1.5rem] text-ink">Check</span>Anyone an agent wants to hire can ask the gateway whether it is good for the money. The answer is signed, names everyone standing behind the agent, and includes PayPal&rsquo;s word that the hold is live.</p>
            <p className="text-[.95rem] text-ink-2"><span className="title mr-2 text-[1.5rem] text-ink">Set aside</span>An agent can earmark the fee for one payee before the work starts. It is reserved at every level like a payment, so nothing else can spend it. It is paid when the agent says so, or when an agent it named signs for the delivered work; the work&rsquo;s fingerprint goes on the receipt.</p>
          </div>
        </section>

        {/* ------------------------------------------------------------------ the PayPal rail */}
        {rails.length > 0 && (
          <section className="border-t-[1.5px] border-ink bg-sheet" aria-labelledby="rail">
            <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-8 px-5 py-16 lg:grid-cols-[1fr_2.1fr]">
              <div>
                <p className="label">What PayPal does here</p>
                <h2 id="rail" className="title mt-3 text-[2.2rem]">Without PayPal, an envelope is a signed promise. With it, it is money.</h2>
                <p className="mt-4 text-ink-2">Envelope decides who may ask, for how much and for whom. PayPal does everything that touches money: it holds it, takes exactly what was approved, delivers it, and gives back the rest. The gateway keeps a record of every call it makes to PayPal, and each envelope&rsquo;s page shows its own.</p>
                <p className="mt-7"><span className="figure text-[3.2rem] leading-none text-blue">{sum("total")}</span></p>
                <p className="mt-2 text-sm text-ink-2">calls to the PayPal sandbox behind {rails.length} envelopes in the last recorded run: {sum("holds")} holds, {sum("captures")} partial captures, {sum("payouts")} payouts, {sum("voids")} releases, and {sum("asked")} times PayPal was simply asked. {sum("refused")} were refused by PayPal, and none of those moved money.</p>
              </div>
              <div role="table" aria-label="PayPal capabilities used">
                <div role="row" className="label grid grid-cols-[1.15fr_2fr_auto] gap-4 border-b-[1.5px] border-ink pb-2">
                  <span role="columnheader">PayPal</span><span role="columnheader">What it is for here</span><span role="columnheader">Proven on</span>
                </div>
                {RAIL.map((r) => (
                  <div role="row" key={r.api} className="grid grid-cols-[1.15fr_2fr_auto] items-baseline gap-4 border-b border-rule py-3 text-[.95rem]">
                    <span role="cell" className="mono text-[.78rem] leading-snug text-blue">{r.api}</span>
                    <span role="cell" className="text-ink-2">{r.does}{r.note ? <span className="mt-0.5 block text-[.8rem] text-ink-3">{r.note}</span> : null}</span>
                    <span role="cell"><Stamp tone={r.proven === "sandbox" ? "blue" : "grey"} flat>{r.proven}</Stamp></span>
                  </div>
                ))}
                <p className="mt-3 text-sm text-ink-2">Every call that changes something carries an idempotency key built from the payment&rsquo;s own id, so a retry can never capture, pay or refund twice.</p>
              </div>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------------------ build on it */}
        <section className="mx-auto max-w-6xl px-5 py-16" aria-labelledby="build">
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div>
              <p className="label">Build on it</p>
              <h2 id="build" className="title mt-3 text-[2.2rem]">An SDK, an MCP server and a command line. Your agent never holds a PayPal credential.</h2>
              <p className="mt-4 text-ink-2">Give any agent a key of its own and an envelope. It signs what it wants; the gateway decides by signatures and arithmetic; PayPal moves the money. A refusal comes back as a reason code, and nothing the agent or its model does can turn it into a payment.</p>
              <div className="mt-7 flex flex-wrap gap-4">
                <Link className="btn btn-ink" href="/developers">For developers →</Link>
              </div>
            </div>
            <pre className="code min-w-0 overflow-x-auto p-5 text-[.76rem] leading-relaxed">{`import { Agent, Owner } from "@envelope/sdk";

const { chain } = await owner.seal({           // a person signs; PayPal holds $50
  to: agent.identity, limit: "50.00",
  payees: ["designer@example.com"], purposes: ["design"], hours: 1,
});
await agent.hold(chain);                       // verified locally, back to the owner

await agent.pay({ amount: "12.50", payee: "designer@example.com", purpose: "design" });
// PayPal captured $12.50 of the hold and paid the designer.

await agent.pay({ amount: "12.50", payee: "attacker@evil.example", purpose: "design" });
// EnvelopeError: DENIED (PAYEE_NOT_ALLOWED). Nothing moved.`}</pre>
          </div>
        </section>

        {/* ------------------------------------------------------------------ know your agent */}
        <section className="border-y-[1.5px] border-ink bg-desk">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1fr_1.05fr]">
            <div className="relative">
              <Passport k={K_ART} label="creative-agent" sponsors={["Ada", "ops-agent"]} state={{ text: "In good standing", tone: "green" }} since="11 Nov 2026" />
              <div className="sheet sheet-lift relative -mt-3 ml-auto w-[88%] rotate-[1.4deg] p-5">
                <p className="micro">Statement of standing · signed by the gateway</p>
                <p className="title mt-2 text-xl">Good for <span className="money">$70.00</span> to designer@example.com</p>
                <ul className="mt-3 space-y-1 text-sm text-ink-2">
                  <li className="leader"><span>Controls its key</span><i /><span className="mono text-green">proved</span></li>
                  <li className="leader"><span>Stands behind it</span><i /><span className="mono text-ink">Ada → ops-agent</span></li>
                  <li className="leader"><span>PayPal hold</span><i /><span className="mono text-ink">live · $155.00 unused</span></li>
                  <li className="leader"><span>Valid for</span><i /><span className="mono text-ink">5 minutes</span></li>
                </ul>
                <Stamp tone="green" size="lg" className="absolute -right-3 -top-5">Good</Stamp>
              </div>
            </div>
            <div>
              <p className="label">Know your agent</p>
              <h2 className="title mt-3 text-[2.2rem]">Before anyone works for an agent, they can check it.</h2>
              <p className="mt-4 text-ink-2">A freelancer, a shop or another agent is asked to do $70 of work by software it has never met. Today it has no way to tell whether that software can pay.</p>
              <p className="mt-3 text-ink-2">With Envelope the agent introduces itself with a signed note. The payee hands the note to the gateway and gets back a signed answer: the agent holds the key it claims, here is every person and agent standing behind it, PayPal confirms the money is on hold, and this payment would go through right now.</p>
              <p className="mt-3 text-ink-2">The note cannot be replayed as a payment, and the answer expires in five minutes. If the payee wants more than an answer, the agent sets the fee aside for it: the money is then spoken for until it is paid or released.</p>
              <p className="mt-3 text-ink-2">And an agent can be the one getting paid. It opens an account with its own key and its owner&rsquo;s; from then on other agents pay it by account number, and its passport shows what it has earned.</p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ what it stops */}
        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-6 lg:grid-cols-[1fr_2.1fr]">
            <div>
              <p className="label">What it stops</p>
              <h2 className="title mt-3 text-[2.2rem]">No model decides whether money moves.</h2>
              <p className="mt-4 text-ink-2">Agents decide what to ask for. The gateway answers by reading signatures and numbers. An agent&rsquo;s stated reason is shown to its owner and never read by the gateway.</p>
              <p className="mt-6"><span className="figure text-[3.2rem] leading-none">{corpus.refused}<span className="text-ink-3">/{corpus.attacks}</span></span></p>
              <p className="mt-2 text-sm text-ink-2">attacks refused in the test corpus: forged and tampered envelopes, bad requests, races and replays, promise and account abuse, forged evidence. {corpus.movedMoney === 0 ? "None moved money." : `${corpus.movedMoney} moved money.`} It runs with every test.</p>
            </div>
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {STOPS.map((s) => (
                <li key={s.code} className="border-t border-rule py-4">
                  <Stamp tone="red">{s.code === "MAX_CAPTURE_AMOUNT_EXCEEDED" ? "Refused by PayPal" : "Denied"}</Stamp>
                  <p className="title mt-2.5 text-[1.08rem]">{s.t}</p>
                  <p className="mt-1.5 text-[.93rem] text-ink-2">{s.a}</p>
                  <p className="mono mt-2 text-[.7rem] text-red">{s.code}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------------------ evidence */}
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="grid items-start gap-10 lg:grid-cols-[1.25fr_1fr]">
            <div className="receipt px-6 pt-6 text-[.8rem] leading-relaxed sm:px-8">
              <p className="text-center tracking-[.3em]">PAYPAL SANDBOX · REAL RUN</p>
              <p className="text-center text-ink-2">{String(ev.ranAt).slice(0, 16).replace("T", " ")} UTC</p>
              <p className="mt-4 border-t border-dashed border-ink pt-3 leader"><span>SEAL · hold placed</span><i /><span>$200.00</span></p>
              <p className="text-ink-2">authorization {String(sealed.authorization)}</p>
              <p className="mt-2 leader"><span>SET ASIDE · for translator-agent</span><i /><span>$45.00</span></p>
              <p className="text-ink-2">hold confirmed {String(aside.paypalHold)} · no money moved</p>
              <p className="mt-2 leader"><span>PAID · agent to agent</span><i /><span>$45.00</span></p>
              <p className="text-ink-2">capture {String(paid.capture)} · payout {String(paid.payoutBatch)}</p>
              <p className="mt-2 leader"><span>SPEND · creative-agent → attacker@evil</span><i /><span className="text-red">DENIED</span></p>
              <p className="text-red">PAYEE_NOT_ALLOWED</p>
              <p className="mt-2 leader"><span>CLOSE · hold {String(closed.authorizationStatus).toLowerCase()}</span><i /><span>${(Number(closed.released) / 100).toFixed(2)} let go</span></p>
              <p className="mt-3 border-t border-dashed border-ink pt-3 leader text-[.95rem] font-semibold"><span>CHARGED</span><i /><span>${(Number(closed.captured) / 100).toFixed(2)}</span></p>
              <p className="mt-3 text-center text-ink-3">docs/evidence/sandbox-run.json</p>
            </div>
            <div>
              <p className="label">What has actually run</p>
              <h2 className="title mt-3 text-[2.2rem]">Every figure on that slip came back from PayPal.</h2>
              <p className="mt-4 text-ink-2">The whole flow runs against the PayPal sandbox with no login page: a hold, money set aside and then paid from one agent to another, partial captures, payouts, denials, a receipt checked against PayPal&rsquo;s own records, and a void. So does an agent&rsquo;s balance: income kept in its account, a payment to another agent with no PayPal call, a freeze, and a withdrawal PayPal paid out. And a model subscribed to a service with a card of its own, then cancelled it when told the work was off.</p>
              <p className="mt-3 text-ink-2">Real models have used it too. On the envelope page you can hand the brief to a language model and watch it play the agents; in the last stage it is asked to attack the envelope. Earlier, four Claude agents ran a launch through the command line, and one spent twelve attempts trying to get past a $10 envelope. Nothing has moved outside an envelope yet.</p>
              <p className="mt-3 text-sm text-ink-3">Standing on known ideas: attenuating capability chains come from macaroons, Biscuit, UCAN and L402, and other teams are working on agent identity and delegation too. What we have not found anywhere else is the combination: a chain anyone can verify, budgets debited at every level, one real PayPal hold behind the whole tree, and proof of funds tied to that hold.</p>
              <div className="mt-7 flex flex-wrap gap-4">
                <Link className="btn btn-ink" href="/console">Try it →</Link>
                <Link className="btn" href="/spec">The protocol</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t-[1.5px] border-ink">
        <div className="micro mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6">
          <span className="flex items-center gap-2 text-ink-2"><Sigil k={K_OPS} size={18} className="text-ink-2" /> Envelope · MIT licence · PayPal AI Hackathon 2026</span>
          <span>Not a licensed bank. A PayPal authorization is a hold, not escrow. Sandbox only.</span>
        </div>
      </footer>
    </>
  );
}
