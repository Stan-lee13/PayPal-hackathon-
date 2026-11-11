# Envelope

**Give your agent an envelope, not your wallet.**

Envelope is spending authority for AI agents that can be **split but never enlarged**. A person seals an envelope ("$200, only to these two payees, only for translation and design, until tonight") and PayPal places a hold for the whole amount. The agent can split off smaller envelopes for the agents it hires. Nobody down the chain can spend more, pay anyone else, or outlive it, and every payment comes back with a receipt showing exactly who authorized it.

```
 Ada ──seals──▶ ops-agent  $200          PayPal: authorization (hold) $200
                 ├─ splits ─▶ localization-agent  $45, translator only
                 │              └─ pays $45 ──▶ PayPal: partial capture $45 + payout
                 └─ splits ─▶ creative-agent  $70, designer only
                                ├─ pays $70 ──▶ PayPal: partial capture $70 + payout
                                └─ "pay attacker@evil" ──▶ DENIED  PAYEE_NOT_ALLOWED
 Ada ──closes─▶                          PayPal: void → $85 released, $115 charged
```

Built for the PayPal AI Hackathon 2026. Sandbox only. The people and agents in the demo are fictional.

## The problem

An agent that can pay holds a credential. When it delegates work to another agent, it either hands over the same credential or becomes a bottleneck approving every payment. Flat spending limits don't compose: an orchestrator with a $500 limit that calls five sub-agents has five $500 problems. And afterwards nobody can answer the questions that matter: who authorized this dollar, under what limits, and how bad could it have been?

## The mechanism

| Verb | Who | What happens | PayPal |
|---|---|---|---|
| **Seal** | The owner, in their browser | Signs a root envelope (Ed25519). The gateway can enforce it but can't forge one. | `POST /v2/checkout/orders` with `intent: AUTHORIZE`: a hold for the whole limit |
| **Split** | Any agent holding an envelope | Appends one signed block for another agent. It may only narrow: less money, fewer payees and purposes, earlier expiry. Offline; no server. | none |
| **Spend** | The agent holding it | Signs a request with its own key. The gateway verifies the whole chain, then under a lock checks revocation and the budget of **every** envelope up the chain, reserves, and pays. | `POST /v2/payments/authorizations/{id}/capture` (partial) then `POST /v1/payments/payouts` |
| **Close / revoke** | The owner, or a holder above | Revoking one envelope kills everything split from it. Closing the root releases what was never spent. | `POST /v2/payments/authorizations/{id}/void` |

Every payment produces a **receipt** signed by the gateway that binds the PayPal capture and payout ids to the request and the full chain. The receipt page re-checks it two ways: against PayPal's own GET endpoints, and in your browser with the same verification code the gateway runs.

The rules are signatures and arithmetic. **No model output decides whether money moves.** An agent's stated reason is stored for the owner and never read by the gateway.

Protocol: [`docs/SPEC.md`](docs/SPEC.md). Core (pure, isomorphic): [`lib/envelope/core.ts`](lib/envelope/core.ts). Gateway: [`lib/gateway/service.ts`](lib/gateway/service.ts).

## What it stops

| Attack or failure | Result |
|---|---|
| A poisoned message tells an agent to pay a new address | `PAYEE_NOT_ALLOWED` |
| A sub-agent signs itself a bigger envelope | `WIDENED_LIMIT` (and friends): the chain fails verification |
| An orchestrator hands out more than it holds | `OVER_ANCESTOR_LIMIT`: a spend debits every envelope above it |
| Twenty agents race for the same budget | Reserved under a lock before PayPal is called; exactly the budget is spent |
| A copied envelope without the agent's key | `NOT_THE_HOLDER` |
| The same signed request sent twice | Executed once; the second returns the first result |
| Everything else goes wrong | PayPal refuses to capture beyond the authorization |

## What has actually run

