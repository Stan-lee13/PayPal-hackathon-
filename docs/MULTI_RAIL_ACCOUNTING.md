# Multi-rail accounting

What this document is: the model that lets the gateway represent money that lives at more than one
financial provider without ever inventing any. It describes what the code in
`lib/accounting/` and migrations `0010`/`0011` actually does, not an aspiration.

This milestone deliberately implements **no** conversion: no FX, no stablecoin, no bridge. The only ways
value crosses a provider boundary are a real settlement leg that already arrived at the destination, or
an operator funding its own account. Both are refused by default.

---

## 1. The failure this model exists to prevent

An organization funds an envelope with $1,000 through Provider A. The gateway credits Agent Alpha $400,
Alpha sends $100 to Agent Beta, and Beta asks to withdraw $200 through Provider B.

Every step is internally valid: the ledger balances, the budgets are respected, the signatures verify,
and the application tests pass. And it may still be a lie:

* The $1,000 is at Provider A. Provider B holds nothing for this organization.
* A payout order at Provider B debits *Provider B's* account. If Provider B will honour it, the money
  came from the operator's own funds or from another customer's float — not from this organization.
* If nothing is at Provider B, the payout fails, or worse, succeeds out of funds that belonged to
  somebody else, and the books here still say everything is fine.

A single unqualified `balanceMinor` cannot tell the difference between "we owe this agent $400" and
"this agent's money is available to spend at Provider B". That is the whole problem, and it is why the
accounting model has two books, not one.

## 2. Two books, two questions

| Book | Table | Question it answers | Kind of fact |
| --- | --- | --- | --- |
| **Ledger** | `ledger` | What does this gateway *owe* an agent? | Internal claim, derived from our own decisions |
| **Provider positions** | `position_entries` | What actually arrived at, or left, a provider account? | External fact, append-only |

They must agree in aggregate for a solvent operator, and they answer different questions even when they
do. `ledger` rows are what an agent can spend *inside* the system; `position_entries` rows are what
backs those claims *outside* it.

Both are additive to the pre-existing schema: `ledger` gained `rail` and `currency` (defaulting to
`paypal`/`USD`, which is what every existing balance was in fact funded with), and
`position_entries`, `rail_accounts` and `reconciliation_runs` are new tables. No historical row was
rewritten. `scripts/migration-upgrade-check.mjs` proves that on a real Postgres by taking a database to
migration `0009`, writing records in the old shape, applying `0010`/`0011`, and checking every count,
the captured amount, the balance and the backfilled provenance.

### Ledger (internal liability)

```
ledger(agent, kind, ref, delta_minor, balance_after_minor, rail, currency, …)
unique(agent, kind, ref)          -- a credit or debit is never applied twice
```

`rail` + `currency` are the **provenance of the claim**: which provider's money funded it. A balance is
only payable through a rail that funded it. `fundedByFor(agent)` reports the split, e.g.
`[{rail: "paypal", currency: "USD", minor: 400}]`.

### Provider positions (external fact)

```
position_entries(owner, rail, currency, custody, bucket, kind, delta_minor, ref, …)
unique(rail, currency, bucket, kind, ref)   -- one arrival is counted once, ever
```

