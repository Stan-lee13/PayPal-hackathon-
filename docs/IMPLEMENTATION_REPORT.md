# Implementation report

What was researched, decided, built and proven in the round of work that ended on 11 November 2026 (pull request #8). Earlier rounds are in the git history and in [`RED_TEAM_REPORT.md`](RED_TEAM_REPORT.md).

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
| Can PayPal's event feed be read without an inbound endpoint? | PayPal docs (`GET /v1/notifications/webhooks-events`) and the sandbox | 11 Nov | The endpoint exists and returned an empty list: this sandbox app has no webhook registered. Registering one from the development session was blocked as an account change | High for what was seen | Built both a push receiver and a pull of the feed. Proven on the simulator. Registration is the owner's step |
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

`POST /api/sweep` reads the feed, then asks PayPal about every payment and transfer still in flight, and lapses promises that ran out. With `CRON_SECRET` set it requires that secret as a bearer token.

### 4. Recall

The owner of an envelope can take back a payout PayPal is holding unclaimed: PayPal cancels the item, the gateway refunds the capture, and the budget returns at every level. Only the owner's signature does it; the paying agent cannot.

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
| SDK | `tests/sdk.test.ts` (17) | Yes: `evidence/sdk-run.md` |
| MCP server and command line on the SDK | `tests/mcp.test.ts` (13), real MCP over stdio | The MCP server before the rebuild was driven by a model on the sandbox; not rerun since |
| Sweep | Yes | Yes: ran, found nothing to move |
| Webhook receiver | Yes: genuine, forged, edited, repeated, late | A forged event was rejected by PayPal. No genuine event has been received |
| Event feed | Yes | Returned empty: no webhook is registered |
| Recall | Yes | No: PayPal's sandbox refused every cancel |
| Hold voided outside the gateway | Yes | No |

## Numbers

- 101 automated tests pass (63 before this round).
- The attack corpus is unchanged at 171, all refused. New adversarial cases for recall and events are in `tests/paypal-rail.test.ts` so that figure, which the recorded video quotes, stays true.
- Browser test: passes with a server gateway and with the in-browser gateway.

## Not done

- No webhook is registered on the sandbox app, so no real PayPal event has been received.
- Recall has not completed on the sandbox.
- Vault, Disputes, payer-present approval, Transaction Search, Invoicing and reauthorization are not used. More than a dozen rivals use each of the first three.
- The SDK is not published. That needs the owner's decision.
- The video was not re-recorded. The owner asked to say when.
