# Audit report

An audit of the repository as it stood on 11 November 2026, done by reading the code and running it. Security faults are in [`RED_TEAM_REPORT.md`](RED_TEAM_REPORT.md); the money model is in [`FINANCIAL_ARCHITECTURE.md`](FINANCIAL_ARCHITECTURE.md). This document is the inventory: what exists, how real each part is, and what is wrong with it.

## Starting facts, corrected

- Pull requests #5 and #6 are merged. `main` already had balances, the card and the first replay fix when this audit began.
- There are no leftovers from the two earlier projects in this repository (Kept, MergePay): no routes, tables or modules. The only traces are the local database name and two rows in the discovery document that record why they were set aside.
- The submission checklist still told the owner to merge pull request #5. Corrected.

## System map

```
 Browser pages (Next.js app router)                   Agents outside the app
   /            landing                                scripts/agent.ts   command line
   /console     seal an envelope                       scripts/mcp.ts     MCP server (stdio)
   /e/[id]      an envelope: tree, statement, model
   /proof/[id]  proof graph (whole envelope, or one payment)
   /r/[id]      a receipt, checked against PayPal and in the browser
   /a/[key]     an agent: passport, envelopes, balance, card
   /bank        every account and whether the books add up
   /treasury    one owner's control room
   /spec        the protocol
        │                                                     │
        ▼                                                     ▼
 lib/api/handlers.ts   one function per endpoint  ◀── lib/api/next.ts (server)  or  lib/local/router.ts (in the browser)
        │
        ├── lib/gateway/service.ts   envelopes, payments, promises, standing, treasury, reconcile
        ├── lib/gateway/bank.ts      balances, transfers, cards, freeze, the books
        ├── lib/gateway/proof.ts     read-only: records as a graph
        ├── lib/demo/agents.ts       built-in agents whose keys the server keeps (demo only)
        └── lib/ai/                  a model proposes tool calls; they are signed and judged like any request
        │
        ├── lib/envelope/core.ts     signatures and rules; no database; same file in browser, server, CLI
        ├── lib/db/                  Postgres on a server, or Postgres-in-WebAssembly in the browser
        └── lib/paypal/              client (sandbox) and a built-in simulator
```

