# Kept

**Every payment is a promise. Kept makes sure it's kept.**

Kept is a promise-verification layer for merchants paid through PayPal. Businesses are now answerable for what their AI assistants say (*Moffatt v. Air Canada*, 2024 BCCRT 149), but nothing checks those promises against the payment. Kept does.

**Kept prevents and repairs broken promises.**

- **Before payment.** In Kept's protected checkout, Kept fetches the PayPal order from PayPal right before capture and compares it with the total the assistant promised. If they contradict each other, the capture is blocked and nothing is charged. The merchant corrects the order, the buyer approves the corrected amount, and only then does money move.
- **After payment.** For payments Kept could not check first (captured by another checkout), and for promises that can only be judged later (shipping, refunds), Kept watches PayPal's own records. When a promise breaks, code computes the gap, a remedy is proposed, the merchant approves every cent, and PayPal confirms it. The customer's living receipt updates.

The same promise ledger also covers shoppers' AI agents (their spending limits become promises too) and PayPal disputes (answered with what was promised and what PayPal recorded).

```
PROMISE → VERIFY → AUTHORIZE → CAPTURE → MONITOR → RESOLVE → CONFIRM
 (chat)   (PayPal  (buyer      (only if   (verified (merchant- (GET +
           order    approves    verdict    webhooks  approved   living
           vs       in PayPal)  is READY)  + GETs)   remedy)    receipt)
           promise)
```

> **MVP, not production banking infrastructure.** The merchant console uses one shared demo passcode. Adaeze Studio is a demonstration merchant. Run with sandbox credentials only. Read [Limitations](#limitations).

Product research and rationale: [`docs/PRODUCT_DISCOVERY.md`](docs/PRODUCT_DISCOVERY.md). Industry research: [`docs/research/`](docs/research/). **Judges:** start at `/tour` on the running app.

### What has actually run

| Part | Status |
|---|---|
| Full loop in simulated mode (labelled local PayPal emulator) | **Ran.** 141 automated tests (`npm test`), plus five Playwright browser runs: `scripts/e2e-ui.mjs` (Demonstration 1: stop the mismatch), `e2e-repair.mjs` (Demonstration 2: repair what was already paid), `e2e-agent.mjs` and `e2e-dispute.mjs` |
| Pre-capture gate | **Ran (simulated).** It blocks a $93.33 order against an $84.00 promise and proves the order uncaptured by GET; the corrected $84.00 order is captured after buyer approval. The 11 directive cases are tested. Full matrix: [`docs/evidence/IMPLEMENTATION_EVIDENCE.md`](docs/evidence/IMPLEMENTATION_EVIDENCE.md) |
| Tamper-evident evidence packs | **Ran.** A real downloaded pack verifies offline with `scripts/verify-evidence.ts`, and an edited copy is rejected at the exact entry |
| MCP promise-record server | **Ran.** The official MCP TypeScript SDK client (1.32.2) connects, lists the tool and calls it (`scripts/mcp-check.mjs`) |
| AI-vs-rules evaluation | **Rules ran:** 3 of 11 harder promises found, 4 of 4 controls, 0 false promises on 8 traps. A correct extraction passes the validator for all 11. **Claude: not yet run** (`npm run eval:ai` with a key). Results: [`docs/evidence/ai-eval-results.json`](docs/evidence/ai-eval-results.json) |
| PayPal sandbox: OAuth endpoint | **Reached.** It correctly rejected placeholder credentials |
| PayPal sandbox: orders, capture, refund, tracking, Disputes API, signed webhooks | **Not yet run.** Needs the owner's sandbox credentials. `scripts/sandbox-smoke.ts` is the first step |
| Claude (assistant, extractor, shopper agent, remedy agent) | **Not yet run live.** Labelled deterministic fallbacks are used. `npm run eval:extraction` measures the real extractor |
| Deployment | **Not yet deployed** |

---

## The two demonstrations

Both use **Adaeze Studio**, a demonstration merchant. Its assistant answers only from the merchant's published sources and gets totals from a deterministic quote tool. It says *"Your total is $84.00."* (applying the published *free express shipping over $75* promotion), *"Your order ships within 48 hours."* and *"We'll sort you out if anything goes wrong."*. The demo checkout does **not** apply chat-advertised promotions, a deliberate, labelled `DEMO_MODE` integration gap, so checkout would charge **$93.33**.

**Demonstration 1: stop the mismatch** (`scripts/e2e-ui.mjs`):

1. The store shows a pre-payment price check: promised $84.00, checkout $93.33.
2. The buyer approves the $93.33 PayPal order.
3. Before capture, Kept calls `GET /v2/checkout/orders/{id}`. Its verdict is **BLOCKED_MISMATCH**, so nothing is captured: PayPal still reports the order as APPROVED.
4. The merchant clicks **Correct the order to the promised $84.00**. Kept creates a new PayPal order with a labelled $9.33 discount, and the buyer approves it.
5. The fresh check is **READY_TO_CAPTURE**. Kept captures $84.00, and the price promise is **KEPT**.
6. The receipt says the earlier order was never charged.

**Demonstration 2: repair what was already paid** (`scripts/e2e-repair.mjs`). This is a *separate* order, captured **outside** Kept's checkout (Demo tools → *Add an order captured outside Kept's checkout*), so no pre-capture check could stop it.

