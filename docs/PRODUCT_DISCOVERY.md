# Kept — Product Discovery Report

### PayPal AI Hackathon 2026

**Researched:** 4 November 2026 (Africa/Lagos)
**Status:** Discovery and decision only. No product code yet.
**Verdict:** **BUILD THIS** (reasons in §18)

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **[V]** | The research team opened and read the source itself |
| **[S]** | Seen only in search-result summaries or secondary reporting. Re-check before quoting publicly. |
| **[U]** | Unverified, or sources conflict |
| **Hypothesis** | Our own reasoning, not evidence |

**Research limits:** Reddit, X/Twitter and Nairaland were blocked from this research environment. Forum evidence therefore comes from:

- PayPal Community, Apple, Shopify and Adobe forums
- Trustpilot
- Nigerian and international press
- Regulators and ombudsmen
- Industry reports

No customer interviews were conducted. **We have not invented any quotes or statistics.**

---

## 1. Executive verdict

Every payment is made because of a **promise**. Some examples:

- "Ships in 48 hours."
- "Your total is $84 with the discount."
- "Refund within 5 days of the return."
- "If it's late, 20% back."

These promises live in chat transcripts, product pages, policy text and, increasingly, **in what a merchant's AI sales or support agent said**. The payment lives in PayPal, and **nothing connects the two**.

When something goes wrong, three things happen:

1. The customer has to become a detective.
2. The merchant finds out only when a dispute arrives.
3. Neither side can line up "what was said" against "what actually happened to the money".

Merchants recover only about **10.7%** of chargeback losses through disputes (Chargebacks911 2026 Field Report — vendor survey; see §3).

**Kept** binds each promise to the PayPal payment it justified:

- AI turns prose promises into **verifiable, quote-anchored commitments** attached to the PayPal order.
- Deterministic code watches **authoritative PayPal events** (captures, tracking, refunds, disputes) against those commitments.
- When a promise is about to break, or already has, Kept proposes the remedy the merchant's own policy allows. The merchant approves with one tap, and the PayPal refund executes and is confirmed by webhook.
- This often happens **before the customer complains**.

The customer gets a "living receipt": a page showing what was promised, what PayPal recorded and where their money is.

**Why this one and not the obvious ideas.** We scanned the competing Devpost field and found roughly 60 PayPal + AI projects in this cycle (see §4). The obvious ideas are already crowded:

| Idea cluster | Approximate competing projects |
|---|---|
| Agent spending guardrails / mandates | about 19 |
| Seller dispute auto-responders | about 13 |
| Seller refund desks | several |
| Escrow / proof-gated release | several |
| Agent-fault assignment | several |

None of these treats **the promise** as the first-class object. All of them react *after* a dispute or *before* a purchase. Kept works in the gap between those two moments, which is exactly where people suffer today.

It also answers a question that is new and growing: **who keeps track of what your AI agent promised a customer?** A tribunal has already made a business pay for its chatbot's invented refund promise (Moffatt v. Air Canada, 2024; §2).

---

## 2. The hidden problem

**The normalised frustration.** After a payment, the *money* is tracked precisely: authorised, captured, pending, refunded, reversed. The *reason the money moved* is tracked nowhere. Nobody is the system of record for:

- the delivery date that was quoted
- the discount the chat agent applied
- the refund that "was processed"
- the trial that "will cancel automatically"

So both parties fall back on screenshots, emails and repeated support contacts.

**Who experiences it.**

| Who | Their exposure |
|---|---|
| **Small online sellers and freelancers who accept PayPal**, in London, New York and now Lagos | Disputes, PayPal holds, support load |
| **Their customers** | Refund limbo, overcharges against a quoted price, broken delivery promises |
| **Businesses deploying AI sales and support agents** | Those agents make financial promises at scale, and nobody tracks them against what was charged |

**Why it matters, in evidence:**

1. **Refunds "processed" but not received.**
   - The CFPB 2025 Consumer Response Annual Report (published March 2026) **[V]** lists credit-card billing complaints about "merchandise returns not being credited properly". It notes consumers "having to contact credit card issuers multiple times".
   - A PayPal staff reply on PayPal Community **[S]** says US card refunds can take "within 30 days – not business days" to return.
2. **Disputes are decided on evidence neither side has organised.**
   - The CFPB report **[V]** says billing errors were "typically resolved in favor of merchants despite documentation".
   - Chargebacks911's 2026 report (vendor survey of 250+ merchants) **[V]** puts merchant net recovery at 10.7%. Merchants estimate "friendly fraud" at 43.8% of chargeback losses. Much of that, we hypothesise, is confusion rather than intent.
3. **Unrecognised charges become refunds and disputes.**
   - Ethoca (Mastercard) infographic citing a Datos Insights Q4 2023 survey **[V]**:
     - 24% of consumers investigated a transaction they didn't recognise.
     - 35% of those asked their bank for a refund.
     - 80% said more detail would have helped.
4. **AI agents make promises the business is liable for.**
   - *Moffatt v. Air Canada*, 2024 BCCRT 149 (14 February 2024) **[S, widely reported]**: the airline's chatbot told a customer he could claim a bereavement fare retroactively. The tribunal rejected Air Canada's argument that it was not responsible for its chatbot, and ordered it to compensate the customer.
   - April 2025 **[S]**: Cursor's AI support agent ("Sam") invented a "one device per subscription" policy, reportedly triggering cancellations (AI Incident Database #1039).
   - Washington Post, February 2025 **[V via ADN reprint]**: OpenAI's Operator agent bought eggs without confirmation and **reported a total ($19.68) that differed from the actual charge ($31.43)**.
   - In each case, what was said and what was charged diverged, and the gap was discovered after money moved.
5. **Nigeria raises the stakes for new sellers.**
   - PayPal re-opened inbound payments for Nigerians through Paga on 27 January 2026 (TechCabal, AllAfrica, Nairametrics) **[S]**.
   - PayPal may hold payments up to 21 days when "multiple customers reported problems" or a seller is new (PayPal Help, faq3297) **[V]**.
   - Newly onboarded Nigerian sellers selling abroad are therefore exactly the merchants for whom one avoidable dispute is most costly. (Hypothesis about severity; the hold policy itself is verified.)
   - **Caution:** the Nigerian rollout is reportedly limited, and public reaction was mixed, including boycott calls.

**Important framing caveat.** No PayPal API lets a third party read a *consumer's* PayPal history. A purely buyer-side "refund tracker" could only use PayPal decoratively. That is a rejection condition (§6). Kept is therefore **merchant-operated and customer-facing**: the merchant connects PayPal, and the customer benefits through the living receipt.

---

## 3. Evidence and customer complaints

