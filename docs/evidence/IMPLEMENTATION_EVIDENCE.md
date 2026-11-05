# Kept: implementation evidence report

**Recorded:** 5 November 2026. **Branch:** `ccr-8487dcc7-qzxc0i`.

**Status words.** Every capability below states exactly how far it has been proven. Nothing here is called "working" if it has only run against a mock.

- **Simulated** means Kept's labelled local PayPal emulator (`lib/paypal/emulator.ts`). It is not PayPal. Its events are unsigned and are refused in sandbox and live mode.
- **Sandbox** means the real PayPal sandbox.
- No production (live) data exists.

| Capability | Implemented | Unit tested | Integration tested (Postgres + emulator) | Browser-tested (Playwright, production build) | Verified against PayPal sandbox | Deployed | On video |
|---|---|---|---|---|---|---|---|
| **Pre-capture gate:** GET the PayPal order, compare with the promise, coded verdict, block | Yes | Yes | Yes (11 directive cases) | Yes (`e2e-ui.mjs`, Demonstration 1) | **No.** Needs credentials | No | No |
| Correction path: new order at the promised total, buyer re-approves, blocked order never captured | Yes | — | Yes | Yes | No | No | No |
| Order-digest binding, stale verdicts, write-ahead capture record (Graphite patterns A1–A6) | Yes | Yes (mutation tests) | Yes (order changed after a READY verdict) | — | No | No | No |
| Post-capture repair (external order: BROKEN, $9.33 refund, merchant approval, refund confirmed by GET) | Yes | Yes | Yes | Yes (`e2e-repair.mjs`, Demonstration 2) | No | No | No |
| Idempotent refunds (`PayPal-Request-Id`), concurrent double approval gives one refund | Yes | — | Yes | — | No | No | No |
| Pending refund stays PENDING; a failed refund is shown as FAILED | Yes | — | Yes | — | No (the sandbox `PayPal-Mock-Response` path is wired but not run) | No | No |
| Webhook signature verification (CRC32 + RSA), dedupe, re-fetch | Yes | Yes (real RSA signatures) | Yes | — | **No.** Needs a public deploy plus a webhook id | No | No |
| Promise validator and golden set (46/46, 0 false, 0 fabricated) | Yes | Yes | — | — | n/a | — | No |
| AI-vs-rules evaluation (20 cases; rules 3/11 beyond-rules, 0 false on traps) | Yes | Yes (premises) | — | — | n/a | — | No |
| Claude extractor, assistant, shopper agent, remedy agent | Yes | — | — | — | n/a (**never called live**: no API key) | No | No |
| Hash-chained audit log, evidence pack, offline verifier | Yes | Yes | Yes (SQL tamper, 25 concurrent writers) | Yes (pack downloaded and verified with the CLI; a tampered copy was rejected) | n/a | No | No |
| MCP promise-record server | Yes | Yes (protocol) | Yes | Interop: official MCP TypeScript SDK client 1.32.2 | n/a | No | No |
| Agent-to-agent mandates, deterministic guard, fault attribution | Yes | Yes | Yes | Yes (`e2e-agent.mjs`) | No | No | No |
| Disputes answered from the ledger (Disputes API) | Yes | — | Yes | Yes (`e2e-dispute.mjs`) | **No.** Request shapes follow the API reference | No | No |
| AG Grid ledgers (promises, orders, activity) | Yes | — | — | Yes (screenshots) | n/a | No | No |
| AG Studio "Kept Intelligence" report | Yes (evaluation mode, no licence key) | — | Yes (figures equal database aggregates) | Yes (screenshot) | n/a | No | No |
| AG Studio read-only analytics agent | **No (deferred).** See below | — | — | — | — | — | — |

## Test commands and outcomes

All commands were run on 5 November 2026 in this session.