1. Kept receives `PAYMENT.CAPTURE.COMPLETED` and re-fetches the capture with `GET /v2/payments/captures/{id}`. It then extracts and validates the promises:

   | Promise | Kept's decision |
   |---|---|
   | $84 total | **enforceable** |
   | 48-hour shipping | **enforceable** |
   | "We'll sort you out" | **unverifiable**, never enforced |

2. The deterministic evaluator computes **$93.33 − $84.00 = $9.33** and marks the promise **BROKEN**. A **$9.33 partial refund** is proposed and checked by the policy engine.
3. The merchant sees *Said / Seal / Happened* and the **exact PayPal request**, and approves.
4. Kept refunds with a stored `PayPal-Request-Id` and confirms with `GET /v2/payments/refunds/{id}`. The receipt reads *Broken · made good*.

The other scenarios are covered by tests and reachable in the UI:

- a matching-price order is KEPT;
- a shipping deadline goes AT_RISK and then BROKEN (simulated clock);
- a refund fails, or stays PENDING;
- a duplicate webhook is ignored;
- a remedy is rejected;
- disputes are answered from the ledger;
- a lost webhook is recovered by reconciliation.

---

## The capture gate (pre-capture verification)

`lib/services/preflight.ts` and `captureKeptOrder` in `lib/services/orders.ts`.

**What the gate compares.** It fetches the **authoritative** PayPal order and reads `purchase_units[0].amount`. It compares that with the enforceable total the assistant promised, read from the immutable chat source by the same rules extractor and validator Kept uses after capture, in integer minor units.

| Verdict | When | Capture? |
|---|---|---|
| `READY_TO_CAPTURE` | Promised total equals the order amount and currency, or no enforceable total was promised (an approximate "about $84", an item price, or nothing at all is never treated as an exact total) | Yes |
| `BLOCKED_MISMATCH` | The order is **more** than promised, or in another currency | No. The merchant corrects the order; the buyer approves the new amount |
| `NEEDS_CONFIRMATION` | The order is **less** than promised, or the chat states conflicting totals | No, until the merchant confirms this exact order (bound to its digest) |
| `PRECHECK_FAILED` | The PayPal GET failed or was unreadable, the buyer hasn't approved, or the order isn't bound to this Kept order (`custom_id`) | No. A failure is never a pass |

**How capture runs.**

1. **Atomic claim:** one conditional `UPDATE`, so duplicate requests can't both proceed.
2. **Fresh check:** a new authoritative GET every time. A verdict is bound to a SHA-256 digest of the order's money-relevant fields, so an order changed after verification is caught. Verdicts expire after 10 minutes.
3. **Write-ahead:** `capture.requested` is written to the hash-chained audit log before the PayPal call.
4. **Capture:** with a `PayPal-Request-Id` per PayPal order.
5. **Confirm:** GET the capture.

There is **no override** that captures an amount the buyer didn't approve. These patterns were adapted from Graphite's execution boundary: [`docs/GRAPHITE_ADAPTATION.md`](docs/GRAPHITE_ADAPTATION.md).

**Boundary.** Kept can block only in a checkout where Kept performs the capture. Orders captured elsewhere (`checkoutChannel = EXTERNAL`) are checked and recorded, then monitored and repaired after payment.

## Before the buyer pays: the price check

The cheapest broken promise is the one that never happens. When the bag is ready, Kept reads the chat with the same deterministic extractor and validator it uses after capture. No model is involved. It then compares the assistant's promised total with what checkout will ask PayPal to charge. The merchant chooses what happens in **Settings**:

| Mode | What happens |
|---|---|
| **Block** (default) | The buyer is warned in the bag, and the capture gate above refuses a mismatched capture. |
| **Warn** | Monitor-only checkout. The buyer sees the difference before paying: *"The assistant told you 'Your total is $84.00.' but checkout is $93.33."* Kept records the warning, and after capture the promise is enforced as usual. |
| **Honour** | Kept creates the PayPal order at the promised total, with the difference as a labelled order `discount` in the breakdown. Only when the promised total is exactly what the merchant's own published pricing gives for this cart, and within the maximum single refund. A stale quote (the cart changed after the assistant spoke) or a made-up number is never honoured automatically; it falls back to Warn. |
| **Off** | No pre-payment check. Promises are still verified after capture. |

Either outcome is audited and appears on the customer's receipt. The test suite covers stale quotes, made-up quotes, hedged quotes, the refund cap, customer-written "quotes", and an end-to-end Honour flow ($84.00 captured, promise KEPT, no refund needed).

## Kept Intelligence (AG Grid + AG Studio)

- **AG Grid ledgers.** The merchant console's promises inbox, orders and activity trail are AG Grid tables (Community, MIT), themed with Kept's design tokens. They support sorting, per-column filters and search across every column. Rows open the order ledger.
- **Commitments grid columns:** quote, type, promised and actual (PayPal) value, currency, deadline, state, verification source, last updated. It also has pagination and a column chooser.
- **AG Studio report.** `/merchant/analytics` ("Kept Intelligence") is an AG Studio report over Kept's persisted records: orders, promises, pre-capture checks, remedies, refunds, PayPal events and the last AI evaluation, related by order, with a currency filter. It shows:
  - **promise health:** kept as promised and kept or made good (over *resolved* promises), at risk, broken;
  - **prevention:** pre-capture checks, verified, blocked in the protected checkout, value stopped before capture;
  - **recovery:** remedies proposed and approved, refunds completed, pending and failed;
  - **AI quality:** extracted, needs confirmation, unverifiable, extraction failures, evaluation results;
  - **payment operations:** events and processing failures.

  A test checks the figures against database aggregates. Money is never summed across currencies.
- **Not shipped:** the AG Studio read-only analytics agent. It needs a Claude adapter that can't be verified without an API key; see the evidence report.

  The merchant can switch to **Edit** and build their own widgets from the same data. Colours are deliberately non-semantic, because AG Studio assigns them by category order. Without an `AG_STUDIO` licence key it runs in evaluation mode (watermark).

## Where the AI earns its place: the evaluation

The demo runs without an API key, so here is the honest question: what does Claude add over the rules? [`tests/fixtures/ai-eval.ts`](tests/fixtures/ai-eval.ts) has 20 cases of three kinds:

- **Beyond the rules:** 8 cases, 11 promises. Real promises the rules extractor misses:
  - a total and a shipping time in one sentence;
  - a second amount in the sentence;
  - "posted" or "send it out" instead of "ship";
  - a refund promise after a price;
  - Nigerian Pidgin ("Your total na $84.00, and we go ship am within 48 hours").
- **Controls:** 4 plain promises both should find.
- **Traps:** 8 statements that must never become promises:
  - customer words;
  - "should", "I think", "maybe";
  - Pidgin "e fit ship" (fit = can/might);
  - "plus shipping";
  - pounds on a dollar order;
  - prompt injection.

`npm test` checks every premise before any model runs. A correct extraction passes the validator in every "beyond" case, the rules really do miss each one, the rules find every control, and every careless extraction of a trap is blocked. `npm run eval:ai` then runs rules and Claude through the same validator.

| | Beyond-rules promises | Controls | False promises on traps |
|---|---|---|---|
| Validator ceiling (perfect extraction) | 11/11 | 4/4 | 0 |
| Rules extractor | **3/11** | 4/4 | 0 |
| Claude | *not yet run* | | |

**The evaluation found a real bug.** Before it existed, "I think it ships within 48 hours", "Maybe your total go be $84.00" and "E fit ship within 48 hours" were accepted as enforceable promises. The validator now treats opinion words and the Pidgin modal "fit" as hedges. The Claude extractor's prompt was revised at the same time with general guidance (one candidate per promise, clause-level quotes, Pidgin hedges). Pidgin cases were written by the developer and should be reviewed by a native speaker.

