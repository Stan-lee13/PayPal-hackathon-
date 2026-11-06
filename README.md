# MergePay

**Get paid before you merge.**

MergePay lets a freelance developer bill a client for a GitHub pull request without leaving the editor. Ask the agent in Cursor or Claude Code to "bill this PR". MergePay:

1. Drafts a PayPal invoice, priced from what the client agreed to.
2. Sends it once the developer says so.
3. Merges the pull request the moment PayPal confirms the invoice is paid in full.

```
 editor agent ──MCP──▶ draft_invoice ──▶ send_invoice ──▶ PayPal emails the client
                         │  prices: contract       │                │ client checks preview, pays
                         │  words: Claude / rules  │                ▼
                         │  scope check            │     INVOICING.INVOICE.PAID webhook (signature-verified)
                         ▼                         ▼                │
                   developer reviews      PR comment: "invoice sent" ▼
                                                    GET invoice from PayPal: PAID, $0 due?
                                                                    │ yes
                                                                    ▼
                                         merge exactly the invoiced commit ──▶ PR comment: "paid, merged"
```

**Try it:** open `/demo` on the running app. It's the same agent conversation, in the browser, calling the same tools over the same code path as the editor. No install or sign-in needed.

> Built for the PayPal AI Hackathon 2026. The demo freelancer (Tobi Adeyemi), client (Funmi Bello of Lagos Roast Coffee) and repository are fictional. Every page says whether PayPal and GitHub are real (sandbox / live API) or the built-in simulators.

## Why it's safe to let an agent do this

An agent that moves money and touches a client's code has to be boring about both.

| Guarantee | How |
|---|---|
| **The contract sets the numbers** | `lib/agent/pricing.ts` is the only place an amount is decided. It works from the agreed price per issue, or the hours the developer states × the agreed rate. Claude writes descriptions and a scope check only. A validator throws out any AI text that mentions money, names files the PR doesn't change, or claims issues the PR doesn't close (`lib/agent/describe.ts`). |
| **The client agrees first** | The client accepts the prices and merge-on-payment on their own page (`/c/{token}`). `send_invoice` refuses until they have. |
| **Nothing is sent without the developer** | `send_invoice`, `remind_client` and `cancel_invoice` require `confirm: true`, and the tool descriptions tell the agent to ask first. |
| **Paid means paid** | The webhook body is never trusted. MergePay re-reads the invoice from PayPal and requires status `PAID`, nothing due and no external transaction. `PARTIALLY_PAID`, `PAYMENT_PENDING` and `MARKED_AS_PAID` never merge. |
| **Only what was paid for merges** | The invoice pins the PR's head commit, and the merge call passes that `sha`. If anything was pushed after invoicing, nothing merges and both sides are told why. |
| **Work nobody agreed to isn't billed** | The scope check flags it (e.g. an analytics rewrite in a checkout PR). It's billed only if the developer adds it as an extra, labelled "change request" on the invoice. |
| **Never billed twice** | One live invoice per PR. An issue already billed on another invoice isn't billed again. PayPal-Request-Id makes create and send idempotent. |
| **Tamper-evident trail** | Every step goes on a SHA-256 hash chain per invoice (`lib/ledger/chain.ts`). The invoice page re-verifies it. |
| **Missed webhooks heal** | `invoice_status` re-reads the invoice and completes a merge that a lost webhook would have missed. Duplicate deliveries are ignored. |

## PayPal integration

