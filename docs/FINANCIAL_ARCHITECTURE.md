# Financial architecture

How money and authority are represented, which record is the truth for each amount, and what state every operation can be in. The message formats and rules are in [`SPEC.md`](SPEC.md); this document is the map.

## One system, seven parts

| Part | What it is | Where |
|---|---|---|
| Protocol core | Signed messages and the rules for checking them. Pure functions, no database, runs in a browser, a server or a CLI. | `lib/envelope/core.ts` |
| Gateway | The only component with PayPal credentials. Admits or refuses requests under a lock, then calls PayPal. | `lib/gateway/service.ts` |
| Balances and cards | Accounts that keep money, transfers, refunds by the agent that was paid, cards, the books. | `lib/gateway/bank.ts` |
| The books against PayPal's own | Reserves (PayPal's reported balance), the statement match (Transaction Search), disputes and the evidence that answers them. | `lib/gateway/books.ts` |
| Settlement | The record of PayPal calls, PayPal's events, the sweep, recall. | `lib/gateway/settlement.ts`, `lib/paypal/journal.ts` |
| Proof graph | Reads the records above and lays them out as nodes and relations with what a browser needs to check each. Writes nothing. | `lib/gateway/proof.ts` |
| Endpoints | One plain function per endpoint, wrapped for a server or called directly in the browser. | `lib/api/handlers.ts`, `lib/api/next.ts`, `lib/local/router.ts` |

Two places to run, one codebase: on a server against Postgres and the PayPal sandbox; or, when no database is configured, entirely in the visitor's browser against Postgres compiled to WebAssembly and the built-in PayPal simulator. Every page says which. In the browser every tab shares the one database: one tab's worker holds it, the turn at it is a Web Lock the browser gives back when a tab goes away, and a transaction a closed tab left open is rolled back before anyone else's statement runs (`lib/local/pg-worker.ts`).

## Who is trusted with what

| Party | Holds | Can | Cannot |
|---|---|---|---|
| Owner (a person) | A key in their browser | Seal an envelope, approve over a threshold, revoke, close, read their treasury, freeze and cancel for agents they answer for | Be impersonated by the gateway: the gateway never has the key |
| Agent | Its own key | Split its envelope narrower, ask to pay, set money aside, accept work, issue cards, move its balance, give back a payment it was paid | Widen anything, pay a payee or purpose not on its envelope, spend an ancestor's money twice, lift its owner's freeze, refund a payment made to somebody else |
| Merchant | Its own key | Charge a card that names it, within the card's terms | Charge any other card, exceed the terms, cancel a card |
| Gateway | A signing key; PayPal credentials | Refuse, reserve, call PayPal, sign receipts and notes | Mint authority: every payment needs signatures it cannot produce |
| PayPal | The money | Hold, capture, pay out, void, refund; refuse to capture past the hold; report the account's balance and statement; open and decide disputes | — |
| A language model | Nothing | Propose tool calls, which are signed by the agent's key and judged by the gateway like any request | Decide whether money moves |

A compromised gateway could refuse service, misreport, or misuse its PayPal credentials. It could not forge an owner's or agent's signature, so its misbehaviour would show in receipts that fail to verify. That boundary is why signatures are used although the gateway is online.

## Sources of truth

No screen computes its own idea of a balance. Each amount has one home:

| Amount | Authoritative record | Reconciled against |
|---|---|---|
| What the owner allowed | The signed root block | The owner's signature (checked in the browser) |
| What PayPal is holding | PayPal's authorization | `GET /v2/payments/authorizations/{id}` |
| What an envelope has left | `blocks.caps.limit − spentMinor − reservedMinor`, for it and every ancestor; the smallest wins | Recomputable from `spends` |
| Captured from a hold | `roots.capturedMinor` | Sum of captured spends; PayPal's captures by id |
| Captured and then refunded | `roots.refundedMinor` | PayPal's refund ids on the spends. This amount is the owner's again but stays used in the envelope: what a close releases is `limit − captured − refunded` |
| A payment's fate | `spends.status` and PayPal ids | `GET` capture and payout by id (the receipt page and the treasury do this) |
| An agent's balance | `accounts.balanceMinor` | Sum of that agent's `ledger` rows; the books page checks it for all accounts |
| What all agents are owed | Sum of balances, plus refunds due to owners | The balance PayPal reports for the gateway's account (`GET /v1/reporting/balances`), compared at the moment PayPal dates it |
| That a capture or payout happened | `spends.captureId`, `spends.payoutTransactionId` | PayPal's own statement of the account (`GET /v1/reporting/transactions`), by transaction id |
| Whether a payment is disputed | PayPal's dispute record | `GET /v1/customer/disputes`; mirrored on `spends.disputeId`, `spends.disputeStatus` |
| What a card has used | `cards.charges`, `cards.chargedMinor` | Count and sum of its settled `transfers` rows |

