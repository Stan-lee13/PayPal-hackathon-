# PayPal Holdings, Jan 2023 to 5 Nov 2026: a sceptical investigation

Slice: `paypal`. Covers PayPal, Venmo, Braintree, Xoom, Honey, Hyperwallet, Zettle, Paidy and PYUSD. Research date: 4–5 Nov 2026.
Tags: **[F]** means I opened and read the document. **[S]** means I saw only a search-result summary. Each claim is labelled VERIFIED, REPORTED, DISPUTED, INTERPRETATION or SPECULATIVE. Where I calculated a figure from filings, the note says so.

---

## 1. Key findings (top 10)

1. **The board removed CEO Alex Chriss on 2 Feb 2026, 2.5 years into his term.** His exit took effect immediately. The board said "the pace of change and execution was not in line with the Board's expectations." HP's former CEO Enrique Lores, who had chaired PayPal's board since July 2024, became CEO on 1 Mar 2026. VERIFIED. Sources: [8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1633917/000119312526035860/d68718dex991.htm) [F] and [Payments Dive](https://www.paymentsdive.com/news/paypal-appoints-new-ceo/811189/) [F].
2. **Growth in PayPal's core branded checkout stopped.** Online branded checkout TPV grew 1% FXN in Q4'25, down from 5% in Q3'25. It then stayed at 1–2% for four quarters. In Q3'26, revenue from PayPal-branded products *fell* by about $240m year on year. Braintree (+$270m) and Venmo (+$100m) carried the growth. VERIFIED. Sources: [Q4'25 call](https://www.fool.com/earnings/call-transcripts/2026/02/03/paypal-pypl-q4-2025-earnings-call-transcript/) [F], [Q3'26 call](https://www.fool.com/earnings/call-transcripts/2026/10/27/paypal-pypl-q3-2026-earnings-call-transcript/) [F] and [Q3'26 10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F].
3. **PayPal withdrew its Investor Day promises within a year.** In Feb 2025 it promised "high single-digit" growth in transaction margin dollars (TM$) and "low teens+" EPS growth by 2027. In Feb 2026 it rescinded that multi-year outlook. TM$ for 2026 is now guided to about $15.7bn, roughly 1% above FY25's $15.5bn. VERIFIED. Sources: [Investor Day 8-K](https://www.sec.gov/Archives/edgar/data/1633917/000119312525034283/d919560dex991.htm) [F], [PYMNTS](https://www.pymnts.com/?p=3448713) [F] and [Q3'26 release](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm) [F].
4. **PayPal's take rate keeps falling.** Net revenue divided by TPV went 2.03% (FY22) → 1.95% (FY23) → 1.89% (FY24) → 1.85% (FY25). Transaction revenue divided by TPV was 1.58% in Q3'26, against 1.64% a year earlier. VERIFIED: I calculated these from the [FY23](https://www.sec.gov/Archives/edgar/data/1633917/000163391724000022/q423paypalearningsreleas.htm), [FY24](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000017/pypl4q-24earningsrelease.htm) and [FY25](https://s205.q4cdn.com/875401827/files/doc_financials/2025/q4/PYPL-4Q-25-Earnings-Release.pdf) releases [F].
5. **Per-share earnings have been propped up by cost cuts and buybacks.** Headcount fell from ~29,900 at end-2022 to ~23,800 at end-2025, and more than 2,000 further cuts followed in 2026. Buybacks since 2023 total about $21.5bn. Diluted shares fell about 25% between Q4'22 and Q3'26 (1,144m to about 858m; I derived the Q3'26 figure from net income divided by EPS). Even so, the stock was around $58–60 in early Nov 2026, below its $71 close at end-2022. VERIFIED for the inputs, INTERPRETATION for the conclusion. Sources: [10-Ks](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm) [F], [10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F] and [Yahoo chart API](https://query1.finance.yahoo.com/v8/finance/chart/PYPL?range=5y&interval=1mo) [F].
6. **Regulatory exposure widened in 2025–26 even as some old matters closed.** New FTC civil investigative demands (CIDs) arrived in Aug 2025 (merchant onboarding and "deceptive schemes") and Sep 2026 (fees and purchase protection). The UK FCA opened a Competition Act probe in Mar 2026 into PayPal's terms with Visa and Mastercard. The German cartel office case has been open since Jan 2023, and CFPB CIDs on Regulation E (US electronic-transfer error rules) and PayPal Credit remain open. A "Branded Checkout" securities class action was filed in 2026. VERIFIED: [Q3'26 10-Q Note 13](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F].
7. **PayPal's fraud filter failed in Aug 2025 and German banks blocked its direct debits.** The size of the block is DISPUTED:
   - Süddeutsche Zeitung reported more than €10bn.
   - A Reuters banking source said "hundreds of millions to billions."
   - The Local wrote "tens of billions."

   PayPal called it "a technical problem, not a security problem." Sources: [heise](https://www.heise.de/en/news/Paypal-German-banks-apparently-blocked-payments-of-billions-of-euros-10622936.html) [F], [The Paypers](https://thepaypers.com/fraud-and-fincrime/news/german-banks-halt-eur-10-billion-in-paypal-transactions-over-fraud-reports-newspaper) [F] and [The Local](https://www.thelocal.de/20250827/paypal-direct-debit-glitch-causes-major-payment-delays-in-germany) [F].
8. **PayPal's Honey position collapsed between Dec 2024 and Jan 2026.** In Dec 2024 PayPal said Honey "follows industry rules." In Jan 2026 it acknowledged and disabled the disputed code. Rakuten, Impact.com and Awin cut Honey off. A judge refused to force arbitration in Nov 2025 and, per reports, let the creators' class action proceed on 22 Jun 2026. VERIFIED for the events to Jan 2026, REPORTED for Jun 2026. Sources: [PPC Land](https://ppc.land/honey-loses-7-000-merchants-as-judge-lets-creator-lawsuit-proceed/) [F] and [Wikipedia](https://en.wikipedia.org/wiki/PayPal_Honey) [F].
9. **US consumer complaints about PayPal nearly tripled** in CFPB data: 3,836 in 2023, 7,464 in 2025 and 10,989 in 2026 up to 4 Nov. The top 2026 issues are "unauthorized transactions" and "trouble accessing funds." The whole money-transfer complaint category grew faster (6×), so PayPal's *share* fell. VERIFIED data, INTERPRETATION on meaning. Source: [CFPB complaint API](https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=Paypal%20Holdings%2C%20Inc&size=0) [F].
10. **PYUSD grew on subsidies and then shrank.**
    - The SEC closed its 2023 PYUSD probe without action in Feb 2025.
    - Supply rose from $0.23bn (end-2023) to about $3.9bn (Mar 2026), helped by 3.7–4% holder rewards.
    - It then fell to about $2.69bn by 4 Nov 2026, under 1% of a ~$295bn stablecoin market.
    - Incentives cut crypto revenue by about $70m in 9M'26.

    VERIFIED. Sources: [Decrypt](https://decrypt.co/317093) [F], [DefiLlama](https://stablecoins.llama.fi/stablecoin/120) [F] and [10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F].

---

## 2. Detailed findings

### 2.1 Financial record, FY2023 to Q3 2026 (all VERIFIED from filings unless noted)

| Metric | FY2022 | FY2023 | FY2024 | FY2025 | Q3'26 (YoY) |
|---|---|---|---|---|---|
| Net revenue | $27.5bn | $29.8bn (+8%) | $31.8bn (+7%) | $33.2bn (+4%) | $8.58bn (+2%; +1% FXN) |
| TPV | $1.357tn | $1.529tn (+13%) | $1.681tn (+10%) | $1.794tn (+7%) | $487.1bn (+6%; +7% FXN) |
| Transaction margin $ (TM$, non-GAAP) | $13.8bn | $13.7bn (−1%) | $14.7bn (+7%) | $15.5bn (+6%) | $3.95bn (+2%) |
| Revenue/TPV (my calculation) | 2.03% | 1.95% | 1.89% | 1.85% | 1.76% (txn-only 1.58%) |
| Active accounts (end of period) | 435m | 426m (−2%) | 434m | 439m | 440m (+0.6%) |
| Transactions per active account, TTM (Q4) | 51.4 | 58.7 | 60.6 | 57.7 | 60.8 |
| GAAP operating margin | 13.9% | 16.9% | 16.7% | 18.3% | 16.3% (−173bp) |
| Transaction & credit losses | $1.57bn | $1.68bn | $1.44bn | $1.72bn | $386m (vs $483m) |
| Buybacks | $4.2bn returned | $5.0bn | $6.0bn | $6.0bn | $4.5bn in 9M'26 at avg $47.78 |
| Employees (year-end) | ~29,900 (per WSJ via [WFTV](https://www.wftv.com/news/trending/paypal-layoffs-9-workforce-being-eliminated/YH77FCRNE5A2TJ2GC4OBCI4L6M) [F]) | 27,200 | 24,400 | 23,800 | >2,000 cut in 2026 |

Sources:
- Annual figures: [FY22](https://www.sec.gov/Archives/edgar/data/1633917/000163391723000031/q422paypalearningsreleas.htm), [FY23](https://www.sec.gov/Archives/edgar/data/1633917/000163391724000022/q423paypalearningsreleas.htm), [FY24](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000017/pypl4q-24earningsrelease.htm) and [FY25](https://s205.q4cdn.com/875401827/files/doc_financials/2025/q4/PYPL-4Q-25-Earnings-Release.pdf) releases.
- 2026: the [Q1'26](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000065/pypl1q-26earningsrelease.htm), [Q2'26](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000080/pypl2q-26earningsrelease.htm) and [Q3'26](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm) releases.
- Employee counts: the [FY23](https://www.sec.gov/Archives/edgar/data/1633917/000163391724000024/pypl-20231231.htm), [FY24](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000019/pypl-20241231.htm) and [FY25](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm) 10-Ks.

All of these were [F].

**Year by year:**

**2023 (Schulman's last year, then Chriss).** Revenue grew 8%, but TM$ *fell* 1% because growth came from low-margin unbranded Braintree volume. Transaction margin dropped from 49.7% in Q4'22 to 45.8% in Q4'23 ([FY23 release](https://www.sec.gov/Archives/edgar/data/1633917/000163391724000022/q423paypalearningsreleas.htm) [F]). Active accounts shrank by 9m. PayPal described this as attrition of low-quality accounts, which is context for the "fake accounts" securities suit (§2.3).

FY23 revenue of $29.8bn missed PayPal's own earlier $30.0–30.3bn projection. PayPal gave no full-year 2024 guidance, and the shares fell ([FXC Intelligence](https://fxcintel.com/research/analysis/ct-paypal-fy-2023-results) [F]).

**2024 ("transition year").** Chriss's term for 2024 was a "transition year" ([Q4'23 call](https://www.fool.com/earnings/call-transcripts/2024/02/07/paypal-pypl-q4-2023-earnings-call-transcript/) [F]). Roughly 2,500 jobs (~9%) were cut on 30 Jan 2024 ([Business Today/Reuters](https://www.businesstoday.in/technology/news/story/paypal-to-reduce-global-workforce-by-9-in-2024-see-details-415497-2024-01-31) [F]). TM$ returned to growth (+7%) through Braintree "price-to-value" repricing. The FY24 10-K warned of "lower volume and transaction revenue growth from our Braintree offerings in 2025" ([10-K FY24](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000019/pypl-20241231.htm) [F]). The stock ended 2024 at about $85, its high point in the period.

**2025 ("profitable growth").** Q1'25 payment transactions fell 7% as unprofitable PSP (payment service provider, i.e. unbranded processing) volume was dropped. TM$ grew 6% for the year. GAAP EPS rose 35% to $5.41, helped by about $0.14 of investment and crypto gains. PayPal initiated a $0.14 quarterly dividend in Oct 2025 ([Q3'25 release](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000194/pypl3q-25earningsrelease.htm) [F]).

PayPal raised FY guidance twice, in July and October, then missed: non-GAAP EPS came in at $5.31 against an October guide of $5.35–5.39 ([finews](https://www.finews.com/news/english-news/71055-paypal-zahlungsdienst-ceo-alex-chriss-enrique-lores-jamie-miller-aktienkurs-finance-2) [F]).

**2026 (Lores reset).**
- In February PayPal guided 2026 non-GAAP EPS to "low-single-digit decline to slightly positive." It raised that to about $5.38 in July and about $5.60 in October ([Q3'26 release](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm) [F]).
- Non-GAAP operating margin contracted 229bp in Q1 and 248bp in Q2. It turned slightly positive (+16bp) in Q3 because non-transaction opex grew only 1%.
- GAAP operating margin fell in every 2026 quarter.

**Stock performance (VERIFIED from monthly closes, [Yahoo API](https://query1.finance.yahoo.com/v8/finance/chart/PYPL?range=5y&interval=1mo) [F]).**

| Date | Close |
|---|---|
| Dec 2022 | $71.22 |
| Dec 2023 | $61.41 |
| Dec 2024 | $85.35 |
| Dec 2025 | $58.38 |
| Feb 2026 | $46.21 |
| Jun 2026 (low) | $43.18 |
| Jul 2026 | $57.21 |
| early Nov 2026 | ~$58–60 |

The shares fell about 18% on 3 Feb 2026 ([finanzen.net/Zacks](https://www.finanzen.net/nachricht/aktien/paypal-shares-fall-as-q4-earnings-revenues-miss-estimates-15459155) [F]).

**Accounting caveat (INTERPRETATION).** The FY2024 release restated FY2023's non-GAAP operating margin from 22.4% (as reported in Feb 2024) to 17.2% ([FY24 release](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000017/pypl4q-24earningsrelease.htm) [F]). That means the non-GAAP definition changed. It is consistent with stock-based compensation now being included as an expense, but I did not find the explanatory sentence. Multi-year "margin expansion" claims are therefore not like-for-like across 2023 and 2024.

### 2.2 Leadership and strategy

**CEO succession** (VERIFIED, 8-Ks [F]):
- Dan Schulman leaves; Alex Chriss (from Intuit) starts 27 Sep 2023 ([8-K](https://www.sec.gov/Archives/edgar/data/1633917/000119312523212353/d475247dex991.htm)).
- Jamie Miller becomes CFO on 6 Nov 2023 ([8-K](https://www.sec.gov/Archives/edgar/data/1633917/000119312523268244/d560139d8k.htm)) and later CFO and COO.
- Enrique Lores becomes board chair on 24 Jul 2024 ([newsroom](https://newsroom.paypal-corp.com/2024-07-24-PayPal-Appoints-Enrique-Lores-as-New-Independent-Board-Chair)).
- Chriss is out on 2 Feb 2026; Miller is interim CEO; Lores becomes CEO on 1 Mar 2026; David Dorman becomes chair.
- Former Block CEO Alyssa Henry joins the board in Mar 2026 ([8-K](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000059/pypl-20260320.htm)).
- On 29 Apr 2026 PayPal reorganised into three businesses: Checkout Solutions & PayPal; Consumer Financial Services & Venmo; Payment Services & Crypto. Group heads Michelle Gill and Diego Scotti left, and a "Chief AI Transformation & Simplification Officer" was created ([8-K Ex.99.1](https://www.sec.gov/Archives/edgar/data/1633917/000119312526197533/d128781dex991.htm) [F]).

**Why Chriss went.** Miller said the change was "prompted more by execution than strategy" ([Payments Dive](https://www.paymentsdive.com/news/paypal-appoints-new-ceo/811189/) [F]). On the Q4'25 call, management named three causes of the branded checkout slowdown, each worth roughly one point:
- US retail weakness among lower and middle-income consumers.
- Germany, through "normalization of our long-standing market leadership position, and competition from alternative payment methods."
- Weakness in travel, ticketing, crypto and gaming.

It also admitted that large merchants "require much more hands-on integration support than we anticipated" and that "we were too optimistic about how quickly we could drive change" ([transcript](https://www.fool.com/earnings/call-transcripts/2026/02/03/paypal-pypl-q4-2025-earnings-call-transcript/) [F]). VERIFIED.

**Lores's programme** (VERIFIED, [10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) and [Q3 call](https://www.fool.com/earnings/call-transcripts/2026/10/27/paypal-pypl-q3-2026-earnings-call-transcript/) [F]):
- At least $1.5bn of gross run-rate savings over 2–3 years, with more than $700m run-rate exiting Q4'26.
- A Q3'26 workforce reduction costing $152m, aimed at about $340m of annual savings.
- More than 2,000 roles cut, three management layers removed and management roles reduced "by more than a quarter."
- AI chat agents resolved 24m customer contacts year to date.

The new "North Star" is TM$ growth, measured through monthly active accounts and revenue per account (ARPA). The medium-term ambition is now *mid-single-digit* TM$ growth and "solid double-digit EPS growth." That is noticeably below the Feb 2025 ambition of 10%+ TM$ and 20%+ EPS.

**Product initiatives under Chriss** (company claims, VERIFIED as announcements):
- **Fastlane** guest checkout (US Aug 2024), distributed through Adyen, Fiserv, Global Payments and JPMorgan Payments ([newsroom](https://newsroom.paypal-corp.com/2024-08-20-PayPal-Expands-Strategic-Partnership-with-Adyen-to-offer-Fastlane-in-the-U-S) [F]). About 2,000 merchants were live by Feb 2025 ([Q4'24 call](https://www.fool.com/earnings/call-transcripts/2025/02/04/paypal-pypl-q4-2024-earnings-call-transcript/) [F]). PayPal has not disclosed Fastlane volume since, which is a gap in its own reporting (INTERPRETATION).
- **PayPal Everywhere and the debit card** (5% category cash back, added to Apple Wallet, [newsroom](https://newsroom.paypal-corp.com/2024-09-05-Introducing-PayPal-Everywhere) [F]). US debit TPV grew more than 50% in Q4'25.
- **PayPal Open**, the unified merchant platform launched at the Feb 2025 Investor Day.
- **PayPal+ loyalty**, first in the UK in Nov 2025 ([newsroom](https://newsroom.paypal-corp.com/2025-11-12-paypal-relaunches-in-the-uk-smarter-way-to-pay-online-and-now-in-stores-with-game-changing-paypal-loyalty-programme) [F]).
- **PayPal Ads**, built on a "Transaction Graph" of more than 25bn transactions across 400m+ accounts. Ad-performance figures are company-selected case studies ([newsroom](https://newsroom.paypal-corp.com/2026-06-22-PayPal-Ads-Delivers-Bottom-Line-Growth-Advertisers-Can-Measure) [F]).
- **PayPal Bank.** PayPal applied in Dec 2025 for a Utah industrial loan company (ILC) charter, with applications to the Utah regulator and the FDIC ([newsroom](https://newsroom.paypal-corp.com/2025-12-15-PayPal-Submits-Applications-to-Establish-an-Industrial-Bank-to-Expand-Access-to-Financial-Services-for-U-S-Small-Businesses) [F], [CNBC](https://www.cnbc.com/2025/12/15/paypal-seeks-us-approval-to-form-bank-offer-small-business-loans.html) [F]). I found no approval as of Nov 2026.

**Venmo monetisation** (VERIFIED, company data):
- 64m US monthly active accounts in Q1'25 ([newsroom](https://newsroom.paypal-corp.com/2025-06-04-Venmo-Unleashes-Next-Phase-of-Commerce-with-the-Venmo-Debit-Card-and-Venmo-Checkout) [F]), rising to 67m in Q4'25.
- Revenue about $1.7bn in 2025 (+20%) ([PYMNTS](https://www.pymnts.com/?p=3448713) [F]).
- Q3'26: debit card 6.7m monthly active accounts (+55%) and Pay with Venmo TPV +43%. Lores claims a "4x to 5x opportunity" in ARPA. Only 23% of customers use any Venmo financial service.
- Since Mar 2026, Venmo users can send money to PayPal users in 90 markets ([newsroom](https://newsroom.paypal-corp.com/2026-03-23-200-Million-More-Friends-on-Venmo-Send-Money-to-PayPal-Users-Around-the-World) [F]).

**Pay Later (BNPL).**
- Volume: more than $20bn in 2022, about $33bn in 2024 (+21%) and more than $40bn in 2025 (+20%). Q3'26 growth was +25%. Sources: [KKR release](https://newsroom.paypal-corp.com/2023-06-20-PayPal-and-KKR-Announce-Exclusive-Multi-Year-Relationship-for-European-Pay-Later-Receivables) [F] and the Q4'24 and Q4'25 calls [F].
- Funding is "balance-sheet light." KKR can buy up to €40bn (2023), later renewed at up to €65bn through Mar 2028 ([newsroom](https://newsroom.paypal-corp.com/2025-11-17PayPal-and-KKR-Renew-Agreement-for-European-Pay-Later-Receivables) [F]). Blue Owl is buying about $7bn of US Pay in 4 receivables ([newsroom](https://newsroom.paypal-corp.com/2025-09-24-PayPal-Announces-a-Multi-Year-Relationship-for-US-Buy-Now-Pay-Later-Receivables-with-Funds-Managed-by-Blue-Owl-Capital) [F]).
- PayPal remains exposed to indemnities on $3.7bn of sold loans ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]).
- Amazon Germany and Austria began offering PayPal Ratenzahlung (instalment credit) in Aug 2026 ([newsroom](https://newsroom.paypal-corp.com/2026-07-PayPal-and-Amazon-Launch-Buy-Now-Pay-Later-for-Customers-in-Germany-and-Austria) [F]).

**PayPal World** (Jul 2025). Launch partners were NPCI International (UPI), Tenpay Global and Mercado Pago, described as covering "nearly two billion users." Mercado Pago had only an MOU, with "further details being scoped" ([newsroom](https://newsroom.paypal-corp.com/2025-07-23-Introducing-PayPal-World-a-global-platform-connecting-the-worlds-largest-payment-systems-and-digital-wallets,-starting-with-interoperability-to-PayPal-and-Venmo) [F]). Ooredoo Fintech announced an "intention" to join ([newsroom](https://newsroom.paypal-corp.com/2025-10-01-Ooredoo-Fintech-to-Join-PayPal-World) [F]). The first concrete consumer use case I could verify is US PayPal users paying at Weixin Pay QR merchants in China from Aug 2026 ([newsroom](https://newsroom.paypal-corp.com/2026-08-11-PayPal-World-Enables-US-Travelers-to-Pay-Like-a-Local-at-Weixin-Pay-Merchants-Across-China) [F]). I found no evidence of a live UPI or Mercado Pago integration. INTERPRETATION: delivery has lagged the announcement.

**Agentic commerce.** PayPal has announced a long list of deals:
- [Agent Toolkit and a "first remote MCP server"](https://newsroom.paypal-corp.com/2025-04-29-PayPal-Brings-Together-Developers,-AI-Leaders-to-Power-Agentic-Commerce-at-Dev-Days), Apr 2025.
- [Perplexity](https://newsroom.paypal-corp.com/2025-05-14-Perplexity-Selects-PayPal-to-Power-Agentic-Commerce), May 2025.
- [Google](https://newsroom.paypal-corp.com/2025-09-17-Google-and-PayPal-Forge-Multiyear-Partnership-to-Revolutionize-Commerce), Sep 2025, including Google's [AP2 protocol](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol).
- [Mastercard Agent Pay](https://newsroom.paypal-corp.com/2025-10-27-Mastercard-and-PayPal-Join-Forces-To-Accelerate-Secure-Global-Agentic-Commerce), Oct 2025.
- [OpenAI's Agentic Commerce Protocol for ChatGPT](https://newsroom.paypal-corp.com/2025-10-28-OpenAI-and-PayPal-Team-Up-to-Power-Instant-Checkout-and-Agentic-Commerce-in-ChatGPT), Oct 2025.
- [Microsoft Copilot Checkout](https://newsroom.paypal-corp.com/2026-01-08-PayPal-Powers-Microsofts-Launch-of-Copilot-Checkout), Jan 2026.
- The [Cymbio acquisition](https://newsroom.paypal-corp.com/2026-01-22-PayPal-to-Acquire-Cymbio,-Accelerating-Agentic-Commerce-Capabilities), Jan 2026.
- Work with Meta, mentioned on the Q3'26 call.

All of these were [F]. As of Jan 2026, ChatGPT and Gemini integrations were still "coming soon." Miller said agentic "will not materially move 2026 results" ([PYMNTS](https://www.pymnts.com/?p=3448713) [F]). VERIFIED. INTERPRETATION: PayPal is one of several wallets plugged into competing protocols (OpenAI's ACP, Google's AP2, Mastercard Agent Pay), not the standard-setter.

**Strategic speculation about a sale.** Wikipedia cites The Business Times (24 Feb 2026) on "takeover interest" after the shares lost "almost half" their value. It also cites Reuters (15 Jul 2026): "Stripe, Advent offer to buy PayPal for more than $53 billion, sources say" ([Wikipedia](https://en.wikipedia.org/wiki/PayPal) [F]). I could not open either source; the sites blocked automated access. PayPal's Q3'26 10-Q and earnings call contain no reference to it. Status: REPORTED and unconfirmed. Treat it as rumour until there is a primary filing.

### 2.3 Regulatory and legal

All of the following come from PayPal's own disclosures ([10-Q Q3'26 Note 13](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]) unless noted. VERIFIED.

**Open matters as of 27 Oct 2026:**
- **FTC.** CID in Feb 2022 on merchants submitting charges for other sellers. CID in Aug 2025 on "whether deceptive schemes... by merchants using PayPal's platform were facilitated" by onboarding and due diligence. New CID in Sep 2026 on "fees and purchase protection in connection with financial products."
- **CFPB.** CIDs on Regulation E error resolution and "presentment of transactions to linked bank accounts." A separate CID from Aug 2024 on PayPal Credit and backup funding sources in the wallet.
- **German Federal Cartel Office.** Opened 23 Jan 2023 over PayPal's anti-surcharging clause and "Presentation of PayPal" clause. The authority called PayPal "one of the most expensive online payment services," at 2.49–2.99% plus €0.34–0.39 ([Bundeskartellamt](https://bundeskartellamt.de/SharedDocs/Meldung/EN/Pressemitteilungen/2023/23_01_2023_PayPal.html) [F]). There has been no decision in more than 3.5 years. German lawyers called the case "kein Selbstläufer," meaning not a foregone conclusion ([LTO](https://www.lto.de/recht/kanzleien-unternehmen/k/bundeskartellamt-bkarta-verfahren-nutzungsbedingungen-wettbewerbsbeschraenkung-paypal) [F]).
- **UK FCA.** In Mar 2026 the FCA opened Competition Act investigations into PayPal's contracts with Visa and Mastercard on "funding and use of the PayPal digital wallet." This was new in 2026.
- **Securities and derivative litigation.**
  - The 2022 "fake accounts" class action over net new active accounts (NNA) was dismissed with prejudice on 31 Mar 2026; plaintiffs appealed to the Third Circuit on 30 Apr 2026.
  - *In re PayPal Branded Checkout Securities Litigation* (N.D. Cal.) covers a class period of 7 Feb 2024 to 2 Feb 2026. It alleges non-disclosure of "impediments to its branded checkout growth strategy that impaired... 2027 financial targets."
  - Five derivative suits name Chriss and the board.

**Closed or resolved:**
- **SEC.** The PYUSD subpoena of 1 Nov 2023 was closed "without enforcement action" in Feb 2025 ([10-K FY23](https://www.sec.gov/Archives/edgar/data/1633917/000163391724000024/pypl-20231231.htm) [F], [Finance Magnates](https://www.financemagnates.com/cryptocurrency/sec-ends-paypals-stablecoin-pyusd-investigation-with-no-enforcement-action/) [F], [Decrypt](https://decrypt.co/317093) [F]).
- **AUSTRAC.** Australia's financial intelligence agency accepted an enforceable undertaking with no penalty on 17 Mar 2023 ([10-K FY24](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000019/pypl-20241231.htm) [F]). It no longer appears in the 2026 10-Q.
- **NYDFS $2m penalty (23 Jan 2025).** It relates to the Dec 2022 credential-stuffing attack that exposed 34,942 users' SSNs and tax data through 1099-K pages. Engineers changing the data flows were untrained, the change skipped risk review, and MFA was not mandated. The fine may not be paid from insurance ([The Record](https://therecord.media/paypal-penalty-millions-data-breach) [F], [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/nydfs-fines-paypal-2-million-for-cybersecurity-failures) [F], [The Star/Reuters](https://www.thestar.com.my/tech/tech-news/2025/01/23/paypal-fined-by-new-york-for-cybersecurity-failures) [F]). I could not open the DFS press release URL (404).

**CFPB larger-participant rule.** The rule was finalised on 21 Nov 2024 and published on 10 Dec 2024. It covers payment apps with more than 50m transactions a year, which would include PayPal and Venmo. The CFPB flagged that apps "shift disputes to banks" ([CFPB](https://www.consumerfinance.gov/about-us/newsroom/cfpb-finalizes-rule-on-federal-oversight-of-popular-digital-payment-apps-to-protect-personal-data-reduce-fraud-and-stop-illegal-debanking/) [F], [Federal Register API](https://www.federalregister.gov/api/v1/documents.json?conditions[term]=%22digital%20consumer%20payment%20applications%22) [F]). The CFPB page is now marked "archived content." The eCFR version history for 12 CFR 1090.109 shows no removal entry ([eCFR](https://www.ecfr.gov/api/versioner/v1/versions/title-12.json?section=1090.109) [F]). I believe Congress nullified the rule in 2025 under the Congressional Review Act, but I could not verify this: congress.gov and GovTrack were blocked. Status: UNVERIFIED and DISPUTED.

**Honey.** Timeline from [PPC Land](https://ppc.land/honey-loses-7-000-merchants-as-judge-lets-creator-lawsuit-proceed/) [F], [arbitration ruling](https://ppc.land/paypal-fails-to-compel-arbitration-in-honey-affiliate-commission-lawsuit/) [F] and [Wikipedia](https://en.wikipedia.org/wiki/PayPal_Honey) [F]:
- Dec 2024: MegaLag's video.
- 29 Dec 2024: class action filed by creators, including Wendover's Sam Denby, with the LegalEagle firm involved.
- About 3m of 20m users lost within two weeks.
- Mar 2025: Google changed Chrome Web Store rules to bar affiliate injection without "direct and transparent user benefit" ([Chrome policy](https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads) [F]).
- 7 Nov 2025: arbitration denied ("PayPal's reading strains credulity").
- 21 Nov 2025: dismissed with leave to amend.
- 12–13 Jan 2026: PayPal acknowledged and disabled the code, claiming it affected under 0.1% of traffic. Rakuten terminated Honey; Impact.com and Awin suspended it.
- 22 Jun 2026: renewed motion to dismiss denied (REPORTED by PPC Land; Courthouse News [S] reported the judge's likely denial at the 4 Jun hearing).
- Merchant partners fell from about 35,000 to about 28,000.

**Other regions:**
- PayPal Europe is a Luxembourg bank supervised by the CSSF, Luxembourg's financial regulator. After the German debit incident, the CSSF said there were "no major ongoing disruptions requiring intervention" ([The Paypers](https://thepaypers.com/fraud-and-fincrime/news/german-banks-halt-eur-10-billion-in-paypal-transactions-over-fraud-reports-newspaper) [F]).
- As of Jan 2023 PayPal planned a €10 inactivity fee on dormant German accounts ([IT Finanzmagazin](https://www.it-finanzmagazin.de/vorwurf-eigene-marktmacht-auszunutzen-bundeskartellamt-leitet-verfahren-gegen-paypal-ein-149982/) [F]).
- In Q1'25 PayPal restructured staff "to ensure compliance with a new regulation impacting operations in an international market." The cost was $36m and the market was not named ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]).
- India and Japan: no 2023–26 enforcement verified this session (gap).

### 2.4 Customer experience

**CFPB complaint data** for "Paypal Holdings, Inc," which includes Venmo-branded products filed under PayPal ([CFPB API](https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=Paypal%20Holdings%2C%20Inc&size=0) [F]):

| Year | Complaints |
|---|---|
| 2021 | 5,414 |
| 2022 | 3,385 |
| 2023 | 3,836 |
| 2024 | 4,149 |
| 2025 | 7,464 |
| 2026 (to 4 Nov) | 10,989 |

- **What people complain about.** The leading 2026 issues are "unauthorized transactions or other transaction problem" (2,283), "trouble accessing funds in your mobile or digital wallet" (1,903) and "fraud or scam" (1,426). "Trouble accessing funds" became the #1 issue in 2024. VERIFIED.
- **How they are closed.** "Closed with monetary relief" rose from 499 (2023) to 2,157 (2026 YTD).
- **Caveat.** Complaints across the whole money-transfer and virtual-currency category rose from 13,764 to 84,708 between 2023 and 2025. Block went from 3,066 to 48,119, and Zelle's operator Early Warning from 1,585 to 24,520 ([CFPB API](https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?product=Money%20transfer%2C%20virtual%20currency%2C%20or%20money%20service&size=0) [F]). INTERPRETATION: part of the surge is industry-wide, possibly including bulk or third-party submissions. On a share basis, PayPal's position improved even as its absolute complaints doubled.

**Frozen funds and holds.** PayPal's current US User Agreement, last updated 4 Nov 2026, still lets it hold balances "for up to 180 days if reasonably needed to protect against the risk of liability," or longer under legal orders. Disputed payments can be held up to 180 days ([User Agreement](https://www.paypal.com/us/legalhub/paypal/useragreement-full) [F]). VERIFIED. Self-selected reviews rate PayPal 1.3/5 (2,134 reviews). An AI summary of those reviews cites "unauthorized charges and frozen funds with little recourse" ([Sitejabber](https://www.sitejabber.com/reviews/paypal.com) [F]). Trustpilot and BBB blocked automated access.

**Fees and terms.**
- US merchant rates: PayPal Checkout and Pay with Venmo at 3.49% plus a fixed fee; goods and services at 2.99% ([fees page](https://www.paypal.com/us/business/paypal-business-fees) [F]).
- New notice of 4 Nov 2026: the Pay with Crypto rate rises from 0.99% to 1.5% on 1 Aug 2027. The crypto terms add mass-arbitration procedures, switch arbitration from AAA to JAMS and apply retroactively "regardless of when they arose" ([Policy Updates](https://www.paypal.com/us/legalhub/paypal/upcoming-policies-full) [F]). VERIFIED. INTERPRETATION: tightening mass-arbitration rules looks like a lesson from the Honey case.

**Scams.** PayPal launched AI scam alerts for Friends and Family payments in Jul 2025, conceding that such payments "may not be eligible for refunds" ([newsroom](https://newsroom.paypal-corp.com/2025-7-21-Introducing-AI-Powered-Scam-Alerts-for-Friends-and-Family-Payments) [F]). It issued phishing warnings in Oct 2025 ([newsroom](https://newsroom.paypal-corp.com/2025-10-15-PayPal-Alerts-Consumers-to-Phishing-Scams-and-Encourages-Safety-Tips,1) [F]). The Aug 2025 FTC CID on merchant "deceptive schemes" shows regulators are scrutinising onboarding.

**Outages.** In the Aug 2025 German incident, PayPal's help banner said transactions were "delayed for a small number of accounts" ([TechRadar](https://www.techradar.com/pro/security/paypal-glitch-triggers-chaos-as-european-banks-freeze-billions-in-transactions) [F]). Meanwhile, the German savings banks association reported "significant impact on payment transactions throughout Europe" ([AML Intelligence/Reuters](https://www.amlintelligence.com/2025/08/breaking-german-banks-block-e10b-in-paypal-payments-over-fraud-fears/) [F]), and heise reported PayPal attempting to recover shortfalls plus bank fees ([heise](https://www.heise.de/en/news/Paypal-German-banks-apparently-blocked-payments-of-billions-of-euros-10622936.html) [F]).

### 2.5 Security and fraud

- **Credential stuffing.** Attackers got in on 6–8 Dec 2022 and PayPal detected it on 20 Dec. The Maine AG notice in Jan 2023 covered 34,942 people. PayPal said "no evidence that your login credentials were obtained from any PayPal systems" and did not inform law enforcement ([SecurityWeek](https://www.securityweek.com/paypal-warns-35000-users-credential-stuffing-attacks/) [F], [The Register](https://www.theregister.com/2023/01/19/paypal_data_breach/) [F], [SiliconANGLE](https://siliconangle.com/2023/01/19/35000-paypal-customers-affected-credential-stuffing-attack/) [F]).
- **PayPal's message versus the regulator's finding (DISPUTED in emphasis).** PayPal framed the incident as users' reused passwords. NYDFS found PayPal's own failures: untrained staff, no MFA mandate, no CAPTCHA or rate limiting ([CyberInsider](https://cyberinsider.com/paypal-fined-2-million-for-cybersecurity-lapse-exposing-user-data/) [F]).
- **Losses.** Transaction and credit losses ran at about 0.10–0.12% of TPV in 2023 and fell to 0.08% in Q3'26, against 0.11% in Q3'25. Q3'26 losses were $386m, down from $483m. Management credits better onboarding, fraud and risk tools plus a credit reserve release ([Q3'26 release](https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm) [F], [call](https://www.fool.com/earnings/call-transcripts/2026/10/27/paypal-pypl-q3-2026-earnings-call-transcript/) [F]). VERIFIED. Part of the improvement comes from moving credit off balance sheet ("credit externalization"), so it is not purely better fraud control (INTERPRETATION).
- **AI.** PayPal reports a modular AI risk platform that cuts credit decision times "nearly in half" in Canada, Italy and Spain, plus scam alerts. These are company claims.

### 2.6 Competition

- **Germany and Europe.**
  - PayPal holds about 30% of German online payments ([The Local](https://www.thelocal.de/20250827/paypal-direct-debit-glitch-causes-major-payment-delays-in-germany) [F]) and has about 31m regular German users ([IT Finanzmagazin](https://www.it-finanzmagazin.de/vorwurf-eigene-marktmacht-auszunutzen-bundeskartellamt-leitet-verfahren-gegen-paypal-ein-149982/) [F]).
  - Management itself cites "normalization" of its German leadership and "alternative payment methods."
  - **Wero**, the bank-owned European wallet: launched in Germany in Jul 2024, added e-commerce in Nov 2025 and had 52.5m users per Reuters in Mar 2026. It is replacing iDEAL in the Netherlands by end-2027, with in-store payments in Luxembourg from Sep 2026 and in Germany and France planned for 2027 ([Wikipedia](https://en.wikipedia.org/wiki/Wero_(payment)) [F]).
  - PayPal joined the European Payments Council in Jul 2026 ([newsroom](https://newsroom.paypal-corp.com/2026-07-02-PayPal-Joins-the-European-Payments-Council) [F]).
  - The EU's removal of the low-value import duty exemption ("de minimis") cost branded checkout about 70bp in 2026 ([Q3 call](https://www.fool.com/earnings/call-transcripts/2026/10/27/paypal-pypl-q3-2026-earnings-call-transcript/) [F]).
- **Apple Pay.** In Jul 2024 the EU Commission made Apple's commitments binding: Apple must open iPhone NFC to rival wallets in the EEA for ten years, after finding Apple dominant in in-store wallets on iOS ([EC](https://ec.europa.eu/commission/presscorner/detail/en/ip_24_3706) [F]). PayPal chose coexistence: its PayPal and Venmo cards work in Apple Wallet ([newsroom](https://newsroom.paypal-corp.com/2023-10-03-PayPal,-Venmo-Credit-and-Debit-Cards-Now-Available-to-Add-in-Apple-Wallet) [F]). Reuters linked the 2024 layoffs to pressure from Apple ([Business Today](https://www.businesstoday.in/technology/news/story/paypal-to-reduce-global-workforce-by-9-in-2024-see-details-415497-2024-01-31) [F]).
- **Zelle** processed more than $1tn in 2024. Its Wikipedia entry names PayPal and Venmo as its "principal competitor" ([Wikipedia](https://en.wikipedia.org/wiki/Zelle_(payment_service)) [F]).
- **Klarna** IPO'd on the NYSE on 10 Sep 2025 ([Wikipedia](https://en.wikipedia.org/wiki/Klarna) [F]).
- **Pix** reached about R$3.4tn a month and 200m users by Q1 2026 ([Wikipedia](https://en.wikipedia.org/wiki/Pix_(payment_system)) [F]). PayPal now *offers* Pix through PayPal Complete Payments, its offering for platforms and SMBs ([newsroom](https://newsroom.paypal-corp.com/2026-04-PayPal-Adds-Pix-to-Power-Growth-for-Millions-of-Small-Businesses-in-Brazil) [F]). This shows local real-time payment rails acting as substitutes PayPal must accommodate rather than displace (INTERPRETATION).
- **Stripe, Adyen and Shopify.** Each is both a partner and a rival. PayPal processes part of Shopify Payments in the US ([newsroom](https://newsroom.paypal-corp.com/2024-09-09-PayPal-partners-with-Shopify-to-power-a-portion-of-Shopify-Payments-in-the-U-S) [F]), and Adyen distributes Fastlane. I did not obtain independent share data for checkout buttons (Shop Pay, Stripe Link, Apple Pay). That is a gap.
- **Branded share erosion.** The best evidence is PayPal's own: branded TPV grew 1–2% while global e-commerce grew faster, and management says "improvement relative to the market" only at merchants where its full playbook is deployed, which covers about 25% of branded volume ([PYMNTS](https://www.pymnts.com/?p=3448713) [F]). INTERPRETATION: implied share loss.

### 2.7 Bank, merchant, processor and wallet relationships

All VERIFIED as announcements [F]:
- Processors: [Fiserv](https://newsroom.paypal-corp.com/2024-08-29-PayPal-Expands-Strategic-Partnership-with-Fiserv-to-Streamline-Checkout-Experiences-in-the-U-S), [Global Payments](https://newsroom.paypal-corp.com/2024-10-23-PayPal-and-Global-Payments-Join-Forces-to-Simplify-Checkout-with-Fastlane) (its top acquirer of PayPal branded checkout in Europe) and [JPMorgan Payments](https://newsroom.paypal-corp.com/2025-02-25-PayPal-and-JP-Morgan-Payments-Broaden-their-Strategic-Relationship-to-Launch-Fastlane-and-Expand-Merchant-Acquiring-in-the-UK-and-European-Markets) (Fastlane, and PayPal acquiring in the UK and EU on JPM's platform).
- Banks: [Deutsche Bank](https://newsroom.paypal-corp.com/2026-01-13-Deutsche-Bank-Expands-Support-for-PayPal-to-Strengthen-Global-Payment-Capabilities) for US settlement and payouts, framed as "resiliency and diversification."
- Card issuer: The Bancorp Bank issues the Venmo card.
- Stablecoin: Paxos issues PYUSD.
- Credit funding: KKR and Blue Owl buy receivables.

INTERPRETATION: German banks blocking PayPal debits in Aug 2025 shows how much PayPal depends on bank goodwill in markets where it pulls money by direct debit.

### 2.8 PYUSD and crypto

- **Launch and chains.** PYUSD launched on 7 Aug 2023, issued by Paxos ([newsroom](https://newsroom.paypal-corp.com/2023-08-07-PayPal-Launches-U-S-Dollar-Stablecoin) [F]). It added [Solana](https://newsroom.paypal-corp.com/2024-05-29-PayPal-USD-Stablecoin-Now-Available-on-Solana-Blockchain,-Providing-Faster,-Cheaper-Transactions-for-Consumers) (May 2024), [Arbitrum](https://newsroom.paypal-corp.com/2025-07-17-PayPal-USD-Expands-to-Arbitrum-Bringing-Layer-2-Efficiency-to-Multi-Chain-Development-Stack) (Jul 2025) and planned [Stellar](https://newsroom.paypal-corp.com/2025-06-11-PayPal-USD-PYUSD-Plans-to-Use-Stellar-for-New-Use-Cases) pending NYDFS approval. Paxos now lists seven chains ([Paxos](https://www.paxos.com/pyusd) [F]).
- **Rewards and markets.** Holder rewards of 3.7% started in 2025 ([newsroom](https://newsroom.paypal-corp.com/2025-04-23-Buy-Hold-Earn-Rewards-PayPal-Unlocks-Rewards-for-Holding-PayPal-USD) [F]). PYUSD became available in PayPal accounts in 70 markets in Mar 2026 ([newsroom](https://newsroom.paypal-corp.com/2026-03-17-PAYPAL-BRINGS-PAYPAL-USD-TO-USERS-ACROSS-70-MARKETS) [F]).
- **Supply.** From [DefiLlama](https://stablecoins.llama.fi/stablecoin/120) [F]:

  | Date | PYUSD supply |
  |---|---|
  | end-2023 | $234m |
  | end-2024 | $560m |
  | end-2025 | $3.53bn |
  | Mar 2026 (peak) | $3.89bn |
  | 4 Nov 2026 | $2.69bn |

  By chain: Ethereum $1.74bn, Solana $0.67bn, Arbitrum $0.16bn. VERIFIED.
- **Cost.** Incentives reduced crypto revenue by about $70m in 9M'26 ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]).
- **Regulation.** PayPal now describes itself as a "digital asset service provider under the GENIUS Act" (signed 18 Jul 2025, [Wikipedia](https://en.wikipedia.org/wiki/GENIUS_Act) [F]).
- **Pay with Crypto** launched in Jul 2025 at 0.99% ([newsroom](https://newsroom.paypal-corp.com/2025-07-28-PayPal-Drives-Crypto-Payments-into-the-Mainstream,-Reducing-Costs-and-Expanding-Global-Commerce) [F]). The rate rises to 1.5% in Aug 2027.

### 2.9 Africa, Nigeria and the Middle East

- **Middle East and Africa.** PayPal opened a Dubai regional hub covering 80 countries in Apr 2025 ([newsroom](https://newsroom.paypal-corp.com/2025-04-23-PayPal-Expands-in-the-Middle-East-and-Africa-with-New-Dubai-Hub-Serving-80-Countries) [F]) and committed $100m to the region in Sep 2025 through investments, acquisitions and people ([newsroom](https://newsroom.paypal-corp.com/2025-09-24-PayPal-Commits-100-Million-to-Accelerate-Digital-Growth-Across-the-Middle-East-and-Africa) [F]).
- **Nigeria: history.** PayPal launched in Nigeria in 2014 for *paying out* only ([TechCabal](https://techcabal.com/2014/06/16/paypal-extends-services-nigeria/) [F]). Third-party exchangers exist because Nigerians "encounter restrictions with receiving money via PayPal" ([Nairametrics](https://nairametrics.com/2022/12/16/receive-money-in-nigeria-via-paypal-from-family-and-friends-abroad-with-mypally-and-get-paid-in-naira/) [F]).
- **Nigeria: Paga.** Paga now advertises "Paga x PayPal." Users link a PayPal account to receive international payments and withdraw in naira or USD. The service is run through Paga Remit, a Central Bank of Nigeria-licensed international money transfer operator (IMTO), which provides "limited access and services" ([Paga](https://www.mypaga.com/pagapaypal/index.html) [F]). VERIFIED that the service exists. I could not verify the launch date (Jan 2026 per the brief) from a fetched source.

---

## 3. Official claims vs independent evidence

| PayPal claim | Independent or primary evidence | Verdict |
|---|---|---|
| "In 2024, we returned PayPal to profitable growth"; 2027 high-single-digit TM$ and low-teens+ EPS (Investor Day, Feb 2025) | 2027 outlook rescinded Feb 2026; 2026 TM$ about +1%; medium-term ambition cut to mid-single-digit TM$ ([Investor Day](https://www.sec.gov/Archives/edgar/data/1633917/000119312525034283/d919560dex991.htm), [Q3'26 call](https://www.fool.com/earnings/call-transcripts/2026/10/27/paypal-pypl-q3-2026-earnings-call-transcript/)) [F] | Claim not met; withdrawn |
| "This is a stronger company today than we were two years ago" (Chriss, Oct 2025) | Board removed Chriss 3 months later; Q4'25 EPS missed guidance raised twice ([finews](https://www.finews.com/news/english-news/71055-paypal-zahlungsdienst-ceo-alex-chriss-enrique-lores-jamie-miller-aktienkurs-finance-2)) [F] | Board itself disagreed |
| Honey "follows industry rules... last-click attribution" (Dec 2024) | PayPal disabled the code in Jan 2026; affiliate networks terminated Honey; court lets claims proceed ([PPC Land](https://ppc.land/honey-loses-7-000-merchants-as-judge-lets-creator-lawsuit-proceed/)) [F] | Contradicted |
| German incident was a "temporary service interruption" affecting "a small number of accounts" (Aug 2025) | Banks blocked "hundreds of millions to >€10bn"; savings banks association cites "significant impact throughout Europe" ([Paypers](https://thepaypers.com/fraud-and-fincrime/news/german-banks-halt-eur-10-billion-in-paypal-transactions-over-fraud-reports-newspaper), [TechRadar](https://www.techradar.com/pro/security/paypal-glitch-triggers-chaos-as-european-banks-freeze-billions-in-transactions)) [F] | Minimised |
| 2022 breach: credentials "not obtained from any PayPal systems" | NYDFS found PayPal's own failures (no MFA mandate, untrained engineers) ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/nydfs-fines-paypal-2-million-for-cybersecurity-failures)) [F] | Technically true, misleading in emphasis |
| PayPal World connects platforms with "nearly two billion users" | Mercado Pago only signed an MOU; first verified live use case is Weixin Pay for US travellers in Aug 2026 ([newsroom](https://newsroom.paypal-corp.com/2025-07-23-Introducing-PayPal-World-a-global-platform-connecting-the-worlds-largest-payment-systems-and-digital-wallets,-starting-with-interoperability-to-PayPal-and-Venmo)) [F] | Addressable reach, not usage |
| PayPal "leading the agentic commerce revolution" | CFO: not material to 2026; multiple competing protocols; key integrations "coming soon" as of Jan 2026 ([PYMNTS](https://www.pymnts.com/?p=3448713), [Cymbio](https://newsroom.paypal-corp.com/2026-01-22-PayPal-to-Acquire-Cymbio,-Accelerating-Agentic-Commerce-Capabilities)) [F] | Unproven commercially |
| Non-GAAP margin "expanded 116bp" in FY24 | FY23 base restated from 22.4% to 17.2% | Definitional change makes trend claims non-comparable |
| Fastlane "converts >80%", "+51% conversion" | Company data only; adoption about 2,000 merchants (Feb 2025); no later disclosure | Unverified |
| Q3'26: "strategy beginning to translate into results" | PayPal-branded revenue −$240m YoY; GAAP operating income −8%; non-GAAP beat driven by opex control and reserve release ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm)) [F] | Partly true (Venmo, Braintree); core still shrinking in revenue |

---

## 4. Contradictions and disputed claims

- **Size of the German debit block.** Süddeutsche Zeitung said more than €10bn (unsourced). A Reuters banking source said "hundreds of millions to billions." The Local said "tens of billions." PayPal said "a small number of accounts." The Local said supervision sits with Luxembourg rather than BaFin; Payments Industry Intelligence said both BaFin and the CSSF were informed. DISPUTED.
- **Branded checkout's prior growth rate.** finews wrote that Q4'25's +1% compared with "8 percent growth seen in previous quarters." PayPal's call said +5% in Q3'25. I follow PayPal.
- **Honey's scale.** PayPal said the code affected "<0.1% of traffic"; the MegaLag video disputes the undated figure. Estimates of users lost range from about 3m in two weeks to 7–8m by the end of 2025. REPORTED.
- **Stripe and Advent bid (Jul 2026).** Known only via a Wikipedia citation of Reuters. There is no PayPal disclosure. Unconfirmed.
- **CFPB payment-app rule status.** The rule was published, then probably nullified in 2025, but eCFR shows no removal. Unverified.
- **2022 breach and law enforcement.** The Register says PayPal did not inform law enforcement, citing PayPal's own notice; a law-firm summary [S] says it did. I follow PayPal's notice.

## 5. How the issues evolved, 2023 to 2026

- **2023: volume without profit.** TPV grew 13% but TM$ fell 1%, the founding CEO era ended, and the SEC sent its PYUSD subpoena.
- **2024: cost cuts and repricing.** Headcount went from 27.2k to 24.4k, Braintree was repriced, new products shipped (Fastlane, Everywhere), and the stock rallied to $85.
- **2025: profitable growth, then cracks.** Margins expanded and guidance rose twice, while the Honey scandal, the German debit failure, new FTC CIDs and the NYDFS fine accumulated. Branded checkout weakened in H2.
- **2026: reckoning.** The CEO was removed and targets withdrawn. A new securities suit was filed and the UK FCA opened a probe. The company reorganised into three units with $1.5bn of cuts. Branded checkout held at 1–2%, Venmo and Braintree became the growth engines, and PYUSD supply fell back.

The arc runs from a growth story (Schulman) to a margin story (Chriss) to a cost-and-diversification story (Lores). Branded checkout, the most profitable business, was never fixed.

## 6. Implications

**For PayPal (INTERPRETATION):**
- PayPal is becoming a diversified payments utility: unbranded processing, a Venmo consumer app, credit through partners, and a mature branded button.
- That model earns lower take rates and depends on credit cycles, partner funding (KKR, Blue Owl) and cost discipline.
- Buybacks of $6bn a year, roughly 12% of market capitalisation at ~$55 (about 860m diluted shares; my estimate), are the main driver of EPS. That limits room for acquisitions and invites takeover speculation.
- Regulatory risk is shifting from AML/KYC towards competition law (Germany, UK FCA) and consumer-protection practices (FTC on fees and purchase protection, CFPB on Regulation E).

**For the wider industry:**
1. A global wallet's moat erodes when domestic real-time rails (Pix, UPI, Wero) and OS wallets (Apple Pay, now forced open in the EEA) improve. Incumbents respond with interoperability (PayPal World, Pix acceptance) rather than replacement.
2. Agentic commerce is fragmenting into competing protocols (OpenAI's ACP, Google's AP2, Mastercard Agent Pay). Wallets compete on trust and buyer protection, not on rails.
3. Stablecoin distribution by a large wallet does not guarantee adoption. PYUSD needed paid yield and shrank when yield-seeking money left.
4. Anti-steering and anti-surcharge clauses are a live antitrust target in Europe.

## 7. Problems still unresolved as of Nov 2026 (evidence-backed)

1. Branded checkout growth is stuck at 1–2%, and PayPal-branded revenue is declining ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]).
2. 180-day balance holds remain in the User Agreement ([UA](https://www.paypal.com/us/legalhub/paypal/useragreement-full) [F]), and "trouble accessing funds" complaints rose from 237 (2023) to 1,903 (2026 YTD) ([CFPB](https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=Paypal%20Holdings%2C%20Inc&size=0) [F]).
3. Unauthorized-transaction and scam complaints are rising: 2,283 unauthorized-transaction complaints in 2026 YTD. Friends and Family payments remain largely unprotected ([newsroom](https://newsroom.paypal-corp.com/2025-7-21-Introducing-AI-Powered-Scam-Alerts-for-Friends-and-Family-Payments) [F]).
4. The German anti-surcharging and presentation case is unresolved after more than 3.5 years. The UK FCA wallet-funding probe and three FTC CIDs, including on fees and purchase protection, are open, as are CFPB Regulation E and PayPal Credit CIDs ([10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F]).
5. Honey liability is in discovery ([PPC Land](https://ppc.land/honey-loses-7-000-merchants-as-judge-lets-creator-lawsuit-proceed/) [F]).
6. The Branded Checkout securities action and the NNA appeal are pending.
7. The take rate continues to fall.
8. PYUSD has no organic demand beyond subsidised yield: supply is down about 31% from its peak.
9. Nigeria and much of Africa still rely on intermediaries (Paga Remit, exchangers) to *receive* PayPal funds ([Paga](https://www.mypaga.com/pagapaypal/index.html) [F]).
10. PayPal World is mostly unlaunched beyond Tenpay.
11. There is no approved PayPal Bank charter.

## 8. Opportunity signals (all SPECULATIVE)

1. **"Receive-side" infrastructure for African freelancers and SMEs.**
   - *Evidence:* PayPal's Nigerian access still runs through CBN-licensed IMTO partners like Paga with "limited access," and exchangers exist because receiving is restricted.
   - *Idea:* a compliant collections layer, such as virtual USD accounts, marketplace payouts or Hyperwallet-style disbursement into naira wallets, partnering with an IMTO. PayPal's $100m MEA fund and Dubai hub are possible investors or partners.
2. **Frozen-funds and dispute tooling for merchants.**
   - *Evidence:* 180-day holds, rising "trouble accessing funds" complaints, a 1.3/5 review score, and monetary-relief closures quadrupling.
   - *Idea:* a reserve-forecasting dashboard, dispute evidence automation, multi-PSP failover, or receivables financing against held balances.
3. **Fraud and scam-warning APIs for Friends-and-Family-style payments in Africa.**
   - *Evidence:* PayPal concedes F&F payments are often not refundable, and unauthorized-transaction complaints keep climbing.
   - *Idea:* scam scoring for push payments, which is equally relevant to Nigerian instant transfers.
4. **Interoperability "glue."**
   - *Evidence:* PayPal World, Pix acceptance and Venmo-PayPal linking show the big wallets now pay to connect to local rails.
   - *Idea:* a Nigerian or African rail adapter that turns naira wallets, NIP transfers and NQR into acceptable funding sources for global wallets and agentic checkouts.
5. **Agent-ready merchant catalogs for African sellers.**
   - *Evidence:* PayPal bought Cymbio for "store sync" to AI surfaces, and protocols (ACP, AP2) are multiplying.
   - *Idea:* a catalog plus payment-orchestration layer that makes African merchants discoverable and payable inside AI agents, staying protocol-neutral.
6. **Stablecoin settlement with real utility, not yield.**
   - *Evidence:* PYUSD shrank once its incentive-driven growth stopped.
   - *Idea:* use cases where dollar stablecoins solve FX or settlement pain, such as B2B import payments and payroll for remote workers. Build on licensed partners and stay aware of CBN rules.
7. **Anti-steering and surcharge-aware checkout for merchants.**
   - *Evidence:* the German FCO case and the FCA probe.
   - *Idea:* if surcharge bans fall, merchants will want tools that steer customers to cheaper rails, an opening for low-cost local rails at checkout.

## 9. Coverage self-audit

**Covered:**
- Every annual release for FY22–FY25 and all three 2026 quarterly releases.
- The FY23, FY24 and FY25 10-Ks and the Q2'26 and Q3'26 10-Qs (legal notes, MD&A, headcount, restructuring).
- 8-Ks on the CEO, CFO, reorganisation, board and Investor Day.
- Four earnings-call transcripts: Q4'23, Q4'24, Q4'25 and Q3'26.
- About 45 PayPal newsroom releases.
- Regulators: CFPB complaint API and rule, Federal Register, eCFR, Bundeskartellamt, EC, NYDFS through secondary sources.
- Coverage of the courts and the Honey litigation, plus market data (Yahoo and DefiLlama).
- Competitor context: Wero, Zelle, Klarna, Pix, UPI, Apple Pay.
- Nigeria (Paga, TechCabal, Nairametrics).

The ledger has 150 records across 63 domains: 148 [F] and 2 [S].

**Gaps and limits:**
- The shared web-search budget ran out early in this session. The remaining research used direct fetches of known or derived URLs, mainly SEC EDGAR, PayPal's newsroom and URLs surfaced by earlier searches. As a result:
  - I have **no independent third-party data on checkout-button share** (e.g. Shop Pay, Apple Pay, Stripe Link vs PayPal).
  - Venmo goods-and-services fee changes, Seller Protection and dispute-policy changes, and outage history beyond Aug 2025 are not verified.
  - India (including any Indian anti-money-laundering registration dispute) and Japan/Paidy regulatory events are not verified.
  - The Paga launch date and the UK FCA's own press release are not verified.
- **Blocked sites:**
  - Reuters and Business Times (takeover reports), via the tool and the classifier.
  - Trustpilot and BBB.
  - congress.gov and GovTrack (CRA repeal).
  - The NYDFS press release (404).
  - Courthouse News and Investing.com.
  - The AUSTRAC release URL returned no content.
- **Not done:** CFPB complaint narratives returned empty, so I did no qualitative coding of complaints. The analyst views I used come only from earnings-call Q&A, not sell-side reports.
