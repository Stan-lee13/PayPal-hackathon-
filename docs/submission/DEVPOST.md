# Devpost write-up: Kept (draft)

> Paste each section into the matching Devpost field. Fill in the bracketed placeholders, `[LIKE THIS]`, before submitting. Remove any sentence that stops being true of the build you submit.

**Tagline (≤ 60 chars):** Every payment is a promise. Kept makes sure it's kept.

**Short description:** Kept binds every PayPal payment to the promises that justified it, said by a merchant, its AI assistant, or a shopper's own AI agent. It watches PayPal's records and proposes a fix the merchant approves when they disagree.

---

## Inspiration

In February 2024, a Canadian tribunal ordered Air Canada to compensate a customer after its website chatbot promised a bereavement refund the airline didn't offer (*Moffatt v. Air Canada*, 2024 BCCRT 149). Air Canada argued it wasn't responsible for its chatbot. The tribunal disagreed.

A year later, the Washington Post reported that an AI shopping agent told its user a grocery order cost $19.68 when the actual charge was $31.43.

The pattern is the same each time. Something, increasingly an AI, makes a promise about money. Then the payment happens somewhere else, and nobody checks one against the other. The payment record is precise: captured, refunded, disputed. The *reason* the money moved is recorded nowhere.

I'm building from Lagos. PayPal reopened incoming payments for Nigerians through Paga in January 2026. For a new seller here selling abroad, one avoidable dispute can mean held funds. I wanted the payment to remember what was promised.

## What it does

Kept is a promise-verification layer for merchants paid through PayPal.

1. **Captures the promise.** It reads the sales chat (human or AI), the refund policy, and, in agent mode, the shopper's own instructions to their AI agent. It turns verifiable statements into structured commitments bound to the PayPal order through `custom_id`:
   - *price as quoted*;
   - *ships within N hours*;
   - *refund within N days*;
   - *the shopper's spending and shipping limits*.
2. **Validates before enforcing.** A promise is enforceable only if:
   - its exact words appear verbatim in the source;
   - it was said by the right party;
   - its numbers re-parse from the quote;
   - it has no hedges ("about", "usually", "up to").

   Vague promises like "we'll sort you out" are marked unverifiable and never enforced.
3. **Watches PayPal.** Signed webhooks are verified (CRC32 + RSA-SHA256), deduplicated, and never trusted alone: Kept re-fetches every capture, refund, tracker and dispute with an authoritative GET.
4. **Evaluates deterministically.** Pure code, integer cents: $84.00 promised vs $93.33 captured is **BROKEN** by $9.33. A shipping promise with a PayPal tracker added before the deadline is **KEPT**.
5. **Proposes a remedy; a person approves it.**
   - An AI agent with read-only tools (or a rules fallback) drafts the remedy.
   - A policy engine independently checks it: the amount must be no more than the computed gap and the remaining refundable amount, and within the merchant's cap.
   - The merchant sees the **exact PayPal request** and clicks once.
   - The refund uses a stored `PayPal-Request-Id` and is confirmed by GET.
6. **Tells the customer.** A living receipt (mobile-first, 256-bit link) shows what was promised, what PayPal recorded, and where the money is. "Refunded" appears only after PayPal confirms it.

**Agent-to-agent commerce.**

- The shopper can send their own AI agent to buy. The agent negotiates with the merchant's assistant.
- **A deterministic guard, not the model**, decides whether every hard limit in the shopper's mandate is met by what the merchant committed to in writing. Only then can the shopper approve the payment in PayPal themselves.
- If PayPal then charges more, Kept attributes the fault (merchant vs agent), and one refund repairs both promises.

**Dispute shield.**

- When a buyer opens a PayPal dispute, Kept already holds the ledger. Deterministic rules pick an honest response:
  - proof of fulfilment if PayPal has a tracker;
  - a refund offer if not, or if the price promise was broken;
  - a factual message otherwise.
- The response is sent through the PayPal Disputes API only after the merchant approves it. Kept never fakes a defence.

## How we built it

- **App:** Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4. PostgreSQL with Drizzle ORM. Vitest and Playwright.
- **PayPal (REST, server-side only):**
  - OAuth client credentials;
  - Orders v2 (`custom_id`, `invoice_id`, an amount breakdown) and the JS SDK buttons;
  - capture;
  - partial refunds with `PayPal-Request-Id` idempotency and a `GET /v2/payments/refunds/{id}` confirmation;
  - order tracking (`/v2/checkout/orders/{id}/track`);
  - Disputes API: `GET`, `make-offer`, multipart `provide-evidence`, and `send-message`;
  - webhook registration and local signature verification, with a fallback to `verify-webhook-signature`.
