# Milestone 3 — independent audit

Scope: the provider-abstraction work delivered in Milestones 1–2, audited against the source rather than
against the previous report. Every finding below was reproduced before it was fixed, and each fix names
the test that now holds it.

Method: `git status`, `git diff --stat`, `git diff --check`, every new file under `lib/rails/`, every
modified gateway service, the new migration, every new test, and every remaining import from
`lib/paypal/`. Then the nine financial paths were traced end to end, and the suite was run against a
**real PostgreSQL 18.6** server with `DB_POOL_MAX=8`, not only the serialized PGlite shim.

---

## 1. Severity summary

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | Concurrent duplicate settlement refunded a payout another arrival had already sent | **Critical** | Fixed |
| F2 | A balance carried no provider or currency provenance: an internally valid balance could be paid out through a rail that never funded it | **Critical** | Fixed |
| F3 | A payout sent and then cancelled/returned went negative at the provider (no `payout_return`) | High | Fixed |
| F4 | Provider receipts wrote any provider's identifiers into `paypal.*` fields | High | Fixed (v2) |
| F5 | Fees from the provider were invisible, and `statement()` added them instead of subtracting them | High | Fixed |
| F6 | The webhook authenticated the raw body but applied a separately parsed body | Medium | Fixed |
| F7 | 19 test files truncated without the new accounting tables: rows leaked between tests | Medium | Fixed |
| F8 | "Concurrency" was tested on one serialized connection, and the result was described as locking proof | Medium (verification integrity) | Fixed for PostgreSQL; CI run pending |
| F9 | Reconciliation could not identify most of the seven failure classes it now reports | Medium | Fixed |
| F10 | Nothing distinguished a valid signature from proof of delivery | Medium (misrepresentation risk) | Fixed in v2 receipts |
| L1–L7 | Architectural limitations (documented, not defects) | — | Documented §5 |

---

## 2. Verified defects, and how each was found

### F1 — concurrent duplicates could refund a delivered payout (critical)

**Symptom.** Eight concurrent identical signed payments: all eight returned `FAILED` with
`PAYPAL_PAYOUT_FAILED`, and the provider position showed a capture, a payout, a payout return and a
refund — net zero — for a payout that had demonstrably been sent.

**Cause.** Each arrival ran `settle()`. The first captured and paid out; the payout debited the provider
position, so a later arrival's liquidity check saw `available = 0` and took the "no funds at this rail"
branch, which refunds and parks the payment. The refund then reversed a payment whose money had already
left. The liquidity check was correct arithmetic applied to a duplicate that should never have made a
fresh decision.

**Fix.** One DB-backed settlement claim per payment (`spends.settling_at`, migration `0011`). The arrival
that takes the claim finishes the payment; the others wait for the outcome (bounded, then return the
current row). A claim older than 30 s is taken over, so a process that died mid-way does not strand the
money. `refundOrPark` also gained `onlyIfUnsent`, so a *local* decision can never undo a payout that was
already sent — that payout's fate belongs to the provider.

**Held by.** `tests/concurrency.postgres.test.ts` › "the same signed request eight times at once is one
payment, one capture and one payout" and "a payment interrupted at the provider finishes once when
several arrivals retry it together"; `tests/rails-chaos.test.ts` › "moves money once when the same signed
request arrives eight times at once" (previously failing, now passing).

### F2 — no provider or currency provenance (critical)

**Symptom.** The `$1,000 at Provider A, withdraw $200 at Provider B` scenario of the brief was
representable and would have been paid out.

**Cause.** A single unqualified `balanceMinor`, and a payout path that never asked where the money was.

**Fix.** `ledger.rail`/`ledger.currency` (additive, backfilled `paypal`/`USD`), `position_entries`,
`rail_accounts`, `reconciliation_runs`, and a refusal-first guard before every payout
(`requireProviderLiquidity`) that computes spendable as `available + fees` at the *destination* rail.

**Held by.** `tests/accounting.test.ts` › "an internal balance is not liquidity at another provider";
`tests/concurrency.postgres.test.ts`; `docs/MULTI_RAIL_ACCOUNTING.md`.

### F3 — a returned payout left the position negative (high)

