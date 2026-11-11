# Submission package

Everything needed to fill in the Devpost form, record the voice-over and check the entry before submitting. Copy the sections as they are.

## Title

**Envelope**

## Tagline

Give your agent an envelope, not your wallet. Spending authority for AI agents that can be split but never enlarged, backed by a PayPal hold.

## Short description (elevator pitch)

A person seals an envelope ("$200, these two payees, until tonight") and PayPal places a hold for it. Their agent can split off smaller envelopes for the agents it hires. Nobody down the chain can spend more, pay anyone else or outlive it, and every payment returns a receipt that shows who authorized it, checked against PayPal's own records.

## Devpost description

### Inspiration

An AI agent that can pay holds a credential. When it hands work to another agent, it either passes on the same credential or approves every payment itself. Flat spending limits don't add up: an orchestrator with a $500 limit that calls five sub-agents has five $500 problems. Agent-payment standards published so far (AP2 mandates, Agentic Commerce Protocol payment tokens, card-network agent tokens) describe one hop, from a person to one agent. Multi-agent systems are already more than one hop deep.

### What it does

Envelope gives agents spending authority with four verbs.

- **Seal.** The owner signs an envelope in their browser: a total, a per-payment cap, allowed payees and purposes, an expiry. PayPal places an authorization (a hold) for the total. Nothing is charged.
- **Split.** An agent holding an envelope signs a smaller one for another agent. It can only narrow: less money, fewer payees, earlier expiry. No server is involved.
- **Spend.** An agent signs a payment request with its own key. The gateway verifies the whole chain, checks the budget of every envelope above it, then makes a partial capture of the hold and a PayPal payout to the payee.
- **Close or revoke.** Revoking one envelope kills everything split from it. Closing the root voids the rest of the hold.

Each payment produces a signed receipt that ties the PayPal capture and payout ids to the request and to the chain of authority back to the owner. The receipt page checks it against PayPal's GET endpoints and re-verifies the signatures in the browser.

### How we built it

- **Protocol core** (`lib/envelope/core.ts`): a chain of Ed25519-signed blocks using WebCrypto. The same file runs in the browser, the gateway and the agent CLI.
- **Gateway** (`lib/gateway/service.ts`): the only component with PayPal credentials. Under a per-envelope database lock it checks revocation, replay and the budget at every level, reserves the amount, and only then calls PayPal. Every PayPal call carries an idempotency key derived from the envelope or spend id.
- **PayPal**: Orders v2 with `intent: AUTHORIZE` (seal), Payments v2 partial capture (spend), Payouts (pay the payee), authorization void (close), capture refund (undo a payout PayPal rejects).
- **App**: Next.js 15, React 19, TypeScript, Tailwind, Postgres with Drizzle. A hash-chained audit log records every step.
- **Agents**: a small CLI (`scripts/agent.ts`) and an MCP server (`scripts/mcp.ts`, three tools: show, split, pay) let any agent hold a key, split and pay. Neither can seal or close a root envelope; that authority stays with the person.

### How AI is used

Envelope is infrastructure for AI agents; they are its users. In the recorded run, four Claude agents used it against the real PayPal sandbox: an orchestrator chose least-privilege limits for three sub-agents, two specialists paid their vendors, one of them received a prompt-injection attempt, and a red-team agent made 12 attempts to spend beyond its $10 envelope. It moved $0 outside its authority.

The design keeps AI out of the money decision. Agents decide what to ask for. The gateway decides whether it is allowed by reading signatures and numbers. No model output is an input to that check.

### Challenges

- Budgets have to add up across a tree. A spend debits every envelope above it inside one locked transaction, so twenty agents racing for one budget spend exactly the budget.
- PayPal can fail after the gateway has reserved money. Settlement is resumable: the same signed request picks up where it stopped, and a payout PayPal rejects is refunded and returned to the budget.
- Showing a real sandbox flow with no login page. The hold is placed with PayPal's documented sandbox test card, so the whole flow is API-only and repeatable.

### Accomplishments

- The full flow runs on the real PayPal sandbox: hold, partial captures, payouts, denials, reconciliation, void.
- Three PayPal behaviours the design relies on were checked in the sandbox: 12 partial captures of one authorization completed, over-capture was refused with `MAX_CAPTURE_AMOUNT_EXCEEDED`, and void after partial captures returned `VOIDED`.
- 18 automated tests cover forged chains, widened limits, ancestor budgets, replay, a 20-way race and revocation.

### What we learned

PayPal's authorize, partial capture and void already behave like a budget the network enforces. The piece that was missing was a way to pass part of that budget on.

### What's next

- Owner approval through PayPal checkout or a vaulted wallet, replacing the sandbox test card.
- PayPal's platform products, so funds go to payees without passing through the gateway's account.
- Publishing the block format as a draft for others to implement.

### Built with