## Tamper-evident evidence

- **Hash-chained audit log.** Every audit entry is linked to the one before it by SHA-256. There is one chain per order (`lib/ledger/chain.ts`), and merchant-level entries share one. Editing, deleting or reordering any past entry breaks every hash after it. A per-chain advisory lock and a unique `(merchant, order, seq)` index make a forked chain impossible; a test with 25 concurrent writers checks this.
- **Evidence pack.** The order ledger offers **Download evidence pack**: one JSON file with:
  - the fingerprinted sources (chat, mandate and the policies behind each promise);
  - every promise and how it was judged;
  - the PayPal-confirmed facts and the remedies;
  - the chain itself.

  `npx tsx scripts/verify-evidence.ts pack.json` re-verifies it offline, with no database or server.
- **External anchors.** A chain alone can't prove that the newest entries weren't cut off, so Kept hands its head hash to others:
  - the customer's receipt shows the current **evidence fingerprint**;
  - dispute evidence that Kept sends to PayPal includes it, so a third party holds an anchor of the record.

## A promise record for shoppers' AI agents (MCP)

- **What it is.** Before an AI agent buys, it can check how often the shop keeps its word.
- **How it's computed.** Only from outcomes that deterministic code judged against PayPal records:
  - kept as promised, made good, or still broken, overall and per promise type;
  - small samples and simulated data flagged;
  - every order's audit chain re-verified on each request.

  It contains aggregates only, with no customer, order or chat data.
- **Where to get it:**
  - **MCP** (Streamable HTTP, stateless): `POST /api/mcp`, read-only tool `get_promise_record` with `{"merchant":"adaeze-studio"}`. Checked with the official MCP SDK client: `npm i --no-save @modelcontextprotocol/sdk@1 && node scripts/mcp-check.mjs`.
  - **JSON:** `GET /api/promise-record/adaeze-studio` (CORS-open, rate-limited).
  - **For people:** `/record/adaeze-studio`.
- **Kept's own shopper agent** checks the record before negotiating. A mandate such as *"only buy from a shop that keeps at least 90% of its promises"* becomes a deterministic check. It declines with fewer than 10 resolved promises, a failed audit chain, or a rate below the bar; hedged wording is not enforced.

## Agent-to-agent commerce: "Send my AI agent"

AI agents are starting to buy on people's behalf. When the shopper's agent talks to the merchant's agent, two sets of promises matter:

- what the **merchant's agent** said ("Your total is $84.00");
- what the **shopper told their own agent** ("Keep the total under $90 and it must ship within 2 days").

Kept treats both as evidence.

1. On `/store`, choose **Send my AI agent** and write a mandate. The shopper's agent (Claude with tools, or a labelled scripted fallback) picks the product and shipping, and asks the merchant's assistant for a total and a ship time.
2. **A deterministic guard, not the model, is the only thing that can clear the purchase.** It checks four things:
   - the mandate has a hard limit;
   - the merchant committed to an explicit total in writing;
   - the quoted total is within the limit (strict for "under", inclusive for "no more than");
   - the merchant's shipping promise is within the limit.

   If any check fails, the result is DECLINE and no pay button appears. If all pass, the shopper still approves the payment in PayPal themselves. The agent never holds credentials or moves money.
3. The mandate is stored as an immutable `USER_MANDATE` source. It becomes `MANDATE_MAX_TOTAL` and `MANDATE_SHIP_WITHIN` commitments, which go through the same validator:
   - mandates can only come from the shopper's words;
   - merchant promises can never come from them.
4. After capture, the evaluator checks the mandate against PayPal's records and **attributes fault**:
   - **merchant**: the agent was quoted within the limit, but PayPal captured more;
   - **agent**: the agent accepted an over-limit quote.
5. A mandate has no remedy of its own. It is made good through the merchant promise it depends on. In the demo, the $9.33 refund brings the net back to $84.00, and the mandate shows **Broken · made good**.

## Disputes, answered from the ledger

When PayPal reports a dispute (`CUSTOMER.DISPUTE.CREATED`, re-fetched with `GET /v1/customer/disputes/{id}`), Kept already has the promise ledger. It proposes a response chosen by **deterministic rules**:

