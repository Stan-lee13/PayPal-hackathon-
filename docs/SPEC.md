# The Envelope protocol (v1)

Envelope is spending authority for AI agents that can be **split but never enlarged**, enforced at the one place that can move money, and backed by a PayPal authorization.

It is a small protocol with a working implementation in this repository: `lib/envelope/core.ts` (pure, runs in browsers, agents and the gateway) and `lib/gateway/service.ts` (the stateful part and the PayPal calls).

## Why

An agent that can pay holds a credential. When it delegates work, the sub-agent gets the same credential, or the orchestrator becomes a bottleneck that has to approve every payment. Neither answers the questions that matter after something goes wrong: who authorized this dollar, under what limits, and how far could the damage have gone?

Flat "spending limits" don't compose: an orchestrator with a $500 limit that calls five sub-agents has five $500 problems. Envelope makes authority compose the way cash in envelopes does: you can only hand over part of what you hold.

## Roles and trust boundaries

- **Principal**: a human (or organisation). Holds a signing key. Seals root envelopes. Is the only one whose money is at stake.
- **Agents**: each holds its own key and the envelopes given to it. Agents are untrusted: any agent may be wrong, manipulated or compromised.
- **Gateway**: the only party with PayPal credentials. Verifies envelopes, keeps the counters signatures can't (spend, revocation, replay) and calls PayPal. It can refuse to pay; it cannot mint authority, because every chain must start with the principal's signature.
- **PayPal**: holds the principal's money under an authorization for the envelope's whole limit and refuses captures beyond it, whatever the gateway asks.

## Data structures

All structures are JSON. Signatures are Ed25519 over `domain + "\n" + canonical(body)`, where `canonical` is JSON with keys sorted at every level. Hashes are SHA-256 of the canonical JSON. Keys are raw 32-byte public keys, base64url.

A timestamp that does not parse is never within the acceptance window. No single amount may exceed 1,000,000,000 minor units.

Encodings are strict. Keys and signatures are base64url with no padding, and a verifier must reject any other spelling of the same bytes: padding, `+` or `/`, whitespace, or non-zero spare bits in the last character. A lenient decoder would let one signed request be presented as several. A request is identified for replay purposes by the hash of its signed content (which carries a nonce), not by the text of its signature.

### Block

```
{
  "body": {
    "v": "envelope/1",
    "id": "env_…",            // random
    "root": "env_…",          // id of the first block
    "parent": "<sha256 of the parent block>" | null,
    "issuer": "<public key that signs this block>",
    "holder": "<public key this block gives authority to>",
    "holderLabel": "localization-agent",
    "caps": {
      "currency": "USD",
      "limit": 6000,           // minor units, lifetime total
      "perPayment": 5000,
      "payees": ["translator@example.com"] | null,
      "purposes": ["translation"] | null,
      "notAfter": "2026-11-11T14:00:00.000Z",
      "splits": 0              // how many more times it may be split
    },
    "issuedAt": "…"
  },
  "sig": "<issuer's signature, domain envelope/1>"
}
```

An **envelope** is an array of 1 to 8 blocks, root first. Block 0 is signed by the principal. Block *i* is signed by the holder of block *i−1*.

### Spend request

```
{ "request": { "v": "envelope-spend/1", "leaf": "<id of the last block>", "amount": 4500, "currency": "USD",
               "payee": "translator@example.com", "purpose": "translation", "memo": "…", "nonce": "n_…", "at": "…" },
  "sig": "<signature by the last block's holder, domain envelope-spend/1>",
  "chain": [ …the envelope… ] }
```

### Receipt

```
{ "v": "envelope-receipt/1", "spend": "sp_…", "decision": "PAID",
  "request": { … }, "requestSig": "…",
  "chain": [ { "id", "hash", "holder", "holderLabel" }, … ],
  "principal": "<owner's public key>",
  "paypal": { "mode": "sandbox", "authorizationId": "…", "captureId": "…", "payoutBatchId": "…", "payoutItemId": "…" },
  "issuedAt": "…", "gateway": "<gateway public key>", "sig": "<gateway signature>" }
```

