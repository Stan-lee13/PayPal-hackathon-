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
| Webhooks with signature verification | 34 | Built. On the sandbox (12 November): PayPal's events were read from its event feed and finished a payment; two genuine pushed deliveries were confirmed by PayPal's `verify-webhook-signature` and the same two with one character changed were refused. The pushed ones reached the gateway by replay from the hosted copy's log, because that copy has no database |
| Vault (payer not present) | 18 | No |
| Disputes | 18 | Built on 12 November: every receipt check and every sweep asks PayPal; a dispute is marked on the payment and answered with the signed chain of authority. Asked on the sandbox (none held); answering one is proven on the simulator only |
| The payer approves in PayPal (JS SDK buttons: 15; an approval link in more) | 15 | Built on 12 November with PayPal's approval link, not the JS SDK buttons: the owner approves the hold in PayPal's checkout and the gateway reads the order back before placing the hold. Proven on the simulator; on the sandbox PayPal issued the link and a person's approval is pending <!-- APPROVAL-SANDBOX -->. The default is still PayPal's sandbox test card |
| PayPal's Agent Toolkit | 14 | Used since 12 November, on the operator's side only and read-only. An auditing agent reads PayPal through five of the toolkit's 47 tools; the toolkit holds no credential, and the gateway's PayPal client carries its requests and carries only reads. No spending agent is given the toolkit: an agent here holds a signed envelope and never a PayPal credential. On the sandbox all 28 listed records were found again through the toolkit with the same amounts, and a refund it was asked to make was stopped with nothing sent (`docs/evidence/auditor.json`). An earlier version of this row said "No" |
| Order tracking | 11 | No |
| Transaction Search | about 8 | Built on 12 November, with PayPal's reported balance beside it: every capture, payout and refund is looked up in PayPal's statement of the account, and PayPal's fee is read from each line. On the sandbox all 28 records were found with the same amount, none with a different one <!-- STATEMENT-CHECK --> |
| Hold reauthorization | 7 | No. PayPal allows it only after the three-day honor period, so it cannot be exercised on the sandbox within the hackathon. Proof of funds says when that period ends |
| Their own MCP server | 22 | Yes, fifteen tools, and a second role for an auditor with ten read-and-propose tools, tested over real MCP |
| Their own SDK | 7, mostly generated | Yes, hand-written and run against the sandbox |

The entries with the broadest PayPal use (second-key, mandate-gateway, chaperone, stood, cosign) still call PayPal products Envelope does not: Vault, order tracking, reauthorization, Login with PayPal. Envelope's use goes further into one lifecycle: partial captures of one hold across a tree of agents, payouts with their real delivery status, release, refund (by the agent that was paid, proven on the sandbox), cancellation, a record of every call, and the gateway's books checked against PayPal's reported balance, PayPal's statement and PayPal's disputes. A judge counting PayPal products will count more elsewhere. A judge asking whether PayPal is necessary to the product will find it is here.

## A second look on 12 November

The Devpost gallery was still not published and its project pages could not be read from here, so this sweep worked from GitHub: about 1,800 repositories that mention the hackathon, 45 cloned and searched by pattern, about 20 READMEs read. Nothing was run, no video or live demo was opened, and "PayPal use" below means the call or product name appears in non-test code. Treat every row as a partial view.

| Entry | Repository | What it says it is | PayPal use seen by pattern scan |
|---|---|---|---|
| Keelson | `DavidZapataOh/keelson-paypal` | Each agent purchase checked against a signed mandate sealed in two TEEs, with operator bonds | Authorize, capture, void, reauthorize, refund, Payouts, webhooks, Vault, JS SDK, Disputes evidence, tracking, Login |
| GAVEL | `harshbhx/gavel-auction` | Every auction bid is a PayPal hold; only the winner is captured | Authorize, capture, void, reauthorize, refund, webhooks |
| Minder | `Laurel-11/Minder` | Buyer protection for purchases an agent makes | Vault, authorize, tracking, Disputes, webhooks, Agent Toolkit |
| Mandate | `Sid3503/mandate` | Rules in front of PayPal for a studio; contractors paid only from settled client money | Invoicing, card fields, Payouts, Disputes, reauthorize, Agent Toolkit, Login, Pay Later |
| Bursar | `priyansh-narang2308/bursar` | Spend authority for AI agents | Authorize, capture, void, reauthorize, Vault, Payouts, Transaction Search, Agent Toolkit |
| Writ | `dhakseshr/mandate` | An orchestrator delegating narrower sub-mandates, checked at every level, where "the whole tree shares one hold"; an Ed25519-signed passport | Authorize, capture, void, Payouts, Disputes, tracking, JS SDK, Agent Toolkit |
| Second Key | `KingDayveed357/second-key` | See the table above; unchanged since 10 November | See above |
| Accnomos | `zaytunazs/accnomos` | Bookkeeping for a UK business | Invoicing, Transaction Search with fees, Balances, Payouts, Disputes evidence |
| Signed Studio | `medelin/signed-studio` | A PayPal hold released by signature, with an offline check of the money trail | Not listed here: README read only |
| Chaperone | `apexxx01/chaperone` | Two isolated models between an agent and a payment | Authorize, Vault, Payouts, tracking |
| Mandate gateway | `Bhaskar422/mandate-gateway` | Mandates for agents, with stores that join by themselves | Vault, Disputes |
| AgentPal | `muhammadbilalbajwa156/agentpal` | See the table above | See above |

