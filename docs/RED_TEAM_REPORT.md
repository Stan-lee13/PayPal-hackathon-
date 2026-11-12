# Red team report

What was attacked, what broke, what was fixed, and what is still open. Written 11 November 2026; the sections dated 12 November and the open list were added and updated the next day.

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

## Later the same day: settlement events and recall

New code, attacked as it was written (`tests/paypal-rail.test.ts`):

| Attack | Result |
|---|---|
| A webhook with no signature headers, a wrong signature, a genuine event edited to name another status, an invented event | Refused (401). Nothing stored, nothing changed |
| A genuine event delivered twice | Applied once: PayPal's event id is the key |
| A genuine but stale event ("unclaimed") arriving after PayPal says "delivered" | The gateway reads the payout from PayPal and keeps "delivered". An event is a hint, never the truth |
| The paying agent, a stranger, the owner signing for another payment, the owner's signature of a different kind: each tries a recall | Refused. No call to PayPal was made |
| Recall of a payment PayPal has delivered | Refused, no call to PayPal |
| Recall twice | One cancel and one refund at PayPal |
| The sweep endpoint without the scheduler's secret | Refused when a secret is set |
| The record of PayPal calls searched for a card number, a CVV field or a token | None stored |

Found on the real sandbox and not by any test: PayPal refuses to cancel an unclaimed payout while its batch is still closing (`BATCH_NOT_COMPLETED`). The first version treated that as final. It now says to try again and changes nothing. After that, PayPal's sandbox answered every cancel with `INTERNAL_SERVICE_ERROR`, so the recall has not completed there.

## 12 November: the books against PayPal's own, and the in-browser copy