### Introduction and statement of standing

An agent introduces itself to a payee with a **hello**: the same fields as a spend request without the memo, signed under a different domain so it can never be replayed as a payment.

```
{ "request": { "v": "envelope-hello/1", "leaf": "…", "amount": 7000, "currency": "USD",
               "payee": "designer@example.com", "purpose": "design", "nonce": "n_…", "at": "…" },
  "sig": "<signature by the last block's holder, domain envelope-hello/1>",
  "chain": [ …the envelope… ] }
```

The payee hands it to the gateway and receives a **statement of standing**:

```
{ "v": "envelope-standing/1",
  "agent": "<public key>", "agentLabel": "creative-agent", "account": "QDF0-810H-KB39",
  "sponsors": [ { "role": "owner", "label": "Ada", "key": "…" }, { "role": "agent", "label": "ops-agent", "key": "…" } ],
  "root": "env_…",
  "ask": { "amount": 7000, "currency": "USD", "payee": "designer@example.com", "purpose": "design" },
  "good": true, "reasons": [],
  "availableMinor": 8000,
  "paypal": { "mode": "sandbox", "authorizationId": "…", "status": "PARTIALLY_CAPTURED", "unusedMinor": 15500 },
  "issuedAt": "…", "validUntil": "<issuedAt + 5 minutes>", "gateway": "<gateway public key>", "sig": "…" }
```

`account` is a readable account number derived from the agent's public key (its first 60 bits in Crockford base32).

### Promise, keep and promise note

A **promise** sets money aside for one payee. It has the fields of a spend request plus a lifetime, and its own signature domain:

```
{ "request": { "v": "envelope-promise/1", "leaf": "…", "amount": 4500, "currency": "USD",
               "payee": "acct:qjq2-q15k-g5sa", "purpose": "translation", "memo": "…",
               "ttl": 900, "nonce": "n_…", "at": "…" },
  "sig": "<signature by the last block's holder, domain envelope-promise/1>",
  "chain": [ …the envelope… ] }
```

`ttl` is in seconds, between 30 and 3600. The gateway answers with a **promise note** for the payee:

```
{ "v": "envelope-promise-note/1", "promise": "pr_…",
  "agent": "<payer's public key>", "agentLabel": "localization-agent", "account": "…",
  "sponsors": [ { "role": "owner", "label": "Ada", "key": "…" }, { "role": "agent", "label": "ops-agent", "key": "…" } ],
  "root": "env_…", "amount": 4500, "currency": "USD", "payee": "acct:qjq2-q15k-g5sa", "purpose": "translation",
  "expiresAt": "…", "paypal": { "mode": "sandbox", "authorizationId": "…", "status": "CREATED" },
  "issuedAt": "…", "gateway": "<gateway public key>", "sig": "…" }
```

The maker of a promise later decides it with a **keep**:

```
{ "request": { "v": "envelope-keep/1", "promise": "pr_…", "action": "pay" | "release", "nonce": "n_…", "at": "…" },
  "sig": "<signature by the promise's maker, domain envelope-keep/1>", "by": "<its public key>" }
```

A promise may carry `"releaseBy": "<public key>"`. That key can then pay the promise with an **acceptance**:

```
{ "request": { "v": "envelope-accept/1", "promise": "pr_…", "work": "<sha-256 of what was delivered, or empty>",
               "note": "Checked against the brief.", "nonce": "n_…", "at": "…" },
  "sig": "<signature by the named key, domain envelope-accept/1>", "by": "<that key>" }
```

### Reference

