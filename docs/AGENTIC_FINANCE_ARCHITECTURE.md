# Agentic finance: the architecture, as built

This document describes the system that exists in this repository **now**, and the shape it is being
moved into. It is not a wish list: every claim below names the file that implements it. Where a layer is
only partly real, it says so in the same sentence.

Companion documents: `AGENTIC_FINANCE_VISION.md` (what the product is and who buys it) and
`AGENTIC_FINANCE_MIGRATION_PLAN.md` (what changed in this milestone, what is still PayPal-shaped, and
what happens next).

---

## 1. The invariant everything else serves

> **AI proposes. Cryptography establishes authority. Deterministic policy decides what is permitted.
> The provider confirms what actually happened.**

Three mechanisms enforce it, and none of them read model output:

1. **Signed authority** (`lib/envelope/core.ts`, 590 lines). Ed25519 signatures over canonical JSON.
   A root envelope is signed by a human key and names agent keys and caps. A split produces a *child*
   block signed by the parent's holder, with caps that `narrowingViolations` proves are a strict subset.
   Nothing can widen: not the child, not the gateway, not a bug in a policy check.
2. **Budget enforcement** (`lib/gateway/service.ts`, `admit`). Under `pg_advisory_xact_lock` per root:
   verify the chain, register unseen blocks, check revocation at every level, check the budget of every
   envelope on the path, refuse a request hash already seen, then reserve at every level *before* any
   provider call. This is where subdivision attacks die: a thousand small requests still meet one
   aggregate limit per ancestor.
3. **The rail** (`lib/rails/`). The provider is asked to move money, and its answer — captured by id,
   read back — is the only evidence that money moved. A gateway row is a claim about the provider, not a
   substitute for it.