Tables: `roots`, `blocks`, `spends`, `accounts`, `ledger`, `transfers`, `cards`, `audit_log` (hash-chained), `paypal_calls`, `paypal_events`, `gateway_keys`, `demo_keys`, `rate_limits`, `emulator_state`. Nine migrations. `lib/gateway/books.ts` (reserves, PayPal's statement, disputes and evidence) and `lib/gateway/settlement.ts` sit beside `service.ts` and `bank.ts`. This inventory was written before the SDK, the record of PayPal calls, recall, events, refunds, reserves, the statement check and disputes were added; those are in the rows marked below and in [`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).

## Feature inventory

How real each part is. **Operational** means it ran on the real PayPal sandbox and the evidence is in the repository. **Tested** means automated tests on the simulator only.

| Feature | State | Evidence |
|---|---|---|
| Seal an envelope: owner's signature, PayPal hold | Operational | `evidence/sandbox-run.json`; authorization ids in the README |
| Split, narrow-only, verified by anyone | Operational | same; `tests/envelope-core.test.ts` |
| Spend: reserve at every ancestor, partial capture, payout | Operational | same; `tests/gateway.test.ts` |
| Revoke, close, void | Operational | same |
| Proof of funds with PayPal's live word | Operational | same |
| Set aside, keep, release, lapse | Operational | same; `tests/accounts-promises.test.ts` |
| Release on a named key's acceptance | Operational | same |
| Owner approval above a threshold | Operational | same; shown in the video |
| Agent accounts that receive | Operational | same |
| Balances, transfers, withdrawal, freeze, the books | Operational | same (second hold); `tests/bank.test.ts` |
| Card: issue, charge, limits, cancel | Operational, once | `evidence/card-run.md` (one run, one model, month two not reached); `tests/cards.test.ts` |
| Daily limit on an account | Tested | `tests/cards.test.ts`, `tests/review-findings.test.ts` |
| Receipts checked against PayPal and in the browser | Operational | receipt page; the browser test |
| Treasury with reconciliation | Operational | sandbox run; shown in the video |
| Signed reference | Operational | sandbox run |
| Proof graph | Operational | shown in the video on the sandbox (`evidence/model-run.md`); `scripts/e2e.mjs` on the simulator in both gateway modes |
| A model playing the agents inside the app | Operational | `evidence/model-run.md` |
| MCP server and command line | Operational for split, pay and cards; the balance commands were run on the simulator | `evidence/agent-run.md`, `evidence/card-run.md` |
| In-browser gateway (the hosted try-it copy) | Operational as a simulator; its tab sharing was rebuilt on 12 November so a closed or reloaded tab cannot freeze the others | the browser test; `scripts/tabs-stress.mjs`; production health check |
| Record of every PayPal call, shown per envelope | Operational | `evidence/sandbox-run.json`, `evidence/sdk-run.md`; `tests/paypal-rail.test.ts` |
| SDK (`sdk/`), with the MCP server and command line built on it | Operational for the SDK; the rebuilt MCP server is tested over real MCP on the simulator | `evidence/sdk-run.md`; `tests/sdk.test.ts`, `tests/mcp.test.ts` |
| Sweep of unfinished payments | Operational (ran on the sandbox from the script, nothing to move). Scheduled daily in `vercel.json`; the schedule has not been seen to fire | `evidence/sandbox-run.json` |
| PayPal events: verified, applied once | Operational. From PayPal's event feed: seven events about one run applied once each, one of which settled a payment. Pushed: two deliveries confirmed by PayPal's signature check and the same two edited refused; they reached the gateway by replay from the hosted copy's log, not directly | `evidence/paypal-events.json`; `tests/paypal-rail.test.ts` |
| The owner approves the hold in PayPal's own checkout | Tested end to end on the simulator. On the sandbox PayPal made the order and returned its approval link, and sealing before approval was refused; a person's approval is pending <!-- APPROVAL-SANDBOX --> | `tests/approval.test.ts`, `tests/sdk.test.ts`, the browser test; `scripts/approval-check.ts` |
| PayPal's honor period in proof of funds | Tested (arithmetic on the expiry PayPal reports; signed with the statement) | `tests/gateway.test.ts` |
| A copy with no gateway logs PayPal's deliveries for replay | Operational on the hosted copy (the two deliveries above came from its log); tested | `lib/api/relay.ts`; `tests/paypal-rail.test.ts` |
| Recall of an unclaimed payout | Simulated only; PayPal's sandbox would not cancel | `tests/paypal-rail.test.ts`; `evidence/sandbox-run.json` records the refusals |
| Refund by the agent that was paid | Operational | `evidence/sandbox-run.json` (capture `1XG96277EH6264408`, refund `4C249901ET649933V`); `tests/books.test.ts`, `tests/sdk.test.ts` |
| A refund keeps the envelope's budget used, as PayPal keeps the hold used | Operational | `scripts/paypal-refund-capacity.ts` on the sandbox; the main run refuses the refunded $6 a second time |
| Reserves: what agents are owed against PayPal's reported balance | Operational for the reading; a shortfall has only been produced on the simulator | `evidence/sandbox-run.json`; `tests/books.test.ts` |
| PayPal's statement (Transaction Search) against the records | Matched on the sandbox: all 28 listed with the same amount, none with a different one. PayPal's fees are read from the same lines ($24.69 on the listed records) <!-- STATEMENT-CHECK --> | `evidence/statement-check.json`; `tests/books.test.ts` |
| Disputes: found, marked, answered with evidence | Asked on the sandbox (none held); the rest simulated only | `evidence/sandbox-run.json`; `tests/books.test.ts` |
| The auditor: PayPal's Agent Toolkit cut down to five read tools, the gateway's books, and proposals checked by rule | Operational for the fixed procedure: on the sandbox all 28 listed records were found again through the toolkit with the same amounts, five recall proposals stand for the owner to sign, and a refund the toolkit was asked to make was stopped with nothing sent. A dispute found and answered, and a memo that gives the auditor orders: simulated only. The model-driven audit: tested with a stand-in model, not run with a real one | `evidence/auditor.json`; `tests/auditor.test.ts` (11), `tests/mcp.test.ts`; `lib/paypal/toolkit.ts`, `lib/gateway/auditor.ts` |
| Guided tour on the hosted copy | Tested in a browser on the in-browser copy | `scripts/tour-check.mjs`; `components/tour.tsx` |
| Pending capture handling | Simulated only | the sandbox never returned a pending capture |
| Refund-due handling | Simulated only | the sandbox never refused a refund |
| Returned or failed payout handling | Simulated only | no sandbox payout failed |
| Keys sealed at rest | Tested | `tests/settlement.test.ts` |
| Hold reauthorization, Vault, Invoicing, order tracking, Login with PayPal, the Cryptocurrency On/Off Ramp, partial refunds | Not built. Reauthorization cannot be exercised on the sandbox before a hold's fourth day. The ramp is a partner service a person completes on PayPal's pages; only its configuration endpoint was read. PayPal's Agent Toolkit is used by the auditor, read-only, and is given to no spending agent | — |
| Lending, interest, insurance, network cards | Not built, and not to be built without licensed partners | — |

## Findings

Severity is about what could go wrong with money or private data. Faults that were fixed are listed in the red team report with their tests; the ones below are what remains or what an auditor should know.

### Financial integrity

| Finding | Severity | State |
|---|---|---|
| The database and PayPal cannot commit together; correctness depends on a fixed order of steps, idempotency keys and guarded status changes | — | By design. Described in the architecture document. Every step is retryable; four concurrency and failure cases have tests |
| Nothing advances unfinished payments on a timer | Medium | Mostly closed: PayPal's events finished payments on the sandbox, from its feed and pushed (by replay from the hosted copy's log); the sweep is scheduled daily in `vercel.json`. The schedule has not been seen to fire, and a delivery received directly by a deployed gateway has not been run |
| A hold that lapses at PayPal is not reauthorized, and after three days it is past PayPal's honor period | Medium | Open. An envelope can live at most 28 days. Proof of funds now says when the honor period ends, so a payee can see a weaker hold for what it is; nothing renews it |
| Captured funds rest in the gateway's PayPal account between capture and payout, and for as long as an agent keeps a balance | High for real money | Open. This is the main reason the system is sandbox-only |
| A payout accepted by PayPal and held `UNCLAIMED` stays charged until PayPal returns it or the owner recalls it | Low | Open; shown as unclaimed, never as paid. Recall has not completed on the sandbox |
| A payment into a balance cannot be reversed by the payer | Medium | Partly closed. The agent that was paid can refund it in full while it still holds the money (ran on the sandbox). The payer's own route is a dispute at PayPal, which the gateway finds and answers with evidence (simulator only) |
| After a refund the books returned the budget, which PayPal does not | High | Fixed on 12 November: the amount stays used and is recorded as refunded. Found on the sandbox |
| What agents are owed was checked only against the gateway's own arithmetic | Medium | Closed in part: reserves compare it with PayPal's reported balance at PayPal's dated moment. On the sandbox the account holds old test money, so the check cannot fail there |
| The owner's consent to the hold was never given at PayPal: the hold went on a sandbox test card | Medium | Closed in part: the owner can approve the hold in PayPal's own checkout, and the gateway seals only on PayPal's word that the order made for this envelope is approved. Proven on the simulator; pending a person's approval on the sandbox <!-- APPROVAL-SANDBOX --> |