```
{ "v": "envelope-reference/1", "agent": "<public key>", "label": "localization-agent", "account": "…",
  "knownSince": "…", "asOf": "…", "answersForIt": "Bea" | null,
  "facts": { "paymentsSettled": 2, "paidMinor": 5500, "promisesKept": 2, "promisesLapsed": 1,
             "requestsRefused": 1, "refusedFor": ["OVER_ENVELOPE_LIMIT"], "envelopesHeld": 1,
             "envelopesRevoked": 0, "timesPaid": 0, "earnedMinor": 0 },
  "paypalMode": "sandbox", "gateway": "<gateway public key>", "sig": "…" }
```

Facts as one gateway has seen them, signed so the agent can show them to anyone. No score is derived.

### Account opening

An agent that wants to receive opens an account. The body is signed twice, by the agent's own key and by the owner who answers for it:

```
{ "body": { "v": "envelope-account/1", "agent": "<agent public key>", "label": "translator-agent",
            "owner": "<owner public key>", "ownerName": "Bea", "settleTo": "bea@example.com", "at": "…" },
  "agentSig": "…", "ownerSig": "…" }
```

A payee written as `acct:` followed by the agent's account number (lower case) means that agent.

### Balance, transfer and freeze

An account opening may carry `"mode": "hold"` and `"perPayment": <minor units>`. Both are covered by the agent's and the owner's signatures.

```json
{ "request": { "v": "envelope-transfer/1", "from": "<agent key>", "kind": "pay", "amount": 1200, "currency": "USD",
               "payee": "acct:xxxx-xxxx-xxxx", "purpose": "proofreading", "memo": "", "nonce": "n_…", "at": "…" },
  "sig": "<signature by `from`>" }
```

`kind` is `pay` or `withdraw`. A `pay` names an account (`acct:…`) or a PayPal address. A `withdraw` names no one: its payee is the literal `owner`, and the gateway sends it to the settlement address in the account's signed opening.

```json
{ "request": { "v": "envelope-freeze/1", "agent": "<agent key>", "frozen": true, "nonce": "n_…", "at": "…" },
  "sig": "<signature by the owner>", "by": "<owner key>" }
```

A completed transfer has a receipt signed by the gateway under `envelope-transfer-receipt/1`: the request and its signature, the paying account, where the money went (an account here, or a PayPal address with the payout batch id), and the balance after.

### Card, charge and cancellation

A card is a signed statement by an agent with an account. It is not a credential: it contains nothing secret, and holding a copy of it grants nothing.

```json
{ "body": { "v": "envelope-card/1", "id": "card_…", "holder": "<agent key>", "label": "Lexica Pro",
            "merchant": "acct:xxxx-xxxx-xxxx", "perCharge": 900, "maxCharges": 2, "every": 2592000,
            "notAfter": "…", "at": "…" },
  "sig": "<signature by `holder`>" }
```

`merchant` must be an account. `every` is the least number of seconds between two charges. A card allows between 1 and 120 charges and lives at most two years.

```json
{ "request": { "v": "envelope-charge/1", "card": "card_…", "merchant": "<merchant key>", "amount": 900,
               "currency": "USD", "memo": "", "nonce": "n_…", "at": "…" },
  "sig": "<signature by `merchant`>" }
```

```json
{ "request": { "v": "envelope-card-cancel/1", "card": "card_…", "nonce": "n_…", "at": "…" },
  "sig": "…", "by": "<the holder's key, or the key of the owner of the holder's account>" }
```

## Rules

### Splitting (offline)

The holder of an envelope appends a block for another key. The new caps must be a narrowing of the parent's:

- `limit` ≤ parent's, `perPayment` ≤ parent's, same currency
- `payees` ⊆ parent's (if the parent lists payees, the child must too), same for `purposes`
- `notAfter` ≤ parent's
- `splits` ≤ parent's − 1, and the parent's `splits` must be ≥ 1

No server is involved. A block that widens anything is simply invalid: every verifier rejects the chain, naming the rule (`WIDENED_LIMIT`, `WIDENED_PAYEES`, …).

### Verifying a spend (stateless)