| Situation (from PayPal records) | Proposed response | PayPal Disputes API call |
|---|---|---|
| "Not received", with a tracker PayPal recorded | Proof of fulfilment (carrier + tracking number + factual note) | `POST /v1/customer/disputes/{id}/provide-evidence` (multipart) |
| "Not received", no tracker, inquiry stage | Refund offer of the remaining refundable amount | `POST …/make-offer` (`offer_type: REFUND`) |
| Price promise BROKEN and not yet made good, inquiry stage | Refund offer of **exactly** the deterministic overcharge | `POST …/make-offer` |
| Anything else (e.g. already refunded) | A factual message citing the promises and PayPal records | `POST …/send-message` |

- **Every response is a remedy.** It is policy-checked, shown with the exact Disputes API request, editable, and sent **only after the merchant approves it**.
- **An offer moves no money by itself.** Money moves only if the buyer accepts it in PayPal. Kept then reports the refund PayPal records.
- **Scoped, truthful evidence.** The note contains only verbatim promises and PayPal records relevant to the dispute's reason.
- **Try it.** In simulated mode, the order page has **Play the buyer: open a dispute**. In the sandbox, open the dispute as the buyer in PayPal's Resolution Center.
- **Supersession.** A dispute response supersedes any still-PROPOSED remedy on the same promise, so the buyer is never paid twice.

---

## Quick start (local, no credentials needed)

Requirements: Node 20.11+ and PostgreSQL 14+. A throwaway local Postgres 16 helper is included.

```bash
npm install
scripts/local-postgres.sh          # or point DATABASE_URL at Neon / your own Postgres
cp .env.example .env               # then set SESSION_SECRET (32+ random chars) and MERCHANT_PASSCODE
npm run db:migrate && npm run db:seed
npm run build && npm start         # http://localhost:3000
```

With no PayPal credentials, Kept runs in **`PAYPAL_MODE=simulated`**.

- It uses a small in-process PayPal emulator (`lib/paypal/emulator.ts`) that implements the same REST endpoints.
- **Every simulated thing is labelled.** A banner reads *SIMULATED PAYPAL — no PayPal involved*. Events show as *SIMULATED (unsigned)*. The checkout button reads "Pay with simulated PayPal".
- Simulated events are refused in sandbox/live mode.

With no `ANTHROPIC_API_KEY`, Kept falls back to clearly labelled deterministic alternatives. The validator and policy engine are the same in both modes:

| Component | Fallback |
|---|---|
| Sales assistant | Scripted assistant |
| Promise extraction | Rule-based extractor |
| Remedy proposal | Rule-based proposals |

Demo walk-through (the in-app version, with all three scenarios, is at **`/tour`**):

1. Open `/store`. Add the Ada Wrap Dress, choose **Express**, and ask *"What's my total with express shipping?"*. Pay.
2. Open `/merchant` (passcode from `.env`). You'll see the **BROKEN** promise. Open it and approve the **$9.33** refund.
3. Open the customer receipt link.

**Demo tools** (merchant header, `DEMO_MODE` only):

- advance the **simulated clock** (shipping-deadline demo);
- settle pending refunds (simulated mode);
- reset demo data.

---

## Running against the real PayPal sandbox

1. **Create a sandbox app.** In developer.paypal.com → Apps & Credentials → **Sandbox** → create an app. Copy the Client ID and Secret.
2. **Create sandbox accounts.** Under Testing Tools → Sandbox Accounts, make sure you have a **Business** account (the merchant) and a **Personal** account (the buyer). The country can be US. Your own country doesn't matter for sandbox accounts.
3. **Configure the environment.** In `.env`:
   ```
   PAYPAL_MODE=sandbox
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   NEXT_PUBLIC_PAYPAL_CLIENT_ID=...   # same client id; it is public by design
   APP_BASE_URL=https://<your public https host>
   ```
4. **Run the smoke test** (no buyer interaction):
   ```bash
   npx tsx scripts/sandbox-smoke.ts
   ```
   It checks four things:
   - the OAuth token is acquired;
   - order creation with `custom_id`;
   - `PayPal-Request-Id` idempotency (the same id returns the same order);
   - PayPal refusing capture before buyer approval.
