# The Envelope SDK

`@envelope/sdk` is a TypeScript library for giving an AI agent spending authority of its own: an
envelope a person sealed, backed by a PayPal hold, which the agent can spend from, split for other
agents and never enlarge. It also covers the other side: an agent that gets paid, keeps a balance,
pays other agents and issues a card.

It lives in [`sdk/`](../sdk). The MCP server (`scripts/mcp.ts`) and the command line
(`scripts/agent.ts`) are built on it, so the three always agree.

It is not published to npm (the package is marked private). Build it from this repository.
Everything here is sandbox-only.

## Quick start

```bash
npm run sdk:pack          # builds sdk/envelope-sdk-0.1.0.tgz: one ES module, no dependencies
```

Install that file in your project (`npm install /path/to/envelope-sdk-0.1.0.tgz`), start a gateway
(main README), and:

```js
import { Agent, Owner } from "@envelope/sdk";

const gateway = "http://localhost:3000";
const owner = await Owner.generate({ gateway, label: "Ada" });        // a person; in the app this key lives in their browser
const agent = await Agent.generate({ gateway, label: "ops-agent" });  // the agent's own key, made on its machine

const { chain, root } = await owner.seal({ to: agent.identity, limit: "50.00", perPayment: "20.00", payees: ["designer@example.com"], purposes: ["design"], hours: 1 });
await agent.hold(chain);                                              // checked locally: every signature, back to the owner

const payment = await agent.pay({ amount: "12.50", payee: "designer@example.com", purpose: "design", memo: "Banner" });
console.log(root.authorizationId, payment.paypal?.captureId, payment.status, payment.delivered);
```

That is [`examples/hire-an-agent/quickstart.mjs`](../examples/hire-an-agent/quickstart.mjs). Run on
11 November 2026 against a local gateway on the PayPal simulator, it printed:

```text
PayPal hold SIMAUTH66DE8E0A7DDC4DC6; capture SIMCAPA2C90DE061EC4C9C; payout SIMBATCH099D3175740E4EF3: PAID
Receipt verified on this machine.
```

The fuller example has been run against the real PayPal sandbox: [`evidence/sdk-run.md`](evidence/sdk-run.md).

On the PayPal sandbox the same code prints real PayPal ids, and a payout to an address with no
sandbox account ends as `UNCLAIMED`, with `payment.delivered === false`.

A fuller program, with two agents hiring a third: [`examples/hire-an-agent`](../examples/hire-an-agent).

## What does what

| Piece | What it is |
|---|---|
| The **gateway** | The server in this repository. It is the only thing with PayPal credentials. It decides every request by checking signatures and doing arithmetic. |
| **`Owner`** | A person, or a service acting for one. Their signature is the root of every envelope. |
| **`Agent`** | Software with its own key. It holds an envelope someone gave it. It may also hold an account. |
| **An envelope** | A chain of signed blocks: the owner's, then one per split. It contains no secret, so it can be stored and passed around freely. Only the key it names can use it. |
| **This SDK** | Makes keys, signs requests with them, sends them to the gateway, and verifies what comes back. |

## The API

Amounts are dollars as a string (`"45.00"`, `"45"`, `"45.5"`) or minor units stated outright
(`{ minor: 4500 }`). A bare number is refused: `45` could mean dollars or cents.

### `Gateway`

`new Gateway(url, { fetch?, retries?, timeoutMs? })`. Every other class accepts a `Gateway` or just the URL.