1. Every block's signature verifies against its `issuer`; block 0 is a root; each later block's `parent` is the hash of the previous block, its `issuer` is the previous block's `holder`, and its caps narrow the previous block's.
2. No block is expired.
3. The request is signed by the last block's `holder` (proof of possession), is at most 5 minutes old, and fits the last block's caps: currency, `perPayment`, payee, purpose.

### Admitting a spend (stateful, under a per-root lock)

4. The root is one the gateway sealed, is open, and has a PayPal authorization.
5. No block in the chain is revoked.
6. The request hash has not been seen (the same signed request is never executed twice).
7. For **every** block in the chain: `spent + reserved + amount ≤ limit`. A spend debits each ancestor, so however an orchestrator hands out limits, the total through it never exceeds its own.
8. The amount is reserved at every level before any PayPal call.

### Executing

9. `POST /v2/payments/authorizations/{id}/capture` for exactly the amount, `final_capture: false`, `invoice_id` = spend id, `PayPal-Request-Id` = `capture-<spend id>`.
10. `POST /v1/payments/payouts` to the payee, `sender_batch_id` = spend id.
11. Reservation → spent at every level; the gateway signs the receipt.

Failures: a definite refusal by PayPal releases the reservation (and refunds the capture if the payout was refused). A timeout or 5xx leaves the reservation in place; presenting the same signed request again resumes from where it stopped, with the same idempotency keys. A payout PayPal later fails or returns is refunded and the budget restored.

### Revoking

A revocation is `{ request: { v: "envelope-revoke/1", block, nonce, at }, sig, by }`. It is accepted from the principal, from the holder of any block above the target, or from the target's own holder. Revoking a block kills its subtree (rule 5). Revoking the root closes the envelope: the gateway voids the PayPal authorization and the unspent remainder is released.

### Setting money aside

`POST /api/gateway/promise`. A promise is verified and admitted exactly like a spend (the same stateless checks, the same lock, the same budget check at every level) and reserves its amount in every envelope of the chain. It then:

1. asks PayPal for the authorization and requires it to be `CREATED` or `PARTIALLY_CAPTURED`; otherwise the reservation is released and the promise refused;
2. returns the promise note, signed by the gateway.

`POST /api/gateway/keep` with `action: "pay"` turns the reservation into a payment: capture and payout as for a spend, with the promise id as the idempotency key. Before paying, the gateway checks again that no envelope in the chain has been revoked and that the root is open. `action: "release"` gives the reservation back. Only the key that made the promise can keep it.

A promise is released automatically when its time runs out, when any envelope in its chain is revoked, and when the root is closed. It is earmarked money, not escrow: the payee learns that the money exists and cannot be spent elsewhere, and gets no right to it.

### Owner approval above a threshold

A block's caps may carry `"approveOver": <minor units>`. It is optional; when a parent has it, every block below must have it too, at the same value or lower (`WIDENED_APPROVAL` otherwise). `split` carries it down by default.

For a request whose amount is greater than the leaf's `approveOver`:

- a spend is refused with `NEEDS_OWNER_APPROVAL`;
- a promise is refused with the same code unless its `releaseBy` is the root's issuer (the owner);
- a promise that does name the owner is admitted and reserved like any other, and appears in the owner's treasury as waiting for a signature;
- `keep` with `action: "pay"` from the promise's maker is refused: only an acceptance signed by the owner pays it. An acceptance with `"decline": true` from the owner releases it. The maker may still release its own request.

A statement of standing for such an amount reports `good: false` with `NEEDS_OWNER_APPROVAL`, so a payee sees that the agent cannot pay this on its own.

### Releasing a promise on accepted work

`POST /api/gateway/accept`. If a promise names `releaseBy`, an acceptance signed by exactly that key pays it, through the same path as `keep` with `action: "pay"`: the gateway re-checks revocation and that the root is open, then captures and pays out. The maker of the promise consented to this when it signed `releaseBy`. The gateway does not judge the work; it checks one signature. The acceptance's `work` fingerprint, note and time are stored and appear on the receipt as `releasedBy`.