* `owner` — the organization (envelope principal, or an account's owner) whose money moved.
* `rail` — the financial provider (`paypal`, `mock`, a partner's id).
* `currency` — ISO-4217, per position. **There is no unqualified balance.**
* `custody` — where it is held: `provider`, `gateway-ledger`, `safeguarded-partner`.
* `bucket` — `available`, `pending`, `fee`.
* `kind` — `capture`, `capture_pending`, `payout`, `payout_return`, `refund`, `fee`, `adjustment`.
* `delta_minor` — signed: money in positive, money out negative.

Buckets and kinds are validated against each other (`coherent()`): a capture cannot be recorded in the
fee bucket, a fee cannot be recorded as available. A wrong combination throws rather than quietly
drifting the books.

The idempotency key is deliberately **not** the domain record alone: it includes rail, currency, bucket
and kind, so the same spend can have a capture and a refund, and a payout and its return, without
colliding — and the same statement line can never be counted twice.

### Position arithmetic

```
availableMinor     = Σ delta where bucket = 'available'      (gross of fees)
pendingMinor       = Σ delta where bucket = 'pending'
feesMinor          = Σ −delta where bucket = 'fee'           (a POSITIVE cost: 200 means $2.00 taken)
netAtProviderMinor = available + pending − feesMinor
spendable          = available − feesMinor
```

Fees live in their own bucket because a fee is money the provider took, not money the organization can
spend. Mixing them is exactly how a fee becomes phantom liquidity. `liquidityAt()` and
`requireProviderLiquidity()` compute spendable as `available + fees` — net of what has already been
taken.

## 3. The dimensions, explicitly

| Dimension | Where it lives | Why it is separate |
| --- | --- | --- |
| Organization ownership | `roots.principal`, `accounts.owner`, `position_entries.owner` | Who the money belongs to, regardless of where it is |
| Internal account balance | `accounts.balance_minor` (+ `ledger`) | A claim inside this system |
| Currency / asset | `ledger.currency`, `position_entries.currency` | USD at one rail and EUR at another are not the same money |
| Financial provider | `ledger.rail`, `position_entries.rail`, `rail_accounts.rail` | Where the money is; the only thing that can move it |
| External provider account | `rail_accounts.external_account_id` | The merchant/account id at the provider |
| Custody location | `position_entries.custody`, `rail_accounts.custody` | Provider account vs our ledger vs a safeguarded partner |
| Available funds | bucket `available` | Spendable now at that rail |
| Reserved funds | `blocks.reserved_minor`, `spends` in flight | Promised internally; not settled revenue, not provider liquidity |
| Pending transfers | bucket `pending`, `spends.status = PAYOUT_PENDING` | Accepted by the provider, not finished |
| Settled funds | bucket `available` + provider status `SUCCESS` | Money the provider says arrived |
| Reconciliation status | `reconciliation_runs` | When it was last checked, against what, with what verdict |
| Fees and liabilities | bucket `fee`, `accounts.balance_minor`, `REFUND_DUE` spends | What we owe, and what was taken |

Reserved funds are **not** liquidity. An internal reservation (`blocks.reserved_minor`) is a promise
inside this system; it does not exist at any provider and cannot be paid out from one. The ledger is
only credited when the capture actually arrives.

## 4. The rule, in one function

```ts
await requireProviderLiquidity({ rail, currency, amountMinor, what, fundedByRail });
```

* Scope: the **provider account**, aggregated across owners (`owner` omitted). The money at the provider
  is one pool; per-organization slices are for reporting and reconciliation, not for pretending each
  organization has its own vault at PayPal.
* It refuses before anything is sent, with a 409 and a sentence naming what *is* available.
* It is not advisory: the payout path calls it, catches the refusal, and parks or refunds the payment.
* If nothing is tracked for that rail at all (a database from before `0010`, or a balance credited
  directly), it falls back to the record's own `rail` provenance rather than guessing — and says so in
  the error.

## 5. Inter-provider transfers

`lib/accounting/inter-rail.ts` is refusal-first. `planInterRailTransfer` is pure; `assertInterRailTransfer`
checks the funding leg against the gateway's own position rows; `interRailRefusal` maps the decision to
an HTTP status; `refuseInterRailTransfer` throws it.

| Request | Decision | Status |
| --- | --- | --- |
| Same rail, same currency | `internal` — a book movement, no liquidity created | allowed |
| Different currency | `CURRENCY_CONVERSION_NOT_SUPPORTED` — no implied rate, no rounding | 501 |
| Different rail, no funding leg | `FUNDING_REQUIRED` — an internal balance at A is not liquidity at B | 409 |
| Funding leg at the wrong rail/currency | `FUNDING_MISMATCH` | 409 |
| Funding leg settled less than the amount | `FUNDING_SHORT` | 409 |
| Funding leg present, no explicit authorization | `NOT_AUTHORISED` — this is an operator liquidity operation, not a customer instruction | 403 |
| Funding leg present, authorized, **and recorded in `position_entries`** | `funded` | allowed |

The last row is the important one: a caller cannot assert its own funding. The row has to exist, be in
the `available` bucket, at that rail and currency, for at least the amount. A capture id from another
provider is not a funding leg.

Nothing in this milestone initiates a cross-provider funding leg. Authorizing one is an operator action
outside the gateway (a real bank transfer or a treasury operation at the destination provider), and the
arrival is recorded with `postCapture`/`recordExternalMovement` (kind `capture` or `adjustment`) before
a transfer may be planned.

## 6. Fees

The red-team finding (`docs/RED_TEAM_REPORT.md:172`) is that a provider charges fees on payments the
application considers successful. The gateway credits agents and payees the **gross** amount, so a fee is
a loss to whoever operates the gateway, and nothing in the ledger showed it.

Now:

* `statement()` reads the provider's own statement and reports, per line, the gross, the fee and the net.
* `reconcilePositions()` calls `postFee()` for every fee the statement lists, keyed by the statement line
  (`unique(rail, currency, 'fee', 'fee', lineId)`), so it is recorded once and never twice.
* The fee sits in the `fee` bucket: `netAtProviderMinor` shrinks, `availableMinor` is unchanged, and
  spendable is `available − fees`, so the fee cannot be paid out.
* One convention everywhere: fee amounts are a **positive cost**. The stored deltas are negative (money
  left), but `positionsFor()` negates them on the way out so no caller can add a cost to liquidity by
  accident. `tests/accounting.test.ts` proves the four numbers separately against the provider's own
  statement (gross, fee, net at provider, spendable) and proves that a fee reversal (a statement
  correction recorded as a positive `fee` movement) gives the money back without touching `available`.
* Each fee is reported as a finding (`unexpected_fee`, warning) naming the amount and the payment.
* `reconciliation.fees` reports `{chargedMinor, recordedMinor, absorbedBy}`.

This does not reprice anything: fees are still absorbed by the operator. Recovering them from agents
(premium pricing, fee passthrough, a reserve) is a product decision, listed as a future enhancement.

## 7. Reconciliation

`reconcilePositions(hours)` compares provider-side positions with the provider's own statement and keeps
a `reconciliation_runs` row with a timestamp, a window, `available`, `ok` and the findings.

| Finding | What it means |
| --- | --- |
| `missing_transaction` | We have a record the statement does not list. Warning within the statement's 3-hour lag, error after it. |
| `duplicate_transaction` | The same statement line twice, or two payouts for one payment. |
| `amount_differs` | The statement's amount is not ours. |
| `unexpected_fee` | The provider took a fee on a line we credited gross. |
| `reversed_transfer` | A payout came back at the provider and no return is on our position: the books still show it gone. |
| `inconsistent_settlement` | Status and provider facts that cannot both be true (PAID with a `FAILED` payout, a capture that was never posted, a return on a payment that still says delivered). |
| `insufficient_liquidity` | A position went negative: payouts went out that were never funded there. |
| `position_differs` | The arithmetic check: our net for the listed lines ≠ the provider's net. |
| `other_activity` | Statement lines that are not this gateway's (fees, holds, another integration). |

**An unavailable statement is never a pass.** If the rail cannot give a statement — no capability, or it
is down — the run is stored with `available: false, ok: false` and a finding saying why. There is no code
path in which "cannot ask" becomes "reconciled".

## 8. What the model does not claim

* **The provider account is an omnibus treasury.** See §9: by default the operator runs one provider
  account for every organization, and the policy is `pooled`. Per-owner slices exist and are used in
  `allocated` mode, but this deployment's topology is pooled, and nothing here claims segregated custody.
* **No custody separation.** `custody` distinguishes `provider` from `gateway-ledger` (and reserves the
  name `safeguarded-partner`), but this code does not implement a safeguarded or escrow account, and no
  adapter claims one. Client money held in the gateway's own provider account is not safeguarded money.
* **No FX, stablecoin or bridge.** Refused with 501 rather than approximated.
* **Single-entry positions.** Each event is one row with a kind; there is no contra-account. The
  arithmetic check (`position_differs`) and the unique key are what stand in for double entry.
* **USD only in practice.** The dimensions are per currency; no end-to-end run exists for a second
  currency, because no second currency has a funding source.
* **A cross-rail funding operation is not atomic and is not implemented.** See §12.

## 9. Treasury policy: whose money backs a payout

One provider account holds every organization's money. That is an operator-run **omnibus treasury**, and
the code says so instead of implying per-tenant custody:

**A production deployment must choose explicitly.** `ENVELOPE_TREASURY_MODE` has no production default:
`assertTreasuryPolicy()` runs before any payout leaves and refuses with HTTP 503 while the variable is
unset when `NODE_ENV=production`. Pooled mode is a real decision — the operator's account backs every
tenant and the operator carries the obligation — so it has to be written down, not inherited from a
default. Development and tests keep the pooled default so local flows still work.

| `ENVELOPE_TREASURY_MODE` | What the guard checks | What it means |
| --- | --- | --- |
| unset / `pooled` (default) | the provider account | The operator's account backs every tenant's claim; the operator owes each tenant its balance and carries the float risk. |
| `allocated` | the organization's own position **and** the provider account | Requires a provider topology with one account per organization. One tenant cannot consume another's funds; moving value across owners would be a treasury transfer, which is not implemented. |

`treasuryMode()` and `treasuryMeaning()` (`lib/accounting/policy.ts`) are exported and quoted in the
guard's refusal text, so a reader of an error or a books page never has to guess which policy is in
force. In `allocated` mode the guard fails **closed**: a payout it cannot attribute is refused, never
paid from another organization's money.

Residual risk in `pooled` mode, stated plainly: tenant A's claim is backed by the same account as tenant
B's. Solvency is checked in aggregate by `reserves()` (what is owed vs what the provider holds), and
nothing in this repository is a custody or safeguarding arrangement. Per-tenant protection needs
per-tenant provider accounts (a partner bank), which is a different product.

## 10. Settlement leases and fencing

Finishing a payment touches an external provider, which can take arbitrarily long, so "one worker at a
time" cannot be a fixed timeout. `settle()` takes a **renewable lease** on the payment
(`spends.settling_at`) and a **fencing token** (`spends.settle_generation`, incremented on every
claim):

* the lease is renewed by a heartbeat every `min(5s, lease/3)` while the work continues, so a slow
  provider call does not hand the payment to a second worker;
* every write that decides what happens to the money (`payoutBatchId`, the final status, the refund)
  carries `settle_generation = <mine>`; a worker whose lease lapsed writes nothing — a takeover owns the
  record, and its generation differs;
* a takeover bumps the generation, so the old worker's `lease.assert()` fails and `settle()` returns the
  current record instead of finishing its decision;
* `SETTLEMENT_LEASE_MS` tunes the lease (floor 5 s).

An interrupted provider call is **not** an unsent one. A retryable rail error marks the payment
`payoutStatus = IN_DOUBT` and changes nothing else: no refund, no receipt. The next arrival re-sends with
the same idempotency reference, which returns the same payout if the provider already accepted it, and
records it then. A payout that was definitely refused is still refunded; a payout that might exist is
not.

Proven by `tests/settlement-lease.test.ts`: a provider call longer than the lease (renewed, no takeover);
a provider that accepted a payout the database never recorded (one payout after retry, no refund); an
ambiguous interruption (parked, then paid once); and a lapsed worker that tries to write an outcome
a takeover already owns (fenced out, still one payout).

Remaining window: a process paused (GC, SIGSTOP, container throttle) for longer than the lease can lose
it and later resume. The fence stops it from writing; its *provider* call already carried the same
idempotency reference as the takeover's, so the external effect stays single. That is why the reference,
not the lock, is the last line of defence.

### 10.1 Fencing does not fence the wire: the adapter states its idempotency contract

A fencing token stops a stale worker from writing to *this* database. It cannot recall an HTTP request
that already reached the provider. Whether a retry is safe is therefore the provider's promise, and each
adapter states it (`Rail.idempotency`):

| Field | Meaning |
| --- | --- |
| `sameReferenceIsSameOperation` | a repeat with the same reference returns the original operation |
| `retryWhileInFlight` | a repeat while the first call is still processing is safe |
| `memoryMs` | how long the provider remembers the reference (`null`: not published) |
| `lookupByReference` | the operation can be found again from our reference alone |
| `note` | the same thing in plain words |

`mayRetryAutomatically()` requires the first two. The mock promises both; **PayPal promises only the
first** — it deduplicates payouts by `sender_batch_id`, but publishes no retention window and no promise
about a repeat while a batch is processing, and offers no lookup by our reference. So an interrupted
PayPal payout is not re-sent: it stays `IN_DOUBT` until someone establishes what PayPal did.

That someone uses `resolvePayoutDoubt(spendId, how)`, which takes the settlement lease, requires the four
facts an auditor needs, and — for `sent` — asks the provider rather than trusting what it was handed:

* `by`, `source`, `checkedAt`, `rationale` — who decided, where the fact was observed, when, and why a
  retry cannot produce a second payment. All four are required and all four are written to the trail.
* `{ kind: "sent", batchRef, itemRef? }` — `batchRef` is a **lookup key, not proof**. The rail is asked
  for the batch; only its answer is recorded, and only if it matches this payment: the item id, the item's
  own amount and currency, and the receiver must all agree with the spend. The recorded status is the
  provider's item status, never a caller's claim. The position is posted once, in the same transaction
  (`payout.reconciled`, with the evidence and with `funds: credited | submitted | returned`).
* `{ kind: "not-sent", …evidence }` — the provider has no such payout; the doubt is cleared and a retry
  becomes legitimate (`payout.doubt_cleared`, recording the evidence and whether the rail can even be
  looked up by our reference). Without this, a rail that promises nothing is never retried.

A batch id typed by hand is refused when the provider does not know it, and a batch's own status is never
treated as the recipient's:

* **batch status is not item status** — PayPal reports a batch as `SUCCESS` while an individual item is
  still `PENDING`, `UNCLAIMED`, `FAILED` or `RETURNED`. A read with no item status is refused (409); the
  payment stays in doubt rather than being recorded as paid;
* **amount and receiver are checked** — an item for another amount or another payee is refused, so a batch
  found by hand cannot settle a different payment;
* **submitted is not credited** — only `SUCCESS` means the payee was paid. `PENDING`/`UNCLAIMED` is
  recorded as submitted, and the dead statuses lead to the normal refund path on the next `syncSpend`.

Proven by `tests/settlement-lease.test.ts` › "a rail that cannot promise a safe repeat is parked and
reconciled from the provider's item record, never re-sent", "a batch the provider knows, but has no item
status for, is not evidence that anyone was paid", "an item that pays a different amount is not this
payment, and is refused", and "clearing a doubt as not-sent needs evidence, and records who said so and why
a retry cannot duplicate".

### 10.2 The PayPal guarantee this adapter uses, stated precisely

PayPal offers more than one idempotency mechanism, and they are not interchangeable. This adapter relies
on exactly one of them for payouts:

| Mechanism | What PayPal documents | Used here? |
| --- | --- | --- |
| Payouts `sender_batch_id` | A batch id used in the last 30 days is rejected as a duplicate, with a link to the original batch; a request that failed with HTTP 5xx may be retried with the same id, and a payment completes only once per id in that window. | **Yes.** `payout-<spend id>` is the batch id, so our own reference is the provider's key. |
| Payouts `PayPal-Request-Id` | Accepted and stored, but the Payouts reference describes duplicates through `sender_batch_id`; the store window is published as 30 days. | Sent, but not what reconciliation relies on. |
| REST-wide `PayPal-Request-Id` | Stored for up to 45 days **where the specific API supports it**, returning the original result on a repeat. | Used for captures and refunds; not assumed for payouts. |

Three consequences are encoded in `IdempotencyContract` rather than left to prose:

* `sameReferenceIsSameOperation: true` and `memoryMs: 30 days` — within the window, our reference cannot
  pay twice;
* `duplicateIsAnError: true` — a repeat is answered with a **duplicate refusal** carrying a link to the
  original batch, not with the original result. So a duplicate is not an outcome: the gateway parks the
  payment as `IN_DOUBT` (`payout.duplicate_unresolved`) and reconciles it against the provider;
* `retryWhileInFlight: false` — PayPal publishes nothing about a repeat while the batch is being created,
  and there is no lookup by our reference. That is why an interrupted PayPal payout is never re-sent
  automatically, even though the 30-day window would make a *late* repeat safe. The conservative choice
  rests on the missing in-flight guarantee, not on an absent duplicate guarantee.

### 10.3 Batch status is not item status

A payout has two levels of fact and they answer different questions. The **batch** says whether PayPal accepted
and closed the batch. The **items** say what happened to each recipient. PayPal reports a batch as `SUCCESS`
while an item inside it is `UNCLAIMED`, `PENDING` or `FAILED`, so the batch status is diagnosis only.

`PayoutFacts` in `lib/rails/types.ts` therefore keeps them apart, and nothing fills an item field from the
request:

| Field | Meaning |
| --- | --- |
| `batchRef`, `batchStatus` | PayPal's batch and its own status |
| `senderBatchId` | PayPal's echo of the `sender_batch_id` we sent, or null |
| `items[]` | one entry per item PayPal reports: `itemRef` (PayPal's item id), `senderItemId` (PayPal's echo of our item reference), `status`, `amount`, `receiver`, `transactionId`, `error` |
| `itemCount` | how many items PayPal says the batch holds, or null |

A payout is attributed to a spend **only** when `payoutItemFor(facts, spendId)` finds exactly one item whose
provider-echoed `senderItemId` equals that spend id, and `itemCount` (when reported) matches the number of
items returned. No item, several matching items, or an incomplete page leaves the payment unresolved.

PayPal's item status is mapped deliberately in one place (`classifyPayoutItem`):

| `transaction_status` | Outcome | Gateway effect |
| --- | --- | --- |
| `SUCCESS` | `credited` | the only status that may produce `PAID` |
| `PENDING`, `PROCESSING`, `ONHOLD` | `submitted` | `PAYOUT_PENDING`; no refund |
| `UNCLAIMED` | `unclaimed` | `UNCLAIMED`; recallable by the owner |
| `RETURNED`, `REFUNDED`, `REVERSED` | `returned` | return posted, then refund |
| `FAILED`, `BLOCKED`, `DENIED` | `failed` | return posted, then refund |
| `CANCELED` | `cancelled` | return posted, then refund |
| anything else, or missing | `unknown` | parked: neither `PAID` nor refunded, with the raw status on the trail |

A batch accepted before its items are readable is recorded as `payoutStatus = SUBMITTED` with no item id. That
is a state of its own: it is never a promotion of the batch status, it never produces a receipt that claims
delivery, and the next read either finds the item or leaves the payment where it is.

Proven by `tests/payout-identity.test.ts` (batch `SUCCESS` with `PENDING`/`UNCLAIMED`/`FAILED`/missing item
status, batch `PENDING` with item `SUCCESS`, missing/wrong item id, receiver, amount and currency, another
payment's item, an ambiguous batch, an incomplete page, a read failure after submission, and a future status)
and by `tests/rails-contract.test.ts` (the provider's own item record, not the first item in a list).

## 11. One rail, one provider account (enforced, with a real identity)

Positions are keyed by rail and currency; the external account id lives on `rail_accounts`. That is only
sound if every position is attributable to exactly one account — otherwise two accounts at the same rail
would quietly share liquidity. This deployment does not support that, so it is **enforced, not assumed**.

**Where the identity comes from.** Only the provider. For PayPal it is `account_id` on the Reporting balance
response; for the mock rail, its own account id. `providerAccountIdentity()` in `lib/gateway/service.ts` reads
it once per rail and currency, caches a success (an account does not change under a running gateway), and
does not cache a failure. It is never derived from a display label, an environment-variable name, an
organization id, a payment reference or operator input.

**Where it is recorded.** `ensureRailAccount()` writes it onto `rail_accounts` once and attaches it to every
movement it can: captures (including pending and settled), payouts, returned payouts, refunds, and provider
fees read from the statement. `ensureRailAccount()` runs inside the same transaction as the movement.

**What is refused.**

* a second distinct `external_account_id` for one rail and currency (409, nothing sent; checked by
  `assertProviderAccountAttribution()`, which runs inside `requireProviderLiquidity()` before every payout);
* a position that has no account identity at all, once any position exists for that rail and currency: a
  payout is refused with 409 rather than paid from funds whose account cannot be shown;
* a change of identity on an existing account row: the id is write-once, so a row that names one account is
  never rewritten to another (409). Historical rows written before identities were recorded keep their null
  and stay distinguishable; a null is completed once from the provider, and the movements recorded before it
  keep their null (history is not rewritten).

Proven by `tests/provider-attribution.test.ts` (identity learned and recorded, idempotent registration,
immutable identity, unattributed positions fail closed, null completed once without rewriting history) and
`tests/accounting.test.ts` › "refuses to attribute liquidity to an ambiguous provider account".

## 12. Cross-rail funding is not atomic, and is not implemented

A transfer between two external providers is two legs at two institutions. It can fail between them: the
source debited, the destination not credited, or vice versa. This gateway does not execute such a
transfer, and does not model a two-sided intent with intermediate states. What it does guarantee:

* the same money is never counted as liquidity at two rails, because positions are per rail and a
  funding leg is only recognised at the destination it arrived at (`tests/accounting.test.ts` › "never
  counts the same money at two rails");
* a funding leg recorded at the source does not satisfy a destination transfer;
* a cross-rail move requires the destination leg to be *already settled* and an explicit operator
  authorization.

A real implementation needs a persisted funding intent (source debit pending → destination credit
pending → both settled, or reversed), reconciliation against both providers, and fees on each leg. Until
that exists, a deployment that needs it must fund the destination account out of band and record the
arrival — which is exactly what `postCapture`/`recordExternalMovement` are for.
