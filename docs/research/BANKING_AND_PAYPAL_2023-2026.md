# The Banking Industry and PayPal, 2023 – November 2026

### A deep research investigation

**Prepared:** 5 November 2026 (Africa/Lagos)
**Scope:** 1 January 2023 to 5 November 2026. Covers global banking, payments and fintech, with a dedicated investigation of PayPal.

**How this was produced**

- Thirteen research streams ran in parallel:
  - 4 by year: 2023, 2024, 2025, 2026
  - 1 dedicated to PayPal
  - 4 thematic: fraud and cyber; payments and inclusion; customers; AI and competition
  - 4 gap-fill: Africa and the Middle East; Asia and Latin America; US/UK/EU primary sources; PayPal and its competitors
- Every source used was logged in a machine-readable ledger: `research-ledger.csv`.
- During synthesis we re-checked selected primary documents ourselves: the FOMC statement of 28 Oct 2026, PayPal's CEO announcement, and reporting of the Stripe/Advent bid.

**Volume:** see §10, Research coverage report. Final figures are computed from the ledger.

**How to read the labels**

| Label | Meaning |
|---|---|
| **[F]** | We opened and read the source |
| **[S]** | We saw only a search-result summary |
| **VERIFIED** | Primary or official source, or at least two independent reputable sources |
| **REPORTED** | One reputable source |
| **DISPUTED** | Sources conflict |
| **INTERPRETATION** | Our own reasoning |
| **SPECULATIVE** | An opportunity idea, not a finding |

**Companion files**

- `slices/`: thirteen detailed reports with every citation.
- `SOURCE_DIRECTORY.md`: every source, grouped by year and subject.
- `research-ledger.csv`: the full ledger.
- `../PRODUCT_DISCOVERY.md`: the earlier hackathon product decision (Kept).