A promise without `releaseBy` can only be paid by its maker. An acceptance from any other key, a keep signature presented as an acceptance, or an acceptance pointed at a different promise is refused.

### Accounts and paying an agent

`POST /api/accounts`. The gateway accepts an opening only if both signatures verify, so nobody can point another agent's account number at their own PayPal address. A later opening signed by the same agent replaces the earlier one; an older one is ignored. Two keys can never hold the same account number.

When a spend or promise names an `acct:` payee, the gateway resolves it under the root lock and fixes the settlement address on the spend at that moment; a later change to the account does not redirect a payment already admitted. An account number nobody opened is refused with `PAYEE_ACCOUNT_UNKNOWN`. The payout goes to the settlement address, and the receipt records the account, the agent and where PayPal sent the money.

### When PayPal does not finish cleanly

The gateway and PayPal cannot commit together, so each step is safe to repeat and each change of status is conditional on the status it expects.

- **One capture, counted once.** A request may arrive many times at once. Every arrival gets the same capture back from PayPal (one idempotency key). Only the arrival that records the capture id adds it to the envelope's books.
- **A capture PayPal has not completed.** If PayPal answers a capture with `PENDING`, the gateway records it and pays nobody. When asked again it reads the capture: `COMPLETED` continues to the payout; anything else fails the payment, returns the budget and removes the capture from the books.
- **A payout that cannot be made or delivered.** The capture is refunded to the owner and the budget returns. If PayPal refuses the refund, the payment becomes `REFUND_DUE`: the capture stays in the books and the budget stays used, and each later look tries the refund again.
- **A refused payout request is not proof that no payout exists.** Before refunding, the gateway re-reads its own record; if another arrival of the same request has recorded a payout, or PayPal's refusal says the request is a duplicate, it does not refund.
- **Revoked in between.** A payment that was admitted but not yet captured is checked again before the capture; if any envelope on its path was revoked or the root closed, it fails and nothing is captured.
- **What is recorded.** A refusal is stored against an envelope, account or card only when the request was really signed by its holder (or, for a card, its merchant). Anything else is refused and forgotten.

### Reading an owner's books

```json
{ "request": { "v": "envelope-read/1", "what": "treasury", "subject": "<owner key>", "nonce": "n_…", "at": "…" },
  "sig": "<signature by `by`>", "by": "<owner key>" }
```

A treasury, and the list of an owner's envelopes, are returned only for a read signed by that owner within five minutes. `what: "demo"` with an envelope id as the subject is what lets the built-in demo agents act: they move only when the envelope's owner asks.

### Balances

An account in `hold` mode keeps its income. The balance is a number on the account row that only ever changes in the same transaction as one row in the ledger. Ledger rows are unique per (account, kind, reference), where the reference is the id of the spend or transfer.

Income. A spend or promise whose payee is an account in `hold` mode is admitted, reserved and captured like any other. After the capture the gateway, under the account's lock, writes one `income` row with the spend's id and adds the amount to the balance. No payout is made. The receipt's `paidTo.held` names the ledger entry, and its `paypal.payoutBatchId` is null. Whether an account holds or settles is read when the payment is admitted.

Transfer. The gateway checks, in order:

1. shape; the signature by `from` under the transfer domain; `at` within 5 minutes; a positive whole amount in USD; a well-formed payee;
2. `from` has an account; a named account exists and is not `from` itself;
3. under the lock of the paying account (and of the receiving account, both taken in key order): the same signed request has not been seen; the account is not frozen; a `pay` is not over `perPayment`; the amount is not over the balance.