| # | Problem | Source | Date | Finding / short quote | Evidence type |
|---|---|---|---|---|---|
| 1 | Returns not credited; repeat contacts | CFPB 2025 Consumer Response Annual Report — files.consumerfinance.gov/f/documents/cfpb_2025-cr-annual-report_2026-03.pdf | Mar 2026 | "merchandise returns not being credited properly"; consumers "having to contact credit card issuers multiple times" | Official [V] |
| 2 | Disputes favour merchants despite documentation | Same CFPB report | Mar 2026 | billing errors "typically resolved in favor of merchants despite documentation" | Official [V] |
| 3 | Money-services transaction problems surge | Same CFPB report | Mar 2026 | ~102,900 money-service complaints in 2025; "Other transaction problem" up 2,029% vs prior 2-yr monthly avg; "Delays in transfers, refunds, and dispute resolutions were a common topic" | Official [V] |
| 4 | Card refund timing | PayPal Community staff reply | undated | card refunds "within 30 days - not business days" | Platform statement [S] |
| 5 | "Refunded" status but bank has nothing; bank asks for ARN | Apple Discussions thread 255777218 | — | bank had not received funds "when in the claim status it shoing refunded" | Anecdote, repeated pattern [S] |
| 6 | eCheck refunds pending for weeks | PayPal Community "Echeck still pending" | 2020 | "up to 10 business or even 3 weeks" | Repeated forum observation [S] |
| 7 | Nigeria: failed-transaction reversal deadlines | CBN Press Release on Payment Channels | 1 Jun 2020 | on-us ATM manual reversal 24h; not-on-us 48h; PoS/Web "within 72 hours" | Official rule [V] |
| 8 | Nigeria: complaint volumes rising | CBN 2025 Annual Report via Vanguard | 30 Jul 2026 | 23,129 complaints in 2025 (vs 20,925); 18,824 resolved; ₦19.12bn + $329.3m refunded | Official statistic, secondary report [V] |
| 9 | Nigeria: reversals take weeks | Leadership.ng, "Debit alert, no credit" | ~late 2025 | "Sometimes, it takes weeks or even months." | Press interviews [V] |
| 10 | UK ombudsman volumes | Financial Ombudsman Service | 21 May 2026 | 214,600 complaints FY2025/26; 32,900 current-account cases (18,900 fraud/scam) | Official [V] |
| 11 | Merchant dispute economics | Chargebacks911 2026 Chargeback Field Report | 2026 | net recovery 10.7%; friendly fraud est. 43.8% of losses; ~62% say chargebacks rising | Industry (vendor) survey [V] |
| 12 | Unrecognised transactions drive refunds | Ethoca infographic (Datos Insights Q4 2023 survey) | Feb 2024 | 24% investigated an unrecognised purchase; 35% of those requested a refund; 80% said more details would help | Industry survey [V] |
| 13 | UK unwanted subscriptions | UK Dept for Business & Trade | 18 Nov 2024 | ~10m of 155m UK subscriptions unwanted, costing £1.6bn/yr | Official estimate [V] |
| 14 | US click-to-cancel rule vacated | 8th Circuit, Custom Communications v. FTC (law-firm coverage) | 8 Jul 2025 | rule vacated on procedural grounds | Legal, secondary [S] |
| 15 | PayPal payment holds | PayPal Help faq3297 | current | "we may need to hold the payment for up to 21 days" (new seller, "Multiple customers reported problems") | Platform policy [V] |
| 16 | Chatbot promise legally binding | Moffatt v. Air Canada, 2024 BCCRT 149 | 14 Feb 2024 | airline liable for chatbot's bereavement-refund misinformation | Tribunal decision, widely reported [S] |
| 17 | AI support agent invents policy | Cursor "Sam" incident; AI Incident DB #1039 | Apr 2025 | invented "one device per subscription" policy; cancellations | Incident reports [S] |
| 18 | Agent misreports price | Washington Post via ADN — adn.com/alaska-life/2025/02/09/... | 9 Feb 2025 | Operator bought eggs; reported $19.68, actual $31.43; OpenAI said it "made a mistake" | Journalism [V] |
| 19 | Promise outlives the dispute window | UK FOS decision DRN-4086558 | — | retailer promised refund; promise outlasted chargeback window | Ombudsman decision [S] |
| 20 | Agent purchases have no dispute framework | NMI, "Who pays when an AI agent buys the wrong thing" | updated 28 Sep 2026 | no Visa/Mastercard reason code distinguishes agent error | Industry analysis [V] |
| 21 | Signed mandates ≠ intent | "Beyond the Mandate", arXiv 2608.23858 | 24 Aug 2026 | "valid mandate signatures alone do not ensure that an agent-mediated transaction reflects the user's intent" | Academic preprint [V] |
| 22 | Consumer trust in agent purchasing is low | Bain (n=2,016) / YouGov (n=1,287) | Jul 2025 / Jan 2026 | 24% comfortable letting AI complete purchases (Bain); 14% comfortable with AI placing orders (YouGov) | Surveys [V] |
| 23 | Fake payment alerts (Nigeria) | Dubawa fact-check | 12 Feb 2024 | "Flash alert" apps; police cases of cars bought with fake transfers | Fact-check + police cases [V] |
| 24 | Fake PayPal "payment received" emails (UK) | Action Fraud | 2020 | 21,349 reports Jan–Sep 2020, £7.89m lost | Official, secondary [S] |
| 25 | Nigeria: PayPal inbound reopened | TechCabal / AllAfrica | 27 Jan 2026 | PayPal returns via Paga for inbound payments | Press [S] |

**Broad evidence vs anecdote.**

- **Broad evidence:** #1–3 and #10–13 are official or survey-based. They show the post-payment problem class is large and persistent.
- **Anecdotes or single incidents:** #5, #6, #9, #16–18. They illustrate the mechanism but do not measure frequency.
- **What we could not measure:** how often a merchant's stated promise diverges from what was charged or done. That is a **hypothesis** the product itself would measure.

---

## 4. The existing market

| Segment | Players | What they do | What they still miss |
|---|---|---|---|
| Merchant chargeback automation | Chargeflow ($35M Series A, Nov 2025; ~25% success fee), Stripe Smart Disputes (~30% fee on won disputes, Stripe data only), Justt, Chargebacks911, Midigator/Kount | Assemble evidence *after* a dispute | Reactive. Fights rather than prevents. Doesn't know what was promised in chat/AI conversations. |
| Pre-dispute alerts | Verifi (Visa) Order Insight, Ethoca (Mastercard) Consumer Clarity | Share order details with issuers when a cardholder asks | Network/acquirer-level, not reachable for a small PayPal seller. Shows the order, not the promise. |
| Consumer refund/subscription tools | Rocket Money, Refundly (late 2025), Ajar, Simplifi refund alerts | Detect subscriptions; alert when a refund posts | No link to the merchant's promise or the dispute deadline. Can't act on the merchant side. |
| Consumer complaint tools | Resolver (UK), DoNotPay (FTC order Jan 2025 for unsupported "robot lawyer" claims) | Letters/templates | Don't touch payment rails. A cautionary tale against overclaiming. |
| Agent payment protocols | Google AP2 (intent/cart mandates), OpenAI/Stripe ACP, Visa Trusted Agent Protocol, Mastercard Agent Pay / Verifiable Intent, EMVCo draft "Intent Services" (Sep 2026), PayPal Agentic Commerce Services | Decide *whether* an agent may transact | NMI: they don't govern what happens when it transacts wrong. EMVCo's draft explicitly wants intent recorded "before, during and after" a transaction. Unbuilt for small merchants. |
| AI customer-service agents | Many | Answer customers; make promises | Don't track their own promises against payment outcomes (Air Canada, Cursor). |
| PayPal itself | Resolution Center, Seller Protection, Agent Toolkit / MCP server | Records money movement authoritatively; dispute workflow | Records *what* moved, not *why*. No promise layer. |
| **Rival hackathon entries** (Devpost search, this cycle) | ~19 agent guardrail/mandate projects; ~13 seller dispute defenders; refund desks (Settled, Mendary, Refundly-agent, Matchback); escrow (ProofPay, Holdfast, PACT Verify…); agent-fault (Culpa, Provenant); pre-dispute explainer (Charge Desk); reconciliation (Closeout, LedgerLens) | — | **Nobody found treats merchant-side promises (human- or AI-made) as first-class objects bound to the payment and monitored against PayPal events.** |

**The specific gap.** Payment platforms record money states. Order systems record fulfilment. AI agents generate commitments. Nothing binds a commitment to the payment, watches it against authoritative payment events, and resolves breaches *before* they become disputes. And nothing does it for promises made by AI agents, which the law already treats as binding.

**Why the gap persists (hypothesis).**

1. Promises are unstructured prose, so they were uncomputable before capable LLMs.
2. Dispute vendors are paid per won dispute. Preventing disputes undercuts their revenue model.
3. Payment processors deliberately stay neutral about merchant–customer terms.

---

## 5. The opportunity shortlist (14 researched opportunities)

Each entry lists the user, problem, evidence, alternatives, difference, PayPal role, AI role, feasibility and commercial outlook.

1. **Kept — promise ledger for payments.**
   - **User:** small PayPal merchants and their customers.
   - **Problem:** promises (human- or AI-made) are disconnected from payments.
   - **Evidence:** #1, 2, 11, 12, 16–19.
   - **Alternatives:** dispute tools (reactive), OMS (no promises).
   - **Difference:** the promise is the object; resolution is proactive.
   - **PayPal:** Orders, Payments (capture/refund), order tracking, Webhooks, Disputes.
   - **AI:** extract verifiable, quote-anchored promises; explain states; draft remedies.
   - **Feasibility:** narrow promise types checkable from PayPal data.
   - **Commercial:** SaaS priced against dispute fees avoided.
2. **Refund Radar — buyer-side refund-promise and dispute-deadline tracker.**
   - **User:** consumers.
   - **Problem:** "refunded" but not received; dispute windows expire.
   - **Evidence:** #1, 4, 5, 19.
   - **Alternatives:** Refundly, Simplifi.
   - **Difference:** ties the promise to the deadline.
   - **PayPal:** *none meaningful* — no consumer-data API.
   - **AI:** parse emails.
   - **Feasibility:** easy, but PayPal is decorative.
   - **Commercial:** weak (consumer subscription).
3. **Proof — fake-payment verifier for sellers.**
   - **User:** Nigerian and UK marketplace sellers.
   - **Problem:** fake alerts and fake PayPal emails.
   - **Evidence:** #23, 24.
   - **Alternatives:** check the app manually.
   - **Difference:** vision extraction of the claimed payment, checked against PayPal GET order/capture.
   - **PayPal:** Orders/Payments GET, webhooks.
   - **AI:** screenshot/email forensics.
   - **Feasibility:** very feasible.
   - **Commercial:** modest. The Nigerian fake-alert problem is mostly bank transfers, outside PayPal.