| Method | Gives you |
|---|---|
| `key()` | The gateway's public key (fetched once, then used to check its signatures) |
| `envelope(rootId)` | An envelope as the gateway knows it: blocks, what is spent and reserved at each, every request |
| `agent(keyOrAccount)` | An agent's public profile: envelopes held, account, balance, record, cards |
| `reference(key)` | An agent's record, signed by the gateway |
| `receipt(spendId)` | A receipt, its chain, and the gateway's comparison with PayPal made now |
| `proof(rootId, spendId?)` | The proof graph of an envelope, or of one payment |
| `card(id)`, `transfer(id)` | A card, a transfer out of a balance |
| `books()` | Every balance, whether the books add up, and `reserves`: what agents are owed against the balance PayPal reports for the gateway's account (`covered` is `null` when PayPal could not be asked) |
| `requestApproval(chain, { title?, returnUrl, cancelUrl? })`, `seal(chain, { approvedOrder })` | The two halves of a seal the payer approves at PayPal, for a root block you signed yourself |
| `statement()` | The gateway's captures, payouts and refunds looked up in PayPal's own statement of its account: each `listed`, `amount differs` or `not listed yet` (PayPal's statement can lag by hours), with PayPal's fee on each line and a `position`: what came in, went out and was refunded, the fees, and what that leaves at PayPal |
| `status(spendId)` | Where a payment stands now, in any state |
| `evidence(spendId)` | What the gateway would send PayPal if the payer disputed this payment: the signed chain, in words and in full |
| `paypalTrail(rootId)` | The gateway's record of its calls to PayPal for one envelope |
| `request(method, path, body?)` | The raw call, if you need an endpoint not wrapped here |

The signed submissions (`spend`, `promise`, `keep`, `accept`, `revoke`, `seal`, `openAccount`,
`sendTransfer`, `refund`, `freeze`, `issueCard`, `charge`, `cancelCard`, `treasury`, `recall`, …) are also on
`Gateway`, taking an already-signed request. `Agent` and `Owner` are the convenient way to make those.

### `Agent`

| Method | What it does |
|---|---|
| `Agent.generate({ gateway, label })` | A new agent with a fresh key. Sends nothing. |
| `Agent.fromJSON(saved, { gateway })` / `agent.export()` | Restore and save an agent. The saved form contains its private key. |
| `hold(chain)` | Take up an envelope. Verified locally first: all signatures, nothing widened, addressed to this key. |
| `authority()` | What this agent may spend: its limits, and what is left at each level above it |
| `split({ to, limit, perPayment?, payees?, purposes?, hours?, splits?, approveOver? })` | Cut a narrower envelope for another agent. A wider one is refused before it is signed. Returns the new chain. |
| `pay({ amount, payee, purpose, memo?, note? })` | Pay from the envelope. PayPal captures that amount from the owner's hold and pays the payee. |
| `setAside({ amount, payee, purpose, minutes?, releaseBy? })` | Reserve money for a payee before work starts. Returns a signed note for the payee. |
| `keep(promiseId)` / `release(promiseId)` | Pay what was set aside, or give it back to the envelope |
| `introduce({ amount, payee, purpose })` | A signed introduction a payee can check. Moves nothing. |
| `openAccount({ owner, settleTo, hold?, perPayment?, perDay? })` | Open an account that can be paid. Needs the owner's signature too. |
| `balance()` | The account's balance and ledger |
| `transfer({ amount, payee, purpose? })` / `withdraw({ amount })` | Send money from the balance: to another agent (on the ledger), to a PayPal address, or home to the owner |
| `refund(spendId, { memo? })` | Give one payment back, in full. Only for a payment that was credited to this agent's balance and is still there: the balance is debited and PayPal refunds the capture to the owner who paid. Returns `REFUNDED` with PayPal's refund id, or `PENDING` if PayPal could not be reached (the gateway asks again). A refund returns the owner's money; it does not make that part of their envelope spendable again |
| `issueCard({ merchant, label, perCharge, maxCharges, everyDays?, validDays? })` | Let one merchant charge the balance within limits. It ends by itself. |
| `cards()` | The cards this agent has issued |
| `reference()` | Its signed record, with a token to hand to anyone |

### On both `Agent` and `Owner`

| Method | What it does |
|---|---|
| `accept(promiseId, { work?, note? })` | As the key a promise named: sign that the work is accepted. That signature pays it. An owner approving a payment over their threshold is this call. |
| `decline(promiseId)` | As the named key: refuse. The money returns to the envelope. |
| `revoke(blockId)` | Revoke an envelope and everything split from it (the owner, or any holder above it) |
| `cancelCard(cardId)` | Cancel a card (its holder, or the owner of its account) |
| `charge({ card, amount, memo? })` | As the merchant a card is locked to: take a charge |
| `receipt(spendId)` | The receipt, PayPal's word on it, and `verify()` to re-check every signature locally |
| `status(spendId)` | Where a payment stands now, in any state: refused, set aside, in flight, unclaimed, paid, refunded |
| `checkIntroduction(token)` / `checkPromiseNote(token)` | As a payee: check what another agent handed you. The statement of standing that comes back includes PayPal's word on the hold and two dates: `paypal.honoredUntil`, the end of PayPal's three-day honor period, and `paypal.authorizedUntil`, when the authorization itself ends |
| `exportKey()` | The private key as a JWK, for saving on this machine |

### `Owner`

| Method | What it does |
|---|---|
| `Owner.generate`, `Owner.fromJSON`, `export()` | As for `Agent` |
| `seal({ to, limit, perPayment?, payees?, purposes?, hours?, splits?, approveOver?, title? })` | Sign an envelope and have PayPal hold the money. Returns the chain and PayPal's authorization id. |
| `requestApproval({ …the same terms, returnUrl, cancelUrl? })` | Sign the envelope and ask PayPal for a link where the payer approves the hold in PayPal's own checkout. Returns `{ chain, orderId, approveUrl, title }`. Nothing is held or recorded: send the payer to `approveUrl` |
| `sealApproved({ chain, orderId, title? })` | Finish that seal once the payer is back. The gateway reads the order from PayPal and refuses unless it was made for this envelope, for this amount, and is approved; then PayPal places the hold. Refused with nothing held if the payer has not approved |
| `close(rootId)` | Close an envelope. PayPal voids what was not spent. |
| `freeze(agent, frozen?)` | Freeze or reopen an agent's account |
| `treasury()`, `reconcile()`, `envelopes()` | The owner's books, checked against PayPal. Each read is signed, so only the owner gets them. |
| `recall(spendId)` | Call back a payout PayPal is holding unclaimed. PayPal cancels the item and the capture is refunded to the owner; the amount stays used in the envelope. PayPal's sandbox has not completed a cancel; see the main README |

### Functions

`getReceipt`, `getStatus`, `checkIntroduction`, `checkPromiseNote`, `checkReference` (need only a
gateway URL, no key). `verifyReceipt`, `verifyStanding`, `verifyPromiseNote`, `verifyReference`,
`verifyTransferReceipt` (pure: no network). `fingerprint(text)` (SHA-256, for `accept({ work })`).
`toMinor`, `formatMinor`. `protocol` is the whole protocol core (every `sign…` and `verify…`).

Types for what the gateway answers are exported too, among them `RefundOutcome`, `Reserves`,
`StatementCheck`, `Evidence`, `PayPalTrail`, `PaymentStatus`, `Recalled`, `ApprovalLink` and `SealTerms`.

## What a payment tells you

```ts
type Payment = {
  status: "PAID" | "PAYOUT_PENDING" | "UNCLAIMED" | …;   // the gateway's word
  delivered: boolean;       // true only for PAID
  heldInBalance: boolean;   // credited to an agent's balance; there was no payout
  duplicate: boolean;       // this exact request had already been done; it was not paid again
  spendId, paypal: { captureId, payoutBatchId, payoutItemId, payoutStatus }, receipt, receiptUrl
};
```

A capture is not a delivery. `PAYOUT_PENDING` means PayPal has the payout and has not finished it.
`UNCLAIMED` means PayPal is holding it because the address has no PayPal account. Use `delivered`
before telling anyone they were paid, and `status(spendId)` later to ask again.

Money set aside (`setAside`) is earmarked, not escrow. Nothing else can spend it while it stands, but
the owner can still close the envelope.

A fingerprint passed to `accept({ work })` records which bytes were referred to. It says nothing
about whether the work is any good.

## Errors

Every failure is an `EnvelopeError`.

| `kind` | Meaning | Useful fields |
|---|---|---|
| `"local"` | Refused before anything was signed or sent: a malformed amount, no envelope held, a split that widens | `codes` |
| `"network"` | The gateway could not be reached | `retryable` is true |
| `"gateway"` | The gateway answered, and what you asked for did not happen | `status` (HTTP), `outcome`, `reasons`, `codes`, `detail`, `body` |

For a refusal on the merits, `outcome` is `"DENIED"` (nothing moved), `"FAILED"` (PayPal could not do
it; nothing was paid) or `"LAPSED"` (the promise had already run out or been released). `reasons`
carries stable codes such as `PAYEE_NOT_ALLOWED`, `OVER_ENVELOPE_LIMIT`, `OVER_PER_PAYMENT`,
`REVOKED`, `NEEDS_OWNER_APPROVAL`, `ACCOUNT_FROZEN`, `OVER_CARD_LIMIT`, `NOT_REFUNDABLE`,
`PAYPAL_REFUND_FAILED`, each with a sentence for people. A payment that was later given back or
recalled reads `REFUNDED_BY_PAYEE` or `RECALLED_BY_OWNER` in its `status()`.

```js
try {
  await agent.pay({ amount: "5.00", payee: "someone-else@example.com", purpose: "design" });
} catch (e) {
  if (e instanceof EnvelopeError && e.denied) console.log(e.codes);   // ["PAYEE_NOT_ALLOWED"]
}
```

**Retries.** When the gateway is unreachable, busy (503) or rate limiting (429), the SDK resends the
identical bytes up to `retries` times (default 2). A signed request that did arrive the first time is
recognised by the gateway and is not carried out twice; the answer then has `duplicate: true`.
`tests/sdk.test.ts` drops the first answer on purpose and checks one payment results.

## Security

What the SDK does:

- Signs with Ed25519 keys through WebCrypto. A key is held off the object: `JSON.stringify(agent)` and
  `console.log(agent)` show the public half only. The private key leaves only through `exportKey()` or
  `export()`, which you call on purpose.
- Sends signatures, never keys. The tests record every request body and check that no private key
  material appears in any of them.
- Verifies before trusting: `hold()` checks a chain locally; receipts, statements and notes are
  checked against the gateway key the client fetched, so a document signed by some other key fails.

What it cannot do:

- Reach PayPal. There is no PayPal credential, endpoint or code path in it.
- Get around the gateway. A request an envelope does not allow can be signed and sent; the gateway
  refuses it. The limits are enforced there, not here, so a modified SDK gains nothing.
- Raise its own authority. No method seals, widens or un-revokes anything with an agent's key.
- Keep your keys safe for you. `export()` returns a private key as JSON; where you put it is up to
  you. The command line writes it to `./.envelope/` with mode 0600, which is demo-grade.

The gateway's own limits (key storage, no timer, sandbox only, no outside review) are in the main
README and `docs/RED_TEAM_REPORT.md`. The SDK does not change them.

## MCP server and command line

Both are thin fronts on the SDK and keep an agent's key and envelope in `./.envelope/`.

```bash
ENVELOPE_AGENT=ops-agent GATEWAY=http://localhost:3000 npx tsx scripts/mcp.ts     # MCP over stdio
claude mcp add envelope -e ENVELOPE_AGENT=ops-agent -- npx tsx scripts/mcp.ts     # in Claude Code
npx tsx scripts/agent.ts pay --as ops-agent --amount 45 --payee a@x --purpose translation
npx tsx scripts/agent.ts refund --as translator <payment id> --memo "cannot take this on"   # by the agent that was paid
```

The MCP server offers 15 tools, each marked with MCP annotations:

| Group | Tools | Annotation |
|---|---|---|
| Read: look and check | `envelope_show`, `envelope_balance`, `envelope_card_list`, `envelope_introduce`, `envelope_check_agent`, `envelope_receipt` | `readOnlyHint: true` |
| Act: reversible or bounded | `envelope_split`, `envelope_promise`, `envelope_card_issue` | `readOnlyHint: false`, `destructiveHint: false` |
| Act: moves money or cannot be undone | `envelope_pay`, `envelope_keep`, `envelope_accept`, `envelope_transfer`, `envelope_refund`, `envelope_card_cancel` | `destructiveHint: true` |

`ENVELOPE_MCP_READ_ONLY=1` serves the read group only. There is no tool to seal, close, revoke or
freeze: those belong to a person. A refusal by the gateway comes back with `isError: true` and the
reason codes in the text. The transport is stdio; there is no HTTP transport.

## Tests

```bash
npx vitest run tests/sdk.test.ts tests/mcp.test.ts
```

- `tests/sdk.test.ts` (19 tests): the SDK against the gateway's real handlers on the PayPal simulator.
- `tests/mcp.test.ts` (13 tests): the MCP server as a separate process over stdio, speaking JSON-RPC
  to a local HTTP gateway, and 34 command-line invocations with their output checked.

These run on the simulator. The example program has also been run against the real PayPal sandbox:
[`evidence/sdk-run.md`](evidence/sdk-run.md). That run predates `refund`, `statement`, `evidence`, `requestApproval` and `sealApproved`,
which have run through the SDK on the simulator only; the refund itself ran on the sandbox through
the gateway's own code (`evidence/sandbox-run.json`).