If all hold, the balance is debited and a ledger row written. When the payee is an account in `hold` mode, the credit and its row are written in the same transaction and the transfer is `BOOKED`: PayPal is not called. Otherwise the transfer is `SENDING`, and after the transaction commits the gateway asks PayPal for a payout with the transfer id as the batch id. A network failure leaves it `SENDING`; presenting the same request again resumes it and cannot pay twice. A refusal by PayPal writes one `reversal` row and puts the amount back.

A withdrawal is not subject to `perPayment`: it can only go to the owner.

Freeze. Only the key in the account's `owner` field can freeze or unfreeze. A frozen account refuses every transfer; income still arrives. A freeze or unfreeze is applied only if its `at` is later than the last one applied, so an old one cannot be presented again to undo a newer one.

Owner. A later account opening can change the label, settlement address, mode and cap, and needs both signatures again. It is refused if it names a different owner key, so an agent cannot give itself a new owner to escape a cap or a freeze.

The books. At any time: the sum of balances equals the sum of ledger rows; that sum equals income minus payouts and withdrawals plus reversals; transfers between accounts sum to zero. `GET /api/bank` reports the three checks.

### Cards

Issuing. The gateway accepts a card if its shape and limits are sane, it is signed by `holder` within 5 minutes of `at`, `holder` has an account, and `merchant` is an existing account other than the holder's. The same signed card presented again returns the stored card and changes nothing. Issuing moves no money.

Charging. The gateway checks, in order:

1. shape; the signature by the key in `request.merchant` under the charge domain; `at` within 5 minutes; a positive whole amount in USD;
2. the card exists; `request.merchant` is the key of the account the card is locked to (`NOT_THE_MERCHANT` otherwise);
3. under the holder's account lock (and the merchant's, in key order, when the merchant keeps a balance): the same signed charge has not been seen; the card is not cancelled, not expired, and has charges left; the amount is not over `perCharge`; if there was an earlier charge, `every` seconds have passed since it; then the owner's rules for any movement out of the balance: not frozen, not over the cap per payment, not over the daily limit, not over the balance.

If all hold, the balance is debited, the card's count goes up by one, and the money moves as for a transfer: credited at once to a merchant that keeps a balance, or paid out by PayPal to the settlement address in the merchant's signed account. A payout PayPal refuses puts the money back and gives the charge back to the card.

A card is over when it is cancelled, when its last charge is made, or when `notAfter` passes. None of these can be undone; an agent that wants to go on issues a new card.

Cancelling. The holder's key or the key of the owner of the holder's account. Nobody else, the merchant included.

A daily limit. An account opening may carry `"perDay": <minor units>`. Payments and card charges out of the balance in the last 24 hours, net of refused payouts, may not exceed it. Withdrawals to the owner do not count.

### Checking an agent before working for it

Anyone holding a hello may ask `POST /api/gateway/standing`. The gateway:

1. verifies the hello exactly as it would a spend (rules 1 to 3), which proves the agent controls the key it claims;
2. reads, without locking or reserving, the same state a spend would be admitted against (rules 4, 5 and 7);
3. asks PayPal for the authorization (`GET /v2/payments/authorizations/{id}`) and requires it to be `CREATED` or `PARTIALLY_CAPTURED`;
4. signs the answer: who stands behind the agent back to the owner, whether this exact payment would be accepted now, and the most the agent could pay this payee in one payment.

Nothing is reserved, so the answer can go stale; it is valid for five minutes. It is evidence that the money exists and is reachable by this agent for this payee, not a promise to pay.

## How it maps to PayPal

