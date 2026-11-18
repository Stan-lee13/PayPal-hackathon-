# Provider decoupling: what changed, what remains, what happens next

This is the engineering record of the first milestone of the agentic-finance programme. It states what
was migrated, what deliberately was not, and the exact next step for everything still tied to PayPal.
Read `AGENTIC_FINANCE_ARCHITECTURE.md` for the target design.

---

## 1. What this milestone changed

**New: the rail boundary** (`lib/rails/`, 5 files).

- `types.ts` — capability- and guarantee-based contracts: `Capability` (16), `Guarantee` (5),
  `RailRef`, `Amount`, typed requests and facts, and one provider-neutral error vocabulary
  (`RailError` with `declined` / `in_doubt` / `duplicate` / `not_found` / `unsupported_capability`).
- `paypal-rail.ts` — the reference adapter. **The only module in the financial domain that imports
  `lib/paypal/*`.** Declares `authorization-hold` and `reversible-payout`; declares
  `funding.test-instrument` only in sandbox/simulated mode; does not claim safeguarding or card issuing.
- `mock-rail.ts` — deterministic, capability-aware adapter with injected failures, used by the contract
  tests. Never a production rail, never offered in the UI.
- `registry.ts` — `ENVELOPE_RAIL_PROVIDER`, `registerRail()` for a partner adapter, `setRailForTesting()`.
  An unknown rail id is a hard error, never a silent fallback.
- `index.ts` — `rail()`, `railMode()`: the entire surface the engine imports.

**Migrated behind the boundary** (no behaviour change intended; the same PayPal endpoints, the same
`PayPal-Request-Id` values, the same journal):

| File | Import before | Import now |
|---|---|---|
| `lib/gateway/service.ts` | 11 functions from `paypal/payments` + `getPayPal`, `PayPalApiError`, `paypalMode` | `rail()` only |
| `lib/gateway/bank.ts` | `payout`, `getPayout`, `refundCapture`, `PayPalApiError`, `paypalMode` | `rail()` only |
| `lib/gateway/books.ts` | `getBalance`, `listTransactions`, `listDisputes`, `provideEvidence` | `rail()` only |
| `lib/gateway/settlement.ts` | `verifyWebhookSignature`, `listEvents`, `cancelPayoutItem` | `rail()` (journal reads stay: see §3) |
| `lib/gateway/proof.ts` | `getAuthorization` | `rail()` only |
| `lib/gateway/auditor.ts` | `disputesFor` | `rail()` (Agent Toolkit stays: see §3) |

Every engine-side catch that used to test `e instanceof PayPalApiError` now tests `RailError` and its
neutral code. Every engine-side `paypalMode()` (display and receipt `mode` values) is now `railMode()`.

**New tests:** `tests/rails-contract.test.ts` — the same 12-case contract run twice, against the mock
rail and against the PayPal adapter on the built-in simulator, plus capability-negotiation, registry and
money-type suites. No database, no credentials.

**No database migration, no protocol change.** Signed v1 records, receipts, promise notes, standings and
references are byte-identical in shape.

---

## 2. What the capability model now says, per rail

| Capability | `paypal` (sandbox/live) | `paypal` (simulated) | `mock` |
|---|---|---|---|
| `funding.authorize-hold` | yes | yes | yes |
| `funding.approval-link` | yes | yes | yes |
| `funding.test-instrument` | **sandbox only** | yes | yes |
| `hold.read/capture/void` | yes | yes | yes |
| `payout.send/read/cancel` | yes | yes | yes (removable by profile) |
| `refund.capture` | yes | yes | yes |
| `reporting.balance/statement` | yes | yes | yes |
| `events.verify/list` | yes | yes | yes |
| `dispute.read/respond` | yes | yes | yes |
| Guarantee `authorization-hold` | yes (29-day auth) | yes | yes |
| Guarantee `reversible-payout` | yes (unclaimed item) | yes | yes |
| Guarantee `internal-reservation` | no | no | yes |
| Guarantee `safeguarded-funds` | **no** | **no** | **no** |
| Guarantee `card-issuing` | **no** | **no** | **no** |