4. **AgentReceipt Auditor — agent-reported vs actually-charged reconciler.**
   - **User:** people using shopping agents.
   - **Problem:** the agent misreports what it bought or charged.
   - **Evidence:** #18, 20–22.
   - **Alternatives:** IntentOS (rival entry).
   - **Difference:** post-purchase verification.
   - **PayPal:** needs buyer-side data, so only works if the agent platform is the merchant.
   - **AI:** compare intent vs order.
   - **Feasibility:** medium.
   - **Commercial:** early market (only ~10% have bought with AI, per Bain).
5. **Agent spending wallet / mandate guardrails.**
   - **User:** agent users.
   - **Problem:** unrestricted agent authority.
   - **Evidence:** #20–22.
   - **Alternatives:** AP2, ACP and ~19 rival entries.
   - **Difference:** little.
   - **PayPal:** Vault / Orders.
   - **AI:** interpret instructions.
   - **Feasibility:** feasible.
   - **Commercial:** platform-owned. **Saturated.**
6. **Dispute Autopilot — seller evidence generator.**
   - **User:** merchants.
   - **Problem:** losing disputes.
   - **Evidence:** #2, 11.
   - **Alternatives:** Chargeflow, Stripe and ~13 rivals.
   - **Difference:** none material.
   - **PayPal:** Disputes API.
   - **AI:** evidence drafting.
   - **Feasibility:** medium; sandbox disputes are slow.
   - **Commercial:** proven but crowded. **Saturated.**
7. **Charge Decoder — merchant-hosted "what is this charge?" page.**
   - **User:** customers and merchants.
   - **Problem:** unrecognised descriptors.
   - **Evidence:** #12.
   - **Alternatives:** Ethoca/Verifi, rival Charge Desk.
   - **Difference:** small-merchant reach.
   - **PayPal:** Orders/soft_descriptor/Transaction Search.
   - **AI:** match the customer's description to an order.
   - **Feasibility:** feasible.
   - **Commercial:** moderate. **Folded into Kept's living receipt.**
8. **Trial Keeper — honest-trial subscription layer.**
   - **User:** subscription merchants.
   - **Problem:** trial-conversion complaints.
   - **Evidence:** #13, 14.
   - **Alternatives:** Rocket Money (buyer side).
   - **Difference:** merchant-side reminders and auto-cancel promises.
   - **PayPal:** Subscriptions v1 + webhooks.
   - **AI:** weak — mostly rules.
   - **Feasibility:** feasible.
   - **Commercial:** moderate. **Fails the AI-necessity test.**
9. **Payday Trail — freelancer invoice-to-cash tracker.**
   - **User:** Nigerian and global freelancers.
   - **Problem:** "where is my money" across invoice, payment, hold and withdrawal.
   - **Evidence:** #15, 25.
   - **Alternatives:** PayPal app, Payoneer.
   - **Difference:** explains holds.
   - **PayPal:** Invoicing, Transaction Search.
   - **AI:** explain holds.
   - **Feasibility:** holds can't be simulated in sandbox.
   - **Commercial:** moderate. Evidence for systematic withdrawal delays is weak [U].
10. **Milestone Escrow — authorise now, capture on AI-verified delivery.**
    - **User:** freelancers and clients.
    - **Problem:** trust in delivery.
    - **Evidence:** general.
    - **Alternatives:** Escrow.com and ~7 rivals.
    - **Difference:** little.
    - **PayPal:** Authorizations (3-day honor, 29-day validity).
    - **AI:** verify deliverables (risky).
    - **Feasibility:** medium.
    - **Commercial:** regulated territory. **Saturated.**
11. **Reversal Watch — Nigerian failed-transfer reversal tracker.**
    - **User:** Nigerian bank customers.
    - **Problem:** debited, not credited, no reversal.
    - **Evidence:** #7–9 (strong).
    - **Alternatives:** call the bank; email the CBN.
    - **Difference:** knows the deadlines and escalates.
    - **PayPal:** **none** — bank rails (NIP) are not PayPal.
    - **Verdict:** **Rejected** (PayPal decorative), despite strong local evidence.
12. **Resolution Handshake — buyer agent ↔ merchant agent refund negotiation.**
    - **User:** both sides.
    - **Problem:** weeks of emails to resolve a refund.
    - **Evidence:** #1, 3.
    - **Alternatives:** none at scale.
    - **Difference:** agent-to-agent commerce.
    - **PayPal:** Refunds, Disputes make-offer.
    - **AI:** negotiation within policy.
    - **Feasibility:** risky. The two-agent theatre may look gimmicky.
    - **Commercial:** speculative. **Kept's MCP endpoint captures the defensible part** (§9 "Could").
13. **Ledger Close — small-merchant reconciliation copilot.**
    - **User:** small sellers.
    - **Problem:** matching orders, captures, fees and refunds.
    - **Evidence:** weak (vendor blogs only).
    - **Alternatives:** QuickBooks, A2X and rivals.
    - **Difference:** little.
    - **PayPal:** Transaction Search, which has up to 3h lag and a 31-day window.
    - **AI:** categorisation.
    - **Commercial:** crowded.
14. **Ajo Pot — rotating-savings (esusu/ajo) group pot with PayPal Payouts.**
    - **User:** diaspora savings groups.
    - **Problem:** trust in the collector.
    - **Evidence:** cultural practice, not complaint data [Hypothesis].
    - **PayPal:** Orders + Payouts.
    - **AI:** weak.
    - **Feasibility:** medium.
    - **Commercial:** regulatory risk (deposit-taking). **Fails AI necessity.**

---

## 6. Scoring matrix

Weights: Severity 15 · Frequency 10 · Innovation 15 · Reach 10 · PayPal 15 · AI necessity 10 · Feasibility 10 · Demo 10 · Commercial 5.

| Opportunity | Sev | Freq | Innov | Reach | PayPal | AI | Feas | Demo | Comm | **Total** | Auto-reject? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **1 Kept** | 11 | 8 | 12 | 8 | 13 | 9 | 7 | 9 | 4 | **81** | No |
| 12 Resolution Handshake | 10 | 6 | 12 | 7 | 12 | 9 | 5 | 8 | 3 | 72 | No (absorbed into Kept) |
| 3 Proof | 12 | 7 | 8 | 6 | 9 | 7 | 9 | 8 | 3 | 69 | No |
| 2 Refund Radar | 12 | 9 | 10 | 9 | 3 | 7 | 7 | 7 | 3 | 67 | **Yes — PayPal decorative** |
| 6 Dispute Autopilot | 11 | 8 | 3 | 7 | 13 | 8 | 6 | 7 | 5 | 68 | Effectively yes — exists in substantially same form |
| 4 AgentReceipt Auditor | 9 | 4 | 8 | 6 | 9 | 8 | 7 | 8 | 3 | 62 | No |
| 7 Charge Decoder | 8 | 7 | 5 | 8 | 9 | 7 | 8 | 7 | 3 | 62 | Partly exists (Ethoca/Verifi) |
| 9 Payday Trail | 10 | 7 | 6 | 7 | 10 | 5 | 6 | 6 | 3 | 60 | No |
| 5 Agent guardrail wallet | 8 | 4 | 3 | 6 | 11 | 6 | 8 | 8 | 3 | 57 | Saturated |
| 11 Reversal Watch | 13 | 9 | 9 | 5 | 0 | 6 | 7 | 7 | 3 | 59 | **Yes — no PayPal** |

**Why Kept scores as it does:**

- **Severity 11/15.** Disputes, holds and refund limbo are costly and stressful. A single broken promise is usually tens to hundreds of dollars, not life-changing, so it doesn't score higher.
- **Frequency 8/10.** Post-payment problems are broadly documented (CFPB, FOS, CBN). How often promises specifically diverge is unmeasured.
- **Innovation 12/15.** No rival entry or commercial product we found binds prose and AI-agent promises to payment events proactively. It is not a new technology category, so it doesn't reach 15.
- **Reach 8/10.** Any PayPal merchant in any country. The customer benefit depends on merchant adoption.
- **PayPal 13/15.** Orders (custom_id binding), Payments (capture/refund with idempotency), order tracking, verified webhooks and the Disputes API are all load-bearing. PayPal is the source of truth. It is not 15 because PayPal can't witness carrier delivery.
- **AI 9/10.** Without AI there is no promise layer, because merchants will never hand-encode their chat transcripts (§11 necessity test).
- **Feasibility 7/10.** Tight in 8 days, but the MVP is narrow and every PayPal operation in it is sandbox-supported.
- **Demo 9/10.** A real webhook catches a real overcharge and a real refund fixes it, all on camera.
- **Commercial 4/5.** Clear ROI story (disputes and holds avoided). Unproven willingness to pay.