### Security and privacy

| Finding | Severity | State |
|---|---|---|
| Owner's key in browser storage | High for real money | Open |
| Gateway and demo keys in the database | Medium | Mitigated: sealed at rest when `ENVELOPE_KEY_SECRET` is set; `/api/health` says which |
| Pages addressed by an unguessable id or a public key are readable by anyone who has it (envelope, proof graph, agent page); the books page is public | Medium | Open, stated on the pages. Treasury and the list of an owner's envelopes need the owner's signature |
| The shared demo agent can be used by any visitor | Low | Open, by design |
| No sign-in anywhere | — | By design: every action that matters carries a signature, and reads of an owner's books carry one too |
| Rate limits per address, with request bodies capped at 128 KB | Low | In place; the address comes from a proxy header |
| Security headers (frame, content type, referrer, permissions, HSTS) | — | In place |
| The auditor's reads show the operator's whole PayPal account, including lines that are not the gateway's | Medium | Open on the simulator, like the rest of the demo. Against real PayPal the reads need one shared operator key (`AUDITOR_SECRET`) and the auditor is off without one. No per-person sign-in |
| PayPal's Agent Toolkit ships tools that write (`create_order`, `pay_order`, `create_refund` and others) | — | Contained three ways: the toolkit is given no credential; a tool outside the five reads is refused by name before it is called; the gateway's client sends only `GET`s on five listed paths for it. Tested for all 42 other tools, and for three writes with the name check removed |
| Text in a record (a memo, a purpose) could carry instructions to the auditor's model | Low | Bounded. Such text reaches the model as a quotation with control characters removed. A model that obeys it has only reads and `propose`; a proposal is judged on the records and names a signer who is not the auditor. Tested with a stand-in model that obeys the memo; not tried with a real model |
| No external review | High | Open |