| Command | Outcome |
|---|---|
| `npm test` | 141 passed (unit, golden, AI-eval premises, end-to-end flows on Postgres with the emulator) |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `node scripts/e2e-ui.mjs` (Demonstration 1) | 7 steps passed; no horizontal overflow at 360 px |
| `node scripts/e2e-repair.mjs` (Demonstration 2) | 4 steps passed |
| `node scripts/e2e-agent.mjs` | 6 steps passed |
| `node scripts/e2e-dispute.mjs` | 6 steps passed |
| `npm run eval:ai` | rules 3/11 beyond-rules, 4/4 controls, 0 false on traps; Claude not run → [`ai-eval-results.json`](ai-eval-results.json) |
| `npx tsx scripts/verify-evidence.ts <pack>` | real pack VERIFIED; tampered pack NOT VERIFIED (broken at the edited entry) |
| `node scripts/mcp-check.mjs` | the tool is listed and called through the official SDK client |

## The two defining moments (simulated)

**Demonstration 1: stop the mismatch.**

1. The assistant promises $84.00; checkout would charge $93.33.
2. The buyer approves the $93.33 order. Kept's capture gate fetches it from PayPal and returns `BLOCKED_MISMATCH`.
3. The order stays APPROVED and uncaptured at PayPal (authoritative GET).
4. The merchant corrects it. Kept creates a new PayPal order at $84.00 with a labelled discount; the buyer approves it.
5. The fresh check is `READY_TO_CAPTURE`, and $84.00 is captured. The promise is KEPT.

Screenshots: [`02-capture-blocked.png`](screenshots/02-capture-blocked.png), [`04-order-blocked.png`](screenshots/04-order-blocked.png), [`05-verified-captured.png`](screenshots/05-verified-captured.png), [`07-receipt-mobile.png`](screenshots/07-receipt-mobile.png).

**Demonstration 2: repair what was already paid.** This is a separate order.

1. The order was captured **outside** Kept's checkout, so the check is recorded only and could not stop it.
2. $84.00 was promised and $93.33 captured. The promise is BROKEN, and Kept proposes a $9.33 partial refund.
3. The merchant approves it. PayPal reports COMPLETED, confirmed by GET.
4. The receipt shows *Broken · made good*.

Screenshots: [`R2-ledger-broken.png`](screenshots/R2-ledger-broken.png), [`R3-ledger-refunded.png`](screenshots/R3-ledger-refunded.png), [`R4-receipt-mobile.png`](screenshots/R4-receipt-mobile.png).

## Integration boundary (stated in the product too)

Kept can block a capture **only in a checkout where Kept performs the capture**. Payments captured by any other checkout, labelled *outside Kept's checkout*, are monitored after payment and repaired with merchant-approved refunds. Kept does not claim to block them.

## Known gaps

- **Real PayPal sandbox: not yet run.** Missing environment variables: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_WEBHOOK_ID` (after deploying), and `APP_BASE_URL`. Set them in the environment settings, never in chat.
- **Claude: not yet called live.** Missing `ANTHROPIC_API_KEY`.
- **AG Studio licence: not configured.** `AG_STUDIO` is unset, so it runs in evaluation mode with a watermark.
- **Pre-capture reading of promises uses the deterministic rules extractor.** Promises only Claude can read (see the AI evaluation) are enforced after capture, not before.
- **AG Studio analytics agent: deferred.** AG Studio's agent needs an LLM adapter (`AgLlmAdapter`). The documented adapter targets another provider. A Claude adapter must handle two things:
  - Claude Opus 5.5 rejects forced `tool_choice`, which the harness can request;
  - its preserved-thinking check rejects edited history, so the harness's replayed conversation must keep thinking blocks unchanged.

  This can't be verified without an API key, so it isn't shipped. The design is read-only by construction: the AG Studio agent only edits report state over the in-memory data Kept hands it, and it has no route to Kept's APIs.
- **The revised-commitment resolution path is not implemented.** That path would be a new quotation agreed and reconfirmed by the buyer. The implemented path is a merchant correction approved by the buyer.