**Symptom.** `paypal-rail` recall test asserted the provider net went negative after a payout was sent
and then cancelled.

**Cause.** `refundOrPark` posted a refund without posting the return of the payout that came back.

**Fix.** `postPayoutReturn` before the refund, always; the return is idempotent per `(rail, currency,
bucket, kind, ref)`.

**Held by.** `tests/paypal-rail.test.ts` (recall), `tests/rails-chaos.test.ts`, and the arithmetic check
in `reconcilePositions`.

### F4 — provider misattribution in receipts (high)

**Symptom.** A payment through any non-PayPal rail would have issued a v1 receipt with that rail's
capture id in `paypal.captureId` — a signed false statement about where the money went.

**Fix.** `envelope-receipt/2`: `provider {rail, label, mode, custody, externalAccountId,
movedExternally}`, `providerOps[{kind,id}]`, `settlement {state, meaning, providerStatus, asOf}`,
`verification {offline, external, note}`. Version strings are the signing domain, so v1 and v2 cannot be
confused; v1 receipts still verify. `receiptView`/`receiptAttribution` give one neutral shape to the app,
SDK and MCP server.

**Held by.** `tests/receipts.test.ts` (v2 neutrality, v1 compatibility, tampering, replay, settlement
change after issuance); `tests/sdk.test.ts`.

### F5 — fees invisible, and the statement's sign inverted (high)

**Symptom.** With `mockRail({fees:true})` a $10.00 capture carrying a $0.75 fee reported a provider net of
$10.75: `position.netMinor += amount - fee` with the provider's fee already negative.

**Fix.** `statement()` normalises fees to a positive cost (`abs`) and reports `feesMinor` as money taken;
`reconcilePositions()` records each fee once (keyed by statement line) in the `fee` bucket, reports it as
`unexpected_fee`, and spendable excludes it. `position_differs` now catches a booked fee that is not on
the statement, or vice versa.

**Held by.** `tests/accounting.test.ts` › "records the provider's fee in its own bucket, and never counts
it as spendable"; `tests/books.test.ts`.

### F6 — signed bytes vs applied bytes (medium)

**Symptom.** `genuineEvent()` verified `input.raw`, but `applyPayPalEvent()` was given the event parsed
from `input.body`. Through the Next route both come from the same request, so it was not exploitable
there — but the handler trusted a pair of inputs to agree, which is exactly the assumption a future
caller (a queue consumer, an internal RPC) would break.

**Fix.** `railEvent` parses `raw` when present and refuses a body that is not JSON; the parsed body is
never a second source.

**Held by.** `tests/webhook-lifecycle.test.ts` › "applies the bytes that were signed, not a second parse
of them".

### F7 — test isolation leak (medium)

19 test files truncated `spends, blocks, …` but not `position_entries, rail_accounts,
reconciliation_runs`. Accounting rows survived between tests, which would have hidden exactly the
duplicate-counting bugs this milestone is about. All truncation statements now include the new tables.

### F8 — serialized tests described as concurrency proof (verification integrity)

`DB_POOL_MAX=1` with one connection cannot show whether a row lock, a unique index or a claim actually
serialises. The suite now has `tests/concurrency.postgres.test.ts`, which:

* is gated on `REAL_DATABASE_URL`, and **fails** (does not skip) unless the server is a real Postgres,
  four simultaneous queries land on at least two backends, and `DB_POOL_MAX >= 2`;
* exercises the eight races the brief names, checking the final ledger, account balances, budget
  reservations and provider effects;
* skips loudly in the default run, so a PGlite result is never presented as a locking result.

`.github/workflows/postgres-acceptance.yml` runs it against a `postgres:16` service, plus a clean
installation, an upgrade from `0009`, the whole suite with a real pool, and a check that the concurrency
suite did not skip. **The workflow itself has not executed on GitHub in this milestone; the equivalent
steps were executed locally against PostgreSQL 18.6** (see §4).

### F9 — reconciliation could not find what it was for

`statement()` compared amounts but nothing recorded fees, reversals, duplicates or inconsistent
settlement, and `reconcilePositions()` did not exist. It does now, with the seven classes named in the
brief plus an arithmetic check and a persisted verdict. An unavailable statement is stored as
`available:false, ok:false`.