A rail asked for a capability it does not declare throws `UnsupportedCapabilityError` before anything is
sent. `tests/rails-contract.test.ts` calls every method of a rail that claims nothing and requires that
error from each.

---

## 3. Every remaining direct provider dependency, and its next step

These are the only places outside `lib/rails/paypal-rail.ts` and `lib/paypal/**` that still name PayPal.
Each is deliberate for now; none is in the authority or budget path.

| Where | What it is | Next step |
|---|---|---|
| `lib/gateway/settlement.ts` (`callsFor`, `MOVES`, `OP_TEXT`) | Reads `paypal_calls` to render "what the provider did for this envelope" | **Done in Milestone 2.** `rail().trail.calls(keys)` returns neutral `RailCall[]`; the PayPal adapter renders its own journal into it and the engine no longer imports it. |
| `lib/gateway/settlement.ts` (`BATCH_NOT_COMPLETED`) | One provider-specific recovery hook: PayPal keeps a payout batch open briefly and refuses cancellation; the honest answer is "try again in a minute" | **Done in Milestone 2.** Neutral `not_ready` error code (retryable), mapped inside the PayPal adapter; the engine branches on the neutral code. |
| `lib/gateway/auditor.ts` (`lib/paypal/toolkit.ts`) | PayPal's Agent Toolkit, locked to five GET-only reads, as an audit path that does not pass through the gateway's own books | Keep: it is a *deliberately* provider-specific second source. Generalise as `rail.auditTools()` when a second rail exists, so an auditor reads whichever provider's own record applies. |
| `lib/api/handlers.ts` (`paypalMode`, `flushJournal`) | Health/config surface and journal flush at request end | **Done in Milestone 2.** `railMode()` and `rail().flush()`; no module below the adapter imports `lib/paypal/**` any more. |
| `lib/api/handlers.ts` `POST /api/paypal/webhook` (zod schema), `app/api/paypal/webhook/route.ts` | Provider-shaped ingress: parses `{id, event_type, resource}` | **Done in Milestone 2.** `rail.events.parse(body)` in the adapter, one generic `POST /api/rails/webhook` route, and the PayPal path kept as an alias for webhooks already registered there. |
| `app/sim/paypal/**`, `components/paypal-rail.tsx`, UI copy | The simulator's own checkout page and the "what PayPal did" panels | Correct as-is (they describe the PayPal rail). A second rail gets its own presentation driven by `rail().label`/`guarantees`. |
| `lib/db/schema.ts` (`paypal_calls`, `paypal_events`, `roots.paypal_order_id`, `spends.payout_*`, receipt `paypal` field) | Provider-shaped columns and signed v1 fields | Additive migration `0009` (§4). The signed field stays for v1 compatibility; a `rail` block is added in receipt v2. |
| Env names `PAYPAL_CLIENT_ID/SECRET/MODE/SANDBOX_TEST_CARD/WEBHOOK_ID` | Credentials and config | Neutral aliases exist for the webhook id (`ENVELOPE_WEBHOOK_ID`); add `ENVELOPE_RAIL_PROVIDER` (done) and, per adapter, a namespaced credential set. Old names keep working. |
| `scripts/sandbox-run.ts`, `approval-check.ts`, `statement-check.ts`, `events-check.ts`, `replay-delivery.ts`, `paypal-refund-capacity.ts`, `void-open-holds.ts`, `mcp.ts`, `agent.ts` | Operational/verification scripts for the PayPal rail and agent demos | Correct to stay PayPal-specific: they are how the reference adapter is proven against the sandbox. New rails get their own scripts, not a generic one. |

No financial decision, budget check, signature check, replay guard or lock was moved, weakened or
removed by this milestone. The engine's invariants are the ones the tests assert.

---

## 4. Database and protocol compatibility

**This milestone adds no migration.** The new code writes `RailRef.id` into the existing columns, so all
existing rows, receipts and signed objects keep their meaning. (Milestone 2 adds the additive `0009`, below.)