Amounts are integers in minor units everywhere. No floating point touches money.

## State machines

### A payment (`spends`)

```
            ┌──────────── DENIED (refused before anything was reserved)
request ────┤
            ├── PROMISED ──(expiry, release, revoke, close)──▶ LAPSED
            │       │ keep / accept by the named key / owner approval
            ▼       ▼
          RESERVED ──(PayPal refuses the capture)──▶ FAILED
            │ capture
            ▼
          CAPTURED ──(capture still PENDING at PayPal)──▶ waits; no payout
            │                └─(PayPal declines it)──▶ FAILED, budget returned
            │ payout, or credit to the payee's balance
            ▼
   PAID │ PAYOUT_PENDING │ UNCLAIMED
            │ PayPal later fails or returns the payout, or refused it outright;
            │ or the owner recalls an UNCLAIMED payout (PayPal cancels the item);
            │ or the agent that was paid into its balance signs a refund (balance debited first)
            ▼
   refund the capture ──ok──▶ FAILED, with why: PAYPAL_PAYOUT_FAILED │ RECALLED_BY_OWNER │ REFUNDED_BY_PAYEE
                     │        (owner refunded; the amount moves from captured to refunded and stays used)
                     └─refused──▶ REFUND_DUE (capture stays in the books, budget stays used; retried by the sweep and on demand)
                                  for a payee's refund instead: the money goes back into the agent's balance and the payment stays PAID
```

Rules that hold at every step:

- Reservation happens under the envelope's lock before PayPal is called, at every ancestor.
- The capture is counted by whichever arrival records the capture id first; the others count nothing.
- Nothing is paid out against a capture PayPal has not completed.
- `PAID` means PayPal reported the payout item `SUCCESS`, or the amount was credited to a balance. `UNCLAIMED` and `PAYOUT_PENDING` are never shown as paid.
- Every PayPal call carries an idempotency key derived from the spend id, so a retry is the same operation.
- A refund returns the owner's money and nothing else. PayPal counts a refunded capture against the hold for good, so the amount stays used in every envelope on the path. Only a capture PayPal declined (it never completed) gives its budget back.
- A dispute at PayPal does not change a payment's status. It is recorded beside it, shown, and answered with evidence; PayPal decides it, and a capture reversed by PayPal while the payment stands is flagged for the owner.

### Money leaving a balance (`transfers`)

```
signed transfer or charge ──▶ DENIED
                          └─▶ debit + ledger row, in one transaction under the account's lock
                                 ├─ to an account that keeps a balance ──▶ BOOKED (credit in the same transaction)
                                 └─ out through PayPal ──▶ SENDING ──▶ PAID │ PAYOUT_PENDING │ UNCLAIMED
                                                              └─(refused, or later returned)──▶ FAILED + one reversal row
```

A refund by the agent that was paid is also money leaving a balance, with its own two ledger kinds: one `refund` row debits the balance before PayPal is asked; if PayPal refuses, one `refund_reversal` row puts it back. Each is unique per payment, so neither can happen twice.

### A card (`cards`)

`ACTIVE` until the first of: cancelled by its holder or the holder's owner; its last allowed charge is made; its expiry passes. None can be undone.

### The hold

`CREATED` → `PARTIALLY_CAPTURED` → `VOIDED` when the owner closes, or it lapses at PayPal after its validity period. Reauthorizing a hold that is about to lapse is not built.

## Why this is a saga and not a transaction

PayPal and the database cannot commit together. The order is fixed so that a crash at any point leaves a state that can be finished by presenting the same request again or by `syncSpend` / `syncTransfer`:

