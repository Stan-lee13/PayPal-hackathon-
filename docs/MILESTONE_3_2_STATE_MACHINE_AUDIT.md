# Milestone 3.2 — financial state-machine audit

This is an independent review of the money paths in this repository, written after the Milestone 3.2 changes.
It separates three things that are easy to confuse:

* **implemented** — what the code does, established by reading it;
* **locally verified** — what was run here, with the versions named;
* **GitHub-verified** — what the CI workflow actually reported for the exact commit.

Nothing in this document is a claim about live-provider behaviour. The PayPal adapter has never been run
against a live account from this workspace, and no test here proves that it would work there.

---

## 1. How to read the table

Every row is one state transition. The columns are:

| Column | Meaning |
| --- | --- |
| **from → to** | The persisted state change on `spends` (payments) or `transfers` (balance movements). |
| **precondition** | What must already be true in the database, checked inside the transaction. |
| **provider op** | The external call, if any. "None" means the transition is purely internal. |
| **reference** | The immutable idempotency reference sent to the provider. It is derived from the domain id and never regenerated. |
| **fence** | Whether the write proves it still owns the settlement generation (`spends.settle_generation`). |
| **accounting** | The position entry written in the same transaction. |
| **receipt / audit** | What the payer can verify, and what the trail records. |
| **retry** | What happens when the same request arrives again. |
| **ambiguous** | What happens when the provider's answer is unknown. |

One invariant governs every row: **a provider's batch status is never evidence about a recipient.** Only an
item that carries this payment's own `sender_item_id`, matched on amount and currency, and confirmed by the
provider's receiver, may move a payment to `PAID`.

---

## 2. The transition table

### 2.1 Envelope lifecycle

| from → to | precondition | provider op | reference | fence | accounting | receipt / audit | retry | ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (none) → `roots.ACTIVE` | chain verifies, limit ≤ ceiling, currency USD, notAfter ≤ 28d, no different block with the same id | hold placed (`orders` + `authorize`) or approved order authorized | `seal-<rootId>` (and `-c<i>` per sandbox card) | n/a | none (a hold is not money moved) | `envelope.sealed`, `hold.placed`; no receipt | same order reference returns the same hold | hold status/amount mismatched → hold voided, nothing recorded |
| `ACTIVE` → `CLOSED` | no `RESERVED`/`CAPTURED` payment on the root | void the remaining hold | `close-<rootId>` | n/a | none | `envelope.closed`, `hold.released` / `hold.release_failed` | a repeat void is answered by PayPal as the same request; a fully captured hold is reported as INFO, not FAILED | void failure keeps the reason on the trail; `releasedMinor` is computed from the local books |
| `ACTIVE` → `ACTIVE` (revoked sub-block) | signer is the principal, an ancestor holder, or the holder | none | — | root lock | none | `envelope.revoked`, promises on the path lapsed | idempotent (`revokedAt is null`) | n/a |
| hold gone at provider (`checkHold`) | root `ACTIVE`, authorization id present | `GET authorization` | — | root lock | none | `hold.gone`, then the close rows above | read is safe to repeat | unreadable hold is **not** treated as gone |

### 2.2 Payments (`spends`)