### F10 — a signature that looks like delivery

v1 receipts put `payoutStatus` next to `captureId` with no statement of what was proven. v2 separates
`verification.offline` (what the signature proves: authority and record-keeping) from
`verification.external` (the provider operations to ask), and says so in a sentence. No code path
reports a valid signature as proof of settlement; `receiptView().settlement.state` is the state *at issue
time*, and live state is read from the record.

---

## 3. The nine paths, traced

| Path | Where it runs | What can go wrong, and what stops it |
| --- | --- | --- |
| 1. Fund an envelope | `service.registerRoot` → `rail().holds.requestApproval` | Hold not confirmed → `ROOT_NOT_FUNDED`. A hold is not a balance and is never credited. |
| 2. Reserve an agent's budget | `service.spend` under `lockRoot` | Root lock + `blocks` update in one transaction; concurrent children cannot both pass an ancestor limit (concurrency test 1). |
| 3. Capture | `settle` → `rail().holds.capture` → `postCapture` in the same tx | Settlement claim; capture failure leaves `RESERVED`; refunded captures stay used. |
| 4. Payout | `settle` → `requireProviderLiquidity` → `rail().payouts.send` → `postPayout` → v2 receipt | Guard refuses before any call; refusal refunds/parks; a sent payout is never undone locally (F1). |
| 5. Settlement | `syncSpend`/`syncTransfer` read the provider by id | Status is the provider's word; `UNCLAIMED`/`PENDING` are not delivery. |
| 6. Refund | `refund`/`refundOrPark` → `rail().refunds.create` → `postRefund` | Refund failure → `REFUND_DUE`, money back in the balance, retryable. Failed payout posts its return first (F3). |
| 7. Recall an unclaimed payout | `settlement.recall` → `rail().payouts.cancel` | No capability → 501; provider refuses → 502 with nothing changed; `UNCLAIMED` cannot be cancelled. |
| 8. Provider events | `/api/rails/webhook` → `genuineEvent` → `applyPayPalEvent` | 401/400/503 before any change; once-only; delete-on-failure so redelivery works; payloads not stored (F6). |
| 9. Reconciliation | `reconcilePositions` → `statement` → `postFee`/findings → `reconciliation_runs` | Fees recorded once; seven finding classes; unavailable ≠ reconciled (F5, F9). |

---

## 4. What was actually run

Environment: PostgreSQL 18.6 (real server, `127.0.0.1:5433`), `DB_POOL_MAX=8`, migrations applied from
scratch by `tests/global-setup.ts`.

| Run | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| Full suite, real Postgres, 8 connections | **504 passed, 9 skipped, 0 failed** (22 files passed, 1 file skipped) |
| `tests/concurrency.postgres.test.ts` with `REAL_DATABASE_URL` | **8 passed** (all eight races) |
| Full suite with `REAL_DATABASE_URL` set (3.1, nothing skipped) | **519 passed, 0 skipped, 0 failed** (24 files) |
| `tests/settlement-lease.test.ts` (3.1) | **4 passed** — slow call, crash-after-acceptance, in-doubt, fencing |
| `tests/accounting.test.ts` (3.1) | **9 passed** — fee arithmetic, fee reversal, treasury policy, same money at two rails |
| `node scripts/migration-upgrade-check.mjs` | **13/13 ok** — counts, captured amount and balance unchanged; `0010`/`0011` additive; legacy ledger backfilled `paypal`/`USD` |
| Default run without `TEST_DATABASE_URL` (`npm test`) | 163 passed, 153 skipped, 0 failed — the skipped ones are the database suites, which skip loudly rather than passing |

The one skipped file in the full run is the concurrency suite, which declines to run without
`REAL_DATABASE_URL` and says so in its name; it was then executed separately with the flag set. The CI
workflow is authored but has not run on GitHub in this milestone.

---

## 5. Architectural limitations (not defects, not fixed here)

* **L1 — liquidity is per provider account, not per organization.** The guard aggregates across owners
  because that is where the money actually is. Per-organization slices are reporting/reconciliation only.
  A per-organization liquidity guarantee would need real sub-accounts at the provider.
