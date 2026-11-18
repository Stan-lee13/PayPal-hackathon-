# Agentic finance: what this is for

## The problem, stated by the person who has it

> "I have software agents doing work, buying services and hiring other agents. How do I know what each
> one is allowed to spend, which organization authorized it, and whether the resulting transactions are
> legitimate?"

That is not a payments problem. It is an **authority** problem. A payment API key in a prompt is not
authority: it is an unbounded credential with a support ticket attached. What an organization needs is a
way to say, once, in a form software cannot forge:

- this agent may spend at most this much, in total, for these purposes, to these counterparties, until
  this date;
- it may hand a smaller version of that permission to a sub-agent, and never a larger one;
- every euro it moves traces back, signature by signature, to the person who signed that permission;
- when the work is disputed, the evidence is a cryptographic chain, not a screenshot;
- when something looks wrong, the answer is a deterministic refusal or a human's signature — never a
  model's opinion.

Envelope already implements that core. This document is about turning it into infrastructure other
companies, developers and eventually financial institutions can depend on.

## What the product is

**An agentic treasury and spending control plane.** Not a wallet, not a chatbot with a balance, not a
PayPal reskin.

An organization signs up, describes itself, registers its agents, and gives each one a signed envelope
with limits it can verify. Agents spend inside those limits through a gateway that checks every level of
delegation before any money moves. Humans see one treasury view: what is held, what was spent, by whom,
under whose authority, what is set aside, what is disputed, what the provider actually confirms.
Counterparties can verify an agent's standing before doing work, and the payment's evidence afterwards.

The three things that make it defensible, in order:

1. **Authority that cannot be widened by software.** Attenuation is a signature check, not a policy
   service that could have a bug.
2. **Aggregate enforcement.** Limits are checked at every ancestor under one lock, so splitting a
   payment never evades a ceiling.
3. **Provider independence.** The financial engine talks to capabilities (`hold`, `capture`, `payout`,
   `refund`, `statement`), so the authority engine survives a change of financial partner — and can say
   precisely what each partner does and does not guarantee.

## The first buyer

AI automation teams, AI agencies and operations leads at companies already running several agents with
real budgets: they are paying for API calls, data, design, research, and increasingly paying *other
agents*. They do not need a new bank. They need control, attribution and evidence over money that is
already moving.

What they get on day one, without us holding anyone's funds:

- organization and treasury workspace with policies;
- agent registry with signed authority per agent and per sub-agent;
- a pre-payment check any counterparty can call (signed standing, five-minute validity);
- approval thresholds that escalate to a human's key;
- a full audit trail: request, decision, chain, provider ids, receipt;
- reconciliation against the provider's own statement, with fees visible.

## Non-goals (for now, and stated plainly)

- **We do not become a bank or a custodian.** Internal balances are an accounting record, not deposits,
  and are not safeguarded. Holding other people's money requires a licensed partner; until one is
  contracted, the product must not accept customer funds.
- **We do not issue cards.** Envelope's "cards" are signed, merchant-locked spending permissions on an
  agent's balance. They are not Visa or Mastercard, and no page calls them that.
- **We do not call reservations escrow.** A promise reserves money against a provider hold. It is not
  segregated, not neutral, and revocable by the owner.
- **We do not let a model decide money.** Auditing agents may read and propose. Proposals are checked by
  rule and answered with who would have to sign.
- **We do not build a crypto rail to avoid the hard part.** Provider choice follows customer demand,
  jurisdiction and real operational guarantees, not convenience.
- **We do not pretend a provider integration is complete without credentials.** The deterministic mock
  rail and the PayPal simulator exist so that behaviour can be tested honestly; they are labelled as
  simulations everywhere they appear.

## Horizons

**Horizon 1 — the control plane (built, being hardened).** Signed authority, aggregate budgets,
delegation, promises, approvals, treasury view, receipts, reconciliation, audit. Money moves through one
provider adapter (PayPal) whose guarantees are declared. This is where the first paying customers are.

**Horizon 2 — the interoperable rail layer.** A second, real adapter (a payment processor for payouts, a
banking-as-a-service partner for accounts) behind the same capability contracts, with a documented
guarantee matrix per rail. A provider-neutral developer SDK: discover identity, inspect authority, check
budget, request payment, verify counterparty, create a commitment, check status, fetch a verifiable
receipt. Persistent agent identities with key rotation; organization membership with roles; KMS-backed
signing; passkey principals.

**Horizon 3 — accounts for agents, with a regulated partner.** Logically isolated accounts per agent,
funding sources, double-entry books with real control accounts, statements, fees, refunds and disputes
handled through partner capabilities. Escrow-like flows only where the partner genuinely provides
safeguarding, and described with the partner's words, not ours.

**Horizon 4 — the network.** Counterparties verify each other's authority and standing without asking
us; commitments and delivery evidence become portable; agent-to-agent commerce settles across rails. The
value compounds with the number of participants who can verify each other, which is why the authority
format matters more than any single integration.

## How we will know it is working

- An organization can answer "who authorized this, and was it inside the limits?" for any payment, from
  signed data, without trusting our database.
- A compromised agent's blast radius is exactly its own envelope — proven by attack tests, not asserted.
- Adding a financial partner changes adapter code and a capability list, not the engine, the protocol or
  the receipts.
- Every page and receipt states the guarantee that actually applies: hold, reservation, or nothing.