**Milestone 2 adds one additive migration, `0009`.** `roots`, `spends` and `transfers` gain
`rail_provider` (`text not null default 'paypal'`). Every row written from now on says which rail moved
it; existing rows read as PayPal because that is what they were. Nothing is dropped, renamed or
rewritten; no receipt or signed object changes, and the column is not part of any signature. The engine
writes it on insert (`rail().id`) and never reads it back to decide anything.

The next change is additive and should be made when a second real rail is being added:

```sql
-- 0009_rail_provenance.sql (planned, not applied)
alter table roots      add column rail_provider text not null default 'paypal';
alter table spends     add column rail_provider text not null default 'paypal';
alter table transfers  add column rail_provider text not null default 'paypal';
create index roots_rail on roots (rail_provider);
```

Rules for that migration:

1. **Default `'paypal'`, never null.** Every existing row was produced by the PayPal adapter.
2. **Read the column with a fallback** (`row.rail_provider ?? "paypal"`) for one release, so a rollback
   is safe.
3. **Never rewrite a signed object.** Receipts keep `paypal: {…}` for v1. A receipt v2 adds
   `rail: { provider, authorization, capture, payout }` alongside it, and verifiers accept both.
4. **Do not reuse a provider's id space across rails.** `RailRef` exists for exactly this reason; the
   provenance column is what stops an id from one rail being looked up in another.

Protocol compatibility checklist for any future change: `lib/envelope/core.ts` domain separators
unchanged; `verifyChain` still rejects widening; `paypal_events.id` still the provider event id;
`ledger (agent, kind, ref)` still unique; `spends.request_hash` still unique; receipts still signed over
the same body shape.

---

## 5. Security and financial blockers (unchanged by this milestone, still real)

Priority order, from the reports in `docs/` and the code:

1. **Principal keys in browser local storage** (`app/console`) → passkeys/WebAuthn, hardware-backed
   where available. This is the highest-value change for the wedge buyer.
2. **Gateway signing key sealed with an environment secret** (`lib/keystore.ts`) → KMS/HSM, key version
   in the receipt, rotation without breaking verification.
3. **No multi-tenant authentication or organization roles.** Every treasury and account page is public
   by key. Needs real sign-in, organization membership, and per-object authorization (the type of
   `scopeId`/`subjectId` already in `audit_log` is the seed).
4. **Shared auditor bearer token** (`AUDITOR_SECRET`) and shared demo agents/routes → per-tenant tokens,
   demo data isolated from real data.
5. **Webhook deployment verification**: a signed event is only as good as the endpoint id configured; a
   missing `ENVELOPE_WEBHOOK_ID`/`PAYPAL_WEBHOOK_ID` currently means "unconfigured, refuse" (correct),
   but registration and rotation are manual.
6. **Rate limiting trusts proxy headers.** Documented assumption; must move to a trusted-hop config.
7. **Provider fees and reserve requirements** are visible in the statement but not modelled in a reserve
   policy; `reserves()` compares, it does not enforce a buffer.
8. **Recovery from a real provider outage** is exercised against the simulator, not against PayPal's
   sandbox under injected failure. The contract tests cover the adapter's behaviour; a sandbox chaos run
   is still outstanding.
9. **Dependency advisories** recorded in `docs/EXTERNAL_REVIEW.md` remain open; upgrading majors must be
   done with the suite green, not to silence a warning.

A hash-chained audit log (`lib/services/audit.ts`) proves the integrity of what is presented; it does not
prevent truncation of the newest rows. Anchoring the chain head outside the database is required before
that claim can be made.

---

## 6. Sequence from here

**Milestone 2 — finish the boundary and make the mock authoritative for contracts.** *Done, except the live
sandbox run.* `rail().trail()`, `rail().flush()`, `rail.events.parse()`, the `not_ready` error code,
generic webhook ingress, `0009` rail provenance, capability guards in the engine (seal and recall refuse
with 501 rather than pretending), a fail-soft statement, and `tests/rails-chaos.test.ts` — ten engine
battle tests that drive the real gateway through a rail with injected interruptions, refusals and missing
capabilities. Outlook: no rail-specific code remains on the authority, budget, lock or receipt path.
**Still outstanding: verification of the PayPal adapter against a live sandbox** (no credentials here).

