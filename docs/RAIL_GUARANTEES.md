# Rail guarantee matrix

Every financial guarantee this repository claims, per shipped adapter, and what is **not** claimed.
Nothing here is marketing: if a row says "unverified", it has not been run against a real provider.

Two adapters ship (`lib/rails/registry.ts`):

| id | adapter | modes | real money? |
| --- | --- | --- | --- |
| `paypal` | `lib/rails/paypal-rail.ts` | `simulated`, `sandbox`, `live` | only in `live` |
| `mock` | `lib/rails/mock-rail.ts` | `mock` | never |

"Simulated" is the built-in PayPal emulator (`lib/paypal/`), used by most tests: no network, no money.
`sandbox` calls the real PayPal API with test credentials. `live` moves real money — **this milestone
did not run it.**

---

## The four things that are not interchangeable

| Notion | What it means here | Where it exists |
| --- | --- | --- |
| **Internal reservation** | A promise inside this gateway: `blocks.reserved_minor` / a `PROMISED` spend. Nothing exists at any provider. Cannot be paid out. | database only |
| **External authorization hold** | The provider has set money aside on the payer's instrument and will capture up to that amount. It is not the gateway's money and not a payout. | provider |
| **Internal ledger balance** | What the gateway *owes* an agent (`ledger`, `accounts.balance_minor`). Backed by provider money but not itself money at a provider. | database only |
| **Safeguarded funds / escrow** | Client money held in a segregated, legally protected account. **Not implemented, not claimed, by any adapter.** The `custody` column reserves the name `safeguarded-partner`; no code writes it. | nothing |

An authorization hold is not a reservation, a reservation is not a balance, and a balance is not
liquidity at another provider. The code keeps these apart; this table is the vocabulary.

---

## `paypal` — reference adapter

### Capabilities (declared in `paypal-rail.ts`)

`funding.authorize-hold`, `funding.approval-link`, `funding.test-instrument`, `hold.read`,
`hold.capture`, `hold.void`, `payout.send`, `payout.read`, `payout.cancel`, `refund.capture`,
`reporting.balance`, `reporting.statement`, `events.verify`, `events.list`, `dispute.read`,
`dispute.respond`, `observability.trail`.

### Unsupported / refused

* No cross-currency movement of any kind (501, `CURRENCY_CONVERSION_NOT_SUPPORTED`).
* No escrow, no safeguarded custody, no split payments, no subscriptions, no invoicing.
* No payout cancellation in `simulated` mode beyond what the emulator models; in any mode a payout that
  has already been claimed cannot be recalled.
* No statement export beyond PayPal's Transaction Search window.

### Semantics

| Concern | What is actually guaranteed |
| --- | --- |
| **Funding** | An authorization hold is requested for the envelope's total limit, with an idempotency reference derived from the envelope id. The hold is read back before an envelope is usable. `ROOT_NOT_FUNDED` is returned when the provider cannot confirm it. |
| **Settlement** | A capture is *requested*; its reported status is stored. `COMPLETED` means PayPal says the capture completed. It does not mean the money has been swept to the operator's bank account. |
| **Payout** | Payouts are sent with a per-payment idempotency key (`sender_item_id` = the spend id). `SUCCESS` is PayPal's word; `UNCLAIMED` means the payee has no account and the money is held by PayPal — **not delivered**. `PENDING` is not delivered. |
| **Refund** | A refund is sent against the capture. A refund that fails leaves the payment `REFUND_DUE` and the money in the balance, retryable. |
| **Reversal / recall** | `hold.void` releases an uncaptured hold. A payout can be cancelled only while PayPal allows it; after that, only the payee can return it. A returned payout posts `payout_return` before the refund, so the provider position never goes negative. |
| **Idempotency** | Every mutating call carries a reference derived from a domain id. Locally, `(agent, kind, ref)` on the ledger and `(rail, currency, bucket, kind, ref)` on positions make a repeat a no-op. One **renewable, fenced** settlement lease per spend (`spends.settling_at` + `settle_generation`) means concurrent duplicates do not each decide what to do with the money, and a worker whose lease lapsed cannot write the outcome. An interrupted call is marked `IN_DOUBT` and never refunded on the assumption it did not happen. |
| **Reconciliation** | `reporting.balance` and `reporting.statement` are second sources. Fees are read from the statement and recorded once per line. Statement lag up to 3 hours is tolerated; older gaps are errors. |
| **Webhooks** | Signature verified by PayPal itself through the adapter, using the exact bytes received and the endpoint id (`ENVELOPE_WEBHOOK_ID`, or `PAYPAL_WEBHOOK_ID`). An event is applied once; unknown or unverifiable events change nothing and are refused (401). Acknowledgement means "received and applied/a duplicate", never "settled". A failed apply deletes the event record so redelivery is processed. |
| **External dependencies** | PayPal REST API (orders, payments, payouts, transaction search, disputes, webhook verification), valid credentials, a registered webhook endpoint, TLS, and the operator's own bank withdrawal process. |
| **Unverified assumptions** | See below. |

