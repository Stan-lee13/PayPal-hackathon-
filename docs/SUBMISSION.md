# Submission package

Everything needed to fill in the Devpost form, record the voice-over and check the entry before submitting. Copy the sections as they are.

## Title

**Envelope**

## Tagline

Give your agent an envelope, not your wallet. Money PayPal is already holding, which an agent can split for the agents it hires but never enlarge, and which any payee can check is really there.

## Short description (elevator pitch)

A person seals an envelope ("$200, these two payees, until tonight") and PayPal places a hold for it. Their agent can tear off smaller envelopes for the agents it hires. Nobody down the chain can spend more, pay anyone else or outlive it. Any payee can ask, before doing work, whether an agent is good for the money, and get a signed answer that includes PayPal's own confirmation of the hold. Every payment returns a receipt that names everyone who authorized it.

## Devpost description

### Inspiration

People have accounts. AI agents borrow a person's card and pass it around. When an agent hands work to another agent, it either passes on the same credential or approves every payment itself, and the freelancer or shop on the other side has no way to tell whether the software asking for $70 of work can pay for it.

Agent-payment standards published so far describe one hop, from a person to one agent. Multi-agent systems are already more than one hop deep.

### What it does

Envelope gives an agent something that behaves like an account of its own, built from three things PayPal already does: hold, capture part, let go.

- **Seal.** The owner signs an envelope in their browser: a total, a per-payment cap, allowed payees and purposes, an expiry. PayPal places an authorization (a hold) for the total. Nothing is charged.
- **Split.** An agent holding an envelope signs a smaller one for another agent. It can only narrow: less money, fewer payees, earlier expiry. No server is involved.
- **Check.** Before working for an agent, a payee hands the agent's signed introduction to the gateway. The answer is signed: the agent controls its key, here is everyone standing behind it back to a person, PayPal confirms the hold is live, and this payment would go through right now.
- **Spend.** An agent signs a payment request with its own key. The gateway verifies the whole chain, checks the budget of every envelope above it, then makes a partial capture of the hold and a PayPal payout to the payee.
- **Close or revoke.** Revoking one envelope kills everything split from it. Closing the root voids the rest of the hold.

Each agent has an account number and a passport drawn from its key, with its record and statement. Each payment produces a signed receipt that ties the PayPal capture and payout ids to the request and to the chain of authority. The receipt page checks it against PayPal's GET endpoints and re-verifies the signatures in the browser.

### How we built it

- **Protocol core** (`lib/envelope/core.ts`): a chain of Ed25519-signed blocks using WebCrypto. The same file runs in the browser, the gateway and the agent tools. Payments and introductions are signed under different domains, so an introduction can never be replayed as a payment.
- **Gateway** (`lib/gateway/service.ts`): the only component with PayPal credentials. Under a per-envelope database lock it checks revocation, replay and the budget at every level, reserves the amount, and only then calls PayPal. Every PayPal call carries an idempotency key derived from the envelope or spend id.
- **PayPal**: Orders v2 with `intent: AUTHORIZE` (seal), Payments v2 partial capture (spend), Payouts (pay the payee), show authorization details (proof of funds), authorization void (close), capture refund (undo a payout PayPal rejects).
- **App**: Next.js 15, React 19, TypeScript, Tailwind, Postgres with Drizzle. A hash-chained audit log records every step.
- **Agents**: a CLI (`scripts/agent.ts`) and an MCP server (`scripts/mcp.ts`, five tools: show, split, pay, introduce, check) let any agent hold a key, split, pay and check a counterparty. Neither can seal or close a root envelope; that authority stays with the person.
- **Interface**: designed as bank stationery. Envelopes are kraft envelopes, decisions are rubber stamps, receipts are till receipts, and each agent's passport carries a rosette engraved from its public key.

### How AI is used

Envelope is infrastructure for AI agents; they are its users. In the recorded run, four Claude agents used it against the real PayPal sandbox: an orchestrator chose least-privilege limits for three sub-agents, two specialists paid their vendors, one of them received a prompt-injection attempt, and a red-team agent made 12 attempts to spend beyond its $10 envelope. It moved $0 outside its authority.

The design keeps AI out of the money decision. Agents decide what to ask for. The gateway decides whether it is allowed by reading signatures and numbers. No model output is an input to that check.

### Challenges