**Milestone 3 — sign-in and tenant isolation.**
Organization, membership, roles; per-object authorization on treasury, accounts, cards and proof pages;
passkey principals; KMS-backed gateway key. Nothing else should ship before this: the wedge buyer cannot
put a public treasury URL in front of their finance team.

**Milestone 4 — the second real rail and the provider-neutral SDK.**
A payout-capable processor behind the same contracts, with a published guarantee matrix; SDK v2
(`sdk/src/gateway.ts`) exposing identity, authority, budget, request, verify-counterparty, commitment,
status and receipt, with the v1 surface kept working. MCP stays read-mostly: proposal permissions and
execution permissions stay separate.

**Explicitly deferred.** Crypto rails; becoming a custodian; card issuing; multi-party approval beyond
one owner; policy inheritance across organizations; any claim of escrow or safeguarding. Each depends on
a partner, a licence or a customer commitment that does not exist yet, and pretending otherwise would
break the one thing this platform sells: that its guarantees are exactly what it says they are.

---

## 7. How this milestone is verified

- `npm run lint` — `tsc --noEmit` over the whole repository (app, lib, sdk, scripts, tests).
- `npx vitest run tests/rails-contract.test.ts` — the contract suite, twice (mock and PayPal/simulated).
- `npx vitest run tests/rails-chaos.test.ts` — the engine against a misbehaving rail: interrupted
  capture, interrupted payout, refused payout, missing capabilities, forged webhook, eight concurrent
  copies of one request.
- `npx vitest run` — the full suite, with `TEST_DATABASE_URL` set to a **test** database (never the
  development one). In this sandbox no Postgres server exists, so the suite was run against PGlite served
  over the Postgres wire protocol with `DB_POOL_MAX=1`; that harness serialises connections, so it
  exercises correctness but not true parallel connections. Any suite that needs real concurrency must be
  re-run against a real Postgres before release.
- `npm run build` — the production Next.js build.

### Measured, this run (17 November 2026)

| Check | Command | Result |
|---|---|---|
| Types | `npm run lint` | pass, 0 errors |
| Rail contract | `npx vitest run tests/rails-contract.test.ts` | 29/29 pass (12 cases × 2 adapters, plus capability negotiation, registry, money) |
| Engine battle tests | `npx vitest run tests/rails-chaos.test.ts` | 10/10 pass |
| Full suite | `TEST_DATABASE_URL=… npx vitest run` | 19 files, **486/486 pass** |
| Production build | `npm run build` | pass |
| SDK build | `npm run sdk:build` | pass |

Environment caveats, stated because they bound what was actually proven:

- No Postgres server exists in this sandbox and there was no root to install one, so the database-backed
  suites ran against **PGlite served over the Postgres wire protocol**, with `DB_POOL_MAX=1`. With the
  default pool the harness produced protocol-level resets under parallel connections (3 of 12
  `tests/gateway.test.ts` cases failed, with failures moving between runs and none of them reproducible
  on a serialised pool). **Correctness is exercised; true parallel connections are not.** Re-run against
  a real Postgres before release, especially the concurrency tests.
- The 12 November figure of 447 tests / 171 attacks is historical. Milestone 2 measured 486 tests, 39 of
  them new (29 contract + 10 engine battle tests).
- The battle tests inject faults at the rail: the engine's recovery paths (reserved → retry → paid once;
  captured → retry → paid once; refused payout → refund and capacity stays used) are exercised, not
  asserted from a description. What they cannot prove is behaviour under *real* network partition or a
  provider that answers inconsistently between two calls; that needs the live sandbox run.
- No PayPal credentials were used: the PayPal adapter ran against `lib/paypal/emulator.ts`. A live
  sandbox verification of the adapter through the new boundary (hold, partial capture, payout, webhook,
  refund) is outstanding and is the first item of Milestone 2's acceptance.
- `npm audit` was not run against a real registry in this sandbox; the advisories recorded in
  `docs/EXTERNAL_REVIEW.md` therefore remain open and unverified.
