import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";
import { Stamp } from "@/components/stationery";

export const metadata: Metadata = { title: "Developers" };

const QUICKSTART = `import { Agent, Owner } from "@envelope/sdk";

const gateway = "http://localhost:3000";
const owner = await Owner.generate({ gateway, label: "Ada" });
const agent = await Agent.generate({ gateway, label: "ops-agent" });

// The owner signs the limits. PayPal places a hold for the whole amount.
const { chain, root } = await owner.seal({
  to: agent.identity, limit: "50.00", perPayment: "20.00",
  payees: ["designer@example.com"], purposes: ["design"], hours: 1,
});
await agent.hold(chain);  // every signature checked here, back to the owner

// The agent pays. PayPal captures exactly this much and pays the payee.
const payment = await agent.pay({
  amount: "12.50", payee: "designer@example.com", purpose: "design",
});

// Anyone can check the receipt without trusting the gateway.
const receipt = await agent.receipt(payment.spendId);
console.log(root.authorizationId, payment.paypal?.captureId);
console.log((await receipt.verify()).ok);`;

const REFUSED = `try {
  await agent.pay({
    amount: "12.50", purpose: "design",
    payee: "attacker@evil.example",
  });
} catch (e) {
  e.denied;  // true: nothing moved
  e.codes;   // ["PAYEE_NOT_ALLOWED"]
}`;

const MCP_CONFIG = `{
  "mcpServers": {
    "envelope": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp.ts"],
      "env": {
        "GATEWAY": "http://localhost:3000",
        "ENVELOPE_AGENT": "ops-agent"
      }
    }
  }
}`;

const CLI = `# the agent's key, made and kept on its own disk
npx tsx scripts/agent.ts keygen ops-agent

# what it may spend, level by level
npx tsx scripts/agent.ts show --as ops-agent

# a narrower envelope for an agent it hires
npx tsx scripts/agent.ts split --as ops-agent --to helper \\
    --limit 30 --per 30 --payees designer@example.com --purposes design

npx tsx scripts/agent.ts pay --as helper --amount 12.50 \\
    --payee designer@example.com --purpose design

# asks PayPal through the gateway, and re-checks every signature here
npx tsx scripts/agent.ts receipt <payment id>`;

const READS = [
  ["envelope_show", "What this agent may spend, and what is left at every level above it"],
  ["envelope_balance", "Its account: balance and ledger"],
  ["envelope_card_list", "The cards it has issued"],
  ["envelope_introduce", "A signed introduction a payee can check. Moves nothing"],
  ["envelope_check_agent", "Is another agent good for the money? Verified with the gateway and PayPal"],
  ["envelope_receipt", "A receipt, checked against PayPal and re-verified locally"],
];
const ACTS = [
  ["envelope_split", "Cut a narrower envelope for another agent"],
  ["envelope_pay", "Pay a payee the envelope allows"],
  ["envelope_promise", "Set money aside for a payee before the work"],
  ["envelope_keep", "Pay what was set aside"],
  ["envelope_accept", "Sign that work was delivered, which releases its payment"],
  ["envelope_transfer", "Send money from its balance"],
  ["envelope_card_issue", "Let one merchant charge its balance, within limits"],
  ["envelope_card_cancel", "End a card"],
];
const CANNOT = [
  ["Spend more than its envelope, or any envelope above it", "Every payment is debited at every level before PayPal is called."],
  ["Pay anyone the owner did not list", "The payee list is signed by the owner. The SDK cannot edit it and the gateway reads it from the signature."],
  ["Give another agent more than it has", "A wider envelope is refused before it is signed, and does not verify if signed by hand."],
  ["See or use PayPal credentials", "Only the gateway holds them. The SDK has no PayPal code in it."],
  ["Approve its own request above the owner's threshold", "That takes the owner's signature, made with a key the agent never has."],
  ["Send the same payment twice", "A repeated request returns the first answer. PayPal is given the same idempotency key."],
];