* **L2 — no custody separation.** `custody` distinguishes provider from gateway-ledger and reserves
  `safeguarded-partner`, but no safeguarded or escrow account exists and no adapter claims one.
* **L3 — no FX, stablecoin or bridge.** Refused (501), never approximated.
* **L4 — positions are single-entry**, with a kind and a unique key standing in for double entry; the
  arithmetic check is the compensation.
* **L5 — a paused process can still lose a live lease.** Since 3.1 the lease is renewed by a heartbeat and
  fenced by `settle_generation`, so a slow provider call no longer hands the payment over (see §8). The
  remaining window is a process paused (GC, SIGSTOP, throttling) past the lease: the fence stops it from
  writing anything, and its provider call carried the same idempotency reference as the takeover's, so the
  external effect stays single — but the local decision it *would* have made is lost, and recovery depends
  on the provider's record.
* **L6 — reconciliation covers a window** (72 h, 300 spends / 200 transfers), not all history.
* **L7 — one currency in practice.** USD only; no second currency has a funding source to test against.

## 6. Future enhancements (deliberately not built)

Per-organization provider sub-accounts; fee recovery (passthrough/reserve); a double-entry journal with
contra-accounts; an FX/conversion module with a licensed partner and an explicit rate; automated funding
legs between rails; statement pagination and long-horizon reconciliation; chargeback reserves; a
safeguarded custody adapter.

## 7. Milestone 3.1 — review follow-up

The independent review of Milestone 3 raised five gates. Each is now either implemented and tested, or
documented as an explicit limitation with the reason.

| # | Review point | Finding | Status |
| --- | --- | --- | --- |
| F11 | Fee arithmetic could overstate liquidity | Two types reported `feesMinor` with opposite signs (`Position` negative, `statement()` positive). One convention now: a **positive cost** everywhere, `netAtProvider = available + pending − fees`, `spendable = available − fees`. | Fixed + proved |
| F12 | The 30 s lease was a stopwatch, not a lock | A provider call longer than the lease could be taken over mid-flight. Replaced with a **renewable lease + fencing token** (`spends.settle_generation`, migration `0012`); every money-deciding write is fenced. | Fixed + proved |
| F13 | `onlyIfUnsent` meant "the database has no batch id" | An interrupted payout was not marked, so it looked unsent. Now a retryable rail error sets `payoutStatus = IN_DOUBT`, issues no refund and no receipt, and the retry reuses the same idempotency reference. | Fixed + proved |
| F14 | Provider liquidity ≠ tenant liquidity | Made explicit: `ENVELOPE_TREASURY_MODE` (`pooled` default, `allocated` strict), reported by `treasuryMode()`/`treasuryMeaning()` and quoted in every refusal. `allocated` fails closed. | Implemented + documented |
| F15 | Cross-rail movement needs a two-sided record | Not implemented, and kept disabled. What is guaranteed is that the same money is never recognised at two rails; the missing intent/state machine is documented in `docs/MULTI_RAIL_ACCOUNTING.md` §12 and listed as a blocker. | Documented |
| F16 | Fencing stops the database write, not the HTTP request | Each adapter now declares its idempotency contract (`Rail.idempotency`); automatic retry after a doubt requires `sameReferenceIsSameOperation` **and** `retryWhileInFlight`. PayPal declares only the first, so its interrupted payouts are parked, not re-sent. `resolvePayoutDoubt()` records the evidence either way. | Fixed + proved |
| F17 | Positions are not attributable to an external account | One provider account per rail and currency is now enforced at runtime: `assertProviderAccountAttribution()` refuses (409, nothing sent) when a second distinct account is recorded, and runs inside the liquidity guard. The supported topology is documented rather than implied. | Fixed + proved |
| F18 | Pooled treasury could be entered by default in production | `assertTreasuryPolicy()` runs before any payout: with `NODE_ENV=production` and no explicit `ENVELOPE_TREASURY_MODE`, it refuses (503) and names both models. Pooled is a decision an operator writes down. | Fixed + proved |
| F19 | A batch id supplied by an operator was treated as provider confirmation | `resolvePayoutDoubt()` now asks the rail and records only the provider's own answer: a batch the rail does not know is refused (409), the recorded status is the **item** status (a batch `SUCCESS` with no item status is refused), and the item's amount/currency/receiver must match the spend or it is refused. `PayoutFacts` carries the item amount so the match is possible. | Fixed + proved |
| F20 | `not-sent` reconciliation was not auditable | `by`, `source`, `checkedAt` and `rationale` are now required, validated (ISO time, not in the future) and written to the trail together with `retrySafe` and `lookupByReference`. `sent` reconciliation carries the same evidence plus `funds: credited/submitted/returned`. | Fixed + proved |
| F21 | The PayPal idempotency promise was described too loosely | The adapter states exactly which mechanism it relies on: `sender_batch_id` (30-day duplicate rejection, 5xx may be retried), `memoryMs: 30 days`, `duplicateIsAnError: true` — a repeat is a refusal, not the original result — and `retryWhileInFlight: false`. The REST-wide `PayPal-Request-Id` (up to 45 days where supported) is documented as a different mechanism and is not assumed for payouts. | Fixed + documented |

