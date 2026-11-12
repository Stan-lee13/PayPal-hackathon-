# Competitive intelligence

What exists, what overlaps with Envelope, and where it does not. The working notes behind this (three scans, how each was done, what each got wrong) are in [`DISCOVERY.md`](DISCOVERY.md). This document is the conclusion.

How to read the evidence column:

- **Code read**: we cloned the repository and read the files named. Nothing was installed or run.
- **README read**: we read the project's own description only.
- **Documentation**: the vendor's or standard's own published pages.
- **Trade press**: news or vendor blogs found by search on 11 November 2026; not checked against a primary source.

Nobody's live demo or video was opened, and the Devpost gallery is not public, so every statement about other entries is a partial view.

## Standards and network programs

| What | Who | What it covers | What it leaves open | Evidence |
|---|---|---|---|---|
| PayPal Agent Toolkit and MCP server | PayPal | PayPal's APIs as tools an agent can call | No payout, authorize/void or partial-capture tools in the catalogue we read; no notion of delegated authority between agents | Documentation ([agent tools](https://developer.paypal.com/ai-tools/agent-tools/)) |
| Agent Ready; Agentic Commerce Services | PayPal | Merchants accepting payments from AI shopping assistants | Merchant-side; the services are behind an access form | Documentation ([overview](https://developer.paypal.com/agent-ready/overview), [about](https://developer.paypal.com/agentic-commerce-services/about)) |
| AP2 (Agent Payments Protocol) | Google and partners | Signed mandates: what a user authorized one agent to buy | One hop, user to agent. Not how an agent hands part of that authority to another agent with budgets that add up | Documentation; one rival implements multi-hop SD-JWT delegate chains on it (code read) |
| Agentic Commerce Protocol | OpenAI and Stripe | Checkout between an agent and one seller; shared payment tokens scoped to a seller, amount and expiry | One agent, one seller | Documentation |
| UCP (Universal Commerce Protocol) | Google, Shopify and others; PayPal listed as an endorser | A commerce standard for agent-driven shopping | Checkout, not delegation or proof of funds | Documentation ([ucp.dev](https://ucp.dev/)) |
| Attenuating tokens: macaroons, Biscuit, UCAN, L402; IETF drafts `draft-niyikiza-oauth-attenuating-agent-tokens`, `draft-hamr-oauth-agent-delegation`; ERC-7710 | Various | Authority that can be narrowed and passed on, verifiable offline | No money: nothing debits a budget at every level or ties the root to funds on a rail | Documentation |
| Visa Intelligent Commerce; Mastercard Agent Pay | Card networks | Tokenized card credentials for agents, with identity binding | Card rails; a card number in the end. Issuers build the controls | Trade press ([Crossmint comparison](https://crossmint.com/learn/agent-card-payments-compared), [Fortune](https://fortune.com/2026/09/18/mastercard-visa-ai-shopping-payment-land-grab/)) |
| Agent cards: Alchemy AgentCard, Corpay Agent Card, Ramp, Stripe Issuing, others | Issuers and platforms | Virtual cards for agents: single-use, merchant-locked or amount-locked | Bearer credentials on card rails; work at any card merchant | Trade press ([The Block](https://theblock.co/post/405224/alchemy-unveils-visa-powered-virtual-payment-card-for-ai-agents), [Corpay](https://stellagent.ai/insights/corpay-agent-card-agentic-commerce)) |
| Agent wallets and identity: Skyfire, Catena Labs, Payman, Crossmint, Coinbase | Companies | Wallets, identity and payments for agents | Mostly stablecoin or card rails | README and trade press; not examined in depth |

## Other entries to this hackathon

36 repositories were cloned and read on 11 November. The strongest, by what their code contains:

| Entry | What it is | Has that Envelope lacks | Overlap with Envelope | Evidence |
|---|---|---|---|---|
| second-key | AP2 SD-JWT delegate chains, multi-hop, signed receipts read back from PayPal | Roughly 600 tests, a live demo, Disputes evidence | Signed chains anyone can verify; signed receipts | Code read |
| carte-blanche | Agent passport, signed track record, Merkle journal | Disputes evidence, timestamps from an external authority | Passport; signed record | Code read |
| cosign | One hold with partial captures per store; hold reauthorization | Reauthorization before expiry | One hold, many captures (single agent) | Code read |
| AgentLedger | Mandate as one PayPal authorization; referee by rules and a model; signed ledger | Reauthorization job | One hold, many captures (single agent) | Code read |
| IntentChain | Multi-hop grants that narrow | A live demo | Delegation that only narrows, but signed with a server secret and debited only at the root | README, partial code |
| pact | Agent-to-agent escrow with an independent verifier | About 600 tests, CI, a judge package, work verification | Agent pays agent on accepted work | README and file tree |
| AgentPal | "A bank account for AI agents": per-agent keys, allowance wallets, a human co-signer | Transaction Search reconciliation, webhooks, an SDK | The account framing; allowances | README and file tree |
| SpendVeto (commercial, not only an entry) | Ancestor-debited delegation, signed spend attestations, several rails | A product | Ancestor debiting | README |

Pattern searches of the same 36 for three later features found:

| Feature | Found elsewhere? | How we looked |
|---|---|---|
| An agent keeping income as a balance and paying a third agent from it | Not seen. Allowance wallets and spending ledgers exist. | Pattern search, not a full read |
| A card or pull-payment mandate for agents | Not seen. "Recurring" appears as a risk signal in one entry's dataset. | Pattern search, not a full read |
| A graph tracing a payment to the owner with signatures checked in the browser | Not searched for. Signed receipts verified in a browser exist in two entries. | — |

## How deeply other entries use PayPal

A second pass on 11 November read 65 entries' code for which PayPal APIs they really call. It was a static read (searching the source, about twenty read closely); nothing was run, so "uses" means the call exists in the code.

| PayPal capability | Entries using it (of 65) | Envelope |
|---|---|---|
| Webhooks with signature verification | 34 | Built; proven on the simulator; the sandbox rejected a forged event; no webhook registered, so no genuine event received |
| Vault (payer not present) | 18 | No |
| Disputes | 18 | Built on 12 November: every receipt check and every sweep asks PayPal; a dispute is marked on the payment and answered with the signed chain of authority. Asked on the sandbox (none held); answering one is proven on the simulator only |
| JS SDK buttons (the payer approves in PayPal) | 15 | No: the sandbox hold is placed on PayPal's test card |
| PayPal's Agent Toolkit | 14 | No |
| Order tracking | 11 | No |
| Transaction Search | about 8 | Built on 12 November, with PayPal's reported balance beside it: every capture, payout and refund is looked up in PayPal's statement of the account, and PayPal's fee is read from each line. On the sandbox 13 of 28 records were found with the same amount, none with a different one; 15 too recent to be listed <!-- STATEMENT-CHECK --> |
| Hold reauthorization | 7 | No |
| Their own MCP server | 22 | Yes, fifteen tools, tested over real MCP |
| Their own SDK | 7, mostly generated | Yes, hand-written and run against the sandbox |

The entries with the broadest PayPal use (second-key, mandate-gateway, chaperone, stood, cosign) still call PayPal products Envelope does not: Vault, payer-present approval, order tracking, reauthorization. Envelope's use goes further into one lifecycle: partial captures of one hold across a tree of agents, payouts with their real delivery status, release, refund (by the agent that was paid, proven on the sandbox), cancellation, a record of every call, and the gateway's books checked against PayPal's reported balance, PayPal's statement and PayPal's disputes. A judge counting PayPal products will count more elsewhere. A judge asking whether PayPal is necessary to the product will find it is here.

## Where Envelope stands

**Shared with others, so not a claim to originality:** signed delegation chains; agent passports; signed receipts verified in a browser; one hold with partial captures for a single agent; cards for agents (on card rails, and more useful there).

**Not found in the 36 codebases read, with the limits of that reading stated above:**

1. One PayPal hold behind a whole tree of agents, with budgets debited at every ancestor and PayPal itself refusing to capture past the hold.
2. Proof of funds for a payee that includes PayPal's live word on the hold.
3. Money set aside through the delegation tree and released by a named key's signature.
4. A gateway that runs unchanged in the visitor's browser.

**Where others are stronger:** test volume and CI; Disputes evidence actually exercised against PayPal; hold reauthorization; webhooks that have received real events; payer-present funding (Login with PayPal, vaulting); passkey or phone approval; merchant onboarding; weeks of polish on a hosted demo.

## The questions a judge will ask

| Question | Answer |
|---|---|
| Why isn't PayPal's own agent toolkit enough? | It gives an agent PayPal's APIs. It does not say how much of the owner's money this agent, or the agents it hires, may spend, and it gives a payee nothing to check. |
| Why isn't AP2 enough? | A mandate covers user to agent. Envelope covers agent to agent to agent, with budgets that add up and a hold behind the root. The two fit together: a mandate can be where a root envelope's limits come from. |
| Is this an AI wallet? | No. The agent holds a signature-bound share of someone's hold, not a balance it can spend freely; a balance is a second, separate feature with its own owner controls. |
| Who controls the money? | PayPal holds it. The owner's key is the only thing that can seal, approve over a threshold, revoke or close. |
| What if an agent is compromised? | It can spend what its envelope allows, to the payees and purposes on it, until it expires or is revoked. 171 attack cases in the test corpus try to get past that; none does. |
| Can a child spend twice? | No: a spend debits every envelope above it under one lock before PayPal is called, and PayPal refuses beyond the hold. Eight copies of one request at once are captured and counted once. |
| What happens when a payment fails? | Capture refused: nothing moved. Payout refused or returned: the capture is refunded. Refund refused too: the payment is shown as refund due and stays counted. |
| Does it really work with PayPal? | The sandbox evidence files carry PayPal's authorization, capture and payout ids, and the final status PayPal reported for each payout. |
| What is defensible? | The combination in the list above, and the discipline: no model decides whether money moves, and every claim on the page can be checked by the reader. |

## What we do not know

- What entries we could not see contain. The gallery is closed and private repositories are invisible.
- Whether any of the companies listed already debits delegated budgets at every level on a fiat rail. Their public material does not say so; that is not the same as it not existing.
- Whether merchants would accept a card that is not on a card network. That is a question for conversations, not code.
