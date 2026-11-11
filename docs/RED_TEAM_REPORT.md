# Red team report

What was attacked, what broke, what was fixed, and what is still open. Written 11 November 2026.

Three sources:

1. **The attack corpus** (`tests/attack-corpus.ts`): 171 scripted attacks in eleven categories, run against the gateway on the PayPal simulator. Result file: [`evidence/attack-suite.json`](evidence/attack-suite.json).
2. **The author's own review**, which found the replay bug and reproduced four settlement and privacy faults named in a brief.
3. **An independent reviewer** (a separate AI agent given the money code read-only and told to break it), whose findings were each checked against the code before being acted on.

No human security professional has reviewed this code. Treat everything below as the work of the people who built it.

## What actually broke

Every item here was a real fault in code that had been called finished. Each now has a regression test.

| # | Fault | What it would have cost | Found by | Test |
|---|---|---|---|---|
| 1 | A paid request sent again with its signature re-encoded (base64 padding, the other alphabet, a space, spare bits) was treated as new and paid again | A second payment to the same payee, inside the envelope's limits, within five minutes | Author | `tests/replay-encoding.test.ts` |
| 2 | Eight copies of one request arriving together recorded the capture six times in the envelope's books | No money (PayPal captured once), but the owner's books showed $150 captured for a $25 payment | Brief, reproduced | `tests/settlement.test.ts` |
| 3 | A capture PayPal returned as `PENDING` was paid out at once | A payout from the gateway's balance against money that might never arrive | Brief, reproduced | same |
| 4 | When PayPal refused a payout and then refused the refund, the books said nothing was captured and the budget was freed | The owner charged with no record of it; the same budget spendable again | Brief, reproduced | same |
| 5 | Anyone who knew an owner's public key could read that owner's treasury | Disclosure of every envelope, agent, payee and amount | Brief, reproduced | same |
| 6 | Anyone who knew an envelope's id could drive its built-in demo agents, and a list of all envelope ids was public | Spending a stranger's demo envelope up to its limits; to the attacker's own address if the envelope allowed any payee | Reviewer | `tests/review-findings.test.ts` |
| 7 | Sealing a new envelope with another envelope's id as its "draft" moved that envelope's demo agents to the new one | Taking over a stranger's demo agents | Reviewer | same |
| 8 | Requests nobody had really signed were stored as refusals against whatever envelope, account or card they named | Padding a victim's signed record with refusals; pushing real payments off their pages; hiding approvals | Reviewer | same. A refusal is now kept only when the request is signed by the envelope's holder and every block of its chain is really signed back to the sealed root; a holder who signs a wider envelope for a helper still leaves a record |
| 9 | A withdrawal PayPal refused came back as a reversal that made room under the daily limit | Spending past the owner's daily limit, repeatedly | Reviewer | same |
| 10 | A timestamp that did not parse passed every freshness check | A signer could make a request that never expired | Reviewer | same |
| 11 | A payment admitted but not yet captured went ahead after its envelope was revoked | A payment the owner had tried to stop | Reviewer | same |
| 12 | Payments left `UNCLAIMED`, with a refund due, or with a capture pending were never looked at again | An owner left charged for a payout PayPal had returned; an envelope that could not be closed | Reviewer | handler change; see "open" below for the limit |
| 13 | If the void failed when an envelope was closed, closing again did nothing | A hold left on the owner's funding source for up to 29 days | Reviewer | code change, not separately tested |
| 14 | Receipts and transfer receipts published the owner's full PayPal address | Disclosure | Reviewer | updated assertions in `tests/accounts-promises.test.ts`, `tests/bank.test.ts` |
| 15 | Amounts above 2³¹ caused a server error instead of a refusal | None (the transaction rolled back) | Reviewer | refused by the core now |

Smaller changes made on the reviewer's advice without a dedicated test: a second root with an id already sealed is refused; a hold that cannot be recorded is voided; account openings are decided under the account's lock; the write that updates a payout's status is guarded; a refusal of a payout request is no longer taken as proof that no payout exists; a reversed card charge gives the charge back but not the waiting period.

