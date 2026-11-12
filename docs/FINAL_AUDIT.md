# Final audit

The state of the entry on 12 November 2026, on branch `ccr-8487dcc7-qzxc0i` (pull request #11; pull requests #8, #9 and #10 are merged). The Devpost deadline is 12 November 2026, 12:00 pm PST (20:00 UTC, 9:00 pm in Lagos). The rules say that after the deadline nothing may be touched: no commits, no README edits.

Every line marked "ran" or "pass" was run on this branch; where a check was last run before the final changes, the line says so. What was built in the last three rounds, and how it was decided, is in [`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).

## Verdict

**Go, once the owner has done the steps under "Only the owner can do these".** The product works end to end on the real PayPal sandbox and on the hosted simulator. Two things are proven on the simulator only and are labelled that way everywhere: recalling an unclaimed payout (PayPal's sandbox answers every cancel with a server error), and finding and answering a dispute (the dispute calls themselves ran on the sandbox, and PayPal had nothing disputed). A third is half done: the owner approving the hold in PayPal's own checkout runs end to end on the simulator, and on the sandbox it has got as far as PayPal's approval link, waiting for a person to approve. <!-- APPROVAL-SANDBOX --> PayPal's own statement was matched on the sandbox: all 28 records listed with the same amount, none with a different one. That statement also shows what the books did not: PayPal's fees ($24.69 on the listed records), which fall on the gateway's operator and are not priced in. PayPal's own events finished payments on the sandbox, read from its feed and pushed with signatures PayPal confirmed. <!-- STATEMENT-CHECK -->

## Architecture in one picture

```
 A person (key in their browser)          Agents (each with its own key)
        │ seals, approves, recalls, closes        │ split, pay, set aside, accept, transfer, issue cards
        ▼                                         ▼
   Pages (Next.js)                         SDK  →  MCP server, command line
        └───────────────┬─────────────────────────┘
                        ▼
              lib/api/handlers.ts            one function per endpoint; runs on a server or in a browser tab
                        │
   ┌────────────────────┼─────────────────────────────┐
   ▼                    ▼                             ▼
 service.ts          bank.ts, books.ts          settlement.ts
 envelopes,          balances, transfers,       what PayPal did, recall,
 payments, promises  cards, refunds, the books  PayPal events, sweep
                     against PayPal's own
   └────────────────────┼─────────────────────────────┘
                        ▼
        lib/envelope/core.ts   signatures and rules; no database; the same file everywhere
        lib/paypal/            client, payments, journal of calls, simulator
        lib/db/                Postgres, or Postgres-in-WebAssembly in the browser
                        ▼
                     PayPal    payer approval · hold · partial capture · payout · void · refund · cancel · events
                               · reported balance · statement · disputes
```

The only component that holds PayPal credentials is the gateway. No model output is read by any file that moves money.

## Checks

| Check | Result | How it was run |
|---|---|---|
| Type check | Pass | `npx tsc --noEmit` |
| Production build | Pass | `next build` |
| Automated tests | 447 of 447 pass, in 17 files, in about 93 seconds | `npm test`, PayPal simulator, local Postgres. 172 are the attack corpus, one test an attack plus a check that each ran once; 25 are seeded random runs checked against an independent model after every move; 125 are the narrowing matrix; 11 are the auditor. No mutation testing was done |
| Attack corpus | 171 of 171 refused, none moved money | `npx tsx scripts/attack-suite.ts` |
| Browser test, server gateway | Pass, including the payer-approval step and the auditor step (a refund tool refused, a staged dispute found through the toolkit, the proposal, the sweep, a second audit). `scripts/tour-check.mjs` also passed in this mode | `scripts/e2e.mjs` in Chromium on the simulator, with a second tab open to the end |
| Browser test, in-browser gateway | Pass with the auditor step (refused a refund tool, a staged dispute found through PayPal's toolkit, the proposal standing, the sweep answering it, a second audit no longer proposing it). Before that step: 3 of 3 runs with the payer-approval step, and 15 of 15 on the code before it | the same script with no database: the mode the hosted copy runs in. Before the fix to tab sharing it failed about one run in two with a second tab open |
| Guided tour, in-browser gateway | Pass | `scripts/tour-check.mjs`: from the landing page, pressing only what the strip rings; seven steps, remembered across a reload, ended |
| Two tabs, in-browser gateway | Pass | `scripts/tabs-stress.mjs`: reloads, closes, the tab holding the database going away, the database moving mid-request. Its last step fails every time without the fix |
| Phone width | No sideways scroll on six pages at 390 px | measured in Chromium; not tried on a phone |
| Real PayPal sandbox, scripted | Ran on 12 November | `scripts/sandbox-run.ts`; `evidence/sandbox-run.json` |
| Real PayPal sandbox, PayPal's events | Ran on 12 November | `scripts/events-check.ts`, `scripts/replay-delivery.ts`; `evidence/paypal-events.json` |
| Real PayPal sandbox, payer approval | Started on 12 November; waiting for a person to approve at PayPal <!-- APPROVAL-SANDBOX --> | `scripts/approval-check.ts` |
| Real PayPal sandbox, from the SDK | Ran on 11 November, before refunds were added to the SDK | `examples/hire-an-agent`; `evidence/sdk-run.md` |
| Real PayPal sandbox, in a browser with a real model | Ran on 11 November, two rounds ago | the recorded video; `evidence/model-run.md` |

## PayPal

| Capability | State |
|---|---|
| Authorize, read authorization, partial capture, payout, read payout, void | Ran on the sandbox on 12 November. The hold was placed on PayPal's sandbox test card, with no payer present |
| The payer approves the hold in PayPal's checkout (order with a PayPal payment source, read order, authorize order) | Simulator for the whole path: three tests, an SDK test, the browser test in both modes. On the sandbox PayPal made the order (`PAYER_ACTION_REQUIRED`) and returned its `payer-action` link, and sealing before approval was refused; a person's approval is pending <!-- APPROVAL-SANDBOX --> |
| PayPal's honor period in proof of funds | A statement of standing carries the end of PayPal's three-day honor period and of the 29-day authorization, signed with the rest. Computed from the expiry PayPal reports; one test |
| Record of PayPal calls | Ran on the sandbox: 53 calls behind three envelopes in the scripted run (3 holds, 7 partial captures, 5 payouts, 1 refund, 3 releases, 26 reads, 8 refused cancels), each with PayPal's debug id |
| Sweep of unfinished payments | Ran on the sandbox from the script: 8 checked, none to move. Scheduled daily in `vercel.json`; the schedule has not been seen to fire |
| Refund of a capture, by the agent that was paid | Ran on the sandbox: capture `1XG96277EH6264408`, refund `4C249901ET649933V`, read back `REFUNDED` |
| Refund of a capture after a failed payout | Simulator only: no sandbox payout failed |
| Reported balance (reserves) | Ran on the sandbox: $6114.08 as of 22:29:59 UTC on 11 November, covered. The account holds old test money, so this proves the reading, not that a shortfall would show there |
| Transaction Search (statement) | Matched on the sandbox: 251 lines read, all 28 of our records listed with the same amount, none with a different one. PayPal's fee read from each line: $24.69 on the listed records. An amount that differs is caught on the simulator only <!-- STATEMENT-CHECK --> |
| Disputes | Asked on the sandbox: none held. Finding one and sending evidence: simulator only |
| Cancel of an unclaimed payout (recall) | Simulator only. On the sandbox PayPal answered `BATCH_NOT_COMPLETED`, then `INTERNAL_SERVICE_ERROR` on every attempt |
| Webhook verification | Ran on the sandbox: two genuine pushed deliveries about a real $7 payment (hold `2PE77716P0344103R`) were confirmed by PayPal's `verify-webhook-signature`; the same two with one character of the body changed were refused; one of them took the payment from `PAYOUT_PENDING` to `PAID`; each delivered again was "already applied". They reached the gateway by replay from the hosted copy's log, not directly, because that copy has no database. The gateway trusts PayPal's verification call and does not check the certificate chain itself |
| Event feed | Ran on the sandbox with webhook `25W82274K7440843K` registered: seven events about one run (hold `7WY24032LA280193S`) were read and applied once each; one took a payment from `PAYOUT_PENDING` to `PAID`; the same feed read again applied nothing; the void was confirmed by its own event |
| PayPal's Agent Toolkit, read tools | Ran on the sandbox by the auditor's fixed procedure: 482 settled and 84 pending transactions and the dispute list (none) read through the toolkit; of the gateway's 34 records in 72 hours, 28 were on PayPal's statement with the same amount (6 not listed yet) and all 28 were found again through the toolkit; five recall proposals stand, each for the envelope's owner to sign; a refund the toolkit was asked to make was refused by name and, with that check removed, stopped at the wire with nothing sent (`evidence/auditor.json`). A dispute found and answered, and a memo that gives the auditor orders: simulator only. The model-driven audit: a stand-in model in tests only; not run with a real language model |
| Vault, Invoicing, order tracking, hold reauthorization, Login with PayPal, the Cryptocurrency On/Off Ramp | Not used. Reauthorization is allowed by PayPal only after the three-day honor period, so it cannot be exercised on the sandbox now. The ramp is a partner service a person completes on PayPal's pages; its configuration endpoint was read on the sandbox and nothing was built on it. No spending agent is given PayPal's Agent Toolkit; agents that spend never hold a PayPal credential |

Payouts to placeholder addresses end as `UNCLAIMED`, and the app, the evidence and the documents say unclaimed. Two payouts to an address that has a sandbox account ended `SUCCESS`.

No open holds remain from development: every envelope in the development database is closed and its hold voided. Several small payouts made while testing recall ($7 and $1) are still held unclaimed by the sandbox, as are the demo payouts to placeholder addresses; PayPal returns unclaimed payouts after thirty days.

## Developer surface

| Piece | State |
|---|---|
| `@envelope/sdk` (`sdk/`) | 19 tests; one ES module, no dependencies; ran against the sandbox before refunds and payer approval were added. Not published |
| MCP server (`scripts/mcp.ts`) | Fifteen tools (six read, nine act), marked apart. A second role, `ENVELOPE_ROLE=auditor`: ten tools that read or propose, and no agent key. 14 tests over real MCP on the simulator. Stdio only; there is no HTTP transport |
| The auditor (`/auditor`, `npm run auditor`, `/api/auditor*`) | 11 tests. Open on the simulator; against real PayPal it needs the operator's key (`AUDITOR_SECRET`) and is off without one |
| Command line (`scripts/agent.ts`) | Built on the SDK; exercised in the same tests |
| Example (`examples/hire-an-agent`) | Runs with plain `node` against a gateway URL |

## Security

- The attack corpus and the adversarial tests for the new code pass. Details: [`RED_TEAM_REPORT.md`](RED_TEAM_REPORT.md).
- The record of PayPal calls stores no request or response body; a test searches it for a card number, a CVV field and a token.
- A PayPal event can only cause the gateway to read a record from PayPal. It cannot move money by itself. A PayPal order offered to back an envelope is read from PayPal and refused unless it was made for that envelope, for that amount, and is approved.
- A refund or a recall gives the owner the money and leaves that part of the envelope used, as PayPal does. Before 12 November the books gave the budget back; that was a fault and is fixed.
- The auditor cannot move money. PayPal's toolkit runs with no credential; a tool outside its five reads is refused by name, and the gateway's client sends only `GET`s on five listed paths for it. A proposal is judged on the records and names a signer who is never the auditor. Text the auditor reads in a record reaches it as a quotation.
- The auditor's reads show the whole PayPal account. On the simulator they are open; against real PayPal they need one shared operator key. There is no per-person sign-in.
- No review by anyone outside the project has been done. More than twenty faults have been found and fixed in three days by the people who wrote the code; there may be more.

## Judging criteria, with what a judge can check

| Criterion | Evidence | Weakness |
|---|---|---|
| Technological implementation | One lifecycle on PayPal, with an evidence file for each part. Ran end to end on the sandbox, with ids and debug ids in `evidence/`: hold, read hold, partial capture, payout, read payout, void, refund, reported balance, the statement (our records found on it with PayPal's fees beside them), PayPal's events read from its feed, and pushed deliveries confirmed by PayPal's signature check (by replay from the hosted copy's log). Called there with nothing to act on: disputes. As far as PayPal's sandbox allowed: payout cancel (server errors). Waiting for a person: payer approval in PayPal's checkout <!-- APPROVAL-SANDBOX -->. A real model driving agents; PayPal's Agent Toolkit used read-only by an auditing agent, on the sandbox by its fixed procedure; 447 tests, among them seeded random runs checked against an independent model; an SDK and MCP server | No Vault, reauthorization or order tracking, which many rivals have; the auditor's model-driven path has not run with a real model; fewer tests than the largest entries; two things proven on the simulator only; PayPal's fees measured but not priced in |
| Design | One visual language on every page; the proof graph; "What PayPal did" on every envelope; a Developers page; phone widths measured | Dense pages; not tried on a real phone |
| Potential impact | Anyone giving an agent money needs a limit that survives delegation; a payee needs to know the money exists; `COMPETITIVE_INTELLIGENCE.md` names who else is working on it | Real use needs a licence or a licensed partner for balances; sandbox only |
| Innovation | Authority that can be split and never enlarged, on one PayPal hold, checkable by anyone, with proof of funds that carries PayPal's live word and its honor period; agents that earn, hold and pay; a card only one merchant can charge; books checked against PayPal's own statement | Capability chains are prior art, and one rival (Writ) describes a delegation tree sharing one hold; the entry says both |
| Presentation | A guided tour on the hosted copy (`/?tour=1`); the README opens with a link row, a two-minute path for judges and a table of what is proven where; a hosted copy that needs no setup and holds up with several tabs open; evidence files; runbook; a narrated video | The video predates the last four rounds: it does not show the PayPal panel, the SDK, refunds, reserves, the statement, disputes, payer approval, PayPal's events, the auditor or the tour. There is no public YouTube link in the README yet |

No scores are given here. A judge should not have to take the author's word for one.

## Still open

- Settlement by PayPal's own events has run on the sandbox, but the pushed deliveries reached a gateway by replay from the hosted copy's log: that copy has no database and cannot apply them itself. `vercel.json` schedules the sweep daily; the schedule has not been seen to fire on a deployment with a database.
- Payer approval in PayPal's checkout has not completed on the sandbox: it waits for a person to approve. <!-- APPROVAL-SANDBOX -->
- No dispute evidence has been sent to the real PayPal. On PayPal's real statement all 28 records were matched; a mismatch has only been produced on the simulator. <!-- STATEMENT-CHECK -->
- The auditor's model-driven path has not run with a real language model; tests drive it with a stand-in. Finding and answering a dispute through the auditor ran on the simulator only. On a server gateway that has `CRON_SECRET` set, the auditor page's "Run the gateway's sweep now" button cannot run the sweep (401); the page says the scheduler will answer the dispute on its next run.
- No mutation testing: the 447 tests pass, and there is no measure of which injected faults they would miss.
- Reserves on the sandbox cannot show a shortfall: the account holds old test money and PayPal's figure is hours old.
- PayPal's fees are measured (from its statement) and not charged to anyone: the operator carries them. That is a product decision still to make, not a defect in the arithmetic.
- No partial refunds; a payment that has left an agent's balance cannot be refunded from it.
- Recall has not completed on the sandbox.
- A hold is not reauthorized; an envelope lives at most 28 days, and after the first three its hold is past PayPal's honor period. Proof of funds says so; nothing renews it.
- Captured money between capture and payout, and every agent's balance, sits in the gateway's PayPal account. With real money that needs a licence or a licensed partner. The entry never calls itself a bank or an escrow service.
- The owner's key is in browser storage; the gateway's keys are in the database, sealed only when a secret is set.
- The hosted copy of this branch has not been opened by a person.

## Submission blockers

None in the code. Three in the owner's hands: the repository is private, production runs the previous version until pull request #11 is merged, and the video decision.

## Only the owner can do these

1. Merge pull request #11 into `main` and wait for Vercel to finish.
2. Open the production site (<https://envelope-paypal.vercel.app>, also <https://kept-paypal.vercel.app>) in a private window, to confirm it needs no Vercel login. Seal an envelope (once with each button: at once, and "Or approve the hold in PayPal first"), run the agents, read "What PayPal did", open the proof graph, the Accounts page (reserves, "Compare with PayPal") and the Developers page. Open a second tab while the first is working.
3. Decide on the video: use the existing one, or say when a new take should be recorded (script in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md), section D). Upload it to YouTube as Public.
4. Make the repository public.
5. Submit on Devpost from [`SUBMISSION.md`](SUBMISSION.md) before 20:00 UTC on 12 November, and change nothing afterwards.
6. Approve the pending sandbox hold at PayPal with a sandbox personal account (the link is in the session), which completes the payer-approval evidence. <!-- APPROVAL-SANDBOX --> The webhook is registered (`25W82274K7440843K`); nothing more is needed for it.