5. **Register the webhook.** PayPal only delivers to public HTTPS on port 443. Deploy (below) or use a tunnel, then:
   ```bash
   npm run paypal:webhook:register     # prints PAYPAL_WEBHOOK_ID=WH-...
   ```
   Set `PAYPAL_WEBHOOK_ID` and restart. Subscribed events:

   | Group | Events |
   |---|---|
   | Checkout | `CHECKOUT.ORDER.APPROVED` |
   | Capture | `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED` |
   | Refund | `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.FAILED` |
   | Dispute | `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED` |

   Webhook-simulator events from the PayPal dashboard **cannot be signature-verified** (PayPal limitation). Use real sandbox transactions.
6. **Run the loop.** Pay at `/store` with the **sandbox Personal** account in the PayPal popup, then approve the remedy in `/merchant`.
7. **Negative tests.** The remedy sheet can send `PayPal-Mock-Response: REFUND_FAILED_INSUFFICIENT_FUNDS` (sandbox only).
8. **Disputes.** Log into sandbox.paypal.com as the Personal buyer → Resolution Center → open a dispute on the payment. Kept ingests `CUSTOMER.DISPUTE.CREATED` with an authoritative `GET /v1/customer/disputes/{id}`.

**Reconciliation.**

- Schedule `POST /api/cron/reconcile` with `Authorization: Bearer $CRON_SECRET` every few minutes (Render Cron Job or any scheduler). The merchant header's **Check PayPal now** button does the same.
- It covers:
  - orders with no capture;
  - PENDING captures and refunds;
  - failed events;
  - remedies stuck in EXECUTING. These are retried with the **same** `PayPal-Request-Id`, never a new refund.
  - time-based promises.

---

## Deploying (Render + Neon, free tiers)

1. **Neon.** Create a project and copy the connection string (`...?sslmode=require`). Neon's free tier does not expire. Render's free Postgres expires after 30 days.
2. **Render.** New → **Blueprint** → this repo (uses `render.yaml`). Fill in the `sync: false` variables:
   - `DATABASE_URL`
   - `APP_BASE_URL`
   - the PayPal variables
   - `MERCHANT_PASSCODE`
   - optionally `ANTHROPIC_API_KEY`
3. **Migrate and seed.** The `preDeployCommand` runs `db:migrate && db:seed`.
4. **Webhook.** After the first deploy, run `npm run paypal:webhook:register` locally with `APP_BASE_URL` set to the Render URL. Put the id into `PAYPAL_WEBHOOK_ID` on Render.
5. **Health.** `GET /api/health` reports DB status, PayPal mode, whether a webhook id is configured, and the AI model.

Render free instances sleep when idle. PayPal retries webhooks for up to 3 days, and reconciliation covers any gaps.

---

## Architecture

```
app/(store)/store          storefront + AI sales chat + PayPal JS SDK buttons
app/merchant/(console)     promises inbox · order ledger (Said | Seal | Happened) · remedy sheet · settings · activity
app/r/[token]              customer living receipt (256-bit random token, mobile-first)
app/api/...                route handlers (chat, orders, capture, webhooks, merchant actions, cron)

lib/paypal/   client.ts (OAuth cache, retries, PayPal-Request-Id) · api.ts (Orders v2, captures, refunds,
              tracking, disputes + strict parsers) · webhook-verify.ts · emulator.ts (labelled, simulated mode only)
lib/promises/ transcript.ts · rules-extractor.ts · llm-extractor.ts (Claude, structured outputs) · validator.ts
lib/ledger/   evaluator.ts   — pure, deterministic state machine (no I/O, no AI, integer money)
lib/policy/   engine.ts      — deterministic remedy validation
lib/ai/       assistant.ts (sales chat, quote tool) · remedy-agent.ts (read-only tools → propose_remedy)
              buyer-agent.ts (shopper's agent + deterministic mandate guard)
lib/services/ orders · checkout-guard (pre-payment price check) · ledger · remedies · disputes (answered from the ledger)
              webhooks · pipeline (reconcile) · merchant-actions · views · analytics · chat
components/   ledger-grid.tsx (AG Grid) · seal · money · mode-banner
app/merchant/(console)/analytics   AG Studio promise-health report
lib/db/       Drizzle schema (Postgres) — drizzle/ holds migrations
```

**Who decides what**

