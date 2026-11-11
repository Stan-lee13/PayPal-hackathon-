# Final audit

The state of the entry late on 11 November 2026, on branch `ccr-8487dcc7-qzxc0i` (pull request #8). The Devpost deadline is 12 November 2026, 12:00 pm PST (20:00 UTC, 9:00 pm in Lagos). The rules say that after the deadline nothing may be touched: no commits, no README edits.

Every line marked "ran" was run on this branch on the day. What was built in the last round, and how it was decided, is in [`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).

## Verdict

**Go, once the owner has done the steps under "Only the owner can do these".** The product works end to end on the real PayPal sandbox and on the hosted simulator. Two things are proven on the simulator only and are labelled that way everywhere: recalling an unclaimed payout, and receiving PayPal's events.

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
 service.ts          bank.ts                    settlement.ts
 envelopes,          balances, transfers,       what PayPal did, recall,
 payments, promises  cards, the books           PayPal events, sweep
   └────────────────────┼─────────────────────────────┘
                        ▼
        lib/envelope/core.ts   signatures and rules; no database; the same file everywhere
        lib/paypal/            client, payments, journal of calls, simulator
        lib/db/                Postgres, or Postgres-in-WebAssembly in the browser
                        ▼
                     PayPal    hold · partial capture · payout · void · refund · cancel · events
```

The only component that holds PayPal credentials is the gateway. No model output is read by any file that moves money.

## Checks

| Check | Result | How it was run |
|---|---|---|
| Type check | Pass | `npx tsc --noEmit` |
| Production build | Pass | `next build` |
| Automated tests | 101 of 101 pass | `npm test`, PayPal simulator, local Postgres |
| Attack corpus | 171 of 171 refused, none moved money | `npx tsx scripts/attack-suite.ts` |
| Browser test, server gateway | Pass | `scripts/e2e.mjs` in Chromium on the simulator |
| Browser test, in-browser gateway | Pass | the same script with no database: the mode the hosted copy runs in |
| Phone width | No sideways scroll on six pages at 390 px | measured in Chromium; not tried on a phone |
| Real PayPal sandbox, scripted | Ran | `scripts/sandbox-run.ts`; `evidence/sandbox-run.json` |
| Real PayPal sandbox, from the SDK | Ran | `examples/hire-an-agent`; `evidence/sdk-run.md` |
| Real PayPal sandbox, in a browser with a real model | Ran earlier the same day, before this round | the recorded video; `evidence/model-run.md` |

## PayPal

| Capability | State |
|---|---|
| Authorize, read authorization, partial capture, payout, read payout, void | Ran on the sandbox today |
| Record of PayPal calls | Ran on the sandbox: 83 calls behind three envelopes in the scripted run, each with PayPal's debug id |
| Sweep of unfinished payments | Ran on the sandbox; found nothing to move |
| Refund of a capture | Simulator only: no sandbox payout failed |
| Cancel of an unclaimed payout (recall) | Simulator only. On the sandbox PayPal answered `BATCH_NOT_COMPLETED`, then `INTERNAL_SERVICE_ERROR` on every attempt |
| Webhook verification | A forged event sent to the real sandbox was rejected. No genuine event has been received |
| Event feed | Read on the sandbox; empty, because no webhook is registered |
| Vault, Disputes, payer-present approval, Transaction Search, Invoicing, reauthorization | Not used |

Payouts to placeholder addresses end as `UNCLAIMED`, and the app, the evidence and the documents say unclaimed. Two payouts to an address that has a sandbox account ended `SUCCESS`.

No open holds remain from development: every envelope in the development database is closed and its hold voided. Several small payouts made while testing recall ($7 and $1) are still held unclaimed by the sandbox, as are the demo payouts to placeholder addresses; PayPal returns unclaimed payouts after thirty days.

## Developer surface

| Piece | State |
|---|---|
| `@envelope/sdk` (`sdk/`) | 17 tests; one ES module, no dependencies; ran against the sandbox. Not published |
| MCP server (`scripts/mcp.ts`) | Fourteen tools, read and act marked apart; 13 tests over real MCP on the simulator. Stdio only; there is no HTTP transport |
| Command line (`scripts/agent.ts`) | Built on the SDK; exercised in the same tests |
| Example (`examples/hire-an-agent`) | Runs with plain `node` against a gateway URL |

## Security

- The attack corpus and the adversarial tests for the new code pass. Details: [`RED_TEAM_REPORT.md`](RED_TEAM_REPORT.md).
- The record of PayPal calls stores no request or response body; a test searches it for a card number, a CVV field and a token.
- A PayPal event can only cause the gateway to read a record from PayPal. It cannot move money by itself.
- No review by anyone outside the project has been done. More than twenty faults have been found and fixed in three days by the people who wrote the code; there may be more.

## Judging criteria, with what a judge can check

| Criterion | Evidence | Weakness |
|---|---|---|
| Technological implementation | Nine PayPal operations in one lifecycle, six proven on the sandbox with ids and debug ids in `evidence/`; a real model driving agents; 101 tests; an SDK and MCP server | Fewer PayPal products than several rivals: no Vault, Disputes or payer-present approval |
| Design | One visual language on every page; the proof graph; "What PayPal did" on every envelope; a Developers page; phone widths measured | Dense pages; not tried on a real phone |
| Potential impact | Anyone giving an agent money needs a limit that survives delegation; a payee needs to know the money exists; `COMPETITIVE_INTELLIGENCE.md` names who else is working on it | Real use needs a licence or a licensed partner for balances; sandbox only |
| Innovation | Authority that can be split and never enlarged, on one PayPal hold, checkable by anyone; agents that earn, hold and pay; a card only one merchant can charge | Capability chains are prior art, and the entry says so |
| Presentation | Hosted copy that needs no setup; evidence files; runbook; a narrated video | The video predates this round and does not show the PayPal panel or the SDK |

No scores are given here. A judge should not have to take the author's word for one.

## Still open

- Settlement does not run by itself on any deployment of this repository: nothing calls the sweep on a schedule and no webhook is registered.
- Recall has not completed on the sandbox.
- A hold is not reauthorized; an envelope lives at most 28 days.
- Captured money between capture and payout, and every agent's balance, sits in the gateway's PayPal account. With real money that needs a licence or a licensed partner. The entry never calls itself a bank or an escrow service.
- The owner's key is in browser storage; the gateway's keys are in the database, sealed only when a secret is set.
- The hosted copy of this branch has not been opened by a person.

## Submission blockers

None in the code. Three in the owner's hands: the repository is private, production runs the previous version until pull request #8 is merged, and the video decision.

## Only the owner can do these

1. Merge pull request #8 into `main` and wait for Vercel to finish.
2. Open the production site in a private window (to confirm it needs no Vercel login), seal an envelope, run the agents, read "What PayPal did", open the proof graph and the Developers page.
3. Decide on the video: use the existing one, or say when a new take should be recorded (script in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md), section D). Upload it to YouTube as Public.
4. Make the repository public.
5. Submit on Devpost from [`SUBMISSION.md`](SUBMISSION.md) before 20:00 UTC on 12 November, and change nothing afterwards.
6. Optional: register a PayPal webhook for the sandbox app (see the runbook), so genuine PayPal events can be received.
