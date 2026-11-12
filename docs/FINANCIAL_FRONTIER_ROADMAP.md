# Financial frontier roadmap: where Envelope could go after the hackathon

This document is about the long term. Nothing in it is a claim about what exists today; what exists is described in the [README](../README.md) and the [protocol specification](SPEC.md). It is deliberately separate from the hackathon implementation.

## The thesis

Software agents are starting to take part in commerce: they buy, hire and get hired. The systems they use for money were built for people. An agent today borrows a person's credential, and the people and agents it deals with cannot tell what it is allowed to do or whether it can pay.

The gap is not "a wallet for agents". It is the set of things that make someone an accountable participant in an economy:

1. **Authority** that is bounded, delegable and revocable.
2. **Identity** a counterparty can check.
3. **Proof of funds** before work starts.
4. **Obligations** that are recorded and can be settled on evidence.
5. **A record** that travels.
6. **Books** an owner can reconcile.

Envelope's working primitive covers the first item fully and a first version of the others: spending authority that can be split but never enlarged, backed by a hold a payment network enforces.

The ambition is infrastructure that other systems build on, not a finance app. The measure is how many problems other teams can solve because it exists.

## One platform, four layers

```
 Owners and businesses                 capital, policy, oversight
        │
 ┌──────┴───────────────────────────────────────────────────────────┐
 │ 4  Financial services network     partner banks, lenders, insurers│   later, through licensed partners
 │ 3  Treasury                       budgets, allocation, payroll,   │   first commercial product
 │                                   procurement, reconciliation     │
 │ 2  Authority engine               keys, chains, policy, revocation│   exists: this repository
 │ 1  Protocol                       authority, standing, promise,   │   exists as v1: docs/SPEC.md
 │                                   acceptance, receipt, reference  │
 └──────┬───────────────────────────────────────────────────────────┘
        │
 Settlement rails                      PayPal first; others behind the same interface
```

The protocol must stay independent of any one payment provider. PayPal is the first rail because its authorize, partial-capture, void and payout calls map exactly onto seal, spend, close and pay. A second rail has to offer the same four things, or the layer above has to say plainly which guarantees it loses.

### Layer 1: Protocol

What exists: signed messages for a block of authority, a spend, an introduction, a statement of standing, a promise, a keep, an acceptance, an account opening, a receipt and a reference, each under its own signature domain.

What is missing for others to adopt it:

- A versioned, implementation-independent specification with test vectors.
- A Python implementation beside the TypeScript one, and a conformance suite a third-party gateway can run.
- Gateway discovery and key pinning, so a statement from one gateway can be checked by an agent that has never met it.
- A stated relationship to the standards in this area (AP2, the IETF drafts on attenuating agent tokens, UCAN and Biscuit): where Envelope can carry or be carried by them, not a competing dialect for its own sake.
- An external security review.

### Layer 2: Authority engine

What exists: one gateway that verifies chains, debits every ancestor under a lock, reserves before it calls the rail, and issues receipts.

What is missing: key storage that is not demo-grade (hardware-backed owner keys, passkeys); owner approval of the hold through the rail's own checkout or a vaulted instrument; reauthorization before a hold lapses; webhooks; multiple owners and roles on one root; policy that can express more than payees, purposes and amounts (time windows, velocity, step-up approval above a threshold).

### Layer 3: Treasury

What exists: one owner's view across the envelopes sealed with their key, with reconciliation against PayPal and a ledger export. Beside it, for the operator, an auditor: an agent that reads PayPal through PayPal's own Agent Toolkit (five read tools, no credential) and the gateway's books, and proposes actions that a person or the gateway's own rules must carry out (`lib/gateway/auditor.ts`). The fixed procedure ran on the sandbox; a real model has run the audit twice, on the sandbox and on the Auditor page against the simulator.

What it could become, as the first product a business would pay for:

