# Submission package

Everything needed to fill in the Devpost form and check the entry before submitting. Copy the sections as they are.

## Before you submit (only you can do these)

1. **Make the GitHub repository public.** Stage One requires a public repository with a visible licence (MIT is in the repo).
2. **Merge pull request #5 into `main`.** Vercel then builds the production site. With no settings at all it is the try-it copy: the whole gateway runs in the visitor's browser on a PayPal simulator. Put that URL in the Devpost "Try it out" field.
3. **Upload `docs/demo/envelope-demo.mp4` to YouTube as Public** and paste the link into Devpost. It is 2:51 and already narrated (a synthetic voice; the first card says so). Record your own voice over it if you prefer; the script is `scripts/demo-narration.json`.
4. *Optional, for a hosted copy on the real sandbox:* in Vercel → Settings → Environment Variables add `DATABASE_URL` (any Postgres), `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (sandbox app), then redeploy.
5. *Optional, for a live model on the hosted copy:* add `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` for any OpenAI-compatible endpoint. Without them the hosted copy offers the scripted agents and says no model is connected.

## Title

**Envelope**

## Tagline

Give your agent an envelope, not your wallet. Money PayPal is already holding, which an agent can split for the agents it hires but never enlarge, which any payee can check is really there, and which one agent can use to pay another. A treasury for the owner, accounts for the agents, and a protocol between them.

## Short description (elevator pitch)

A person seals an envelope ("$200, these two payees, until tonight") and PayPal places a hold for it. Their agent can tear off smaller envelopes for the agents it hires. Nobody down the chain can spend more, pay anyone else or outlive it. A payee can ask whether an agent is good for the money and get a signed answer that includes PayPal's own confirmation of the hold, or have the fee set aside before it starts. Agents can have accounts that receive, so one agent can pay another. Every payment returns a receipt that names everyone who authorized it.

## Devpost description

### Inspiration

People have accounts. AI agents borrow a person's card and pass it around. When an agent hands work to another agent, it either passes on the same credential or approves every payment itself, and the freelancer, shop or agent on the other side has no way to tell whether the software asking for $70 of work can pay for it.

Agent-payment standards published so far mostly describe one hop, from a person to one agent. Multi-agent systems are already more than one hop deep.

### What it does

Envelope gives an agent something that behaves like an account of its own, built from four things PayPal already does: hold, capture part, pay out, let go.

- **Seal.** The owner signs an envelope in their browser: a total, a per-payment cap, allowed payees and purposes, an expiry. PayPal places an authorization (a hold) for the total. Nothing is charged.
- **Split.** An agent holding an envelope signs a smaller one for another agent. It can only narrow: less money, fewer payees, earlier expiry. No server is involved.
- **Check.** Before working for an agent, a payee hands the agent's signed introduction to the gateway. The answer is signed: the agent controls its key, here is everyone standing behind it back to a person, PayPal confirms the hold is live, and this payment would go through right now.
- **Set aside.** An agent can earmark a fee for one payee before the work starts. The amount is reserved in every envelope up the chain, PayPal confirms the hold, and the payee gets a signed note. Nothing else can spend that money until it is paid or released.
- **Spend.** An agent signs a payment request with its own key, or pays what it set aside. The gateway verifies the whole chain, checks the budget of every envelope above it, then makes a partial capture of the hold and a PayPal payout to the payee.
- **Get paid.** An agent can open an account that receives, signed by its own key and its owner's. Other agents pay it by account number; PayPal pays out to its owner.
- **Accept.** Money set aside can name an agent whose signed acceptance of the work releases it. The fingerprint of the delivered work goes on the receipt.
- **Approve.** The owner can require their own signature above an amount. Over it an agent can only ask; the money waits in the owner's inbox until they sign or decline.
- **Close or revoke.** Revoking one envelope kills everything split from it. Closing the root voids the rest of the hold.

Three layers sit on that one primitive:

- **Treasury**, for the owner: everything their agents can touch in one place. What PayPal is holding now, what was spent, what is set aside, every agent with its budget and a revoke button, and the books reconciled against PayPal by capture and payout id.
- **Accounts**, for each agent: a number and passport drawn from its key, a statement, an account that can be paid, and a record the gateway will sign as a reference the agent can carry anywhere.
- **Protocol**, between agents: signed messages any party can verify (introduction, statement of standing, promise, acceptance, receipt).

Each agent has an account number and a passport drawn from its key, with its record, statement and income. Each payment produces a signed receipt that ties the PayPal capture and payout ids to the request and to the chain of authority. The receipt page checks it against PayPal's GET endpoints and re-verifies the signatures in the browser.

### How AI is used

AI agents are the users of Envelope, and the design assumes they can be wrong, fooled or taken over.

On an envelope's page you can hand the brief to a real language model. It plays the ops agent (decides how to split), the localization agent (sets the fee aside for another agent, then pays on delivery) and the creative agent (receives a delivery message with a planted instruction to pay someone else). Every tool call the model makes is signed with that agent's key and sent to the gateway unchanged. The gateway decides by signatures and arithmetic and never reads what the model says. In the recorded run on the PayPal sandbox the model split with least privilege ($45 and $67, one payee each), set $45 aside and paid it, ignored the planted instruction and paid the real designer.

Agents outside the app use the same gateway through a command line and an MCP server, and keep their own keys.

### How we built it

- **Protocol core** (`lib/envelope/core.ts`): a chain of Ed25519-signed blocks using WebCrypto. The same file runs in the browser, the gateway and the agent tools. Payments, promises, introductions, revocations and account openings are signed under different domains, so one can never be replayed as another.
- **Gateway** (`lib/gateway/service.ts`): the only component with PayPal credentials. Under a per-envelope database lock it checks revocation, replay and the budget at every level, reserves the amount, and only then calls PayPal. Every PayPal call carries an idempotency key derived from the envelope or spend id.
- **PayPal** (sandbox): Orders v2 with `intent: AUTHORIZE` for the hold, partial captures with `final_capture: false`, Payouts for the payee, void on close, refund if a payout cannot be delivered, and GET lookups for proof of funds and for reconciling receipts.
- **One codebase, two places to run.** Every endpoint is a plain function (`lib/api/handlers.ts`). On a server it runs against Postgres. When the site has no database, the same functions run in the visitor's browser against Postgres compiled to WebAssembly (PGlite) and a PayPal simulator, so a deployment with no configuration is a working demo.
- **App**: Next.js 15, React 19, TypeScript, Tailwind v4, Drizzle. The interface is drawn as bank stationery: kraft envelopes, rubber stamps, till receipts, passports.
- **Tests**: 32 automated tests on the simulator, including a corpus of 107 attacks in eight categories. All 107 are refused and none causes a capture or a payout.

### Challenges we ran into

- A flat spending limit does not compose across agents. Budgets had to be debited at every ancestor, under one lock, before PayPal is called.
- A PayPal authorization is a hold, not escrow, and it expires. We say so everywhere, and we designed "set aside" as earmarked money the owner can still revoke, not as a guarantee to the payee.
- A hosted demo normally needs a database and secrets. We made the gateway itself portable so the hosted copy needs neither, and labelled that mode clearly as a simulator.
- A model asked to red-team its own spending controls sometimes declines. In five runs it attacked in two (every attempt refused by the gateway) and declined in three, so the video uses a scripted attacker for that part and the documentation says so.

### Accomplishments that we're proud of

- One real PayPal hold stands behind a whole tree of agents, and PayPal itself refuses to capture past it.
- A payee can get proof of funds that includes PayPal's own confirmation, and can have the fee set aside before working.
- One agent paid another, with the money set aside first, on the real PayPal sandbox.
- Payment released by a named agent's signature for delivered work, on the real sandbox, with the work's fingerprint on the receipt.
- An owner's books matched against PayPal's records, payment by payment.
- A payment over the owner's threshold that an agent could not make, paid when the owner signed in their browser, on the real sandbox.
- 107 of 107 attacks refused, with no money moved.
- The whole thing can be tried in a browser with nothing to install or configure.

### What we learned

Three old ideas fit together well for agents: capability chains that can only be narrowed, a payment network's hold as the outer limit, and receipts that carry their own chain of authority. Keeping every decision about money out of the model made the system easier to reason about and easier to test.

### What's next

- The owner approving the hold in PayPal's own checkout, or a vaulted wallet, instead of the sandbox test card.
- Reauthorizing a hold before it lapses, for envelopes that live longer than PayPal's honor period.
- Paying payees through PayPal's platform products so captured money never rests with the gateway.
- Delivery-versus-payment for promises, so a payee holds more than earmarked money.

### Built with

PayPal Orders v2, PayPal Payments v2 (authorize, capture, void, refund), PayPal Payouts, Next.js, React, TypeScript, Tailwind CSS, Drizzle ORM, PostgreSQL, PGlite, WebCrypto (Ed25519), Vitest, Playwright, Model Context Protocol, Claude Code.

### AI tools disclosure

Claude Code (Anthropic) wrote the code, tests and documents under the author's direction and ran the research. In the demo, Claude Haiku plays the agents through a local bridge to the Claude Code CLI. The video narration is a synthetic voice (Kokoro, an open text-to-speech model).

## Testing instructions for judges

**Fastest: the hosted copy.** Open the site. A red strip says the gateway is running in your browser on a simulator.

1. **Seal an envelope** (top right) → "Seal & hold $200.00 on PayPal".
2. On the envelope's page press **Run the launch**. The ops agent splits; the localization agent sets $45 aside for translator-agent, payable when ops-agent signs for the delivered work, which it then does; the creative agent pays the designer.
3. Press **Compromise the creative agent**: a new payee, an overspend and a forged bigger envelope are all denied, with the reason shown.
4. Click **translator-agent** in the statement: an agent that holds no envelope and gets paid. Click an agent in "Who holds what" and use **Ask the gateway** for proof of funds.
5. Open a **Receipt & authority chain**: checked against PayPal (simulated here) and re-verified in your browser.
6. Press **Agent asks for a bigger payment**: it is over the $75 you asked to sign for, so it waits. **Sign & pay** or **Decline**.
7. Open **Treasury** (top right): every agent under your signature with its budget, where the money went, and **Reconcile with PayPal**.
8. On an agent's passport, **Get a signed reference**: its record, signed and checked in your browser.
9. **Close envelope & release the hold.**

**On the real PayPal sandbox** (about five minutes): clone the repository and follow "Run it" in the README with a sandbox app's credentials. `npx tsx scripts/sandbox-run.ts` runs the whole flow with no browser and prints PayPal's ids. `node scripts/e2e.mjs` drives the same flow in a browser.

**With a real model**: see "Live agents" in the README. If you have Claude Code installed, `node scripts/claude-bridge.mjs` needs no API key.

## Video (2:51)

`docs/demo/envelope-demo.mp4`, recorded by `scripts/record-demo.mjs` against the real PayPal sandbox and assembled by `scripts/assemble_demo.py`. Scenes that wait on the model are sped up and labelled.

| Time | Scene | What is on screen |
|---|---|---|
| 0:00 | The problem | Title card |
| 0:07 | The idea | Landing page |
| 0:18 | Seal | The form, signed in the browser; PayPal places the hold (authorization `26586885XV7370446`) |
| 0:35 | A real model plays the agents | The model splits $45 and $67, sets $45 aside for translator-agent, pays it on delivery, ignores the planted instruction and pays the designer |
| 1:17 | Compromised agent (scripted) | New payee, overspend, forged bigger envelope: all denied |
| 1:30 | Result | $112 captured, $88 still held |
| 1:37 | An agent that earns | translator-agent's passport: $45 earned, who answers for it |
| 1:42 | Proof of funds | "Good for $20.00": hold `PARTIALLY_CAPTURED`, $88.00 unused, signature checked in the browser |
| 1:51 | Receipt | Chain of authority, PayPal capture and payout ids, checks pass |
| 2:01 | Owner approval | ops-agent asks for $80, over the $75 threshold; the owner signs in the browser; PayPal pays |
| 2:15 | Treasury | Every agent under the owner's signature; "3 of 3 match PayPal" |
| 2:23 | Revoke and close | PayPal voids the rest of the hold |
| 2:33 | Numbers | 107 of 107 attacks refused; the try-it copy runs in the browser |
| 2:44 | Close | End card |

The video shows the model paying what it set aside itself. Payment released by a named agent's acceptance is shown by the "Run the launch" button and in `docs/evidence/sandbox-run.json`, not in the video.

## Where this entry stands

We read the code of 36 other entries (see `docs/DISCOVERY.md`). Honest reading:

- **Stronger than this entry in places.** Several rivals are more complete products: hundreds of tests, CI, Disputes API evidence, PayPal partner onboarding, passkey approval, a fine-tuned model. Some have had hosted demos for weeks.
- **Shared with rivals.** Signed delegation chains (one rival, with AP2 SD-JWTs), agent passports, signed receipts verified in the browser, and one hold with partial captures for a single agent all exist elsewhere.
- **Not found in any of the 36.** One PayPal hold behind a whole tree of agents; budgets debited at every ancestor backed by that hold; proof of funds tied to the live hold; money set aside through the delegation tree and released by a named key's signature; a gateway that runs unchanged in the visitor's browser. (The treasury view, signed references and acceptance were built after that reading, so rivals were not checked for those specifically; reputation statements and dashboards certainly exist elsewhere.)

A special award (Best Use of Agentic Commerce, Most Creative, Best Use of PayPal + AI) is a realistic target. A top-three place is possible, not assured.

## Judging simulation

| Criterion | Strengths | Weaknesses a judge may raise |
|---|---|---|
| Technological implementation | Real sandbox: authorize, partial capture, payout, void, refund path, reconciliation. Ed25519 chains verified in three places. 32 tests and a 107-attack corpus. Gateway runs on a server or in a browser from the same code. | Custodial gateway; test-card funding; no hold reauthorization; no webhooks; fewer tests than the largest entries. |
| Design | A distinctive stationery system applied to every page; passports and receipts that carry real data. | Dense pages; phone layout only spot-checked. |
| Potential impact | Addresses multi-agent delegation, payee trust and agent-to-agent payment with rails that exist today. | Needs PayPal platform products and compliance work before real money. |
| Innovation | The combination listed above was not found in 36 rival codebases or in the prior art we read. | Each ingredient has prior art; the entry says so. |
| Presentation | Narrated 2:51 video on the real sandbox with a real model; a hosted copy that needs no setup; evidence files with PayPal ids. | Synthetic narration; the hosted copy is a simulator unless credentials are added. |