| Envelope | PayPal | Why it matters |
|---|---|---|
| Seal | Orders v2, `intent: AUTHORIZE` | The money is guaranteed before any agent starts, and never charged up front. |
| Spend | Partial capture of the authorization, then Payouts | The owner is charged exactly what agents spent. PayPal refuses captures beyond the hold. |
| Close / expire | Void authorization | The remainder goes back automatically. |
| Set aside | Show authorization details | The fee is reserved under the same hold, and PayPal has confirmed the hold, before a payee starts work. |
| Accept | Capture + Payout, triggered by the named key's signature | Payment follows evidence of delivery without either side holding PayPal credentials; the fingerprint of the work is bound to the PayPal ids on the receipt. |
| Pay an agent | Payout to the account's settlement address | One agent's spending becomes another agent's income without either holding PayPal credentials. |
| Check | Show authorization details | A payee learns from PayPal, through the gateway, that the hold is live before doing any work. |
| Receipt | capture id, payout batch and item ids | Any PayPal transaction can be traced to its chain of authority, and re-checked with PayPal's own GET endpoints. |

Verified in the PayPal sandbox on 2026-11-11: 12 partial captures of one authorization all completed; an over-capture was refused (`MAX_CAPTURE_AMOUNT_EXCEEDED`); void after partial captures returned `VOIDED`. See `docs/evidence/sandbox-run.json`.

An authorization is a hold placed by PayPal on the payer's funding source. It is not an escrow service, lasts at most 29 days, and is honoured for 3; envelopes are limited to 28 days.

## Security notes

Balances: a balance on this gateway is a claim on money that sits in the gateway's own PayPal account after a capture. That is stored value. The reference implementation runs on the PayPal sandbox only; a deployment with real money needs a licensed party to hold the funds. The owner's cap limits one payment, not a day's total, so the freeze is the control that stops a compromised agent. An account can also carry a daily limit.

Cards: a card's security does not depend on keeping anything secret. A charge is authenticated by the merchant's signature, and the money can only go to the account the agent named when it signed the card. What a card does not do is check that the merchant delivered anything; within its terms the merchant can charge.

- **Compromised agent**: can spend at most what is left in its own envelope, only to its listed payees and purposes, until it expires or is revoked.
- **Stolen envelope**: useless without the holder's private key.
- **Malicious or buggy gateway**: can refuse to pay or pay less. It cannot produce a chain rooted in the principal's key, so it cannot justify a payment the principal's envelope didn't allow; receipts make every payment checkable by a third party, in the browser, against PayPal.
- **Prompt injection**: irrelevant to enforcement. The gateway reads signatures and numbers, never model output. An agent's free-text note is stored for the human only.
- **Replay**: request hashes are unique; requests expire after 5 minutes.
- **What it does not do**: it does not judge whether a payment inside the limits was a good idea, and it does not hide payee addresses from agents.

## Prior art

Attenuating capability chains are well established: macaroons (2014), Biscuit, UCAN, L402 (macaroons with Lightning payments), ERC-7710 on-chain redelegation, and 2026 IETF drafts on attenuating agent tokens and delegation chains. Agent-payment standards such as AP2 mandates and Agentic Commerce Protocol shared payment tokens scope a payment from a user to an agent or a seller.

Agent identity, "know your agent" and agent wallets are also crowded: Skyfire, Catena Labs, Payman, Crossmint, Coinbase, Visa and Mastercard all have products or specifications, and PayPal has named the concept. One commercial product (SpendVeto) states that a grandchild's spend counts against every ancestor's cap. Several entries to this hackathon ship agent passports, delegation chains or hold-and-capture budgets; see `docs/DISCOVERY.md`.

Envelope's contribution is the combination, on a mainstream fiat rail: a chain any third party can verify with public keys, money budgets debited at every ancestor, one PayPal authorization behind the whole tree that the network itself enforces, a statement of standing tied to that live hold, and receipts binding PayPal transaction ids to the full chain. We found no project that has all of these together.

## Roadmap

- Principal consent through PayPal's own checkout or a vaulted wallet instead of the sandbox test card.
- Delivery-versus-payment for promises, so a payee holds more than earmarked money.
- Reauthorizing a hold before it lapses, for envelopes that outlive PayPal's honor period.
- Envelopes as AP2 / UCP payment-mandate attachments, so merchants can accept them directly.
- Keys in hardware or passkeys; gateway state in an append-only public log.