- Budgets by department, project and agent, with allocation and reallocation as a first-class action.
- Procurement: agents buying from approved vendors under policy, with the purchase order, the delivery evidence and the payment bound together.
- Payroll for agents and the people behind them: recurring or per-task payment on accepted work.
- Accounting integration: exports and connectors, so agent spend lands in the general ledger with its chain of authority attached.
- Alerts and approvals for humans where policy demands them.

### Layer 4: Financial services through partners

Only the first two items have working mechanics, on the sandbox. None of it should carry real money without licensed partners. The candidates:

- **Accounts that hold a balance.** The mechanics now exist and run on the PayPal sandbox: an account can keep its income on a ledger, pay another agent's account at once, pay out through PayPal, and be capped and frozen by its owner (`lib/gateway/bank.ts`). What does not exist is the right to do it with real money. Holding a balance on someone's behalf is deposit-taking or stored value and needs a regulated partner to hold the funds.
- **Cards.** A Xenoncard exists as a closed-loop card: an agent's signed permission for one merchant on this gateway to charge its balance, with a cap, a count and a billing period (`lib/gateway/bank.ts`). To be useful beyond this gateway it needs acceptance: a merchant-side library first, and for merchants that only take card numbers, an issuing partner and network tokens (Visa Intelligent Commerce and Mastercard Agent Pay are where that is heading). Issuing on a card network is an issuer's product.
- **Credit.** The record Envelope keeps (payments settled, promises kept, requests refused) is the kind of data a lender would want. Turning it into a credit decision is lending; scoring it at all raises fair-lending and consumer-reporting questions in several jurisdictions. A reference of facts is as far as the current product goes, on purpose.
- **Guarantees and insurance** against an agent's failed obligations. This is an insurer's product.

## Four divisions, one system

The same layers, read as lines of work. They share one protocol, one ledger and one set of signed records; none is a separate product.

| Division | What it owns | What exists today (sandbox) | First thing to build next | Needs a licensed partner? |
|---|---|---|---|---|
| A. Protocol | Identity, authority, delegation, commitments, proof of funds, receipts, references, interoperability | Version 1 of all of these, with test vectors in the test suite; the proof graph that ties them together | A published specification with test vectors and a second language binding; an AP2 mandate as the source of a root envelope | No |
| B. Treasury | Budgets, allocation, approvals, reconciliation, reporting | One owner's treasury, approval inbox, books reconciled against PayPal, ledger export, owner-signed reads | Budgets by project; policy templates; alerts; an accounting export a finance team would accept | No, if the owner's own funds move on the rail's platform product |
| C. Partner-powered banking | Balances, cards, credit, guarantees | Balances and a closed-loop card as mechanics, with owner caps, daily limits and freeze | Nothing with real money until a partner holds the funds; then statements and disputes | Yes, for every item |
| D. Commerce network | Merchants and agents finding, verifying and paying each other | Proof of funds for a payee; commitments released on acceptance; cards a merchant charges with its own key | A merchant-side library; two gateways honouring each other's statements | Depends on what the network holds |

## Business model questions

Nothing here has been tested with a customer or checked against a payment provider's rules.

| Possible model | Who would pay | What must be checked first |
|---|---|---|
| Treasury subscription (per organisation or per agent) | Teams whose agents spend real money | Whether finance teams already get this from their card or spend-management vendor |
| Verification as a service (proof of funds, references, receipts) | Marketplaces and platforms where agents transact | Whether a verification that reserves nothing is worth paying for |
| Per-transaction infrastructure fee | Platforms settling through the gateway | Payment-provider terms and money-transmission law; this is the model most likely to need a licence |
| Open protocol, paid reference gateway | Developers first, then their employers | Whether the protocol is adopted at all |
| Partner revenue share on balances, cards or credit | The partner pays for distribution | Everything in division C |

**First customer to look for:** a team already running several agents that spend on their behalf (an AI automation agency or an agent-product company), whose finance person has asked "which agent spent this, and who allowed it?". They have the problem today, they can use their own funds on a platform product, and they need the treasury before anything else.

## Research questions worth answering

