# Gap-fill: PayPal competition, independent share data, customer evidence, India/Japan, Nigerian freelancer payments (2023 to Nov 2026)

Slice: `gap_paypal_comp`. Ledger: `research/ledger/gap_paypal_comp.jsonl`. It has 54 records: 50 [F] fetched and 4 [S] snippet. It covers 52 distinct domains, 46 of which are not in `EXISTING_DOMAINS.txt`. 45 of the new domains have at least one [F] document (44 if `venmo.com` and `help.venmo.com` count as one).

This file adds to `reports/paypal.md` and does not repeat it. Where I rely on PayPal facts from that report (for example branded checkout growth of +1–2% and the CFPB complaint counts), I say so and do not re-cite.

---

## 1. Key findings (top 10)

1. **No independent source measures checkout-button *usage* share. Acceptance data and usage data point in opposite directions.**
   - Acceptance: BuiltWith counts **15.0m live websites accepting PayPal**, against Apple Pay 3.73m, Google Pay 2.93m, Shop Pay 2.39m, Stripe 1.38m and Klarna 1.03m ([BuiltWith](https://trends.builtwith.com/payment/PayPal) [F]).
   - Usage: Capital One Shopping finds PayPal the most *used* US wallet (42% of Americans), but Apple Pay wins as *primary* wallet (28% vs PayPal 19%) ([Capital One Shopping](https://capitaloneshopping.com/research/digital-wallet-statistics/) [F]).
   - VERIFIED for each data point. INTERPRETATION: PayPal has reach but is losing the default position.
2. **Shop Pay is the fastest-scaling branded checkout.** It processed **$43bn in Q4 2025, over 50% of Shopify's US payment volume (GPV)**. Shopify Payments reached 68% of GMV ([Substack analysis of Shopify Q4'25](https://sergeycyw.substack.com/p/shopify-q4-2025-earnings-analysis) [F]). Shopify's Q3 2026 GMV was **$119bn, with 30%+ growth** ([Shopify](https://www.shopify.com/news/shopify-q3-2026-financial-results) [F]). PayPal's branded checkout grew 1–2% over the same period (per `paypal.md`). VERIFIED / REPORTED.
3. **Wallets already dominate online spend, so PayPal's problem is share within wallets, not wallet adoption.**
   - Worldpay GPR 2025: wallets were **53% of global e-commerce spend** and **39% of US online spend** in 2024, and 65% of Americans fund wallets with cards ([Worldpay](https://www.worldpay.com/en/press-releases/10-years-cash-cards-and-crypto-worldpays-global-payments-report) [F]).
   - Europe: 33% online, Germany 35% ([mind Retail](https://www.mind.eu.com/retail/en/article/payments-wallets-accelerate-in-a-fragmented-market/) [F]).
   - VERIFIED.
4. **US P2P rivals are attacking Venmo's monetisation.**
   - Venmo charges personal sellers **2.99%**, business profiles 1.9%+$0.10 and Instant Transfer 1.75% ([Venmo](https://venmo.com/about/fees/) [F]).
   - Cash App is piloting **"Earn in P2P," a no-fee way to accept payments**, aimed at the ~70% of its 60m actives who are "modern earners" ([Block Q3'26 letter](https://www.sec.gov/Archives/edgar/data/0001512673/000162828026069513/q32026shareholderletter.htm) [F]).
   - Zelle: 8.3m small-business accounts moved **>$200bn in H1 2026**, and 99.4% of linked accounts pay no fee ([Zelle](https://www.zellepay.com/press-releases/zelle-tag-adoption-tops-1-million-small-businesses-across-america-enroll-rate-nearly) [F]).
   - VERIFIED.
5. **Cross-border receiving is consolidating and getting cheaper, which squeezes PayPal's cross-border/Xoom pricing.**
   - Payoneer agreed (12–15 Jun 2026) to be **acquired by Nuvei** ([Payoneer via Finviz](https://finviz.com/news/406626/payoneer-to-report-third-quarter-2026-results-on-november-5-2026) [F]).
   - Wise moved **$243bn at a 52bps take rate** in FY26, down from 58bps ([Investegate RNS](https://www.investegate.co.uk/announcement/rns/wise-class-a--wise/wise-fy26-results/9637901) [F]).
   - Western Union's Intermex deal is stuck at California's DFPI, while WU's branded digital transactions grew 21% ([WU 8-K](https://www.sec.gov/Archives/edgar/data/0001365135/000119312526447234/wu-ex99_1.htm) [F]).
   - VERIFIED.
6. **PayPal's reliability problems are recurrent and under-reported on its own status page.**
   - 21 Nov 2024: >8,400 Downdetector reports ([KTVU](https://ktvu.com/news/is-paypal-down-thousands-report-issues-nov-21-2024) [F]).
   - 1 Aug 2025: Retail Checkout and Braintree disrupted for hours, while Venmo stayed "Operational" despite more user reports ([Tom's Guide](https://www.tomsguide.com/news/live/venmo-paypal-down-aug-1-outage) [F]).
   - 16 Oct 2025: PayPal and Venmo down together for about 2 hours ([BGR](https://bgr.com/1998690/paypal-venmo-down-outage-october-2025/) [F]).
   - VERIFIED (pattern).
7. **Independent review sites confirm the holds and limitations pain found in CFPB data.**
   - ProductReview.com.au: **1.4/5 from 2,690 reviews** ([ProductReview](https://www.productreview.com.au/listings/paypal) [F]).
   - PissedConsumer: **1.9/5 from 3,194 reviews**, with "funds on hold" and 180-day withholding as recurring themes ([PissedConsumer](https://www.pissedconsumer.com/company/paypal.html) [F]).
   - The User Agreement allows risk-based holds of up to 21 days. A terms tracker logged a Sep 2026 change toward mandatory individual arbitration with class waivers ([ConductAtlas](https://conductatlas.com/platform/paypal/paypal-user-agreement/provision/CA-P-019953/paypal-risk-based-holds-up-to-21-days/) [F]).
   - REPORTED.
8. **India: PayPal lost the legal argument and registered with the FIU.**
   - The Delhi HC held (24 Jul 2023) that PayPal is a "payment system operator" under the PMLA, India's anti-money-laundering law, but quashed the ₹96 lakh penalty ([Bar & Bench](https://www.barandbench.com/news/litigation/paypal-payment-system-operator-under-pmla-should-comply-reporting-entity-obligations-delhi-high-court) [F]).
   - PayPal appealed (Aug 2023) ([Inc42](https://inc42.com/buzz/paypal-challenges-delhi-hcs-payment-system-operator-tag-under-pmla) [F]), then **registered with FIU-IND by Feb 2024** ([MediaNama](https://www.medianama.com/2024/02/223-paypal-registers-indias-financial-intelligence-unit-anti-money-laundering-regulations/) [F]).
   - VERIFIED. The outcome of the appeal was not found.
9. **Nigeria: PayPal still lets personal accounts send but not withdraw locally, and the substitutes are fragile.**
   - Vendors and press say PayPal "has never offered full withdrawal functionality in Nigeria" ([Brands.ng](https://brands.ng/?p=2613) [F]; [Cleva](https://getcleva.com/blog/how-to-withdraw-paypal-funds-in-nigeria-at-the-best-rates) [F]).
   - Virtual dollar cards repeatedly shut down: the Union54 pause (2022), Rise (Sep 2024) and Carbon (2024) ([Tech In Africa](https://www.techinafrica.com/rise-halts-virtual-card-services-amid-exchange-rate-volatility-and-provider-challenges/) [F]; [WeeTracker](https://weetracker.com/?p=78351) [F]).
   - Upwork added a **$2.99 fee on the previously free Direct-to-US-Bank route** for non-US freelancers from 1 Sep 2026 ([Cleva](https://www.getcleva.com/blog/upworks-new-2-99-withdrawal-fee-dont-let-it-cost-you-twice) [F]).
   - REPORTED.
10. **Agentic checkout is being built by networks and banks, not just wallets.**
    - Visa Intelligent Commerce pilots ran with Santander in five LatAm markets (Mar 2026) ([Santander](https://www.santander.com/en/press-room/press-releases/2026/03/santander-and-visa-deliver-latin-americas-first-end-to-end-payments-powered-by-ai-agents) [F]).
    - Stripe launched "machine payments" via stablecoin micropayments, on $1.9tn of 2025 volume (+34%) ([Stripe](https://stripe.com/en-jp/newsroom/news/stripe-2025-update) [F]).
    - Shopify is building "into every agent" ([Shopify](https://www.shopify.com/news/shopify-q3-2026-financial-results) [F]).
    - VERIFIED for the launches. INTERPRETATION: this is a risk that PayPal's button gets bypassed.

---

## 2. Detailed findings

### 2.1 Independent checkout and wallet share data (the main gap in `paypal.md`)

**What exists and what does not.** I found no independent, recent, methodologically transparent measure of *share of online checkouts* by button (PayPal vs Shop Pay vs Apple Pay vs Stripe Link vs Klarna). The best available evidence falls into four types, and they measure different things:

| Type | Source | What it says | Label |
|---|---|---|---|
| Wallet share of spend (all wallets) | [Worldpay GPR 2025](https://www.worldpay.com/en/press-releases/10-years-cash-cards-and-crypto-worldpays-global-payments-report) [F] | Wallets 53% of global e-com and 32% of POS (2024). US online wallet share rose from 15% (2014) to 39% (2024). >$28tn via wallets by 2030 | VERIFIED (industry report) |
| Wallet share, Europe | [mind Retail citing Worldpay](https://www.mind.eu.com/retail/en/article/payments-wallets-accelerate-in-a-fragmented-market/) [F] | Europe wallets 33% online / 14% in-store. Germany 35%, France 34% (+6pts in a year). Forecast of 65% of e-com by 2030 | REPORTED |
| Wallet value (different definition) | [Datos Insights](https://datos-insights.com/blog/digital-wallet-revolution-strategic-implications-financial-services/) [F] | Wallet spend $41.0tn in 2024, 83% of *digital* payment volume, 51% in-store. APAC $36.8tn, EMEA $2.0tn | REPORTED; not comparable to Worldpay |
| Merchant acceptance (technographics) | [BuiltWith](https://trends.builtwith.com/payment/PayPal) [F] | PayPal 15.0m live sites (plus 20.0m historical), ~3.06m of them Shopify stores. Apple Pay 3.73m, Google Pay 2.93m, Shop Pay 2.39m, Stripe 1.38m, Klarna 1.03m, Venmo 0.88m | VERIFIED as counts; measures presence, not volume |
| Consumer usage surveys | [Capital One Shopping](https://capitaloneshopping.com/research/digital-wallet-statistics/) [F] (updated 2 Aug 2026) | 42% of Americans use PayPal, Apple Pay 34%, Venmo 33%, Cash App 24%. Primary wallet: Apple Pay 28% vs PayPal 19%. UK 2024: Apple Pay 63% of wallet users vs PayPal 39%. Germany: PayPal used by 50% | REPORTED (compiles third-party surveys) |
| Older merchant-button survey | PYMNTS Buy Button 2022 [S] | PayPal offered by 76% of merchants, Apple Pay 10% | Snippet; pre-window |

**INTERPRETATION.**
- PayPal's moat is breadth of acceptance: about 4× Apple Pay's site count and about 6× Shop Pay's on BuiltWith.
- Its weakness is default status. Apple Pay has become the "primary" wallet for more Americans, and Shop Pay converts a concentrated, high-GMV merchant base.
- That fits PayPal's own disclosure that branded checkout is stuck at +1–2% while wallets overall gain share.
- It is a **share-of-wallet-category loss, not a category decline.**

**Shop Pay.**
- Shop Pay processed **$43bn in Q4 2025**, over 50% of Shopify's US GPV. Shopify Payments processed $84bn (+38%), 68% of GMV, and FY2025 GMV was $378bn (+29%). Shop Pay Installments expanded to the UK and Canada ([analysis](https://sergeycyw.substack.com/p/shopify-q4-2025-earnings-analysis) [F], consistent with the search snippet of Shopify's call).
- Q3 2026: GMV $119bn, revenue +32%, "30%+ growth across GMV, revenue, gross profit and FCF" ([Shopify](https://www.shopify.com/news/shopify-q3-2026-financial-results) [F]). Shopify's own release text does not state Shop Pay GMV for Q3 2026. That is a gap.
- PayPal's partnership to process part of Shopify Payments in the US (from `paypal.md`) means PayPal earns from some of this volume as a processor. It does so at unbranded (Braintree-type) margins, not branded ones. INTERPRETATION.

**Stripe and Link.**
- Stripe's 2025 letter: $1.9tn TPV (+34%), >5m businesses, 57% of the 2025 cohort outside the US, and "machine payments" for agents ([Stripe](https://stripe.com/en-jp/newsroom/news/stripe-2025-update) [F]).
- The widely repeated "Link >200m users" appears only in secondary citations ([FXC Intelligence](https://www.fxcintel.com/research/analysis/stripe-annual-letter-2025) [S]). I did not find it in Stripe's own release. UNVERIFIED.
- Technographic "Stripe market share" figures range from **1.5% to 22.41%** depending on the tracker ([Chargeback.io](https://www.chargeback.io/blog/stripe-statistics) [F]). Any "X% checkout share" claim built on such trackers should be distrusted.

**Checkout friction (why wallets win).** Baymard's 2026 benchmark puts average cart abandonment at **70.22%** across 50 studies. Among non-browsing abandoners, reasons include:
- 40% extra costs
- **19% "didn't trust the site with my credit card"**
- 18% forced account creation
- 17% long checkout
- 10% card declined
- 9% not enough payment methods

([Baymard](https://baymard.com/lists/cart-abandonment-rate) [F]). These are exactly the frictions PayPal (trust, no card entry) and Shop Pay/Link (one-click) solve. The value proposition is intact; the contest is over who owns it.

**Unreliable claims to discard.**
- A vendor blog asserts "PayPal holds a 45% global market share for online payments in 2025" with no method ([Clearly Payments](https://www.clearlypayments.com/blog/what-are-the-most-popular-payment-methods-in-2025/) [F]). This is inconsistent with Worldpay's 53% for *all* wallets combined.
- An aggregator claims Apple Pay "nears parity" with or overtook PayPal at checkout ([Pulse](https://www.pulse.bot/fintech/news/apple-flags-paypal-checkout-share-erosion-as-apple-pay-nears-parity-754bd1e7-dc88-43e6-b8e2-5a2e40e76dc3/) [S], site returned 503).
- Neither should be used.

### 2.2 Competitors' disclosures, 2025–2026

**Apple.** From iOS 18.1 (Oct 2024), Apple opened iPhone NFC and the Secure Element to third-party apps for in-store payments in AU, BR, CA, JP, NZ, UK and US. Developers must sign a commercial agreement and **"pay the associated fees"** ([Apple Newsroom](https://www.apple.com/newsroom/2024/08/developers-can-soon-offer-in-app-nfc-transactions-using-the-secure-element/) [F]). This is a paid opening beyond the EU's mandated one. It technically allows a PayPal/Venmo tap-to-pay wallet on iPhone, but Apple controls the terms. VERIFIED.

**Block / Cash App.**
- Q2'26: gross profit $3.17bn (+25%), Cash App GP $1.97bn (+31%), 59m monthly transacting actives, 9.4m primary-banking actives (+17%), lending originations $18.9bn (+59%) ([Crypto Briefing](https://cryptobriefing.com/block-bitcoin-gross-profit-falls-cash-app-fee-cuts/) [F]).
- Q3'26 letter: 60m actives, Cash App GP +27%, Square GPV +14% ([SEC 8-K](https://www.sec.gov/Archives/edgar/data/0001512673/000162828026069513/q32026shareholderletter.htm) [F]).
- The letter also includes ~70% "modern earners" (freelance, creator and gig), the no-fee **Earn in P2P** pilot, and 28m Cash App Card actives.
- INTERPRETATION: Cash App is converting P2P receivers into banked customers, the model Venmo is attempting.

**Zelle.** The network moves >$1tn a year across 2,400+ banks and credit unions. 8.3m small-business accounts moved >$200bn in H1 2026, and Zelle tag passed 1m SMBs (~$5.8bn received) ([Zelle](https://www.zellepay.com/press-releases/zelle-tag-adoption-tops-1-million-small-businesses-across-america-enroll-rate-nearly) [F]). It is a free substitute for Venmo business profiles. VERIFIED (company data).

**Affirm.**
- FY2026 (to 30 Jun 2026): ~571k active merchants (+51%), 27.8m active consumers (+21%), present at ~80 of the top 250 e-commerce sites but only ~10% of merchants overall ([Stocktwits](https://stocktwits.com/news-articles/markets/equity/afrm-stock-rallies-toward-2-month-highs-after-q4-beat-ceo-still-sees-enormous-amount-of-greenfield-in-merchant-growth/cZYqrckRJqA) [F]).
- Q4 GMV $14.1bn (+36%) and FY $50.2bn ([Crowdfund Insider](https://www.crowdfundinsider.com/2026/08/302674-bnpl-fintech-affirm-beats-revenue-estimates-and-lifts-outlook-as-afrm-stock-surge-in-after-hours/) [S]).

**Payoneer.**
- Q3'25: revenue ~$271m (+9%), volume >$22bn, marketplace-seller volume $12.5bn (+4%), B2B $3.1bn (+11%). The CEO cited "over 10 consecutive quarters of ARPU and SMB take rate expansion" as it moves upmarket ([LionhearTV reprint](https://www.lionheartv.net/2025/11/payoneer-reports-third-quarter-2025-financial-results) [F]).
- Then a merger agreement dated 12 Jun 2026 with **Nuvei** (Neon Maple Parent). Payoneer has dropped earnings calls pending the deal ([Finviz/PRN](https://finviz.com/news/406626/payoneer-to-report-third-quarter-2026-results-on-november-5-2026) [F]).
- INTERPRETATION: the main African freelancer rail is raising take rates and is about to change ownership.

**Wise.** FY26: 19m active customers (+21%), $243bn cross-border volume (+31%), take rate 52bps (FY25: 58bps), net revenue $2.5bn. New licences in **South Africa**, UAE and Thailand, and Capitec became a Wise Platform partner (Apr 2026) ([Investegate](https://www.investegate.co.uk/announcement/rns/wise-class-a--wise/wise-fy26-results/9637901) [F]). VERIFIED.

**Western Union.** Q3'26 revenue was $1.0bn (−2%). Branded Digital revenue grew 8%, transactions 21%, and Digital is 45% of consumer money transfer (CMT) transactions. The Intermex merger (agreed 10 Aug 2025) awaits California DFPI, and guidance assumes a 10 Nov 2026 close ([8-K](https://www.sec.gov/Archives/edgar/data/0001365135/000119312526447234/wu-ex99_1.htm) [F]). VERIFIED.

**Visa and agentic.**
- Santander and Visa Intelligent Commerce completed controlled agentic purchases in Argentina, Brazil, Chile, Mexico and Uruguay ([Santander](https://www.santander.com/en/press-room/press-releases/2026/03/santander-and-visa-deliver-latin-americas-first-end-to-end-payments-powered-by-ai-agents) [F]).
- Visa Q2 FY26 revenue rose 17% to $11.2bn, and its CEO called agentic commerce "an entirely new ecosystem." No agentic volume was disclosed ([Stellagent](https://stellagent.ai/insights/visa-q1-fy26-agentic-commerce-growth-driver) [F], vendor blog).

**Industry frame (BCG via TechIntelPro).** Payments revenue is $1.9tn (2024), heading to $2.4tn by 2029 (~4% CAGR). Fintech payments revenue is $176bn, growing 23%. Stablecoins handled $26tn of volume but only ~1% "real-world payments" ([TechIntelPro](https://techintelpro.com/Finance/Payments-%26-Wallets/bcg-payments-revenue-to-hit-24t-by-2029-amid-ai-shift) [F]). PayPal's ~1% branded growth is far below even this slowing industry rate. INTERPRETATION.

### 2.3 PayPal customer evidence not previously gathered

**Review aggregators (outside Trustpilot and BBB, which were blocked for `paypal.md`).**
- ProductReview.com.au rates PayPal **1.4/5 on 2,690 reviews**. Recent complaints cover refunds not credited for over 3 weeks (Sep 2026), scam refunds denied, Pay in 4 instalment failures, and repeated email plus SMS two-factor friction ([ProductReview](https://www.productreview.com.au/listings/paypal) [F]).
- PissedConsumer (updated 4 Nov 2026) rates it **1.9/5 on 3,194 reviews**, with 30% saying they would recommend. Its AI summary flags "funds on hold," limits, verification and live-agent waits. Individual reviews describe 180-day holds after closure, and PayPal responses justify holds by "potential for future reversals" ([PissedConsumer](https://www.pissedconsumer.com/company/paypal.html) [F]).
- Caveat: self-selected samples. These corroborate, but cannot quantify, the CFPB "trouble accessing funds" rise reported in `paypal.md`.

**Terms.**
- PayPal's User Agreement allows **risk-based holds of "up to 21 days"** from receipt.
- ConductAtlas logged a 15 Sep 2026 change it describes as mandatory individual arbitration with class-action and jury waivers and a 60-day informal-resolution step ([ConductAtlas](https://conductatlas.com/platform/paypal/paypal-user-agreement/provision/CA-P-019953/paypal-risk-based-holds-up-to-21-days/) [F]).
- I could not open PayPal's own upcoming-policies page (403), so the arbitration change is REPORTED, not VERIFIED.
- Consumer Reports' P2P study (Aug–Oct 2022 fieldwork, published Jan 2023) found that fraud and error policies "can leave consumers at risk of losing money," and that apps impose mandatory arbitration and confusing FDIC conditions ([CR Advocacy](https://advocacy.consumerreports.org/research/peer-to-peer-payment-apps-a-case-study-for-a-digital-finance-standard) [F]).

**Venmo fees and tax.**
- Fees are as above, plus a 3% credit-card send fee and 5% (min $0.99, max $4.99) to non-US PayPal accounts ([Venmo](https://venmo.com/about/fees/) [F]).
- I found no evidence of a 2025–26 change to the 2.99% personal goods-and-services fee. A search returned none, and the live schedule shows 2.99%.
- US 1099-K policy whiplash: in Jan 2025 the IRS plan was $2,500 for 2025 and $600 for 2026 ([Fortune](https://fortune.com/2025/01/30/irs-1099-k-reporting-ebay-venmo-facebook-marketplace/) [F]). The July 2025 law restored **$20,000/200 transactions** from 2025 ([Venmo Tax FAQ](https://help.venmo.com/hc/en-us/articles/4407389460499-Venmo-Tax-FAQ) [F]).
- INTERPRETATION: this removed a friction that had pushed casual sellers to mislabel goods-and-services payments as friends-and-family. That in turn lowers fraud-protection exposure but also revenue pressure.

**Outages (press via Downdetector).** There were three significant events in 12 months:

| Date | What happened | Source |
|---|---|---|
| 21 Nov 2024 | Login failures, 8,400+ reports, "system issue" | [KTVU](https://ktvu.com/news/is-paypal-down-thousands-report-issues-nov-21-2024) [F] |
| 1 Aug 2025 | Retail Checkout/Reporting/Braintree "Service Disruption" for hours. Venmo had more reports but stayed "Operational"; Venmo has no own status page | [Tom's Guide](https://www.tomsguide.com/news/live/venmo-paypal-down-aug-1-outage) [F] |
| 16 Oct 2025 | PayPal and Venmo both down about 11:00–13:00 ET. PayPal said only "brief technical issue" | [BGR](https://bgr.com/1998690/paypal-venmo-down-outage-october-2025/) [F] |

Add the Aug 2025 German direct-debit failure from `paypal.md`. VERIFIED (pattern); root causes are never disclosed.

### 2.4 India and Japan

**India (FIU-IND / PMLA).** Timeline:
- **Dec 2020:** FIU-IND fines PayPal ₹96 lakh (₹1 lakh per offence × 3 offences × 32 months) for not registering as a reporting entity ([Verdictum](https://www.verdictum.in/court-updates/high-courts/paypal-payment-system-operator-required-comply-reporting-entity-obligations-pmla-1486603) [F]).
- **24 Jul 2023:** Justice Yashwant Varma holds PayPal a "payment system operator" bound by PMLA reporting, but sets aside the penalty because PayPal acted on a bona fide belief ([Bar & Bench](https://www.barandbench.com/news/litigation/paypal-payment-system-operator-under-pmla-should-comply-reporting-entity-obligations-delhi-high-court) [F]).
- **23 Aug 2023:** PayPal appeals to a division bench, arguing it is only an OPGSP (online payment gateway service provider) intermediary ([Inc42](https://inc42.com/buzz/paypal-challenges-delhi-hcs-payment-system-operator-tag-under-pmla) [F]).
- **Feb 2024:** PayPal registers with FIU-IND. FIU had argued that PayPal files suspicious-transaction reports in the US, Australia, Hong Kong and Luxembourg but refused to in India ([MediaNama](https://www.medianama.com/2024/02/223-paypal-registers-indias-financial-intelligence-unit-anti-money-laundering-regulations/) [F]).
- VERIFIED. The appeal outcome is unknown.
- INTERPRETATION: PayPal's India posture (cross-border-only since its 2021 domestic exit) still required it to accept full AML reporting duties. That raised compliance cost for a market where it earns only export-collection revenue.

**Japan (Paidy).** Paidy G.K. joined the Japan BNPL Service Association as a full member on 28 May 2026 ([JBNPLA](https://j-bnpla.jp/news_20260529/) [F]).
- The association exists for consumer protection and guideline-setting.
- In 2026 it held exchanges with the Cabinet Office Consumer Commission, METI (8 Oct 2026) and the National Consumer Affairs Center (16 Oct 2026).
- INTERPRETATION: Japanese BNPL is moving toward a self-regulatory regime under ministry watch, a pre-regulatory signal.
- I found **no FSA enforcement action** against Paidy. The FSA English news index showed only crypto items ([FSA index](https://www.fsa.go.jp/en/news/index.html), fetched, not ledgered as no relevant fact).

### 2.5 Nigerian and African freelancer receive-side experience

**The PayPal gap.** Nigerian personal PayPal accounts can pay but cannot receive or withdraw locally in a usable way. This dates to 2005, with partial relaxation in 2014, and business accounts also cannot withdraw to Nigerian banks. Freelancers resort to "risky local exchangers" (Cleva claims more than 1.7m Nigerian freelancers) ([Cleva](https://getcleva.com/blog/how-to-withdraw-paypal-funds-in-nigeria-at-the-best-rates) [F], interested party). Independently, "PayPal has never offered full withdrawal functionality in Nigeria" ([Brands.ng](https://brands.ng/?p=2613) [F]). Combined with `paypal.md`'s Paga Remit finding: REPORTED (two sources plus PayPal's partner page).

**Card-rail fragility, 2022–2025.**

| When | Event | Source |
|---|---|---|
| Jul 2022 (baseline) | Union54 paused for a "compliance audit," forcing Flutterwave/Barter, Eversend, Payday, GetEquity, Busha and Vesti to suspend dollar cards. Banks then capped international spend at $20/day | [Benjamindada](https://www.benjamindada.com/alternative-virtual-dollar-cards-nigeria/) [F] |
| 2023 | Payday began terminating cards on insufficient-fund declines | [Tech In Africa](https://www.techinafrica.com/rise-halts-virtual-card-services-amid-exchange-rate-volatility-and-provider-challenges/) [F] |
| 2024 | Carbon discontinued debit cards. Rise ended virtual cards on 30 Sep 2024 (FX volatility, unreliable providers). Bridgecard's CEO: schemes tolerate about 1% chargebacks and charge $20–$100 decline fees | [Tech In Africa](https://www.techinafrica.com/rise-halts-virtual-card-services-amid-exchange-rate-volatility-and-provider-challenges/) [F]; [WeeTracker](https://weetracker.com/?p=78351) [F] |
| Jun–Jul 2025 | Naira cards work abroad again after about 3 years | [Techsoma](https://techsoma.africa/?p=4426) [F]; [Grey](https://grey.co/blog/pay-for-google-ads-in-nigeria) [F] |

**DISPUTED:** the cap on the restored naira cards.
- Techsoma reports Wema at up to $500/month.
- Grey says the CBN "still enforces a $20-per-month cap."
- Grey sells the alternative product, so it is an interested party.

**Licensing and formalisation.**
- Raenest (Geegpay) received a CBN IMTO (international money transfer operator) licence (Jul 2024) and markets Upwork-to-Raenest in under an hour ([Raenest](https://www.raenest.com/blog/monthly-roundup-july-2024) [F]).
- Techsoma headlines a Grey IMTO approval (unverified detail).
- In Jan 2026 the CBN upgraded several fintechs and MFBs to national licences because they "were operating far beyond the limits of their original licences" ([allAfrica](https://allafrica.com/stories/202601270517.html) [F]; [Nigerian NewsDirect](https://nigeriannewsdirect.com/amp/cbns-license-upgrade-ends-grey-area-era-for-nigerian-fintechs/) [F]).

**Marketplace payouts.**
- Upwork's $2.99 Direct-to-US-Bank fee for non-US tax addresses starts 1 Sep 2026. Other routes, including PayPal and Payoneer, cost about $1–$50 ([Cleva](https://www.getcleva.com/blog/upworks-new-2-99-withdrawal-fee-dont-let-it-cost-you-twice) [F], citing Upwork support).
- Payoneer is "the most popular option for African freelancers" across Nigeria, Ghana, Kenya and Uganda, and Wise is available in Kenya and Nigeria ([ProGigFinder](https://www.progigfinder.com/blog/how-to-receive-upwork-payments-in-uganda-kenya-nigeria-and-ghana-in-2026) [F]).
- Grey users report ACH delays of 3–5 days ([Brands.ng](https://brands.ng/?p=2613) [F]).

---

## 3. Official claims vs independent evidence (additions)

| Official claim | Independent evidence | Assessment |
|---|---|---|
| PayPal: branded checkout improving where its "playbook" is deployed (`paypal.md`) | Shop Pay $43bn/qtr at +62% (snippet) and Shopify GMV +30%. Apple Pay leads as "primary" wallet 28% vs 19% ([Capital One Shopping](https://capitaloneshopping.com/research/digital-wallet-statistics/) [F]) | Rivals growing far faster. PayPal's improvement is relative, within a shrinking share |
| PayPal markets broad acceptance | 15.0m live sites, the largest footprint ([BuiltWith](https://trends.builtwith.com/payment/PayPal) [F]) | TRUE for presence. Usage is not proportional |
| PayPal on outages: "brief technical issue" | Venmo shown "Operational" during outages with heavy Downdetector reports; Braintree was down for hours ([Tom's Guide](https://www.tomsguide.com/news/live/venmo-paypal-down-aug-1-outage) [F]) | Status transparency is weaker than the user experience implies |
| PayPal (India): not a payment system operator | Delhi HC held otherwise. PayPal then registered ([Bar & Bench](https://www.barandbench.com/news/litigation/paypal-payment-system-operator-under-pmla-should-comply-reporting-entity-obligations-delhi-high-court) [F]; [MediaNama](https://www.medianama.com/2024/02/223-paypal-registers-indias-financial-intelligence-unit-anti-money-laundering-regulations/) [F]) | Claim rejected in court |
| PayPal (MEA): expanding access in Africa (`paypal.md`) | Nigerian accounts still send-only. Freelancers use Grey, Cleva, Payoneer and exchangers | Access remains intermediated |
| Venmo positions itself as a seller platform | Zelle (free, >$200bn SMB H1'26) and Cash App (no-fee Earn in P2P) undercut its 2.99% and 1.9% fees | Price pressure on Venmo monetisation |

## 4. Contradictions and disputed claims

- **Wallet-share definitions.**
  - Worldpay: wallets 53% of e-com and 32% of POS.
  - Datos: wallets 83% of *digital* volume and 51% in-store.
  - A secondary source in search cited Worldpay as "38% of in-person."
  - These use different denominators. Use Worldpay for checkout comparisons.
- **PayPal share numbers.** "45% of global online payments" ([Clearly Payments](https://www.clearlypayments.com/blog/what-are-the-most-popular-payment-methods-in-2025/) [F]) is unsupported. Stripe share trackers disagree by about 15× ([Chargeback.io](https://www.chargeback.io/blog/stripe-statistics) [F]).
- **Naira card caps.** $500/month at Wema (Techsoma) vs a CBN cap of $20/month (Grey). Unresolved.
- **1099-K threshold.** Fortune (Jan 2025) gives $2,500/$600. Venmo (post-July 2025) gives $20,000/200. Resolved by later law; Fortune's figure is outdated.
- **Stripe Link users (>200m).** Cited secondhand only [S]. Not in Stripe's release text.

## 5. Evolution 2023 to 2026

- **2023:** India court loss and appeal. Nigerian dollar-card turmoil after Union54. CR flags P2P protection gaps.
- **2024:** PayPal registers with FIU-IND. Apple opens NFC for a fee (Aug). Raenest gets its IMTO licence. Rise and Carbon exit cards. PayPal's Nov login outage.
- **2025:** Worldpay shows wallets above 50% of e-com. Naira cards restored (Jun–Jul). 1099-K resets to $20k. PayPal/Venmo outages in Aug and Oct. Shop Pay hits $43bn per quarter.
- **2026:**
  - Wise reaches a 52bps take rate.
  - Payoneer agrees a sale to Nuvei.
  - WU/Intermex is stuck.
  - Zelle passes $200bn of SMB volume in H1.
  - Cash App runs a no-fee P2P pilot.
  - Paidy enters a self-regulatory body.
  - Upwork adds a $2.99 fee for non-US freelancers.
  - Visa agentic pilots run in LatAm.
  - A terms tracker flags PayPal arbitration changes in Sep 2026.

## 6. Unresolved problems (as of Nov 2026, evidence-backed)

1. **No transparent checkout-share measurement.** Merchants and investors rely on vendor-blog numbers ([Clearly Payments](https://www.clearlypayments.com/blog/what-are-the-most-popular-payment-methods-in-2025/) [F]; [Chargeback.io](https://www.chargeback.io/blog/stripe-statistics) [F]).
2. **Nigerian freelancers cannot natively receive and withdraw on PayPal.** Alternatives depend on card schemes, US partner banks and FX policy that have failed repeatedly ([Tech In Africa](https://www.techinafrica.com/rise-halts-virtual-card-services-amid-exchange-rate-volatility-and-provider-challenges/) [F]; [Brands.ng](https://brands.ng/?p=2613) [F]).
3. **Payout costs are rising** for African freelancers: the Upwork $2.99 fee, Payoneer's rising take rates, and Payoneer's pending ownership change ([Cleva](https://www.getcleva.com/blog/upworks-new-2-99-withdrawal-fee-dont-let-it-cost-you-twice) [F]; [LionhearTV](https://www.lionheartv.net/2025/11/payoneer-reports-third-quarter-2025-financial-results) [F]; [Finviz](https://finviz.com/news/406626/payoneer-to-report-third-quarter-2026-results-on-november-5-2026) [F]).
4. **PayPal holds and limitations** remain the top complaint theme on independent review sites ([PissedConsumer](https://www.pissedconsumer.com/company/paypal.html) [F]; [ProductReview](https://www.productreview.com.au/listings/paypal) [F]).
5. **Outage transparency.** Venmo has no status page, and the status page diverges from the user experience ([Tom's Guide](https://www.tomsguide.com/news/live/venmo-paypal-down-aug-1-outage) [F]).
6. **P2P scam protection.** The structural gap CR identified in 2023 persists ([CR](https://advocacy.consumerreports.org/research/peer-to-peer-payment-apps-a-case-study-for-a-digital-finance-standard) [F]).
7. **Apple's NFC toll.** Third-party tap-to-pay on iPhone outside the EU requires fees to Apple ([Apple](https://www.apple.com/newsroom/2024/08/developers-can-soon-offer-in-app-nfc-transactions-using-the-secure-element/) [F]).

## 7. Opportunity signals (all SPECULATIVE)

1. **Independent "checkout share" panel.**
   - *Evidence:* There is no credible usage-share data, only presence counts (BuiltWith) and surveys (Capital One Shopping).
   - *Idea:* a receipt-, email- or PSP-data panel measuring button share by vertical and country, including Africa, where none exists. Sell it to merchants, PSPs and investors.
2. **Licensed receive-side rail for African freelancers with marketplace integrations.**
   - *Evidence:* PayPal is send-only in Nigeria, Payoneer is changing hands and raising take rates, the Upwork fee is new, and Raenest and Grey hold IMTO licences.
   - *Idea:* partner with an IMTO to offer marketplace-native payout (Upwork/Fiverr/Deel), transparent FX at the official window, and a PayPal-to-naira bridge through PayPal's own Hyperwallet/Paga channels.
3. **FX-shock-resilient card issuing.**
   - *Evidence:* Rise, Carbon and the Union54 fallout. Card economics break on chargebacks above 1% and on decline fees.
   - *Idea:* a multi-BIN-sponsor issuing layer with pre-authorisation balance checks (to avoid decline fees) and chargeback-risk scoring for Nigerian fintechs.
4. **Hold and limitation insurance or advance product for PayPal and Venmo sellers.**
   - *Evidence:* 21-day risk holds, reviews of 180-day holds, and rising CFPB "trouble accessing funds" complaints.
   - *Idea:* underwrite and advance held balances, given that PayPal's eventual release rate is high. It needs data partnerships.
5. **Payment-status transparency service.**
   - *Evidence:* status pages diverge from Downdetector.
   - *Idea:* merchant-side real-time PSP health and auto-failover between PayPal, Stripe and Adyen.
6. **No-fee freelancer P2P for emerging markets.**
   - *Evidence:* Cash App's "Earn in P2P" targets modern earners, and Zelle's free SMB rails are winning.
   - *Idea:* replicate this on NIP/Pix/UPI-style rails in Nigeria, with invoicing, client receipts and tax records, monetised via FX and float rather than per-transaction fees.
7. **Agentic-commerce adapters for African merchants.**
   - *Evidence:* Visa Intelligent Commerce pilots in LatAm, Stripe machine payments, Shopify "every agent."
   - *Idea:* make Nigerian and African merchants payable by agents across protocols, before networks lock in default credentials.

## 8. Coverage self-audit

**Covered (new domains):**
- Independent wallet and checkout data: Worldpay, Capital One Shopping, Baymard, BuiltWith, Datos Insights, mind Retail, BCG via TechIntelPro, Chargeback.io.
- Competitor disclosures: Shopify, Apple, Zelle, Block (via SEC, Crypto Briefing), Affirm (Stocktwits), Payoneer (Finviz, LionhearTV), Wise (Investegate), Western Union (SEC), Stripe, Visa/Santander, Stellagent.
- Customer evidence: ProductReview.com.au, PissedConsumer, ConductAtlas, Consumer Reports Advocacy, Venmo fees and tax FAQ, Fortune, outages (KTVU, Tom's Guide, BGR).
- India: Bar & Bench, Verdictum, Inc42, MediaNama.
- Japan: JBNPLA.
- Nigeria and Africa: Techsoma, Tech In Africa, WeeTracker, Benjamindada, Grey, Raenest, Cleva, Brands.ng, ProGigFinder, allAfrica, Nigerian NewsDirect.

**Gaps and limits:**
- **Blocked (403 or 503):**
  - Investor-relations sites: investors.affirm.com, investor.payoneer.com, investors.marqeta.com, ir.westernunion.com, investors.toasttab.com, investor.visa.com.
  - Forums: paypal-community.com (503/connection failure) and old.reddit.com (403).
  - Advocacy and research: clark.com, emarketer.com, Statista (no data), Similarweb (202 empty).
  - Payout and news sites: support.upwork.com, fiverr.com, punchng.com, techpoint.africa (403), thecable.ng.
  - PayPal pages: PayPal's upcoming-policies page (403), so the Sep 2026 arbitration change is unverified against PayPal's own text.
- **Not obtained:**
  - Shop Pay Q3 2026 GMV.
  - Klarna and Marqeta/Toast 2026 metrics: not attempted beyond blocked IR, since Klarna is already in the existing domains.
  - Edgar Dunn reports (homepage only; no data used).
  - The Delhi HC appeal outcome.
  - Any FSA action on Paidy.
  - Primary Upwork fee documentation (cited via Cleva).
  - Primary confirmation of Grey's IMTO licence.
- **Quality notes:**
  - Several Nigerian sources are vendors (Grey, Cleva, Raenest) or SEO-style guides. They are labelled as interested parties and used only for facts corroborated elsewhere or clearly flagged.
  - Snippet-only records (4): Pulse aggregator claim, PYMNTS 2022 Buy Button, Stripe Link 200m, Affirm Q4 GMV.
  - The Kapronasia Paidy piece (2021) and the CR 2021 article were fetched but excluded as out of window.