| Part | Status |
|---|---|
| Real PayPal sandbox, API-only | **Ran.** [`docs/evidence/sandbox-run.json`](docs/evidence/sandbox-run.json): hold placed, two partial captures and payouts, three denials, receipt reconciled against PayPal, hold voided. Reproduce with `scripts/sandbox-run.ts`. |
| Real PayPal sandbox, in a browser | **Ran.** `scripts/e2e.mjs` drives the console in Chromium: seal with a browser-held key, agents pay, three attacks denied, revoke, receipt verified, close. Screenshots in `docs/screenshots/`. |
| Real AI agents | **Ran.** Four Claude agents (an orchestrator, two specialists, one red-team) used the CLI against the sandbox-backed gateway. Transcript summary: [`docs/evidence/agent-run.md`](docs/evidence/agent-run.md). |
| Automated tests | **18 pass** on the built-in PayPal simulator (`npm test`): narrowing rules, forged chains, ancestor budgets, replay, a 20-way race, revocation scope, close → void, audit chain. |
| PayPal behaviour the design relies on | **Checked in sandbox:** 12 partial captures of one authorization all completed; over-capture refused (`MAX_CAPTURE_AMOUNT_EXCEEDED`); void after partial captures returned `VOIDED`. |
| Payout delivery | Payouts are accepted by PayPal; payees in the recorded runs are placeholder addresses without sandbox accounts, so PayPal reports them `UNCLAIMED`. Set `ENVELOPE_PAYEE_1/2` to sandbox account emails to see `SUCCESS`. |
| Hosted deployment | Not deployed. Run it locally (below). |

## Run it

```bash
npm install
bash scripts/local-postgres.sh          # Postgres on :5433 (or set DATABASE_URL to any Postgres)
cp .env.example .env                    # add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from a sandbox app
npm run db:migrate
npm run build && npm start              # http://localhost:3000
npm test                                # 18 tests on the simulator
npx tsx scripts/sandbox-run.ts          # the whole flow on the real sandbox, writes evidence
```

Without PayPal credentials the app runs on a built-in simulator and says so on every page.

### Bring your own agent

Agents keep their own keys. Any agent that can run a command can use the CLI:

```bash
npx tsx scripts/agent.ts keygen ops-agent                      # prints a public key: paste it into the console's "My own agent"
npx tsx scripts/agent.ts split --as ops-agent --to helper --limit 20 --payees translator@example.com --purposes translation
npx tsx scripts/agent.ts pay   --as helper --amount 12 --payee translator@example.com --purpose translation --note "why"
npx tsx scripts/agent.ts show  --as helper
```

Or call the gateway directly: `POST /api/gateway/spend` with `{ signed, note }` (see the spec).

## How AI is used

Envelope is infrastructure *for* AI agents: they are its users. In the recorded run, Claude agents decided how to delegate (the orchestrator chose least-privilege limits equal to each quote), decided what to pay, handled a prompt-injection attempt, and red-teamed the gateway. The system is designed so that none of those decisions needs to be trusted: the gateway reads signatures and numbers only.

The console's built-in demo agents are scripted (no model) so the demo is reproducible; they are labelled as such.

AI tools used to build the project: Claude Code (Anthropic) wrote the code, tests and documents under the author's direction, and ran the research.

## Honest limits

- **Not escrow.** A PayPal authorization is a hold on the payer's funding source, valid up to 29 days. Envelope never calls it escrow.
- **Sandbox funding.** The hold is placed on PayPal's documented sandbox test card so no browser step is needed. In production the owner would approve the hold in PayPal's checkout or use a vaulted wallet; that path is not built.
- **Custodial gateway.** Captured funds pass through the gateway's PayPal account before the payout. A production version needs PayPal's platform products and the compliance that comes with moving other people's money.
- **Demo-grade key storage.** The owner's key is in `localStorage`; demo agents' keys are in the database.
- **It bounds damage; it doesn't judge payments.** A payment inside the envelope's limits is allowed even if it was a bad idea.
- **Prior art.** Attenuating capability chains are not new (macaroons, Biscuit, UCAN, L402, ERC-7710, 2026 IETF drafts). What is new here is the combination on PayPal: budgets debited at every ancestor, a hold the network enforces, and receipts tied to PayPal transaction ids. See the spec.

## Licence

MIT. See [LICENSE](LICENSE).
