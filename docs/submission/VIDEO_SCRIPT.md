# Kept: demo video script v2 (target 2:30, hard cap 2:45)

**Recording rules (non-negotiable)**

- **Record against the PayPal sandbox if at all possible.** Then the banner reads *PayPal sandbox* and the webhook rows read *verified*.
- **If you record in simulated mode, say so on screen.** The banner already shows *SIMULATED PAYPAL*; keep it in frame, and do not call it the real PayPal.
- **Every on-screen claim must be true of the build you record.**
  - If AI is not configured, the chat says *(scripted)*. Do not say "Claude replied".
  - If you recorded with an Anthropic key, you may say it.
- **Settings:** 1280×800 browser window, 110% zoom, dark mode off. Reset demo data before each take (Demo tools → Reset demo data).
- **AI voiceover** is allowed under the Nov 2 rules update. Your own voice is better for the Lagos line.

---

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:15** | Headline still: *Moffatt v. Air Canada*, 2024 BCCRT 149. Cut to the tribunal decision page. | "In 2024, Air Canada's chatbot promised a customer a refund the airline didn't offer. The tribunal made Air Canada pay. Businesses are responsible for what their AI says. But nothing checks those promises against the payment." |
| **0:15–0:30** | `/tour`, scroll to the "Who decides what" grid. | "Kept binds every PayPal payment to the promises that justified it. It watches PayPal's own records and proposes a fix when they disagree. AI reads the words. Code does the maths. PayPal is the truth. A person approves every cent." |
| **0:30–0:50** | `/store`. Set Ada Wrap Dress to 1, choose Express, ask *"What's my total with express shipping?"* → *"Your total is $84.00…"*. The amber price-check box: promised $84.00, checkout $93.33. Pay → approve. | "Tom asks Adaeze Studio's assistant for a total. It applies a published promo and says eighty-four dollars. The checkout says ninety-three thirty-three. Tom approves the payment in PayPal anyway." |
| **0:50–1:10** | The red panel: **PAYMENT MISMATCH DETECTED**: promised $84.00 · PayPal order $93.33 · difference $9.33 · **Capture blocked** · *Nothing has been charged*. Cut to the merchant order page: *Kept blocked this capture*, with the pre-capture check and the order digest. | "Before any money moves, Kept fetches the order from PayPal itself and compares it with the exact words the assistant used. They don't match, so Kept refuses to capture. Nothing is charged. And there's no button that charges it anyway." |
| **1:10–1:25** | Merchant: **Correct the order to the promised $84.00**. Store: *Corrected order ready* → approve $84.00 → **Promise verified before capture** ($84.00 = $84.00). Receipt line: *the earlier PayPal order was never charged*. | "The merchant corrects it, Tom approves the right amount, Kept verifies again and captures. Promise kept. That's prevention." |
| **1:25–1:50** | Demo tools → *Add an order captured outside Kept's checkout*. Ledger: *captured outside Kept's protected checkout*; **BROKEN** by $9.33; the remedy sheet with the exact `POST …/refund` and `PayPal-Request-Id` → **Approve & refund $9.33** → *Refund COMPLETED, confirmed by PayPal*. Phone receipt: *Broken · made good*. | "Some payments are taken by checkouts Kept doesn't control. For those, Kept watches PayPal after payment, proves the nine thirty-three gap from PayPal's own records, and the merchant repairs it with one approved, idempotent refund that PayPal confirms. That's repair." |
| **1:50–2:10** | `/store` → **Send my AI agent** (mandate *under $90, ship in 2 days*) → *cleared*; the agent's verdict shows the merchant's **promise record**. Quick cut: `/record/adaeze-studio` and the MCP endpoint. | "Shoppers' AI agents can check a merchant's PayPal-verified promise record before buying, over MCP, and set rules like 'only buy from shops that keep ninety percent of their promises'." |
| **2:10–2:25** | Order page: **Download evidence pack** → terminal: `verify-evidence.ts` → *VERIFIED*; then **Intelligence** (AG Studio): *Stopped before capture $9.33* · *Refunded, confirmed $9.33* · *Kept as promised* rate. | "Every step is on a tamper-evident chain anyone can verify. And the merchant finally sees how much was stopped before payment and repaired after." |
| **2:25–2:40** | End card: **Kept: every payment is a promise.** Repo URL · live URL · "MIT · built solo in Lagos". | "This January, PayPal reopened incoming payments for Nigerians, through Paga. For a new seller in Lagos selling to London, one avoidable dispute can mean held funds. Kept keeps the promise and the proof. Every payment is a promise." |

---

## Shot list and fallbacks

1. **Pre-roll.** Run `/api/health` in a tab, then visit `/store` once to warm a Render instance that has been asleep.
2. **Webhook latency.**
   - In sandbox, the capture webhook usually arrives within seconds.
   - If it doesn't, click **Check PayPal now**, which does an authoritative GET. Say "Kept re-checks PayPal directly". That is true: it is the reconciliation path.
3. **Disputes.**
   - In sandbox, open the "not received" dispute as the buyer at sandbox.paypal.com → Resolution Center **a day ahead**; dispute webhooks can lag. Record the dispute segment separately.
   - If you only have simulated mode, the **Play the buyer** button is labelled simulated. Keep the banner visible.
4. **Over-length.** Cut the 0:15–0:30 segment to one sentence; never cut the receipt shot.

## Objections this script pre-empts

| Objection | Where it's answered |
|---|---|
| "The overcharge is staged." | 0:30 says the promo lives in the chat, not the checkout. Say it plainly on camera: "we stage this integration gap on purpose". |
| "So the AI moves money?" | 0:15 ("a person approves every cent"), 1:20 (the exact request, one click), 1:35 (the guard is code). |
| "It's a chatbot wrapper." | 0:55: verbatim validation, integer cents, unverifiable promises not enforced. |
| "Why not just prevent it?" | 0:50–1:25: it does. The capture is blocked until the buyer approves the promised amount. The repair path (1:25) covers payments Kept's checkout didn't take, and promises that can only be checked later (shipping, refunds). |
| "Where's PayPal in this?" | Verified webhook, refund API with `PayPal-Request-Id`, tracking API, Disputes API: four distinct PayPal surfaces on screen. |