Another entry is named "PayPal-Envelope" (`kajlaM/PayPal-Envelope`): a pot of money per job for one agent. We found no delegation in it. The shared name is a coincidence and could confuse a reader.

**Writ overlaps with this entry more than anything else we read.** Its README describes one hold shared by a whole delegation tree, with narrowing checked at every level. We read its README, its pages and its passport route; we did not read the code that enforces the limits, so we cannot say how it debits budgets. Point 1 of the list below was written before we saw it and has been changed.

**Where these entries are ahead.** Breadth of PayPal products this entry does not use: Vault (7 of the 12), hold reauthorization (7), order tracking (5), Login with PayPal (5); and AG Grid, a sponsor's product, in 10. PayPal's Agent Toolkit (7 of the 12) was on this list; it is now used here, read-only, by the auditor. Test counts in the thousands in some, against this entry's 447 (114 when this was first written). Custom domains and documentation sites. This entry now has a guided path a judge can follow without signing in. Several are likely to place above this entry on breadth and polish.

**Where this entry is ahead of what we read.** Depth in one lifecycle: one hold, partial captures across a tree, payouts followed to PayPal's final word, refunds, and settlement on PayPal's own events. Reconciliation against PayPal's own statement and reported balance, with PayPal's fees read from the statement. A sandbox evidence file behind each claim, and a plain statement of what ran only on the simulator.

## Where Envelope stands

**Shared with others, so not a claim to originality:** signed delegation chains; agent passports; signed receipts verified in a browser; one hold with partial captures for a single agent; cards for agents (on card rails, and more useful there).

**Not found in the entries we read, with the limits of that reading stated above.** This is "not found in what we read", never "nobody has it":

1. A payee's proof of funds that carries PayPal's live word on the hold, and says when PayPal's honor period for it ends.
2. Budgets debited at every ancestor under one lock, with PayPal itself refusing to capture past the hold. (One hold behind a whole tree of agents is no longer on this list: Writ describes it.)
3. Agents that earn, keep a balance, pay other agents from it, and issue a card only one merchant can charge.
4. Books reconciled against PayPal's own statement and reported balance, with PayPal's fees read from the statement. (Accnomos does this for a business's bookkeeping; not for agents' balances.)
5. Money set aside through the delegation tree and released by a named key's signature.
6. A gateway that runs unchanged in the visitor's browser.

**Where others are stronger:** test volume and CI; breadth of PayPal products (Vault, reauthorization, order tracking, Login with PayPal, Invoicing); Disputes evidence actually exercised against PayPal; payer approval through PayPal's JS SDK buttons and vaulting; passkey or phone approval; merchant onboarding; judge paths, documentation sites and weeks of polish on a hosted demo.

## The questions a judge will ask

| Question | Answer |
|---|---|
| Why don't the spending agents use PayPal's own agent toolkit? | Out of the box it gives a model PayPal credentials and tools such as `create_order`, `pay_order` and `create_refund`. It does not say how much of the owner's money this agent, or the agents it hires, may spend, and it gives a payee nothing to check; that is the part Envelope adds. So a spending agent holds a signed envelope and never a PayPal credential. |
| Where is the toolkit used, then? | By the auditor, an agent on the operator's side that only reads. The toolkit runs inside the gateway with no credential of its own; five read tools are allowed by name, and the gateway's client sends only `GET`s on five listed paths for it. Proven on the sandbox by the fixed procedure; the model-driven audit has run only with a stand-in model in tests. |
| Why isn't AP2 enough? | A mandate covers user to agent. Envelope covers agent to agent to agent, with budgets that add up and a hold behind the root. The two fit together: a mandate can be where a root envelope's limits come from. |
| Is this an AI wallet? | No. The agent holds a signature-bound share of someone's hold, not a balance it can spend freely; a balance is a second, separate feature with its own owner controls. |
| Who controls the money? | PayPal holds it. The owner's key is the only thing that can seal, approve over a threshold, revoke or close. |
| What if an agent is compromised? | It can spend what its envelope allows, to the payees and purposes on it, until it expires or is revoked. 171 attack cases in the test corpus try to get past that; none does. |
| Can a child spend twice? | No: a spend debits every envelope above it under one lock before PayPal is called, and PayPal refuses beyond the hold. Eight copies of one request at once are captured and counted once. |
| What happens when a payment fails? | Capture refused: nothing moved. Payout refused or returned: the capture is refunded. Refund refused too: the payment is shown as refund due and stays counted. |
| Does it really work with PayPal? | The sandbox evidence files carry PayPal's authorization, capture, payout and refund ids, the final status PayPal reported for each payout, PayPal's own statement lines with its fees, and PayPal's own events, both read from its feed and pushed with a signature PayPal confirmed. |
| What is defensible? | No single item: one rival describes a delegation tree on one hold. The combination in the list above, and the discipline: no model decides whether money moves, and every claim on the page can be checked by the reader. |

## What we do not know

- What entries we could not see contain. The gallery is closed and private repositories are invisible.
- Whether any of the companies listed already debits delegated budgets at every level on a fiat rail. Their public material does not say so; that is not the same as it not existing.
- Whether merchants would accept a card that is not on a card network. That is a question for conversations, not code.