| Question | Why it matters | First experiment |
|---|---|---|
| Can authority travel between gateways? | An agent paid through one gateway should be able to prove its authority to a counterparty on another. | Two gateways that pin each other's keys and honour each other's statements of standing. |
| Can a promise become a guarantee? | Today a promise is earmarked money the owner can still revoke. Payees want more. | A promise the owner pre-commits not to revoke for its lifetime, and what that means on each rail. |
| What evidence should release money? | A named key's signature is the simplest condition. Others are possible: a test suite passing, a delivery confirmation, two of three checkers. | Threshold acceptance (m-of-n named keys). |
| Is a facts-only record useful to a counterparty? | If it is, a score is unnecessary. | Ask agent builders what they would check before working for an unknown agent. |
| How does a human stay in control at scale? | Hundreds of agents and envelopes cannot be supervised line by line. | Policy templates and exception-based review in the treasury. |

## Who would pay, and for what

Hypotheses, not findings:

- **Teams running multi-agent systems** pay for the treasury: seats or a platform fee, when their agents start spending real money and finance asks who authorized it.
- **Platforms and marketplaces where agents transact** pay per verification or per settled payment for proof of funds, promises and receipts.
- **Developers** get the protocol and a reference gateway free; that is the adoption path.
- **Financial institutions** are partners, and later customers for the authority and evidence layer under their own agent products.

Nothing here has been validated with a customer. The first step after the hackathon is conversations, not features.

### Considered and not built: PayPal's Cryptocurrency On/Off Ramp

The capability was switched on for the sandbox app on 12 November. What PayPal's documentation says of it: a limited-release partner service for wallets and dApps. On Ramp lets a customer buy crypto into their own wallet; Off Ramp lets them sell from it, with the dollars landing in PayPal. Both are for approved partners, and the customer completes the step on PayPal's own pages in a browser.

What was checked from here, read-only: `GET /v1/crypto/configurations` on the sandbox answered 200 and lists `TOPUP` and `OFFRAMP` for the US with BTC, LTC, ETH, BCH, SOL and PYUSD. No order entry was created and nothing else was called.

Why nothing was built on it. An envelope is an agent paying from a hold a person has already approved, with no person present at the payment. The ramp needs a person in a browser and a wallet address, and partner approval before it can be offered. The Payouts API, which is how money leaves here, offers PayPal and Venmo wallets only. So the ramp does not fit this lifecycle, and adding a call to it would have been breadth without a use.

Also not built, as stated elsewhere: hold reauthorization (PayPal allows it only from day four, so it cannot be exercised on the sandbox now) and Vault.

## What has to be true before real money

- The owner authorizes the hold through the rail's own flow. No test cards.
- Captured funds do not rest with the gateway. On PayPal that means its platform or marketplace products, so money moves from payer to payee with the gateway as the instructing party, or a licensed partner holds it.
- Know-your-customer and sanctions screening on owners and payees, done by or through a regulated party.
- A legal opinion, per market, on whether operating a gateway is money transmission, payment initiation or neither.
- Key management, incident response, audit logging and an external penetration test.
- Terms that say plainly what a promise, a statement of standing and a reference are, and are not.

Envelope is not a licensed bank, holds no real deposits (the balances are sandbox money), does not extend credit and is not an escrow service. It should not describe itself as any of those until a regulated partner makes one of them true.

## A staged twelve months

| Months | Stage | Outcome that would count as done |
|---|---|---|
| 0–3 | Protocol | Published v1 specification with test vectors; TypeScript and Python libraries; reference gateway; external security review; ten developers who have integrated it without help. |
| 3–6 | Treasury | Budgets, procurement and payroll on the sandbox and one production rail for a handful of design partners using their own funds under the rail's platform product. |
| 6–9 | Partners | One regulated partner for holding balances or for payouts in a second market; a decision, with counsel, on what the gateway is in law. |
| 9–12 | Network | Two gateways interoperating; references and statements honoured across them; a second settlement rail behind the same protocol. |

These are targets. None of them is a promise of regulatory approval, customers or revenue.