---

## 7. The final product

**Name:** **Kept**. It is short, pronounceable in every accent, and the past participle of the promise.

> **Tagline:** *Every payment is a promise. Kept makes sure it's kept.*

**Concept.** Kept is a promise ledger for merchants who get paid through PayPal:

- It reads what the business said (the AI sales chat, the checkout page, the refund policy).
- It turns each verifiable promise into a commitment bound to the PayPal order.
- It watches PayPal's authoritative events against those commitments.
- It resolves breaches through PayPal before they become disputes, with the merchant's approval.

**Unique insight.** Payment systems already know *what* happened to the money. The missing data is *why the money moved*: the promise. AI can now make that prose computable. And the only promises worth enforcing automatically are the ones **PayPal can witness**:

| Promise | What PayPal records that verifies it |
|---|---|
| Amount quoted | Capture amount |
| Ships within N days | Tracker added to the order |
| Refund within N days | Refund COMPLETED |

**One-sentence value proposition.** *Kept connects every PayPal payment to the promises that justified it, and fixes broken ones before your customer has to ask.*

---

## 8. Why this could win

**Mapping to the five equally weighted criteria (each scored 1–5):**

1. **Technological implementation.** A non-trivial PayPal workflow:
   - Orders v2 with `custom_id` binding
   - capture, partial refund with `PayPal-Request-Id` idempotency
   - order tracking (`/v2/checkout/orders/{id}/track`)
   - webhook signature verification and dedupe
   - Disputes API ingestion
   - Agent Toolkit for read tools

   On the AI side:
   - structured extraction with verbatim-span validation
   - a tool-using resolution agent whose money-moving tools are gated by deterministic policy and human approval

   This is not a chatbot.
2. **Design.** A complete two-sided product: a merchant "Said / Happened" ledger, a remedy approval sheet and a customer living receipt. It is a coherent loop, not a proof of concept.
3. **Potential impact.** A specific audience (small PayPal sellers, including newly enabled Nigerian sellers) with a specific, evidenced problem (disputes, refund limbo, AI-agent promises). The demo shows the problem being solved.
4. **Innovation.** It moves the unit of work from the payment or the dispute to **the promise**. It is absent from the ~60 rival entries we found and from commercial tools.
5. **Presentation.** One real-time moment (§14) shows the entire value: the AI promised $84, PayPal captured $93.33, Kept caught it and fixed it.

**Special awards (one Honorable Mention plus one Sponsor prize may stack):**

| Award | Credibility | Why |
|---|---|---|
| **Best Use of PayPal + AI** | **Strongest** | PayPal events are the ground truth; AI makes promises computable. Each is useless without the other. |
| **Best Demo Delivery** | **Strong** | Live webhook → detected overcharge → approved refund → confirmed, in about 40 seconds. |
| **Best Use of Agentic Commerce** | Credible | An accountability layer for what AI sales agents promise, plus a policy-bounded resolution agent that transacts (refunds) through PayPal. |
| **Most Impactful** | Moderate | Dispute prevention plus customer clarity. The Nigerian new-seller angle adds weight. |
| **Most Creative** | Moderate | "The payment remembers why it was made." |
| **Render sponsor prize** | Opportunistic | Host on Render. |

---

## 9. Product specification

**1. Identity**

| | |
|---|---|
| **Category** | Post-payment trust infrastructure / commerce operations |
| **Primary audience** | Small online sellers, creators and service freelancers paid via PayPal, especially those using AI chat to sell or support |
| **Secondary audience** | Their customers |
| **Primary use case** | Catching and fixing a broken payment promise (wrong amount, late shipment, slow refund) before it becomes a dispute |
| **Core promise** | Nothing you promised gets forgotten, and nothing you didn't promise gets charged |

**2. The end-to-end journey**

This is the scenario the demo uses.

1. **Trigger.** Adaeze runs a Lagos fashion studio selling to buyers abroad via PayPal. Her store uses an AI sales assistant. Tom, a customer in London, asks about a dress.
   - The assistant says: *"With your 10% returning-customer discount and express shipping, your total is $84.00, and it ships within 48 hours."*
   - Tom pays through PayPal checkout.
2. **What the merchant provides (once).**
   - Connect PayPal (client ID and secret on the server).
   - Paste or connect sources: the refund policy text and the chat transcript webhook.
   - Set a remedy policy, for example "auto-propose refunds of overcharges; partial refunds over $50 need manual review".
3. **What Kept understands.** When the order is created, Kept's extraction model reads the transcript and policy and produces two commitments:
   - `PRICE_AS_QUOTED: 84.00 USD` — quote: "your total is $84.00"
   - `SHIP_BY: capture_time + 48h` — quote: "ships within 48 hours"

   Each commitment is anchored to the exact source span, validated by code, and bound to the PayPal order through `custom_id`. A vague line ("we'll sort you out if anything goes wrong") is marked **Unverifiable: not enforced** and shown to Adaeze for clarification.
4. **What PayPal contributes.** `PAYMENT.CAPTURE.COMPLETED` arrives.
   - Kept verifies the signature and re-fetches the capture with `GET /v2/payments/captures/{id}`.
   - The authoritative amount is **$93.33**. The discount was never applied, because the checkout didn't know what the chat agent said.
5. **Detection, which is deterministic.** $93.33 ≠ $84.00, so the commitment is **BROKEN**, with an overcharge of $9.33. This is computed by code, not by the LLM.
6. **What AI contributes.** The resolution agent proposes a remedy within policy: a partial refund of $9.33 plus an apology message to Tom. It cites the quote, the capture ID and the policy rule. It cannot execute anything itself.
7. **The merchant's decision.** Adaeze sees the "Said / Happened" view and taps **Approve refund $9.33**.
8. **What happens next.**
   - Kept calls `POST /v2/payments/captures/{id}/refund` with `amount` and a `PayPal-Request-Id`.
   - The response says `COMPLETED` (or `PENDING`, which is shown honestly).
   - `PAYMENT.CAPTURE.REFUNDED` arrives and is reconciled.
9. **Successful resolution.** Tom's living-receipt link updates: *"You were charged $93.33. $9.33 was refunded by PayPal at 14:02 (refund 8XY…). It's in your PayPal balance or on its way to your card. Card refunds can take longer to appear."* Tom never had to ask.
   - Forty-eight hours later (shown with a labelled demo clock), there is no tracker on the order. The SHIP_BY commitment turns **AT RISK** with 6 hours left, and Kept nudges Adaeze to add tracking, which calls PayPal's order-tracking API.

**3. The WOW moment.** One real sandbox payment. The AI promised $84. PayPal captured $93.33. In seconds, Kept shows the promise and the PayPal record side by side, the mismatch highlighted, and a policy-approved fix ready. One tap, and a real PayPal refund completes and the customer's receipt updates. **The payment remembered what was promised.**

**4. MVP scope**

| Must build | Should build | Could build | Must NOT build |
|---|---|---|---|
| Demo store with AI sales chat + PayPal JS SDK checkout (Orders v2, `custom_id`) | `SHIP_BY` + order tracking API + demo clock | Kept MCP endpoint `get_promise_status` so buyers' agents can verify promises | Buyer-side bank or PayPal account access |
| Promise extraction (3 types: `PRICE_AS_QUOTED`, `SHIP_BY`, `REFUND_BY`) with verbatim-span validation | Dispute ingestion: `CUSTOMER.DISPUTE.CREATED` → match ledger → evidence pack / `send-message` / `make-offer` | `intent=AUTHORIZE` hold when an AI agent promises beyond policy (capture only after merchant decides) | Carrier delivery integrations |
| Webhook endpoint: signature verify, dedupe, re-fetch | "Unauthorised promise" flag (promise exceeds policy) | Multi-merchant onboarding (Partner Referrals) | Auth/teams/billing |
| Deterministic evaluator + policy engine | Refund failure handling demo (mock response) | Email/WhatsApp notifications | Chargeback representment automation |
| Remedy proposal → human approval → idempotent partial refund → webhook confirmation | Polished empty/error/loading states | Analytics on promises kept | Mobile app; crypto; multiple LLM providers |
| Customer living receipt page | Seed/reset script for judges | | Fine-tuning |
| Merchant "Said / Happened" order view + promises inbox | | | |

---

## 10. PayPal integration blueprint

Facts below are from PayPal's official OpenAPI specs (Orders v2.32, Payments v2.12, Disputes v1.11, Webhooks v1.11) and developer docs, checked 4 November 2026. The "Webhooks" column lists only events that Kept consumes; it is not a claim about which events each operation emits.