| Concern | Decided by |
|---|---|
| Whether a promise exists and its wording | Extractor (Claude or rules) proposes; **the validator decides** |
| Payment, refund, tracker and dispute state | **PayPal only**, always re-fetched with GET; webhook bodies are never trusted |
| Discrepancy, deadlines, states | **Deterministic evaluator** (integer minor units) |
| Remedy wording | AI agent (read-only tools) or rules |
| Whether a remedy is allowed | **Policy engine** (type allowed, amount ≤ computed discrepancy, ≤ remaining refundable, ≤ policy cap, currency, capture refundable, no other remedy live) — checked at proposal *and* again at approval |
| Whether checkout warns or honours a promised total | **Deterministic price check** under the merchant's chosen mode |
| Whether a shopper's agent may proceed to payment | **Deterministic mandate guard**; the shopper still approves in PayPal |
| Which dispute response to propose | **Deterministic rules** over PayPal records and the ledger |
| Whether money moves | **The merchant**, with an explicit click, after seeing the exact PayPal request |

**Promise validation.** An extracted promise is enforceable only if **all** of the following hold. Otherwise it is *needs confirmation*, *unverifiable* (OTHER), or *rejected* (not anchored to a real source; never stored).

1. The source exists and belongs to the order or merchant.
2. The quote appears **verbatim** in the source. Spans are re-derived by the validator, never trusted from the extractor.
3. In a chat, the quote was said by the **assistant**. Transcript lines are role-tagged by Kept, so customer text cannot forge an assistant line.
4. The numbers are re-parsed from the quote. The extractor's own numbers are only hints.
5. The currency matches the order.
6. There is no hedging ("about", "up to", "usually"…). For prices, there is explicit **total** semantics and no exclusions. Business-day, relative-weekday and numeric-date deadlines are not enforced.
7. Extractor confidence meets the merchant threshold.
8. It does not conflict with another promise of the same type.

**Refund execution.**

- **Atomic claim.** `PROPOSED → EXECUTING` is a single conditional `UPDATE`, so two clicks or two tabs cannot both execute. A partial unique index allows only one live remedy per commitment.
- **Idempotent at PayPal.** `PayPal-Request-Id` is generated once at proposal time and reused on any retry.
- **POST is not trusted.** The POST result is never trusted alone; a `GET /v2/payments/refunds/{id}` confirms it, and the webhook reconciles again.
- **Honest states.** `PENDING` is shown as pending. A 4xx is `FAILED` with PayPal's issue code. A network error or 5xx stays `EXECUTING` and is retried with the same request id.

**Webhook processing.** Steps 1–4 happen before the response; steps 5–6 run after it.

1. Read the raw body.
2. Verify the signature locally: CRC32 + RSA-SHA256 over `transmissionId|time|webhookId|crc32(body)`, using a certificate fetched **only** from `*.paypal.com`. If the certificate can't be fetched, fall back to `POST /v1/notifications/verify-webhook-signature`. Stale transmissions are refused.
3. Reject an invalid signature with 400. Nothing is written.
4. `INSERT … ON CONFLICT (paypal_event_id) DO NOTHING`, then return 200.
5. Re-fetch the resource and process it idempotently.
6. Evaluate, propose and audit.

---

## Security decisions

- **Secrets.** PayPal and Anthropic secrets are used only server-side. The browser receives only the PayPal **client id**. The client bundles were checked for secret names.
- **Merchant access.**
  - It is gated by an HMAC-signed, HttpOnly, `SameSite=Strict` cookie. Every state-changing merchant route also checks the request's origin and that the merchant owns the record.
  - **Demo-grade only**: one shared passcode.
- **Rate limits.** Chat, checkout and login are rate-limited using a Postgres fixed window, which works across instances.
- **Customer data.**
  - Buyer email is stored only redacted (`j***@domain`).
  - Email addresses and phone numbers are scrubbed from chat text before it reaches the AI provider.
- **Model safety.**
  - Model outputs are schema-validated (zod / structured outputs).
  - The remedy agent has **no** money-moving tool.
  - Customer messages are treated as data. Prompt-injection cases are in the golden set.
- **Money handling.**
  - Money is always integer minor units.
  - Amounts are parsed from PayPal decimal strings without float conversion.
- **Receipts.** Receipts use 256-bit random tokens, are marked `noindex`, and expose no merchant internals.
- **HTTP headers.** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and no `X-Powered-By`.

---

## Tests