## Contents
1. [Executive summary](#1-executive-summary)
2. [Year-by-year investigation](#2-year-by-year-investigation) — [2023](#21--2023-the-year-of-the-digital-bank-run) · [2024](#22--2024-the-year-the-plumbing-broke) · [2025](#23--2025-the-year-of-the-great-us-policy-reversal-and-europes-liability-turn) · [2026](#24--2026-1-jan--5-nov-charters-stablecoin-rules-a-rate-hike-and-a-reality-check)
3. [The banking industry as a whole](#3-the-banking-industry-as-a-whole-by-theme-20232026)
4. [PayPal: dedicated investigation](#4-paypal-dedicated-investigation-jan-2023--5-nov-2026)
5. [Comparative timeline](#5-comparative-timeline-how-the-major-issues-changed-over-four-years)
6. [Inventory of significant problems](#6-inventory-of-significant-problems-evidence-backed)
7. [Recurring problems still unresolved](#7-recurring-problems-that-remain-unresolved)
8. [Prioritised opportunities](#8-prioritised-opportunities-all-speculative)
9. [Source directory](#9-source-directory)
10. [Research coverage report](#10-research-coverage-report)

---

## 1. Executive summary

### What happened

1. **2023 was the first bank crisis at smartphone speed.**
   - SVB lost more than $40bn in a single day, against WaMu's $19bn over 16 days in 2008.
   - Three large US banks failed, and Credit Suisse was forced into UBS.
   - Every official post-mortem blamed **supervisors as well as managers**.
   - Uninsured depositors were made whole, at an industry cost of $16.3bn plus Swiss state guarantees. VERIFIED [F].
2. **2024 was the year the plumbing broke.**
   - Synapse, the middleware between fintech apps and their partner banks (BaaS), collapsed. End users were owed about $265m against about $180m that could be traced. **Up to $95m is still owed in Nov 2026.**
   - TD Bank pleaded guilty, with about $3.09bn in AML penalties.
   - A single CrowdStrike update disrupted banks worldwide.
   - The CFPB wrote its most ambitious rulebook, and most of it was undone within 12 months. VERIFIED [F].
3. **2025 split the world in two.**
   - **The US** largely dismantled federal consumer-finance supervision:
     - the CFPB dropped its Zelle suit;
     - Congress repealed the overdraft and payment-app rules;
     - CFPB funding was cut 46%.
   - The US also deregulated capital and legalised stablecoins (GENIUS Act).
   - **The EU, UK and much of Asia-Pacific** moved the other way: they made payment firms, and increasingly **platforms and telcos**, liable for scams. Examples: PSD3/PSR, UK mandatory reimbursement (88% of claimed losses refunded), Singapore's Shared Responsibility Framework, Australia's Scams Prevention Framework. VERIFIED [F].
4. **2026 brought regime change and a reality check.**
   - An energy shock linked to a Middle East war pushed the Fed, under new chair Warsh, into its **first hike since 2023** (3.75–4.00%). Australia, Canada, Korea and Japan also hiked.
   - Fintechs rushed to **become banks**: 30+ US charter filings, Chime buying its partner bank, and Nigerian fintechs taking microfinance-bank licences.
   - OpenAI scaled back ChatGPT checkout, and **no liability rules exist for purchases made by AI agents**.
   - The CFPB is close to dormant. Democrats won Congress on 3 Nov.
   - All VERIFIED [F] except the Stripe/Advent bid, which is REPORTED.

### What did not change

5. **Fraud rose every single year, whatever regulators did.**

   | Measure | 2023 | 2024 | 2025 |
   |---|---|---|---|
   | US losses reported to the FBI's IC3 | $12.5bn | $16.6bn | $20.9bn |
   | India cyber-fraud | Rs 7.5k crore | Rs 22.8k crore (+206%) | — |
   | UK APP fraud | — | — | £576m (+19%) |

   - UK mandatory reimbursement protects victims but has not cut the fraud itself.
   - The root cause is that scams *start* on platforms and telecoms (66% of UK APP cases begin online), which carry no liability. Only Australia and the EU are now extending liability to them. VERIFIED [F].
6. **Sending money across borders is no cheaper.**
   - The global average cost of a $200 remittance was 6.3%, then 6.4%, then 6.5%. Sub-Saharan Africa is about 8.5–8.8%.
   - The FSB concedes that the G20's 2027 targets will be missed.
   - Only 11 of Africa's 36 instant-payment systems work across borders. VERIFIED [F].
7. **Money keeps getting stuck between institutions, and nobody owns the problem.** Examples:
   - Nigerian failed transfers: failed transactions make up about 45% of complaints to the Central Bank of Nigeria (CBN).
   - Synapse.
   - German banks blocking PayPal's direct debits.
   - Brazil's Pix refund mechanism recovering only R$1.4bn of R$17.6bn lost to fraud.

   This is the most persistent unsolved problem we found. VERIFIED [F].
8. **Account freezes, holds and closures stay opaque.**
   - Complaints from PayPal users about "trouble accessing funds" rose about 8× between 2023 and 2026.
   - The UK now requires 90 days' notice and a written reason (since Apr 2026).
   - The US issued a debanking executive order and the OCC named the 9 largest banks.
   - Nigeria froze accounts over BVN/NIN identity checks. VERIFIED [F].

### Where the industry changed structurally

9. **Banks earned record profits throughout.**
   - US banks earned $295.6bn in 2025. Global banks earned about $1.3tn.
   - Margins survived the rate cuts.
   - The biggest banks got bigger, and mergers were approved at their fastest pace since 1990.
   - Challengers became the most efficient lenders anywhere: Nubank's efficiency ratio is 19.9%, against roughly 52% for EU banks. VERIFIED [F].
10. **Instant payments won at home but not in the US consumer market.**

    | Rail | Latest volume |
    |---|---|
    | UPI (India) | ~25bn transactions a month |
    | Pix (Brazil) | ~80bn transactions in 2025 |
    | InstaPay (Egypt) | ~EGP 2.9trn in 2024 |
    | NIP (Nigeria) | 11bn transactions a year |
    | PI-SPI (West Africa) | Interoperability mandated by the regional central bank in 2026 |
    | FedNow (US) | Average payment about $58k: a wholesale rail, not a consumer one |

    VERIFIED [F].
11. **Inclusion surged, but usage did not.**
    - 79% of adults worldwide now have an account. Nigeria went from 45% to 63%.
    - In Nigeria, only 9.1% borrow formally, women trail at 52%, and men make 69% of NIP transactions.
    - Predatory loan apps (around 198% APR) persist. VERIFIED [F].
12. **AI moved from pilots to job cuts, and hit limits.**
    - Block cut over 40% of staff, citing AI tools. Standard Chartered (~7,800), Amex (3,500) and Fiserv (3,000) also cut.
    - Klarna partly rehired humans, and Commonwealth Bank of Australia reversed its AI-driven cuts.
    - AI-enabled fraud became a measured category: $893m in losses in the FBI's 2025 data.
    - The CFPB says AI agents are flooding its complaint system. VERIFIED [F].

### PayPal in one paragraph

PayPal went from a growth story to a margin story to a reset.

| Signal | Detail |
|---|---|
| Revenue growth | Slowed from +8% (2023) to +2% (Q3 2026) |
| Revenue as a share of payment volume | Fell from 2.03% to 1.76% |
| Branded checkout (its most profitable business) | Has grown only 1–2% for four quarters, while Shop Pay and Shopify grow 30%+ |
| Wallet position | Apple Pay is now more often Americans' *primary* wallet (28% vs 19%) |
| Leadership | The board removed CEO Alex Chriss in Feb 2026 and withdrew the 2027 targets; Enrique Lores leads a cost-cutting reorganisation |
| Takeover interest | Stripe and Advent reportedly bid about $53bn (Jul 2026, then dropped) |
| Customer complaints to the CFPB | Nearly tripled, led by unauthorized transactions and frozen funds; 180-day holds remain in the user agreement |
| Disputed incidents | Its German fraud-filter failure (Aug 2025) and the Honey affiliate scandal contradict its public statements |
| Open regulatory matters | German and UK competition cases, three FTC investigations and two CFPB investigations |
| Stablecoin (PYUSD) | Shrank 31% from its peak once subsidised yield faded |
| Nigeria | Re-entered for inbound payments via Paga (Jan 2026), but still through an intermediary with limited service |

PayPal's real assets are Venmo, Braintree, its reach (15m websites) and its buyer protection. Its strategic risk is becoming a utility layered under other companies' wallets, local payment rails and AI agents. Detail in §4.

### Where the biggest opportunities are (detail in §8)

1. **A "where is my money" layer that shows the true state of a payment.** It would track the status of a transfer across institutions, reverse failed transfers automatically, and orchestrate refunds. Nigeria's draft rules (48-hour reimbursement, 16-day resolution) create the demand. Score 24/25.
2. **Infrastructure for scam-reimbursement liability** on instant-payment rails (22/25).
3. **Explainable account actions:** reason codes, appeals and a status page for freezes and closures (22/25).
4. **Accountability for agent purchases:** intent, receipts and liability evidence (20/25).
5. **Collections for African freelancers and SMEs receiving money from abroad** (20/25).

The hackathon product **Kept** sits in opportunities #4 and #3. The research **strengthens** the case for building it. Opportunity #1 is its natural long-term expansion.

## 2. Year-by-year investigation

Each year is documented separately. Each chapter gives the major events, why they happened, who was affected, what followed, and how the year connects to the ones before and after it.

**Tags used in this section**

- **Access:** [F] means we opened and read the source. [S] means we saw only a search-result summary.
- **Evidence labels:** VERIFIED (primary or official source, or two or more independent reputable sources), REPORTED (one reputable source), DISPUTED (sources disagree), INTERPRETATION (our reasoning), SPECULATIVE (an opportunity idea).

The full evidence for each year, with every citation, is in the companion reports under `docs/research/slices/` (`y2023.md`, `y2024.md`, `y2025.md`, `y2026.md`).

---

### 2.1 — 2023: The year of the digital bank run

**In one sentence:** rising interest rates exposed banks that held long-dated bonds and were funded by uninsured, networked depositors. Smartphone-speed runs then brought down three large US banks and Credit Suisse, while instant payments went mainstream and fintech funding halved.

#### A. Major events

| Date (event) | Event | Evidence |
|---|---|---|
| 8 Mar | Silvergate announces wind-down after FTX-driven deposit flight; its SEN network had closed on 3 Mar | REPORTED [S] S&P |
| 9–10 Mar | **SVB** loses >$40bn in one day, with >$100bn more queued for the next (~85% of deposits). It fails on 10 Mar | VERIFIED — [Fed SVB review](https://www.federalreserve.gov/publications/files/svb-review-20230428.pdf) [F] |
| 12 Mar | **Signature** fails. The systemic-risk exception guarantees all deposits at both banks. The Fed creates the BTFP, lending against collateral **valued at par** | VERIFIED — [Fed](https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312a.htm) [F] |
| 19 Mar | **Credit Suisse** is forced into a UBS takeover. Up to CHF 100bn+ of liquidity support and a CHF 100bn public backstop; ~CHF 16bn of AT1 bonds written to zero | VERIFIED — [FINMA](https://www.finma.ch/en/news/2023/03/20230319-mm-cs-ubs/) [F]; [BCBS](https://www.bis.org/bcbs/publ/d555.htm) [F] |
| 1 May | **First Republic** fails ($229bn assets) and is sold to JPMorgan with FDIC loss-share | VERIFIED — [FDIC](https://www.fdic.gov/news/press-releases/2023/pr23034.html) [F] |
| Jun | Nigeria unifies its exchange rate: the naira goes from ₦462 to ~₦700/$, and ~₦920 on the parallel market by Sep | VERIFIED — [TechCabal](https://techcabal.com/2023/06/14/cbn-floats-the-naira/) [F] |
| 20 Jul | **FedNow** launches with 35 banks and credit unions | VERIFIED — [Fed](https://www.federalreserve.gov/newsevents/pressreleases/other20230720a.htm) [F] |
| 26 Jul | Fed's last hike, to 5.25–5.50%. The ECB deposit rate reaches 4.00% on 14 Sep | VERIFIED [F] |
| 27 Jul | US **Basel III endgame** proposal (+16% aggregate CET1 for large banks) | VERIFIED — [Fed](https://www.federalreserve.gov/newsevents/pressreleases/bcreg20230727a.htm) [F] |
| 7 Aug | **PayPal launches PYUSD** (issued by Paxos) | VERIFIED — [PayPal](https://newsroom.paypal-corp.com/2023-08-07-PayPal-Launches-U-S-Dollar-Stablecoin) [F] |
| Oct–Nov | CFPB proposes the **1033 open-banking** rule (19 Oct) and **payment-app supervision** (7 Nov). EU agrees **mandatory instant euro payments** with payee checks (7 Nov) | VERIFIED [F] |
| 21 Nov | **Binance** ~$4.3bn settlement, the largest in US Treasury history | VERIFIED — [Treasury](https://home.treasury.gov/news/press-releases/jy1925) [F] |
| Nov | LockBit ransomware hits **ICBC**'s US arm and disrupts Treasury-market clearing | REPORTED (secondary) |

#### B. Why it happened

1. **Duration risk met flighty, concentrated deposits.**
   - US banks' unrealised securities losses were **$515.5bn (Q1), $558.4bn (Q2), ~$684bn (Q3) and $477.6bn (Q4 2023)** — [FDIC QBP](https://www.fdic.gov/news/press-releases/2024/pr24014.html) [F].
   - From 2019 to 2021, SVB's assets grew 198% and Signature's 134%, against a 33% median for peers — [GAO-23-106736](https://www.gao.gov/products/gao-23-106736) [F].
2. **Supervisors failed as well as managers.**
   - SVB had **31 unaddressed supervisory findings**. The Fed's own review blamed the 2018 "tailoring" changes and a "less assertive supervisory approach". The FDIC admitted examiner shortfalls at Signature — [Fed](https://www.federalreserve.gov/newsevents/pressreleases/bcreg20230428a.htm) [F]; [FDIC](https://www.fdic.gov/news/press-releases/2023/pr23033.html) [F].
   - FINMA had issued 382 action points to Credit Suisse over 2018–22 without forcing change — [FINMA](https://www.finma.ch/en/news/2023/12/20231219-mm-cs-bericht/) [F].
3. **Technology changed how fast runs happen.**
   - The Fed said social media plus mobile banking "may have fundamentally changed the speed of bank runs". For comparison, WaMu lost $19bn over 16 days in 2008, while SVB lost $40bn+ in a single day.
   - The BCBS called 2023 "the most significant system-wide banking stress since the Great Financial Crisis" — [BCBS](https://www.bis.org/bcbs/publ/d555.htm) [F].

#### C. Who paid

| Cost | Amount | Source |
|---|---|---|
| Deposit Insurance Fund — SVB | ~$20bn | [FDIC](https://www.fdic.gov/news/press-releases/2023/pr23023.html) [F] |
| Deposit Insurance Fund — First Republic | ~$13bn | [FDIC](https://www.fdic.gov/news/press-releases/2023/pr23034.html) [F] |
| Deposit Insurance Fund — Signature | ~$2.5bn | VERIFIED [F] |
| Special assessment on 114 large banks (cost of protecting uninsured depositors) | **$16.3bn** | [FDIC fact sheet](https://www.fdic.gov/news/fact-sheets/special-assessment-final-rule-11-07-23.pdf) [F] |

- INTERPRETATION: shareholders were wiped out, but uninsured depositors and wholesale creditors were bailed out, funded by industry levies and state guarantees. The "no bailout" framing is contestable.
- About 3,000 UK tech firms were exposed through SVB UK, which HSBC bought for £1 — [HSBC](https://www.hsbc.com/news-and-media/media-releases/2023/hsbc-acquires-silicon-valley-bank-uk-limited) [F].

#### D. Payments, fraud and fintech in 2023

- **Instant rails went mainstream.**
  - Pix handled **~42bn transactions** (+75%), more than cards, boletos, TED, DOC and cheques combined — [Agência Brasil](https://agenciabrasil.ebc.com.br/economia/noticia/2024-03/pix-foi-o-meio-de-pagamento-mais-popular-do-brasil-em-2023) [F].
  - UPI reached ~12bn transactions a month by October.
  - Before the EU regulation, only 11% of euro credit transfers were instant — [EPRS](https://www.europarl.europa.eu/RegData/etudes/ATAG/2024/757630/EPRS_ATA(2024)757630_EN.pdf) [F].
- **Fraud became the main consumer harm.**
  - FBI IC3: **$12.5bn** in losses (+22%), of which crypto-investment fraud was $3.96bn — [IC3 2023](https://www.ic3.gov/AnnualReport/Reports/2023_IC3Report.pdf) [F].
  - FTC: **>$10bn** in losses, with bank transfers and crypto leading as payment methods — [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/02/nationwide-fraud-losses-top-10-billion-2023-ftc-steps-efforts-protect-public) [F].
  - UK: the PSR finalised **mandatory APP-scam reimbursement**, split 50:50 between sending and receiving banks — [PSR](https://www.psr.org.uk/news-and-updates/latest-news/news/psr-confirms-new-requirements-for-app-fraud-reimbursement/) [F].
  - MOVEit breach: 2,700+ organisations, 93m records; finance was 14% of victims — [Cybersecurity Dive](https://www.cybersecuritydive.com/news/progress-software-moveit-meltdown/703659/) [F].
- **Fintech funding crashed.**
  - **$39.2bn (−50%)** across 3,801 deals, the fewest since 2017 — [CB Insights](https://www.cbinsights.com/research/report/fintech-trends-2023/) [F].
  - African VC fell 54% in H1 — [TechCabal](https://techcabal.com/2023/07/11/africa-vc-funding-h1/) [F].
- **BaaS cracks were already visible.**
  - Exams of partner banks (Evolve, Cross River, Lineage) foreshadowed the 2024 Synapse collapse — [Fed Evolve order](https://www.federalreserve.gov/newsevents/pressreleases/enforcement20240614a.htm) [F].
- **Generative AI arrived in banks.**
  - Morgan Stanley's GPT-4 adviser assistant — [Morgan Stanley](https://www.morganstanley.com/press-releases/key-milestone-in-innovation-journey-with-openai) [F].
  - The CFPB warned that chatbots which block access to humans can break the law — [CFPB](https://www.consumerfinance.gov/data-research/research-reports/chatbots-in-consumer-finance/) [F].

#### E. Africa and emerging markets in 2023

- **Nigeria's naira redesign: a forced-cashless experiment that mostly hurt.**
  - Currency in circulation fell from **~₦3.3tn to ₦982bn**. Q1 GDP growth fell to 2.3%.
  - POS agents charged cash premiums of up to 20%. Failed transfers took up to 10 days to reverse.
  - The Supreme Court halted the policy.
  - Sources: [Carnegie](https://carnegieendowment.org/research/2024/01/why-nigerias-controversial-naira-redesign-policy-hasnt-met-its-objectives?lang=en) [F]; [TechCabal](https://techcabal.com/2023/03/28/naira-redesign-a-torturous-vanity-project-comes-to-an-end/) [F].
  - Fintechs (OPay, Moniepoint) gained users as bank apps buckled — [TechCabal](https://techcabal.com/2023/03/13/in-the-midst-of-nigerias-digital-banking-struggles-opay-is-rising-to-the-occasion/) [F].
  - DISPUTED: NIBSS data show transaction *volumes* rose while *values* fell.
  - The **eNaira** stayed marginal: ~98.5% of wallets idle (IMF via TechCabal [F]).
- **The bank–fintech trust war in Nigeria.**
  - Fidelity Bank blocked transfers to Kuda, OPay, Moniepoint and PalmPay for about two weeks over KYC concerns.
  - Nigerian institutions have reported ₦159bn in fraud losses since 2020 — [TechCabal](https://techcabal.com/2023/10/30/banks-and-neobanks-fraud-problems/) [F].
- **Ghana's domestic debt exchange** pushed the bank NPL ratio from 18.8% to 24.1% (Jun 2023 → Jun 2024) and left the central bank itself needing recapitalisation — [IMF CR 24/334](https://www.imf.org/-/media/files/publications/cr/2024/english/1ghaea2024004-print-pdf.pdf) [F].
- **South Africa** was grey-listed by the FATF in Feb 2023 [F].
- **Kenya:** M-Pesa held 96.5% of mobile-money subscriptions — [TechCabal](https://techcabal.com/2023/06/26/kenya-mobile-money-rivals-are-no-match-for-m-pesa/) [F].

#### F. Regulation in 2023 and what happened to it

INTERPRETATION: 2023 produced a burst of reform proposals, and the US political cycle then reversed most of them.

| 2023 proposal | Fate by Nov 2026 |
|---|---|
| Basel III endgame (+16% CET1) | Re-proposed in a much softer form in Mar 2026 [S] |
| CFPB 1033 open banking | Finalised Oct 2024; enjoined Oct 2025; being rewritten, with bank data-access fees now possible |
| CFPB payment-app supervision | Finalised, then voided by Congressional Review Act (signed 9 May 2025) |
| $8 credit-card late-fee cap | Vacated 15 Apr 2025 at the CFPB's own request |
| Fed "novel activities" programme (crypto/fintech partnerships) | Withdrawn in 2025 [F] |
| EU instant payments with payee check; UK APP reimbursement; MiCA; UK Consumer Duty | **Survived and are in force** |

#### G. 2023 for PayPal

- **FY2023 results:** revenue $29.8bn (+8%), TPV $1.53tn (+13%), but **active accounts −2% to 426m** — [PayPal Q4-23](https://s205.q4cdn.com/875401827/files/doc_financials/2023/q4/Q4-23-PayPal-Earnings-Release.pdf) [F].
- **Leadership:** Alex Chriss became CEO in Sep 2023.
- **Regulatory:** PYUSD drew an SEC subpoena in Nov 2023 (see §4).
- INTERPRETATION: growth was shifting from adding users to more transactions per existing user.

---

### 2.2 — 2024: The year the plumbing broke

**In one sentence:** the failures moved from bank balance sheets to the infrastructure underneath. BaaS middleware collapsed, the largest AML penalty in history was imposed, a single software update knocked out banks worldwide, and the CFPB's most ambitious rule-writing year began unravelling almost immediately.

#### A. Major events

| Date | Event | Evidence |
|---|---|---|
| 1 Feb–6 Mar | **NYCB/Flagstar** posts a $552m CRE provision and the stock falls ~38% in a day; a ~$1.05bn rescue led by Mnuchin follows | REPORTED/VERIFIED [S] SEC 8-K |
| 5 Feb | Nigeria: the naira falls from **₦898 to ₦1,400/$ in four days**, then to ~₦1,600 by July | VERIFIED [F] |
| 19 Feb | **Capital One agrees to buy Discover** ($35.3bn), acquiring its own card network | VERIFIED — [CNBC](https://www.cnbc.com/2024/02/19/capital-one-acquiring-discover-financial-services-report-says.html) [F] |
| 1 Mar | Nigeria freezes Tier-1 accounts and wallets without BVN/NIN | VERIFIED — [CBN circular](https://www.cbn.gov.ng/Out/2023/PSMD/Circular%20on%20Tier%201%20Wallets%20%26%20Accounts,%20Guidance%20Note%20%26%20Profiling%20of%20Customers%27%20Accounts%20%26%20Wallets.pdf) [F] |
| 28 Mar | Nigeria orders **bank recapitalisation**: ₦500bn minimum for international licences, deadline Mar 2026 | VERIFIED — [CBN](https://www.cbn.gov.ng/Out/2024/CCD/Recapitalization_MARCH_2024.pdf) [F] |
| 22 Apr | **Synapse** files for bankruptcy. ~$265m is owed to end users against ~$180m that can be traced; 100k+ people locked out | VERIFIED — [Banking Dive](https://www.bankingdive.com/news/synapse-trustee-85-million-shortfall-customer-funds/718796/) [F] |
| 26 Apr | Republic First Bank fails (cost to the deposit fund: $667m) | VERIFIED — [FDIC](https://www.fdic.gov/news/press-releases/fulton-bank-na-lancaster-pennsylvania-assumes-substantially-all-deposits) [F] |
| 29 Apr–3 Jun | Nigeria's CBN bars **OPay, PalmPay, Kuda and Moniepoint** from onboarding customers for about 6 weeks | VERIFIED — [Nairametrics](https://nairametrics.com/2024/04/29/forex-deals-cbn-stops-4-fintechs-from-onboarding-new-customers/) [F]; [TechCabal](https://techcabal.com/2024/06/03/cbn-lifts-onboarding-freeze/) [F] |
| 6–17 May | Nigeria orders a 0.5% "cybersecurity levy" on e-transfers, then withdraws it after 11 days | VERIFIED — CBN circulars [F] |
| 16 May | US Supreme Court upholds CFPB funding, 7–2 | VERIFIED — [SCOTUS](https://www.supremecourt.gov/opinions/23pdf/22-448_o7jp.pdf) [F] |
| 29 May–Jun | LockBit ransomware at **Evolve Bank** exposes data on **7.64m** people. Fed enforcement order on 14 Jun | VERIFIED — [SecurityWeek](https://www.securityweek.com/evolve-bank-data-breach-impacts-7-6-million-people/) [F] |
| 25 Jun | Judge denies preliminary approval of the Visa/Mastercard interchange settlement | VERIFIED — [Visa 10-K](https://www.sec.gov/Archives/edgar/data/1403161/000140316124000058/v-20240930.htm) [F] |
| Jun | Kenya: protests over the Finance Bill (proposed 20% excise on financial transactions); 80+ dead; bill withdrawn | VERIFIED (secondary) [F] |
| 11 Jul | EU makes Apple's commitment binding: third-party wallets get free iOS NFC access | VERIFIED — [EC](https://ec.europa.eu/commission/presscorner/detail/en/ip_24_3706) [F] |
| 19 Jul | **CrowdStrike** outage: 8.5m Windows devices, disrupting banks on several continents | VERIFIED — [Microsoft](https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/) [F] |
| 18 Sep | Fed's first cut (−50bp); 100bp of cuts by December | VERIFIED [F] |
| 24 Sep | **DOJ sues Visa** for monopolising debit | VERIFIED [F] |
| 7 Oct | UK **mandatory APP reimbursement** goes live, capped at £85k (cut from £415k) | VERIFIED — [PSR PS24/7](https://www.psr.org.uk/publications/policy-statements/ps247-faster-payments-app-scams-reimbursement-requirement-confirming-the-maximum-level-of-reimbursement/) [F] |
| 10 Oct | **TD Bank** pleads guilty; ~**$3.09bn** in penalties. "Trillions" of transactions went unmonitored, including Zelle and Venmo flows | VERIFIED — [FinCEN](https://www.fincen.gov/news/news-releases/fincen-assesses-record-13-billion-penalty-against-td-bank) [F]; [OCC](https://www.occ.gov/news-issuances/news-releases/2024/nr-occ-2024-116.html) [F] |
| Oct–Dec | CFPB finalises **1033** (22 Oct), **payment-app supervision** (21 Nov) and an **overdraft cap** (12 Dec), and sues Zelle and three big banks (20 Dec, alleging >$870m of losses) | VERIFIED [F] |
| 7 Nov | **Finastra** breach (serves 45 of the top 50 banks) | VERIFIED — [Krebs](https://krebsonsecurity.com/2024/11/fintech-giant-finastra-investigating-data-breach/) [F] |

#### B. Why it happened

1. **Fintech outsourced its ledger, and nobody reconciled it.**
   - Synapse held customer money in pooled FBO accounts at partner banks while keeping the ledger itself. When the middleman failed, banks could see balances but not who owned them.
   - Yotta's 13,725 customers were offered **$11.8m against $64.9m** deposited — [CNBC](https://www.cnbc.com/2024/11/22/synapse-bankruptcy-thousands-of-americans-see-their-savings-vanish.html) [F].
   - The FDIC said deposit insurance does not cover the failure of a nonbank.
2. **Controls fell behind growth across the industry.**
   - TD Bank ("persistent prioritization of growth over controls"), Starling (£28.96m fine; 54,000 accounts opened for high-risk customers despite a restriction — [FCA](https://www.fca.org.uk/news/press-releases/fca-fines-starling-bank-failings-financial-crime-systems-and-controls) [F]), Evolve, Cash App.
   - The common pattern: hyper-growth first, compliance debt later.
3. **Concentration in tech providers became a systemic risk.**
   - CrowdStrike, Finastra and LockBit at Evolve showed that a small number of shared suppliers can take down large parts of the system at once.
   - The FSB (Nov 2024) named third-party AI and cloud concentration as a vulnerability — [FSB](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/) [F].
4. **Regulators responded with rules faster than the political system would sustain them.**
   - INTERPRETATION: most 2024 CFPB rules were sued on the day they were issued and reversed within 12 months.

#### C. Fraud in 2024

- **US (FBI IC3): record $16.6bn** in losses.
  - Crypto fraud: $9.3bn. Victims aged 60+: $4.8bn — [IC3 2024](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf) [F].
- **Southeast Asian scam compounds:**
  - UNODC estimated 2023 scam losses in East and Southeast Asia at $18–37bn.
  - A single Mekong-based payment provider processed **$49–64bn**, mostly in USDT — [UNODC](https://www.unodc.org/roseap/uploads/documents/Publications/2024/TOC_Convergence_Report_2024.pdf) [F].
  - Chainalysis: pig-butchering revenue up ~40% — [Chainalysis](https://www.chainalysis.com/blog/2024-pig-butchering-scam-revenue-grows-yoy/) [F].
- **Deepfakes:**
  - The Arup Hong Kong employee lost **$25m** on a video call in which every other participant was a deepfake — [CNN](https://edition.cnn.com/2024/05/16/tech/arup-deepfake-scam-loss-hong-kong-intl-hnk/index.html) [F].
  - FinCEN issued a deepfake alert in Nov 2024 — [FinCEN](https://www.fincen.gov/sites/default/files/shared/FinCEN-Alert-DeepFakes-Alert508FINAL.pdf) [F].

#### D. The fintech split

- **Funding hit a seven-year low:** **$33.7bn** — [CB Insights](https://www.cbinsights.com/research/report/fintech-trends-2024/) [F].
- **Winners scaled into profit:**
  - Nubank: $2.0bn net profit.
  - Monzo: first full-year profit, £15.4m — [Monzo](https://monzo.com/annual-report/2024) [F].
  - Adyen: processed volume +33%, 50% EBITDA margin — [Adyen](https://www.adyen.com/press-and-media/adyen-publishes-h2-2024-financial-results) [F].
- **Klarna** claimed its AI assistant did "the work of 700 agents" — [Klarna](https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/) [F]. REPORTED company claim; the 2025 partial reversal is covered in §2.3.
- **Revolut** received a *restricted* UK banking licence in Jul 2024. The full licence came only in Mar 2026.

#### E. Nigeria and Africa in 2024

INTERPRETATION: Nigeria's regulators hit fintech growth from several directions at once.

- **Measures:**
  - BVN/NIN account freezes.
  - The onboarding ban on four large fintechs. The fintechs said most of the accounts EFCC flagged were at commercial banks (DISPUTED).
  - The withdrawn transfer levy.
  - Agent cash-out caps (₦100k per customer per day; ₦1.2m per agent per day) — [CBN](https://www.cbn.gov.ng/Out/2024/CCD/Circular%20on%20Cash-out%20limits%20for%20Agent%20Banking%20Transactions.pdf) [F].
  - Renewed cash scarcity — [CBN](https://www.cbn.gov.ng/Out/2024/CCD/CIRCULAR%20ON%20CASH%20AVAILABILITY.pdf) [F].
- **Growth continued regardless:**
  - PalmPay: 35m+ users, up to 15m transactions a day — [TechCabal](https://techcabal.com/2024/11/06/how-palmpay-became-a-household-name/) [F].
  - Moniepoint became a unicorn (Oct 2024).
- **Kenya:** NPLs at **16.5%** — [CBK](https://www.centralbank.go.ke/uploads/mpc_press_release/536717785_MPC%20Press%20Release%20-%20Meeting%20of%20December%205%202024.pdf) [F].

#### F. 2024 for PayPal

- **FY2024:** TPV $1.68tn (+10%), revenue $31.8bn (+7%), **active accounts +2% to 434m**.
- Transaction revenue grew more slowly than volume because of unbranded, low-margin large-merchant processing (Braintree).
- Disclosed investigations: a CFPB CID on PayPal Credit, the SEC subpoena on PYUSD, and an FTC CID — [PayPal 10-K](https://www.sec.gov/Archives/edgar/data/1633917/000163391725000019/pypl-20241231.htm) [F].
- The Honey affiliate-cookie controversy broke in Dec 2024 (see §4).

#### G. How 2024 connects to 2023 and 2025

- **Bank failures:** fell from three giants to two small banks. The same causes persisted: **$482bn** of unrealised losses at end-2024, and CRE stress — [OCC](https://www.occ.gov/news-issuances/news-releases/2024/nr-occ-2024-135.html) [F].
- **Enforcement:** moved from "fix your liquidity" (2023) to "criminal pleas and growth caps" (2024), then federal retreat (2025).
- **Fraud:** rose from $12.5bn to $16.6bn (IC3). The UK moved from voluntary to mandatory reimbursement.

---

### 2.3 — 2025: The year of the great US policy reversal and Europe's liability turn

**In one sentence:** the US federal consumer-finance regulator largely stood down, bank regulation was loosened, and stablecoins were legalised. Europe went the other way and made payment firms and online platforms liable for fraud. Bank stress moved from deposit runs to fraud in private credit, and agentic commerce became the new battleground.

#### A. Major events

| Date | Event | Evidence |
|---|---|---|
| 17 Jan | EU **DORA** applies (ICT resilience for 20 types of financial entity) | VERIFIED — [EIOPA](https://www.eiopa.europa.eu/digital-operational-resilience-act-dora_en) [F] |
| 1 Feb–Apr | CFPB director fired; work halted (3 Feb); >1,400 staff given layoff notices | VERIFIED — [OPB/NPR](https://www.opb.org/article/2025/08/15/cfpb-staff-layoffs-can-proceed-appeals-court-rules/) [F] |
| 21 Feb | **Bybit** hack (~$1.5bn), attributed by the FBI to North Korea | VERIFIED — [FBI](https://www.ic3.gov/PSA/2025/PSA250226) [F] |
| 4 Mar | CFPB **drops the Zelle lawsuit** with prejudice | VERIFIED — [CFPB](https://www.consumerfinance.gov/about-us/newsroom/cfpb-sues-jpmorgan-chase-bank-of-america-and-wells-fargo-for-allowing-fraud-to-fester-on-zelle/) [F] |
| 20 Mar / 23 Jun | OCC, then Fed, stop examining banks for "reputation risk" | VERIFIED — [OCC](https://www.occ.gov/news-issuances/bulletins/2025/bulletin-2025-4.html) [F]; [Fed](https://www.federalreserve.gov/newsevents/pressreleases/bcreg20250623a.htm) [F] |
| 9 May | Congress repeals the **overdraft** rule and the **payment-app supervision** rule (Congressional Review Act) | VERIFIED (2 law-firm sources) [S] |
| 11 May | **Coinbase** discloses bribed-insider breach (69,461 customers; estimated cost $180–400m) | VERIFIED — [Engadget](https://www.engadget.com/cybersecurity/extortionists-bribed-coinbase-employees-to-give-them-customer-data-174713732.html) [F] |
| 14 May | Klarna CEO admits AI-only customer service produced "lower quality" and rehires humans | VERIFIED — [CNBC](https://www.cnbc.com/2025/05/14/klarna-ceo-says-ai-helped-company-shrink-workforce-by-40percent.html) [F] |
| 18 May | Capital One completes the Discover deal | VERIFIED — [SEC 8-K](https://www.sec.gov/Archives/edgar/data/927628/000119312525122059/d934475dex991.htm) [F] |
| 5 Jun | **Circle IPO**: +168% on day one | VERIFIED — [IPOScoop](https://www.iposcoop.com/the-ipo-buzz-circle-internet-group-prices-upsized-ipo-at-31-3-above-range/) [F] |
| 12 Jun | **Chime IPO** (~$11.6bn, vs a $25bn peak in 2021) | VERIFIED [S] |
| 16 Jun | Brazil's **Pix Automático** (recurring payments) launches | VERIFIED [F] |
| 25 Jun | **Ethiopia opens banking to foreign banks** for the first time since 1974 | REPORTED — [TechCabal](https://techcabal.com/2025/06/26/ethiopia-opens-banking-sector-to-foreign-investors/) [F] |
| 4 Jul | CFPB funding cap cut from 12% to 6.5% of Fed operating expenses (−46%) | VERIFIED — [CNBC](https://www.cnbc.com/2025/07/09/trump-big-beautiful-bill-slashes-cfpb-funding-what-it-means.html) [F] |
| 8 Jul | **Monzo** fined £21.1m for financial-crime control failures | VERIFIED — [FCA](https://www.fca.org.uk/news/press-releases/fca-fines-monzo-21m-failings-financial-crime-controls) [F] |
| 15 Jul | US **Section 301** probe into Brazil's "government-developed electronic payment services" (widely read as targeting Pix) | VERIFIED — [Federal Register](https://www.govinfo.gov/content/pkg/FR-2025-07-18/pdf/2025-13498.pdf) [F] |
| 18 Jul | **GENIUS Act** signed (US stablecoin law) | VERIFIED — [CRS](https://www.everycrsreport.com/files/2026-08-20_IN12553_0b329134f6be0cc12f78017358552f4053d52c5e.html) [F] |
| 1 Aug | UK Supreme Court motor-finance ruling. The FCA redress scheme is costed at ≥£9bn, up to £18bn | VERIFIED — [FCA](https://www.fca.org.uk/news/press-releases/fca-consult-motor-finance-compensation-scheme) [F] |
| 7 Aug | **Debanking executive order** (EO 14331) | VERIFIED — [White House](https://www.whitehouse.gov/presidential-actions/2025/08/guaranteeing-fair-banking-for-all-americans/) [F] |
| 13 Aug | **New York AG sues Zelle's operator**, alleging >$1bn in scam losses | VERIFIED — [NY AG](https://ag.ny.gov/press-release/2025/attorney-general-james-sues-company-behind-zelle-enabling-widespread-fraud) [F] |
| late Aug | **PayPal fraud-filter failure**: German banks block PayPal direct debits | REPORTED/DISPUTED amount — [heise](https://www.heise.de/en/news/Paypal-German-banks-apparently-blocked-payments-of-billions-of-euros-10622936.html) [F] |
| 10 Sep–Oct | **Tricolor** liquidation and **First Brands** bankruptcy (up to $2.3bn of unpaid loans). JPMorgan $170m charge; Zions and Western Alliance disclose loan fraud | VERIFIED — [Banking Dive](https://www.bankingdive.com/news/jpmorgan-dimon-tricolor-chargeoff-earnings/802740/) [F]; [AML Intelligence](https://www.amlintelligence.com/2025/10/news-us-banking-stocks-hit-after-two-lenders-reveal-fraud-disclosures/) [F] |
| 10 Sep | **Klarna IPO** (~$15.2bn, vs $45bn in 2021) | VERIFIED — [The Paypers](https://thepaypers.com/payments/news/klarna-raises-usd-137-billion-in-us-ipo) [F] |
| 16 Sep | **Google AP2** agent-payments protocol (60+ partners) | VERIFIED — [Google](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol) [F] |
| 9 Oct | **FSB**: the G20 2027 cross-border payment targets are "unlikely" to be met | VERIFIED — [FSB](https://www.fsb.org/uploads/P091025-1.pdf) [F] |
| 14 Oct | US sanctions 146 **Prince Group** scam-network targets; cuts Huione off from the US financial system | VERIFIED — [Treasury](https://home.treasury.gov/news/press-releases/sb0278) [F] |
| 24 Oct | **Nigeria and South Africa removed from the FATF grey list** | VERIFIED — [Al Jazeera](https://www.aljazeera.com/news/2025/10/24/four-african-countries-taken-off-global-money-laundering-grey-list) [F] |
| 27–28 Oct | PayPal joins Mastercard Agent Pay and adopts OpenAI's ACP | VERIFIED — [PayPal](https://newsroom.paypal-corp.com/2025-10-28-OpenAI-and-PayPal-Team-Up-to-Power-Instant-Checkout-and-Agentic-Commerce-in-ChatGPT) [F] |
| 30 Oct | ECB moves the **digital euro** to its next phase (possible issuance in 2029) | VERIFIED — [ECB](https://www.ecb.europa.eu/press/pr/date/2025/html/ecb.pr251030~8c5b5beef0.en.html) [F] |
| 18 Nov | **Wero** e-commerce goes live in Germany | VERIFIED — [Mobiflip](https://www.mobiflip.de/wero-startet-im-onlinehandel-wer-mitmacht-und-wie-der-kaeuferschutz-funktioniert/) [F] |
| 22 Nov | **SWIFT** MT/MX coexistence ends (ISO 20022) | VERIFIED (single industry source) [F] |
| 24 Nov | **Revolut** valued at $75bn | VERIFIED — [RTÉ](https://www.rte.ie/news/business/2025/1124/1545556-revolut-valued-at-75-billion) [F] |
| 25 Nov | eSLR loosened (~$13bn of tier 1 capital freed) | VERIFIED — [FDIC](https://www.fdic.gov/news/speeches/2025/final-rule-modify-enhanced-supplementary-leverage-ratio) [F] |
| 27 Nov | **EU PSD3/PSR provisional deal**: payment firms liable for weak fraud controls; payee name/IBAN must match; refunds for bank-impersonation scams; **online platforms liable to PSPs** | VERIFIED — [European Parliament](https://www.europarl.europa.eu/news/en/press-room/20251121IPR31540/payment-services-deal-more-protection-from-online-fraud-and-hidden-fees) [F] |
| 10 Dec | OCC finds all 9 largest US banks restricted lawful industries in 2020–23 | VERIFIED — [OCC](https://www.occ.gov/news-issuances/news-releases/2025/nr-occ-2025-123.html) [F] |
| 12 Dec | OCC conditional trust charters for Circle, Ripple, BitGo, Fidelity Digital Assets and Paxos | VERIFIED — [The Block](https://www.theblock.co/post/382379/ripple-bitgo-and-paxos-secure-conditional-approval-for-us-banking-charters) [F] |

#### B. Why it happened

1. **US politics, not new evidence, drove the reversal.** INTERPRETATION.
   - The harms the 2024 rules targeted (junk fees, P2P scams, data portability, nonbank supervision) were not disproved; the policy direction changed.
   - Enforcement moved to the states: the New York AG's Zelle suit.
2. **The US government chose stablecoins as a dollar-dominance and Treasury-demand strategy.** VERIFIED — [White House](https://www.whitehouse.gov/fact-sheets/2025/07/fact-sheet-president-donald-j-trump-signs-genius-act-into-law/) [F].
   - GENIUS bans *issuers* from paying interest but does not stop exchanges from paying yield. This pushes the economics toward distribution platforms.
3. **Europe pushed in the opposite direction.**
   - Fraud in the EEA rose to **€4.2bn** in 2024, and users bore **~85% of credit-transfer fraud** — [ECB/EBA](https://www.ecb.europa.eu/press/pr/date/2025/html/ecb.pr251215~e133d9d683.en.html) [F].
   - The EU responded by making PSPs and platforms liable, and by building sovereign rails (Wero, digital euro) to reduce dependence on US networks.
4. **Bank stress shifted from liabilities to assets.**
   - INTERPRETATION: the 2025 losses (Tricolor, First Brands, Zions, Western Alliance) came from fake or double-pledged collateral and receivables. That is a *data-verification* failure, not a capital shortfall.

#### C. Fraud and customer harm in 2025

- **US:** FTC: **$12.5bn** lost in 2024 (+25%), and the share of people reporting who actually lost money rose from 27% to 38% — [FTC](https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024) [F].
- **US (IC3, 2025 data, published 2026):** **$20.9bn** (+26%), including **$893m from AI-related complaints** — [IC3 2025](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf) [F].
- **UK:** 2024 losses £1.17bn; APP fraud £450.7m (−2%) — [UK Finance](https://www.ukfinance.org.uk/news-and-insight/press-release/fraud-report-2025-press-release) [F].
  - The first year of mandatory reimbursement returned **88%** of claimed losses (£112m in 9 months).
  - **71% of victims did not know the policy existed** — [PSR](https://www.psr.org.uk/news-and-updates/latest-news/news/one-year-on-impact-of-app-reimbursement-on-victims/) [F].
- **Synapse:**
  - The CFPB obtained a $1 penalty so that victims could be paid from its Civil Penalty Fund. A reported **$46.2m** was allocated, below the $60–95m shortfall [S]. The bankruptcy case was dismissed in November.
  - The FDIC's post-Synapse rule on custodial-account recordkeeping was **not finalised** [S].
- **Nigeria:** between March and August 2025 the consumer regulator (FCCPC) logged **3,173 banking complaints (the top sector) and 1,442 fintech complaints**, and recovered ₦10bn+. It flagged loan apps costing ~198% a year — [Nairametrics](https://nairametrics.com/2025/09/11/fccpc-recovers-n10-billion-for-aggrieved-customers-following-complaints-against-banks-fintech-others/) [F].

#### D. Inclusion and Africa in 2025

- **Global Findex 2025 (survey year 2024)** — [Little Data Book](https://thedocs.worldbank.org/en/doc/be6615202d1f08a25855c8ac2d615122-0050012025/related/Little-Data-Book-2025-Web.pdf) [F]:
  - Global: **79%** of adults have an account.
  - **Nigeria: 63.3%** (up from 45.3% in 2021); women 52.2%.
  - Kenya 90.1%; Egypt 43.1%; Ethiopia 48.8%; South Africa 81.1% (*down* from 85.4%).
- **Mobile money (GSMA, 2024 data):** 2.1bn accounts, $1.68tn processed; ~80% of providers EBITDA-positive — [GSMA](https://www.gsma.com/sotir/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf) [F].
- **Nigeria's NIBSS Instant Payment (NIP) system** — [AfricaNenda](https://africanenda.org/wp-content/uploads/siips_2025_NIP-Nigeria_CaseStudy_en.pdf) [F]:
  - 11bn transactions in 2024 (from 2bn in 2020).
  - 57.7m unique users, 52% of adults.
  - **Men make 69% of the volume.**
- **African fintech funding:** equity fell **43%**, to $769m; total tech funding was propped up by debt — [Partech](https://partechpartners.com/africa-reports/2025-africa-tech-venture-capital-report) [F].
- **Cybercrime:** INTERPOL says cybercrime is **more than 30% of reported crime** in West and East Africa. Operation Serengeti 2.0 made 1,209 arrests — [INTERPOL](https://www.interpol.int/en/News-and-Events/News/2025/New-INTERPOL-report-warns-of-sharp-rise-in-cybercrime-in-Africa) [F].

#### E. AI in 2025

- **JPMorgan** topped the Evident AI Index for the fourth year running — [JPMC](https://www.jpmorganchase.com/about/technology/news/jpmc-evident-25) [F].
- **Commonwealth Bank** cut 45 roles for a voice bot, then reversed the cut and admitted an "error" — [ACS](https://ia.acs.org.au/article/2025/cba-reverses-ai-driven-job-cuts--admits--error-.html) [F].
- **Klarna's** headcount fell from 5,527 to 3,422 (Dec 2022 → Dec 2024), but it rehired humans to fix service quality.
  - INTERPRETATION: AI cost-cutting in customer contact hits a quality ceiling quickly.
- **Bank of England (Financial Policy Committee):** flagged herding, common-model and provider-concentration risk — [BoE](https://www.bankofengland.co.uk/financial-stability-in-focus/2025/april-2025) [F].

#### F. 2025 for PayPal (detail in §4)

- **Agentic commerce:** became PayPal's central strategic bet (AP2, ACP, Agent Pay).
- **German direct-debit incident:** showed that one wallet's fraud-control failure can trigger countermeasures across the banking system.
  - The bank groups that blocked PayPal's debits (Sparkassen, Volksbanken) were the same ones launching **Wero** against PayPal in Germany three months later.
- **Regulation:** the Congressional Review Act repeal removed routine CFPB supervision of PayPal and Venmo. UDAAP exposure and state-AG exposure remain.

---

### 2.4 — 2026 (1 Jan – 5 Nov): Charters, stablecoin rules, a rate hike and a reality check

**In one sentence:** a war in the Middle East and an energy shock pushed the Fed, under its new chair, into its first rate hike since 2023. Meanwhile, fintechs rushed to become banks, the US built stablecoin rules but could not pass market-structure law, agentic commerce met reality, fraud kept rising, and PayPal fired its CEO.

**What we checked ourselves.** Several 2026 facts were checked directly against primary documents during synthesis, not just taken from the research agents:

- The **FOMC statement of 28 Oct 2026**: rates held at 3.75–4.00% on a 10–2 vote, with Cook and Hammack preferring a hike — [Fed PDF](https://www.federalreserve.gov/monetarypolicy/files/monetary20261028a1.pdf) [F].
- **PayPal's 3 Feb 2026 release** appointing Enrique Lores as CEO — [PayPal newsroom](https://newsroom.paypal-corp.com/2026-02-03-PayPal-Appoints-Enrique-Lores-as-Chief-Executive-Officer-and-David-W-Dorman-as-Independent-Board-Chair) [F].
- **Banking Dive's reporting of the $53bn Stripe/Advent bid**, which itself cites Reuters — [Banking Dive](https://www.bankingdive.com/news/how-paypal-may-benefit-stripe-advent-53-billion-offer-venmo/825316/) [F]. The bid and its withdrawal remain REPORTED: there is no PayPal filing about it.

#### A. Month-by-month index (condensed; full index in `slices/y2026.md`)

| Month | Key events |
|---|---|
| **Jan** | **PayPal returns to Nigeria via Paga** for inbound payments (27 Jan) [F]. Kenya's central bank says an M-Pesa failure would "significantly impair the real economy"; M-Pesa moved KES 83.7trn, about 4× GDP, in 2025 [F]. OCC gives Nubank conditional approval [F]. First US bank failure of the year [F]. Flutterwave buys Mono [F]. |
| **Feb** | **PayPal removes CEO Chriss** and withdraws its 2027 targets (2–3 Feb) [F]. Only 20 of 33 Nigerian banks have met the recapitalisation target so far [F]. |
| **Mar** | Military strikes on Iran; state regulators warn banks of cyber risk [F]. **US Basel III re-proposal** cuts standardized CET1 requirements by about 4.8–6.4% (19 Mar) [F]. **OpenAI scales back ChatGPT Instant Checkout** (24 Mar) [F]. FCA sets UK motor-finance redress at £7.5bn [F]. CFPB files a plan to cut to 556 staff [F]. CFPB reports **6.6m complaints for 2025** [F]. PYUSD launches in 70 markets [F]. Revolut receives its full UK banking licence (11 Mar) [F, secondary]. |
| **Apr** | CBN: all 33 banks complied with recapitalisation (₦4.65trn raised) [F]. Iran-linked group allegedly breaches **Chime** [F]. Amex launches Agent Purchase Protection [S]. Kansas City Fed researcher finds **<1% of stablecoins are used for payments** [F]. EU Council publishes final PSD3/PSR compromise texts [F]. PayPal splits into three business units [F]. |
| **May** | Fed considers supervisory risks from Anthropic's "Mythos" vulnerability-finding model [F]. Warsh confirmed as Fed chair, 54–45 [S]. Executive order seeks fintech access to Fed payment rails [F]. UK ombudsman complaints fall 30% [F]. |
| **Jun** | UK Finance: **APP fraud +19% to £576m** in 2025 [F]. Fed stress test: all 32 banks pass [F]. BCG/FT Partners: fintech revenue reached $504bn in 2025 [F]. Nuvei buys Payoneer for $2.75bn [F]. |
| **Jul** | PSR: mandatory reimbursement cut in-scope APP losses by about £73m a year [F]. European Parliament backs a digital-euro mandate, 416–169 [F]. **Stripe and Advent bid ~$53bn for PayPal** [F, reported]. OCC **denies Wise's** trust-charter application over AML [F]. Circle receives a full trust charter [F]. |
| **Aug** | CFPB stops publishing complaint narratives [F]. Stripe/Advent bid reportedly abandoned [F, citing Bloomberg]. Klarna returns to net profit [F]. |
| **Sep** | EMVCo publishes a draft agentic-payments framework [F]. 21 banks back a consortium stablecoin [F]. **CLARITY Act fails cloture 49–50** [F]. **Fed hikes to 3.75–4.00%** (16 Sep) [F]. Fed proposes GENIUS Act rules [F]. Nano Banc fails [F]. Chime buys its partner bank, Stride [F]. Revolut receives a conditional US charter [F]. |
| **Oct** | ICBA sues the OCC over trust charters [F]. **OCC fines Amex $350m** over AML [F]. EBA names USDC the first significant EMT under MiCA [F]. **OCC issues its final GENIUS rule** (21 Oct) [F]. CBN gives JPMorgan approval-in-principle for a Nigerian merchant bank [F]. **8th Circuit vacates the Fed's debit-interchange cap** [F]. Wero goes live for e-commerce in the Netherlands [F]. PayPal Q3: revenue +2% [F]. FOMC holds rates, 10–2 [F]. **Binance hit by a DPRK-attributed theft of about $6.4bn (29 Oct)** — REPORTED by the fraud slice, not independently verified here. |
| **Early Nov** | Democrats win Congress (3 Nov) [F]. **Block agrees a $964m DOJ AML resolution** (4 Nov) [F]. Fiserv cuts 3,000 jobs [F]. Bank of Ghana flags 20 unlicensed loan apps [F]. |

#### B. What it means

1. **Macro regime change.**
   - The ECB's May financial stability review cites war in the Middle East, disrupted shipping through Hormuz, and earlier shocks: Greenland, Venezuela, tariff litigation — [ECB FSR](https://www.ecb.europa.eu/press/financial-stability-publications/fsr/html/ecb.fsr202605~50566915a7.en.html) [F].
   - Fed projections push the return to 2% inflation out to 2029.
   - INTERPRETATION: banks benefit from higher margins (Q2 NIM 3.32%), but unrealised securities losses persist ($326.7bn) and leveraged borrowers are squeezed.
2. **US banks: slow erosion, not crisis.**
   - Six small failures through 25 Sep, up from two a year in 2024 and 2025.
   - Q2: net income $90.1bn, 47 problem banks — [FDIC QBP Q2](https://www.fdic.gov/news/speeches/2026/fdic-quarterly-banking-profile-second-quarter-2026) [F].
   - Weak spots in household credit: student-loan 90-day+ delinquency at 10.6%, and subprime auto — [NY Fed](https://www.newyorkfed.org/medialibrary/interactives/householdcredit/data/pdf/HHDC_2026Q2.pdf) [F].
   - **Private credit** is the main unmeasured risk. ESAs, FSB and ECB all warn about it, but there is no verified data on banks' exposure.
3. **The bank charter becomes the strategic asset.** American Banker's 2026 tracker lists 30+ fintech charter filings and decisions — [American Banker](https://www.americanbanker.com/news/fintechs-asking-for-and-receiving-bank-charters-in-2026) [F].
   - **Approved:** Nubank, Coinbase, Mercury, Revolut (conditional); Circle and Ripple (final).
   - **Rejected:** Wise and Bunq.
   - **Bought instead:** Chime acquired its partner bank (Stride).
   - **Nigeria shows the same pattern:** Paystack, Flutterwave and Moniepoint are acquiring microfinance licences or restructuring toward bank-like licences.
   - INTERPRETATION: renting a partner bank's charter (BaaS) is giving way to owning one. This is the industry's structural answer to Synapse.
4. **Stablecoin rules are only half built.**
   - The OCC's final GENIUS rule takes effect **18 Jan 2027** — [WilmerHale](https://www.wilmerhale.com/en/insights/client-alerts/20261027-occ-finalizes-genius-act-rule-for-permitted-payment-stablecoin-issuers-easing-several-key-proposed-requirements-and-raising-new-issues) [F].
   - CLARITY failed over stablecoin "rewards" (yield) — [American Banker](https://www.americanbanker.com/news/crypto-market-structure-bill-fails-in-senate-vote-49-50) [F].
   - Retail payment use remains under 1% — [Banking Dive](https://www.bankingdive.com/news/stablecoins-remain-little-used-for-payments/817522/) [F].
   - INTERPRETATION: banks are answering with tokenized deposits and a 21-bank consortium coin. Stablecoin *yield* is now the central fault line between banks and fintechs.
5. **Agentic commerce reality check.**
   - ChatGPT Instant Checkout was scaled back, and OpenAI said it "did not offer the level of flexibility that we aspire to provide" — [MacRumors](https://macrumors.com/2026/03/25/chatgpt-revamps-shopping-features) [F].
   - Liability rules do not exist. Early Warning's CEO says agentic commerce "steamrolled ahead" without them — [Payments Dive](https://www.paymentsdive.com/news/liability-looms-over-ai-shopping/872979/) [F].
   - PayPal's own CEO expects agent-driven commerce in 2026–27 to be "relatively small" — [Payments Dive](https://www.paymentsdive.com/news/paypal-isnt-agile-enough-ceo-says/833449/) [F].
6. **The CFPB is close to dormant but legally alive.**
   - One public enforcement action between Jul 2025 and Jun 2026. A plan to cut to 556 staff — [GovExec](https://www.govexec.com/workforce/2026/04/consumer-watchdog-agency-asks-court-permission-slash-its-workforce-two-thirds/412598/) [F].
   - Complaint narratives are no longer published — [CFPB](https://www.consumerfinance.gov/about-us/newsroom/the-cfpb-to-cease-discretionary-publication-of-complaint-narratives-and-visualizations/) [F].
   - Courts have rejected the administration's funding theory [S].
   - The 3 Nov midterms may reverse the direction from 2027 (INTERPRETATION).
   - **AML enforcement continued even as consumer enforcement collapsed:** Amex $350m, Block $964m.
7. **Fraud is still rising and increasingly AI-assisted.**
   - **IC3 2025: $20.9bn** (+26%), including crypto-investment fraud $7.2bn and victims aged 60+ $7.7bn — [IC3](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf) [F].
   - The CFPB attributes part of its complaint surge to LLMs and "AI Agents" filing spurious submissions — [CFPB](https://files.consumerfinance.gov/f/documents/cfpb_2025-cr-annual-report_2026-03.pdf) [F].
8. **Card economics are reopened.**
   - The debit-interchange cap was vacated — [Payments Dive](https://www.paymentsdive.com/news/fed-loses-debit-card-cap-appeal/872785/) [F].
   - "Honor all cards" may end under the pending Visa/Mastercard settlement.
   - UK PSR has issued fee-transparency directions to the card schemes.
   - EU: digital-euro legislation is advancing, and Wero is replacing iDEAL in the Netherlands.
9. **Nigeria consolidates.**
   - Recapitalisation completed (₦4.65trn).
   - Monetary policy rate reset to 23%. Inflation about 15.4%. Reserves **$55.25bn**, an 18-year high — [CBN MPC 164](https://www.cbn.gov.ng/Out/2026/CCD/MPC_Comminique%20No%20164%20Sept%202026%20MPR%20Corridor%20Recalibration.pdf) [F].
   - JPMorgan received approval-in-principle to enter.
   - A draft CBN guide proposes **free transfers under ₦5k** — [TechCabal](https://techcabal.com/2026/04/27/why-transfers-above-%e2%82%a610000-will-cost-%e2%82%a660/) [F].
   - DISPUTED: the status of banks under regulatory intervention.

#### C. How 2026 compares with 2023–2025

| Theme | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| US bank failures | 5 (incl. 3 giant runs; Silvergate wound down voluntarily, so it is not counted) | 2 | 2 | 6 (to 25 Sep), all small |
| Fed policy rate (end) | 5.25–5.50% | 4.25–4.50% | (cuts continued — see slice) | 3.75–4.00% after a **hike** |
| US reported fraud losses (IC3) | $12.5bn | $16.6bn | $20.9bn | (2026 data due 2027) |
| CFPB posture | Proposing | Max rulemaking | Retreat | Near-dormant |
| Stablecoins | Enforcement era; PYUSD launch | Growth | GENIUS Act | Implementing rules; CLARITY fails |
| Fintech model | Funding crash | BaaS collapse | IPOs at reset valuations | Charter rush |
| Agentic commerce | — | — | Launch wave | Reality check |
| Nigeria | Cash crunch, float | Devaluation, freezes, recap order | FATF exit, stabilisation | Recap done, reserves high |

The 2023 US failure count (5) needs a source and caveats:

- The five are Silicon Valley Bank, Signature, First Republic, Heartland Tri-State and Citizens Bank (Sac City). Source: the FDIC Failed Bank List, cited in the y2024 slice. The y2023 slice covers only the three large failures, so the other two are counted from that list alone.
- Silvergate wound down voluntarily and is not counted.
- The 2025 year-end Fed funds rate was not captured in the slices, which is why that cell refers back to the slice.

## 3. The banking industry as a whole, by theme, 2023–2026

This section follows each theme across all four years and compares regions. Detailed evidence and tables are in the companion slice reports: `ai_competition.md`, `payments_inclusion.md`, `fraud_cyber.md`, `customers.md`, plus the gap-fill reports.

### 3.1 Stability, liquidity and solvency

| | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| Nature of stress | Deposit runs moving at app speed (SVB, Signature, First Republic, Credit Suisse) | Unrealised losses and CRE (NYCB, Republic First) | Fraud in private and asset-based credit (Tricolor, First Brands, Zions, Western Alliance) | Small idiosyncratic failures; private-credit opacity; a rate-hike regime driven by the energy shock |
| US unrealised securities losses | $515bn–$684bn | $482bn (Q4) | — | $326.7bn (Q2) |
| US bank net income | $256.9bn | ~$268bn [S] | **$295.6bn** (record) | Q2 $90.1bn |
| Policy response | Emergency backstops, special assessment, Basel tightening proposal | Basel re-proposal stalls | Deregulation: eSLR, reputational risk removed, fast M&A approvals | Softer Basel re-proposal; stress-test buffers averaged |

Sources: FDIC Quarterly Banking Profile [F]; Fed [F]; [FDIC 2025 annual results](https://fdic.gov/news/press-releases/2026/fdic-insured-institutions-reported-return-assets-124-percent-and-net) [F].

**Findings**

- **Profits.** Banks earned record profits through the whole period.
  - Global bank net income was about $1.2tn in 2024 and about $1.3tn in 2025 (McKinsey, via [finews](https://www.finews.com/news/english-news/69854-mckinsey-bankstudie-2025-ki-gewinne-strategie-2) [F]).
  - Net interest margins did not collapse when rates were cut. The US NIM was 3.39% in Q4 2025; the EU NIM was 1.63% in June 2026 ([EBA](https://www.eba.europa.eu/sites/default/files/2026-09/26394108-1837-4b5b-bce2-fba1d3c574b1/EBA%20Dashboard%20-%20Q2%202026.pdf) [F]). VERIFIED.
- **How the risk moved (INTERPRETATION).**
  - The 2023 risk was a liability problem: how fast deposits could leave.
  - The 2025–26 risk is an asset-verification problem: collateral pledged twice, forged title insurance, and opaque private credit.
  - Both are information problems more than capital problems.
- **Concentration.** Big banks got bigger.
  - JPMorgan's net income was $49.6bn, then $58.5bn, then $57.0bn, and it has been #1 in US retail deposits for six straight years [F].
  - In 2025 US bank mergers closed in about 4 months, the fastest since 1990 [F].
- **Regional differences.**
  - **EU banks** are well capitalised (CET1 16.1%) but carry rigid costs: cost-to-income has stayed around 51–53% [F].
  - **Nigeria:** banks earned FX-revaluation windfalls of about ₦3.3tn in 2023 [F]. The government then imposed a **70% windfall levy** on realised FX gains for 2023–25 [F]. Banks then had to recapitalise (₦4.65tn raised by Mar 2026) [F].
  - **Ghana:** the domestic debt exchange left bank NPLs at 24% [F].
  - **Kenya:** NPLs stood at 16.5% [F].
  - **Egypt:** after the 2024 devaluation, banks report high returns. Bank ROE is above 20% according to Fitch, and the CBE reports an NPL ratio of 2.2% (search summaries, [Ahram](https://english.ahram.org.eg/NewsContent/3/12/564727/Business/Economy/Egyptian-banks-post-strong-financial-soundness-in-.aspx) [S]).

### 3.2 Fraud, financial crime and cybersecurity

**US reported fraud losses**

| | 2023 | 2024 | 2025 |
|---|---|---|---|
| FBI IC3 | $12.5bn | $16.6bn | $20.9bn |
| FTC | >$10bn | $12.5bn | $15.9bn |

Sources: [IC3](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf) [F]; [FTC testimony](https://www.ftc.gov/system/files/ftc_gov/pdf/ftc-testimony-jec-hearing-on-the-rising-scam-economy.pdf) [F].

- **The number of victims is roughly flat while losses keep climbing.** FTC report counts were 2.6m, 2.6m, then 3.0m. So the money lost per victim is rising.
- **The FTC estimates that once under-reporting is adjusted for, 2024 fraud could reach $195.9bn** [F].

**The UK: refunds work, but they have not stopped the fraud**

- Mandatory reimbursement has returned 88% (£316m) of in-scope losses.
- Fraud complaints to the ombudsman fell 14%.
- Even so, APP fraud rose 19% to **£576m** in 2025, and 66% of cases start online [F].

**The EU: victims carry most of the loss**

- Users bear about **85%** of credit-transfer fraud losses [F].
- PSD3/PSR now shifts liability onto PSPs and online platforms (deal in 2025; legal application around 2027–28).

**Africa**

| | 2023 | 2024 | 2025 |
|---|---|---|---|
| Nigeria (NIBSS) fraud losses | ₦17.7bn | ₦52.3bn | ₦25.9bn |
| South Africa digital-banking fraud claims | R1.09bn | — | R2.41bn |
| Ghana mobile-money fraud cases | — | — | +54% |

Sources: [NIBSS](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [F]; [SABRIC](http://www.sabric.co.za/wp-content/uploads/2026/08/SABRIC-Annual-Crime-Statistics-Report-2025.pdf) [F]; [Bank of Ghana](https://www.bog.gov.gh/wp-content/uploads/2026/07/FRAUD-REPORT-2025.pdf) [F].

- Nigeria's 2024 figure was inflated by a single ₦31.1bn incident.
- Nigeria's fraud *reporting* fell 34% in Q4 2025, so the 2025 drop may partly reflect less reporting.

**Organised crime**

- **Scam compounds industrialised.**
  - In 2023, victims in East and Southeast Asia lost an estimated $18–37bn ([UNODC](https://www.unodc.org/roseap/uploads/documents/Publications/2024/TOC_Convergence_Report_2024.pdf) [F]).
  - In 2025, enforcement against the Prince Group included a filing to forfeit 127,271 BTC (about $15bn) [F].
  - **The model is spreading to Africa.** A Lagos raid in December 2024 led to 792 arrests [F]. INTERPOL reports that 72% of African countries it surveyed have scam centres [F].
- **North Korean crypto theft escalated:** Bybit lost $1.5bn (2025), then Binance lost about $6.4bn (29 Oct 2026; REPORTED, amount disputed) [F].

**AI and fraud**

- 2024: deepfake alerts (FinCEN), and Arup lost $25m to a deepfake video call.
- 2025: IC3 recorded $893m in AI-related losses.
- 2026: INTERPOL says AI is linked to 55% of reported African cybercrime [F].

**AML enforcement**

- In the US, consumer enforcement collapsed in 2025–26 but **AML enforcement never stopped**:
  - TD Bank, $3.09bn (2024)
  - Amex, $350m (Oct 2026)
  - Bank of America, $1.2bn (Oct 2026, via BBC [F])
  - Block, $964m (Nov 2026)
- The exception ran the other way: Binance's founder (CZ) was pardoned in October 2025 [F].

**Outages became a consumer-harm category in their own right**

- UK: 158 incidents and 803+ hours of outages at nine banks between January 2023 and February 2025 ([Treasury Committee via BBC](https://www.bbc.co.uk/news/articles/cjd3yzx3xgvo) [F]).
- CrowdStrike (July 2024).
- AWS (October 2025) and Google Cloud (October 2026) outages [F].
- Kenya's central bank classes M-Pesa as a single point of failure for the whole economy [F].

### 3.3 Payment infrastructure, instant and cross-border payments

| Rail | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| UPI (India), transactions | 117.6bn | 172.2bn | ~228bn | 25.5bn in Oct alone |
| Pix (Brazil), September volume | 3.35bn | 4.90bn | 6.13bn | 7.17bn; person-to-business share 46.5% |
| FedNow (US) | 47k (launch) | 1.5m | 8.4m | 14.1m in Q1–Q3; average payment ~$58k |
| SEPA Instant, share of euro transfers | 11% | — | 23% | 25% |
| Nigeria NIP (NIBSS Instant Payment) | — | 11bn per year | Q1: ₦285tn | — |
| African instant payment systems (IPS) | — | 64.6bn transactions, $1.98tn | 33 domestic systems | only 11 of 36 cross-border |

Sources: [BCB](https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/EstatisticasTransacoesPix) [F]; [FRB Services](https://www.frbservices.org/resources/financial-services/fednow/quarterly-volume-value-stats) [F]; [AfricaNenda](https://africanenda.org/wp-content/uploads/siips_2025_ExecutiveSummary_en.pdf) [F]; NPCI via press [F].

- **Cross-border payments are the unsolved half.**
  - The global average cost of sending $200 was **6.3% (2023), 6.4% (2024) and 6.5% (2025)**. Sub-Saharan Africa is the most expensive region, at about 8.5–8.8%.
  - The FSB itself says the G20's 2027 targets are "unlikely" to be met ([FSB](https://www.fsb.org/uploads/P091025-1.pdf) [F]).
  - Nigerian participants sent only **$143m** through PAPSS in 2025 [F].
- **Stablecoins grew, then stalled.**
  - USD stablecoin supply went $130bn (end-2023), $204bn (end-2024), **$304bn** (end-2025), then about $295bn (Nov 2026).
  - Fewer than 1% of stablecoins are used for payments (Kansas City Fed researcher) [F].
- **CBDCs mostly failed to catch on.**
  - Only three retail CBDCs are live, and the eNaira is effectively dormant.
  - China's e-CNY is the exception.
  - The digital euro is aiming for a 2029 launch [F].
- **Public rails are starting to charge.** Egypt's InstaPay began charging fees in April 2025, and India plans a UPI merchant discount rate (MDR) that has so far been deferred [F].
  - INTERPRETATION: "free" public rails still need a revenue model.

### 3.4 Regulation, enforcement and litigation

**US**

- **The arc:** proposals (2023), then the most rules ever written (2024), then repeal and retreat (2025), then a near-dormant CFPB, a charter wave and stablecoin rules (2026).
- **The states stepped into the gap:** New York's suit against Zelle's operator, and 46 attorneys general locking in Cash App's redress [F].
- **Debanking was reframed.** It was once treated as AML de-risking; it is now treated as political discrimination (an executive order in 2025 and OCC findings in 2026). DISPUTED framing.

**UK**

- The Consumer Duty took effect (2023), APP reimbursement became mandatory (2024), and motor-finance redress was set at **£7.5bn** (2026).
- The payments regulator (PSR) is being folded into the FCA.
- From 28 April 2026, banks must give **90 days' notice and a specific written reason before closing an account** ([SI 2025/688](https://www.legislation.gov.uk/uksi/2025/688/made) [F]).
- A new BNPL regime started on 15 July 2026 [F].

**EU**

- MiCA (crypto) and the Instant Payments Regulation, including Verification of Payee from 9 October 2025.
- DORA (2025), AMLA, and PSD3/PSR (political deal 2025; final texts 2026; application around 2027–28).
- The digital euro mandate (2026).

**Nigeria**

- The policy approach shifted from blunt bans to conduct rules:
  - 2024 measures: onboarding freezes, a levy withdrawn after 11 days, account freezes.
  - 2025–26 measures: draft rules for APP-fraud reimbursement (16-working-day resolution, 50:50 split between sending and receiving firms), the FCCPC digital-lending (DEON) rules upheld in court (July 2026), agent geo-fencing, and a draft guide to charges [F].
- The country left the FATF grey list in October 2025 [F].

### 3.5 AI adoption, automation and operational inefficiency

**Adoption is speeding up and concentrating in the largest banks**

- In Evident's 2026 AI index, North America holds 8 of the top 10, deployment runs about 3× faster, and **no African, LatAm or Indian banks are covered** [F].
- Only 12 of 50 large banks quantify the return on their AI spending [F].

**Labour substitution is real but disputed**

- Block cut more than 40% of staff, citing "intelligence tools" (2026, [Block letter](https://www.sec.gov/Archives/edgar/data/1512673/000119312526076557/d108590dex991.htm) [F]).
- Other job cuts: Standard Chartered ~7,800, Amex ~3,500, Fiserv 3,000 [F].
- Reversals:
  - Klarna partly rehired humans (2025).
  - The Commonwealth Bank of Australia (CBA) reversed AI-driven cuts and admitted an "error" (2025) [F].
- The CFPB's 2023 report on chatbot "doom loops", and the 24/7 live-support requirement in its Cash App order, show the legal limit on fully automated customer service [F].

**New AI risks**

- The CFPB says LLM-driven and AI-agent "spurious submissions" are flooding its complaint system [F].
- Anthropic's "Mythos" model has prompted supervisory concern about cyber-offence capability [F].
- One member of Congress has warned of an "agentic AI bank run" [F].
- AI provider concentration: three providers supply 73% of UK firms' cloud [F].

**Legacy cost**

- EU cost-to-income has stayed at about 51–53% since 2023.
- Nubank's efficiency ratio is **19.9%** [F]. That gap is the clearest measure of incumbents' operational inefficiency.

### 3.6 Customers: complaints, frozen funds, disputes, failures

**CFPB complaints doubled every year:** 1.66m (2023), 3.19m (2024), **6.64m** (2025).

- 88% of 2025 complaints were about credit reporting, much of it filed by credit-repair firms and AI agents.
- Money-services complaints rose from 21.8k (2023) to 27.4k (2024) to **102.9k** (2025).
- In money services, the share of complaints closed with monetary relief **fell to 2%** in 2025 [F].
- Source: [CFPB](https://files.consumerfinance.gov/f/documents/cfpb_2025-cr-annual-report_2026-03.pdf) [F].

**Overdraft fees are rising again after the federal rule was repealed.** NCLC reports the 20 largest banks took about $4bn in 2025, up 6.2% on 2023 [F, advocacy source].

**Synapse:** up to **$95m** is still owed. The CFPB has set aside $55.2m with no payout date, and its claims contractor runs to 2028 ([Banking Dive](https://www.bankingdive.com/news/synapse-small-claims-court-evolve-yotta-cfpb-customer-reimbursement/830655/) [F]).

**Nigeria: CBN complaints rose from 15,385 (2023) to 20,925 (2024) to 23,129 (2025)** ([CBN FSR Dec 2025](https://www.cbn.gov.ng/Out/2026/FPRD/FSR%20DECEMBER%202025%20EDITION%20-%20FINAL%201.07.2026.pdf) [F]).

- Failed electronic and card transactions, plus fraud, dominate.
- In H1 2025, **46.6%** of complaints were against non-bank institutions.
- Complaints about excess charges rose 14-fold within a year (78 to 1,089).

**UK ombudsman (FOS):** 214,600 complaints in 2025/26, down 30%. Of the 32,900 about current accounts, 18,900 were about fraud or scams [F].

**Disputes and chargebacks**

- Merchants recover only about 11% of chargeback losses through disputes (Chargebacks911, vendor survey).
- Visa's merchant-monitoring (VAMP) threshold tightens to 1.5% from April 2026 [F/S].

### 3.7 Competition, business models and profitability

**Fintech funding:** KPMG puts it at $113.7bn (2023), $95.6bn (2024), $116bn (2025) and $103.1bn in H1 2026 alone, with **fewer and larger deals** ([KPMG](https://assets.kpmg.com/content/dam/kpmgsites/xx/pdf/2026/08/pulse-of-fintech-h1-2026.pdf) [F]).

**Challengers became very profitable**

- Nubank: $2.87bn profit at a 30% ROE [F].
- Revolut: £1.7bn profit before tax [F].
- Klarna: back to net profit in 2026 [F].

**IPOs reset valuations**

- Chime listed at about $11.6bn, against a $25bn peak.
- Klarna listed at about $15.2bn, against a $45bn peak.
- Circle rose 168% on its first day [F].

**From renting a charter to owning one (2026)**

- 30+ fintech charter filings and decisions in the US; Chime bought its partner bank (Stride).
- In Nigeria, Paystack, Flutterwave and Moniepoint obtained microfinance-bank licences [F].
- INTERPRETATION: this is the industry's structural lesson from Synapse.

**The card duopoly is contested but not broken**

- DOJ v. Visa is pending.
- An amended interchange settlement (which may end "honor all cards") awaits approval.
- The debit-interchange cap was vacated (October 2026).
- In the EU, Apple was forced to open iPhone NFC to other wallets, and Wero has more than 44–52m users [F].

**Stripe is the platform-scale challenger.** TPV is about $1.9tn and its valuation about $159bn. It owns Paystack and Bridge, co-created OpenAI's ACP, and **bid for PayPal** [F/REPORTED].

### 3.8 Financial inclusion and emerging markets

**Account ownership, Global Findex 2025 (survey year 2024)** ([World Bank](https://thedocs.worldbank.org/en/doc/be6615202d1f08a25855c8ac2d615122-0050012025/related/Little-Data-Book-2025-Web.pdf) [F])

| | 2021 | 2024 |
|---|---|---|
| Global | 73.8% | **78.7%** |
| Nigeria | 45.3% | **63.3%** |
| Kenya | — | 90.1% |
| Egypt | — | 43.1% |
| India | — | 89% |
| Ethiopia | — | 48.8% |
| South Africa | 85.4% | 81.1% (fell) |

**Access is not the same as useful access (Nigeria)**

- Women's account ownership is 52.2%.
- Only **9.1%** borrowed formally, while 78.9% borrowed somehow.
- Only 28.5% are financially resilient.
- Men make **69%** of NIP transaction volume and 81% of its value [F].

**Mobile money (GSMA):** 2.1bn accounts and $1.68tn processed. International remittances through mobile money reached $34bn and are the fastest-growing use [F].

**African fintech funding:** equity fell **43%** in 2025, and debt now dominates ([Partech](https://partechpartners.com/africa-reports/2025-africa-tech-venture-capital-report) [F]).

**Markets opening up**

- Ethiopia let in foreign banks (2025).
- JPMorgan received approval in principle for a Nigerian merchant bank (2026).
- PayPal re-entered Nigeria for inbound payments, through Paga (2026) [F].

**Predatory digital lending persists**

- The FCCPC register lists 228 apps on its watchlist and 112 delisted.
- One example loan priced at about **198% APR**.
- The Bank of Ghana flagged 20 unlicensed loan apps (November 2026) [F].

### 3.9 Regional findings from the gap-fill round

These findings come from `slices/gap_africa_me.md` and `slices/gap_asia_latam.md`. All figures were read directly from the sources ([F]); full citations are in those files.

#### Africa and the Middle East

**Interoperability is being forced by regulators.**
- On 30 Sep 2025, the West African central bank (BCEAO) launched PI-SPI, an instant-payment network for the WAEMU region.
- BCEAO then refused to extend its 30 Sep 2026 joining deadline. Wave joined on the last day, and participants rose from 45 to 175.
- Sources: [Launch Base Africa](https://launchbaseafrica.com/2026/10/01/fintech-unicorn-wave-caves-to-regulators-as-bceao-refuses-to-blink-on-west-africas-payment-deadline/).
- INTERPRETATION: this is a model Nigeria and Kenya could follow for wallet interoperability.

**Egypt's InstaPay grew about 25-fold in two years.**
- It went from EGP 112.7bn in its first year (to Mar 2023) to about EGP 2.9trn in 2024.
- Financial inclusion reached 79% in June 2026 ([CBE](https://www.cbe.org.eg/en/financial-inclusion/data-measurement-and-reports)).

**Ghana: transaction taxes suppress digital payments.**
- After the E-Levy was repealed in Apr 2025, mobile-money value rose 50.8%, to GH¢4.54trn ([Ghanaian Times/BoG](https://ghanaiantimes.com.gh/mobile-money-transactions-hit-gh¢4-54trn-in-2025-bog/)). That the repeal *caused* the rise is our interpretation, not a verified causal finding.
- The Bank of Ghana's negative equity reached **GH¢93.8bn** at end-2025, and private-sector NPLs are about 21% ([GNA](https://gna.org.gh/2026/05/bog-records-negative-equity-in-2025-following-ddep/)).
- This compares with Nigeria's 2024 levy, which was withdrawn after 11 days, and Kenya's 2024 Finance Bill.

**South Africa: PayShap is real but held back by bank pricing.**
- It reached 905m cumulative transactions. Its operator, PayInc, admits that bank fees ("over R50 for larger transfers") and inconsistent banking-app experiences slow adoption ([TechCentral](https://techcentral.co.za/three-years-in-payshap-pivots-to-merchants/281687/)).
- Banking-ombud cases rose from **8,521 (2023) to 15,412 (2024)**, driven by fraud ([The Citizen](https://citizen.co.za/business/fraud-complaints-at-the-banking-ombud-nearly-double-in-a-year-as-digital-scams-surge)).

**Nigeria: the 2024 fraud spike was mostly one insider case.**
- About ₦30bn of the ₦52.26bn total came from a single insider case.
- About ₦329m was stolen using static BVN photos, which liveness detection would have blocked ([Biometric Update](https://www.biometricupdate.com/202503/lack-of-liveness-detection-costs-nigerias-financial-institutions-millions-in-fraud)).

**Telecom-backed banks diverge.**
- Nigeria's MoMo payment service bank (MoMo PSB) users fell from 5.3m to 2.8m in 2024.
- In Ethiopia, Telebirr lent 19.5bn birr to 5.65m people.

**Gulf and Israel: authentication and fraud data-sharing rules are being rewritten.**
- The UAE central bank (CBUAE) set a deadline of 31 Mar 2026 to phase out SMS and email one-time passcodes.
- The Bank of Israel enabled fraud data-sharing between banks (Jul 2025).

**African fintech funding trackers disagree.**
- Africa: The Big Deal reports $1.2bn for fintech in 2025, with five firms taking 52%.
- Disrupt Africa reports $694m.
- This is DISPUTED; the methodologies differ.

#### Asia, Latin America and other markets

**India's cyber-fraud losses tripled.**
- They rose from Rs 7,465 crore (2023) to **Rs 22,846 crore (2024)**, +206%, according to an answer given in the Lok Sabha ([Scroll](https://scroll.in/latest/1084796/indians-lost-rs-22845-crore-to-cyber-fraud-in-2024-a-206-rise-from-previous-year-centre)).
- UPI's 30% market-share cap has been deferred three times and now runs to 31 Dec 2026. PhonePe and Google Pay together hold about 85% of UPI volume.

**Asia-Pacific has moved from "the victim pays" to shared scam liability.**
- Singapore: the Shared Responsibility Framework took effect on 16 Dec 2024 ([MAS](https://www.mas.gov.sg/news/media-releases/2024/mas-and-imda-announce-implementation-of-shared-responsibility-framework-from-16-december-2024)).
- Philippines: AFASA, from Jun 2025.
- Australia: the Scams Prevention Framework Act (assent Feb 2025) covers banks, telcos *and platforms*. Its main obligations start on 31 Mar 2027.
- INTERPRETATION: this is the global direction of travel. The US is the outlier.

**Brazil: the largest Pix theft came through a supplier.**
- At least R$800m was stolen through C&M Software, a connectivity vendor, after an insider sold his credentials (Jul 2025) ([BCB vote 105/2025](https://normativos.bcb.gov.br/Votos/BCB/2025105/Voto_do_BC_105_2025.pdf)).
- Pix's refund mechanism (MED) has recovered only **R$1.4bn of R$17.6bn** lost to fraud.

**Vietnam: biometric step-up checks worked.**
- After biometric checks became mandatory on 1 Jul 2024, banks reported fraud cases down 50% and accounts receiving fraud money down 72% within a month. REPORTED.

**China is shrinking its small-bank sector.**
- 43 small banks exited in 2022, 77 in 2023, 204 in 2024 and 184 in Jan–May 2025 ([Yicai](https://www.yicaiglobal.com/news/over-180-micro-small-sized-banks-were-dissolved-merged-in-china-this-year)).

**Korea.**
- Voice-phishing losses exceeded ₩1tn in Jan–Oct 2025. A crackdown then cut cases by about 40%.
- Kakao Pay was found to have shared data on 40.45m customers with Alipay.

**The 2026 rate reversal is global.** These central banks raised rates in 2026:
- RBA to 4.85%.
- BoC to 2.5% (28 Oct).
- BoK to 3.0%.
- BoJ to 1%.
- Sources: [RBA](https://www.rba.gov.au/statistics/cash-rate/), [BoC](https://www.bankofcanada.ca/2026/10/fad-press-release-2026-10-28/).

**Switzerland.** The lasting fallout of the Credit Suisse failure is a proposal for up to $26bn of extra capital for UBS ([Swissinfo](https://www.swissinfo.ch/eng/ubs-faces-$26-billion-capital-demand-from-swiss-bank-reforms/89476033)).

#### US, UK, EU and global research (gap-fill)

Source: `slices/gap_west.md`.

**Why the 2023 runs happened is still DISPUTED.**
- NBER work blames mark-to-market losses of about $2tn plus uninsured leverage (w31048) [F].
- Chicago Fed researchers say concentrated crypto and VC business models better explain which banks ran (WP 2025-04) [F].
- Banks with the most Twitter exposure lost 6.6pp more market value during the SVB run (Cookson et al.) [F].
- US banks' maturity mismatch has more than tripled since the mid-1980s (SF Fed WP 2026-16) [F].

**US scam liability is still unresolved.**
- P2P apps carried $1.86bn of reported fraud losses in 2023 (Consumer Reports testimony to the Senate PSI) [F].
- Zelle publishes no reimbursement policy.
- The Fed's scam tools are voluntary [F].

**GenAI fraud is projected to grow sharply.** Deloitte projects US GenAI-enabled fraud losses rising from $12.3bn (2023) to up to $40bn by 2027. This is a projection. FINRA's 2026 report adds a GenAI section [F].

**Cyber risk is a tail risk.**
- Direct losses to financial firms total about $12bn since 2004, with a median of about $0.4m per incident, but the risk of an extreme loss above $2.5bn is rising (IMF GFSR Apr 2024) [F].
- 65% of financial firms were hit by ransomware in 2024 (Sophos) [F].

**Stablecoin "rewards" are the GENIUS Act loophole.** Brookings names PayPal's PYUSD rewards as an example [F].

**Card-fee regulation is spreading.** Australia banned card surcharges and cut interchange from 1 Oct 2026, and will consult next on mobile wallets and BNPL (RBA) [F]. That is a direct read-across for PayPal-style wallets.

**Cash is declining, but resilience matters.**
- Germany's cash share of transactions fell from 58% to 51% (2021–23).
- 15% of Germans report difficulty accessing cash (Bundesbank) [F].
- The Riksbank advises households to keep SEK 1,000 in cash [F].

**AML failures are now machine failures.** Coinbase Europe was fined €21.5m after configuration faults left 31% of its activity (over €176bn) unmonitored (Central Bank of Ireland) [F].

## 4. PayPal: dedicated investigation (Jan 2023 – 5 Nov 2026)

This chapter is built mainly from PayPal's own SEC filings and from regulator records. The full evidence is in `slices/paypal.md` (150 ledger records, 148 of them read in full) and in `slices/gap_paypal_comp.md`.

### 4.1 The four-year arc

PayPal went from a **growth story** under Schulman, to a **margin story** under Chriss, to a **cost-and-diversification story** under Lores. **Branded checkout, PayPal's most profitable business, was never fixed.**

| Metric | FY2022 | FY2023 | FY2024 | FY2025 | Q3 2026 (YoY) |
|---|---|---|---|---|---|
| Net revenue | $27.5bn | $29.8bn (+8%) | $31.8bn (+7%) | $33.2bn (+4%) | $8.58bn (+2%) |
| Total payment volume (TPV) | $1.357tn | $1.529tn | $1.681tn | $1.794tn | $487.1bn (+6%) |
| Transaction margin dollars (TM$) | $13.8bn | $13.7bn (−1%) | $14.7bn (+7%) | $15.5bn (+6%) | $3.95bn (+2%) |
| Revenue as a share of TPV | 2.03% | 1.95% | 1.89% | 1.85% | 1.76% |
| Active accounts | 435m | 426m | 434m | 439m | 440m (+0.6%) |
| Transaction and credit losses | $1.57bn | $1.68bn | $1.44bn | $1.72bn | $386m |
| Share buybacks | — | $5.0bn | $6.0bn | $6.0bn | $4.5bn in the first nine months |
| Employees (year-end) | ~29,900 | 27,200 | 24,400 | 23,800 | more than 2,000 further cuts |

Sources: PayPal earnings releases and 10-K/10-Q filings on SEC EDGAR [F]. Revenue as a share of TPV is our own calculation from those filings.

**Stock price (end of period):**

| Dec 2022 | Dec 2023 | Dec 2024 | Dec 2025 | Jun 2026 low | Early Nov 2026 |
|---|---|---|---|---|---|
| $71.22 | $61.41 | $85.35 | $58.38 | $43.18 | ~$58–60 |

The stock fell about 18% on 3 February 2026. Source: [Yahoo price API](https://query1.finance.yahoo.com/v8/finance/chart/PYPL?range=5y&interval=1mo) [F].

### 4.2 What happened, year by year

- **2023**
  - Volume grew without profit growth: TPV rose 13% while TM$ fell 1%, because the growth came from low-margin unbranded processing (Braintree).
  - Active accounts fell by 9m.
  - Alex Chriss became CEO in September and Jamie Miller became CFO in November.
  - PYUSD launched in August, and the SEC sent a subpoena about it in November.
  - The German competition authority (Bundeskartellamt) opened a case in January over PayPal's anti-surcharging and "presentation" clauses. It called PayPal "one of the most expensive online payment services" ([Bundeskartellamt](https://bundeskartellamt.de/SharedDocs/Meldung/EN/Pressemitteilungen/2023/23_01_2023_PayPal.html) [F]).
  - A credential-stuffing breach exposed 34,942 users' data.
- **2024**
  - The company called it a "transition year" and cut about 2,500 jobs.
  - Braintree was repriced, which returned TM$ to growth (+7%).
  - It launched Fastlane (guest checkout) and PayPal Everywhere.
  - It partnered with Shopify, Adyen, Fiserv, Global Payments and JPMorgan Payments.
  - The stock peaked at about $85.
  - Investigations disclosed: a CFPB civil investigative demand (CID) on PayPal Credit and an FTC CID.
  - **December: the Honey scandal broke.**
- **2025**
  - The year was framed as "profitable growth".
  - At Investor Day (February) PayPal promised 2027 targets: high-single-digit TM$ growth and low-teens-plus EPS growth.
  - The SEC closed its PYUSD probe with no action.
  - NYDFS fined PayPal $2m for the 2022 breach.
  - PayPal World and Pay with Crypto launched in July.
  - The agentic-commerce partnership wave began: Perplexity, Google/AP2, Mastercard Agent Pay and OpenAI's ACP.
  - **August: the fraud-filter failure in Germany.**
  - A new FTC CID arrived in August.
  - In December PayPal applied for a Utah industrial bank (ILC) charter.
  - It raised guidance twice, then missed in Q4.
- **2026**
  - **2 February: the board removed Chriss**, because "the pace of change and execution was not in line with the Board's expectations".
  - PayPal withdrew its 2027 targets.
  - Lores became CEO on 1 March.
  - The UK FCA opened a Competition Act probe in March.
  - The company reorganised into three units on 29 April.
  - It cut more than 2,000 roles, targeting $1.5bn or more in gross savings.
  - Stripe and Advent bid about $53bn in July; the bid was reportedly dropped in August. This is REPORTED only (Reuters, CNBC and Banking Dive); PayPal's filings do not mention it.
  - A "Branded Checkout" securities class action was filed.
  - Another FTC CID arrived in September, on fees and purchase protection.
  - PayPal re-entered Nigeria through Paga (January).
  - PYUSD fell from about $3.9bn to about $2.7bn.

Sources: [8-K on the CEO change](https://www.sec.gov/Archives/edgar/data/1633917/000119312526035860/d68718dex991.htm) [F]; [Q3'26 10-Q](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000088/pypl-20260930.htm) [F].

### 4.3 Official claims vs. independent evidence

| PayPal said | The evidence shows | Verdict |
|---|---|---|
| 2027 targets: high-single-digit TM$ growth, low-teens-plus EPS growth (Feb 2025) | Targets rescinded Feb 2026; 2026 TM$ growth about +1%; medium-term ambition cut to mid-single-digit | **Not met; withdrawn** |
| "This is a stronger company today than two years ago" (Chriss, Oct 2025) | The board removed him three months later | **The board disagreed** |
| Honey "follows industry rules" (Dec 2024) | Code disabled Jan 2026; affiliate networks cut Honey off; the court let the claims proceed | **Contradicted** |
| German incident affected "a small number of accounts" (Aug 2025) | Banks blocked debits; estimates run from "hundreds of millions" to more than €10bn; the savings banks reported "significant impact throughout Europe" | **Minimised** (the amount is DISPUTED) |
| 2022 breach: credentials were "not obtained from any PayPal systems" | NYDFS found no mandatory MFA and untrained engineers | **Technically true, misleading** |
| PayPal World reaches "nearly two billion users" | Mercado Pago signed only an MOU; the first verified live use is Weixin Pay for US travellers (Aug 2026) | **Reach on paper, not usage** |
| PayPal is "leading" agentic commerce | CFO: not material to 2026; CEO: agent commerce "relatively small" in 2026–27; OpenAI scaled back Instant Checkout | **Unproven** |
| Non-GAAP margin "expanded 116bp" in FY24 | The FY23 base was restated from 22.4% to 17.2% | **Not comparable year to year** |
| Q3'26: "strategy translating into results" | PayPal-branded revenue fell about $240m year on year; GAAP operating income fell 8% | **Partly true** (Venmo and Braintree grew; the core shrank) |

### 4.4 Customers: what users and merchants experience

**Complaints to the US CFPB rose sharply.**

| | 2023 | 2024 | 2025 | 2026 (to 4 Nov) |
|---|---|---|---|---|
| Complaints about PayPal | 3,836 | 4,149 | 7,464 | 10,989 |
| Of which "trouble accessing funds" | 237 | — | — | 1,903 |
| Closed with monetary relief | 499 | — | — | 2,157 |

Source: [CFPB public complaint database API](https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?company=Paypal%20Holdings%2C%20Inc&size=0) [F].

- PayPal's share of the money-transfer category actually *fell*: Block (Cash App) and Early Warning (Zelle) went from about 3k to 48k and 25k respectively in 2025. Our interpretation is that part of this surge is industry-wide or bulk filing.
- **Funds can still be held for up to 180 days.** This is written into the current user agreement (updated 4 Nov 2026) ([User Agreement](https://www.paypal.com/us/legalhub/paypal/useragreement-full) [F]).
- **Self-selected reviews are poor:** 1.3/5 on Sitejabber across 2,134 reviews [F]. This is anecdotal.
- **Friends-and-family payments** "may not be eligible for refunds", PayPal's own admission when it launched AI scam alerts in July 2025 [F].
- **Fees and terms:**
  - US branded checkout costs merchants 3.49% plus a fixed fee.
  - Pay with Crypto rises from 0.99% to 1.5% in 2027.
  - New crypto terms add rules against mass arbitration, switch from AAA to JAMS, and apply retroactively [F]. Our interpretation: this is a lesson taken from the Honey litigation.

### 4.5 Fraud, risk and security

- **Transaction and credit losses**
  - They ran at about 0.10–0.12% of TPV, falling to 0.08% in Q3'26.
  - The fraud slice reports a **~20% rise in 2025, to about $1.3bn** [F], but that slice's split between transaction and credit losses is not reconciled with the table above.
  - Some of the improvement comes from moving credit off the balance sheet to KKR and Blue Owl. It is not purely better fraud control (INTERPRETATION).
- **The German direct-debit failure (Aug 2025)**
  - PayPal's fraud filters stopped working. German banks (BayernLB, Helaba, DZ Bank) then blocked PayPal's direct debits.
  - This shows that **one wallet's control failure can trigger bank countermeasures across a whole system**.
  - It also shows PayPal's dependence on bank goodwill in a market where it pulls money by direct debit.
- **AI:** 24m customer contacts resolved by AI agents year to date in 2026 (a company claim). The company also claims its AI scam alerts and credit models halve decision times.

### 4.6 Competitive position

| Threat | Evidence |
|---|---|
| **Stripe** | TPV about $1.9tn, valued at $159bn; co-created OpenAI's ACP; owns Paystack (Africa) and Bridge (stablecoins); bid for PayPal (REPORTED) |
| **Apple Pay** | The EU forced Apple to open iPhone NFC (2024). PayPal chose to coexist: PayPal and Venmo cards work in Apple Wallet. Reuters linked the 2024 layoffs to Apple pressure |
| **Wero (bank-owned European wallet)** | 44–52m users. E-commerce in Germany since Nov 2025, the Netherlands since Oct 2026. Backed by the same German bank groups that blocked PayPal's debits in Aug 2025. Management itself cites "normalization" of its leadership in Germany. PayPal holds about 30% of German online payments [F] |
| **Domestic instant rails** (Pix, UPI, SEPA Instant) | PayPal now *accepts* Pix (Apr 2026) and connects to UPI through PayPal World, conceding that it cannot replace these rails |
| **Zelle** | More than $1tn processed in 2024 and the main competitor for peer-to-peer payments in the US |
| **Klarna and Affirm** | Competition in buy-now-pay-later. PayPal Pay Later grew from $33bn (2024) to $40bn+ (2025), funded by KKR (€65bn facility) and Blue Owl (about $7bn) |
| **Agentic checkout** | Competing protocols (ACP, AP2, Visa VIC/TAP, Mastercard Agent Pay). PayPal is a participant, not the standard-setter |

The gap-fill slice adds independent market-share data. See `slices/gap_paypal_comp.md` and the update note at the end of this chapter.

### 4.6a Gap-fill additions

These points come from `slices/gap_paypal_comp.md`, which drew on 46 additional sites.

- **No independent source measures checkout-button *usage* share.** Acceptance data and usage data point in opposite directions:
  - **Acceptance.** BuiltWith counts **15.0m live websites accepting PayPal**. The next largest are Apple Pay at 3.73m, Google Pay 2.93m and Shop Pay 2.39m ([BuiltWith](https://trends.builtwith.com/payment/PayPal) [F]).
  - **Usage.** Capital One Shopping finds PayPal is the most *used* US wallet (42%), but **Apple Pay is more often the *primary* wallet (28% vs 19%)** ([Capital One Shopping](https://capitaloneshopping.com/research/digital-wallet-statistics/) [F]).
  - INTERPRETATION: PayPal is everywhere, but it is losing the default position.
- **Wallets already dominate online spending.** Worldpay's Global Payments Report puts wallets at 53% of global e-commerce spend in 2024 and 39% of US online spend ([Worldpay](https://www.worldpay.com/en/press-releases/10-years-cash-cards-and-crypto-worldpays-global-payments-report) [F]). PayPal's problem is its share *within* wallets, not whether people use wallets.
- **Shop Pay is the fastest-scaling branded checkout.**
  - It processed about **$43bn in Q4 2025, more than half of Shopify's US payment volume** (secondary analysis [F]).
  - Shopify's Q3 2026 GMV was $119bn, up 30%+ ([Shopify](https://www.shopify.com/news/shopify-q3-2026-financial-results) [F]).
  - PayPal's branded checkout grew 1–2% over the same period.
- **Rivals are undercutting Venmo's fees for getting paid.**
  - Venmo charges personal sellers **2.99%** ([Venmo](https://venmo.com/about/fees/) [F]).
  - Cash App is piloting a no-fee way to accept payments ("Earn in P2P") ([Block Q3'26 letter](https://www.sec.gov/Archives/edgar/data/0001512673/000162828026069513/q32026shareholderletter.htm) [F]).
  - Zelle's small businesses moved **more than $200bn in H1 2026**, mostly fee-free ([Zelle](https://www.zellepay.com/press-releases/zelle-tag-adoption-tops-1-million-small-businesses-across-america-enroll-rate-nearly) [F]).
- **Cross-border receiving is consolidating and getting cheaper.**
  - Payoneer agreed a sale to Nuvei (Jun 2026) [F].
  - Wise's take rate fell from 58bps to **52bps**, on $243bn moved in FY26 ([Wise RNS](https://www.investegate.co.uk/announcement/rns/wise-class-a--wise/wise-fy26-results/9637901) [F]).
- **Outages recur, and the status page under-reports them.**
  - 21 Nov 2024: more than 8,400 Downdetector reports.
  - 1 Aug 2025: Retail Checkout and Braintree were disrupted, while Venmo's status showed "Operational" despite user reports.
  - 16 Oct 2025: PayPal and Venmo were both down for about 2 hours.
  - Sources: [KTVU](https://ktvu.com/news/is-paypal-down-thousands-report-issues-nov-21-2024), [Tom's Guide](https://www.tomsguide.com/news/live/venmo-paypal-down-aug-1-outage), [BGR](https://bgr.com/1998690/paypal-venmo-down-outage-october-2025/) [F].
- **Independent reviews match the CFPB complaint data.**
  - ProductReview.com.au rates PayPal **1.4/5** (2,690 reviews); PissedConsumer **1.9/5** (3,194 reviews).
  - "Funds on hold" is the recurring theme [F].
  - These are self-selected reviews: REPORTED.
- **India.**
  - The Delhi High Court held (Jul 2023) that PayPal is a "payment system operator" under India's anti-money-laundering law (PMLA), while quashing the ₹96 lakh penalty.
  - PayPal registered with India's Financial Intelligence Unit (FIU-IND) by Feb 2024 ([Bar & Bench](https://www.barandbench.com/news/litigation/paypal-payment-system-operator-under-pmla-should-comply-reporting-entity-obligations-delhi-high-court) [F]; [MediaNama](https://www.medianama.com/2024/02/223-paypal-registers-indias-financial-intelligence-unit-anti-money-laundering-regulations/) [F]).
- **Nigeria.**
  - The workarounds are fragile:
    - Virtual dollar cards kept shutting down (Union54 2022; Rise and Carbon 2024) [F].
    - Upwork added a **$2.99 fee** for non-US freelancers from 1 Sep 2026 ([Cleva](https://www.getcleva.com/blog/upworks-new-2-99-withdrawal-fee-dont-let-it-cost-you-twice) [F]).
  - Vendors say PayPal "has never offered full withdrawal functionality in Nigeria" [F]. That is consistent with the Paga route being a linked, intermediated service, not a native Nigerian PayPal receiving account.

### 4.7 PayPal in Nigeria and Africa

- **History:** PayPal launched in Nigeria in 2014 for payments *out* only ([TechCabal](https://techcabal.com/2014/06/16/paypal-extends-services-nigeria/) [F]).
- **Exchanger market:** a market of exchangers grew up because receiving money through PayPal was restricted.
- **January 2026, PayPal–Paga:**
  - Users link a PayPal account to receive from more than 200 countries, including US Venmo users.
  - They withdraw in naira at "willing-buyer, willing-seller" rates.
  - Merchants can accept payments in 25 currencies ([TechCabal](https://techcabal.com/2026/01/27/paypal-returns-to-nigeria-after-two-decades-this-time-through-paga/) [F]).
  - The service runs through **Paga Remit**, a CBN-licensed international money transfer operator (IMTO), with "limited access and services" ([Paga](https://www.mypaga.com/pagapaypal/index.html) [F]).
  - Reaction was mixed, including calls for a boycott [S].
- **Regional investment:**
  - A Dubai hub covering 80 countries (Apr 2025).
  - A $100m commitment to the Middle East and Africa (Sep 2025) [F].

### 4.8 Recurring PayPal problems still unresolved (Nov 2026)

1. Branded checkout growth is stuck at 1–2%, and PayPal-branded revenue is falling [F].
2. Revenue as a share of TPV keeps declining: 2.03% (FY22) to 1.76% (Q3 2026) [F].
3. Funds can be held for up to 180 days. "Trouble accessing funds" complaints rose roughly eight-fold from 2023 to 2026 [F].
4. Complaints about unauthorized transactions and scams are rising, and friends-and-family payments are largely unprotected [F].
5. The legal stack is open:
   - the German competition case (more than 3.5 years);
   - the UK FCA wallet-funding probe;
   - three FTC CIDs;
   - CFPB CIDs on Regulation E and PayPal Credit;
   - Honey discovery;
   - the Branded Checkout securities suit [F].
6. PYUSD depends on subsidised yield: supply is down about 31% from its peak and it holds under 1% of the stablecoin market [F].
7. PayPal World is mostly unlaunched beyond Tenpay/Weixin [F].
8. Africa still depends on intermediaries to *receive* money [F].
9. No bank charter has been approved [F].
10. Agentic bets have not yet produced revenue, and the OpenAI checkout PayPal powered was scaled back [F].

### 4.9 Opportunities PayPal (and others) may have overlooked (SPECULATIVE)

- **Making receiving money work in Africa.**
  - Today: inbound-only, through an intermediary, at an 8.5–8.8% regional remittance cost.
  - The opportunity: compliant collection layers for freelancers and small businesses, so that money in a PayPal account reaches a naira wallet cheaply and visibly.
- **Turning frozen funds and disputes into products:**
  - forecasting how much of a balance will be held in reserve;
  - automating dispute evidence;
  - financing receivables against held balances;
  - explaining in plain language why an account action was taken (the UK now requires written reasons for account closures).
- **Interoperability "glue" between PayPal and the rails it cannot displace:** Pix, UPI, NIP (Nigeria) and mobile money.
- **Trust layers for agent-made purchases**, competing on buyer protection rather than on payment rails. Liability is the open question in agentic commerce.

## 5. Comparative timeline: how the major issues changed over four years

| Issue | 2023 | 2024 | 2025 | 2026 (to 5 Nov) | Direction |
|---|---|---|---|---|---|
| **Bank stability** | Digital bank runs; 3 large US failures plus Credit Suisse | NYCB scare; 2 small failures; unrealised losses $482bn | Fraud in private credit; 2 tiny failures | 6 small failures; private-credit opacity; rate *hike* | Crisis → chronic, low-grade stress |
| **Bank profits** | $256.9bn US | ~$268bn | **$295.6bn record** | Q2 $90.1bn | ↑ throughout |
| **US consumer regulator (CFPB)** | Proposals (1033, payment apps, late fees) | Most rules ever finalised | Repeal, layoffs, funding cut 46% | Near-dormant; 556-staff plan | Peak → collapse |
| **US federal enforcement against banks** | Binance $4.3bn | TD Bank $3.09bn guilty plea | Consumer cases dropped; Prince Group/Huione action | Amex $350m, BofA $1.2bn, Block $964m | Consumer enforcement ↓; AML enforcement steady |
| **States' role** | Minor | Minor | NY AG sues Zelle operator; 46 AGs on Cash App | Charter litigation (ICBA); 22 AGs on CFPB funding | ↑ fills the federal gap |
| **Fraud losses (IC3, US)** | $12.5bn | $16.6bn | $20.9bn | (2026 data in Apr 2027) | ↑ ~25–33% a year |
| **UK scam (APP) fraud** | Reimbursement policy set | Mandatory refunds from 7 Oct | 88% refunded | Losses +19% to £576m | Victims protected; fraud not reduced |
| **EU fraud liability** | PSD3 proposal | Instant Payments Regulation adopted | PSD3/PSR deal: PSPs and platforms liable | Final texts; application ~2027–28 | Liability shifting to providers |
| **AI fraud** | Early | Arup deepfake $25m; FinCEN alert | IC3 AI losses $893m | Mythos cyber fears; AI agents flooding complaints | ↑ new category |
| **Instant payments** | FedNow launch; Pix 42bn | UPI 172bn | FedNow 8.4m; Pix Automático | UPI 25bn a month; FedNow 1,800+ institutions | ↑ everywhere except US consumer use |
| **Cross-border cost ($200)** | 6.3% | 6.4% | 6.5%; FSB says G20 targets will be missed | SSA 8.46–8.8% | **Flat or worse** |
| **Stablecoins** | $130bn; PYUSD launch | $204bn | $304bn; GENIUS Act | ~$295bn; OCC rule; CLARITY fails | Growth → plateau |
| **Fintech funding (KPMG)** | $113.7bn | $95.6bn (low) | $116bn | $103.1bn (H1) | Recovery; fewer, larger deals |
| **Fintech business model** | Bank-as-a-service (BaaS) boom ends | Synapse collapse | IPOs at reset valuations | Fintechs buying or applying for bank charters | Rent a charter → own one |
| **AI in banks** | GenAI pilots | Klarna "700 agents" | CBA reversal; Klarna rehires humans | Block cuts more than 40% of staff; Evident index 3× faster | Hype → real cuts and pushback |
| **Agentic commerce** | — | — | Protocol wave (AP2, ACP, Visa, Mastercard) | ChatGPT checkout scaled back; no liability rules | Hype → reality check |
| **Debanking** | Farage/Coutts (UK) | UK FCA review | US executive order 14331 | UK 90-day rule live; OCC names 9 US banks | From AML de-risking to politics and rights |
| **Nigeria** | Naira redesign crisis; FX float | Devaluation; account freezes; recapitalisation order | Off FATF grey list; naira stabilises | Recapitalisation done; reserves $55bn; PayPal re-enters | Crisis → consolidation |
| **PayPal** | TM$ −1%; new CEO | Cost cuts; Fastlane | Guidance raised, then missed; German incident; Honey | CEO ousted; takeover bid; branded checkout +1–2% | Growth → margin → reset |
| **Account ownership** | — | (Findex survey year) | 79% global; Nigeria 63% | — | ↑ access; usage gaps remain |

---

## 6. Inventory of significant problems (evidence-backed)

Key:

- **Status as of Nov 2026:** O = open, P = partly addressed, R = resolved.
- **Evidence labels:** V = VERIFIED, R = REPORTED, D = DISPUTED.
- [F] = we opened and read the source; [S] = we saw only a search snippet.

| # | Problem | Main causes | Consequences | Who is affected | Regions | Status | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | **Authorised push payment (APP) and investment scams on instant rails** | Instant, irrevocable rails; social-media and telecom entry points; scam compounds; AI impersonation | US IC3 $20.9bn (2025); UK APP £576m; EU users bear ~85% of credit-transfer fraud | Consumers, especially people aged 60+ ($7.7bn); banks under UK rules | Global | O (UK: P) | V [F] |
| 2 | **No liability standard for agent-initiated purchases** | Protocols govern authorisation, not error; no card-network reason codes | Merchants absorb disputes by default; consumers uncertain; adoption slows | Merchants, consumers, wallets | Global | O | V [F] (EMVCo draft, Amex only) |
| 3 | **Ledger fragmentation in embedded finance (BaaS)** | Pooled FBO accounts; middleware keeps the ledger; no reconciliation duty | Synapse: up to $95m missing, customers unpaid 2.5 years later | Fintech end users, sponsor banks | US; Nigeria (fintech-run MFBs) | O (FDIC recordkeeping rule not finalised) | V [F] |
| 4 | **Cross-border payments still costly and slow, especially into Africa** | USD cash reliance; correspondent de-risking; no non-bank access; thin cross-border links between payment systems | 6.5% global average, ~8.5–8.8% to Sub-Saharan Africa; G20 2027 targets missed | Migrants, freelancers, SMEs | Africa, South Asia | O | V [F] (FSB) |
| 5 | **Opaque account freezes, holds and closures** | AML de-risking; fraud models; reputational policies; thin record-keeping | PayPal "trouble accessing funds" complaints up ~8×; up to 180-day holds; UK ~185k financial-crime exits (2022–23) | Freelancers, merchants, crypto firms, political groups | Global | P (UK 90-day rule; US EO) | V [F] |
| 6 | **Failed transfers and slow reversals (Nigeria)** | Interbank switch and core-system failures; manual reversals; weak enforcement of CBN timelines | CBN complaints 15k → 23k; failed transactions ~45% of complaints | Retail customers, traders | Nigeria (and similar markets) | O (draft rules) | V [F] |
| 7 | **Consumer complaint systems degraded (US)** | CFPB retreat; credit-repair firms and AI agents spamming the channel; narratives no longer published | 6.6m complaints, mostly noise; monetary relief in money services down to 2% | US consumers | US | O | V [F] |
| 8 | **Weak financial-crime controls at fast-growing firms** | Growth outpacing controls | Fines: TD $3.09bn, Starling £29m, Monzo £21m, Amex $350m, Block $964m; OCC denied Wise a charter | Customers (account exits), shareholders | US, UK, EU | P | V [F] |
| 9 | **Concentration in third-party technology providers and outages** | Cloud and EDR monoculture; core-processor oligopoly (Fiserv, FIS, Jack Henry); single super-apps (M-Pesa) | CrowdStrike; UK 158 incidents; AWS and Google Cloud outages; PayPal's German failure | Everyone using the affected services | Global | O | V [F] |
| 10 | **Credit after access: thin formal credit and predatory digital lending** | No credit data; high cost of risk; unregulated apps | Nigeria: 9.1% borrow formally; ~198% APR apps; 228 apps on the FCCPC watchlist | Low-income borrowers, MSMEs | Africa, South/Southeast Asia | P (DEON rules upheld) | V [F] |
| 11 | **Gender gap in financial access** | Income, ID, phone ownership, agent reach | Nigerian women 52.2% vs 63.3% overall; men are 69% of NIP volume | Women | Africa, South Asia | O | V [F] |
| 12 | **US open banking in limbo** | 1033 rule enjoined; banks charging for data access | Higher costs for account-linking and pay-by-bank | Fintechs, consumers | US | O | V/R |
| 13 | **Overdraft and junk fees returning (US)** | CRA repeal; lighter enforcement | Top-20 banks' overdraft revenue ~$4bn (+6.2% vs 2023) | Low-balance consumers | US | O | R [F] (NCLC) |
| 14 | **Fraud in private and asset-based credit** | Unverified collateral and receivables; opacity | Tricolor, First Brands, Zions, Western Alliance losses; FSB/ESA/ECB warnings | Banks, investors | US, EU | O | V [F] |
| 15 | **Stablecoin utility vs speculation** | Yield-driven demand; <1% of stablecoins used for payments; regulatory fault line over yield | PYUSD −31% from peak; CLARITY failed | Issuers, wallets, remittance users | Global | O | V [F] |
| 16 | **Regulatory whiplash** | Political cycles (US 2024 → 2025 → Nov 2026 midterms); Nigerian circular-driven policy | Rules sued, repealed or withdrawn within months; compliance planning harder | All firms; consumers | US, Nigeria | O | V [F] |
| 17 | **Card-fee economics** | Duopoly; interchange litigation | UK scheme fees +25% in real terms; US settlement pending; debit cap vacated | Merchants | US, UK, EU | P | V [F] |
| 18 | **Automated customer service hits a quality ceiling** | Cost pressure; deploying AI before it is ready | CFPB "doom loops"; CBA reversal; Klarna rehiring | Customers, especially in disputes | Global | O | V [F] |
| 19 | **DPRK and insider-driven crypto theft** | Social engineering (fake job interviews); insider bribery | Bybit $1.5bn; Coinbase $180–400m; Binance ~$6.4bn | Exchange users | Global | O | V/R/D |
| 20 | **PayPal's core checkout erosion** | OS wallets (Apple Pay), Stripe, Shop Pay, local rails, Wero | Branded growth +1–2%; take rate falling; CEO ousted | PayPal, its merchants | US, EU (Germany) | O | V [F] |

---

## 7. Recurring problems that remain unresolved

These problems appeared in **three or more of the four years** and are still open in November 2026. "Why unresolved" is our interpretation of the evidence.

1. **Scam losses rise every year despite every intervention.**
   - **Years:** 2023 IC3 $12.5bn → 2024 $16.6bn → 2025 $20.9bn. UK APP fell slightly in 2024, then rose 19% in 2025.
   - **Why unresolved:** liability sits with banks while the scams *start* on platforms and telecoms, which carry no reimbursement duty. The UK reports that 66% of APP cases start online.
   - **What to watch:** the EU's PSD3 platform liability is the first attempt to close this gap, applying around 2027–28.
2. **Money "in limbo" between institutions.**
   - **Years:**
     - 2023: Nigeria's failed transfers took up to 10 days to reverse.
     - 2024: Synapse.
     - 2025: Synapse customers still unpaid; the German direct-debit block.
     - 2026: Synapse money still owed; Nigeria's reversal rules still in draft.
   - **Why unresolved:** no shared, real-time, neutral record of where a payment is and who owes what.
3. **Opaque account actions (freezes, holds, closures).**
   - **Years:** every year. Coutts (2023), Nigerian BVN freezes and fintech onboarding bans (2024), US debanking executive order (2025), UK 90-day rule and PayPal complaints at record levels (2026).
   - **Why unresolved:** firms have no structured way to record and explain decisions, and the regimes for giving reasons are new.
4. **Cross-border costs.**
   - **Years:** 6.3% → 6.4% → 6.5%. The FSB has conceded the G20 targets will be missed.
   - **Why unresolved:** de-risking, USD cash reliance, and non-banks lacking access to payment systems.
5. **Embedded-finance (BaaS) record-keeping.**
   - **Years:** warning signs (2023) → collapse (2024) → the reform rule abandoned (2025) → the industry answering by buying charters (2026).
   - **Status:** the rule-level fix never arrived.
6. **Complaint handling and dispute quality.**
   - **Years:** CFPB volumes doubled every year; monetary relief fell; Nigeria's complaints rose 50%; merchants recover about 11% of chargeback value.
7. **Regulatory reversals.**
   - **Years:**
     - US: the 2023 proposals were finalised in 2024 and repealed in 2025.
     - Nigeria: 2024 policies were ordered and withdrawn within days.
   - **Consequence:** firms cannot plan multi-year compliance investment.
8. **Weak financial-crime controls at fast-growing firms.**
   - **Years:** Starling, Monzo, Revolut (ECB restrictions), N26 (BaFin restrictions again in Dec 2025), Wise's charter denial (2026), Block's $964m (Nov 2026).
9. **Concentration and outages.**
   - **Years:** MOVEit (2023) → CrowdStrike (2024) → AWS (2025) → Google Cloud and core processors (2026).

## 8. Prioritised opportunities (all SPECULATIVE)

**How each opportunity was scored.** Each gets 1–5 on five criteria:

| Criterion | What it measures |
|---|---|
| **E** | Strength of the evidence that the problem exists |
| **G** | How badly it is unsolved, and how weak the incumbents are |
| **R** | Regulatory tailwind |
| **N** | Fit for a builder in Nigeria or Africa |
| **F** | How quickly a small team could show something working |

Total = E + G + R + N + F (out of 25).

### Tier 1 (highest priority)

| # | Opportunity | Problem it addresses (§6 #) | Why now (evidence) | E | G | R | N | F | Total |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Payment-state truth layer / "where is my money" infrastructure.** A neutral, real-time record of each transfer's state across banks, fintechs and wallets. It also detects failed reversals automatically, triggers reversals and orchestrates refunds | 2, 6, 3 | Nigerian CBN complaints rose from 15k to 23k, ~45% of them about failed transactions; draft rules require 48-hour reimbursement and 16-day resolution; Synapse; the German direct-debit block | 5 | 5 | 5 | 5 | 4 | **24** |
| 2 | **Scam-reimbursement and liability infrastructure for instant rails.** Payee confirmation, mule-account scoring and claims case-management between institutions, with the 50/50 cost split built in | 1 | UK model data (88% reimbursed, ~£73m a year less fraud); Nigeria's APP draft; EU VoP and PSD3; IC3 losses $20.9bn | 5 | 4 | 5 | 5 | 3 | **22** |
| 3 | **Explainable account actions.** Logs freeze, hold and closure decisions, generates the legally required reason, and runs the appeal workflow, with a customer-facing status page | 5 | UK 90-day notice with written reasons (Apr 2026); US debanking EO and OCC findings; PayPal's "trouble accessing funds" complaints up ~8×; Nigerian BVN/EFCC freezes | 4 | 5 | 5 | 4 | 4 | **22** |
| 4 | **Agentic-commerce accountability (intent, receipts, liability evidence)**, protocol-neutral and including African merchants and payment rails | 2 | No liability rules (EMVCo draft; Amex only); OpenAI scaled back checkout over flexibility; AI-referred retail traffic up 393% (Adobe Q1 2026) | 4 | 5 | 3 | 4 | 4 | **20** |
| 5 | **Inbound cross-border collections for African freelancers and SMEs.** Receive-first, with transparent FX, visible status and local payout. Uses digital funding, which is exempt from the US 1% cash-remittance excise | 4 | Sub-Saharan Africa costs 8.5–8.8%; PayPal–Paga shows the demand but is limited; only 11 of 36 African payment systems are cross-border | 5 | 4 | 4 | 5 | 2 | **20** |

### Tier 2

| # | Opportunity | Problem it addresses | Key evidence | Total |
|---|---|---|---|---|
| 6 | **Ledger assurance for embedded finance and new microfinance banks.** Daily three-way reconciliation and proof-of-funds attestations | 3 | Synapse; Paystack, Flutterwave and Moniepoint becoming deposit-taking microfinance banks; Evolve's record-keeping order | 19 |
| 7 | **Compliance-as-a-service for new charter holders and fast-growing fintechs** (financial-crime controls that scale with growth) | 8 | 30+ US charter filings; Wise and Bunq denials; Monzo and Starling fines; Block $964m | 18 |
| 8 | **Human-guaranteed AI customer service.** AI triage that detects when a legal right is triggered (disputes, error claims) and hands the case to a human within a set time | 18 | CFPB "doom loop" report; Cash App's 24/7 live-support mandate; CBA reversal | 18 |
| 9 | **Agent-network compliance software** (geo-fencing, cash-out caps, PTSA reporting) | 6, 10 | CBN Dec 2024 and Oct 2025 circulars; Kenya's 564k agents | 17 |
| 10 | **Responsible digital-lending stack.** Cash-flow underwriting from NIP and mobile-money data, APR disclosure, ethical collections | 10 | 9.1% formal borrowing; DEON rules upheld; Ghana's unlicensed-app crackdown | 17 |
| 11 | **Women-first payments and savings distributed through agents** | 11 | Findex gap; men account for 69% of NIP volume | 16 |
| 12 | **Outage resilience.** Multi-rail failover, offline payments, automatic outage compensation | 9 | UK's 158 incidents; payday outages; M-Pesa as a systemic risk | 16 |
| 13 | **Collateral and receivables verification for private credit** | 14 | Tricolor and First Brands; FSB warnings | 15 (poor fit for a Nigerian builder) |
| 14 | **Stablecoin settlement for real FX pain, not yield** (B2B imports, payroll) | 15, 4 | Stablecoin supply plateauing; PYUSD −31% from peak; CBN VASP rules | 15 |
| 15 | **Merchant dispute-evidence and chargeback-prevention for small cross-border sellers** | 5, 17 | ~11% recovery rate; Visa VAMP thresholds of 1.5% from 2026 | 15 |

### Where the hackathon product "Kept" fits

Kept is the product chosen in `docs/PRODUCT_DISCOVERY.md`: a promise ledger that binds what a merchant (or its AI agent) promised to the PayPal payment, and fixes broken promises.

- **Problems it addresses:** #2 (agentic accountability), #5 (account actions and holds, through better merchant evidence), #18 (dispute quality) and the "money in limbo" theme (#2 in §7).
- **What this research adds:**
  - Merchant dispute recovery is low (~11%).
  - PayPal complaints are rising, and "trouble accessing funds" leads them.
  - OpenAI scaled back checkout, and liability for agent purchases is still unwritten.
- **Verdict:** the deeper research **strengthens** the case for Kept. The strongest *long-term* opportunity in this report, however, is **#1, the payment-state truth layer for African payment rails**. It is a natural expansion path for Kept: the same "what was promised vs what actually happened to the money" engine, applied to bank and fintech transfers instead of merchant promises.

## 9. Source directory

The complete directory is in **`SOURCE_DIRECTORY.md`**, which lists every source grouped by **year → subject**, with institution, publication date, event date, source type and access level. At the end of that file is a list of every unique website and how many documents came from each.

The machine-readable version is **`research-ledger.csv`**, with one row per unique document. Its columns are:

- year, subject, institution, region
- title, publisher, domain, URL
- publication date, event date, source type
- access ([F] = opened and read; [S] = search result only)
- the specific evidence taken, the finding it supports, and which research stream used it

To browse by **institution** (for example PayPal, CFPB, CBN, FDIC), filter the `institution` column in the CSV. To browse by **subject**, use the headings in `SOURCE_DIRECTORY.md`.

The most heavily used primary sources were:

| Source | What we used |
|---|---|
| SEC EDGAR | PayPal, Visa, Block, Capital One, Klarna, Nubank and Circle filings |
| Federal Reserve and FRB Services | FOMC statements, SVB review, stress tests, FedNow data |
| FDIC | Quarterly Banking Profile, failures, special assessment |
| CFPB | Rules, enforcement, complaint database API, annual Consumer Response reports |
| OCC | Bulletins, enforcement, debanking reports |
| FBI IC3 and FTC | Annual fraud reports |
| PSR, FCA, UK Finance, FOS, UK Supreme Court | UK payments, conduct, fraud and complaint data |
| ECB, EBA, European Parliament, EIOPA, AMLA | EU banking, fraud and legislative records |
| BIS, BCBS, FSB, IMF, World Bank | Global stability, payments and inclusion data, including Findex 2025 |
| Central banks | CBN (circulars, MPC communiqués, Financial Stability Reports), CBK, Bank of Ghana, CBE, BCB (Pix open data), RBA, Bank of Canada, MAS, CBRT |
| Other official and industry bodies | NIBSS, SABRIC, INTERPOL, UNODC, GSMA, AfricaNenda, Partech |

---

## 10. Research coverage report

### 10.1 Volume

These figures are computed automatically from the ledger. URLs were normalised and de-duplicated across streams, and `www.`, `m.` and `amp.` prefixes were merged when counting websites.

| Measure | Count |
|---|---|
| Ledger records (raw, across 13 streams) | 1,349 |
| **Unique documents** | **1,214** |
| **Unique websites (domains)** | **536** |
| Unique websites with at least one document actually opened and read ([F]) | **447** |
| Documents opened and read ([F]) | 1,051 (86.6%) |
| Documents seen only as search results ([S]) | 163 (13.4%) |

**Against the target of 400–500 distinct websites:**

- **Met:** 536 unique websites were consulted.
- **Met on the stricter measure:** 447 websites had at least one document actually read, rather than seen only in a search snippet.
- **Caveat on independence:** "unique websites" counts domains, not independent organisations. A few organisations run more than one domain (for example consumerfinance.gov and files.consumerfinance.gov). We did not merge these, which slightly inflates the count.

### 10.2 By research stream

| Stream | Records | Distinct websites | Opened and read [F] | Search result only [S] |
|---|---|---|---|---|
| y2023 | 124 | 60 | 95 | 29 |
| y2024 | 120 | 56 | 102 | 18 |
| y2025 | 125 | 74 | 98 | 27 |
| y2026 | 128 | 55 | 102 | 26 |
| paypal | 150 | 63 | 148 | 2 |
| fraud_cyber | 138 | 58 | 123 | 15 |
| payments_inclusion | 92 | 64 | 61 | 31 |
| customers | 125 | 58 | 110 | 15 |
| ai_competition | 97 | 58 | 89 | 8 |
| gap_africa_me | 76 | 65 | 76 | 0 |
| gap_asia_latam | 75 | 70 | 75 | 0 |
| gap_paypal_comp | 54 | 52 | 50 | 4 |
| gap_west | 45 | 42 | 42 | 3 |

### 10.3 By year, source type and region

These are unique documents. The `year` tag is the year the evidence is mainly about.

| | Count |
|---|---|
| **By year** | |
| 2023 | 157 |
| 2024 | 257 |
| 2025 | 375 |
| 2026 | 385 |
| Multi-year | 32 |
| Earlier context (2019, 2022) | 8 |
| **By source type** | |
| Journalism | 508 |
| Regulator | 239 |
| Company | 113 |
| Central bank | 107 |
| Industry report | 64 |
| Filing | 49 |
| Academic | 19 |
| Cybersecurity | 21 |
| Consumer complaint | 9 |
| Court | 5 |
| Other | 80 |
| **By region (top)** | |
| US | 478 |
| Global | 155 |
| Nigeria | 123 |
| UK | 91 |
| EU | 85 |
| Africa (pan-regional) | 35 |
| Latin America | 35 |
| Asia | 31 |
| Kenya | 21 |
| India | 21 |
| Australia | 16 |
| Ghana | 16 |
| Egypt | 13 |
| South Africa | 11 |
| Ethiopia | 10 |
| Switzerland | 9 |
| China | 8 |
| Smaller counts | Japan, Canada, WAEMU, Saudi Arabia, Vietnam, Philippines, Indonesia and others |

### 10.4 Coverage audit: what is well covered

- **Each year, 2023 to 2026:** major events, causes, consequences and how each year carried into the next.
  - 2026 has a month-by-month index running to early November.
- **US prudential and consumer regulation:** comprehensive.
  - The FOMC statement of 28 Oct 2026 was checked against the primary document during synthesis.
- **PayPal financials and legal matters:** sourced from its filings.
  - Every annual release from FY22 to FY25, three 2026 quarterly releases, three 10-Ks, two 10-Qs and the relevant 8-Ks.
  - The CFPB complaint API was queried directly.
- **Fraud:**
  - Annual series for the US (IC3, FTC), UK (UK Finance, PSR, ONS) and EU (EBA/ECB).
  - Nigeria (NIBSS), South Africa (SABRIC), Ghana (Bank of Ghana), India (parliamentary data), Korea.
- **Payments infrastructure:** UPI, Pix (central bank open data), FedNow, SEPA Instant, NIP, InstaPay, PayShap, PI-SPI and African instant payment systems (AfricaNenda).
- **Financial inclusion:** World Bank Findex 2025 and GSMA mobile money.
- **Nigeria in depth:** CBN circulars, Financial Stability Report, MPC communiqués, recapitalisation, fraud, complaints and the fintech licensing shift.

### 10.5 Gaps and limitations

**Access barriers**

- **Shared web-search allowance.** The research system's web-search budget ran out during the first round. Agents switched to fetching known primary URLs, site archives and the reference lists of fetched pages. This held breadth in check for some topics.
  - When search became available again, a second round of four gap-fill streams added 247 records.
- **Blocked or unreadable sites.** The following refused automated access or could not be rendered:
  - Reuters, AP, the Guardian, the FT, Bloomberg, the DOJ (partly), FATF, Swift, EPC, the EU Council, EUR-Lex and IMF web pages (PDFs often worked).
  - NPCI, UK Finance (partly), Trustpilot, BBB, congress.gov and GovTrack.
  - The CBN, BCB and SARB sites, which render with JavaScript (APIs or PDFs were used where possible).
  - Where these mattered, we used secondary reporting and labelled it.
- **No social-media evidence.** Reddit, X and Nairaland could not be reached, so there is no consumer evidence from those platforms. Customer evidence comes instead from regulator complaint data (CFPB, CBN, FOS, FCCPC, the South African banking ombud), review sites (Sitejabber, ProductReview, PissedConsumer) and the press.
- **Wikipedia.** It is used as a secondary source for some minor facts and is labelled as such each time.

**Thin topics**

- The 2023 document count (157) is the lowest of the four years. Much 2023 evidence is tagged "multi" or appears inside later post-mortems.
- Specific thin areas:
  - Egypt's 2023 devaluation details.
  - The UK Finance 2023 fraud totals (snippet only).
  - RTP volumes for 2023.
  - Checkout-button *usage* share: no independent source measures it.
  - The final texts of PSD3/PSR and the 1033 rule.
  - Treasury and FDIC rules under the GENIUS Act.
  - CFPB nominee confirmation.
  - Japan and China beyond headline statistics.
  - Latin America outside Brazil and Colombia.

**Claims that remain REPORTED or DISPUTED**

- **Stripe/Advent bid for PayPal.** The ~$53bn bid and its withdrawal are reported by Reuters via CNBC and Banking Dive. PayPal has filed nothing about it.
- **Binance theft.** Binance's ~$6.4bn theft on 29 Oct 2026 is less than a week old, and the reported amount varies by source.
- **Size of PayPal's German debit block** (Aug 2025).
- **Which banks complied with Nigeria's recapitalisation requirement**, and what happens to banks under regulatory intervention.
- **Synapse shortfall:** estimates range from $60m to $96m.
- **Klarna's AI claims.**

**Methodological limits**

- No interviews or primary surveys were conducted.
- Complaint volumes are distorted by bulk filers. The CFPB itself attributes much of the 2025 surge to credit-repair firms and AI agents.
- Vendor-sponsored industry reports (for example Chargebacks911 and Deloitte projections) are labelled.

**Statement on fabrication.** No sources, quotes or figures were invented. Every claim in this report traces to a ledger record. Earlier in drafting, the coordinating author caught and removed a paragraph of unsourced competitor statistics before it was used; it was replaced with figures from the gap-fill ledger. That paragraph never appeared in any published version.