- Budgets have to add up across a tree. A spend debits every envelope above it inside one locked transaction, so twenty agents racing for one budget spend exactly the budget.
- PayPal can fail after the gateway has reserved money. Settlement is resumable: the same signed request picks up where it stopped, and a payout PayPal rejects is refunded and returned to the budget.
- Showing a real sandbox flow with no login page. The hold is placed with PayPal's documented sandbox test card, so the whole flow is API-only and repeatable.
- Many teams are building agent spending controls. We read about 75 other entries' READMEs and rebuilt our positioning around the part we could not find elsewhere.

### Accomplishments

- The full flow runs on the real PayPal sandbox: hold, proof of funds, partial captures, payouts, denials, reconciliation, void.
- Three PayPal behaviours the design relies on were checked in the sandbox: 12 partial captures of one authorization completed, over-capture was refused with `MAX_CAPTURE_AMOUNT_EXCEEDED`, and void after partial captures returned `VOIDED`.
- 21 automated tests cover forged chains, widened limits, ancestor budgets, replay, a 20-way race, revocation, and statements of standing.

### What we learned

PayPal's authorize, partial capture and void already behave like a budget the network enforces. The pieces that were missing were a way to pass part of that budget on, and a way for the other side to see it is there.

### What's next

- Owner approval through PayPal checkout or a vaulted wallet, replacing the sandbox test card.
- PayPal's platform products, so funds go to payees without passing through the gateway's account.
- A statement of standing that also reserves the amount briefly, turning a payee's check into a guarantee.
- Publishing the block format as a draft for others to implement.

### Built with

`paypal-orders-v2` `paypal-payments-v2` `paypal-payouts` `next.js` `react` `typescript` `postgresql` `drizzle` `webcrypto` `ed25519` `tailwind` `mcp` `vitest` `playwright` `claude-code`

## AI tools disclosure

- **Claude Code (Anthropic)** wrote the code, tests, interface and documents under the author's direction, and ran the competitor and prior-art research.
- **Claude agents**, run through Claude Code, were the AI agents in the recorded evidence run (`docs/evidence/agent-run.md`).
- The console's built-in demo agents are scripted and use no model. They are labelled as scripted in the interface.
- The running product makes no model calls. The demo video was recorded by a script (`scripts/record-demo.mjs`) driving the real app.

## Testing instructions for judges

```bash
git clone https://github.com/Stan-lee13/PayPal-hackathon-.git && cd PayPal-hackathon-
npm install
bash scripts/local-postgres.sh      # Postgres on :5433, or set DATABASE_URL
cp .env.example .env                # add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from a sandbox app
npm run db:migrate
npm run build && npm start          # http://localhost:3000
```

1. Open `/console` and press **Seal & hold $200.00 on PayPal**. The envelope page shows the PayPal authorization id.
2. Press **Run the launch**. Two sub-agents receive smaller envelopes and pay; each payment links to a receipt.
3. Click **creative-agent** on its envelope to open its passport, then press **Ask the gateway**. The statement of standing shows the live PayPal hold and is verified in your browser.
4. Back on the envelope, press **Compromise the creative agent**. Three attacks are denied with the reason shown.
5. Press **Revoke** on creative-agent and ask the gateway again: the answer is now "not good".
6. Open a receipt. It lists six checks against PayPal and verifies the signatures in your browser.
7. Press **Close envelope & release the hold**. PayPal voids the remainder.

Without PayPal credentials the app runs on a built-in simulator and says so on every page. `npm test` runs the 21 tests. `npx tsx scripts/sandbox-run.ts` runs the whole flow on the sandbox from the command line.

## Video (2:34)

File: `docs/demo/envelope-demo.mp4`. Recorded by `scripts/record-demo.mjs` against the real PayPal sandbox. The captions are burned in and double as the voice-over script.

