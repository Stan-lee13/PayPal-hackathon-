# Implementation report

What was researched, decided, built and proven in the round of work that ended on 11 November 2026 (pull request #8), and in the two shorter rounds that followed on 12 November (pull request #9, then #10 and #11), each with its own section at the end. Earlier rounds are in the git history and in [`RED_TEAM_REPORT.md`](RED_TEAM_REPORT.md).

## The question this round answered

The owner's concern, in their words: "I only see the use of hold. It makes me feel PayPal isn't needed at all." And the ask: an SDK and MCP of its own, everything connected, fix every defect.

The concern was half right. The gateway already used seven PayPal operations (authorize, read authorization, partial capture, payout, read payout, refund, void), but a visitor could only see the first. So the work had two parts: make what PayPal does visible, and use PayPal for the parts of the lifecycle that were still missing.

## Research

The Orchestra Research skills library was installed as asked (`npx @orchestra-research/ai-research-skills install --all`, 95 skills). It is a library for machine-learning research (training, evaluation, paper writing). Two parts were useful here and were used: the bootstrap-then-decide rhythm of its autoresearch skill, and the ideation frameworks in `brainstorming-research-ideas` (failure analysis, stakeholder rotation, tension hunting). Its experiment loop and paper-writing parts were not applicable and were not run.

### Evidence log

| Question | Source | Checked | Finding | Confidence | What it meant for Envelope |
|---|---|---|---|---|---|
| What does the hackathon require of PayPal? | Devpost page and rules | 11 Nov | "must meaningfully use both PayPal and AI"; "at least one PayPal technology"; Agent Toolkit and MCP are optional links. Technological Implementation asks "how thoroughly and skillfully does the project use PayPal Developer Platform and AI tool(s)". Judges "are not required to test the Project" | High (read directly) | Depth and skill of PayPal use is judged by name. Most judges will see only the video, text and repository |
| How deeply do rivals use PayPal? | Static read of 65 rival repositories | 11 Nov | 34 verify webhooks; 18 use Vault; 18 use Disputes; 15 use JS SDK buttons; 14 use the Agent Toolkit; about 8 use Transaction Search; 7 reauthorize holds; 22 ship their own MCP server; 7 an SDK, mostly generated | Medium (grep, about 20 read in depth, nothing run) | Webhook verification was a gap more than half the field had closed. An SDK is rare |
| Can PayPal's event feed be read without an inbound endpoint? | PayPal docs (`GET /v1/notifications/webhooks-events`) and the sandbox | 11 Nov | The endpoint exists and returned an empty list: this sandbox app has no webhook registered. Registering one from the development session was blocked as an account change | High for what was seen | Built both a push receiver and a pull of the feed. Proven on the simulator. Registration is the owner's step (On 12 November, with a webhook registered, the same call returned real events: see the last section.) |
| How does PayPal verify a webhook? | PayPal schema and docs; one call to the sandbox | 11 Nov | Seven required fields; the event must be passed back exactly as received; a forged event sent to the real sandbox returned `verification_status: FAILURE` | High | The receiver passes the raw body through. The forged-event answer is real evidence the check is wired |
| Can an unclaimed payout be cancelled? | PayPal docs; the sandbox | 11 Nov | Documented: only when `UNCLAIMED`, returns `RETURNED`. On the sandbox: `BATCH_NOT_COMPLETED` while the batch closes, then `INTERNAL_SERVICE_ERROR` on every attempt, over several payout items and three runs (PayPal's debug ids are recorded) | High for what was seen | Recall is built and proven on the simulator. On the sandbox the gateway reports PayPal's refusal and changes nothing. Not claimed as working there |
| What do PayPal's own agent tools give an agent? | PayPal docs, `paypal/agent-toolkit` | 11 Nov | App-wide credentials or an access token; per-tool enablement only; no spending limit, payee restriction or approval | Medium (docs only) | This is the gap Envelope fills. Stated as positioning, not built against |
| Authorization rules | PayPal docs | 11 Nov | 29 days, 3-day honor period; reauthorize once from day 4; over-capture "up to 115% or $75" is account dependent; "Sandbox authorizations don't expire after 29 days" | High | Reauthorization cannot be tested in a day. Left out, and listed as open |

### Choosing the one new capability

Candidates were generated with the ideation frameworks and ranked on three questions: does it make PayPal necessary, can it be proven before the deadline, does it finish something already started rather than start something new.

| Candidate | PayPal necessary? | Provable in time? | Verdict |
|---|---|---|---|
| **Settlement that finishes on PayPal's word** (record of every PayPal call; events verified and applied once; sweep; recall of unclaimed payouts) | Yes: four more PayPal operations, and the existing seven made visible | Record and sweep on the sandbox; events and recall on the simulator | **Chosen.** It closes the largest open item in the red team report ("nothing runs on a timer") |
| Payer-present funding (the owner approves in PayPal's checkout) | Yes | No: needs a sandbox buyer login that must not be typed into a chat | Not built. Listed as open |
| Vault, Disputes, Invoicing, Transaction Search | Yes | Partly | Not built. Each is a new product surface, not a completion of this one |
| A guard in front of PayPal's own MCP server | Yes | Yes | Not built. Two rivals already do it |
| Reauthorizing a hold | Yes | No: needs four days | Not built |

The SDK was asked for outright and does not count against the limit of one.

## What was built

### 1. A record of every PayPal call

`lib/paypal/journal.ts` observes the PayPal client. It records every call that changes something, every refusal, and every read unless it repeats the same answer within a minute (an open page asks often). For each it keeps the operation, PayPal's status and ids, the amount, the idempotency key, PayPal's debug id and the timing. It keeps no request or response body (the sandbox hold request carries a test card number; a test asserts none is stored).

- `GET /api/envelopes/:id/paypal` returns the calls behind one envelope.
- The envelope page shows them as "What PayPal did for this envelope".
- The landing page adds them up from the last recorded sandbox run.
- A request the gateway retries is shown as a repeat and counted once: PayPal returns its first answer to the same idempotency key.

### 2. Events from PayPal

`lib/gateway/settlement.ts`. One rule: an event is a hint, never the truth. Whatever the event says, the gateway finds the payment, transfer or hold it names and reads that record from PayPal by id before changing anything.

- `POST /api/paypal/webhook`: the event is verified with PayPal (`verify-webhook-signature`, raw body passed through), stored under PayPal's event id so it is applied once, then acted on.
- The same events can be pulled from PayPal's own feed, for a deployment with no inbound endpoint.
- If PayPal reports a hold voided while its envelope is open, the envelope closes.
- A capture reversed outside the gateway while its payment stands is flagged on the envelope's audit trail.

### 3. Sweep

`POST /api/sweep` reads the feed, then asks PayPal about every payment and transfer still in flight, and lapses promises that ran out. With `CRON_SECRET` set it requires that secret as a bearer token. (Since the next round it also answers `GET`, is scheduled daily in `vercel.json`, finishes pending refunds and checks disputes.)

### 4. Recall

The owner of an envelope can take back a payout PayPal is holding unclaimed: PayPal cancels the item and the gateway refunds the capture to the owner. Only the owner's signature does it; the paying agent cannot. (As first built, the budget also returned at every level. That was wrong and was corrected in the next round: PayPal does not return a refunded capture to the hold, so the amount now stays used.)

### 5. The SDK

`sdk/` is `@envelope/sdk`: `Gateway`, `Agent`, `Owner`, one `EnvelopeError` with reason codes, amounts as strings, local verification of receipts and notes. One ES module with no dependencies (`npm run sdk:pack`). The MCP server and the command line were rebuilt on it. Guide: [`SDK.md`](SDK.md).

### 6. Product

- A Developers page (`/developers`): SDK, MCP, command line, and what an agent using them cannot do.
- "What PayPal does here" on the landing page, with each capability marked as proven on the sandbox or on the simulator.
- A recall button on unclaimed payments, for the owner.

## Defects found and fixed this round

| # | Severity | Where | Fault | Fix | Test |
|---|---|---|---|---|---|
| 1 | Medium | `lib/gateway/settlement.ts` (new code) | Recall treated PayPal's `BATCH_NOT_COMPLETED` as a final refusal. Found only on the real sandbox | Reported as "try again in a minute", nothing changed | Seen on the sandbox; recorded in `evidence/sandbox-run.json` |
| 2 | Low | `lib/api/handlers.ts` accept | A successful decline answered HTTP 409 while a release answered 200 | A decline that released the money answers 200 | `tests/sdk.test.ts` |
| 3 | Medium | `lib/api/handlers.ts` | Only a paid payment could be looked up; a refused, promised or failed one answered 404 | `GET /api/spends/:id/status` for any payment | `tests/sdk.test.ts` |
| 4 | Low | `scripts/mcp.ts` | A refusal by the gateway was returned to the model as an ordinary result | `isError: true`, same text | `tests/mcp.test.ts` |
| 5 | Low | `lib/gateway/service.ts` closeRoot | A hold PayPal had already voided was logged as a failed release | Logged as information | `tests/paypal-rail.test.ts` |
| 6a | Medium | `lib/api/handlers.ts` envelope read | An envelope page left open asked PayPal about every unclaimed payout every three seconds, for as long as it stayed open | At most twice a minute for a payment that is only waiting; every few seconds only while one is in flight | Timing of the browser test; no dedicated test |
| 6 | Low | `app/developers`, `app/page.tsx` (new) | Code samples made the page scroll sideways on a phone | Grid columns given a zero minimum | Measured in Chromium at 390 px on six pages: no overflow |
| 7 | Low | `app/proof/view.tsx` (earlier the same day) | Lines drawn out of place under CSS zoom | Measurements converted to layout pixels | Screenshot under zoom |

Found and left, with reasons:

- An acceptance signed by the wrong key answers with an error and leaves no record. Deliberate: nothing is recorded against a promise unless its named key signed.
- Card, account and freeze refusals answer with a sentence and no reason code. Cosmetic; the SDK surfaces the sentence.
- The same payout can appear several times as "payout sent" on an envelope's audit trail when its page is polled while it settles. The PayPal record marks these as repeats; the audit trail does not yet.

## Proven, and where

| Thing | Simulator | Real PayPal sandbox |
|---|---|---|
| Record of PayPal calls | `tests/paypal-rail.test.ts` | Yes: `evidence/sandbox-run.json`, `evidence/sdk-run.md` |
| SDK | `tests/sdk.test.ts` (17 then, 19 now) | Yes: `evidence/sdk-run.md` |
| MCP server and command line on the SDK | `tests/mcp.test.ts` (13), real MCP over stdio | The MCP server before the rebuild was driven by a model on the sandbox; not rerun since |
| Sweep | Yes | Yes: ran, found nothing to move |
| Webhook receiver | Yes: genuine, forged, edited, repeated, late | At the end of this round: a forged event was rejected by PayPal and no genuine event had been received. Since 12 November: two genuine pushed deliveries confirmed by PayPal (last section) |
| Event feed | Yes | At the end of this round it returned empty, because no webhook was registered. Since 12 November: seven events about one run read and applied (last section) |
| Recall | Yes | No: PayPal's sandbox refused every cancel |
| Hold voided outside the gateway | Yes | No |

## Numbers

- 101 automated tests passed at the end of this round (63 before it). After the next round: 109. After the one after that: 114. After the last round (the auditor and test depth): 447.
- The attack corpus is unchanged at 171, all refused. New adversarial cases for recall and events are in `tests/paypal-rail.test.ts` so that figure, which the recorded video quotes, stays true.
- Browser test: passes with a server gateway and with the in-browser gateway.

## Not done

- No webhook was registered on the sandbox app at the end of this round, so no real PayPal event had been received. (One was registered on 12 November: last section.)
- Recall has not completed on the sandbox.
- Vault, Disputes, payer-present approval, Transaction Search, Invoicing and reauthorization were not used at the end of this round. More than a dozen rivals use each of the first three. (Disputes and Transaction Search were added in the next round, and payer approval in the one after.)
- The SDK is not published. That needs the owner's decision.
- The video was not re-recorded. The owner asked to say when.

---

## The round after: 12 November 2026 (pull request #9)

### The question

The owner's follow-up: rivals who use more PayPal products will look more integrated, so breadth matters as well as depth; and no open hole that could cost technical marks.

The rule from the round before still applied ("do not add an API merely to increase the number of PayPal integrations"). So each addition had to answer a question the system could not answer before, with PayPal as the only party who could answer it:

| Question nobody but PayPal can answer | PayPal API | What was built |
|---|---|---|
| Is the money agents are owed really there? | Reporting: balances | Reserves |
| Does PayPal's own account statement agree with our records? | Reporting: Transaction Search | Statement match |
| Can an agent that was paid give the money back to the payer? | Captures: refund (already used for failed payouts) | A refund signed by the paid agent |
| Has the payer disputed a payment, and what do we say? | Disputes: list, show, provide evidence | Dispute check, mark and evidence |

Left out again, for the same reasons as before: Vault and payer-present approval (need a buyer login in a browser), Invoicing (a new product surface), reauthorization (needs four days), order tracking. (Payer approval was built later the same day, with PayPal's approval link and no buyer password in the gateway: last section.)

### What was built

1. **Reserves** (`lib/gateway/books.ts`, `GET /api/bank`, the Accounts page). What agents are owed, plus refunds due to owners, against the balance PayPal reports for the gateway's account. PayPal dates its figure (about two hours old on the sandbox), so the comparison is made with what was owed at that moment, summed from the ledger.
2. **Statement match** (`GET /api/bank/statement`, "Compare with PayPal" on the Accounts page, `scripts/statement-check.ts`). Every capture and payout recorded here is looked up by PayPal's transaction id in PayPal's statement of the account: listed, amount differs, or not listed yet.
3. **Refund by the agent that was paid** (`envelope-refund/1`, `POST /api/bank/refund`, `agent.refund()` in the SDK, `refund` on the command line, `envelope_refund` in the MCP server, a button on the agent's page). In full, only while the money is still in its balance: the balance is debited and PayPal refunds the capture to the payer. The payer's side cannot force it.
4. **Disputes** (`lib/gateway/books.ts`, `GET /api/spends/:id/evidence`). Every receipt reconciliation has a seventh check, "PayPal holds no dispute against this capture". The sweep asks PayPal for every dispute against the account, records one that is about a payment made here, and while PayPal is waiting for an answer sends the evidence: the payer's signature on the envelope and every signature between it and the payment. The receipt page shows that evidence.
5. **Settlement on a schedule.** `vercel.json` has Vercel Cron call `/api/sweep` daily. The sweep also finishes refunds PayPal could not be reached for.
6. **The in-browser copy, rebuilt underneath** (`lib/local/pg-worker.ts`, `lib/db/driver.browser.ts`, `lib/local/locks.ts`). See defect 5 below.

### Defects found and fixed

| # | Severity | Where | Fault | Fix | Test |
|---|---|---|---|---|---|
| 1 | High | `lib/gateway/service.ts`, `settlement.ts` | After a refund or a recall the books gave the budget back. PayPal does not: it counts a refunded capture against the hold for good. An agent could have been told a payment would fit and had the capture refused. Found only on the real sandbox (`scripts/paypal-refund-capacity.ts`) | The amount stays used at every level; the root records `refundedMinor`; closing releases limit − captured − refunded | Expectations corrected in `tests/bank.test.ts`, `tests/paypal-rail.test.ts`, `tests/sdk.test.ts`; seen on the sandbox in `evidence/sandbox-run.json` |
| 2 | Medium | `lib/gateway/books.ts` (new code) | Reserves compared today's liabilities with PayPal's hours-old balance and raised a false alarm after any new income | Compared at PayPal's own dated moment, from the timestamped ledger | `tests/books.test.ts` |
| 3 | Low | `lib/gateway/service.ts` settle | Two arrivals finishing the same payment each wrote an audit line (the item left open in the round before) | Only the arrival that finished it writes | No dedicated test; the concurrency tests in `tests/settlement.test.ts` still pass |
| 4 | Medium | Pages that refresh themselves | They asked on a timer without waiting for the last answer, so slow answers piled up | `lib/client/poll.ts`: the next request starts only when the last has answered | Browser test timing; no dedicated test |
| 5 | High, in the in-browser copy only | PGlite 0.5's multi-tab helper | Its locks lived in the holding worker's memory. A tab that closed or reloaded while waiting was handed the lock later and never returned it, freezing every tab; a transaction left open by a closed tab could be committed by the next tab's COMMIT; a call its client makes before every query was sent without checking the connection, so a query caught while the database moved between tabs was never answered. It also saved the whole database to IndexedDB after every protocol message, about six times a query | The locks are Web Locks; an abandoned transaction is rolled back before anyone else's statement; a statement from a tab without the turn is refused; a read interrupted by the database moving tabs is asked again; the client waits to be connected before sending and drops the unused calls; the database is saved once per finished write. With two tabs open an envelope page went from 2–7 s to under 0.1 s | `scripts/tabs-stress.mjs` (passes; its last step fails every time without the fix); `scripts/e2e.mjs` keeps a second tab open to the end and passed 15 of 15 runs in this mode, where it had failed about one run in two |

### Proven, and where

| Thing | Simulator | Real PayPal sandbox |
|---|---|---|
| Refund by the paid agent | `tests/books.test.ts`, `tests/sdk.test.ts`, browser test | Yes: capture `1XG96277EH6264408`, refund `4C249901ET649933V`, capture read back `REFUNDED` |
| A refund does not reopen the hold | The gateway's own arithmetic refuses the next payment (tests) | Yes: authorization `0E653354WJ396544C`, refund `3FW098456W852262F`, second capture refused `MAX_CAPTURE_AMOUNT_EXCEEDED`; and in the main run a further $6 refused by the gateway |
| Reserves | Yes, including a shortfall | Yes for the reading: $6114.08 as of 22:29:59 UTC on 11 November, covered. The account holds old test money, so this shows the call works, not that a shortfall would be caught there |
| Statement match | Yes, including an amount that differs | Yes: all 28 records listed with the same amount, none with a different one; PayPal's fees read from the lines ($24.69) <!-- STATEMENT-CHECK --> |
| Disputes | Yes: found, marked, answered once | Asked only: PayPal held none |
| Scheduled sweep | n/a | The sweep ran from the script. The schedule has not been seen to fire |
| Two tabs on the in-browser copy | `scripts/tabs-stress.mjs` | n/a (that copy is a simulator) |

### Numbers

- 109 automated tests pass (101 before this round): 7 in `tests/books.test.ts` are new, and one more in `tests/sdk.test.ts`.
- PayPal's fees. The first real statement showed what the books had left out: PayPal charges the gateway's account on every capture and payout, and payees are credited in full. The statement check now reads the fee on each line and reports what the listed records left at PayPal; payouts from agents' balances are matched by the transfer id PayPal prints on the line, and refunds by their own id. Nothing charges the fees to anyone yet; that is said in the README's limits.
- The attack corpus is unchanged at 171, all refused.
- The MCP server has fifteen tools (six read, nine act); `envelope_refund` is the new one.
- Nine migrations.
- Last sandbox run: 53 PayPal calls recorded behind three envelopes: 3 holds, 7 partial captures, 5 payouts, 1 refund, 3 releases, 26 reads, 8 refused cancels.

### Not done

- At the end of this round no webhook was registered on the sandbox app, so no genuine PayPal event had been received. (Done later the same day: last section.)
- Recall still has not completed on the sandbox.
- On PayPal's real statement all 28 records were matched; a record that disagrees has only been produced on the simulator. <!-- STATEMENT-CHECK -->
- No dispute evidence has been sent to the real PayPal.
- Partial refunds; a refund of money that has already left the balance; recall for payouts made from a balance.
- Vault, payer approval in PayPal's checkout, Invoicing, order tracking and reauthorization. (Payer approval was built later the same day.)
- The SDK is not published, and the video has not been re-recorded: it predates this round.

---

## Later on 12 November 2026 (pull requests #10 and #11)

### What prompted it

The owner registered a webhook for the sandbox app (`25W82274K7440843K`, all events, pointing at the hosted copy), asked for a fresh look at rivals, and asked that the features be one connected system and not a pile.

A sweep of GitHub (Devpost's gallery is not published) found that every one of the twelve strongest entries seen lets the payer approve in PayPal, and that one of them, Writ, describes a delegation tree sharing one hold. Details and limits of that reading: [`COMPETITIVE_INTELLIGENCE.md`](COMPETITIVE_INTELLIGENCE.md).

### What was built

1. **PayPal's events on the real sandbox, from its feed** (`scripts/events-check.ts`, `evidence/paypal-events.json`). A $30 hold (`7WY24032LA280193S`), an $8 payment left as PayPal first reported it, a $6 payment given back. PayPal published seven events about the run; the gateway read them from the feed and applied each once; a `PAYMENT.CAPTURE.COMPLETED` event made it read the payment from PayPal, which took it from `PAYOUT_PENDING` to `PAID`; the same feed read again applied nothing; the void was confirmed by `PAYMENT.AUTHORIZATION.VOIDED`.
2. **A copy with no gateway logs deliveries for replay** (`lib/api/relay.ts`, `scripts/replay-delivery.ts`). The webhook points at the hosted copy, which has no database and so cannot apply an event. It used to answer a bare 503. It now writes each delivery to the host's log unchanged (PayPal's headers, the body in base64) and still answers 503, because the event was not applied. A logged delivery can be replayed to a gateway with the sandbox credentials, where it is verified with PayPal like any other.
3. **A pushed delivery verified by its signature, on the sandbox.** A real $7 payment (hold `2PE77716P0344103R`, payment `sp_ohYDQ-B4EaybPnzU`) was left at `PAYOUT_PENDING`. Two of PayPal's deliveries about it were taken from the host's log and replayed. PayPal's `verify-webhook-signature` confirmed each as sent and refused the same headers with one character of the body changed (401). `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` took the payment to `PAID`; `PAYMENT.PAYOUTSBATCH.SUCCESS` left it there; each delivered again was "already applied".
4. **The payer approves the hold in PayPal's own checkout** (`askApproval` and `registerRoot` in `lib/gateway/service.ts`; `requestHoldApproval`, `getOrder`, `authorizeApprovedOrder` in `lib/paypal/payments.ts`; `POST /api/envelopes/approval`; the console's second button; `owner.requestApproval` and `owner.sealApproved` in the SDK; a simulated checkout page at `/sim/paypal`). Asking for approval checks the envelope as sealing will, has PayPal make an order carrying the envelope's id and whole limit, and returns PayPal's link. Nothing is held or recorded. Sealing then reads the order from PayPal and refuses it unless it was made for this envelope, for this amount, with intent AUTHORIZE, and is approved; only then is the hold placed on it.
5. **PayPal's honor period in proof of funds** (`honorPeriodEnds` in `lib/gateway/service.ts`). A statement of standing carries when PayPal's three-day honor period ends and when the 29-day authorization ends, signed with the rest; the agent page, the envelope page, the command line and the MCP tool show them.
6. **Pages that lead to each other.** A line of PayPal's statement opens the receipt of its payment; a ledger entry opens its receipt; the PayPal panel, the treasury, a receipt and an agent's balance lead to the books; the treasury leads to each envelope's proof graph; an envelope leads to its owner's treasury.

### Decided against, and why

| Not built | Why |
|---|---|
| Hold reauthorization (7 of the 12 rivals) | PayPal allows it only once the three-day honor period is over, so it cannot be exercised on the sandbox before the deadline, and what it does to a hold that has been partly captured is not documented. Building it would have meant guessing. Proof of funds now says when the honor period ends, which is the honest half of the same question |
| PayPal's Agent Toolkit (7 of 12) | It gives an agent PayPal API access through credentials its runtime holds. Agents here hold a signed envelope and never a PayPal credential; that is the point of the design. (Reversed in part in the next round: the toolkit is now used, read-only, by an auditor on the operator's side. See the last section) |
| Vault (7 of 12) | It follows from payer approval (save the approved account for the next envelope) and would be the next thing to build. There was not time to prove it |
| Order tracking, Login with PayPal, Invoicing | No question in this product that only they answer |
| An AG Grid ledger (a sponsor prize, 10 of 12) | A separate prize; not what the entry is about |

### Proven, and where

| Thing | Simulator | Real PayPal sandbox |
|---|---|---|
| PayPal's events from its feed | `tests/paypal-rail.test.ts` | Yes: `evidence/paypal-events.json`, seven events, one settled a payment |
| A pushed delivery verified by signature | Same tests: genuine, forged, edited, unsigned, repeated, late | Yes, by replay from the hosted copy's log: two confirmed, the same two edited refused. Not delivered to a gateway directly |
| Delivery log of a copy with no gateway | One test: byte for byte, no `authorization` header logged, a stranger refused | The hosted copy logged PayPal's real deliveries, which is where the two above came from |
| Payer approval | `tests/approval.test.ts` (3), one SDK test, the browser test in both modes | Order made (`PAYER_ACTION_REQUIRED`), link returned, sealing before approval refused. A person's approval is pending <!-- APPROVAL-SANDBOX --> |
| Honor period in proof of funds | `tests/gateway.test.ts` | Not run there; it is arithmetic on the expiry PayPal reports |

### Numbers

- 114 automated tests pass (109 before): three in `tests/approval.test.ts`, one more each in `tests/sdk.test.ts` (19) and `tests/paypal-rail.test.ts` (9), and the honor-period assertions in `tests/gateway.test.ts`.
- The attack corpus is unchanged at 171, all refused.
- The MCP server still has fifteen tools.

### Not done

- Payer approval has not completed on the sandbox: it waits for a person. <!-- APPROVAL-SANDBOX -->
- The pushed deliveries reached a gateway by replay, not directly: the hosted copy has no database. The gateway trusts PayPal's verification call and does not check the certificate chain itself.
- Recall still has not completed on the sandbox, and no dispute evidence has been sent to the real PayPal.
- Hold reauthorization, Vault, order tracking, Login with PayPal, Invoicing.
- The video has not been re-recorded: it predates the last three rounds.

## The round after that: the auditor, test depth, a guided tour (12 November)

### What was asked

Three things. Why PayPal's Agent Toolkit had been ruled out, when agents are meant to be the main users of the product. Why rivals still had many more tests. And a path a judge can follow without reading anything.

### The decision on the toolkit

"No place in the design" was too strong. The toolkit, out of the box, gives a model PayPal credentials and 47 tools, among them `create_order`, `pay_order` and `create_refund`. That is the arrangement Envelope replaces for agents that spend, and that part of the earlier decision stands: no spending agent is given it. But there is a job on the operator's side that only reads: checking what the spending agents did. That is where the toolkit fits.

### What was built

1. **The toolkit inside the gateway, cut down to reading** (`lib/paypal/toolkit.ts`). Five tools: `list_transactions`, `list_disputes`, `get_dispute`, `get_order`, `get_refund`. Three restrictions that do not depend on the model or on the toolkit's own configuration: it is given a placeholder token and no credential, and every request it builds is carried by the gateway's one PayPal client; any other tool is refused by name before the toolkit is called; and the carrier sends only `GET`s on five listed paths. The toolkit's hard-coded host (`api.sandbox.paypal.com`) is never contacted; requests go through the gateway's client to `api-m.sandbox.paypal.com`.
2. **The auditor's reads and the check on its proposals** (`lib/gateway/auditor.ts`). Four reads of the gateway's records (`envelope_books`, `envelope_statement`, `envelope_unsettled`, `envelope_payment`) and `checkProposal`: four kinds (answer_dispute, recall_payout, close_envelope, freeze_account), judged against the records by rule. The reason text is not read. The answer names who would have to sign: the envelope's owner, the agent's owner, or the gateway's sweep.
3. **Two ways to run it over the same tools** (`lib/ai/auditor.ts`): a model decides what to read (`/api/ai/audit` gives it the tool list), or a fixed procedure does when no model is connected.
4. **Three fronts**: the `/auditor` page, which also runs in the in-browser copy with the toolkit package in the tab; a terminal (`npm run auditor`, `-- --model`, `-- --evidence FILE`); and MCP (`ENVELOPE_ROLE=auditor npm run mcp`, ten tools, no agent key). Endpoints: `GET /api/auditor`, `POST /api/auditor/read`, `POST /api/auditor/check`, and, on the simulator only, `POST /api/demo/dispute`. Against real PayPal the reads need `AUDITOR_SECRET`; with none configured the auditor answers 503.
5. **Test depth.** Each of the 171 attacks is its own named test. 24 seeded runs make 40 to 80 random moves over two envelope trees and four accounts and check the gateway against an independent model after every move, even seeds with PayPal fees on. A matrix covers each of the eight terms narrower, equal and wider, 49 ordered pairs, and chains one to seven deep.
6. **A guided tour** (`components/tour.tsx`, `/?tour=1`): seven steps, each advanced by the gateway's records or the page, not a timer.

### Proven, and where

| Thing | Simulator | Real PayPal sandbox |
|---|---|---|
| The toolkit's reads agree with the gateway's own reader | `tests/auditor.test.ts` | Yes, by the fixed procedure: 482 settled and 84 pending transactions read; of 34 records, 28 listed with the same amount (6 not listed yet) and all 28 found again through the toolkit. `evidence/auditor.json` |
| A toolkit write is stopped | All 42 other tools refused by name; with the name check removed, the carrier stops `create_refund`, `pay_order` and `accept_dispute_claim` | Yes: `create_refund` refused by name, and stopped at the wire with nothing sent |
| Proposals | Stand or fall on the records; unknown kinds refused | Five recall proposals for unclaimed payouts stand; each takes the envelope's owner. None was carried out |
| A dispute the gateway has not heard of | Found through the toolkit, proposed, answered by the sweep, gone from a second audit (tests, and the browser test on the in-browser copy) | No: the sandbox holds no dispute against this account |
| A memo that gives the auditor orders | A model that obeys it gets two refusals and one proposal naming the owner; nothing changes | Not run |
| A real language model running the audit | No. Tests use a stand-in model that makes chosen tool calls | No. No model key was available |
| The tour | `scripts/tour-check.mjs` on the in-browser copy | Not applicable |

### Numbers

- 447 automated tests in 17 files pass in about 93 seconds (114 before): `attacks` 172, `narrowing` 125, `invariants` 25, `auditor` 11, `mcp` 14, and the rest unchanged.
- 160 further random seeds (100 to 259) passed once. No mutation testing was done, so there is no measure of what an injected fault would escape.
- The attack corpus is unchanged at 171, all refused; `scripts/attack-suite.ts` reports the same.
- The MCP server has fifteen tools as an agent and ten as an auditor.

### Considered and not built

- **PayPal's Cryptocurrency On/Off Ramp.** Switched on for the sandbox app. A partner service in which a person buys or sells crypto on PayPal's pages; `GET /v1/crypto/configurations` answered and nothing else was called. It does not fit an agent paying from a hold. See `FINANCIAL_FRONTIER_ROADMAP.md`.
- **Sponsor tools.** None is used: AG Grid, APIMatic's context plugin, Bryntum, Channel3, Render.
- Hold reauthorization, Vault, order tracking, Login with PayPal and Invoicing remain not built.

### Not done

- The model-driven audit has not been run with a real language model.
- On a server gateway that has `CRON_SECRET` set, the auditor page's "Run the gateway's sweep now" button cannot run the sweep: the gateway answers 401 and the page says the scheduler will answer the dispute on its next run.
- The auditor has one shared operator key against real PayPal, and no per-person sign-in.
- The video predates this round too.
