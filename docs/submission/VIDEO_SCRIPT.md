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
| **0:30–0:55** | `/store`. Set Ada Wrap Dress to 1, choose Express, ask *"What's my total with express shipping?"* The reply: *"Your total is $84.00… ships within 48 hours… we'll sort you out."* Pay. | "Tom asks Adaeze Studio's assistant for a total. It applies a published free-shipping promo and says eighty-four dollars. Tom pays with PayPal." |
| **0:55–1:20** | Merchant console. The webhook row reads *PAYMENT.CAPTURE.COMPLETED · verified*. Open the order: the Said column shows *"Your total is $84.00."*, the Happened column shows *$93.33*, stamped **BROKEN**. Hover over *Validation (12/12)*. Point at *UNVERIFIABLE* on "sort you out". | "PayPal captured ninety-three thirty-three. The promo lived in the chat, not the checkout. That's a real integration gap; here we stage it on purpose. Kept caught it from PayPal's verified record. The quote is anchored to the exact words, the nine thirty-three is computed in integer cents, and the vague promise is never enforced." |
| **1:20–1:35** | Remedy sheet: the exact `POST …/refund` request with `PayPal-Request-Id`. Click **Approve & refund $9.33**. The state reads *Refund COMPLETED, confirmed by PayPal*. Cut to the phone receipt: *Broken · made good*. | "Merchant sees the exact PayPal request, one click, an idempotent refund confirmed by PayPal, and Tom's receipt updates before he ever has to ask." |
| **1:35–2:00** | Reset. `/store` → **Send my AI agent**. Mandate *"under $60"* → **declined**, no pay button. Mandate *"under $90, ship in 2 days"* → **cleared**. Pay. Ledger: mandate **BROKEN**, *Accountable: merchant*. | "Now the shopper sends their own AI agent. Their limit becomes evidence too. Over the limit, it walks away, and that decision is made by code, not the model. Under the limit it proceeds, and when PayPal charges more, Kept knows whose fault it was: the merchant's, not the agent's." |
| **2:00–2:20** | Order page: add tracking DHL7654321 → *SHIP_BY KEPT*. **Play the buyer → "I never received it"**. The red dispute banner appears. Show the Disputes API `provide-evidence` preview. Approve → *dispute now UNDER_REVIEW*. | "And if a dispute comes anyway, the evidence is already there: the promise, the tracker PayPal recorded, a factual note. It's sent through PayPal's Disputes API, only after the merchant approves. With no tracker, Kept won't fake a defence; it offers the refund." |
| **2:20–2:35** | End card: **Kept: every payment is a promise.** Repo URL · live URL · "MIT · built solo in Lagos". | "This January, PayPal reopened incoming payments for Nigerians, through Paga. For a new seller in Lagos selling to London, one avoidable dispute can mean held funds. Kept keeps the promise and the proof. Every payment is a promise." |

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
| "The overcharge is staged." | 0:55 says so out loud, and explains the real mechanism (promo in the chat, not the checkout). |
| "So the AI moves money?" | 0:15 ("a person approves every cent"), 1:20 (the exact request, one click), 1:35 (the guard is code). |
| "It's a chatbot wrapper." | 0:55: verbatim validation, integer cents, unverifiable promises not enforced. |
| "Where's PayPal in this?" | Verified webhook, refund API with `PayPal-Request-Id`, tracking API, Disputes API: four distinct PayPal surfaces on screen. |
