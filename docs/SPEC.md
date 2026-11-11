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
| Check | Show authorization details | A payee learns from PayPal, through the gateway, that the hold is live before doing any work. |
| Receipt | capture id, payout batch and item ids | Any PayPal transaction can be traced to its chain of authority, and re-checked with PayPal's own GET endpoints. |

Verified in the PayPal sandbox on 2026-11-11: 12 partial captures of one authorization all completed; an over-capture was refused (`MAX_CAPTURE_AMOUNT_EXCEEDED`); void after partial captures returned `VOIDED`. See `docs/evidence/sandbox-run.json`.

An authorization is a hold placed by PayPal on the payer's funding source. It is not an escrow service, lasts at most 29 days, and is honoured for 3; envelopes are limited to 28 days.

## Security notes

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
- A statement of standing that also reserves the amount for a short time, so a payee's check becomes a guarantee.
- Envelopes as AP2 / UCP payment-mandate attachments, so merchants can accept them directly.
- Keys in hardware or passkeys; gateway state in an append-only public log.