`paypal-orders-v2` `paypal-payments-v2` `paypal-payouts` `next.js` `react` `typescript` `postgresql` `drizzle` `webcrypto` `ed25519` `tailwind` `vitest` `playwright` `claude-code`

## AI tools disclosure

- **Claude Code (Anthropic)** wrote the code, tests and documents under the author's direction, and ran the competitor and prior-art research.
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
3. Press **Compromise the creative agent**. Three attacks are denied with the reason shown.
4. Open a receipt. It lists six checks against PayPal and verifies the signatures in your browser.
5. Press **Close envelope & release the hold**. PayPal voids the remainder.

Without PayPal credentials the app runs on a built-in simulator and says so on every page. `npm test` runs the 18 tests. `npx tsx scripts/sandbox-run.ts` runs the whole flow on the sandbox from the command line.

## Video (2:24)

File: `docs/demo/envelope-demo.mp4`.

Recorded by `scripts/record-demo.mjs` against the real PayPal sandbox. The captions are burned in and double as the voice-over script.

| Time | On screen | Caption / voice-over |
|---|---|---|
| 0:00 | Title card | Give your agent an envelope, not your wallet. |
| 0:06 | Problem card | An AI agent that can pay holds your whole credential. So does every sub-agent it calls. Flat spending limits don't add up across agents, and afterwards nobody can say who authorized a payment. |
| 0:16 | Landing page | An envelope is signed spending authority, backed by a PayPal hold. Agents can split it for the agents they hire, but never enlarge it. |
| 0:24 | Console, seal form | Ada seals a $200 envelope for her ops agent: two payees, two purposes, six hours. She signs it in her own browser. |
| 0:33 | Envelope page, hold card | PayPal places a real authorization for $200. Nothing is charged yet, and PayPal itself will refuse to capture more. |
| 0:43 | "Run the launch" | The ops agent splits off two smaller envelopes for its sub-agents. That's just a signature: no server is asked. |
| 0:55 | Tree and activity | Each sub-agent pays its vendor: a partial capture of Ada's hold, then a PayPal payout. Budgets are debited at every level. |
| 1:05 | "Compromise the creative agent" | "Pay this new address": denied, the payee isn't on its envelope. Overspend: denied. Forge itself a bigger envelope: denied, a block that widens its parent doesn't verify. |
| 1:25 | Same | No AI decides any of this. The gateway reads signatures and numbers. |
| 1:30 | Revoke | Ada revokes that agent with one signature. It, and anything split from it, is dead. |
| 1:36 | Receipt page | Every payment has a receipt: who authorized this dollar, all the way up to Ada, tied to the PayPal capture and payout. It's checked against PayPal's own records, and re-verified here in the browser. |
| 1:52 | Close | Ada closes the envelope. PayPal voids the rest of the hold: she paid only for what her agents actually did. |
| 2:02 | Claude-agents envelope | We also handed envelopes to real Claude agents. The orchestrator chose least-privilege limits for three sub-agents by itself. A red-team agent then tried twelve ways to spend beyond its $10 envelope. It moved $0 outside its authority. |
| 2:18 | End card | Seal = authorize. Spend = capture + payout. Close = void. |

To re-record: start the app in sandbox mode, then `BASE=http://localhost:3000 OUT=demo-video node scripts/record-demo.mjs` and convert the `.webm` with ffmpeg.

## Judging simulation

Scored against what is in the repository today, by the hackathon's five criteria. These are our own estimates.

| Criterion | Estimate | For | Against |
|---|---|---|---|
| Technological implementation | 8 / 10 | Real sandbox flow across four PayPal APIs; idempotent, resumable settlement; concurrency handled under a lock; 18 tests; receipts reconciled against PayPal; CLI and MCP server for agents | The hold uses the sandbox test card, not a PayPal wallet approval; funds pass through the gateway's account; most recorded payouts are `UNCLAIMED` because the payees are placeholder addresses |
| Design | 7 / 10 | One clear screen per step; the envelope tree shows budgets at every level; denials are explained in plain language | Functional more than striking; no mobile pass |
| Potential impact | 6.5 / 10 | The delegation gap is real and unaddressed by current one-hop standards | It is infrastructure, so value depends on multi-agent systems that spend money; production needs PayPal platform products and compliance work |
| Innovation | 8 / 10 | No other entry found has multi-hop delegation; PayPal's primitives map onto the mechanism one-to-one | Attenuating capability chains are established prior art (macaroons, Biscuit, UCAN); the novelty is the combination on a fiat rail |
| Presentation | 6.5 / 10 | The video shows the real product on the real sandbox, with real ids on screen | Captions only, no voice; no hosted demo |

**Best prize fit:** Best Use of Agentic Commerce and Most Creative. A top-three place is plausible and not assured; at least eight other entries work on agent spending controls, and the gallery is not public yet.

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