| # | User problem | API / operation | Credentials | Sandbox? | Key data | Webhooks | Failure handling | Visible in demo |
|---|---|---|---|---|---|---|---|---|
| 1 | Bind payment to promise | **Orders v2** `POST /v2/checkout/orders` (`intent: CAPTURE`) | App client ID/secret (server) | Yes | `purchase_units[].custom_id` = Kept ledger ID (≤255, hidden from payer); `invoice_id` unique per merchant; `description` truncated at 127 | `CHECKOUT.ORDER.APPROVED` | Retries send the same `PayPal-Request-Id`; handle `DUPLICATE_INVOICE_ID`, `INSTRUMENT_DECLINED` | Order ID chip on ledger |
| 2 | Know what was actually charged | `POST /v2/checkout/orders/{id}/capture` then `GET /v2/payments/captures/{id}` | same | Yes | Capture `status` ∈ COMPLETED, PENDING, DECLINED, PARTIALLY_REFUNDED, REFUNDED, FAILED; `status_details.reason` (e.g. PENDING_REVIEW, ECHECK); `seller_receivable_breakdown` (gross, paypal_fee, net) | `PAYMENT.CAPTURE.COMPLETED`, `.PENDING`, `.DENIED`, `.DECLINED`, `.REVERSED` | PENDING → "money not yet final"; never treat PENDING as kept | "Happened" column: amount, status, fee |
| 3 | Fix an overcharge or late-delivery remedy | **Payments v2** `POST /v2/payments/captures/{id}/refund` with `amount` (partial allowed, repeatable) | same | Yes | Refund `status` ∈ COMPLETED, PENDING, FAILED, CANCELLED; `seller_payable_breakdown.total_refunded_amount` | `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.FAILED` | Required `PayPal-Request-Id` (Orders spec: stored 6h). Errors: `REFUND_AMOUNT_EXCEEDED`, `REFUND_FAILED_INSUFFICIENT_FUNDS`, `CAPTURE_FULLY_REFUNDED`, `REFUND_NOT_ALLOWED`. UI shows "Refund requested" until authoritative COMPLETED. | Approve → refund ID → receipt updates |
| 4 | Witness "ships within N days" | `POST /v2/checkout/orders/{id}/track` (`capture_id`, carrier, tracking number, `notify_payer`) | same | Yes (sandbox endpoint per spec; test early) | Tracker status SHIPPED/CANCELLED | — (state read back via `GET` order) | If tracking fails, promise stays AT_RISK; merchant retries | SHIP_BY turns KEPT with tracker ID |
| 5 | Authoritative event intake | **Webhooks** `POST /v1/notifications/verify-webhook-signature` | Webhook ID for the app | Yes for real events; **simulator events cannot be verified** | Headers: PAYPAL-TRANSMISSION-ID, -TIME, -SIG, PAYPAL-CERT-URL, PAYPAL-AUTH-ALGO; response `verification_status` | All above + `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` | Reject FAILURE (no state change); dedupe on event `id`; retries up to 25× over 3 days; re-fetch the resource; fallback poll by `GET` if webhook is late | Event log drawer "PayPal · verified ✓" |
| 6 | A customer already escalated | **Disputes v1** `GET /v1/customer/disputes?disputed_transaction_id=…`, `GET /{id}`, `POST /{id}/send-message`, `/make-offer`, `/provide-evidence`, `/accept-claim` | "Customer disputes" app feature (on by default in sandbox) | Yes. Create disputes from the **sandbox personal account UI**; sandbox-only `require-evidence` and `adjudicate` need status UNDER_REVIEW. Allow minutes for actions to appear. | `reason` (e.g. INCORRECT_AMOUNT, MERCHANDISE_OR_SERVICE_NOT_RECEIVED, CREDIT_NOT_PROCESSED), `dispute_life_cycle_stage` (INQUIRY…ARBITRATION), status | `CUSTOMER.DISPUTE.*` | Buyer-side dispute **creation** API needs a scope only PayPal grants; not used | Should-build: dispute matched to ledger with evidence pack |
| 7 | Read tools for the agent | **PayPal Agent Toolkit** `@paypal/agent-toolkit` (v1.11.0, 1 Sep 2026): `get_order`, `get_refund`, `get_dispute`, `list_disputes`, `get_shipment_tracking`, `list_transactions` | Access token, `PAYPAL_ENVIRONMENT=SANDBOX` | Yes | — | — | Money-moving tools (`create_refund`, `accept_dispute_claim`) are **not exposed to the LLM**; Kept's own gated executor calls REST | "Agent used: get_order" in audit trail |
| 8 | (Optional) reporting | Transaction Search `GET /v1/reporting/transactions` | Enable "Transaction Search" on the app | Yes | event codes, e.g. T1107 refund, T1201 chargeback | — | **Up to 3h lag, 31-day max range.** Not used for live UI. | Not in demo |

**Lifecycle distinctions the UI must respect** (verified gotchas):

- Order `APPROVED` ≠ paid.
- Capture `COMPLETED` ≠ settled in a bank. It can later be `REVERSED` by a chargeback.
- Capture `PENDING` ≠ failed.
- Refund `COMPLETED` at PayPal ≠ visible on the customer's card statement.
- With `AUTHORIZE`, only the first 3 days are an honor period. Reauthorisation is possible from day 4 to day 29.

**Sandbox setup and test scenarios**

1. **Accounts and webhook.**
   - Create a US sandbox business account ("Adaeze Studio") and a GB personal account ("Tom") in the developer dashboard. The country is selectable.
   - Register a webhook for the Render URL.
2. **Happy path.** Quote matches capture → `PRICE_AS_QUOTED` KEPT.
3. **Overcharge.** Chat applies a discount; checkout doesn't → BROKEN → partial refund → `PAYMENT.CAPTURE.REFUNDED`.
4. **Refund failure.** Use `PayPal-Mock-Response: {"mock_application_codes":"REFUND_FAILED_INSUFFICIENT_FUNDS"}` on the refund call (verify this code is mockable on day 2) → FAILED state, honest UI.
5. **Declined card.** Card name `CCREJECT-REFUSED` → order not captured → no commitments activated.
6. **Dispute (should).** Tom opens "item not received" in the sandbox UI → `CUSTOMER.DISPUTE.CREATED` → ledger shows SHIP_BY KEPT with tracker → evidence pack.

**Docs:**

- https://developer.paypal.com/docs/api/orders/v2/
- https://developer.paypal.com/docs/api/payments/v2/
- https://developer.paypal.com/docs/api/customer-disputes/v1/
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/api/rest/webhooks/event-names/
- https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
- https://developer.paypal.com/api/rest/sandbox/accounts/
- https://github.com/paypal/paypal-rest-api-specifications
- https://github.com/paypal/agent-toolkit
- https://developer.paypal.com/ai-tools/mcp-server

**Honesty note.** Everything runs on PayPal **sandbox**. No real money moves, and no bank access is implied. Shipping promises are witnessed by PayPal order tracking (merchant-reported shipment), not by carrier delivery confirmation. The demo clock is labelled as a simulation.

---

## 11. AI architecture

**AI responsibilities. Each model output is JSON validated by a schema (zod).**

1. **Promise Extractor.**
   - **Input:** source documents (chat transcript, policy text, product page snippet), order context (items, currency, created time).
   - **Output:** `[{type, params, quote, source_id, confidence, verifiable: bool, reason}]`.
   - **Types:** `PRICE_AS_QUOTED{amount,currency}`, `SHIP_BY{within_hours | by_date}`, `REFUND_BY{within_days, trigger}`, `OTHER` (unverifiable).
   - **Validation, deterministic:**
     1. The `quote` must exist **verbatim** in the cited source. If it doesn't, the promise is rejected. This is the anti-hallucination anchor.
     2. Numbers in `params` must appear in or be derivable from the quote (e.g. "$84.00" → 84.00).
     3. The currency must match the order.
     4. If confidence is below threshold or the promise isn't verifiable, it becomes "Needs merchant confirmation" and is never enforced automatically.
2. **Resolution Agent** (tool-using).
   - **Context:** the broken or at-risk commitment, the evaluator's computed facts (delta amounts, deadlines), the merchant policy, and the history.
   - **Read tools:** Agent Toolkit `get_order`, `get_refund`, `get_dispute`, `get_shipment_tracking`.
   - **Write tool:** a single `propose_remedy({kind: PARTIAL_REFUND | FULL_REFUND | ADD_TRACKING_REMINDER | MESSAGE_ONLY | DISPUTE_OFFER, amount?, message, citations[]})`. **It creates a proposal, not a payment.**
   - The policy engine then checks: amount ≤ computed delta (or the policy cap); remedy kind allowed; capture refundable; no remedy already executing. Only a human approval triggers execution.
3. **Plain-language Explainer.** Turns PayPal states into customer- or merchant-friendly text **using only fields passed in** (status, reason, timestamps, IDs). It must cite field names, and the template checks that every amount or date in the text appears in the input.
4. **(Should) Dispute Matcher.** Maps the dispute `reason` and buyer messages to ledger commitments. It drafts an honest response: concede and offer when the promise was broken, provide evidence when it was kept.