1. Reserve (database, under lock). A crash here leaves a reservation that a retry resumes.
2. Capture (PayPal, idempotent). A crash after PayPal and before the database is healed by the retry: the same capture comes back and is claimed once.
3. Pay out or credit (PayPal idempotent, or one ledger row guarded by a unique index).
4. Sign the receipt and move reserved to spent, guarded by the status it expects.

What moves things along without a person: the sweep (`/api/sweep`), which asks PayPal about every pending payout, pending capture, refund due and unfinished refund, reads PayPal's event feed, checks disputes and lapses promises that ran out; and PayPal's events pushed to `POST /api/paypal/webhook`. `vercel.json` schedules the sweep once a day on a deployment with a database. Between sweeps, the same things advance when the envelope page is opened or the status is asked for. As of 12 November no webhook is registered for the sandbox app and the schedule has not been seen to fire.

## PayPal in the lifecycle

| Step | PayPal API | What would be missing without it |
|---|---|---|
| Seal | Orders v2, `intent: AUTHORIZE` | The outer limit: PayPal refuses to capture past the hold, whatever the gateway believes |
| Proof of funds, set aside | `GET /v2/payments/authorizations/{id}` | A payee would be trusting the gateway's word that money exists |
| Spend | Authorization partial capture; Payouts | No money would move |
| Reconcile | `GET` capture, `GET` payout batch | Receipts and books would be self-certified |
| Close | Authorization void | Unspent money would stay held |
| Failure | Capture refund | A failed payout would leave the owner charged |
| Give back | Capture refund, on the paid agent's signature | An agent could only return money by promising to |
| Balance out, card charge | Payouts | Balances would be a closed loop |
| Recall | Payout item cancel, then capture refund | A payout nobody claimed would stay out of the owner's hands for up to thirty days |
| Settle without being asked | Webhook signature verification; event feed | Unfinished payments would wait for somebody to open a page |
| Account for it | every call above, recorded with PayPal's debug id | Nobody could see what PayPal did, as opposed to what the gateway says it did |
| Reserves | Reporting: `GET /v1/reporting/balances` | "Agents are owed $X" would be checked only against the gateway's own arithmetic |
| Statement | Reporting: `GET /v1/reporting/transactions` | The only evidence a capture happened would be the answer to the call that made it |
| Disputes | `GET /v1/customer/disputes`, `POST …/provide-evidence` | A payer's dispute would arrive as a surprise reversal, unanswered |

Events never change the books directly. An event names a record; the gateway reads that record from PayPal by id and acts on the reading (`lib/gateway/settlement.ts`). The source of truth stays where the table above puts it.

Sandbox limits that matter: PayPal's sandbox has answered every cancel of an unclaimed payout item with a server error, so recall is proven on the simulator only; no webhook is registered for the sandbox app, so no genuine event has been received; PayPal's statement lags by up to three hours and its balance figure by about two, so a fresh record reads "not listed yet" (in the last recorded check all 28 were listed and matched; an hour earlier, 13 of 28) <!-- STATEMENT-CHECK -->; the sandbox account held no dispute, so answering one is proven on the simulator only; and the sandbox account holds test money from earlier runs, so reserves always read "covered" there. Also: the hold is placed on PayPal's documented test card with no buyer approval step; payouts to addresses without a sandbox account report `UNCLAIMED`.

## Interoperating with other agent-payment work

Envelope is not a replacement for mandates or checkout protocols; it covers what they leave open.

- **AP2 mandates** describe what a user authorized one agent to buy. An intent mandate could be the source of a root envelope's caps, and a cart mandate could be the object a promise or card refers to. Not implemented; the root block's fields were kept close to that shape for this reason.
- **Checkout protocols (ACP, UCP)** describe how an agent and one seller complete a purchase. Envelope answers a different question, upstream of checkout: is this agent allowed to spend this, and who stands behind it.
- **Attenuating tokens (macaroons, Biscuit, UCAN, the IETF attenuating-agent-token and agent-delegation drafts)** are the prior art for the chain. What Envelope adds is money: budgets debited at every ancestor and a real hold behind the root.
- **Network agent cards (Visa Intelligent Commerce, Mastercard Agent Pay)** work at any card merchant. Xenoncard does not; it is a different trade (see the README's limits).