- **Invoicing API v2** (`lib/paypal/invoicing.ts`): `generate-next-invoice-number`, create a draft (`Prefer: return=representation`), `send`, authoritative `GET`, `remind`, `cancel`.
- **Webhooks** (`lib/services/webhooks.ts`, `lib/paypal/webhook-verify.ts`): `INVOICING.INVOICE.PAID`, `.CANCELLED`, `.REFUNDED` and `.UPDATED`. Signatures are verified locally (CRC32 + SHA256withRSA against PayPal's certificate, on PayPal-owned hosts only), with the verify-webhook-signature API as a fallback. Events are de-duplicated on the event id.
- OAuth client-credentials, idempotent retries (`lib/paypal/client.ts`).

## The MCP server

`POST /api/mcp`: Streamable HTTP, stateless JSON-RPC, with a bearer token. Only the token's SHA-256 is stored. Setup snippets for Cursor, Claude Code and Windsurf are at `/connect`.

| Tool | What it does |
|---|---|
| `list_contracts` | Contracts, prices, whether the client accepted, the client's link |
| `draft_invoice` | Read the PR and its issues, price from the contract, describe, scope-check; saves a draft (nothing sent) |
| `send_invoice` | `confirm: true` → PayPal invoice created and emailed; note posted on the PR |
| `invoice_status` | Ask PayPal; completes the merge if paid |
| `list_invoices` | Newest first, filter by status |
| `remind_client` | PayPal reminder email (`confirm: true`) |
| `cancel_invoice` | Cancel a draft or unpaid invoice (`confirm: true`) |

## AI

Claude (`claude-opus-5-5` by default) writes the client-readable line-item descriptions and the scope check, returned as structured output. Its output is validated against the PR, and it can never change an amount.

Every call runs under a hard daily spend cap (`MERGEPAY_AI_DAILY_BUDGET_USD`, default $2). Costs are recorded per call, and identical inputs are answered from a cache. Without a key, or over the cap, MergePay's rules write the same output, labelled "rules". The demo works fully without a key.

## Run it

```bash
npm install
bash scripts/local-postgres.sh        # Postgres on :5433 (databases kept, kept_test)
cp .env.example .env                  # fill SESSION_SECRET, MERGEPAY_PASSCODE, MERGEPAY_MCP_TOKEN
npm run db:migrate && npm run db:seed
npm run build && npm start            # http://localhost:3000/demo
npm test                              # 20 tests: pricing, scope validator, full flow, attacks
PASSCODE=… node scripts/e2e-demo.mjs   # drives the whole demo in Chromium, writes docs/screenshots
```

With no PayPal or GitHub credentials everything runs against the built-in simulators, labelled on every page.

For the real **PayPal sandbox**:
1. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a sandbox app.
2. Set `DEMO_CLIENT_EMAIL` to a sandbox personal account.
3. Deploy to a public HTTPS URL, then run `npm run paypal:webhook:register` and set `PAYPAL_WEBHOOK_ID`.

For **real GitHub**: set `MERGEPAY_GITHUB_TOKEN` (a fine-grained token for one repo with Contents, Issues and Pull requests set to read & write) and `DEMO_REPO`. The demo's "new pull request" button then creates real issues and a real PR there.

## What has actually run

| Part | Status |
|---|---|
| Full loop against the simulators | **Ran.** `npm test` (20 tests): draft → consent → send → pay → webhook → GET → merge; moved head blocks the merge; double billing refused; duplicate webhooks ignored; missed webhook recovered; serverless persistence; MCP tools. `scripts/e2e-demo.mjs` drives the same loop in a real browser. |
| PayPal sandbox | Code paths written against PayPal's Invoicing v2 spec; **not yet run against the sandbox** (needs sandbox credentials). |
| Live GitHub | Client and demo-PR generator written; **not yet run against a real repo** (needs a token). |
| Claude | Structured-output call written; **not yet run with a key**. The rules path is what the tests exercise. |

## Limitations

- Demo authentication: one passcode for the dashboard, and one MCP token per freelancer, set by the operator. There's no sign-up flow.
- One contract per repository per freelancer. Pricing is fixed per issue or hourly. There's no tax or discount handling.
- Merge-on-payment needs the token to have write access to the client's repository. In real use the client grants that, for example as a collaborator or through a GitHub App.

## Licence

MIT. See [LICENSE](LICENSE).