**Division of responsibility**

| AI reasoning | Deterministic logic | PayPal infrastructure |
|---|---|---|
| Finding promises in prose; classifying verifiability; drafting remedies and messages; explaining states | Quote-span validation; promise state machine (PENDING → KEPT / AT_RISK / BROKEN / WAIVED); all money math (deltas in integer minor units); deadlines; policy caps; idempotency; dedupe | Payment truth: order, capture, refund, tracker and dispute states; signed webhook events; executing refunds |

**Guarantees:**

- The LLM never sets a payment status.
- The LLM never computes the refund amount it executes.
- The LLM never calls a money-moving endpoint.

**Confidence and failure.**

- Missing or ambiguous data means **no automatic enforcement**; the item shows "needs confirmation".
- An LLM timeout or invalid JSON is retried once, then the item becomes "Extraction failed — review manually". The PayPal flow is unaffected.
- If a webhook is missing after N minutes, Kept polls the authoritative `GET`.

**Privacy.**

- Send minimum context to the model: no card data (PayPal never exposes it anyway) and buyer emails redacted.
- Secrets stay server-side.
- Store transcripts only for the demo merchant.

**Human approval.** Every refund, offer and dispute action needs an explicit merchant click. The UI shows the exact PayPal call it will make (amount, capture ID).

**Necessity test.** *"If we removed AI, would Kept be substantially less useful?"* **Yes.**

- Without AI, merchants would have to hand-encode every promise from every chat, email and policy into structured rules. In practice they never do, which is why the problem exists.
- AI-sales-agent promises in particular are generated dynamically per conversation, so only a model can turn them into commitments at the moment they are made.
- Without the promise layer, Kept collapses into an ordinary PayPal order viewer.
- What remains deterministic (the money math and state) is deliberately *not* AI.

---

## 12. Technical architecture

**Stack. The smallest set that does the job:**

| Concern | Choice | Why / free option |
|---|---|---|
| App | **Next.js (App Router) + TypeScript + Tailwind**, one repo, one deployable | Front and API routes together |
| DB | **Postgres on Neon free tier** via Drizzle ORM | Neon free doesn't expire. Render's free Postgres expires after 30 days, which would fall **inside the Dec 1–15 judging window**. Avoid it. |
| Hosting | **Render free web service** | Sponsor prize eligibility. Note: it spins down after inactivity (cold start). PayPal retries webhooks, and a "warm-up" link goes in the README. |
| AI | **Vercel AI SDK** (structured output and tool calling; the Agent Toolkit supports it natively) with a model that has a free tier (e.g. Google Gemini Flash) | Swap to a stronger paid model only if extraction accuracy fails the eval set. No paid service required. |
| PayPal | PayPal JS SDK (checkout buttons), REST via `fetch` with an OAuth token cache, `@paypal/agent-toolkit` for agent read tools | Official |
| Realtime UI | Polling every 2s, or Server-Sent Events | No extra infrastructure |
| Tests | Vitest | Free |

**Components:**

- `app/(store)` — demo storefront and AI sales chat (Adaeze Studio). The chat transcript is saved as a **source**.
- `app/(merchant)` — promises inbox, order ledger ("Said / Happened"), remedy sheet, policy settings, event log.
- `app/r/[token]` — customer living receipt (public, unguessable token).
- `lib/paypal/*` — token, orders, payments, tracking, disputes, webhook verification.
- `lib/ai/*` — extractor, resolution agent, explainer (schemas plus prompts).
- `lib/ledger/*` — state machine, evaluator, policy engine (pure functions, unit-tested).

**Database schema (minimal):**

```
merchants(id, name, policy_json)
orders(id, merchant_id, paypal_order_id UNIQUE, capture_id, custom_id UNIQUE,
       quoted_total_minor, currency, status, receipt_token UNIQUE, created_at)
sources(id, order_id, kind[chat|policy|page], text, sha256)
commitments(id, order_id, type, params_json, quote, source_id, span_start, span_end,
            confidence, state[PENDING|KEPT|AT_RISK|BROKEN|UNVERIFIABLE|WAIVED],
            due_at, evidence_event_id, updated_at)
paypal_events(id, paypal_event_id UNIQUE, event_type, resource_id, verified bool,
              payload_json, received_at, processed_at)
remedies(id, commitment_id, kind, amount_minor, message, citations_json,
         state[PROPOSED|APPROVED|EXECUTING|COMPLETED|PENDING|FAILED|REJECTED],
         paypal_request_id UNIQUE, paypal_refund_id, error_code, decided_by, decided_at)
audit_log(id, actor[ai|merchant|system|paypal], action, ref, detail_json, at)
```

**API routes:**

| Route | Purpose |
|---|---|
| `POST /api/chat` | Demo store AI sales chat; persists the transcript |
| `POST /api/orders` | Creates the PayPal order (`custom_id` = order id) and runs extraction |
| `POST /api/orders/:id/capture` | Captures, then re-fetches the capture |
| `POST /api/orders/:id/track` | Proxies PayPal `/track` |
| `POST /api/commitments/:id/confirm` · `/waive` | Merchant decisions on commitments |
| `POST /api/remedies/:id/approve` · `/reject` | Approve executes the refund with the stored `paypal_request_id` |
| `POST /api/webhooks/paypal` | Raw body → verify → dedupe → store → re-fetch resource → evaluate → (maybe) propose remedy |
| `POST /api/demo/clock` | Labelled simulation of time; only in `DEMO_MODE` |
| `GET /api/receipt/:token` | Data for the living receipt |

**Webhook handling order:**

1. Read the raw body.
2. Call verify-webhook-signature. On FAILURE, return 400 with no state change.
3. `INSERT … ON CONFLICT (paypal_event_id) DO NOTHING`. Skip if it is a duplicate.
4. Return 200 fast.
5. Process: re-fetch with `GET`, run the evaluator, write the audit log.

**Security:**

- Secrets only in server environment variables.
- Webhook signatures verified.
- Every amount is an integer in minor units, validated against the capture's remaining refundable amount.
- Currency checked.
- A `PayPal-Request-Id` is generated per remedy and reused on retry.
- Remedy execution uses a row lock or state transition (`APPROVED → EXECUTING` atomically) to prevent a double refund.
- Never display "Refunded" until PayPal returns or webhooks COMPLETED.
- The receipt token is 128-bit random.
- Rate-limit chat and extraction.
- No PII in LLM prompts beyond first names.
- The merchant area is protected by a single demo passcode. Real authentication is out of scope, and the README says so.

**Testing:**

- Unit tests for the evaluator, policy engine and money math.
- A **golden set of about 25 promise snippets** for the extractor. It includes adversarial cases: "up to 48h", "usually ships in 2 days", "about $84", and quotes in another currency. Track precision; the target is no false enforceable promises.
- A sandbox end-to-end script: create, approve (manual), capture, refund.
- Replay test of a stored, verified webhook payload for dedupe.

**Deployment:**

1. Render web service, Neon database.
2. Register the PayPal sandbox webhook to the Render URL.
3. Seed script creates the demo merchant and two pre-made orders, so judges see data instantly.
4. The README gives sandbox buyer credentials for judges, as the rules require.

**Simulated vs real**

| Real | Simulated (labelled) |
|---|---|
| PayPal sandbox orders, captures, refunds, tracking, webhooks, disputes; AI extraction and agent | The clock advance for SHIP_BY; the store itself (a demo merchant); carrier delivery (not used) |

---

## 13. UX and design direction

**Concept: "The Ledger and the Seal".** Kept should feel like a calm, exact document, part notarised receipt and part modern ledger, not a SaaS dashboard. The signature pattern is a **two-column "Said / Happened" row**:

- **Left:** the verbatim promise in a serif face, with its source.
- **Right:** what PayPal recorded, in monospace with IDs.
- **Between them:** a state seal (Kept / At risk / Broken).

**Colour system:**

- **Base:** warm paper `#F5F2EA`, ink `#15171A`, rule lines `#D9D3C4`.
- **State colours:** Kept green `#0E7A5A`, At-risk amber `#B26B00`, Broken brick `#B42318`, Unverifiable slate `#5B6470`.
- **One accent** for actions: deep indigo `#2B2F8F`.
- **Dark mode:** ink background `#121314`, paper text `#ECE7DA`, with the same state hues adjusted for 4.5:1 contrast.
- We deliberately **do not** imitate PayPal branding. PayPal-sourced facts carry a neutral "PayPal · verified" tag.

**Typography:**

- Newsreader (serif) for promise quotes and headlines.
- IBM Plex Sans for UI.
- IBM Plex Mono for amounts and IDs. Amounts use tabular figures.