- **AI:** Claude, via the official Anthropic SDK with structured outputs (zod schemas) and strict tools. It is used for:
  - the merchant's sales assistant (with a deterministic `get_quote` tool, so the AI never does arithmetic);
  - promise extraction;
  - the shopper's agent;
  - remedy drafting.

  **No model output is ever a payment fact, a money amount Kept trusts, or a decision to move money.**
- **Who decides what:**

  | Decision | Decided by |
  |---|---|
  | Is it a real promise? | The validator |
  | What did PayPal do? | PayPal, re-fetched |
  | How big is the gap? | The evaluator |
  | May the agent pay? | The guard |
  | Is the remedy allowed? | The policy engine |
  | Does money move? | The merchant |
- **Reliability:**
  - Remedy execution is claimed atomically (`PROPOSED → EXECUTING` in one conditional UPDATE), so two clicks can't refund twice.
  - A partial unique index allows one live remedy per promise.
  - Network errors keep the remedy EXECUTING; it is retried with the same request id.
  - A reconciliation job recovers lost webhooks.
- **Simulated mode:** an in-process PayPal emulator implementing the same endpoints, so judges can run the full loop with no credentials. It is labelled on every screen, and its unsigned events are refused in sandbox and live modes.

## Challenges we ran into

- **Making "the AI said it" auditable.** LLM extraction alone is not evidence, so every promise is re-anchored to a verbatim span by code. The extractor's numbers are only hints. A golden set of 39 adversarial cases (46 assertions) covers:
  - "about $84";
  - "$84 plus shipping";
  - £ on a USD order;
  - business days;
  - customer text posing as the assistant;
  - prompt injection;
  - shopper-mandate edge cases.

  The bar is **zero** false or fabricated enforceable promises.
- **Not trusting PayPal's POST responses, or its webhooks, alone.** Every state is confirmed with a GET, and a refund that PayPal reports as PENDING is shown as pending, never as done.
- **Agent blame.** When two agents negotiate and the charge is wrong, whose fault is it? Kept compares the shopper's limit, the merchant's written quote and PayPal's capture. Only then does it attribute.
- **Disputes without spin.** It would be easy to auto-generate a persuasive defence. Kept only submits evidence PayPal itself recorded, scoped to the dispute's reason. Without that evidence, it recommends the refund.

## Accomplishments that we're proud of

- **The whole loop works end to end:** promise → extraction → validation → PayPal binding → verified events → evaluation → remedy → human approval → PayPal execution → confirmation → customer receipt.
- **89 automated tests**, including concurrent double-approval (exactly one refund), duplicate webhooks, refund failure and pending, lost-webhook recovery, agent-to-agent blame, and three dispute-shield flows.
- **Three Playwright browser runs**, one per demo scenario.
- **A two-sided product, not a dashboard:** a merchant ledger (Said / Seal / Happened), a remedy sheet that shows the exact PayPal request, a shopper-agent mode, and a customer receipt that works on a 360 px phone.

## What we learned

The hard part of AI commerce isn't getting an agent to buy something. It's knowing, afterwards, whether what was said matches what was charged, and proving it. That needs boring, deterministic machinery around the model:

- verbatim anchors;
- integer money;
- idempotency keys;
- authoritative GETs;
- a human click.

## What's next

- Run the full loop on PayPal sandbox with signed webhooks (and live, with a pilot merchant).
- A read-only endpoint so a shopper's agent can check a merchant's promise record before buying.
- More promise types (delivery-by-date with carrier data; subscription-price promises).
- Real multi-merchant auth.

## Built with

`paypal-orders-v2` `paypal-payments` `paypal-disputes-api` `paypal-webhooks` `paypal-js-sdk` `claude` `anthropic-sdk` `next.js` `react` `typescript` `postgresql` `drizzle` `tailwind` `vitest` `playwright` `render` `neon`

---

## Honesty box (keep this in the submission)

| Claim | Status at submission |
|---|---|
| Full loop in simulated mode (labelled emulator) | Verified by the 89 tests and three Playwright runs |
| PayPal sandbox: OAuth, orders, capture, refund, tracking, webhooks | `[VERIFIED on DATE / NOT YET RUN]` |
| PayPal Disputes API (`make-offer`, `provide-evidence`) on a real sandbox dispute | `[VERIFIED on DATE / emulator-tested only]` |
| Live Claude calls (assistant, extractor, shopper agent, remedy agent) | `[VERIFIED: eval:extraction score X/46 / fallbacks only]` |
| Deployment | `[URL, verified with /api/health on DATE]` |
| Production readiness | **Not claimed.** MVP with a demo passcode and one demonstration merchant (Adaeze Studio). |

**Try it:** `[LIVE URL]/tour` · merchant passcode: `[PASSCODE]` · repo: `[REPO URL]` (MIT)
