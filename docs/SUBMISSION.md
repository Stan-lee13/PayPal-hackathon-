# MergePay — Devpost submission kit

## Tagline (≤ 60 chars)
Get paid before you merge: PayPal invoices from your editor

## Elevator pitch (≤ 200 chars)
Ask your editor's AI agent to bill a pull request. MergePay sends a PayPal invoice priced from the client's contract, and merges the PR the moment PayPal confirms it's paid.

## Inspiration
Freelance developers do the work, open the pull request, then chase the money. Invoices are written by hand, days later, in another tool. The client wants to see the work before paying; the developer doesn't want to merge before being paid. Everyone is waiting on everyone.

Meanwhile the developer already lives in an editor with an AI agent that can read the PR. So the agent should be able to bill it, and the merge should be the receipt.

## What it does
1. **Agree once.** The client opens their contract page and accepts the agreed prices (per issue, or an hourly rate) and "merge on payment".
2. **Bill from the editor.** The developer says "bill Lagos Roast for PR 18" in Cursor or Claude Code. MergePay's MCP tools read the PR and the issues it closes, then:
   - price it from the contract;
   - write line items the client can understand;
   - flag work nobody agreed to (here, an analytics rewrite smuggled into a checkout PR), which is not billed.
3. **Send.** After the developer approves, MergePay creates and sends a **PayPal invoice** and comments on the PR.
4. **Paid, then merged.** The client checks the preview and pays on PayPal. The `INVOICING.INVOICE.PAID` webhook arrives (signature-verified). MergePay **re-reads the invoice from PayPal**: status PAID with nothing due. It then merges **exactly the commit that was invoiced**, and comments "paid, merged".

If the developer pushed anything after the invoice went out, the payment does not merge it, and both sides are told why.

## How we built it
- **PayPal Invoicing API v2:** generate number, create draft, send, authoritative GET, remind, cancel.
- **PayPal webhooks:** `INVOICING.INVOICE.*` events, with local signature verification (CRC32 + SHA256withRSA against PayPal's certificate) and event de-duplication.
- **Model Context Protocol server:** Streamable HTTP, bearer auth, 7 tools, checked against the official MCP SDK client.
- **GitHub REST API:** PR, commits, files, issues, a SHA-pinned merge, comments and preview deployments.
- **Claude** (`claude-opus-5-5`, structured outputs) writes the descriptions and the scope check, under a hard daily spend cap with caching. Deterministic rules do the same job without a key.
- **Next.js 15, Postgres (Drizzle), AG Grid, Vercel + Supabase.**

## What makes it safe for an agent to move money
- **The contract sets the numbers.** The AI writes words, never amounts. Any AI text mentioning money is thrown out. Hours come from the developer, never guessed.
- **Explicit consent, twice.** The client accepts the terms on their own page. The developer must confirm every send (`confirm: true`).
- **Paid means paid.** The webhook body is never trusted. Partial, pending and "marked as paid" invoices never merge.
- **Only what was paid for merges.** The merge is pinned to the invoiced commit.
- **No double billing.** One invoice per PR, and an issue billed once is never billed again. PayPal-Request-Id makes create and send idempotent.
- **Tamper-evident trail.** Every step goes on a SHA-256 chained audit log per invoice, re-verified on the invoice page.

## Challenges
- PayPal fires `INVOICING.INVOICE.PAID` for partial and pending payments too, and the event body's shape isn't documented. So MergePay treats the webhook only as a doorbell and always asks PayPal.
- Making merge-on-payment fair to the client: consent page, preview link, and a merge pinned to the paid commit.
- Serverless hosting: the built-in simulators keep their state in Postgres so a demo survives instance changes.

## What we learned
An agent that moves money has to be boring about it. The AI is valuable for the words, scope checks and plain-language summaries. Everything that decides money or touches a client's code should be deterministic and checked against the systems of record.

## What's next
- A GitHub App instead of a token, so clients grant merge rights in one click.
- Milestone escrow for larger contracts, by holding a PayPal payment until review.
- Payouts to collaborators on the PR.

## Built with
paypal-invoicing-api, paypal-webhooks, model-context-protocol, claude, anthropic, github-api, next.js, typescript, postgresql, drizzle, ag-grid, vercel, supabase

## Testing instructions for judges
- **Live demo (no sign-in):** `<APP_URL>/demo`. Click through:
  1. **Accept as Funmi** (the client).
  2. **Bill Lagos Roast Coffee for PR #18.**
  3. **Looks right — send it.**
  4. **Open the PayPal invoice.** Pay it, then come back to the demo tab and watch it merge.
  5. **Start again with a new pull request**, then **Sneak in one more commit** before paying. The payment won't merge it.
- **PayPal sandbox buyer** (to pay the real sandbox invoice): `<SANDBOX_BUYER_EMAIL>` / `<SANDBOX_BUYER_PASSWORD>`.
- **Dashboard:** `<APP_URL>/app`, passcode `<MERGEPAY_PASSCODE>`.
- **Editor:** `<APP_URL>/connect` shows the Cursor and Claude Code config. Ask us for a token, or use the browser demo, which runs the same tools.
- **Source:** https://github.com/Stan-lee13/PayPal-hackathon- (MIT). `npm test` runs 20 tests; `scripts/e2e-demo.mjs` drives the whole demo in a browser.

---

# Video script (≈ 2:45, under the 3-minute limit)

**0:00–0:15 — Hook** *(screen: the freelancer's editor; a PR is open)*
"You finished the work. The PR is open. Now you chase the invoice, and the client wants to see it before paying. MergePay fixes that: **get paid before you merge.**"

**0:15–0:35 — Consent** *(screen: client contract page)*
"Once per project, the client accepts the prices: $450 for the checkout issue, $80 for the menu fix. They also accept merge-on-payment: when they pay an invoice in full, that PR merges, and only the exact commit they paid for."

**0:35–1:15 — Bill from the editor** *(screen: Cursor / the /demo playground)*
"In my editor I just say: *bill Lagos Roast for PR 18*. The agent calls MergePay over MCP. It reads the PR and the issues it closes and prices it from the contract: $530.
The AI writes the line items in words my client understands. And look: it caught that I also rewrote analytics code nobody asked for. That's **not billed**. The AI never sets an amount; the contract does."

**1:15–1:35 — Send** *(screen: send → PR comment)*
"*Looks right, send it.* MergePay creates a real PayPal invoice through the Invoicing API, emails it to the client, and posts a note on the PR."

**1:35–2:05 — Pay → merge** *(screen: PayPal sandbox invoice → pay → back to the demo)*
"The client checks the preview and pays with PayPal. PayPal's webhook arrives, signature-verified. MergePay doesn't trust it: it asks PayPal directly. Status PAID, nothing due. Then it merges exactly the commit on the invoice and comments 'paid, merged'. Invoice to merged, about a minute."

**2:05–2:25 — The safety moment** *(screen: new PR → sneak in a commit → pay → blocked)*
"What if I push one more change after invoicing? The client pays… and **nothing merges**. They only paid for the commit they saw. Both of us are told exactly why."

**2:25–2:45 — Close** *(screen: dashboard grid + verified audit trail)*
"Every step sits on a tamper-evident audit trail. PayPal Invoicing, verified webhooks, MCP and Claude: an agent that moves money, and is boring about it. MergePay. Get paid before you merge."