### 7.1 The fee proof (F11)

`tests/accounting.test.ts` now proves the four numbers **separately**, using the provider's own statement
as the independent source:

| Case | Assertion |
| --- | --- |
| Capture fee | `available = gross`, `fees = fee`, `netAtProvider = gross − fee`, `spendable = gross − fee`; a payout of `gross` and of `gross − fee + 1` are refused, `gross − fee` passes |
| Payout fee | `available = captured − paid out`; `fees = statement fees`; `spendable = available − fees`; the gross amount is refused |
| Fee reversal / correction | a positive `fee` movement (keyed by its statement reference) raises `netAtProvider` and `spendable`, leaves `available` untouched, and applies once |
| Duplicate statement line | a second `postFee` for the same line records nothing (`fees.recordedMinor = 0`) |
| Reconciliation | `statement().position.netMinor === positions.netAtProvider` for the listed lines |

Acceptance condition from the review — *"a provider with $98 actually available cannot pass a $99 payout
liquidity check merely because a $2 fee was also recorded"* — is the first row, and is a failing check if
the sign convention ever flips again.

### 7.2 The lease proof (F12, F13)

`tests/settlement-lease.test.ts` simulates the three sequences the review named, against the real
gateway, locks and ledger:

1. **A provider call longer than the lease** — the payout call is held open for 6.5 s against a 5 s lease;
a second arrival tries to take over and cannot; exactly one payout, generation still 1, both callers see
`PAID`.
2. **Crash after provider acceptance** — the rail creates the payout and then throws `in_doubt`; the
payment is parked, not refunded; the retry returns the *same* payout and records it; one payout, one
capture, one booking.
3. **Ambiguous interruption** — `IN_DOUBT`, no refund, no receipt; retry pays once.
4. **Lapsed worker writing** — the lease is expired mid-call and another arrival finishes the payment;
the first worker's fenced write is refused, the payout stays single, the budget is booked once.

### 7.3 What a reviewer should still not assume

* `allocated` mode is untested against a real per-organization provider topology; it fails closed, but no
partner bank exists here.
* Fencing closes the *local* write, not the external call. The idempotency reference is what keeps a
resumed worker from double-paying, and that depends on the provider honouring it (see
`docs/RAIL_GUARANTEES.md`).
* Cross-rail funding remains unimplemented by design.
* The idempotency contract is a declaration by the adapter, not a verified provider guarantee: PayPal's
  `sender_batch_id` retention window is not documented by PayPal and is not tested here against the
  sandbox. Until it is, PayPal payouts that end in doubt require `resolvePayoutDoubt()`.
* `assertProviderAccountAttribution` makes multi-account support fail closed; it does not implement it.

## 8. Tests that still require real external execution

1. Live PayPal: authorization hold for a full envelope, partial capture + void, payout, unclaimed payout
   and cancellation, refund, dispute evidence submission, webhook signature verification against the
   real endpoint, Transaction Search fees and lag.
2. The GitHub Actions workflow, on a GitHub runner (the local equivalent was executed; the YAML was not).
3. The SDK published to a registry and consumed by a third party.
4. Two-currency funding and a real inter-provider funding leg.