### Product and interface

Found by using the app on a desktop and a phone-sized screen, as an owner, a payee and a first-time visitor.

| Finding | State |
|---|---|
| A first-time visitor could not see how one payment relates to the owner without opening three pages | Fixed by the proof graph and a link to it from every envelope and receipt |
| The agent page scrolled sideways on a phone (a code sample wider than the screen) | Fixed |
| "Failed · refunded" was shown for payments that failed with nothing to refund | Fixed: "Failed · not paid", and a separate "Refund due" |
| The console listed every envelope on the gateway to every visitor | Fixed: it lists yours |
| A payout PayPal is holding unclaimed could be read as paid at a glance on the envelope page | The stamp says "Unclaimed"; the proof graph says "not delivered" in words |
| A first-time visitor had no order to follow | Fixed by the guided tour (`/?tour=1`): a strip that rings the next control and moves on when the step has happened |
| On a server gateway with `CRON_SECRET` set, the auditor page's "Run the gateway's sweep now" cannot run the sweep | Open. The gateway answers 401 and the page says the scheduler will answer the dispute on its next run |
| The agent page is long: passport, record, reference, account, balance, card, income, envelopes, statement | Open. It works; it is dense |
| Pages are dense with small monospace text | Open. A deliberate look, at some cost to first-read comprehension |
| No loading skeletons; pages show a one-line "looking" state | Open |
| Phone layout was checked at one size on five pages, not tested by hand on a device | Open |
| The proof graph's connecting lines were drawn out of place when the page was zoomed with CSS (found in the first video take) | Fixed |

## Verdict

The core claim holds up: one PayPal hold, authority that can only be narrowed, every payment traceable to a person, and no model deciding whether money moves. The audit found fifteen real faults, most in the hours before submission, and fixed them with tests; five more were found and fixed the next day (red team report, items 16 to 20), one of them by the real sandbox contradicting the books. What remains open is mostly what separates a sandbox demonstration from a product that touches real money: custody, key management, timers and webhooks, and a review by someone who did not write the code.