| from → to | precondition | provider op | reference | fence | accounting | receipt / audit | retry | ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (none) → `DENIED` | signature verified, chain anchored, a rule refused | none | — | root lock | none | `spend.denied` + reason codes | same request hash returns the same row, `duplicate: true` | n/a |
| (none) → `RESERVED` | every envelope on the path has room | none | — | root lock | none (reservation is `blocks.reservedMinor`) | `spend.requested` | same request returns the reservation and continues | n/a |
| (none) → `PROMISED` | as above, `ttl` valid | none | — | root lock | none | `promise.made`; note signed by the gateway | duplicate returns the existing note | n/a |
| `PROMISED` → `LAPSED` | `promiseExpiresAt < now`, or an ancestor revoked | none | — | root lock | reservation released | `promise.lapsed` | idempotent on status | n/a |
| `RESERVED` → `FAILED` (pre-capture) | root closed or a block revoked | none | — | root lock | reservation released | `spend.stopped` | idempotent | n/a |
| `RESERVED` → `CAPTURED` | hold `CREATED`/`PARTIALLY_CAPTURED` | capture part of the hold | `capture-<spendId>` | `lease.assert()` **before** the call; the write is fenced | `postCapture` (+ `ensureRailAccount` with the provider's account id) | `hold.captured`; no receipt yet | another arrival gets the same capture id; only the row that records it counts the money | capture `PENDING` → `payoutStatus = AWAITING_CAPTURE`, no payout |
| `CAPTURED` (awaiting capture) → `PAYOUT_PENDING` | provider reports the capture `COMPLETED` | `GET capture` | — | fenced by status predicate | `postCaptureSettled` (pending out, available in) | `hold.capture_completed` implied by the status write | safe to repeat | still `PENDING` → unchanged; `DECLINED` → `FAILED` + pending arrival removed |
| `CAPTURED` (awaiting capture) → `FAILED` | provider reports a non-completed, non-pending capture | `GET capture` | — | root lock | pending capture reversed | `hold.capture_not_completed` | safe | unreadable capture → unchanged |
| `RESERVED`/`CAPTURED` → `PAID` (held account) | payee is an agent account in `hold` mode | none (capture already done) | — | root lock + account lock | `ledger` income row (unique per `(agent, income, ref)`) | v2 receipt `settlement.state = credited`; `balance.credited` | the ledger unique index refuses a second credit | n/a |
| `RESERVED`/`CAPTURED` → `PAID` | liquidity at the funding rail covers it; the account's identity is established | payout batch | `payout-<spendId>` | `lease.assert()` before the call; the write is fenced | `postPayout` (negative, available) | v2 receipt `delivered`, `providerOps` names batch + item; `payout.sent` | same reference returns the same batch; a duplicate **refusal** parks the payment as `IN_DOUBT`, it does not refund | `IN_DOUBT`, no refund, no receipt |
| `→ PAYOUT_PENDING` (submitted) | the batch was accepted but no attributable item was returned | (same call) | `payout-<spendId>` | fenced | `postPayout` | `payout.sent` + `payout.item_unresolved`; receipt `payout_pending`, no `payout_item` op | a later read either finds the item or leaves the state | the provider's batch status is **not** used as the item status |
| `PAYOUT_PENDING` → `UNCLAIMED` | item status `UNCLAIMED` | `GET payout` | — | status predicate | none | `payoutState` → `UNCLAIMED`; receipt rebuilt only on settlement | safe | unreadable or unattributable read → unchanged |
| `PAYOUT_PENDING`/`UNCLAIMED` → `PAID` | item status `SUCCESS` | `GET payout` | — | status predicate | none | spend status `PAID` | safe | unknown status → `payout.status_unrecognized`, unchanged |
| `UNCLAIMED` → `FAILED` (recall) | owner's read signature; item is `UNCLAIMED` | cancel payout item | (item id) | root lock after the call | `postPayoutReturn`, then `postRefund` | `payout.recalled`; reason `RECALLED_BY_OWNER` | a repeat cancel is refused by the provider; the current word decides | `not_ready` → 409, nothing changed |
| `*` → `FAILED` (dead item) | item status `FAILED`/`RETURNED`/`REVERSED`/`BLOCKED`/`DENIED`/`CANCELED` | none | — | root lock (+ lease when the decision was made under one) | `postPayoutReturn` + `postRefund` | `payout.failed`; reason names the provider status | a duplicate refund (`CAPTURE_FULLY_REFUNDED`) is recorded as already refunded | refund refused → `REFUND_DUE`, the amount stays in `spentMinor` |
| `REFUND_DUE` → `FAILED` | a later refund succeeds | refund capture | `refund-<spendId>` | none (a later reconciliation, not a settlement worker) | `postRefund` | reason updated by the refund path | same reference is the same refund | still refused → stays `REFUND_DUE` |
| `PAID` → `FAILED` (payee refund) | payee signed the refund; payment was `PAID` and held | refund capture | `refund-<spendId>` | root lock | root `capturedMinor` down, `refundedMinor` up | `payment.refunded_by_payee` | exactly once (`status = PAID` predicate) | the provider's answer is recorded by the payee path in `bank.ts` |

### 2.3 Balance movements (`transfers`)

| from → to | precondition | provider op | reference | fence | accounting | receipt / audit | retry | ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (none) → `BOOKED` | sufficient balance, owner's caps, card rules, not frozen | none (internal) | — | account lock | two ledger rows (debit + credit) | transfer receipt | unique per `(agent, kind, ref)` | n/a |
| (none) → `SENDING` | as above, payee is an external address | payout after debit | `payout-<transferId>` | account lock for the debit; no settlement lease (a balance movement is not a payment) | `postPayout` once the batch is recorded | `balance.withdrawn` / `transfer.paid_out` | duplicate refusal leaves the row `SENDING` and reverses nothing | stays `SENDING`, exactly like a payment's `IN_DOUBT` |
| `SENDING` → `PAYOUT_PENDING`/`UNCLAIMED`/`PAID` | batch accepted | (same call) | — | none (the debit is already made) | `postPayout` | transfer receipt | idempotent on the batch write | un-attributable item → `SUBMITTED`, no batch fallback |
| `PAYOUT_PENDING`/`UNCLAIMED` → `PAID` | item `SUCCESS` | `GET payout` | — | status predicate | none | status only | safe | unknown → unchanged |
| `*` → `FAILED` (dead item) | item came back | none | — | account lock | `postPayoutReturn` + `ledger` reversal (unique) | `reverse` trail | a repeat reversal is refused by the ledger unique index | refund/return refused → stays, the amount is not credited twice |

### 2.4 Doubt reconciliation

| from → to | precondition | provider op | reference | fence | accounting | receipt / audit | retry | ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `IN_DOUBT` → recorded batch + item status | lease claimed; evidence complete; batch exists at the provider; exactly one item carries this spend's sender item id; item id, amount, currency, receiver and a recognised status all present | `GET payout` (batch) | — | the update carries `settle_generation = generation`; a lost generation writes nothing | `postPayout` inside the same transaction | `payout.reconciled` with `by`/`source`/`checkedAt`/`rationale`, batch + item ids, and `funds: credited/unclaimed/returned/submitted` | a second call returns the already-recorded state and writes no second event | unreadable provider → the error propagates; nothing is written |
| `IN_DOUBT` → no payout recorded | same evidence rules | none | — | generation predicate | none | `payout.doubt_cleared` **only when the row updated** | a stale worker writes no success event | a failed conditional update returns the current state, no trail |

---

## 3. The paths this audit was looking for

| Failure mode | Where it could happen | What the code does now |
| --- | --- | --- |
| Provider moved money, database did not | capture or payout accepted, answer lost | The capture/payout stays `CAPTURED`/`IN_DOUBT`; the immutable reference makes a retry the same operation at the provider; reconciliation reads the provider's item. No refund is issued on a guess. |
| Database records money the provider did not move | requested amount or receiver written as if confirmed | Removed. `PayoutFacts` carries only provider-reported values; a failed read yields a batch and **no items**, and the spend records `SUBMITTED`. |
| Refund coexists with a successful payout | refund branch after a duplicate refusal | A duplicate refusal parks the payment as `IN_DOUBT`; it never refunds. A definite refusal refunds, and the refund is fenced. |
| The same provider movement posted twice | repeated webhook, sweep, retry | Position entries are unique per `(rail, currency, bucket, kind, ref)`; the write is `onConflictDoNothing`. |
| False success audit | reconciliation lost its generation | The transaction returns an explicit boolean; the trail write is outside it and runs only when the row updated. |
| Delivered without an item-level success | batch status `SUCCESS` | `classifyPayoutItem()` is the only mapping; only `credited` produces `PAID`; `unknown` produces neither `PAID` nor a refund. |
| Position credited/debited against the wrong account | nullable account identity | The identity comes from the provider's balance response, is written once, is attached to every movement, and a payout is refused if any position for that rail/currency lacks it. |

Residual risks that are **not** fixed here, stated plainly:

1. **A provider can answer a repeat with a refusal that carries no result** (PayPal's `DUPLICATE_REQUEST_ID`).
   The gateway parks the payment and requires reconciliation. That is safe, but it means an operator action is
   on the critical path for an interrupted payout — by design, because the alternative is guessing.
2. **Money leaving on submission, not on credit.** A payout that the provider later returns is modelled as
   `payout` (−amount) then `payout_return` (+amount). If the provider debits only on success, the intermediate
   position is pessimistic (it understates the balance), never optimistic.
3. **The mock rail's `lookupByReference`** is a simulator property; PayPal declares `false`, and nothing in the
   gateway depends on it.
4. **Live PayPal behaviour is untested.** Hold expiry, partial capture tolerances, unclaimed windows and
   dispute timelines are taken from PayPal's documentation and the sandbox observations recorded in
   `docs/RAIL_GUARANTEES.md`; they are not verified from this workspace.

---

## 4. Release evidence

| Check | Where it ran | Result |
| --- | --- | --- |
| Typecheck (`tsc --noEmit`) | this workspace, Node 26.13.0 | 0 errors |
| Full suite | PostgreSQL 18.6, `DB_POOL_MAX=8`, `REQUIRE_TEST_DB=1` | see the final report; 27 files, 549 tests |
| Concurrency suite | PostgreSQL 18.6, real pool | 8 tests, real multi-connection |
| Migration clean install | PostgreSQL 18.6 | all migrations 0000–0012 applied |
| Migration upgrade (from 0009) | PostgreSQL 18.6 | historical rows backfilled, records survive |
| Next.js production build | this workspace | succeeded |
| SDK build | this workspace | succeeded |
| GitHub Actions matrix (PG 16, PG 18) | GitHub | recorded in the final report; only a green run on the exact final commit counts |

Supported PostgreSQL versions are **16 and 18**, both exercised by the workflow matrix. The earlier
inconsistency (a local 18.6 run reported as if it also covered the CI's 16) is why the matrix exists.