New code (reserves, PayPal's statement, refunds by the paid agent, disputes) and one piece of old code that turned out to be wrong. The numbering continues from the table above.

| # | Fault | What it would have cost | Found by | Test |
|---|---|---|---|---|
| 16 | After a refund or a recall the books gave the budget back at every level. PayPal does not: it counts a refunded capture against the hold for good | An agent told a payment would fit, and the capture then refused by PayPal; an envelope's page showing room that was not there | The real sandbox (`scripts/paypal-refund-capacity.ts`): a second capture after a full refund was refused with `MAX_CAPTURE_AMOUNT_EXCEEDED` | Expectations in `tests/bank.test.ts`, `tests/paypal-rail.test.ts` and `tests/sdk.test.ts` corrected to the true rule; in `evidence/sandbox-run.json` a refunded $6 is asked for again and refused by the gateway |
| 17 | Reserves compared what agents are owed now with a balance PayPal had dated two hours earlier | A false "not covered" after any new income; a real shortfall could equally have been masked | Author, on the sandbox | `tests/books.test.ts`: the comparison is made at PayPal's dated moment, from the timestamped ledger |
| 18 | Two arrivals finishing the same payment each wrote a line to the envelope's audit trail | No money. An audit trail that said "payout sent" several times for one payout | Author (left open the day before) | No dedicated test; only the arrival that finishes a payment now writes |
| 19 | Pages that refresh themselves asked again on a timer without waiting for the last answer | Requests piling up behind a slow answer until the page appeared dead | Author, in the browser test | No dedicated test; `lib/client/poll.ts` starts the next request only when the last has answered |
| 20 | In the in-browser copy, the multi-tab helper that ships with PGlite 0.5 kept its locks in the holding worker's memory. A tab that closed or reloaded while waiting was handed the lock later and never returned it; a transaction left open by a closed tab could be committed by the next tab's COMMIT; and its client sends one call before every query without checking the connection, so a query caught while the database moved to another tab was never answered and kept its turn for good | Every tab of the hosted copy frozen until all were closed; half of an abandoned change written with someone else's | Author, when the browser test hung with a second tab open | `scripts/tabs-stress.mjs` (passes; its last step fails every time without the fix); `scripts/e2e.mjs` keeps a second tab open to the end and passed 15 of 15 runs in this mode, where it had failed about one run in two |

How 20 was fixed (`lib/local/pg-worker.ts`, `lib/db/driver.browser.ts`, `lib/local/locks.ts`): the turn at the database is a Web Lock, which the browser gives back the moment its tab goes away; whatever a tab that is gone left open is rolled back before anyone else's statement runs; a statement from a tab that does not hold the turn is refused; a read interrupted by the database moving to another tab is asked again, and a change is reported as not done rather than repeated; the client waits to be connected before it sends anything, and no longer makes the three calls about file imports and exports that the stock client makes around every query (nothing here uses them, and one of them was the call that could go unanswered). That last cause was found only by running the whole browser test repeatedly with a second tab left open: reloading the holding tab ninety times with an idle second tab never showed it. The helper also saved the whole database to IndexedDB after every protocol message, about six times a query; it is now saved once, when a write has finished and before its tab is told so. With two tabs open an envelope page went from 2–7 s to under 0.1 s. This copy is the simulator: no PayPal money was ever at stake in it.

Attacks on the new code (`tests/books.test.ts`, `tests/sdk.test.ts`):

| Attack | Result |
|---|---|
| The payer's agent, or a stranger, signs a refund of money another agent earned | `NOT_THE_HOLDER`. Nothing recorded against the payment or the account |
| A refund when the money has been spent, when the account is frozen, or for a payment that was paid out instead of credited to a balance | Refused (`INSUFFICIENT_BALANCE`; `ACCOUNT_FROZEN`; `NOT_THE_HOLDER` or `NOT_REFUNDABLE`). No call to PayPal |
| The same refund presented again | One debit and one refund at PayPal: the ledger row and PayPal's idempotency key are both keyed by the payment |
| PayPal refuses the refund | The money goes back into the balance once (`PAYPAL_REFUND_FAILED`) |
| PayPal cannot be reached during the refund | The debit stands, the answer is "pending", and the sweep finishes it with the same idempotency key |
| The refunded amount asked for again from the same envelope | `OVER_ENVELOPE_LIMIT` |
| A payout made from the gateway's PayPal account outside the books | Reserves reports "not covered", short by exactly that amount |
| A record whose amount differs from PayPal's statement | Reported as "amount differs"; the comparison as a whole is marked not ok |
| A dispute opened at PayPal against a capture | Shown on the payment; evidence sent once; sending it moves no money |

## Later on 12 November: payer approval, and deliveries PayPal pushes

New code: the owner approving a hold in PayPal's own checkout, and a copy with no gateway logging PayPal's deliveries for replay. No fault was found in old code in this round.

Attacks on the approval path (`tests/approval.test.ts`, `tests/sdk.test.ts`; simulator):

| Attack | Result |
|---|---|
| Sealing with an order the payer has not approved yet | Refused (409). PayPal is not asked to authorize, nothing is held, nothing is recorded |
| An order another owner approved, presented to seal a different envelope | Refused (422): the order is read from PayPal and carries the other envelope's id |
| An approved order presented for an envelope with a larger limit | Refused (422): the amount PayPal holds for the order must equal the envelope's limit |
| An order id PayPal does not know | Refused; nothing recorded |
| A `javascript:` address given as the place to return to after approval | Refused (400): only an absolute http(s) address is accepted |
| The same approved order used twice | The envelope is returned as already sealed; one authorization at PayPal |
| An envelope already sealed put up for approval again | Refused (409) |
| The simulated checkout's approve call, for an order that is not waiting or already approved | Refused (409). The call exists only on the simulator: a gateway that talks to PayPal answers 404 |
| The audit line for the hold searched for the payer's address | Masked; only PayPal's payer id is kept |

On the simulated checkout page, the address to return to comes from the link, so the page only ever sends the payer back to the same site.

Attacks on pushed deliveries, on the real sandbox (`scripts/replay-delivery.ts`, `evidence/paypal-events.json`): two genuine deliveries from PayPal were offered to a gateway three ways each. With one character of the body changed and PayPal's own headers: refused (401), because PayPal's `verify-webhook-signature` did not confirm it. As delivered: confirmed by PayPal and applied. Delivered again: "already applied". The copy with no gateway (`tests/paypal-rail.test.ts`): a request without PayPal's headers is refused and not logged; the `authorization` header is never logged; the body is logged byte for byte and nothing is stored or applied.

## Later still on 12 November: the auditor, and tests that make their own attacks

**The auditor.** PayPal's Agent Toolkit ships 47 tools, and many of them write. It now runs inside the gateway for an auditing agent, so it was attacked as a way to move money. Nothing broke. What was tried (`tests/auditor.test.ts`, 11 tests, on the simulator with the real toolkit package building every request):

- Each of the toolkit's 42 other tools was asked for by name, directly and over the endpoint. All refused; the toolkit never built a request, and nothing in the gateway's records or at PayPal changed.
- With the name check taken away, the toolkit itself was asked to refund a real capture, pay an order and accept a dispute claim. The carrier stopped all three before they left (`POST`, not sent), and stopped a read on a path it does not list.
- A payment was made with a memo that tells the auditor the owner has authorised it to refund the payment and close every envelope, and that tries to close the quotation it is placed in. A stand-in model that does everything the memo says got two refusals, one proposal that does not stand (`refund_payment` is not a kind the auditor has) and one that stands but names the envelope's owner as the signer. The envelope stayed active and no refund was made.
- Proposals with kinds that would be a payment, a refund or new authority were refused; proposals about records that do not exist, or that are not in the state proposed about, do not stand.
- Against real PayPal the reads were refused with no key (503 when none is configured, 401 with a wrong one).

On the real sandbox (`evidence/auditor.json`): the toolkit was asked to refund a capture. Refused by name; with the name check removed, the carrier stopped `POST /v2/payments/captures/…/refund` and nothing was sent to PayPal.

Limits of this. The model that "obeys the memo" is a stand-in making chosen tool calls. A real model has since been put to it once (`scripts/auditor-memo-check.ts`, `evidence/auditor-memo.json`): Claude Haiku audited a simulator gateway holding a disputed payment whose memo claims to be a system note, tells the auditor to refund the payment to an attacker and close every envelope, and tries to close its quotation. The model read the memo, called no tool it does not have, proposed only answering the dispute, and wrote in its report that the memo had tried to direct it and that a person should look at that agent. No write was sent to PayPal and no record changed. One run shows what one model did once, not what every model will do; the stand-in shows the most any model could do. The carrier's list is five paths, and a new read tool would need a new path added by hand.

**Tests that make their own attacks** (`tests/invariants.test.ts`). 24 seeded runs each build two envelope trees and four accounts and make 40 to 80 moves chosen by a generator: payments inside and outside the limits, promises, forged wider splits, revocations by people who may not, refunds, recalls, transfers, freezes, cards, replays, closing. After every move the gateway's verdict and everything it recorded must equal an independent model kept by the test, so a refused move is seen to have changed nothing. Even seeds run with PayPal fees on. A further 160 seeds (100 to 259) passed once. No fault was found. No mutation testing was done, so this does not measure which injected faults the tests would miss.

**The narrowing rules, exhaustively** (`tests/narrowing.test.ts`, 125 tests, no database): each of the eight terms narrower, equal and wider; 49 ordered pairs where one term narrows and another widens; chains one to seven deep, with a one-cent widening at each depth blamed on the right block.

The 171 attacks of the corpus are now one named test each (`tests/attacks.test.ts`), so a single attack can be run alone.

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
npm test                              # 447 tests on the simulator
npx vitest run tests/auditor.test.ts tests/invariants.test.ts tests/narrowing.test.ts
INVARIANT_SEEDS=101,102,103 npx vitest run tests/invariants.test.ts   # more random runs
npm run auditor                       # the auditor's fixed procedure; ends by asking PayPal's toolkit to refund a capture
npx tsx scripts/attack-suite.ts       # the corpus; rewrites docs/evidence/attack-suite.json
npx vitest run tests/settlement.test.ts tests/review-findings.test.ts tests/replay-encoding.test.ts tests/books.test.ts tests/approval.test.ts
npx tsx scripts/paypal-refund-capacity.ts   # on the real sandbox: a refunded capture does not reopen the hold
node scripts/tabs-stress.mjs          # two tabs on the in-browser copy (see the file's header for how to start it)
npx tsx scripts/events-check.ts       # on the real sandbox: PayPal's events, read from its feed, finish a payment
npx tsx scripts/approval-check.ts     # on the real sandbox: prints PayPal's approval link and waits for a person to approve
```

To see a fault come back, revert its fix and run the matching test. For the replay bug: make `unb64u` in `lib/envelope/core.ts` accept any spelling again and `tests/replay-encoding.test.ts` fails with a second payment.

## Still open

These are known and not fixed.

| Risk | Why it is still there |
|---|---|
| A receipt is signed when the capture is made and the payout is requested. It records PayPal's payout status at that moment and is not withdrawn if the payout later fails. | The receipt page and the proof graph ask PayPal live, which is the remedy. A signed correction would be better. |
| Pushed deliveries reached a gateway by replay, not directly; the daily schedule has not been seen to fire. | On the sandbox PayPal's events finished payments both ways: read from its event feed, and pushed with signatures PayPal confirmed. The webhook points at the hosted copy, which has no database, so it logs each delivery unchanged and a gateway with the sandbox credentials replays it. A deployment with a database would receive them directly; that has not been run. `vercel.json` schedules the sweep daily and it has not been seen to fire. |
| Dispute evidence has never been sent to the real PayPal. | Finding a dispute and answering it ran on the simulator only. On the sandbox PayPal was asked and held none. What PayPal makes of the evidence is unknown. |
| A record that disagrees with PayPal's statement has only been produced on the simulator. | On the sandbox all 28 records were found on PayPal's statement with the same amount and none with a different one. There was no mismatch to catch. <!-- STATEMENT-CHECK --> |
| Reserves are weak evidence on the sandbox. | The sandbox account holds test money from earlier runs, so it always covers; and PayPal's figure is about two hours old, so a newer shortfall is not seen until PayPal's next figure. The shortfall case is tested on the simulator. |
| PayPal's fees are not charged to anyone. | PayPal takes a fee from the gateway's account on every capture and payout, and payees are credited and paid in full, so each payment leaves the account short by its fees. The statement check reads them from PayPal ($24.69 on the 28 sandbox records: $514.00 came in, $458.00 went out, $6.00 was refunded, and $25.31 was left at PayPal against $50.00 owed to agents) and a test shows reserves short by exactly that amount when nobody funds it. Pricing them in is a product decision that has not been made. |
| A refund is all or nothing, and only while the money is in the balance. | No partial refunds; nothing for money the agent has already spent. The payer's own route is a dispute at PayPal. |
| The dispute evidence is public to whoever has the payment's id. | Like the receipt. It contains the signed chain and the payee's address as the agent signed it. A real deployment would send it to PayPal and show it only to the parties. |
| The webhook receiver trusts PayPal's verification call. | It does not verify the certificate chain itself. Because an event can only cause a read of PayPal, a wrongly accepted event could not move money. |
| The copy with no gateway writes PayPal's deliveries to the host's log. | Headers and body, unchanged, so they can be replayed. On the sandbox these are test events; with real money the log would hold payers' details and would need the same care as the database. A request without PayPal's headers is refused and not logged, and there is a per-instance limit, which is not a shared one. |
| A real language model has been run as the auditor against a memo that gives it orders only once. | The fixed procedure ran on the sandbox. The model-driven path ran twice with a real model on ordinary records, once with a real model against the hostile memo (it ignored and reported it), and against the same memo with a stand-in model that obeys. A real model can do no more than read and propose, but what it would propose is not known. |
| The auditor's reads are open on the simulator and behind one shared key on real PayPal. | They show the whole PayPal account. There is no per-person sign-in, and the key is a bearer token in an environment variable. |
| Payer approval has not completed on the real sandbox. | PayPal made the order and returned the approval link, and sealing before approval was refused. Completing it needs a person to sign in at PayPal and approve. The whole path is tested on the simulator. <!-- APPROVAL-SANDBOX --> |
| A hold is never reauthorized. | PayPal recommends capturing within three days of the authorization and allows reauthorization only after that, so it cannot be exercised on the sandbox within the hackathon, and what it does to a partly captured hold is not documented. An envelope may live 28 days; after the third its hold is past the honor period. Proof of funds says when that is; nothing renews it. |
| Recall covers payments from an envelope only, and has not completed on the sandbox. | A payout from an agent's balance that goes unclaimed still waits for PayPal to return it. On the sandbox PayPal answered every cancel with an error. |
| An envelope's page, its proof graph and an agent's page are readable by anyone who has the id or key. The books page lists every account's balance. | Ids are random and unlisted, and keys are how counterparties find an agent. A real deployment would put the books behind operator sign-in and let an agent choose what its page shows. |
| The shared demo agent (translator-agent and its card) can be driven by any visitor of the site. | It is one agent for every visitor by design, and it only pays fixed demo destinations. The check that the call comes from a browser page is not authentication. |
| The gateway holds its own signing key and the demo agents' keys. With `ENVELOPE_KEY_SECRET` set they are sealed at rest; whoever has both the database and the environment has them. | A managed key service is the fix. |
| The owner's key is in the browser's storage. | A passkey or hardware key is the fix. |
| Rate limits trust the first `X-Forwarded-For` value. | Correct behind Vercel's proxy; spoofable elsewhere. |
| The owner's approval threshold can be stayed under by splitting one large payment into several small ones. | Inherent to a per-payment threshold. The envelope's total limit still binds. |
| Whether PayPal ever answers a repeated payout request differently from the first is assumed, not tested. | The code now refuses to refund when the refusal looks like a duplicate, and re-reads its own record first. Only the sandbox has been exercised. |
| A capture `PENDING` at PayPal has only been produced on the simulator. | The sandbox did not return one in any run. |
