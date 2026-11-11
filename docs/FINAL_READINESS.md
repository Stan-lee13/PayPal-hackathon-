# Final readiness

State of the entry at 19:20 UTC on 11 November 2026 (8:20pm in Lagos), code at commit `f21fafc` (this document was added after it) on branch `ccr-8487dcc7-qzxc0i`, pull request #7. The Devpost deadline is 12 November, 20:00 UTC (9:00pm in Lagos); the owner's own target is 17:00 UTC.

Every line marked "ran" was run on this commit or on the commit named. Nothing here is carried over from an earlier state without saying so.

## Verdict

**Go, once the owner has done the four steps under "Only the owner can do these".** The product works end to end on the real PayPal sandbox and on the hosted simulator, the checks below pass, and the known gaps are written down. Nothing in the code blocks a submission.

## Checks

| Check | Result | How it was run |
|---|---|---|
| Type check | Pass | `npx tsc --noEmit` |
| Production build | Pass | `next build` locally; Vercel preview for `f21fafc` is `READY` |
| Automated tests | 63 of 63 pass | `npm test`, PayPal simulator, local Postgres |
| Attack corpus | 171 of 171 refused, none moved money | `npx tsx scripts/attack-suite.ts`; result in `evidence/attack-suite.json` |
| Browser test, server gateway | Pass | `scripts/e2e.mjs` in Chromium on the simulator |
| Browser test, in-browser gateway | Pass | the same script with no database: the mode the hosted copy runs in |
| Real PayPal sandbox, scripted | Ran on `52986fa`, before the last two code changes | `scripts/sandbox-run.ts`; `evidence/sandbox-run.json`. Authorizations `4E1166380C2106431` and `1RN238936P9131935` |
| Real PayPal sandbox, in a browser with a real model | Ran on this commit | the recorded take: authorization `52S347829J918164G`; `evidence/model-run.md` |
| Card with a real model on the sandbox | Ran once, on an earlier commit | `evidence/card-run.md`; authorization `9W7659235B003944P` |

The two changes made after the scripted sandbox run are narrow: which refusals are written to the record, and how the proof graph measures its lines. Both are covered by the tests and by the recorded take, which ran on this commit.

## PayPal sandbox

- Holds, partial captures, payouts, voids and status reads all ran against the sandbox on this commit.
- Payouts to the demo's placeholder addresses end as `UNCLAIMED`, because those addresses have no sandbox account. The app, the video and the evidence files say unclaimed, not paid. Two payouts to real sandbox accounts ended `SUCCESS` (`C9CBD4Z5BS78A`, `SKTPQ2DFR837J`).
- PayPal's first test card stopped being honoured after about a dozen holds in one day. Holds now fall back across PayPal's other documented test cards. If the sandbox refuses all of them, sealing an envelope fails with PayPal's message; the hosted simulator is not affected.
- No open holds remain from development: every envelope in the development database is closed and its hold voided, including the one left by an aborted recording (`322312437E936723W`, voided).
- Never seen on the sandbox, so proven on the simulator only: a pending capture, a refused refund, a failed or returned payout.

## Deployment

- Production (`main`, commit `ebaecd2`, pull request #6) is live and reported `gateway: browser` when last asked. It does not yet have the proof graph or the fixes in the red team report.
- The preview for this branch built successfully. It could not be opened from the development machine (the network there cannot reach `vercel.app`), so nobody has clicked through the deployed copy of this commit. The same build passes the browser test locally in the same mode.
- Merging pull request #7 makes Vercel rebuild production from this code.

## Repository

- Private. An MIT licence and `.env.example` are present. No credentials are in the repository; the sandbox credentials are injected outside it.
- The judges need it public. That is the owner's decision and has not been made by anyone else.
- Pull request #7 is an open draft with a green check and no review comments.

## Demo video

- `docs/demo/envelope-demo.mp4` is 2:49 (limit 3:00), recorded on the sandbox on this commit, with a synthetic narration. It includes the proof graph.
- It is a complete take, not necessarily the final one. The owner has said they will say when the submission video is to be made; no further takes will be recorded until then.
- If the owner narrates it themselves, the script is `scripts/demo-narration.json`.

## Documents

| Document | State |
|---|---|
| `README.md`, `docs/SPEC.md`, `docs/SUBMISSION.md` | Current with this commit |
| `docs/AUDIT_REPORT.md` | Written; inventory of what is operational, tested or not built |
| `docs/RED_TEAM_REPORT.md` | Written; fifteen real faults with their tests, and what is still open |
| `docs/FINANCIAL_ARCHITECTURE.md` | Written |
| `docs/COMPETITIVE_INTELLIGENCE.md` | Written; other entries' code was read, other products were read about |
| `docs/FINANCIAL_FRONTIER_ROADMAP.md` | Written; says what must not be built without licensed partners |

## What is not done, and will not be before the deadline

- No review by anyone outside the project. Fifteen faults were found in two days by the people who wrote the code; there may be more.
- Nothing runs on a timer and PayPal webhooks are not consumed. An unfinished payment moves when its envelope is opened.
- A hold is not reauthorized, so an envelope lives at most 28 days.
- Money between capture and payout, and any agent's balance, sits in the gateway's PayPal account. With real money that needs a licence or a licensed partner. This is why the entry is sandbox-only and never calls itself a bank or an escrow service.
- The owner's key is in browser storage; the gateway's keys are in the database, sealed only if a secret is set.
- The phone layout was checked at one size in a desktop browser, not on a phone.
- The card ran once with a real model, and the second billing period was not reached in that run.

## Risks on the day

| Risk | What to do |
|---|---|
| The sandbox refuses holds while a judge watches the live sandbox copy | The hosted copy is the simulator and does not depend on the sandbox. The video and evidence files show the sandbox |
| A judge asks whether this is a bank or escrow | It is neither. It is a spending-authority layer on a PayPal authorization; the README and the roadmap say what a licence would be needed for |
| A judge finds a rival with a similar idea | `docs/COMPETITIVE_INTELLIGENCE.md` names the closest ones and what is different here: authority that can only be narrowed, checkable by anyone, on one PayPal hold |
| Production is still the old code at judging time | Merge pull request #7 before submitting, then open the site and seal one envelope |

## Only the owner can do these

1. Merge pull request #7 into `main` and wait for Vercel to finish.
2. Open the production site, seal an envelope, run the agents and open the proof graph. Nobody has done this on the deployed copy of this code.
3. Make the repository public.
4. Decide on the final video, upload it to YouTube as Public, and submit on Devpost using `docs/SUBMISSION.md`.