### Unverified (no credentials in this milestone)

These are **not** verified by any test that exists in this repository:

1. That a live authorization hold is created for the full envelope limit on a real buyer account.
2. That partial capture followed by void leaves the hold in the state this code assumes.
3. That a live payout to an unclaimed address reports `UNCLAIMED` and can then be cancelled.
4. That PayPal's webhook signature headers verify against the exact raw body through the adapter.
5. That Transaction Search returns fees with the sign and fields `statement()` expects, and honours the
   `from`/`to` window the way the code assumes.
6. That a dispute's evidence payload is accepted and moves the dispute out of
   `WAITING_FOR_SELLER_RESPONSE`.
7. Refund timing and the states a refund passes through.
8. Rate limits and retry-after behaviour under real load.

`docs/MILESTONE_3_INDEPENDENT_AUDIT.md` §"Tests that still require real external execution" lists the
runs that would close these.

---

## `mock` — deterministic test rail

| Concern | What it guarantees |
| --- | --- |
| Capabilities | All of PayPal's, controllable per instance (`profile`), so an adapter contract can be proved and a missing capability can be tested. |
| Funding | Fabricated hold. No buyer, no instrument, no authorization. |
| Settlement | Instant, in-memory, deterministic. Statuses are simulated, not observed. |
| Payout | In-memory; `UNCLAIMED`, `RETURNED`, `FAILED` can be forced. |
| Refund / reversal | In-memory, with a `payout_return` recorded so the accounting path is exercised. |
| Idempotency | Per reference, in memory. It proves the *engine's* idempotency, not a provider's. |
| Reconciliation | Synthesises a statement from its own memory, optionally with fees (`mockRail({fees:true})`). |
| Webhooks | Verifies a fixed header and compares the body to what it issued. |
| Real money | None. |
| **Guarantees claimed** | `authorization-hold`, `reversible-payout`, `internal-reservation` — *only as descriptions of what the engine exercises*, never as production financial guarantees. |
| **Explicitly not claimed** | Delivery, settlement finality, custody, regulatory safeguarding, availability, or that any real provider behaves this way. A passing mock test proves the engine is consistent with the contract, nothing more. |

The mock is never selectable in production by accident: an unknown `ENVELOPE_RAIL_PROVIDER` throws, and
`railMode() === "mock"` is reported in receipts, health output and the books so a mock run cannot be
mistaken for a live one.

---

## Where the guarantees are enforced in code

| Guarantee | Enforced by |
| --- | --- |
| A balance cannot be paid out at a rail that never funded it | `requireProviderLiquidity` in `lib/accounting/positions.ts`, called before every payout |
| A cross-provider transfer needs a real funding leg | `assertInterRailTransfer` in `lib/accounting/inter-rail.ts` |
| A fee is never spendable | fee bucket, reported as a positive cost, `spendable = available − fees` |
| One tenant cannot spend another's funds in strict mode | `ENVELOPE_TREASURY_MODE=allocated` check in `requireProviderLiquidity`; the default `pooled` mode is an operator omnibus treasury and says so in every refusal |
| The same money is never counted at two rails | per-rail positions; a funding leg is only accepted at the destination it arrived at |
| Concurrent duplicates do not each decide | settlement claim (`spends.settling_at`), root lock, unique ledger/position keys |
| A returned payout cannot drive a position negative | `payout_return` before `refund` in `refundOrPark` |
| Reconciliation is not faked when the provider is unreachable | `available: false, ok: false` in `reconcilePositions` |
| A signed receipt is not proof of delivery | `verification.offline` vs `verification.external`, `settlement.meaning` |
| An unverifiable webhook changes nothing | `genuineEvent` → 401, raw bytes parsed once |