## What was tried and held

From the attack corpus, all refused with no capture or payout caused:

| Category | Cases | Examples |
|---|---|---|
| Forged wider envelope | 15 | A child signs itself more money, more payees, a later expiry, more splits |
| Tampered chain | 14 | Reordered, truncated or substituted blocks; a block from another envelope; a forked block |
| Bad request | 26 | Wrong key, edited amount or payee, stale, replayed (including four re-encodings), nonsense amounts |
| Budget | 9 | Overspending an envelope, an ancestor, the hold; twenty agents racing one budget |
| Cross-use | 6 | An introduction, promise or revocation presented as a payment |
| Promise | 29 | Paying a promise twice, after it lapsed, by the wrong key; dodging the owner's approval threshold |
| Account | 5 | Pointing someone's account at another address; replaying an old opening |
| Forged evidence | 7 | Edited receipts and statements of standing; proof of funds for the wrong payee |
| Balance | 27 | Forged, edited, replayed and racing transfers; cap, freeze and owner-swap bypasses |
| Card | 25 | Wrong merchant, overcharge, too soon, too many, after cancel or expiry; widening a signed card |
| Books | 8 | The settlement and treasury faults above, as attacks |

From the reviewer's notes, areas examined with nothing found: the approval threshold through sub-envelopes, promises, cards and balances; the promise lifecycle under concurrent close and revoke; lock ordering (no nesting of root and account locks; account pairs sorted); signature domains (no message of one kind accepted as another); overdraw, double credit and freeze replay on balances; exposure of private keys through any endpoint.

## Reproducing

```bash
npm test                              # 63 tests on the simulator
npx tsx scripts/attack-suite.ts       # the corpus; rewrites docs/evidence/attack-suite.json
npx vitest run tests/settlement.test.ts tests/review-findings.test.ts tests/replay-encoding.test.ts
```

To see a fault come back, revert its fix and run the matching test. For the replay bug: make `unb64u` in `lib/envelope/core.ts` accept any spelling again and `tests/replay-encoding.test.ts` fails with a second payment.

## Still open

These are known and not fixed.

| Risk | Why it is still there |
|---|---|
| A receipt is signed when the capture is made and the payout is requested. It records PayPal's payout status at that moment and is not withdrawn if the payout later fails. | The receipt page and the proof graph ask PayPal live, which is the remedy. A signed correction would be better. |
| Nothing runs on a timer. Unfinished payments advance when their envelope is opened or their status is asked for. PayPal webhooks are not consumed. | A scheduled job or a verified webhook handler is the fix. Not built. |
| An envelope's page, its proof graph and an agent's page are readable by anyone who has the id or key. The books page lists every account's balance. | Ids are random and unlisted, and keys are how counterparties find an agent. A real deployment would put the books behind operator sign-in and let an agent choose what its page shows. |
| The shared demo agent (translator-agent and its card) can be driven by any visitor of the site. | It is one agent for every visitor by design, and it only pays fixed demo destinations. The check that the call comes from a browser page is not authentication. |
| The gateway holds its own signing key and the demo agents' keys. With `ENVELOPE_KEY_SECRET` set they are sealed at rest; whoever has both the database and the environment has them. | A managed key service is the fix. |
| The owner's key is in the browser's storage. | A passkey or hardware key is the fix. |
| Rate limits trust the first `X-Forwarded-For` value. | Correct behind Vercel's proxy; spoofable elsewhere. |
| The owner's approval threshold can be stayed under by splitting one large payment into several small ones. | Inherent to a per-payment threshold. The envelope's total limit still binds. |
| Whether PayPal ever answers a repeated payout request differently from the first is assumed, not tested. | The code now refuses to refund when the refusal looks like a duplicate, and re-reads its own record first. Only the sandbox has been exercised. |
| A capture `PENDING` at PayPal has only been produced on the simulator. | The sandbox did not return one in any run. |