export default function Developers() {
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-5 pb-24 pt-4">
        <header className="grid items-end gap-x-10 gap-y-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="label">For developers</p>
            <h1 className="display mt-3 text-[clamp(2.3rem,5.2vw,3.9rem)]">Give your agent money it can spend, <em>and nothing more.</em></h1>
          </div>
          <p className="text-[1.05rem] leading-relaxed text-ink-2">Three ways in: a TypeScript SDK, an MCP server and a command line. All three sign with the agent&rsquo;s own key and send the request to a gateway, which is the only thing that talks to PayPal. Your agent never holds a PayPal credential.</p>
        </header>

        <section className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 border-t-[1.5px] border-ink pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" aria-labelledby="sdk">
          <div>
            <p className="label">SDK</p>
            <h2 id="sdk" className="title mt-3 text-[2rem]">First payment in twenty lines.</h2>
            <p className="mt-4 text-ink-2">An owner seals an envelope. PayPal holds the money. The agent pays from it, and the receipt can be verified on any machine.</p>
            <ul className="mt-5 space-y-2 text-[.95rem] text-ink-2">
              <li className="leader"><span>One ES module</span><i /><span className="mono text-ink">no dependencies</span></li>
              <li className="leader"><span>Typed end to end</span><i /><span className="mono text-ink">TypeScript strict</span></li>
              <li className="leader"><span>Amounts</span><i /><span className="mono text-ink">&quot;45.00&quot;, never a float</span></li>
              <li className="leader"><span>Runs on</span><i /><span className="mono text-ink">Node 20+</span></li>
            </ul>
            <p className="mt-5 text-sm text-ink-2">The package is built from this repository (<span className="mono">npm run sdk:pack</span>) and is not on npm. The full guide is <span className="mono">docs/SDK.md</span>; a program with three agents is in <span className="mono">examples/hire-an-agent</span>.</p>
          </div>
          <div className="min-w-0 space-y-4">
            <pre className="code overflow-x-auto p-4 text-[.74rem] leading-relaxed" data-testid="quickstart">{QUICKSTART}</pre>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <pre className="code overflow-x-auto p-4 text-[.72rem] leading-relaxed">{REFUSED}</pre>
              <div className="sheet p-4">
                <Stamp tone="red">Denied</Stamp>
                <p className="title mt-2.5 text-[1.05rem]">A refusal is an error with a reason code.</p>
                <p className="mt-1.5 text-sm text-ink-2">It comes from the gateway, by signatures and arithmetic. Nothing your code or its model does can turn it into a payment.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 border-t-[1.5px] border-ink pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" aria-labelledby="mcp">
          <div className="min-w-0">
            <p className="label">MCP server</p>
            <h2 id="mcp" className="title mt-3 text-[2rem]">Hand any model fourteen tools and a budget.</h2>
            <p className="mt-4 text-ink-2">The server runs beside the model, holds the agent&rsquo;s key on that machine and speaks MCP over stdio. Tools that only read are marked as such; tools that move money are marked too, so a client can ask a person first.</p>
            <pre className="code mt-5 overflow-x-auto p-4 text-[.72rem] leading-relaxed">{MCP_CONFIG}</pre>
            <p className="mt-3 text-sm text-ink-2"><span className="mono">ENVELOPE_MCP_READ_ONLY=1</span> serves only the reading tools.</p>
          </div>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <div>
              <p className="micro border-b-[1.5px] border-ink pb-2">Read · moves nothing</p>
              <ul>{READS.map(([n, d]) => <li key={n} className="border-b border-rule py-2.5"><p className="mono text-[.78rem] text-blue">{n}</p><p className="mt-0.5 text-[.88rem] leading-snug text-ink-2">{d}</p></li>)}</ul>
            </div>
            <div>
              <p className="micro border-b-[1.5px] border-ink pb-2">Act · signed, then judged by the gateway</p>
              <ul>{ACTS.map(([n, d]) => <li key={n} className="border-b border-rule py-2.5"><p className="mono text-[.78rem]">{n}</p><p className="mt-0.5 text-[.88rem] leading-snug text-ink-2">{d}</p></li>)}</ul>
            </div>
          </div>
        </section>

        <section className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 border-t-[1.5px] border-ink pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" aria-labelledby="cli">
          <div>
            <p className="label">Command line</p>
            <h2 id="cli" className="title mt-3 text-[2rem]">The same calls, from a shell.</h2>
            <p className="mt-4 text-ink-2">For agents that run commands, and for trying things by hand. The MCP server and the command line are both built on the SDK, so the three always agree.</p>
          </div>
          <pre className="code min-w-0 overflow-x-auto p-4 text-[.72rem] leading-relaxed">{CLI}</pre>
        </section>

        <section className="mt-14 border-t-[1.5px] border-ink pt-8" aria-labelledby="cannot">
          <p className="label">Guardrails you do not have to build</p>
          <h2 id="cannot" className="title mt-3 max-w-3xl text-[2rem]">What an agent using this cannot do, whatever its prompt says.</h2>
          <ul className="mt-7 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {CANNOT.map(([t, a]) => <li key={t} className="border-t border-rule py-4"><p className="title text-[1.08rem]">{t}</p><p className="mt-1.5 text-[.93rem] text-ink-2">{a}</p></li>)}
          </ul>
          <div className="mt-9 flex flex-wrap gap-4">
            <Link className="btn btn-ink" href="/console">Seal an envelope and try it →</Link>
            <Link className="btn" href="/spec">Read the protocol</Link>
          </div>
          <p className="mt-6 max-w-3xl text-sm text-ink-3">Sandbox only. Tested against the gateway on the PayPal simulator: the SDK in 17 tests, the MCP server and command line in 13, speaking the real MCP protocol over stdio. The MCP server has also been driven by a language model on the PayPal sandbox (docs/evidence). The SDK itself has not been run against the sandbox.</p>
        </section>
      </main>
    </>
  );
}