**Layout and navigation.** Three destinations: **Promises** (inbox), **Orders**, **Settings**. The demo store and the customer receipt are separate surfaces. Use no card grids. Use rows, rules and whitespace.

**Key screens:**

1. **Promises inbox.** A list sorted by urgency: Broken → At risk (countdown) → Needs confirmation. Each row shows the quote, the customer, the amount and the state seal.
2. **Order ledger.** The order header (PayPal order and capture IDs, amount, fee, net), then Said / Happened rows, then a collapsible verified event log.
3. **Remedy sheet.** A slide-over showing:
   - what broke and the computed delta (with the code-computed badge)
   - the AI's proposed remedy and message, editable
   - the exact PayPal call preview
   - the **Approve** button
4. **Customer living receipt** (mobile-first):
   - "What you were promised"
   - "What happened" (plain-language PayPal states)
   - "Where your money is"
   - a timeline
   - a "Something's wrong?" link that pre-fills a message to the merchant
5. **Settings.** Remedy policy (caps, allowed remedies) and sources.
6. **Demo store with AI chat.** Clearly branded as a demo merchant.

**States:**

- **Loading:** skeleton rows, plus "Waiting for PayPal…" with the elapsed time.
- **Empty:** "No promises yet. Promises appear when a customer pays."
- **Error:** exact PayPal error code plus a human sentence plus retry. Never a generic "Something went wrong".
- **Success:** the seal stamps to "Kept" with a short, reduced-motion-safe animation.

**Accessibility:**

- State is never conveyed by colour alone (icon plus label).
- Full keyboard navigation; focus rings.
- Amounts are announced with currency.
- `prefers-reduced-motion` is respected.
- Body text 16px minimum. Layout works at 360px width.

---

## 14. Demonstration strategy

**Demo assets:**

- **Sandbox accounts:** business "Adaeze Studio" (US) and personal "Tom Reed" (GB).
- **Orders:** three pre-seeded orders (one kept, one at-risk, one with a sandbox dispute opened on day 3 so it exists by recording day) plus one **live** order created on camera.
- **Fallback:** a pre-recorded screen capture of the live segment, in case sandbox webhooks are slow during recording. Also the "poll by GET" fallback built into the product.
- **Expected AI output** for the live order, stated in advance so we can check it on camera:
  - `PRICE_AS_QUOTED 84.00 USD` ("your total is $84.00")
  - `SHIP_BY 48h` ("ships within 48 hours")
  - `UNVERIFIABLE` ("we'll sort you out if anything goes wrong")
- **Edge cases:**
  - **On camera:** the unverifiable promise is not enforced.
  - **In the README and a short cut:** the refund-failure mock shows "FAILED: insufficient funds", not success.

**Video script (≈2:30):**

| Time | Visual | Voiceover (AI voice allowed per the Nov 2 update) |
|---|---|---|
| 0:00–0:20 | Stills of real headlines (Air Canada chatbot ruling; Operator eggs $19.68 vs $31.43); a CFPB quote, "contact … multiple times" | "When you pay, someone promises you something: a price, a delivery date, a refund. Then the promise disappears, and the payment is all that's left. When they don't match, you become the detective. And now, AI agents are making those promises." |
| 0:20–0:40 | Kept logo; the Said / Happened row | "Kept binds every PayPal payment to the promises that justified it, watches PayPal's own records, and fixes broken promises before your customer has to ask." |
| 0:40–1:35 | Live: Tom chats with Adaeze Studio's AI assistant → "$84 with your discount, ships in 48h" → PayPal sandbox checkout → Kept order ledger fills: three promises extracted, quotes highlighted in the transcript; one marked "unverifiable, not enforced" | "The AI promised $84 and 48-hour shipping. Kept extracted both, each anchored to the exact words. The vague one, 'we'll sort you out', isn't enforced. The order is bound to PayPal through its custom ID." |
| 1:35–2:05 | **WOW:** the PayPal webhook arrives (event log: "PAYMENT.CAPTURE.COMPLETED · verified"); the Happened column shows **$93.33**; the row stamps **Broken: overcharged $9.33**; the remedy sheet shows the computed delta, the AI's message, and the PayPal call preview → **Approve** → refund COMPLETED → `PAYMENT.CAPTURE.REFUNDED` → phone view of Tom's receipt updates | "PayPal says $93.33. The discount the AI promised never reached checkout. Kept catches it from PayPal's verified event, and code computes the gap, not the AI. One approval, a real PayPal refund, confirmed by webhook. Tom never had to ask." |
| 2:05–2:30 | Labelled "demo clock +46h" → SHIP_BY turns At risk → add tracking → Kept. Then the dispute view: "dispute matched; promise kept; evidence ready". End card. | "Kept watches every promise until it's kept, and if a dispute comes anyway, the evidence is already there. For a new seller in Lagos selling to London, one avoidable dispute can mean held funds. Kept: every payment is a promise." |

---

## 15. Development roadmap (Africa/Lagos, WAT)

**Hard deadline:** Thu 12 Nov, **21:00 WAT** (12:00 PST). **Internal deadline:** Thu 12 Nov, **15:00 WAT**.

| Day | Focus | Exit criteria |
|---|---|---|
| **Wed 4 Nov (evening)** | Decide. Create a PayPal developer account and sandbox accounts (US business, GB personal), a Neon database, a Render account and an LLM API key. Make the repo public; add an **MIT licence**. Create the Devpost project draft. | Credentials work; `GET /v1/oauth2/token` succeeds in sandbox |
| **Thu 5 Nov** | **Technical proof.** Next.js skeleton on Render; JS SDK checkout → create/capture; webhook endpoint with signature verification and dedupe; one real `PAYMENT.CAPTURE.COMPLETED` verified. **Submit the Devpost draft today** for the official early eligibility check (offered to submissions made by 5 Nov). | Real verified webhook logged in the DB |
| **Fri 6 Nov** | Extractor (schema, prompt, span validator) + golden set; AI sales chat in the demo store; commitments bound to the order via `custom_id` | Over 90% of golden-set cases correct; zero fabricated quotes |
| **Sat 7 Nov** | Evaluator and state machine; policy engine; remedy proposal agent; approve → partial refund (`PayPal-Request-Id`) → `PAYMENT.CAPTURE.REFUNDED` reconciliation | The full overcharge loop works end-to-end in sandbox |
| **Sun 8 Nov** | Living receipt; explainer; SHIP_BY + `/track` + demo clock. **Open a sandbox dispute on a seeded order now** (actions take time to appear). | Both promise types demoable |
| **Mon 9 Nov** | Design pass (Said / Happened, seals, states, dark mode, mobile); refund-failure mock; dispute matcher (should; drop if behind) | UI is complete for every demo screen |
| **Tue 10 Nov** | Bug bash; seed and reset script; deploy hardening (cold start, env); README with setup, architecture, sandbox test credentials, honesty notes, AI-tools list. **Feature freeze at 18:00.** | A fresh clone runs from the README |
| **Wed 11 Nov** | Record the video (two takes plus a fallback live segment), edit to under 2:45, upload to YouTube (public); write the Devpost description | Video public; Devpost text complete |
| **Thu 12 Nov** | Buffer for fixes; final check of every link (repo, licence in About, hosted URL, video); **submit by 15:00 WAT** | Submitted, with 6 hours of buffer |

**Cut order if behind:**

1. Dispute matcher.
2. SHIP_BY and the demo clock.
3. Dark mode.

**Never cut:** the overcharge loop, webhook verification, the living receipt, or the video.

---

## 16. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PayPal developer sign-up blocked or limited from Nigeria | Medium [U] | Critical | Try day 1. If blocked, ask in the PayPal Discord (linked from the hackathon resources). Sandbox accounts are created per country, so US/GB test accounts are fine. |
| Sandbox webhooks delayed during recording | Medium | High | Product falls back to polling the authoritative `GET`; pre-recorded fallback take; record on a quiet hour |
| LLM extracts a wrong or invented promise | Medium | High | Verbatim-quote validator; numeric cross-check; confidence threshold; human confirmation; golden-set eval |
| Order-tracking endpoint behaves differently in sandbox | Low–Med | Medium | Test on day 4; if broken, show the tracker via the Shipment Tracking API (`/v1/shipping/trackers`) or cut SHIP_BY |
| Refund mock code not supported | Medium | Low | Produce real insufficient funds by draining the sandbox balance, or show the error-handling unit test |
| Render cold start annoys judges | High | Low–Med | "Wake the app" note; judges aren't required to run it; the video carries the demo |
| Scope creep | High | High | MVP table is the contract; cut order defined |
| Judges see it as "another refund desk" | Medium | High | Lead with *promise*, *AI-agent promises* and *before the customer asks*; show the Said / Happened row in the first 30 seconds |
| Rival project with the same concept appears | Low–Med | Medium | Differentiate on execution: real verified PayPal loop plus quote-anchored extraction |
| Free-tier LLM rate limits during the demo | Low | Medium | Cache extraction results per order; small prompts |

