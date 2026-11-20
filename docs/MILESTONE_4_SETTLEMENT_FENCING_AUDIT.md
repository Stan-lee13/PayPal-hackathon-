# Milestone 4.1 — settlement fencing audit

This is the Stage Zero 1.2 audit: which paths decide money, which of them hold the settlement lease
(`spends.settling_at` + `spends.settle_generation`), and which deliberately do not and why. It was written
against the code in `lib/gateway/service.ts`, `lib/gateway/settlement.ts`, `lib/gateway/bank.ts` and
`lib/gateway/books.ts` after the payout-item validation was unified.

The rule: a path that makes an **external** decision (sends a payout, cancels one, refunds one) claims the lease
first, proves ownership immediately before the call, and fences every decisive write with the generation it
holds. An arrival that lost the lease writes nothing and adds no success line.

## 1. Call sites

| Call site | Provider call? | Lease | Fencing | Notes |
| --- | --- | --- | --- | --- |
| `settle()` → `settleOnce()` | capture, payout | **yes** (`claimSettlement` + renewing heartbeat) | every decisive update carries `settle_generation`; `LeaseLost` aborts | The only path that captures. A lost lease returns the row the new owner produces. |
| `refundOrPark()` | refund | **yes when called under a lease** (`opts.lease`) | `lease.assert()` before the refund; the status update carries the generation | Called from `settleOnce` (payout refused / no liquidity), `undoDeadPayout`, `syncSpend` (REFUND_DUE). All three now pass a lease. |
| `undoDeadPayout()` | refund (through `refundOrPark`) | **yes** (from `syncSpend`, via `withSettlementLease`) | the audit line is written only when the record actually changed | A payout the provider returned is a compensating decision, not a read. |
| `syncSpend()` — returned/failed item | refund | **yes** (`withSettlementLease`) | refund is fenced; the plain status update is gated by `status in (PAYOUT_PENDING, UNCLAIMED)` | A wrong amount/currency/receiver, an incomplete batch or an unknown status changes nothing (payout-item validator). |
| `syncSpend()` — `REFUND_DUE` retry | refund | **yes** (`withSettlementLease`) | same | A refused refund is retried by exactly one arrival. |
| `resolvePayoutDoubt()` | read only | **yes** | the recording update requires `settle_generation = generation`; the success event is outside the transaction and only when the row updated | A stale reconciliation writes no success line and books no second payout. |
| `recall()` | payout cancel + refund | **yes** around the cancel | `lease.assert()` before the cancel and again before the `payout.recalled` line; the refund runs under its own lease | Two recalls cannot both cancel and both claim success. |
| `checkHold()` / `closeRoot()` | void | no settlement lease | `pg_advisory_xact_lock` on the root; the void is idempotent at the provider (`close-<rootId>`) | Closing is an envelope decision, not a payment decision. The root lock serialises it with admission. |
| `revoke()` | none | no | root lock | Purely local. |
| `transfer()` (bank) | payout | **no** | account advisory lock + the ledger's unique `(agent, kind, ref)` | A balance movement is not a payment: the debit is internal and idempotent. A duplicate payout refusal leaves the row `SENDING` and reverses nothing. |
| `charge()` (card) | payout | **no** | account lock; card counters in the same transaction | Same reasoning; the card's own counters fence a repeat. |
| `sweepUnfinished()` | reads | no (calls `syncSpend`, which leases) | — | Deliberately a fan-out over the paths above. |
| `reconcile()` (statement) | reads | no | never writes a financial fact | Records a reconciliation run only. |
| `applyPayPalEvent()` | reads | no (it calls `syncSpend`) | the event row is inserted once by provider event id | An event is a hint that reaches a leased path. |

## 2. Races closed

1. **Two arrivals see a returned payout.** Before: each called `refundOrPark` independently; the provider's
   idempotency reference (`refund-<spendId>`) prevented a double refund at the provider, but both could write
   `payout_return`, and both could write a `payout.failed` line. Now the second arrival fails to claim and
   reports the state the first produced.
2. **Sync and recall overlap.** Recall cancels the item while a sync decides it failed. Both now take the
   lease; the refund that follows is made under the lease of whichever arrives next, and the audit line for the
   recall is written only while the recalling arrival still owns the generation.
3. **A stale reconciliation after an operator decision.** `resolvePayoutDoubt` already required the
   generation; the success event is written outside the transaction only when the conditional update returned a
   row. Unchanged, and now covered by a test.
4. **`REFUND_DUE` retried by the sweep and by an open page at the same time.** Both now claim the lease.

## 3. Deliberate non-uses, stated plainly

* **Balance transfers and card charges** are internal debits with a provider payout as a consequence. The
  internal debit is serialised by the account lock and made exactly once by the ledger's unique index. A
  settlement lease keyed on `spends` does not apply to a `transfers` row, and inventing one would suggest a
  guarantee this path does not need. The payout reference is stable (`payout-<transferId>`), so a repeat is the
  same operation at the provider.
* **Closing an envelope** holds the root lock, not the settlement lease: it refuses to close while a payment is
  `RESERVED`/`CAPTURED`, so it cannot race a capture decision.
* **Statement reconciliation** only reads and records its own run.
* **Webhook ingress** never writes financial state; it resolves a record and calls the leased path.

## 4. What is not held across a provider call

No database transaction spans a provider HTTP call. The lease is a database row, not a transaction: the external
call happens between short transactions, and the decisive write afterwards re-checks the generation. A process
that dies mid-call leaves an `IN_DOUBT`/`SUBMITTED` state, which is recovered by the same idempotency reference
— never by guessing or by refunding.