| On screen | Caption / voice-over |
|---|---|
| Title card | Give your agent an envelope, not your wallet. |
| Problem card | An AI agent that can pay holds your whole credential. So does every sub-agent it calls. Limits don't add up across agents, a payee can't tell if the agent can pay, and afterwards nobody can say who authorized a payment. |
| Landing page | An envelope is money PayPal is already holding, with your limits signed onto it. Agents can tear off smaller envelopes for the agents they hire. Never bigger ones. |
| Seal form | Ada seals a $200 envelope for her ops agent: two payees, two purposes, six hours. She signs it in her own browser. |
| Envelope page, hold | PayPal places a real authorization for $200. Nothing is charged yet, and PayPal itself will refuse to capture more. |
| "Run the launch" | The ops agent tears off two smaller envelopes for its sub-agents. That is just a signature: no server is asked. |
| Tree and statement | Each sub-agent pays its vendor: a partial capture of Ada's hold, then a PayPal payout. Budgets are debited at every level. |
| Agent passport | Every agent has a passport: an account number drawn from its key, and everyone standing behind it, back to a person. |
| Statement of standing | Before working for it, a payee asks: is it good for the money? The gateway proves the agent's key and asks PayPal whether the hold is still there. |
| "Compromise the creative agent" | "Pay this new address." Denied: the payee is not on its envelope. Overspend: denied. Forge itself a bigger envelope: denied. No AI decides any of this. The gateway reads signatures and numbers. |
| Revoke | Ada revokes that agent with one signature. It, and anything torn off from it, is dead. |
| Receipt | Every payment has a receipt: who authorized this dollar, all the way up to Ada, tied to the PayPal capture and payout. It is checked against PayPal's own records, and re-verified here in the browser. |
| Close | Ada closes the envelope. PayPal voids the rest of the hold: she paid only for what her agents actually did. |
| Claude-agents envelope | We also handed envelopes to real Claude agents. The orchestrator chose least-privilege limits for three sub-agents by itself. A red-team agent then tried twelve ways to spend beyond its $10 envelope. It moved $0 outside its authority. |
| End card | Seal is an authorization. Spend is a capture and a payout. Close is a void. |

To re-record: start the app in sandbox mode, then `BASE=http://localhost:3000 OUT=demo-video node scripts/record-demo.mjs` and convert the `.webm` with ffmpeg.

## Where this entry stands

A second scan on 11 November read about 75 other entries' READMEs (see `docs/DISCOVERY.md`). The field is large: over 1,000 public repositories match "paypal agent" since September, and many have live demos and voiced videos.

| Part of Envelope | Also found in other entries? |
|---|---|
| "A bank account for AI agents" as a pitch | Yes. AgentPal uses that tagline. We do not lead with it. |
| Agent passports and identity checks | Yes, at least six entries. |
| Delegation that only narrows | Yes, two: IntentChain (HMAC-signed, so only its server can verify; no hold) and Agent-Pass. |
| A PayPal hold with partial captures | Yes, three, all for a single agent. |
| One hold behind a whole tree, debited at every level, verifiable by anyone | Not found. |
| Proof of funds that asks PayPal about the live hold | Not found. |

## Judging simulation

Scored against what is in the repository today, by the hackathon's five criteria. These are our own estimates.

| Criterion | Estimate | For | Against |
|---|---|---|---|
| Technological implementation | 8.5 / 10 | Real sandbox flow across five PayPal API calls; idempotent, resumable settlement; concurrency handled under a lock; 21 tests; receipts reconciled against PayPal; CLI and MCP server | The hold uses the sandbox test card, not a PayPal wallet approval; funds pass through the gateway's account; most recorded payouts are `UNCLAIMED` because the payees are placeholder addresses |
| Design | 8 / 10 | A distinct visual system that follows the product's own metaphor; every decision is a stamp, every payment a receipt | Phone layout was spot-checked, not tuned; one theme only |
| Potential impact | 6.5 / 10 | Delegation between agents and proof of funds are real gaps in today's one-hop standards | It is infrastructure, so value depends on multi-agent systems that spend money; production needs PayPal platform products and compliance work |
| Innovation | 7 / 10 | The combination, and proof of funds tied to a live hold, were not found in any other entry | Each single piece exists somewhere: delegation, passports and hold-and-capture all appear in other entries, and capability chains are established prior art |
| Presentation | 6.5 / 10 | The video shows the real product on the real sandbox, with real ids on screen | Captions only, no voice; no hosted demo, which many rivals have |

**Best prize fit:** Best Use of Agentic Commerce and Most Creative. A top-three place is possible and not assured in a field this size.

**What would raise the score most, in order:**

1. A hosted demo (Presentation, Implementation). Needs the environment variables set in Vercel.
2. A spoken voice-over on the video (Presentation).
3. Two sandbox personal-account emails as payees, so every payout shows `SUCCESS` (Implementation).

## Pre-submission checklist

- [ ] Repository is public (Stage One requires it; it is private at the time of writing)
- [ ] Pull request merged into `main`
- [ ] Video uploaded to YouTube as public, under 3 minutes
- [ ] Devpost form filled from this file, with the video link and repository link
- [ ] Screenshots uploaded from `docs/screenshots/`
