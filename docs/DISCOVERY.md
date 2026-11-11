# Opportunity discovery (11 November 2026, time-boxed to about 75 minutes)

How the project was chosen. Sources are linked where a claim depends on them; anything not checked first-hand is marked.

## What the landscape looks like

- **PayPal already provides the money primitives**: Orders v2 (authorize, capture), Payments v2 (partial capture, void, refund), Payouts, Invoicing, Disputes, webhooks, plus an Agent Toolkit and MCP server that wrap them as tools. The MCP tool catalogue has no payouts, authorize/void, partial-capture or vault tools, and no notion of delegated spending authority ([agent tools](https://developer.paypal.com/ai-tools/agent-tools/)).
- **Agent Ready** is a merchant-side product for accepting payments from AI shopping assistants; **Agentic Commerce Services** is gated behind an access form ([overview](https://developer.paypal.com/agent-ready/overview), [about](https://developer.paypal.com/agentic-commerce-services/about)). Neither is an agent-spending API open to a sandbox developer.
- **Agent-payment standards scope one hop**: AP2 mandates (user → agent), Agentic Commerce Protocol shared payment tokens (agent → one seller, amount, expiry), card-network agent tokens. None describes an agent handing part of its authority to another agent with budgets that add up.
- **Naming**: *Agent Client Protocol* is Zed's editor ↔ coding-agent protocol; *Agentic Commerce Protocol* is the OpenAI + Stripe checkout protocol. They share three letters and nothing else. `zcode-acp-server` is a community bridge from Z.ai's ZCode to the Agent Client Protocol, unrelated to commerce. UCP is a commerce standard co-developed by Google, Shopify and others; PayPal is listed as an endorser ([ucp.dev](https://ucp.dev/)).
- **The problem is real, and thinly measured.** Documented cases exist of web-enabled agents being prompt-injected into making payments ([Zscaler, July 2026](https://www.zscaler.com/blogs/security-research/indirect-prompt-injection-web-content-targets-ai-agents)); an AI-controlled wallet lost roughly $150k–$200k to a prompt injection in May 2026 (secondary sources). For scale by analogy only: business email compromise, the human version of "pay this new account", cost $3.05 billion in the FBI's 2025 report ([IC3](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf)). No reliable figure exists for losses from agent mis-spending.
- **This hackathon is crowded where the obvious ideas are.** The first scan found at least 8 entries building an agent mandate, firewall or guardrail on PayPal, at least 3 building "PayPal holds the money, AI/CI verifies, then capture", and none with multi-hop delegation. **That last finding was wrong**; a wider second scan (below) found two. The gallery is not published, so every scan is a partial view.

## Theses considered

Scores are 1–10 on our own weights: novelty 20%, severity 20%, PayPal relevance 20%, technical/agentic innovation 15%, feasibility in ~36 hours 15%, demo and prize fit 10%.

| # | Thesis | Gap it targets | Nov | Sev | PP | Tech | Feas | Demo | Score |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Splittable spending envelopes**: authority an agent can split for sub-agents but never enlarge, backed by a PayPal hold | Delegation between agents; who authorized this dollar | 7 | 7 | 9 | 8 | 8 | 8 | **7.8** |
| 2 | Outcome-conditional payment: hold, verify the work with CI + AI, then capture | Paying for delivered work | 4 | 8 | 9 | 7 | 9 | 8 | 7.4 |
| 3 | Invoice-to-merge for freelance developers (built earlier as MergePay) | Getting paid for a PR | 6 | 6 | 8 | 6 | 9 | 7 | 6.95 |
| 4 | Atomic multi-merchant purchase: all-or-nothing across N merchants using authorize / void as two-phase commit | Partial success in agent purchases | 7 | 6 | 9 | 7 | 5 | 7 | 6.9 |
| 5 | Promise verification before capture (built earlier as Kept) | Agent said one price, charged another | 6 | 6 | 8 | 6 | 9 | 5 | 6.75 |
| 6 | Agent surety bond: the agent's operator posts a hold that is captured on proven error | Who pays when an agent is wrong | 8 | 6 | 8 | 6 | 5 | 6 | 6.65 |
| 7 | Flat mandate + policy firewall in front of PayPal | Unbounded agent spending | 3 | 8 | 7 | 6 | 8 | 7 | 6.4 |
| 8 | Dispute autopilot: assemble evidence for PayPal disputes | Dispute handling cost | 4 | 7 | 8 | 5 | 6 | 6 | 6.05 |
| 9 | HTTP 402 metered access settled through PayPal | Pay-per-call for agents | 4 | 6 | 7 | 6 | 6 | 6 | 5.8 |
| 10 | Co-signed reconciliation receipts between two agents | Each side's books disagree | 6 | 5 | 6 | 6 | 6 | 4 | 5.6 |
| 11 | Agent financial reputation built from receipts | Trusting an unknown agent | 5 | 5 | 5 | 5 | 6 | 5 | 5.15 |
| 12 | Subscription negotiation and cancellation agent | Subscription waste | 3 | 6 | 6 | 4 | 6 | 6 | 5.1 |

## Shortlist and adversarial review

**1. Splittable envelopes (chosen).**
- *Why it might already exist*: the cryptographic pattern does (macaroons, Biscuit, UCAN, L402, ERC-7710, IETF drafts such as `draft-niyikiza-oauth-attenuating-agent-tokens` and `draft-hamr-oauth-agent-delegation`). One project, Tenuo, even calls its tokens "warrants", which is why this one isn't. No implementation was found that combines multi-hop attenuation, money budgets debited at every ancestor and a fiat rail; none on PayPal.
- *Why users might not need it*: single-agent setups don't. It matters once an orchestrator spawns sub-agents, which is how agent frameworks now work.
- *Why a judge might call it superficial*: "the gateway is online anyway, so why signatures?" Answer built into the design: the owner's key never reaches the gateway, so the gateway can't mint authority; splits need no server; receipts verify in a browser.
- *What a competitor could build in a day*: a flat spending limit. Not the chain.
- *What could fail live*: PayPal sandbox latency. The flow is API-only (no login page), which removes the usual failure.

**2. Outcome-conditional payment.** Strong problem and fully built here earlier, but three entries already do it and one is live with a deeper implementation. Entering as the fourth is a weak position.

**3. Invoice-to-merge.** Unique among entries found and already built, but a narrow developer tool with a quieter demo.

## Second scan (11 November, after the build)

Before adding agent identity we looked again, more widely: GitHub repository and README searches across about 70 query terms, and about 75 READMEs read. `paypal agent created:>2026-09-01` alone returns over 1,000 repositories. READMEs were read; code and live demos were not opened, and the Devpost gallery returned 403.

What it changed:

| Idea | Already in the hackathon | Closest entries |
|---|---|---|
| "A bank account for AI agents" as a pitch | Yes, with a polished build | AgentPal uses that exact tagline (per-agent keys, allowance wallets, human co-signer; no delegation, no holds) |
| Agent passport, "know your agent", reputation | Yes, at least six | Courier, Doorman, Carte Blanche (signed track-record statement), bit-settled, Vouch (credit score), SentinelX |
| Multi-hop delegation that only narrows | Yes, two | IntentChain (live demo; HMAC-signed grants, so not checkable by third parties; no ancestor debiting stated; immediate capture, no hold), Agent-Pass (hierarchy with reserve/commit; no signature chain stated) |
| One PayPal hold with partial captures | Yes, three, all flat | Cosign, Allowance, AgentLedger |
| Proof of funds for an agent, tied to a live PayPal hold | Not found | Courier and Doorman answer "may it spend this?" from their own ledger |
| All of the above together | Not found | — |

Outside the hackathon, agent identity and wallets are saturated (Skyfire, Catena Labs, Payman, Crossmint, Coinbase, Visa, Mastercard; PayPal has named "Know Your Agent" as a concept). One commercial product, SpendVeto, states ancestor-debited delegation and signed spend attestations; it does not use PayPal holds.

Consequences for this project:

- The headline is not "a bank account for agents". That pitch is taken and would invite a direct comparison on someone else's ground.
- Identity is built (passport, account number, record) but presented as a supporting feature.
- The lead is the part nobody else was found doing: one real PayPal hold behind a whole tree of agents, budgets debited at every level, a chain anyone can verify, and a payee's proof of funds that asks PayPal itself.

## Decision

Build thesis 1 as **Envelope**. It is the only finalist where the mechanism is uncommon in this field, PayPal's own primitives map one-to-one onto it (authorize = seal, partial capture = spend, void = close), and the whole thing can be demonstrated against the real sandbox without a browser login. Earlier work is reused where it helps: the PayPal client, the simulator, the hash-chained audit log and the interface system.