A signed receipt proves authority and capture. It does **not** prove the payee received the money, nor
that any work was performed (`lib/gateway/service.ts` `settle`, `Receipt.paypal.payoutStatus` records
the provider's word at signing time). `docs/FINANCIAL_ARCHITECTURE.md` already said this; it stays true.

---

## 2. Layers, mapped to code

### Layer A — Agent identity and authority

| Concern | Today | Where |
|---|---|---|
| Human principal, agent keys | Ed25519 keypairs, public keys are identities | `lib/envelope/core.ts` (`generateKeyPair`, `fingerprint`) |
| Authority manifest | `Caps`: `limit`, `perPayment`, `payees`, `purposes`, `notAfter`, `approveOver`, `splits` | `lib/envelope/core.ts` |
| Delegation | `split()` re-signs a narrower block; a split that widens fails `verifyChain` | `lib/envelope/core.ts` |
| Revocation | Signed revoke by owner, ancestor or holder; root revoke closes the envelope | `revoke()` in `lib/gateway/service.ts` |
| Standing (portable creditworthiness) | Signed `envelope-standing/1` answer to "would this payment go through now?", 5-minute TTL | `standing()` in `lib/gateway/service.ts` |
| Reference (record) | Signed `envelope-reference/1` facts, no score | `reference()` in `lib/gateway/service.ts` |
| Accounts | Agent account number derived from the key; owner co-signs the opening; income settles or is held | `openAccount()` in `lib/gateway/service.ts`, `lib/gateway/bank.ts` |

**Not built, and deliberately not faked:** key rotation and recovery (a lost agent key is a lost agent),
organization membership with roles, and passkey/hardware-backed principal keys. The owner key currently
lives in browser local storage (`app/console`), and the gateway's own signing key is sealed with an
environment secret (`lib/keystore.ts`). Both are recorded as production blockers in
`AGENTIC_FINANCE_MIGRATION_PLAN.md` §5.

### Layer B — Financial policy and control engine

Implemented and deterministic:

- total budget, per-payment limit, payee allow-list, purpose allow-list, expiry, split depth
  (`lib/envelope/core.ts` `narrowingViolations`);
- aggregate enforcement across the whole chain, including ancestors, under one lock
  (`admit` in `lib/gateway/service.ts`);
- approval threshold: `caps.approveOver` makes an over-threshold payment or promise release require the
  owner's signature (`keep()` and `decidePromise()`);
- account-level controls independent of the envelope: freeze, per-payment cap, 24-hour cap
  (`ownerRules` in `lib/gateway/bank.ts`);
- card controls: per-charge cap, billing period, charge count, expiry, merchant lock
  (`charge()` in `lib/gateway/bank.ts`);
- revocation and emergency close (`revoke`, `closeRoot`).

**Not built:** daily/weekly/monthly windows on *envelope* spend, velocity rules, category or geographic
restrictions, multi-party approval beyond one owner, organization-level policy inheritance, risk-based
limits. The place they belong is a policy stage between `verifySpend` and the reservation in `admit`,
evaluating a policy document that is itself signed — not inside the rail, and never inside a model.

### Layer C — Treasury and ledger

- Per-agent balances with a **single-entry-per-account ledger** whose `(agent, kind, ref)` unique index
  is the idempotency guard (`lib/db/schema.ts` `ledger`; `lib/gateway/bank.ts`).
- `position()` proves two equalities every time it is asked: balances equal the sum of ledger rows, and
  the ledger equals captures into accounts minus payouts and refunds.
- `reserves()` compares what the gateway owes (balances + refunds due) with what the provider reports,
  **at the provider's own timestamp** (`lib/gateway/books.ts`).
- `statement()` matches every capture, payout and refund against the provider's independent statement,
  and is the only place provider fees appear.

**Honest limits.** This is double-entry only in the weak sense (one row per movement, with
`balanceAfterMinor`); there is no chart of accounts, no separate receivable/payable accounts, no accrual
accounting, no multi-currency positions, no organization or project budgets. Balances are **stored value
held by whoever operates the gateway**, which is why `bank.ts` says so at the top: real deployment needs
a licensed partner. A balance here is not a bank deposit and no page claims it is.

### Layer D — Agentic commerce and commitments

`promise()` sets money aside before work starts (`PROMISED`, reserved at every level), hands the payee a
signed `envelope-promise-note/1`, and `keep()`/`accept()` pay or release it. `accept()` lets a named
`releaseBy` key attest delivery, and the fingerprint of the accepted work goes on the receipt.

This is **a promise backed by a reservation of a provider hold**, not escrow. Funds are not segregated,
there is no neutral third party, and the owner can revoke. The pages and documents say "promise", never
"escrow".

Disputes exist in the narrow sense: the provider tells us a payer disputed a capture, and the gateway
answers with the signed chain of authority (`settleDisputes`, `evidence` in `lib/gateway/books.ts`).
Delivery evidence is a signature, not an adjudication.

### Layer E — Financial execution: the rail boundary (new in this milestone)

`lib/rails/` is the provider boundary. It is capability-based rather than one god-interface, because
rails genuinely differ and a rail must never report a guarantee it does not have.

```
lib/rails/types.ts        Capability, Guarantee, RailRef, Amount, typed requests/facts, RailError
lib/rails/registry.ts     which rail this deployment uses; registerRail() for a partner adapter
lib/rails/paypal-rail.ts  the reference adapter (the only module allowed to import lib/paypal/*)
lib/rails/mock-rail.ts    deterministic, capability-aware adapter for contract tests
lib/rails/index.ts        rail(), railMode() — the whole surface the engine imports
```

**Capabilities** (`Capability` in `types.ts`): `funding.authorize-hold`, `funding.approval-link`,
`funding.test-instrument`, `hold.read`, `hold.capture`, `hold.void`, `payout.send`, `payout.read`,
`payout.cancel`, `refund.capture`, `reporting.balance`, `reporting.statement`, `events.verify`,
`events.list`, `dispute.read`, `dispute.respond`, `observability.trail`.

**Guarantees** (`Guarantee`): `authorization-hold`, `reversible-payout`, `internal-reservation`,
`safeguarded-funds`, `card-issuing`. No shipped adapter claims the last two, and a contract test asserts
that (`tests/rails-contract.test.ts`, "no shipped rail claims custody, safeguarding or network card
issuing").

What moved behind the boundary in this milestone:

| Engine operation | Before | Now |
|---|---|---|
| Seal a root (hold) | `authorizeHold(getPayPal(), …)` | `rail().holds.authorize({ reference, amount })` |
| Payer approval | `requestHoldApproval`, `getOrder`, `authorizeApprovedOrder` | `holds.requestApproval/readOrder/authorizeApproved` |
| Capture | `capturePart(pp, authId, …)` | `holds.capture({ hold, reference, amount })` |
| Release the rest | `voidAuthorization` | `holds.void({ hold, reference })` |
| Payout | `payout(pp, { spendId, … })` | `payouts.send({ reference, receiver, amount })` |
| Read a payout | `getPayout` | `payouts.read(payout)` |
| Recall unclaimed | `cancelPayoutItem` | `payouts.cancel(item)` |
| Refund | `refundCapture` | `refunds.refund({ capture, reference })` |
| Balances / statement | `getBalance`, `listTransactions` | `reporting.balance/statement` |
| Webhook verification / feed | `verifyWebhookSignature`, `listEvents` | `events.verify/list` |
| Disputes | `disputesFor`, `listDisputes`, `provideEvidence` | `disputes.forCapture/list/respond` |

Errors are one vocabulary now (`RailError`): `unsupported_capability`, `invalid_request`, `declined`,
`duplicate`, `not_ready`, `not_found`, `auth`, `in_doubt`. `not_ready` means *the provider is busy with this
reference; try the same one again shortly and change nothing* (PayPal says this for a short window after a
payout batch is sent). `in_doubt` means *the effect is unknown* — the caller
re-presents the same reference and lets the provider's idempotency settle it, and never compensates on a
guess. That single distinction is what makes the payouts and refunds recoverable.

**Idempotency is domain-owned.** Every mutating request carries `reference` — the spend, transfer or
envelope id. The adapter derives its own wire key (PayPal: `capture-<reference>`, `payout-<reference>`,
`seal-<reference>`, `refund-<reference>`, `close-<reference>`), so wire behaviour and the existing journal
are unchanged, while the contract stays provider-neutral.

**What the engine asks of a rail instead of asking PayPal.** `rail().trail.calls(keys)` returns the neutral
`RailCall[]` behind an envelope — operation, human text, whether it moved money, whether the same request
was sent twice, provider status, debug id, amount, request id — so the engine no longer reads the PayPal
journal. `rail().events.parse(body)` recognises an inbound event's shape inside the adapter, so
`POST /api/rails/webhook` is the only ingress and `/api/paypal/webhook` is an alias for webhooks already
registered. `rail().flush()` writes whatever the rail buffers, and `/api/health` reports the resolved rail's
id, label, mode, capabilities and guarantees — read from the rail, so no page can advertise more than the
code does.

The engine also refuses *before* asking. Sealing on a rail without `hold.*` answers 501 and creates no row;
recalling a payout without `payout.cancel` answers 501 and changes nothing; a statement a rail cannot
produce is reported as `available: false` with a reason, never as "everything reconciles".

**The mock rail** (`lib/rails/mock-rail.ts`) is deterministic: counter-derived ids, injectable clock,
injected failures (`failNext`, `declineNext`), and a `profile` that can withhold capabilities. It copies
the behaviours the engine depends on — a capture cannot exceed its hold, a duplicate reference returns
the first answer, a refund does not restore the hold, an unclaimed payout can be cancelled. It is not a
provider and no page offers it as one.

### Layer F — Financial intelligence and auditing

`lib/gateway/auditor.ts` gives an auditing agent four read tools over the gateway's books plus PayPal's
own Agent Toolkit read tools (`lib/paypal/toolkit.ts`, locked to five GET-only reads). It can propose
four things; a proposal is checked by rule and answered with *who would have to sign*
(`checkProposal`). `lib/ai/auditor.ts` runs a model over those tools with a scripted fallback, and
`scripts/auditor-memo-check.ts` proves a memo that gives the model orders gets refused.

Not built: anomaly detection, duplicate-payment detection, exposure analysis, forecasting, counterparty
risk scoring. Those are read-only analyses over data that already exists (ledger, statement, events) and
belong on top of the audit path, never in the authority path.

---

## 3. Provider-neutral domain model (data)

Legacy columns keep their provider-flavoured names because they are part of signed v1 receipts and
existing rows. What matters is that the *engine* now passes `RailRef` values and stores `ref.id`:

| Signed record / column | Holds | Compatibility note |
|---|---|---|
| `roots.authorization_id` | `RailRef<"authorization">.id` | written via `refId(auth.ref)` |
| `roots.paypal_order_id` | `RailRef<"order">.id` | same |
| `spends.capture_id`, `payout_batch_id`, `payout_item_id` | `RailRef<…>.id` | same |
| `spends.receipt.paypal.{authorizationId,captureId,…}` | provider ids | field names are v1 protocol; `mode` now names the rail |
| `transfers.payout_batch_id` | `RailRef<"payout">.id` | same |
| `paypal_calls`, `paypal_events` | the PayPal rail's own journal and inbox | provider-specific by design; see migration plan §3 |
| `roots.rail_provider`, `spends.rail_provider`, `transfers.rail_provider` | which rail wrote the row | `0009`, `not null default 'paypal'`; informational, never read back to decide anything |

Money is integer minor units with an explicit currency, end to end (`lib/money.ts`; `Amount` in
`lib/rails/types.ts` rejects floats, negatives and non-ISO codes). No path multiplies a float.

---

## 4. Threat model notes that shaped this

- **A compromised agent** can at most spend its own narrowed authority, to its allowed payees and
  purposes, within its own and every ancestor's budget. `tests/gateway.test.ts` ("a compromised agent is
  contained") asserts it, and `tests/attack-corpus.ts` carries 171 scripted attacks across tampered
  chains, budgets, promises, accounts, balances, cards and books.
- **A forged event** can cause a read and nothing else: `applyFresh` in `lib/gateway/settlement.ts`
  resolves the record the event names, then asks the provider for that record by id before changing
  anything.
- **A malicious rail** is out of scope of any signature check — which is the point of the capability
  declaration: the engine asks only for what a rail says it can do, and the guarantees list is what
  receipts and pages may claim. Choosing a rail is a trust decision made by the operator, not by code.
- **Prompt injection** is treated as data everywhere: `agentNote`, memos and dispute text are stored and
  quoted (`quoted()` in `lib/gateway/auditor.ts` strips control characters), never interpreted.

---

## 4b. The developer surface today, and the neutral one it becomes

What exists (`sdk/`, `scripts/`):

- `sdk/src/gateway.ts` — `Gateway`: seal, split announcement, spend, promise, keep, accept, standing,
  reference, account, transfer, card, refund, recall, proof, reconcile. Thin HTTP client over
  `lib/api/handlers.ts`, so the SDK and the pages exercise the same endpoints.
- `sdk/src/verify.ts` — `verifyReceipt`, `verifyStanding`, `verifyPromiseNote`, transfer receipts:
  re-check a signed record in the holder's own process, without trusting the gateway.
- `sdk/src/money.ts` — the same integer-minor-unit rules as the server (`lib/money.ts`).
- `sdk/src/agent.ts` — an agent's key management and request signing, used by `scripts/agent.ts` and
  `examples/hire-an-agent/`.
- `scripts/mcp.ts` — the MCP server. Read tools only, and the carrier is locked to GET where a tool only
  reads; a proposal is not a payment. `tests/mcp.test.ts` asserts the tool list and the refusals.

What the provider-neutral SDK adds, and why each verb is safe to expose to software:

| Verb | Answers | Why an agent may have it |
|---|---|---|
| discover identity | which key am I, which account number is mine | derived from the key it already holds |
| inspect authority | my chain, caps, spend, reservations, expiry, revocations | signed data, read-only |
| check budget | what is left at every level right now | read-only; `standing()` is the signed version |
| request payment | move money inside the authority | the request must be signed by the holder's key |
| verify counterparty | is this agent who it says, and good for the money | `standing()` is signed and expires in 5 minutes |
| create a commitment | set money aside before work | reserves inside existing caps; revocable by the owner |
| check status | what the provider says now | read-back by id, never a cached guess |
| fetch a receipt | verifiable evidence | signatures, checkable offline |

Two rules for this surface, kept from the existing MCP design: **reads are free, writes are signed**, and
**proposing is never paying**. `RAIL_PROVIDER`-style selection stays operator configuration: an agent
cannot choose which financial rail moves its owner's money.

## 5. What is simulated, and what that means

| Thing | Status |
|---|---|
| `PAYPAL_MODE=simulated` / no credentials | `lib/paypal/emulator.ts`, in-memory (or Postgres with `ENVELOPE_SIM_PERSIST=1`); every page shows a SIMULATED banner |
| PayPal sandbox | real API, test money, only reachable with credentials this repository does not contain |
| `ENVELOPE_RAIL_PROVIDER=mock` | the deterministic rail: no network, no money, contract tests only |
| Card "numbers" | signed permissions, not network cards; no issuer, no BIN |
| Balances | internal accounting; not safeguarded, not deposits |
| Disputes | provider-reported; evidence is a signed chain, not a ruling |

Nothing in the repository moves real money, and nothing claims a licence, a partnership or a regulator's
approval. Production would require a regulated partner for custody, safeguarding and issuing.
