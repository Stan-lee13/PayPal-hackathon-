# MergePay — Devpost submission kit

## Tagline (≤ 60 chars)
Paid invoice. Same SHA. Then merge.

## Elevator pitch (≤ 200 chars)
MergePay binds a client-approved GitHub task and commit to a PayPal invoice. After PayPal confirms full payment, it rechecks the SHA and merges only with authorized consent.

## Inspiration
**Problem hypothesis, not yet validated with customer interviews:** small teams that commission GitHub work may have to reconcile agreed scope, invoice/payment state and the exact revision across tools. A client may want to inspect work before paying, while a developer may not want to merge before payment. This prototype tests whether binding one agreed task and exact commit to one PayPal invoice makes that hand-off clearer.

Design hypothesis: an editor agent can prepare invoice context from the PR, while human consent, PayPal verification and an exact-SHA merge create a traceable hand-off.

## What it does
1. **Agree once.** The client opens their contract page and accepts the agreed prices (per issue, or an hourly rate) and "merge on payment".
2. **Bill from the editor.** The developer says "bill Lagos Roast for PR 18" in Cursor or Claude Code. MergePay's MCP tools read the PR and the issues it closes, then:
   - price it from the contract;
   - write line items the client can understand;
   - flag work nobody agreed to (here, an analytics rewrite smuggled into a checkout PR), which is not billed.
3. **Send.** After the developer approves, MergePay creates and sends a **PayPal invoice** and comments on the PR.
4. **Paid, then merged.** In a configured PayPal mode, the client checks the preview and pays through PayPal; the local simulator is clearly labelled and moves no money. A signed webhook is treated as a notification, not proof. MergePay **re-reads the invoice from PayPal** and requires status PAID with nothing due before it merges **exactly the commit that was invoiced** and comments "paid, merged".

If the developer pushed anything after the invoice went out, the payment does not merge it, and both sides are told why.