```bash
npm test                 # unit + golden set + end-to-end flow (needs TEST_DATABASE_URL; uses the emulator)
npm run lint             # TypeScript strict type-check
node scripts/e2e-ui.mjs     # Playwright drive of the full demo against a running instance (BASE_URL, MERCHANT_PASSCODE)
node scripts/e2e-agent.mjs  # Playwright drive of the agent-to-agent demo (declined mandate, cleared mandate, refund, receipt)
node scripts/e2e-dispute.mjs # Playwright drive of a dispute answered from the ledger (tracking → simulated buyer dispute → evidence approved → UNDER_REVIEW)
npm run eval:extraction  # runs the REAL Claude extractor over the golden set (needs ANTHROPIC_API_KEY)
npm run eval:ai          # AI-vs-rules evaluation through the validator; Claude column needs ANTHROPIC_API_KEY
npx tsx scripts/verify-evidence.ts <pack.json> [fingerprint]   # verify a downloaded evidence pack offline
```

- **Golden set** (`tests/fixtures/golden-promises.ts`): 39 adversarial cases (46 assertions), including 6 shopper-mandate cases. Covers:
  - "about/up to/usually";
  - item price vs total;
  - £ vs a USD order;
  - two currencies;
  - "plus shipping";
  - business days;
  - "by Friday" and "by 11/12";
  - conditional refunds;
  - fabricated and paraphrased quotes;
  - customer-said "promises";
  - prompt injection inside a customer message;
  - extractor/quote number mismatches;
  - conflicting totals;
  - low confidence;
  - foreign-order sources;
  - wrong spans;
  - mandates: strict ("under") vs inclusive ("no more than") limits, hedged mandates ("around", "ideally"), a mandate claimed from the merchant's chat, and a merchant promise claimed from the shopper's mandate.

  The bar: ≥90% correct and **zero** false or fabricated enforceable promises.
- **End-to-end flow** (`tests/flow.test.ts`, real Postgres + emulator):
  - the $84/$93.33/$9.33 loop;
  - concurrent double approval → exactly one refund;
  - duplicate webhooks;
  - refund failure;
  - pending refund;
  - rejection;
  - shipping deadline AT_RISK → KEPT;
  - invalid signature;
  - custom_id binding;
  - disputes;
  - lost-webhook reconciliation;
  - price check before payment: Honour creates the PayPal order at $84.00 (promise KEPT, no refund), and Warn is recorded and still caught after capture;
  - agent-to-agent: mandate cleared, then broken by the capture, blamed on the merchant, and made good by the refund; over-limit quote declined before payment; no payment without a PROCEED verdict;
  - disputes answered from the ledger: proof of fulfilment submitted after approval; refund offer for a broken price promise; no Disputes API call without approval.

---

## Limitations

- **The PayPal sandbox loop has not been run end-to-end by the author.** This repository was built without sandbox credentials.
  - The PayPal client, request shapes and parsers follow PayPal's OpenAPI specs.
  - Real-API connectivity is verified: the real sandbox OAuth endpoint correctly rejects fake credentials.
  - Run `scripts/sandbox-smoke.ts` and one store purchase with your credentials before relying on it.
- **Tracking.** A PayPal tracker proves the merchant *reported* a shipment, not delivery. Kept says so wherever it is shown. Carrier delivery data is out of scope.
- **Refund promises.** REFUND_BY needs the merchant to record the trigger (e.g. "return received"). Kept does not observe returns.
- **The golden set was written alongside the validator.** It is a regression and adversarial suite, not an independent benchmark. `eval:extraction` measures the real LLM extractor.
- **Single-merchant demo.** There is no production authentication, multi-tenancy, email sending, or chargeback representment.
- **Simulated mode.** The emulator's PayPal fee figures are illustrative. Simulated events are unsigned and only accepted in simulated mode.
- **Disputes API calls are emulator-tested only.** The `make-offer`, `provide-evidence` and `send-message` request shapes follow PayPal's Disputes API reference. They have not been exercised against a real sandbox dispute yet.
- **Agent mode is a demo of the pattern, not an agent-payments protocol.** The shopper's agent talks to the merchant's assistant inside this app. Kept does not implement an external agent-payments protocol. The PayPal Agent Toolkit was evaluated and not used: its dependencies conflicted with this stack, and Kept needs its own idempotency and verification around every PayPal call.
- **AI choice.** Claude is called through the official Anthropic SDK (not the Vercel AI SDK suggested in the original spec), so structured outputs and refusal fallbacks are first-class. Default model: `claude-opus-5-5`. Set `KEPT_AI_MODEL=claude-haiku-5-5` for a lower cost per call.

## Licence

[MIT](LICENSE)
