# Submission package

Everything needed to fill in the Devpost form and check the entry before submitting. Copy the sections as they are.

## Before you submit (only you can do these)

1. **Make the GitHub repository public.** Stage One requires a public repository with a visible licence (MIT is in the repo).
2. **Merge the open pull request (#11) into `main`.** It carries the payer's approval of the hold in PayPal's checkout, the links between pages, PayPal's honor period in proof of funds, the auditor (PayPal's Agent Toolkit, read-only), the guided tour, the wider tests, and these documents (pull requests #8, #9 and #10, already merged, carried the SDK, the record of PayPal calls, recall, refunds, reserves, the statement check, disputes, the scheduled sweep, the rebuilt in-browser database, PayPal's events and the delivery log). Vercel then builds the production site. With no settings at all it is the try-it copy: the whole gateway runs in the visitor's browser on a PayPal simulator. Put its URL in the Devpost "Try it out" field (<https://envelope-paypal.vercel.app>; <https://kept-paypal.vercel.app> is the same site), and open it once in a private window to check it loads without a Vercel login.
3. **Decide on the video, then upload it to YouTube as Public** and paste the link into Devpost. `docs/demo/envelope-demo.mp4` (2:49, synthetic narration) was recorded before the last four rounds: what it shows is accurate, but it does not show the PayPal panel, the SDK, the Developers page, refunds, reserves, the statement check, disputes, payer approval, PayPal's events, the auditor or the tour. A public YouTube link is a condition of entry, and the README's first line has a place for it (`<!-- VIDEO-LINK -->`). A script for a new take is in `docs/DEMO_RUNBOOK.md`, section D. Do not touch the repository after the deadline: the rules say no commits and no README edits.
4. *Optional, for a hosted copy on the real sandbox:* in Vercel → Settings → Environment Variables add `DATABASE_URL` (any Postgres), `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (sandbox app), then redeploy.
4b. **Approve the pending sandbox hold at PayPal** with a sandbox personal account, if it is still waiting: that completes the evidence for payer approval (`scripts/approval-check.ts`). <!-- APPROVAL-SANDBOX --> The webhook for the sandbox app is registered (`25W82274K7440843K`) and PayPal's events have been received; nothing more is needed there. If the hosted copy is ever given a database, also set `PAYPAL_WEBHOOK_ID` to that id so it applies deliveries itself.
5. *Optional, for a live model on the hosted copy:* add `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` for any OpenAI-compatible endpoint. Without them the hosted copy offers the scripted agents and says no model is connected.

## Title

**Envelope**

## Tagline

Agentic banking on PayPal's rails. Give your agent an envelope, not your wallet: money PayPal is already holding, which an agent can split for the agents it hires but never enlarge, which any payee can check is really there, and which one agent can use to pay another. Agents get accounts that keep a balance, pay each other on their own signatures, and carry a card of their own that only one merchant can charge and that ends by itself. A treasury for the owner, accounts for the agents, and a protocol between them, on PayPal's rails.

## Short description (elevator pitch)

A person seals an envelope ("$200, these two payees, until tonight") and PayPal places a hold for it. Their agent can tear off smaller envelopes for the agents it hires. Nobody down the chain can spend more, pay anyone else or outlive it. A payee can ask whether an agent is good for the money and get a signed answer that includes PayPal's own confirmation of the hold, or have the fee set aside before it starts. Agents can have accounts that receive and keep a balance, so one agent can pay another and then spend what it earned: at once to another agent, or out through a PayPal payout, under a cap and a freeze that only its owner controls. It can issue a card for a subscription: one merchant, so much a charge, so many charges, and then the card is over, with nobody's bank card shared. Every payment returns a receipt that names everyone who authorized it.

## Devpost description

### Inspiration

People have accounts. AI agents borrow a person's card and pass it around. When an agent hands work to another agent, it either passes on the same credential or approves every payment itself, and the freelancer, shop or agent on the other side has no way to tell whether the software asking for $70 of work can pay for it.

Agent-payment standards published so far mostly describe one hop, from a person to one agent. Multi-agent systems are already more than one hop deep.

### What it does

Envelope gives an agent something that behaves like an account of its own, built from four things PayPal already does: hold, capture part, pay out, let go.

- **Seal.** The owner signs an envelope in their browser: a total, a per-payment cap, allowed payees and purposes, an expiry. PayPal places an authorization (a hold) for the total. Nothing is charged. The owner can approve that hold in PayPal's own checkout first: nothing is held until they do, and the gateway reads the approval back from PayPal. (The approval path runs end to end on the simulator; on the sandbox it has reached PayPal's approval link and waits for a person. <!-- APPROVAL-SANDBOX -->)
- **Split.** An agent holding an envelope signs a smaller one for another agent. It can only narrow: less money, fewer payees, earlier expiry. No server is involved.
- **Check.** Before working for an agent, a payee hands the agent's signed introduction to the gateway. The answer is signed: the agent controls its key, here is everyone standing behind it back to a person, PayPal confirms the hold is live and until when its three-day honor period runs, and this payment would go through right now.
- **Set aside.** An agent can earmark a fee for one payee before the work starts. The amount is reserved in every envelope up the chain, PayPal confirms the hold, and the payee gets a signed note. Nothing else can spend that money until it is paid or released.
- **Spend.** An agent signs a payment request with its own key, or pays what it set aside. The gateway verifies the whole chain, checks the budget of every envelope above it, then makes a partial capture of the hold and a PayPal payout to the payee.
- **Get paid.** An agent can open an account that receives, signed by its own key and its owner's. Other agents pay it by account number; PayPal pays out to its owner.
- **Keep a balance.** An account can hold what the agent earns. PayPal still captures each payment from the payer's hold; the amount is credited to the agent's balance on a ledger, once.
- **Transfer.** The agent signs a transfer out of its balance. To another agent's account it moves at once, with no PayPal call. To a PayPal address, or home to its owner, it leaves as a payout. The gateway refuses it when the balance is too low, over the owner's cap, or frozen.
- **Card.** An agent issues a Xenoncard on its balance for one merchant: a cap per charge, a number of charges, a billing period, an expiry. The merchant charges it with its own key. A thief with the card's details gets nothing, an overcharge is declined, and after the last charge the card has ended. The agent, or its owner, can cancel it sooner.
- **Trace.** The proof graph shows every record behind an envelope and checks every signature in your browser. Pick any payment and follow it back to the person who allowed it; a second page shows one payment only, which is what a payee can be given.
- **See what PayPal did.** Every envelope's page lists each call the gateway made to PayPal for it: the hold, each capture, each payout, each release, with PayPal's own id for the call. Envelope decides who may ask; PayPal moves the money, and you can read exactly how.
- **Recall.** A payout nobody claimed can be taken back by the owner: PayPal cancels it and the capture is refunded to them. (Proven on the simulator; PayPal's sandbox answered the cancel with an error.)
- **Give back.** An agent that was paid and will not do the work signs a refund of the whole payment while it still holds it. PayPal refunds the capture to the payer. Only the agent that was paid can do it. A refund returns the owner's money, not room in the envelope: PayPal does not return a refunded capture to the hold, and the books follow PayPal.
- **Check the books against PayPal's own.** What agents are owed is compared with the balance PayPal reports for the gateway's account, at the moment PayPal dates it. Every capture and payout is looked up in PayPal's statement of that account.
- **Answer a dispute.** Every receipt check asks PayPal whether the payer has disputed the capture. If they have, the gateway marks the payment and sends the evidence: the payer's own signature on the envelope and every signature between it and the payment. (Asked on the sandbox, where there was none; answering one is proven on the simulator.)
- **Settle on PayPal's word.** PayPal's events are verified with PayPal and applied once, and even a genuine event only makes the gateway read the record from PayPal before anything changes. On the sandbox this ran both ways: events read from PayPal's feed finished a payment, and two deliveries PayPal pushed were confirmed by its signature check while the same two with one character changed were refused. A daily sweep asks PayPal about everything unfinished.
- **Audit.** An agent on the operator's side checks what the spending agents did. It asks PayPal directly through PayPal's own Agent Toolkit, cut down to its five read tools, and compares the answers with the gateway's books. It can propose (answer a dispute, recall a payout, close an envelope, freeze an account); the gateway checks each proposal against its records and names who would have to sign. It cannot pay, refund or sign. (The fixed procedure ran on the sandbox: all 28 listed records were found again through the toolkit with the same amounts, and a refund the toolkit was asked to make was stopped with nothing sent. Finding and answering a dispute is proven on the simulator. A real model has run the audit twice: on the sandbox from a terminal and on the Auditor page against the simulator.)
- **Build on it.** A TypeScript SDK, an MCP server with fifteen tools and a command line, all on the same code. An agent using them holds its own key and never a PayPal credential. The MCP server has a second role, the auditor, with ten read-and-propose tools and no agent key.
- **Freeze.** The owner of an agent's account can freeze it with a signature. The agent cannot lift it and cannot swap in another owner.
- **Accept.** Money set aside can name an agent whose signed acceptance of the work releases it. The fingerprint of the delivered work goes on the receipt.
- **Approve.** The owner can require their own signature above an amount. Over it an agent can only ask; the money waits in the owner's inbox until they sign or decline.
- **Close or revoke.** Revoking one envelope kills everything split from it. Closing the root voids the rest of the hold.

Three layers sit on that one primitive:

- **Treasury**, for the owner: everything their agents can touch in one place. What PayPal is holding now, what was spent, what is set aside, every agent with its budget and a revoke button, and the books reconciled against PayPal by capture and payout id.
- **Accounts**, for each agent: a number and passport drawn from its key, a statement, an account that can be paid and can keep a balance, a ledger, and a record the gateway will sign as a reference the agent can carry anywhere.
- **Protocol**, between agents: signed messages any party can verify (introduction, statement of standing, promise, acceptance, receipt).

Each agent has an account number and a passport drawn from its key, with its record, statement and income. Each payment produces a signed receipt that ties the PayPal capture and payout ids to the request and to the chain of authority. The receipt page checks it against PayPal's GET endpoints and re-verifies the signatures in the browser.

### How AI is used

AI agents are the users of Envelope, and the design assumes they can be wrong, fooled or taken over.

On an envelope's page you can hand the brief to a real language model. It plays the ops agent (decides how to split), the localization agent (sets the fee aside for another agent, then pays on delivery) and the creative agent (receives a delivery message with a planted instruction to pay someone else). Every tool call the model makes is signed with that agent's key and sent to the gateway unchanged. The gateway decides by signatures and arithmetic and never reads what the model says. In the recorded run on the PayPal sandbox the model split with least privilege ($45 and $67, one payee each), set $45 aside and paid it, ignored the planted instruction and paid the real designer.

The checking is an agent's job too. On the Auditor page a model, or a fixed procedure when no model is connected, reads PayPal through PayPal's Agent Toolkit and reads the gateway's books, then reports and proposes. None of its tools moves money, and text it reads in a record (a memo, a purpose) reaches it as a quotation, never as an instruction. The fixed procedure ran on the real sandbox; a real model (Claude Haiku through the local Claude Code bridge) ran the audit on the sandbox as well (`docs/evidence/auditor-model.json`) and ran "Let a model audit" on the page against the simulator.

Agents outside the app use the same gateway through a command line and an MCP server, and keep their own keys.

### How we built it

- **Protocol core** (`lib/envelope/core.ts`): a chain of Ed25519-signed blocks using WebCrypto. The same file runs in the browser, the gateway and the agent tools. Payments, promises, introductions, revocations and account openings are signed under different domains, so one can never be replayed as another.
- **Gateway** (`lib/gateway/service.ts`): the only component with PayPal credentials. Under a per-envelope database lock it checks revocation, replay and the budget at every level, reserves the amount, and only then calls PayPal. Every PayPal call carries an idempotency key derived from the envelope or spend id.
- **PayPal** (sandbox): Orders v2 with `intent: AUTHORIZE` for the hold (on the sandbox test card, or on an order the payer approves in PayPal's checkout), partial captures with `final_capture: false`, Payouts for the payee, void on close, refund (by the agent that was paid, or when a payout cannot be delivered), and GET lookups for proof of funds and for reconciling receipts. Around that: payout item cancel for recall, webhook signature verification and the event feed for settlement, the Reporting API (balances, Transaction Search) to check the books against PayPal's own, and the Disputes API to find a dispute and send evidence. What ran on the real sandbox and what ran only on the simulator is listed in the README.
- **The auditor** (`lib/paypal/toolkit.ts`, `lib/gateway/auditor.ts`, `lib/ai/auditor.ts`): PayPal's Agent Toolkit (`@paypal/agent-toolkit` 1.11.0, 47 tools) runs inside the gateway under three restrictions that do not depend on the model or on the toolkit's configuration. It is given no credential: every request it builds is carried by the gateway's one PayPal client. Any tool outside the five read tools is refused by name before the toolkit is called. And the carrier sends only `GET`s on five listed paths, so a toolkit write is stopped again at the wire. It runs from the Auditor page, a terminal (`npm run auditor`) and MCP (`ENVELOPE_ROLE=auditor`). Against real PayPal its reads need the operator's key.
- **One codebase, two places to run.** Every endpoint is a plain function (`lib/api/handlers.ts`). On a server it runs against Postgres. When the site has no database, the same functions run in the visitor's browser against Postgres compiled to WebAssembly (PGlite) and a PayPal simulator, so a deployment with no configuration is a working demo. Every tab of that copy shares one database; the tab sharing was rebuilt on Web Locks so that closing or reloading a tab cannot hold up the others.
- **App**: Next.js 15, React 19, TypeScript, Tailwind v4, Drizzle. The interface is drawn as bank stationery: kraft envelopes, rubber stamps, till receipts, passports.
- **Tests**: 447 automated tests in 17 files on the simulator. A corpus of 171 attacks in eleven categories, each its own named test; all 171 are refused and none causes a capture or a payout. 24 seeded runs of 40 to 80 random moves, checked after every move against an independent model kept by the test. A 125-case matrix of the narrowing rules. No mutation testing was done.
- **A guided tour** (`components/tour.tsx`): a strip that rings the next control and moves on when the gateway's records or the page show the step happened. `scripts/tour-check.mjs` walks it in a real browser.

### Challenges we ran into

- A flat spending limit does not compose across agents. Budgets had to be debited at every ancestor, under one lock, before PayPal is called.
- A PayPal authorization is a hold, not escrow, and it expires. We say so everywhere, and we designed "set aside" as earmarked money the owner can still revoke, not as a guarantee to the payee.
- PayPal's behaviour had to be learned, not assumed. A refunded capture does not give its room back to the hold: our books said it did until a probe on the sandbox had a capture refused. PayPal's reported balance is two hours old and its statement lags by up to three, so a check against them has to be made at PayPal's moment, not ours.
- A hosted demo normally needs a database and secrets. We made the gateway itself portable so the hosted copy needs neither, and labelled that mode clearly as a simulator.
- A model asked to red-team its own spending controls sometimes declines. In five runs it attacked in two (every attempt refused by the gateway) and declined in three, so the video uses a scripted attacker for that part and the documentation says so.

### Accomplishments that we're proud of

- One real PayPal hold stands behind a whole tree of agents, every level's budget is debited before PayPal is called, and PayPal itself refuses to capture past the hold.
- A payee can get proof of funds that includes PayPal's own confirmation and the end of its honor period, and can have the fee set aside before working.
- One agent paid another, with the money set aside first, on the real PayPal sandbox.
- Payment released by a named agent's signature for delivered work, on the real sandbox, with the work's fingerprint on the receipt.
- An owner's books matched against PayPal's records, payment by payment.
- A payment over the owner's threshold that an agent could not make, paid when the owner signed in their browser, on the real sandbox.
- An agent that kept what it earned, paid another agent out of its balance with no PayPal call, was frozen by its owner, and withdrew through a real PayPal payout, on the real sandbox. The books balanced at the end.
- A real model, told it needed a service for two months and that its owner would not share a bank card, issued itself a card for exactly that, and cancelled it when told the work was off. On the real sandbox; the merchant's later charge was declined.
- A proof graph where any payment can be followed back to the owner's signature, with every signature checked by the reader's own browser.
- An agent that was paid gave the money back: a real PayPal refund of the capture on the sandbox, on the paid agent's signature, with the payer's own agent unable to force it.
- Every one of 28 sandbox captures, payouts and refunds found on PayPal's own statement with the same amount, with PayPal's fees read from the same lines.
- PayPal's own events finishing payments on the sandbox: read from its feed, and pushed with signatures PayPal confirmed.
- Twenty real faults found and fixed before submitting, by our own tests, by the real sandbox, and by an independent reviewer told to break the money code, and written up with what is still open.
- 53 real PayPal API calls on record behind three envelopes in the last recorded run, each with PayPal's debug id, and shown on the envelope's own page.
- An SDK that reached a first payment on the real sandbox from a twenty-line program, with the receipt verified on the caller's machine.
- An MCP server tested by speaking real MCP to it, with read tools and money-moving tools marked apart.
- PayPal's own Agent Toolkit put to work without handing any agent a PayPal credential: on the real sandbox an auditor read 566 transactions through it and found all 28 listed records again with the same amounts, and a refund the toolkit was asked to make never left the gateway.
- 171 of 171 attacks refused, with no money moved; 447 tests, among them random sequences of moves checked against an independent model after every step.
- The whole thing can be tried in a browser with nothing to install or configure, in as many tabs as you like.

### What we learned

Three old ideas fit together well for agents: capability chains that can only be narrowed, a payment network's hold as the outer limit, and receipts that carry their own chain of authority. Keeping every decision about money out of the model made the system easier to reason about and easier to test.

### What's next

- A vaulted PayPal account, so an owner who has approved one hold in PayPal's checkout can seal the next envelope with a signature alone.
- Reauthorizing a hold before it lapses, for envelopes that live longer than PayPal's honor period.
- Paying payees through PayPal's platform products so captured money never rests with the gateway.
- Delivery-versus-payment for promises, so a payee holds more than earmarked money.
- Xenoncard accepted outside this gateway: a merchant-side library, then a bridge to card-network tokens for merchants that only take cards.
- Partial refunds, and a payer-side way to ask for one short of a PayPal dispute.
- Balances held by a licensed partner, with statements. After that, the things a bank adds on top: credit against a record, cards, interest. None of those is built, and none should be without a licence behind it.

### Built with

PayPal Orders v2 (card and payer-approved), PayPal Payments v2 (authorize, capture, void, refund), PayPal Payouts, PayPal Reporting (balances, Transaction Search), PayPal Disputes, PayPal Webhooks (signature verification, event feed), PayPal Agent Toolkit (`@paypal/agent-toolkit`, read tools only), Next.js, React, TypeScript, Tailwind CSS, Drizzle ORM, PostgreSQL, PGlite, WebCrypto (Ed25519), Vitest, Playwright, Model Context Protocol, Claude Code.

### AI tools disclosure

Claude Code (Anthropic) wrote the code, tests and documents under the author's direction and ran the research. In the demo, Claude Haiku plays the agents through a local bridge to the Claude Code CLI. The video narration is a synthetic voice (Kokoro, an open text-to-speech model). In the app, a language model can play the spending agents and can run the auditor; the auditor's model reaches PayPal only through PayPal's Agent Toolkit, restricted by the gateway to five read tools. The auditor was also run by Claude Haiku through the same bridge: once on the sandbox, once on the page, and once against a payment whose memo gives the auditor orders, which it ignored and reported.

### Sponsor tools

None. AG Grid, APIMatic's context plugin, Bryntum, Channel3 and Render are not used, and no sponsor prize is claimed.

## Testing instructions for judges

**Fastest: the guided tour.** Open <https://envelope-paypal.vercel.app/?tour=1>. A red strip says the gateway is running in your browser on a simulator. A strip along the bottom rings the next control to press and moves on when the step has really happened: seal, agents pay, attack, trace a payment, the books against PayPal, the auditor, close. About two minutes.

**The longer path, by hand**, on <https://envelope-paypal.vercel.app> (also <https://kept-paypal.vercel.app>):

1. **Seal an envelope** (top right) → "Seal & hold $200.00 on PayPal". Or "Or approve the hold in PayPal first": on this copy the checkout is a simulated page, marked as such; cancel there and nothing is sealed, approve and the hold is placed.
2. On the envelope's page press **Run the launch**. The ops agent splits; the localization agent sets $45 aside for translator-agent, payable when ops-agent signs for the delivered work, which it then does; the creative agent pays the designer.
3. Press **Compromise the creative agent**: a new payee, an overspend and a forged bigger envelope are all denied, with the reason shown.
4. Click **translator-agent** in the statement: an agent that holds no envelope and gets paid. The $45 is in its balance. Press **Pay proofreader-agent $12** (moves at once), **Compromised: drain to a stranger** (refused: over its owner's $30 cap), **Owner freezes it**, then **Withdraw $20 to its owner**. Under **Its card**, press **Subscribe to Lexica Pro with its card**: the card appears and the merchant charges the first period. Then **Merchant charges the next period** (declined: too soon), **Merchant overcharges $19** (declined), **A thief uses the card details** (declined), and **Agent cancels the card**. Open **Accounts** (top right) to see every balance, whether the books add up, what agents are owed against what PayPal says the account holds, and **Compare with PayPal** to look each capture and payout up in PayPal's statement. To see a refund, press **Give its last payment back** on translator-agent's page before it has spent any of the $45 (on a fresh envelope, or before the other buttons). Click an agent in "Who holds what" and use **Ask the gateway** for proof of funds.
5. Open a **Receipt & authority chain**: checked against PayPal (simulated here) and re-verified in your browser. The seventh check asks PayPal whether the payment is disputed; **Show what would be sent** shows the evidence the gateway would answer with.
6. Press **Agent asks for a bigger payment**: it is over the $75 you asked to sign for, so it waits. **Sign & pay** or **Decline**.
7. At the top of the envelope's page, open **Proof graph**. Every box is a record; ticks are signatures your browser checked. Click a **PayPal capture** and read "Back to the person" on the right; press **Ask PayPal now**.
7a. Back on the envelope, read **What PayPal did for this envelope**: the hold, each capture and payout, each with PayPal's id. Open **Developers** in the top bar for the SDK, the MCP tools and the command line.
7b. Open **Treasury** (top right): every agent under your signature with its budget, where the money went, and **Reconcile with PayPal**.
7c. Open **Accounts** and press **Compare with PayPal**: every capture, payout and refund looked up in PayPal's statement (simulated here). A line opens the receipt of its payment.
7d. Open **Auditor**. Press one of the tool names under "Hand it a tool it does not have" (for example `create_refund`): refused. Press **A payer disputes the latest payment**, then **Audit by the fixed procedure** (or **Let a model audit**, when a model is connected). The auditor reads PayPal through PayPal's Agent Toolkit, finds the dispute, and proposes answering it; the gateway says the proposal stands and that it takes the gateway's sweep. Press **Run the gateway's sweep now**, then audit again: the proposal is gone.
8. On an agent's passport, **Get a signed reference**: its record, signed and checked in your browser.
9. **Close envelope & release the hold.**

**On the real PayPal sandbox** (about five minutes): clone the repository and follow "Run it" in the README with a sandbox app's credentials. `npx tsx scripts/sandbox-run.ts` runs the whole flow with no browser, balances, a refund, reserves, the statement and disputes included, and prints PayPal's ids. `node scripts/e2e.mjs` drives the same flow in a browser. `npm run auditor` runs the auditor against the sandbox from a terminal.

**With a real model**: see "Live agents" in the README. If you have Claude Code installed, `node scripts/claude-bridge.mjs` needs no API key.

## Video (2:49)

`docs/demo/envelope-demo.mp4`, recorded by `scripts/record-demo.mjs` against the real PayPal sandbox and assembled by `scripts/assemble_demo.py`. Scenes that wait on the model are sped up and labelled.

| Time | Scene | What is on screen |
|---|---|---|
| 0:00 | The problem | Title card |
| 0:07 | The idea | Landing page |
| 0:17 | Seal | The form, signed in the browser; PayPal places the hold (authorization `52S347829J918164G`) |
| 0:31 | A real model plays the agents | The model splits $45 and $67, sets $45 aside for translator-agent, pays it on delivery, ignores the planted instruction and pays the designer |
| 1:10 | Compromised agent (scripted) | New payee, overspend, forged bigger envelope: all denied |
| 1:20 | Result | $112 captured, $88 still held |
| 1:26 | An agent's balance | translator-agent kept the $45. It pays proofreader-agent $12 (no PayPal call) and is refused a transfer of everything to a stranger (over its owner's $30 cap) |
| 1:36 | Its card | It issues a Xenoncard locked to Lexica Pro: $9 a charge, two charges. The merchant charges $9 and PayPal is asked to pay it; a charge from someone with the card's details is declined; a $19 charge is declined |
| 1:52 | Proof of funds | "Good for $20.00": hold `PARTIALLY_CAPTURED`, $88.00 unused, signature checked in the browser |
| 2:00 | Proof graph | Every record behind the envelope, signatures checked in the browser. The $45 PayPal capture is picked and followed back to Ada; PayPal is asked and answers `COMPLETED · $45.00` for capture `1L0020793C2126544` |
| 2:13 | Owner approval | ops-agent asks for $80, over the $75 threshold; the owner signs in the browser; PayPal pays |
| 2:23 | Treasury | Every agent under the owner's signature; "3 of 3 match PayPal" |
| 2:30 | Revoke and close | PayPal voids the rest of the hold |
| 2:36 | Numbers | 171 of 171 attacks refused; try it in the browser |
| 2:43 | Close | End card |

Not in the video, because it was recorded before they were built: the list of PayPal calls on an envelope, the SDK and Developers page, recall, refunds, reserves, the statement check, disputes, payer approval, PayPal's events, the auditor and the tour. Also not in the video: the owner's freeze and the withdrawal (both on the agent's page and in `docs/evidence/sandbox-run.json`), and a model issuing and cancelling a card by itself (`docs/evidence/card-run.md`). In the video the card's steps are scripted buttons and its billing period is 30 seconds. The video shows the model paying what it set aside itself. Payment released by a named agent's acceptance is shown by the "Run the launch" button and in `docs/evidence/sandbox-run.json`, not in the video.

## Where this entry stands

We read the code of 36 other entries (see `docs/DISCOVERY.md`), and on 12 November looked again at the strongest we could find on GitHub; Devpost's gallery is not published (see `docs/COMPETITIVE_INTELLIGENCE.md`). Honest reading:

- **Stronger than this entry in places.** Several rivals are more complete products: hundreds of tests, CI, PayPal partner onboarding, Vault, hold reauthorization, order tracking, passkey approval, a fine-tuned model. Some have thousands of tests against this entry's 447, and paths a judge can follow without signing in. Some have had hosted demos for weeks.
- **Shared with rivals.** Signed delegation chains (one rival, with AP2 SD-JWTs), agent passports, signed receipts verified in the browser, and one hold with partial captures for a single agent all exist elsewhere.
- **Cards.** Cards for AI agents exist on Visa and Mastercard rails (Visa Intelligent Commerce, Mastercard Agent Pay, and issuers built on them). Xenoncard is not one of those and does not work at their merchants. What it does that a card number cannot: it is locked to one merchant's key, it carries its own count of charges and billing period, and its details are not a secret. A pattern search of the rival entries found no card or pull-payment mandate for agents.
- **Balances.** Several rivals have allowance wallets or a ledger of what an agent spent. A pattern search of the same codebases found none where an agent keeps income captured from another agent's PayPal hold as a balance and pays a third agent from it on its own signature. That was a search by pattern, not a full read, so treat it as "not seen", not "does not exist".
- **Not found in what we read.** A payee's proof of funds that carries PayPal's live word and its honor period; budgets debited at every ancestor under one lock; agents that earn, keep a balance and issue a card only one merchant can charge; books reconciled against PayPal's own statement and fees; money set aside through the delegation tree and released by a named key's signature; a gateway that runs unchanged in the visitor's browser. One PayPal hold behind a whole tree of agents is no longer on this list: an entry called Writ describes exactly that, and we read its README and pages but not its enforcement code. (The treasury view, signed references and acceptance were built after the first reading, so rivals were not checked for those specifically; reputation statements and dashboards certainly exist elsewhere.)

No placing is predicted here. The entry is aimed at the top three and at Best Use of Agentic Commerce, Best Use of PayPal + AI, Most Creative, Most Impactful and Best Demo Delivery; the section "How this entry answers each award" says on what grounds.

## How this entry answers each award

Facts only. Where each is proven is in the README's table "What is proven where".

**Best Use of Agentic Commerce.** Agents are the users at every step. They hold envelopes, hire each other by splitting them, get paid into accounts of their own, keep a balance, carry a card one merchant can charge, and an agent audits them. People sign only at the edges: the owner seals, approves above a threshold, freezes and closes.

**Best Use of PayPal + AI.** PayPal does everything that touches money: Orders v2 authorization (the hold, on a test card or approved by the payer), partial captures, Payouts and payout status, void, capture refund, payout item cancel, webhook signature verification and the event feed, Reporting (balances and Transaction Search), Disputes, and the Agent Toolkit for the auditor's reads. AI proposes: a model plays the spending agents and can run the audit. Signatures and arithmetic decide; no model output determines whether money moves.

**Most Creative.** Spending authority that can be split but never enlarged, with one PayPal hold behind the whole tree. The same idea is carried through to an account, a card locked to one merchant's key, and an auditor whose only power is to propose.

**Most Impactful.** It is for anyone who would otherwise hand an agent a wallet or approve every payment by hand, and for the freelancer, shop or agent on the other side who cannot tell whether the software asking for work can pay. It removes the shared credential: an agent holds a signed limit, and never a PayPal credential. It runs on the sandbox only, and real money would need PayPal's platform products and a licensed partner.

**Best Demo Delivery.** The guided tour at <https://envelope-paypal.vercel.app/?tour=1> walks a visitor through the whole loop in about two minutes with nothing to install, and each step advances only when it has really happened. The video is under three minutes (see the README's first line for the link).

## Judging simulation

| Criterion | Strengths | Weaknesses a judge may raise |
|---|---|---|
| Technological implementation | Real sandbox: authorize, partial capture, payout, void, a refund by the paid agent, reported balance, reconciliation, PayPal's own statement matched against the records with its fees read from each line, and PayPal's own events, read from its feed and pushed with signatures PayPal confirmed; disputes were asked for there and none existed. Ed25519 chains verified in three places. 447 tests, among them a 171-attack corpus and seeded random runs checked against an independent model. PayPal's Agent Toolkit used read-only by an auditing agent, proven on the sandbox. Gateway runs on a server or in a browser from the same code. | Payer approval in PayPal's checkout has not completed on the sandbox yet <!-- APPROVAL-SANDBOX -->; no Vault, reauthorization, order tracking or use of PayPal's Agent Toolkit, which many rivals have; Xenoncard only works at merchants on this gateway, and network cards for agents already exist; twenty faults were found in the last days, which shows care and also how young the code is; recall and dispute evidence are proven on the simulator only; pushed deliveries reached a gateway by replay from the hosted copy's log; PayPal's fees are measured and not yet charged to anyone; no outside review; balances are stored value and need a licence in real life; custodial gateway; far fewer tests than the largest entries. |
| Design | A distinctive stationery system applied to every page; passports and receipts that carry real data. | Dense pages; phone layout only spot-checked. |
| Potential impact | Addresses multi-agent delegation, payee trust and agent-to-agent payment with rails that exist today. | Needs PayPal platform products and compliance work before real money. |
| Innovation | The combination listed above was not found in the rival codebases or the prior art we read. | Each ingredient has prior art, and one rival describes a delegation tree sharing one hold; the entry says both. |
| Presentation | A guided tour on the hosted copy; the README opens with a path a judge can follow in two minutes and a table of what is proven where; narrated 2:49 video on the real sandbox with a real model; a hosted copy that needs no setup; evidence files with PayPal ids. | Synthetic narration; the video predates the last four rounds; no public YouTube link yet; the hosted copy is a simulator unless credentials are added. |