## How we built it
- **PayPal Invoicing API v2 (implemented; Sandbox not yet verified):** generate number, create draft, send, authoritative GET, remind, cancel.
- **PayPal webhooks:** `INVOICING.INVOICE.*` events, with local signature verification (CRC32 + SHA256withRSA against PayPal's certificate) and event de-duplication.
- **Model Context Protocol server:** Streamable HTTP, bearer auth, 7 tools, checked against the official MCP SDK client.
- **GitHub REST API:** PR, commits, files, issues, a SHA-pinned merge, comments and preview deployments.
- **Optional Claude API:** structured-output invoice descriptions and scope checks when configured; deterministic rules are the fallback. The model is not allowed to choose amounts, payment status or merge eligibility. A live Claude call has not yet been verified.
- **Next.js 15, Postgres (Drizzle), AG Grid, Vercel + Supabase.**

## What makes it safe for an agent to move money
- **The contract sets the numbers.** Optional AI may draft words, never amounts. Any AI text mentioning money is thrown out. Hours come from the developer, never guessed.
- **Explicit consent, twice.** The client accepts the terms on their own page. The developer must confirm every send (`confirm: true`).
- **Paid means paid.** The webhook body is never trusted. Partial, pending and "marked as paid" invoices never merge.
- **No escrow.** PayPal invoices are paid to the seller's PayPal account; MergePay does not hold client funds or guarantee a future payment.
- **Only what was paid for merges.** The merge is pinned to the invoiced commit.
- **No double billing.** One invoice per PR, and an issue billed once is never billed again. PayPal-Request-Id makes create and send idempotent.
- **Tamper-evident trail.** Every step goes on a SHA-256 chained audit log per invoice, re-verified on the invoice page.

## Challenges
- A webhook is not authoritative payment proof: MergePay verifies the event and re-reads the invoice from PayPal before any merge. The real Sandbox webhook path has not yet been exercised.
- Making merge-on-payment fair to the client: consent page, preview link, and a merge pinned to the paid commit.
- Serverless hosting: the built-in simulators keep their state in Postgres so a demo survives instance changes.

## What we learned
An agent that moves money has to be boring about it. The AI is valuable for the words, scope checks and plain-language summaries. Everything that decides money or touches a client's code should be deterministic and checked against the systems of record.

## What's next
- A GitHub App instead of a token, so clients grant merge rights in one click.
- Validate recurring demand with small agencies and maintainers before expanding beyond the invoice-to-PR workflow.
- Explore collaborator payments only after checking recipient eligibility and PayPal country support; this is not part of the current submission demo.

## Built with
paypal-invoicing-api, paypal-webhooks, model-context-protocol, optional-anthropic-api, github-api, next.js, typescript, postgresql, drizzle, ag-grid, vercel, supabase

## Judge testing (internal draft; not submission-ready)
- **Local simulated demo:** follow the run instructions in `README.md`, start the app and open `/demo`. The mode banner must say **SIMULATED**; no money moves. The browser playground is guided and calls the same tool handlers; it is not an open-ended LLM conversation.
- **PayPal Sandbox:** not yet run. Do not tell judges to sign in to a sandbox buyer account or describe the current simulated invoice as a Sandbox transaction until a real Sandbox invoice and payment have been verified.
- **Claude:** the API path is optional and has not yet been exercised with a live key. Without a configured key, the app uses deterministic rules; only say “Claude” if the mode banner and a live model output confirm it.
- **Hosted demo URL, judge passcode and Sandbox buyer account:** not provisioned; there is no valid judge access information in this draft.
- **Repository, Devpost and video:** the GitHub repository is currently private; the Devpost draft was last known to still be titled “Untitled”; and a public YouTube video under three minutes has not been recorded. These are submission blockers; do not publish the repo or credentials without the owner's approval.
- **Source:** https://github.com/Stan-lee13/PayPal-hackathon- (MIT). Replace this section only after public access, the demo URL, credentials and test count are verified.

---

# Video script (≈ 2:45, under the 3-minute limit)

> **Draft only—not ready to record.** Keep the mode banner visible and narrate the mode actually tested. The current local demo is simulated/rules-only; a PayPal Sandbox transaction and live Claude run have not been verified.

**0:00–0:15 — Hook** *(screen: the guided /demo; only show a real editor if that integration has been tested)*
"You finished the work. The PR is open. The client wants to review it; you want the paid work tied to the exact revision. MergePay makes the rule visible: **paid invoice, same SHA, then merge.**"

**0:15–0:35 — Consent** *(screen: client contract page)*
"Once per project, the client accepts the prices: $450 for the checkout issue, $80 for the menu fix. They also accept merge-on-payment: when they pay an invoice in full, that PR merges, and only the exact commit they paid for."

**0:35–1:15 — Bill from the editor** *(screen: a real MCP client, if available; otherwise the guided /demo playground)*
"The editor agent can call MergePay over MCP. The browser playground is a guided demonstration of the same tool handlers, not an open-ended agent chat. It reads the PR and linked issues, then prices from the contract: $530. When Claude is configured, it drafts the descriptions and scope check; in rules-only mode, deterministic rules do that work. In either case, the contract—not the model—sets the amount. The unrelated analytics change is not billed."

**1:15–1:35 — Send** *(screen: send → PR comment)*
"*Looks right, send it.* MergePay creates and sends an invoice through the selected PayPal mode, then comments on the PR. If the run is simulated, say plainly that no money moves; only call it PayPal Sandbox after a real Sandbox transaction has been verified."

**1:35–2:05 — Pay → merge** *(screen: the verified Sandbox or simulated payer page—say which)*
"The client checks the preview. In a verified Sandbox run, they pay on PayPal Sandbox; in the built-in simulator, this is simulated and no money moves. MergePay treats a webhook as a signal, re-reads the invoice from the same system of record, and merges only when it is fully paid and the PR still has the invoiced SHA."

**2:05–2:25 — The safety moment** *(screen: new PR → sneak in a commit → pay → blocked)*
"What if I push one more change after invoicing? The client pays… and **nothing merges**. They only paid for the commit they saw. Both of us are told exactly why."

**2:25–2:45 — Close** *(screen: dashboard grid + verified audit trail)*
"Every step is recorded in a tamper-evident audit trail. Name the exact mode shown: PayPal Sandbox or the built-in simulator, and Claude or rules-only. MergePay keeps the payment and merge decisions deterministic, reviewable and tied to the same commit."