---

## 17. Devil's advocate

1. **"Merchants won't install something that pushes them to refund money."**
   - **Answer:** Kept proposes and the merchant decides. The pitch is economic: a $9.33 refund is cheaper than an INCORRECT_AMOUNT dispute, a fee and a possible hold. The policy engine also flags *customer* claims that the ledger contradicts.
   - **Change made:** Kept is positioned as "dispute and hold prevention", and the dispute view shows *kept* promises as evidence for the merchant.
2. **"Prose promises are fuzzy. The AI will invent obligations."**
   - **Answer:** Only three PayPal-witnessable types are enforced. Each needs a verbatim quote and a numeric cross-check. Anything else is shown but not enforced.
   - **Change made:** the "unverifiable" state was added as a visible feature, and it appears on camera.
3. **"PayPal can't see delivery, so 'ships by' isn't truly verified."**
   - **Answer:** Correct, and we say so. The commitment is "shipped (tracker added) by", which PayPal does record. Delivery is out of scope.
   - **Change made:** the promise type was renamed from DELIVER_BY to SHIP_BY.
4. **"Why wouldn't the checkout just apply the discount? The overcharge is contrived."**
   - **Answer:** The disconnect between a conversational agent's promise and a separate checkout system is exactly the Air Canada pattern: one part of the business says something another part doesn't honour.
   - **Change made:** the video opens with that precedent. The scenario stays honest: our demo store's checkout really doesn't read the chat.
5. **"Customer benefit depends on merchant adoption. The impact is indirect."**
   - **Answer:** True. Kept also fits platforms (marketplaces, agent-commerce surfaces) that host many merchants.
   - **Change made:** a Could-build MCP endpoint lets a buyer's agent query promise status. This frames Kept as the shared record for both sides.
6. **"It's just order management plus a chatbot."**
   - **Answer:** OMS tools don't store promises, and chatbots don't reconcile against signed PayPal events or execute idempotent refunds under policy.
   - **Change made:** the demo shows the verified-event log and the PayPal call preview, so the depth is visible.
7. **"Is there a more compelling idea hiding in the research?"**
   - Nigerian reversal tracking (strongest local pain) and buyer-side refund tracking have more raw empathy, but both fail the PayPal-integration rule.
   - Proof (fake-payment verification) is compelling in Lagos, but PayPal is peripheral to the real fake-alert problem, which happens on bank transfers.
   - Kept remains the best *joint* answer across all five criteria.
8. **Trust and security.** An AI anywhere near refunds alarms people. The LLM has no money-moving tool; there is a two-step state lock and idempotency key; and every action is attributed in the audit log.

The concept survives every critical test. It does not fail the PayPal-centrality, AI-necessity, evidence or feasibility tests.

---

## 18. Final decision

| | |
|---|---|
| **Product name** | **Kept** |
| **Precise problem** | Promises that justify a payment (quoted price, shipping time, refund timing), increasingly made by AI sales and support agents, are disconnected from the PayPal payment. Breaches surface only as complaints and disputes, after money has moved. |
| **Strongest differentiator** | The **promise** is the unit of work. It is extracted from prose with verbatim anchoring, bound to the PayPal order, and checked against **signed PayPal events**, so breaches are resolved *before* the customer asks. |
| **Core PayPal integration** | Orders v2 (`custom_id` binding, capture) → verified Webhooks (`PAYMENT.CAPTURE.*`, `PAYMENT.REFUND.*`, `CUSTOMER.DISPUTE.*`) → Payments v2 partial refund with `PayPal-Request-Id` → order tracking → Disputes API |
| **Core AI capability** | Quote-anchored promise extraction, plus a policy-bounded resolution agent that proposes but never executes remedies |

**Three features that absolutely must work:**

1. Promise extraction from the AI sales chat, bound to the PayPal order.
2. Verified-webhook monitoring with deterministic breach detection.
3. Approve → real sandbox partial refund → webhook-confirmed living receipt.

**The single most important demo moment:** "Promised $84.00 · PayPal captured $93.33". Caught from a verified PayPal event, fixed with one approval and confirmed by PayPal, before the customer says a word.

**First three things to implement:**

1. Sandbox credentials, then a Next.js app on Render that creates and captures an order via the JS SDK and logs one **signature-verified** `PAYMENT.CAPTURE.COMPLETED` (by Thu 5 Nov).
2. The promise extractor with the verbatim-span validator and a golden test set.
3. The evaluator plus the approve-to-refund loop with idempotency and `PAYMENT.CAPTURE.REFUNDED` reconciliation.

**Also do tomorrow:** submit the Devpost draft by 5 November to get the official early eligibility check.

## Verdict: **BUILD THIS.**

---

### Appendix A — Verified hackathon facts (official Devpost pages, read 4 Nov 2026)

- **Submission period:** 1 Oct 2026, 9:15am PT, to **12 Nov 2026, 12:00pm PST (21:00 WAT)**.
- **Judging:** 1–15 Dec 2026. **Winners:** on or around 21 Dec 2026 (the rules page and the schedule page give different times).
- **Eligibility:** Nigeria is not on the excluded list. The rules list Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and OFAC-sanctioned regions. Entrants must be at the age of majority. Solo entries are allowed, with no team-size cap.
- **Prizes:**
  - 1st $12,000; 2nd $8,000; 3rd $5,000.
  - $5,000 each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce.
  - Sponsor prizes: AG Grid, APIMatic, Bryntum, Channel3, Render (credits).
  - A project may win one Grand Prize or one Honorable Mention, plus one Sponsor Prize.
- **Why the totals differ:** "$67,500" is the cash total. "$69,750" adds $2,250 in Render credits.
- **Criteria:** equally weighted, each scored 1–5. Stage One is pass/fail on fit and API usage. Judges aren't required to run the project, so the video is critical. Automated AI analysis may be used in judging.
- **Requirements:**
  - Use the PayPal developer platform in **sandbox**, plus any AI.
  - A working prototype.
  - A public repo with an open-source licence detectable in its About section.
  - A public YouTube video under 3 minutes (an AI voiceover is allowed).
  - Test credentials for judges.
  - The project is new, or significantly updated during the period.
- **Sources:**
  - https://paypalaihackathon.devpost.com/
  - https://paypalaihackathon.devpost.com/rules
  - https://paypalaihackathon.devpost.com/resources
  - https://paypalaihackathon.devpost.com/updates

### Appendix B — Further sources

- Air Canada: https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do · https://globalnews.ca/news/10297307/air-canada-chatbot-error-bc-ruling
- Cursor "Sam": https://incidentdatabase.ai/cite/1039/
- Operator eggs: https://www.adn.com/alaska-life/2025/02/09/i-let-chatgpts-new-agent-manage-my-life-it-spent-31-on-a-dozen-eggs/
- NMI agent liability: https://www.nmi.com/blog/who-pays-when-an-ai-agent-buys-the-wrong-thing/
- AP2 critique: https://arxiv.org/html/2608.23858v1
- Bain: https://www.bain.com/insights/agentic-ai-commerce-hinges-on-consumer-trust/
- YouGov: https://yougov.com/en-us/articles/53808-american-trust-in-ai-for-retail-consumer-sentiment-in-2025
- Chargebacks911: https://www.chargebacks911.com/chargeback-field-report/
- Ethoca: https://www.ethoca.com/sites/default/files/documents/DR%20Infographic.pdf
- FOS: https://www.financial-ombudsman.org.uk/who-we-are/data-insight/news/financial-ombudsman-resolved-220000-cases-last-year
- UK subscriptions: https://www.gov.uk/government/news/new-measures-unveiled-to-crack-down-on-subscription-traps
- PayPal holds: https://www.paypal.com/us/cshelp/article/faq3297
- PayPal in Nigeria: https://techcabal.com/2026/01/27/paypal-returns-to-nigeria-after-two-decades-this-time-through-paga/ · https://allafrica.com/stories/202601270689.html · https://nairametrics.com/2026/01/27/paypal-return-sparks-boycott-calls-and-mixed-reactions-in-nigeria
- Dubawa fake alerts: Dubawa fact-check, 12 Feb 2024
- PayPal Agentic Commerce Services: https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping
- EMVCo intent layer: https://www.pymnts.com/news/artificial-intelligence/2026/emvco-proposes-intent-layer-for-agentic-card-payments/
- Chargeflow funding: https://www.pymnts.com/news/investment-tracker/fintech-investments/2025/chargeflow-raises-35-million-dollars-expand-ai-powered-chargeback-automation-platform/
