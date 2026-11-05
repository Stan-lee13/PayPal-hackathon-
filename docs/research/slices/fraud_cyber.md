# Fraud, scams, financial crime, cyber incidents and outages, 2023 to Nov 2026 (slice: fraud_cyber)

Scope: a cross-cutting theme compared year by year (2023, 2024, 2025, and 2026 to 5 Nov). Tags: **[F]** means fetched and read. **[S]** means seen only in a search-result snippet. Evidence labels: VERIFIED, REPORTED, DISPUTED, INTERPRETATION, SPECULATIVE. Event dates and publication dates are given separately where they differ. The ledger is at `research/ledger/fraud_cyber.jsonl` (138 records, 58 domains, 123 fetched).

Research constraint: the shared web-search budget ran out early in this session. Most later evidence was gathered by fetching primary pages directly and by using publishers' own site APIs and site search (Interpol, NIBSS, Bank of Ghana, Chainalysis, TechCabal, Nairametrics, Premium Times, PYMNTS, TechCrunch, BBC). Section 8 lists the gaps this caused.

---

## 1. Key findings (top 10)

1. **US reported cyber-enabled fraud rose every year: $12.5bn (2023), $16.6bn (2024), $20.9bn (2025).** IC3 complaints passed 1 million for the first time in 2025. Investment fraud, mostly crypto "pig butchering", was the largest category each year: $4.57bn, $6.57bn, $8.65bn. VERIFIED ([IC3 2023](https://www.ic3.gov/AnnualReport/Reports/2023_IC3Report.pdf) [F], [IC3 2024](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf) [F], [IC3 2025](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf) [F]).
2. **FTC consumer fraud losses followed the same path: >$10bn (2023), $12.5bn (2024), $15.9bn (2025).** Report counts were roughly flat (2.6m, 2.6m, 3.0m), so the growth is in loss per victim, not in the number of victims. Bank transfers and crypto carry the most loss. VERIFIED ([FTC 2023](https://www.ftc.gov/news-events/news/press-releases/2024/02/nationwide-fraud-losses-top-10-billion-2023-ftc-steps-efforts-protect-public) [F], [FTC 2024](https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024) [F], [FTC JEC testimony, 25 Mar 2026](https://www.ftc.gov/system/files/ftc_gov/pdf/ftc-testimony-jec-hearing-on-the-rising-scam-economy.pdf) [F]).
3. **The UK's mandatory APP reimbursement (from 7 Oct 2024) works for victims but has not stopped the fraud.** The PSR reports 88% (£316m) of in-scope losses reimbursed, and Frontier Economics estimates in-scope Faster Payments scam losses fell about 21% (about £73m a year). Yet UK Finance APP losses rose 19% to £576.4m in 2025, with 66% of cases starting online. VERIFIED ([PSR dashboard](https://www.psr.org.uk/information-for-consumers/app-scams-reimbursement-dashboard) [F], [Regulation Tomorrow on the evaluation](https://www.regulationtomorrow.com/2026/07/payment-fraud-falls-by-73m-following-psr-reimbursement-scheme/) [F], [UK Finance 2026](https://www.ukfinance.org.uk/news-and-insight/press-release/fraud-report-2026-press-release) [F]).
4. **Southeast Asian scam compounds became the defining financial crime story of the period.** The US government estimated Americans lost at least $10bn to Southeast Asia-based scams in 2024 (+66%). In October 2025 the US and UK moved against the Prince Group: OFAC sanctioned 146 targets and DOJ filed to forfeit 127,271 BTC (about $15bn), the largest forfeiture in US history. FinCEN cut Huione Group off from the US financial system under section 311. VERIFIED ([Treasury](https://home.treasury.gov/news/press-releases/sb0278) [F], [DOJ](https://www.justice.gov/opa/pr/chairman-prince-group-indicted-operating-cambodian-forced-labor-scam-compounds-engaged) [F], [FinCEN](https://www.fincen.gov/news/news-releases/fincen-issues-final-rule-severing-huione-group-us-financial-system) [F]).
5. **The scam-compound model has spread to Africa.** In December 2024 the EFCC raided a Lagos building and arrested 792 people, including 148 Chinese nationals. INTERPOL (June 2025) says West Africa may be becoming a new scam-centre hub, and its 2026 Africa assessment found 72% of surveyed countries report scam centres. VERIFIED ([Nairametrics](https://nairametrics.com/2024/12/16/crypto-investment-scam-efcc-arrests-792-suspects-including-148-chinese-trainers-in-sting-operation/) [F], [INTERPOL 2025](https://www.interpol.int/en/News-and-Events/News/2025/INTERPOL-releases-new-information-on-globalization-of-scam-centres) [F], [INTERPOL 2026](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-finds-AI-linked-to-more-than-half-of-cybercrime-in-Africa) [F]).
6. **AI-enabled fraud moved from anecdote to measured category.** Milestones: FinCEN's deepfake alert (Nov 2024); the Arup $25m deepfake CFO video call (Jan 2024); IC3's first AI section (2025: >22,000 complaints, >$893m); INTERPOL's 2026 finding that AI-enhanced fraud is 4.5x more profitable; and AI linked to 55% of reported African cybercrime. VERIFIED ([FinCEN alert](https://www.fincen.gov/sites/default/files/shared/FinCEN-Alert-DeepFakes-Alert508FINAL.pdf) [F], [CNN](https://edition.cnn.com/2024/05/16/tech/arup-deepfake-scam-loss-hong-kong-intl-hnk/index.html) [F], [INTERPOL](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-warns-of-increasingly-sophisticated-global-financial-fraud-threat) [F]).
7. **Crypto exchange hacks reached systemic scale and were attributed to DPRK.** Bybit lost $1.5bn on 21 Feb 2025. Binance lost about $6.3 to 6.4bn on 29 Oct 2026, the largest crypto theft ever, entered through a fake job interview and a compromised internal AI tool; about $2.8bn had been frozen by 3 Nov. REPORTED, and DISPUTED on the exact amount ([FBI PSA](https://www.ic3.gov/PSA/2025/PSA250226) [F], [Chainalysis](https://www.chainalysis.com/blog/binance-exploit-latest-findings-and-response/) [F], [BBC](https://www.bbc.co.uk/news/articles/ck5ynwz9gy67o) [F]).
8. **Operational outages, not only attacks, became a top consumer-harm and regulatory issue.** The UK Treasury Committee counted 158 incidents and at least 803 hours of outages at nine banks between Jan 2023 and Feb 2025. Other examples: CrowdStrike crashed about 8.5m devices (Jul 2024); PayPal's fraud filter failed in Germany (Aug 2025), with about €10bn of direct debits blocked by banks; AWS (Oct 2025) and Google Cloud London (Oct 2026) outages hit banks. VERIFIED ([BBC/Treasury Committee](https://www.bbc.co.uk/news/articles/cjd3yzx3xgvo) [F], [Microsoft](https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/) [F], [BBC PayPal](https://www.bbc.co.uk/news/articles/cj6y42jggdyo) [F], [PayPal 10-K](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm) [F]).
9. **AML enforcement peaked, then partly reversed in the US, and then resumed.** Binance paid $4.3bn (2023) and TD Bank pleaded guilty (>$3bn, Oct 2024). Then the CFPB dropped its Zelle suit with prejudice (Mar 2025) and CZ was pardoned (Oct 2025). Enforcement resumed against scam infrastructure (Prince/Huione, Oct 2025) and against Bank of America ($1.2bn, Oct 2026). VERIFIED ([FinCEN TD](https://www.fincen.gov/news/news-releases/fincen-assesses-record-13-billion-penalty-against-td-bank) [F], [American Banker](https://americanbanker.com/news/cfpb-dismisses-lawsuit-against-zelle-and-three-big-banks) [F], [BBC CZ](https://www.bbc.co.uk/news/articles/cly1qrl9l1qo) [F], [BBC BofA](https://www.bbc.co.uk/news/articles/cm3wvxy6n3z8o) [F]).
10. **Africa's fraud data is diverging.** Nigeria's NIBSS-reported losses spiked to N52.26bn in 2024 (inflated by one N31.1bn incident), then fell 51% to N25.85bn in 2025, but reporting fell 34% in Q4 2025. South Africa's digital-banking fraud claims more than doubled from R1.09bn (2023) to R2.41bn (2025). Ghana's payment-service-provider (PSP, mostly mobile money) fraud cases rose 54% in 2025. VERIFIED ([NIBSS](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [F], [SABRIC 2025](http://www.sabric.co.za/wp-content/uploads/2026/08/SABRIC-Annual-Crime-Statistics-Report-2025.pdf) [F], [Bank of Ghana 2025](https://www.bog.gov.gh/wp-content/uploads/2026/07/FRAUD-REPORT-2025.pdf) [F]).

---

## 2. Trend tables (sourced)

### 2.1 United States

| Metric | 2023 | 2024 | 2025 | 2026 (to Nov) |
|---|---|---|---|---|
| IC3 complaints | 880,418 | 859,532 | 1,008,597 | n/a (2026 report due Apr 2027) |
| IC3 reported losses | $12.5bn (+22%) | $16.6bn (+33%) | $20.877bn (+26%) | — |
| IC3 investment fraud | $4.57bn | $6.57bn | $8.65bn | — |
| IC3 BEC | $2.95bn (21,489 complaints) | $2.77bn | $3.05bn | — |
| IC3 crypto-related losses | $3.96bn* | $9.32bn (149,686 complaints) | $11.37bn (181,565) | — |
| IC3 losses, people aged 60+ | $3.4bn | $4.8bn | $7.7bn | — |
| IC3 AI-related complaints | — | — | >22,000 / >$893m | — |
| FTC Sentinel fraud losses | >$10bn | $12.5bn | $15.9bn | — |
| FTC fraud reports | 2.6m | 2.6m | 3.0m | — |
| FTC investment scams | >$4.6bn | $5.7bn | >$7.9bn | — |
| FTC imposter scams | ~$2.7bn | $2.95bn | >$3.5bn | — |
| SARs filed (FinCEN fiscal year) | 4.6m [S] | 4.7m [S] | n/a | — |

Sources: IC3 2023/2024/2025 [F]; FTC releases and testimony [F]; [ABA Banking Journal on FinCEN](https://bankingjournal.aba.com/2025/06/fincen-releases-figures-on-bsa-filings/) [S]. *The 2023 report gives $3.96bn in its narrative and $3.81bn in its crypto table. The FTC estimates that underreporting-adjusted 2024 fraud could reach **$195.9bn** [F].

### 2.2 United Kingdom

| Metric | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| UK Finance total fraud losses | £1.17bn (−4%) [S] | ~£1.17bn (flat) [S] | £1.28bn (+4%) [F] | — |
| APP losses | ~£460m [S] | £450.7m (−2%), ~186k cases [S] | £576.4m (+19%), 248,070 cases [F] | — |
| Unauthorised losses | — | £722m [S] | £703.4m (−5%), 3.81m cases [F] | — |
| APP reimbursed by banks (UK Finance) | — | £267.1m (~59%) [S] | £354.3m (61%) [F] | — |
| PSR in-scope reimbursement (Oct 2024 to Mar 2026) | — | — | 88% (£316m), ~438k claims [F] | Q1 2026: 89%, £72.6m [F] |
| CSEW fraud incidents (year ending March) | 3.5m (YE Mar 23) | 3.2m (YE Mar 24) | 4.2m (YE Mar 25, +31%) | 4.5m (YE Mar 26); victims 3.8m (+10%) |

Sources: [UK Finance 2026](https://www.ukfinance.org.uk/news-and-insight/press-release/fraud-report-2026-press-release) [F]; [TLT on the 2025 report](https://www.tlt.com/insights-and-events/insight/uk-finance-annual-fraud-report-2025) [S]; [Fintech Times](https://thefintechtimes.com/industry-calls-for-collaboration-and-tougher-regulation-after-fraud-exceeds-1billion-in-2024/) [S]; [PSR](https://www.psr.org.uk/information-for-consumers/app-scams-reimbursement-dashboard) [F]; ONS [2023](https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/bulletins/crimeinenglandandwales/yearendingmarch2023), [2024](https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/bulletins/crimeinenglandandwales/yearendingmarch2024), [2025](https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/bulletins/crimeinenglandandwales/yearendingmarch2025), [2026](https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/bulletins/crimeinenglandandwales/yearendingmarch2026) [F].

### 2.3 EU/EEA (EBA/ECB, PSD2 reporting)

| Metric | 2022 | H1 2023 | 2024 |
|---|---|---|---|
| Total payment fraud | €4.3bn | €2.0bn | €4.2bn (+€602m, +17% vs 2023) |
| Credit-transfer fraud | — | €1.131bn | €2.5bn (+24%) |
| Card fraud (EEA-issued) | — | €633m | €1.3bn (+4%) |
| Share of credit-transfer fraud losses borne by users | — | — | ~85% (vs 38% for cards) |

Sources: [EBA/ECB 2024 report](https://www.ecb.europa.eu/press/intro/publications/pdf/ecb.ebaecb202408.en.pdf) [F]; [EBA/ECB 2025 report, Dec 2025](https://www.ecb.europa.eu/press/intro/publications/pdf/ecb.ebaecb202512.en.pdf) [F].

### 2.4 Africa

| Metric | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| Nigeria, NIBSS actual fraud losses | N17.67bn | N52.26bn (incl. one N31.1bn incident) | N25.85bn (−51%); 67,518 incidents | — |
| South Africa, SABRIC digital-banking claims | R1.09bn | ~R1.86bn | R2.41bn (+29.2%) | — |
| South Africa, card fraud (SA-issued) | — | R1.48bn | R1.75bn (+18%) | — |
| Ghana, total fraud cases / value at risk | 15,865 / GH¢88m | 16,733 / GH¢99m | 24,778 / GH¢101m | — |
| Ghana, PSP (mobile money) cases / value | 14,655 / GH¢16m | 15,673 / GH¢19m | 24,124 / GH¢37m | — |
| Kenya, Safaricom staff dismissed for fraud (FY to March) | — | 95 (FY24) | 113 (FY25) | 118 (FY26); incidents −82% |

Sources: [NIBSS](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [F]; [SABRIC 2025](http://www.sabric.co.za/wp-content/uploads/2026/08/SABRIC-Annual-Crime-Statistics-Report-2025.pdf) [F]; Bank of Ghana [2023](https://www.bog.gov.gh/wp-content/uploads/2024/09/BANKS-SDIs-PSPs-2023-FRAUD-REPORT.pdf), [2024](https://www.bog.gov.gh/wp-content/uploads/2025/04/NOTICE-NO.-BG-GOV-SEC-2025-09-Publication-of-Banks-SDIS-and-PSPS-2024-Fraud-Report.pdf), [2025](https://www.bog.gov.gh/wp-content/uploads/2026/07/FRAUD-REPORT-2025.pdf) [F]; [TechCabal on Safaricom](https://techcabal.com/2026/10/29/safaricom-fires-118-staff-for-fraud/) [F].

### 2.5 Global enforcement (INTERPOL operations, all [F])

| Year | Operation | Result |
|---|---|---|
| 2023 | HAECHI IV (Jul–Dec) | ~3,500 arrests, $300m seized, 34 countries |
| 2024 | First Light | 3,950 arrests, $257m seized, 6,745 bank accounts frozen |
| 2024 | Jackal III (West African syndicates such as Black Axe) | ~300 arrests, $3m, 720+ accounts blocked |
| 2024 | HAECHI V | >5,500 arrests, >$400m seized |
| 2024 | Serengeti (Africa) | 1,006 arrests, ~$193m losses linked |
| 2025 | Red Card (Africa) | 306 arrests; Nigeria 130, of whom 113 foreign nationals |
| 2025 | Serengeti 2.0 | 1,209 arrests, $97.4m recovered |
| 2025 | HAECHI VI | $439m recovered, 68,000 accounts blocked |
| 2026 | Red Card 2.0 (Dec 2025–Jan 2026) | 651 arrests, $4.3m recovered, >$45m losses; mobile money and loan-app fraud |
| 2026 | First Light 2026 | 5,811 arrests, $293m intercepted, 97 countries |
| 2026 | Serengeti III | 1,462 arrests, >$105m recovered, >$385m losses |

Sources: INTERPOL news pages linked in Section 3.4.

### 2.6 Cyber cost and crypto-crime metrics

| Metric | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| IBM global average breach cost | $4.45m | $4.88m (+10%) | $4.44m (US $10.22m) | $4.99m (+12%) |
| On-chain ransomware payments (Chainalysis) | — | $892m | ~$820m (−8%; claimed victims +50%) | — |
| Largest crypto hack | — | — | Bybit $1.5bn (DPRK) | Binance ~$6.3–6.4bn (DPRK), plus Bitget (Sep) |

Sources: IBM [2023](https://newsroom.ibm.com/2023-07-24-IBM-Report-Half-of-Breached-Organizations-Unwilling-to-Increase-Security-Spend-Despite-Soaring-Breach-Costs), [2024](https://newsroom.ibm.com/2024-07-30-ibm-report-escalating-data-breach-disruption-pushes-costs-to-new-highs), [2025](https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls), [2026](https://www.ibm.com/reports/data-breach) [F]; [Chainalysis ransomware](https://www.chainalysis.com/blog/crypto-ransomware-2026/) [F]. IBM's financial-sector breach cost could not be fetched; see Section 8.

---

## 3. Detailed findings by sub-topic

### 3.1 US fraud: scale, mix and policy

**What happened.** Reported losses compounded about 25 to 33% a year (Table 2.1). IC3's 2025 report (published April 2026) shows people aged 60+ lost about $7.75bn, about 37% of all losses ([CyberScoop](https://cyberscoop.com/fbi-internet-crime-complaint-center-annual-cybercrime-report/) [F]). It also puts crypto-investment ("pig butchering") losses at about $7.2bn ([Chainalysis citing IC3](https://www.chainalysis.com/blog/asian-scam-centers-crypto-fraud-april-2026/) [F]). The FTC says losses reported by people over 60 topped $3bn in 2025, and bank-transfer losses for that group rose more than tenfold since 2020 ([The Money Overview](https://themoneyoverview.com/ftc-says-bank-transfer-scam-losses-reported-adults-60-older-rose-tenfold) [S]). The share of FTC reporters who lost money rose from 27% to 38% between 2023 and 2024 [F].

**Why.** Losses concentrate where payments are irrevocable: bank transfers and crypto lead the FTC loss data. Social media is the top contact method by dollars, with over $2bn in FY2025 [F]. Industrial scam compounds raise the loss per victim.

**Policy responses.**
- *Alerts:* FinCEN's pig-butchering alert (8 Sep 2023, [S](https://www.consumerfinancemonitor.com/2023/09/15/pig-butchering-fincen-issues-alert-on-virtual-currency-scam/)) and deepfake alert (13 Nov 2024) [F].
- *Check fraud:* FinCEN's analysis of mail-theft check fraud found 15,417 reports from 841 institutions and >$688m of suspicious activity in the six months after its Feb 2023 alert ([FinCEN](https://www.fincen.gov/news/news-releases/fincen-issues-depth-analysis-check-fraud-related-mail-theft) [F]).
- *Regulators:* The Fed, FDIC and OCC issued a joint request for comment on payments and check fraud on 16 Jun 2025 ([Federal Reserve](https://www.federalreserve.gov/newsevents/pressreleases/bcreg20250616a.htm) [F]).
- *Executive branch:* An executive order of 6 Mar 2026 set up a targeting cell against transnational cyber-fraud groups [F]. DOJ launched a "Scam Center Strike Force" in Nov 2025 [F via Chainalysis].
- *Fund recovery:* IC3's Recovery Asset Team froze $469m of $651.5m reported in 2,651 Financial Fraud Kill Chain incidents in 2024 [F].

VERIFIED.

**P2P/Zelle.** A Senate PSI staff report (23 Jul 2024) found JPMorgan, Bank of America and Wells Fargo reimbursed only about 12% of scam disputes in 2023. Their reimbursement rate for *unauthorized* disputes fell from 62% (2019) to 38% (2023) ([Blumenthal](https://www.blumenthal.senate.gov/newsroom/press/release/the-senate-permanent-subcommittee-on-investigations-releases-new-staff-report-on-zelle-bank-failures-to-protect-consumers) [S]; [GovInfoSecurity](https://www.govinfosecurity.com/senator-top-banks-only-reimburse-38-unauthorized-scams-a-25843) [S]). The CFPB sued Early Warning Services and three banks in Dec 2024, alleging >$870m of losses, then dismissed the suit with prejudice in Mar 2025 ([American Banker](https://americanbanker.com/news/cfpb-dismisses-lawsuit-against-zelle-and-three-big-banks) [F]). The NY Attorney General filed a near-copy suit on 13 Aug 2025, alleging >$1bn stolen between 2017 and 2023 and that EWS developed safeguards in 2019 but did not adopt them ([NY AG](https://ag.ny.gov/press-release/2025/attorney-general-james-sues-company-behind-zelle-enabling-widespread-fraud) [F]). Pattern (INTERPRETATION): when federal enforcement retreated, states stepped in to fill the gap.

### 3.2 UK: reimbursement, platforms and the "online origin" problem

**What happened.** Totals stayed at about £1.17bn in 2023 and 2024, then rose to £1.28bn in 2025. The mix shifted:
- Unauthorised fraud fell 5% in value but cases rose 11%.
- APP losses rose 19%.
- Investment scams rose 40% to £221.5m and romance scams 23% to £39.2m.
- 66% of APP cases begin online (32% of losses); 17% begin through telecoms (28% of losses) [F].

The ONS victim survey (CSEW) shows fraud incidents rising from 3.2m (YE Mar 2024) to 4.2m (YE Mar 2025) and 4.5m (YE Mar 2026), with victims up 10% to 3.8m [F]. The NCA estimates fraud is about 41% of CSEW crime, only about 14% is reported, and about 67% is cyber-enabled ([NCA](https://www.nationalcrimeagency.gov.uk/what-we-do/crime-threats/fraud-and-economic-crime) [F]). VERIFIED.

**APP reimbursement regime (from 7 Oct 2024).**
- Results: 88% of in-scope value reimbursed; 82% of claims closed within 5 business days; only about 3% rejected for lack of customer caution.
- Limits: the cap is £85,000, and the rules cover Faster Payments only [F].
- Evaluation (Frontier Economics, published by the PSR on 1 Jul 2026): APP losses down about 21% (about £73m a year), and the reimbursement rate up from 54% to 65% ([Regulation Tomorrow](https://www.regulationtomorrow.com/2026/07/payment-fraud-falls-by-73m-following-psr-reimbursement-scheme/) [F]).

VERIFIED. INTERPRETATION: the regime moved losses onto sending and receiving PSPs and improved controls on Faster Payments. It did not touch the origin of the fraud (platforms and telecoms), and UK Finance totals still rose in 2025.

**Platforms.** The Online Safety Act's illegal-content duties became enforceable on 17 Mar 2025, and fraud is a priority offence. The extra fraudulent-advertising duties for the largest (categorised) services depend on Ofcom's register and codes, which had not been published at the time of the government explainer ([GOV.UK](https://www.gov.uk/government/publications/online-safety-act-explainer/online-safety-act-explainer) [F]). Ofcom's page could not be fetched. The current status of the fraudulent-advertising codes is a GAP.

**AML fines on fast-growing banks and building societies.**
- Starling: £28.96m (2 Oct 2024). It opened >54,000 accounts for 49,000 high-risk customers despite a restriction ([FCA](https://www.fca.org.uk/news/press-releases/fca-fines-starling-bank-failings-financial-crime-systems-and-controls) [F]).
- Metro Bank: £16.7m (Nov 2024) for transaction monitoring that did not work as intended between 2016 and 2020 ([Penningtons](https://www.penningtonslaw.com/insights/recent-fca-financial-crime-enforcement-actions/) [S]).
- Monzo: £21.09m (8 Jul 2025). Customers grew about tenfold while financial-crime controls lagged ([FCA](https://www.fca.org.uk/news/press-releases/fca-fines-monzo-21m-failings-financial-crime-controls) [F]).
- Barclays: £42m (16 Jul 2025), including £39.3m over Stunt & Co, which received £46.8m from a laundering operation ([FCA](https://www.fca.org.uk/news/press-releases/fca-fines-barclays-42-million-poor-handling-financial-crime-risks) [F]).
- Nationwide: £44m (Dec 2025) ([Ocorian](https://www.ocorian.com/knowledge-hub/insights/fca-fines-nationwide-ps44m-aml-failings-what-means-your-business) [S]).
- 2026: no FCA AML systems fine on a firm to May 2026 ([MEMA](https://memaconsultants.com/resources/insights/fca-fines-may-2026) [S]).

The 2025 fines are VERIFIED. The 2026 slowdown is REPORTED [S].

### 3.3 EU: rising push-payment fraud and a liability gap

EEA fraud reached €4.2bn in 2024. Credit-transfer fraud, at €2.5bn (+24%), now exceeds card fraud at €1.3bn (+4%). "Manipulation of the payer" is more than half of credit-transfer fraud by value.

Strong customer authentication (SCA) cut card fraud. Card fraud is about 17 times higher when the counterparty is outside the EEA, where SCA may not apply. But users bear about **85%** of credit-transfer fraud losses, against 38% for card losses ([EBA/ECB 2025](https://www.ecb.europa.eu/press/intro/publications/pdf/ecb.ebaecb202512.en.pdf) [F]). VERIFIED. SEPA instant transfers grew from about 10% to about 16% of SEPA credit-transfer volume over three years [F].

Europol's IOCTA 2024 ranks online fraud among the most threatening cybercrimes and says AI-assisted cybercrime "has only just begun" ([Europol](https://www.europol.europa.eu/cms/sites/default/files/documents/Internet%20Organised%20Crime%20Threat%20Assessment%20IOCTA%202024.pdf) [F]).

Regulatory build-out:
- DORA, the EU's digital operational resilience rules, applied from 17 Jan 2025 ([EIOPA](https://www.eiopa.europa.eu/digital-operational-resilience-act-dora_en) [F]).
- The new EU anti-money-laundering authority (AMLA, Frankfurt) is operational ([AMLA](https://www.amla.europa.eu/index_en) [F]).
- The Oct 2025 Verification of Payee mandate under the Instant Payments Regulation could not be fetched (EPC and EUR-Lex returned empty pages). GAP.

### 3.4 Scam compounds and transnational organised fraud

**Timeline.**
- *Dec 2023:* INTERPOL Storm Makers II, its first operation on trafficking-fuelled fraud (281 arrests, 27 countries) ([INTERPOL](https://www.interpol.int/en/News-and-Events/News/2023/INTERPOL-operation-reveals-further-insights-into-globalization-of-cyber-scam-centres) [F]).
- *Mar 2024:* INTERPOL's global fraud assessment describes "romance baiting" by trafficked workers ([INTERPOL](https://www.interpol.int/en/News-and-Events/News/2024/INTERPOL-Financial-Fraud-assessment-A-global-threat-boosted-by-technology) [F]).
- *Apr 2025:* UNODC reports syndicates spreading to Zambia, Angola, Namibia and Georgia ([Nairametrics on UNODC](https://nairametrics.com/2025/04/21/un-raises-alarm-over-spread-of-asian-scam-into-africa-south-america-others/) [F]).
- *Jun 2025:* victims from 66 countries trafficked into compounds, 74% to Southeast Asia, and West Africa a possible new hub ([INTERPOL](https://www.interpol.int/en/News-and-Events/News/2025/INTERPOL-releases-new-information-on-globalization-of-scam-centres) [F]).
- *Oct 2025, US/UK:* Prince Group sanctions and forfeiture. TRM says Prince earned >$30m a day by 2018 ([TRM](https://www.trmlabs.com/resources/blog/operation-prince-inside-the-global-effort-that-led-to-the-largest-forfeiture-in-us-history) [F]; [Elliptic](https://www.elliptic.co/blog/prince-group-targeted-with-crypto-sanctions-for-global-pig-butchering-operations) [F]).
- *Oct 2025, Huione:* the section 311 final rule. FinCEN says Huione laundered at least $4bn between Aug 2021 and Jan 2025 [F]. The rule took effect 17 Nov 2025, and a Jun 2026 proposal would extend it to H-Pay as a successor entity ([Federal Register](https://www.federalregister.gov/documents/2025/10/16/2025-19571/imposition-of-special-measure-regarding-huione-group-as-a-foreign-financial-institution-of-primary) [S]).
- *Oct 2025, Myanmar:* the junta captured KK Park, and Starlink cut >2,500 terminals at compounds ([BBC](https://www.bbc.co.uk/news/articles/c0jdn4yjze6o) [F]; [BBC](https://www.bbc.co.uk/news/articles/cpd2e5541d1o) [F]).
- *Jan 2026:* Chen Zhi arrested (6 Jan) and extradited to China; Prince Bank put into liquidation ([BBC](https://www.bbc.co.uk/news/articles/cy4q8e88n2vo) [F]). China executed 11 members of the Ming crime family ([BBC](https://www.bbc.co.uk/news/articles/cd6wegndnjlo) [F]).
- *Mar 2026:* INTERPOL and UNODC held a Global Fraud Summit in Vienna ([INTERPOL](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-UNODC-global-summit-ends-with-call-to-action-against-fraud-surge) [F]).

VERIFIED. **Why it persists:** a combination of forced labour, weak governance and conflict zones, crypto rails and stablecoins, and payment processors for hire (the Bolai network, for example, [F]). Starlink-type connectivity also enables remote sites (INTERPRETATION, supported by the BBC Starlink story).

### 3.5 Nigeria and wider Africa

**Nigeria, compounds and enforcement.**
- *10 Dec 2024 raid:* 792 arrested at the Big Leaf Building, Victoria Island, including 148 Chinese and 40 Filipino nationals. Nigerians were recruited for typing skills and trained for two weeks to pose as foreign women in crypto-romance scams aimed at the US, Canada and Europe ([Nairametrics](https://nairametrics.com/2024/12/16/crypto-investment-scam-efcc-arrests-792-suspects-including-148-chinese-trainers-in-sting-operation/) [F]).
- *Feb 2026 sentencing:* two Chinese nationals received 46 years each, in a case involving N3.4bn and $2.5m ([Nairametrics](https://nairametrics.com/2026/02/11/court-jails-two-chinese-46-years-for-n3-4bn-2-5m-cyberterrorism-and-internet-fraud/) [F]).
- *Red Card (2025):* Nigeria arrested 130 people, 113 of them foreigners [F].
- *FBI cooperation:* the EFCC facilitated two sextortion extraditions on 26 Aug 2026 ([Premium Times](https://www.premiumtimesng.com/news/more-news/921819-tinubu-hails-efcc-after-fbi-praises-role-in-sextortion-arrests.html) [F]).
- *FATF:* Nigeria exited the grey list in Oct 2025 ([Premium Times](https://www.premiumtimesng.com/news/top-news/913376-efcc-nfiu-prepare-for-fresh-fatf-evaluation-after-nigerias-exit-from-grey-list.html) [F]).

VERIFIED.

**Nigeria, payments-system fraud.**
- NIBSS losses: N17.67bn (2023), N52.26bn (2024), N25.85bn (2025).
- Incidents fell from 123,918 (2021) to 67,518 (2025). Lagos accounts for 63%.
- E-commerce and internet banking are the most affected channels. Insider abuse is "high".
- Joint industry action prevented about N20bn of losses, but reporting fell 34% in Q4 2025 ([NIBSS](https://nibss-plc.com.ng/digital-payment-fraud-drops-51-to-n25-85b-lagos-accounts-for-63/) [F]).
- Scale: NIBSS processed NGN 1.07 quadrillion and 11.2bn NIP transfers ([NIBSS](https://nibss-plc.com.ng/nigerias-digital-payments-surge-to-n1-07-quadrillion-as-nibss-defines-future/) [F]).

VERIFIED (NIBSS-reported).

**Nigeria, glitch exploitation (a distinctively Nigerian loss pattern).**
- *Flutterwave POS, Oct 2023:* 9,633 erroneous transactions by 814 POS agents on 12–13 Oct 2023, N21.2bn exposure, N7.2bn preserved. Litigation was still running in Aug 2026 ([Nairametrics](https://nairametrics.com/2026/08/31/court-unfreezes-4-accounts-linked-to-n21-billion-system-glitch-faults-police/) [F]).
- *NIBSS "dry posting", Sep 2024:* N13.66bn posted in error on 6–9 Sep 2024; N12.34bn traced and about N1.32bn escaped ([NIBSS](https://nibss-plc.com.ng/beyond-the-glitch-how-nibss-is-defending-nigerias-quadrillion-naira-payment-ecosystem/) [F]).

REPORTED.

**Nigeria, regulatory response.**
- *CBN draft APP reimbursement rules (26 Nov 2025):* investigate within 14 working days, refund within 48 hours, notify other institutions within 30 minutes. An institution that fails to freeze proceeds bears full liability, and the sending and receiving banks split the cost 50/50 when neither is at fault ([Nairametrics](https://nairametrics.com/2025/12/02/cbn-proposes-48-hour-reimbursement-window-after-app-fraud-investigations/) [F]).
- *Multi-factor authentication* for foreign-card spending above $200 a day (circular of 18 Dec 2025) [F].
- *NCC–CBN memorandum of understanding* on fraud (Apr 2026) [F].
- Whether the APP rules have been finalised is a GAP.

**South Africa (SABRIC 2025).** Digital-banking claims rose from R1.09bn to R1.86bn to R2.41bn. The banking app accounts for about 89% of cases and 70.5% of value. The main drivers are social engineering and customer compromise. Domestic card fraud rose 43% [F].

**Ghana (Bank of Ghana 2025).** PSP cases nearly doubled over 2022–2025 (+98%) while banks and specialised deposit-taking institutions improved [F].

**Kenya.** Safaricom dismissed 118 staff for fraud in the year to Mar 2026, against 28 in FY2021, while cutting incidents 82% ([TechCabal](https://techcabal.com/2026/10/29/safaricom-fires-118-staff-for-fraud/) [F]). INTERPOL calls East Africa "a hub of mobile money fraud" [F].

**Continental picture.** Cybercrime is more than 30% of reported crime in West and East Africa, and 90% of African countries say they need significant capacity improvement ([INTERPOL 2025](https://www.interpol.int/en/News-and-Events/News/2025/New-INTERPOL-report-warns-of-sharp-rise-in-cybercrime-in-Africa) [F]).

### 3.6 Cyber incidents and outages (chronology)

**2023**
- *MOVEit (May):* the Clop gang stole data on >60m people ([TechCrunch](https://techcrunch.com/2025/01/31/a-brief-history-of-mass-hacks/) [F]).
- *Mr. Cooper (Oct–Nov):* data on 14.6m customers ([TechCrunch](https://techcrunch.com/2023/12/18/mr-cooper-hackers-stole-personal-data-on-14-million-customers/) [F]).
- *ICBC Financial Services (8–9 Nov):* LockBit entered through an unpatched Citrix NetScaler, and the attack disrupted the clearing of Treasury trades. ICBC reportedly paid ([TechCrunch](https://techcrunch.com/2023/11/14/citrix-bleed-critical-bug-ransomware-mass-cyberattacks/) [F]).
- *Flutterwave POS glitch (Oct):* see 3.5.

**2024**
- *loanDepot (Jan):* about 17m customers; customers could not make payments for weeks [F].
- *Evolve Bank (Jun):* LockBit ransomware at this banking-as-a-service bank hit fintech partners including Wise and Mercury; ≥7.6m people affected ([TechCrunch](https://techcrunch.com/2024/12/27/record-breaking-ransoms-and-breaches-a-timeline-of-ransomware-in-2024/) [F]).
- *CrowdStrike (19 Jul):* about 8.5m devices crashed. Parametrix estimates about $5.4bn of Fortune-500 losses, only $0.54–1.08bn of it insured. Banks hit included Chase, BofA, Wells and Capitec ([Microsoft](https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/) [F]; [Wikipedia](https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages) [F]).
- *NIBSS dry posting (Sep):* see 3.5.
- *Finastra (Nov):* SFTP breach with a claimed 400GB of banking-client data ([TechCrunch](https://techcrunch.com/2024/11/20/fintech-giant-finastra-confirms-its-investigating-a-data-breach/) [F]).

**2025**
- *Barclays (31 Jan–2 Feb):* multi-day payments outage on payday ([BBC](https://www.bbc.co.uk/news/articles/c5y7dpdje6xo) [F]).
- *28 Feb payday outages:* about 1.2m people affected, including about 700,000 Lloyds-group users; HSBC online-chat waits averaged 2 hours ([BBC](https://www.bbc.co.uk/news/articles/c7875w07l93o) [F]).
- *Treasury Committee data (Mar):* 158 incidents and 803 hours; Barclays faces up to £12.5m in compensation [F].
- *Bybit (21 Feb):* $1.5bn stolen; at least $300m laundered within two weeks ([BBC](https://www.bbc.co.uk/news/articles/c2kgndwwd7lo) [F]).
- *Coinbase (disclosed May):* support staff were bribed; 69,461 customers affected; a $20m ransom was refused ([TechCrunch](https://techcrunch.com/2025/05/21/coinbase-says-its-data-breach-affects-at-least-69000-customers/) [F]).
- *PayPal Germany (Aug):* covered in 3.8.
- *AWS DNS (20 Oct):* banks among services hit ([TechCrunch](https://techcrunch.com/2025/10/21/amazon-dns-outage-breaks-much-of-the-internet/) [F]).

**2026**
- *Lloyds group app (12 Mar):* customers could see other users' transactions, including National Insurance numbers ([BBC](https://www.bbc.co.uk/news/articles/c4g23npxpwgo) [F]).
- *Bitget (Sep):* exploit attributed to DPRK [F via Chainalysis].
- *Google Cloud europe-west2 (20 Oct):* a power event hit Revolut, Lloyds and HSBC ([BBC](https://www.bbc.co.uk/news/articles/cxdd8mm6qy4mo) [F]).
- *Binance (29 Oct):* see 3.7.

**Trend data.**
- *Chainalysis ransomware:* claimed victims +50% in 2025 while payments fell 8% to about $820m; median payment up 368%; only about 28% of victims paid [F].
- *Verizon DBIR 2026:* software vulnerabilities have overtaken stolen credentials as the top initial access vector ([Verizon](https://www.verizon.com/business/resources/reports/dbir/) [F]).
- *Bank of England:* links rising cyber attacks to geopolitical tension ([BoE FSR Jul 2025](https://www.bankofengland.co.uk/financial-stability-report/2025/july-2025) [F]).

### 3.7 AI-enabled fraud and AI defences

**Attack side.**
- *Arup (Jan 2024; named May 2024):* $25m paid out after a deepfake video call ([CNN](https://edition.cnn.com/2024/05/16/tech/arup-deepfake-scam-loss-hong-kong-intl-hnk/index.html) [F]).
- *FinCEN (Nov 2024):* deepfake-related SARs rising since 2023 [F].
- *IC3 2025:* >22,000 AI-related complaints and >$893m in losses, including >$30m in AI-assisted BEC [F].
- *INTERPOL 2026:* AI-enhanced fraud is 4.5x more profitable, and "agentic AI" can run whole fraud campaigns [F].
- *IBM 2026:* AI-driven attacks +56%, led by deepfake impersonation [F]. IBM 2025: 13% of organisations had AI model or application breaches, 97% of them without AI access controls [F].
- *Binance (Oct 2026):* attackers exploited an internal AI tool ([BBC](https://www.bbc.co.uk/news/articles/ck5ynwz9gy67o) [F]; [Chainalysis](https://www.chainalysis.com/blog/binance-hack-dprk-employment-fraud/) [F]).
- *UK law:* experts call it "unfit for purpose" against unauthorised voice cloning ([BBC, 26 Jun 2026](https://www.bbc.co.uk/news/articles/c7v9py713g4o) [F]).

**Defence side.**
- *Visa:* agreed to buy BioCatch (behavioural biometrics) for $2.4bn (Aug 2026). Visa says account takeover and scams cost more than $1 trillion a year ([PYMNTS](https://www.pymnts.com/news/acquiring/2026/visa-inks-2-4-billion-deal-to-acquire-fraud-prevention-firm-biocatch/) [F]). Visa A2A Protect raised account-to-account fraud detection 75% in its first six months ([PYMNTS](https://www.pymnts.com/cybersecurity/fraud-prevention/2026/visa-debuts-enhanced-version-of-a2a-fraud-prevention-tool/) [F]).
- *Mastercard:* its scam-merchant risk tool flagged about 80% of the merchants issuers later identified as risky, often 90 days earlier ([PYMNTS](https://www.pymnts.com/news/payment-methods/2026/mastercard-introduces-strategy-ferret-out-scam-merchants/) [F]).
- *IBM:* extensive security AI or automation saved $1.9 to 2.2m per breach (2024–2026) [F].

VERIFIED for the facts. INTERPRETATION: the card networks are buying their way into account-to-account and pre-payment scam detection because instant-payment fraud bypasses card rails.

### 3.8 PayPal-specific evidence

- **Transaction losses rising again.** About $1.1bn (2024) to about $1.3bn (2025), +20%, "primarily due to... fraud incidents impacting our PayPal products". The loss rate was 0.07% of TPV, against 0.08% in 2023. Transaction-plus-credit losses were $1,682m, $1,442m and $1,720m for 2023, 2024 and 2025 ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm) [F]). VERIFIED.
- **Germany, Aug 2025.** The 10-K confirms a coding error in a system update, followed by "fraudulent transaction activity for a limited time period" and protection-programme claims [F]. The German savings banks association (DSGV) confirmed unauthorised direct debits and informed supervisors. Süddeutsche Zeitung reported about €10bn of payments blocked ([BBC](https://www.bbc.co.uk/news/articles/cj6y42jggdyo) [F]). The €10bn figure is REPORTED from one outlet via the BBC; PayPal did not confirm it.
- **Cyber hygiene.** NYDFS imposed a $2m penalty (23 Jan 2025). After a 1099-K data-flow change, Social Security numbers were left unredacted. PayPal also lacked MFA, CAPTCHA and rate limiting, and used unqualified cybersecurity staff ([NYDFS](https://www.dfs.ny.gov/reports_and_publications/press_releases/pr20250123) [F]). VERIFIED.

---

## 4. Contradictions and disputed claims

- **Binance hack size.** Chainalysis says about $6.4bn; Binance, via the BBC, says $6.3bn. North Korea denies involvement. DISPUTED (minor on amount; attribution rests on on-chain commingling with the Bitget theft).
- **FTC 2024 losses.** The March 2025 release says $12.5bn; the March 2026 testimony says "over $12bn". This is rounding, not a conflict.
- **UK reimbursement rates.** UK Finance gives 61% (2025, all APP). The PSR gives 88% (in-scope Faster Payments consumer claims only). Frontier gives 54% rising to 65% (confirmed losses). These measure different scopes and should not be compared directly. For 2024, UK Finance figures are reported as about 59% overall [S], while the PSR cites 61% for personal accounts [F].
- **Nigeria's "51% fall" in 2025.** The 2024 base was inflated by a single N31.1bn incident, and reporting fell 34% in Q4 2025. Part of the fall may be a reporting artefact. INTERPRETATION.
- **India FY25 tripling** (₹360bn against ₹122.3bn) partly reflects 122 cases worth ₹186.7bn reclassified after a Supreme Court ruling ([PYMNTS](https://www.pymnts.com/cybersecurity/fraud-prevention/2025/indian-banks-log-threefold-uptick-in-fraud/) [F]).
- **EU series.** The 2024 report shows €4.3bn for 2022. The 2025 report shows €4.2bn for 2024 and +17% on 2023. This implies 2023 was about €3.6bn on the later report's sample. Country coverage differs between reports, so the series is not strictly continuous.
- **Ransomware losses.** IC3 counts only $32m of reported 2025 losses; Chainalysis counts about $820m paid on-chain. The scopes differ: complaints against payments, US against global.
- **Prince Group.** The group "categorically rejects" the allegations. China's cyber agency alleged the US orchestrated theft of the bitcoin ([Finance Magnates](https://www.financemagnates.com/cryptocurrency/cambodia-detains-tycoon-tied-to-dojs-record-15b-bitcoin-seizure-extradites-him-to-china/) [S]). The forfeiture is a civil complaint, not a judgment.
- **Lloyds, 28 Feb 2025.** Lloyds argued the disruption was not an "outage", citing 5m successful logins, while about 700,000 customers failed to log in at the first attempt [F].
- **Zelle.** Zelle says more than 99.95% of payments carry no fraud report; the NY AG alleges more than $1bn stolen. Both can be true at Zelle's volumes.

## 5. Evolution 2023 to 2026

- **2023: the year of scale-up.** Investment and crypto fraud jumped (IC3 investment fraud +38%). Regulators issued typology alerts (check fraud, pig butchering). ICBC and MOVEit exposed third-party and patching risk. Binance paid $4.3bn.
- **2024: the year of record AML penalties and the first systemic outage.** TD Bank, Starling and Metro were penalised. CrowdStrike and Evolve showed concentration risk. Deepfakes moved into mainstream fraud (Arup, FinCEN alert). The UK started mandatory reimbursement. Africa saw its first Serengeti operation and the Lagos raid.
- **2025: losses kept rising, and enforcement split.** US federal consumer enforcement retreated (Zelle dismissal, CZ pardon) while action against scam infrastructure hardened (Prince, Huione, Scam Center Strike Force). UK payday outages became a political issue. DPRK theft scaled up (Bybit). Nigeria left the FATF grey list. CBN drafted APP rules.
- **2026 so far: record crypto theft and cloud concentration.** Binance lost about $6.4bn; Google Cloud London went down; Lloyds exposed customer data in its apps. AML enforcement resumed (BofA $1.2bn). INTERPOL's figures rose (First Light 5,811 arrests; Serengeti III 1,462). AI is now pervasive in attacks (Africa 55%) and drives defensive M&A (Visa–BioCatch).

## 6. Implications for PayPal and the industry

- **PayPal (INTERPRETATION, from the 10-K and BBC evidence).** Fraud losses are rising faster than TPV again, and a single control failure in one market (Germany) produced bank-level systemic disruption and regulatory attention. PayPal is both a funding source pulled by direct debit and a wallet. Its fraud filter therefore protects the banks' rails too, and a failure exposes PayPal to bank counterparties, not only to its own customers.
- **Liability is moving toward payment providers.** UK reimbursement, Nigeria's draft 48-hour refunds and the NY AG's Zelle suit all push loss onto PSPs. The EU figure that users bear 85% of credit-transfer fraud losses is the next obvious policy target. Wallets and account-to-account (A2A) products, including PayPal and Venmo P2P and PayPal's Pix integration in Brazil ([PYMNTS](https://www.pymnts.com/news/payment-methods/2026/paypal-lets-small-businesses-tap-into-brazils-pix-system/), not fetched), should plan for mandatory reimbursement economics.
- **Insider and social-engineering vectors dominate.** Examples: Coinbase support staff bribed; the Binance engineer's fake interview; Safaricom's 118 dismissals; NIBSS saying insider abuse is high. Controls focused on perimeter technology miss these.
- **Concentration risk.** CrowdStrike, AWS, Google Cloud, Evolve (banking-as-a-service) and Finastra each show that one vendor can take out many institutions. DORA and UK operational-resilience rules make this auditable.

## 7. Unresolved problems as of Nov 2026 (evidence-backed)

1. US reported fraud losses rise every year ($20.9bn in IC3 for 2025), and no federal reimbursement regime exists for P2P scams; the CFPB suit was dismissed [F].
2. The origin of fraud on platforms and telecoms remains largely unpriced. 66% of UK APP cases start online [F], and the Online Safety Act fraudulent-advertising duties were not yet in force at last fetch [F].
3. EU users bear about 85% of credit-transfer fraud losses [F].
4. Scam compounds have relocated rather than closed: West and Southern Africa, the Middle East and Central America [F]. 72% of surveyed African countries report scam centres [F].
5. DPRK crypto theft is escalating: $1.5bn in 2025 and about $6.4bn in 2026 [F].
6. Nigerian fraud reporting is falling (−34% in Q4 2025), and glitch-exploitation litigation drags on (Flutterwave, Aug 2026) [F].
7. UK bank outage frequency: 158 incidents in about two years, with further 2026 incidents (Lloyds data exposure, Google Cloud) [F].
8. Legal gaps on voice and face cloning (UK) [F]. In Africa, fragmented cybercrime law and low AI readiness among police [F].

## 8. Opportunity signals (all SPECULATIVE, each tied to evidence)

1. **Reimbursement-liability infrastructure for African payment providers.** Nigeria's draft rules require 30-minute cross-institution notice, 14-day investigations and 50/50 cost splits [F]. A shared case-management and liability-allocation network for Nigerian banks, fintechs and mobile money operators, similar to UK Faster Payments claims tooling, is a clear gap.
2. **Mule-account and recipient-risk scoring for instant rails.** Evidence: Singapore's mule crackdown [F], the Visa A2A and BioCatch deal [F], and the PSR's finding that receiving-PSP liability cut losses [F]. Possible products: a "confirmation of payee plus risk" API for NIP and PAPSS, and for mobile money in Ghana, where PSP cases rose 54% [F].
3. **Insider-threat and staff-integrity tooling.** Evidence: Safaricom's dismissals, the Coinbase bribery and NIBSS's "insider involvement is high" [F]. Possible products: behavioural monitoring of staff and agent access to customer data, SIM registration and posting functions.
4. **Reconciliation and "glitch-recovery" tooling.** The N21.2bn Flutterwave and N13.66bn NIBSS incidents show value lost in the window between an erroneous posting and the account freeze [F]. Real-time anomaly detection on posting systems could narrow that window, and so could automated post-no-debit orchestration.
5. **Deepfake and job-interview attack defences for fintech staff.** Evidence: Binance's entry vector and >$14.3m of earlier DPRK fake-interview losses [F]. Possible products: verified-recruiter channels, sandboxed "assignment" execution, and liveness checks for high-value approvals (the Arup case).
6. **Outage resilience as a product.** Evidence: payday outages affected 1.2m people [F], and single-cloud failures at AWS and Google [F]. Possible products: multi-rail failover, offline payments (NIBSS piloted offline transfers in Jan 2026 per its site listing, not fetched), and outage-compensation automation.
7. **Scam-compound financial-flow intelligence for African compliance teams.** Compounds are moving to West and Southern Africa [F] and Huione/H-Pay successor entities are being designated [S]. A regional blocklist and typology service could serve FIUs and banks preparing for FATF re-evaluation (Nigeria [F]).

## 9. Coverage self-audit

**Covered:** US (IC3 and FTC 2023–25, FinCEN alerts, check fraud, SAR statistics [S], Zelle PSI/CFPB/NY AG, elder fraud); UK (UK Finance 2024–26, PSR dashboard and evaluation, ONS, NCA, FCA fines, Online Safety Act, Treasury Committee outages); EU (EBA/ECB 2024 and 2025, Europol IOCTA 2024, DORA, AMLA); global (INTERPOL operations and assessments 2023–26, UNODC, scam compounds, Prince/Huione, TD, Binance, BofA); Africa (NIBSS 2023–25, SABRIC 2025, Bank of Ghana 2023–25, Kenya/Safaricom, EFCC raid, CBN draft rules, Nigeria's FATF exit, INTERPOL Africa assessments); cyber (ICBC, MOVEit, Mr. Cooper, loanDepot, Evolve, CrowdStrike, Finastra, Bybit, Coinbase, AWS, Google Cloud, Binance 2026; IBM 2023–26; Verizon DBIR; Chainalysis ransomware); AI fraud and defences; PayPal 10-K, NYDFS and Germany.

**Gaps:**
- *Searched but not fetched:* Patelco (2024); OKX's $504m plea (2025); the Block/Cash App NYDFS and CFPB actions; Robinhood fines.
- *FATF grey-list changes for South Africa, Kenya and others:* the FATF site returned 403; only Nigeria's exit is verified.
- *IBM financial-sector breach costs:* not obtained.
- *Treasury Committee primary documents:* parliament.uk returned 403; figures come via the BBC.
- *Unreached sites:* Ofcom, EPC Verification of Payee, Pay.UK CoP, ACCC/Scamwatch (Australia), Brazil (Febraban/BCB), Egypt, HKMA and MAS primary pages.
- *Unverified and therefore excluded:* the 2025 UK Finance report's 2024 unauthorised split (beyond [S]); the 2023 APP figure (beyond [S]); synthetic-identity statistics; USPS mail-theft statistics beyond FinCEN; the June 2026 Huione/H-Pay NPRM (only [S]); Kenya-specific Central Bank of Kenya and Communications Authority data.

**Access limits:** The web-search budget was exhausted after about 20 queries. Blocked sites: FATF, parliament.uk, Action Fraud, ACCC, FinTech Futures, Payment Expert, NYDFS (curl; WebFetch worked), and SEC (needed a declared user agent). DOJ press URLs returned 404 or empty pages, so the Prince indictment page was read from the DOJ URL but the TD and Binance pleas were taken from FinCEN and BBC instead.
