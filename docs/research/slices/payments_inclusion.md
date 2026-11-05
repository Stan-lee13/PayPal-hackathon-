# Payment infrastructure, cross-border, stablecoins/CBDCs and financial inclusion, Jan 2023 to Nov 2026 (slice: payments_inclusion)

Research cut-off: 4 Nov 2026. Tags: **[F]** means I opened and read the page or document, or the raw data file or API. **[S]** means I only saw a search snippet. Labels: VERIFIED, REPORTED, DISPUTED, INTERPRETATION, SPECULATIVE. Event dates are given separately from publication dates where they differ.

**Access note.** The shared web-search budget ran out partway through. After that, all evidence came from fetching known primary URLs directly. These included the BCB Pix open-data API, the FRB Services FedNow tables, the CBN circular API, World Bank and GSMA PDFs, the DefiLlama API, ECB statistical releases, and FCCPC pages. This is why some topics remain snippet-only or are gaps (see section 8).

---

## 1. Key findings (top 10)

1. **US instant payments now have two very different rails.** RTP processed 107m+ payments worth $481bn in Q2 2025 alone. In the same quarter FedNow settled 2.13m payments. FedNow's Q3-2026 average was $58,161 per payment, so it is mainly a high-value or liquidity rail, not a consumer one. FedNow's participant count passed 1,800 in July 2026, but only 20.7% of small institutions take part. VERIFIED ([FRB Services FedNow quarterly data [F]](https://www.frbservices.org/wp-content/uploads/20261020-quarterly-3q2026-fednow-ascii.txt); [TCH [F]](https://www.theclearinghouse.org/payment-systems/Articles/2025/07/RTP-Q2-Value-Surge); [KC Fed [F]](https://www.kansascityfed.org/banking/community-banking-bulletins/highlight-smaller-institutions-embrace-faster-payments-with-fednow/)).
2. **UPI and Pix kept compounding.** UPI went from 117.6bn transactions (2023) to 172.2bn (2024) to about 228bn (2025), and reached 25.47bn in October 2026 alone. Pix's September volume roughly doubled from 3.35bn (2023) to 7.17bn (2026), and P2B rose from 33.5% to 46.5% of Pix transactions. VERIFIED ([BCB open data [F]](https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/EstatisticasTransacoesPix); [Entrepreneur/NPCI [F]](https://india.entrepreneur.com/business-news/upi-hits-record-25-47-bn-transactions-in-october-daily-value-crosses-inr-1-l-cr)).
3. **The G20 cross-border targets for 2027 will be missed, and the FSB says so itself.** The global cost of a $200 remittance went 6.3% (2023), 6.4% (2024), 6.5% (2025). Sub-Saharan Africa is the most expensive receiving region at 8.8%. VERIFIED ([FSB consolidated progress report 2025 [F]](https://www.fsb.org/uploads/P091025-1.pdf)).
4. **Financial inclusion jumped, led by Africa and South Asia.** Global account ownership rose from 73.8% to 78.7% (2021 to 2024). Nigeria rose from 45.3% to 63.3%, Kenya from 79.2% to 90.1%, Egypt from 27.4% to 43.1% and India from 77.5% to 89%. Nigerian women lag at 52.2%, and only 9.1% of Nigerians borrowed formally. VERIFIED ([World Bank Little Data Book on Financial Inclusion 2025 [F]](https://thedocs.worldbank.org/en/doc/be6615202d1f08a25855c8ac2d615122-0050012025/related/Little-Data-Book-2025-Web.pdf)).
5. **Stablecoins grew fast to the GENIUS Act, then stalled.** USD stablecoin supply was $130bn at end-2023, $204bn at end-2024, $258bn when GENIUS was signed (18 Jul 2025) and $304bn at end-2025, then fell to about $295bn by 4 Nov 2026. Tether (USDT) and Circle's USD Coin (USDC) together hold about 84% of supply. PayPal's PYUSD is about $2.65bn and fell month on month. VERIFIED ([DefiLlama API [F]](https://stablecoins.llama.fi/stablecoincharts/all); [White House [F]](https://www.whitehouse.gov/fact-sheets/2025/07/fact-sheet-president-donald-j-trump-signs-genius-act-into-law/)).
6. **Retail CBDCs have stalled. Only 3 are live: the Bahamas, Jamaica and Nigeria.** The eNaira never got past "the initial wave of limited adoption". e-CNY is the exception, with 3.4bn transactions by Dec 2025 and more than 95% of mBridge volume. The digital euro targets a 2027 pilot and possible issuance in 2029. VERIFIED ([Atlantic Council [F]](https://www.atlanticcouncil.org/cbdctracker/); [IMF WP/23/104 [F]](https://www.imf.org/en/Publications/WP/Issues/2023/05/16/Nigerias-eNaira-One-Year-After-533487); [ECB [F]](https://www.ecb.europa.eu/euro/digital_euro/html/index.en.html)).
7. **African instant payments tripled in volume, but cross-border links are thin.** African instant payment systems (IPS) handled 19.7bn transactions in 2020 and 64.6bn in 2024 ($1.98trn). Only 11 of 36 live IPS support cross-border payments. Nigerian participants' PAPSS flows were just $143.4m (44,088 transactions) in 2025. VERIFIED/REPORTED ([AfricaNenda SIIPS 2025 [F]](https://africanenda.org/wp-content/uploads/siips_2025_ExecutiveSummary_en.pdf); [Leadership, citing the CBN 2025 Annual Report [F]](https://leadership.ng/e-payments-hit-n3-46quadrillion-amid-143-4m-pan-african-transactions-cbn/)).
8. **Mobile money passed 2bn registered accounts and 514m monthly active (2024), handling $1.68trn.** International remittances via mobile money were the fastest-growing use, reaching $34bn. VERIFIED ([GSMA SOTIR 2025 [F]](https://www.gsma.com/sotir/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf)).
9. **The US 1% remittance excise (IRC §4475, from OBBBA) has applied since 1 Jan 2026, but only to cash-funded transfers.** Transfers funded from bank accounts or US cards are excluded, so the tax pushes migrants toward digital providers. VERIFIED ([IRS IRB 2026-18 [F]](https://www.irs.gov/irb/2026-18_IRB); [IRS Notice 2025-55 [S]](https://www.irs.gov/pub/irs-drop/n-25-55.pdf)).
10. **Nigerian regulators shifted from blunt bans to conduct rules in 2024 to 2026.** Examples:
    - The CBN let banks open accounts for virtual-asset service providers (VASPs) again (Dec 2023).
    - It capped agent cash-outs (Dec 2024) and geo-fenced agents (Oct 2025).
    - It drafted reimbursement rules for authorised push payment (APP) fraud (Dec 2025).
    - The FCCPC's digital-lending (DEON) rules survived a court challenge (Jul 2026).

    VERIFIED ([CBN circulars [F]](https://www.cbn.gov.ng/api/GetAllCirculars); [FCCPC [F]](https://fccpc.gov.ng/fccpc-resumes-digital-lending-regulation/)).

---

## 2. Detailed findings

### 2.1 Instant payments: advanced economies

**FedNow (US).** Launched July 2023. Settled volume by year, from the Fed's own quarterly table [F]:

| Year | Payments | Value |
|---|---|---|
| 2023 (Q3+Q4) | 47,262 | about $18m |
| 2024 | about 1.51m | about $38.2bn |
| 2025 | about 8.41m | about $853bn |
| 2026 Q1–Q3 | about 14.1m | about $917bn |

Q3 2026 alone was 6.38m payments and $370.9bn, with daily volume around 69,300.

The average value per payment tells the story. It was $323 in Q1 2024 and $122,616 in Q3 2025, then fell back to $58,161 by Q3 2026. INTERPRETATION: a transaction-limit increase (reported in trade press [S]; exact date not verified here) plus liquidity-management-style use drove the jump, and FedNow became a corporate or liquidity rail. The fall since Q2 2026 suggests consumer and business use is finally widening.

Participant counts:
- 35 at launch and about 400 after six months [S] ([Digital Transactions](https://www.digitaltransactions.net/launched-in-july-fednow-hits-the-400-mark-in-number-of-participating-financial-institutions/)).
- About 1,200 by Jan 2025 [F] ([Payments Dive](https://www.paymentsdive.com/news/rtp-payments-surged-38-last-year/737000/)).
- Over 1,600 in early 2026 [S] ([Digital Transactions](https://www.digitaltransactions.net/fednow-tallies-more-than-1600-fis-in-its-real-time-payments-service)).
- Over 1,800 by July 2026 [F] ([KC Fed](https://www.kansascityfed.org/banking/community-banking-bulletins/highlight-smaller-institutions-embrace-faster-payments-with-fednow/)). Over 96% of these have less than $10bn in assets. Only 20.7% of about 8,500 small institutions participate, and only 13.6% of small credit unions.

Why it matters: many enrolments are receive-only (REPORTED in trade press, not quantified here). Network reach is therefore still not the same as consumer use.

**RTP (The Clearing House).**
- 2024: 343m transactions (+38%), $246bn, average $719, about 840 FIs [F] ([Payments Dive](https://www.paymentsdive.com/news/rtp-payments-surged-38-last-year/737000/)).
- Q2 2025: $481bn (+195% QoQ) and 107m+ payments, after the transaction limit rose to $10m in Feb 2025. More than 1,000 FIs live, and TCH says this is 98% of US instant bank-to-bank volume [F] ([TCH](https://www.theclearinghouse.org/payment-systems/Articles/2025/07/RTP-Q2-Value-Surge)).
- Value passed $1.3trn year-to-date by Nov 2025, +428% [S] ([CU Insight](https://www.cuinsight.com/press-release/a-november-to-remember-the-clearing-house-networks-shatter-records-as-digital-payments-surge-nationwide/)).
- Q1 2026: about 128m transactions and $480bn, against FedNow's 2.7m [S].

VERIFIED: RTP carries roughly 40 to 50 times FedNow's volume.

**Euro area (SEPA Inst and the Instant Payments Regulation).** The share of instant credit transfers among credit transfers processed by euro-area retail systems:

| Period | Share by number | Share by value |
|---|---|---|
| H1 2023 | 11% | 3% |
| H1 2025 | 23% | 7% |
| H2 2025 | 25% | 8% |

Sources: [ECB 2023 [F]](https://www.ecb.europa.eu/press/stats/paysec/html/ecb.pis2023~b28d791ed8.en.html), [ECB H1 2025 [F]](https://www.ecb.europa.eu/press/stats/paysec/html/ecb.pis2025h1~36edd636c8.en.html), [ECB H2 2025, published 22 Jul 2026 [F]](https://www.ecb.europa.eu/press/stats/paysec/html/ecb.pis2025h2~23986fb4a6.en.html).

Cause: the IPR mandated euro-area PSPs to receive instant payments by 9 Jan 2025, and to send them plus offer Verification of Payee (VoP) by 9 Oct 2025. Non-euro states have until 9 Jul 2027 for VoP [S] ([ECB IPR page](https://www.ecb.europa.eu/paym/retail/instant_payments/html/instant_payments_regulation.da.html)).

Even so, cards remained 57% of euro-area non-cash payments in H2 2025 [F]. INTERPRETATION: instant transfers are replacing slower transfers, not yet card checkout.

**Wero/EPI.**
- P2P launched in Belgium, France and Germany in 2024. EPI was authorised by the National Bank of Belgium on 20 Feb 2024. Its shareholders are 16 banks plus Nexi and Worldline [F] ([EPI](https://epicompany.eu/)).
- German e-commerce acceptance started around Nov 2025 with Sparkassen and Volksbanken, at merchants including Lidl, Rossmann and Decathlon. It reaches more than 40m base customers [S] ([mobiflip](https://www.mobiflip.de/wero-startet-im-onlinehandel-wer-mitmacht-und-wie-der-kaeuferschutz-funktioniert/)).
- DISPUTED timing: other reports gave summer 2026 for the e-commerce launch, and an earlier German delay was blamed on bank integrations [S].

Relevance to PayPal: Wero is an explicit European-sovereignty competitor to PayPal at checkout (INTERPRETATION).

**UK.** In 2025 there were 49.7bn payments. Debit cards were 26.6bn, Faster Payments plus other remote banking 6.2bn (second-largest method) and cash 3.9bn (8%). Faster Payments is forecast to reach 8.4bn by 2035 [F] ([UK Finance UK Payment Markets 2026](https://www.ukfinance.org.uk/system/files/2026-08/PaymentMarketsReport_2026Summary.pdf)).

The National Payments Vision (Nov 2024) aimed to make pay-by-bank ubiquitous. A year on, progress was uneven [F] ([TrueLayer](https://truelayer.com/blog/payments/one-year-of-the-national-payments-vision/)):
- Commercial variable recurring payments (VRP) slipped against the FCA's end-2025 target.
- "Certainty of fate" (merchant payment confirmation) was still undelivered.
- A Retail Payments Infrastructure Board now leads the work.

Pay.UK says current arrangements give core-system continuity "into the early 2030s" [S] ([Pay.UK](https://www.wearepay.uk/pay-uk-publishes-2025-annual-report/)). INTERPRETATION: the New Payments Architecture has been pushed out again.

**Australia.** The NPP processed about 1.6bn transactions in 2024 and about 2bn in 2025. It moves about A$7bn a day and carries about one in three account-to-account transactions [F] ([AP+](https://www.auspayplus.com.au/)).

### 2.2 Instant payments: emerging markets

**India (UPI).**
- Annual volume: 117.6bn (2023), 172.2bn (2024), about 228bn (2025, ₹≈300trn) [S] ([Business Standard](https://www.business-standard.com/industry/news/upi-ends-2025-strong-note-record-transactions-december-126010100687_1.html); [News On AIR](https://newsonair.gov.in/upi-transactions-surge-to-record-16-73-bn-in-dec-npci)).
- Oct 2026: 25.47bn transactions and ₹31.53 lakh crore (+23% volume YoY), averaging 822m a day. Daily value crossed ₹1 lakh crore for the first time [F] ([Entrepreneur India](https://india.entrepreneur.com/business-news/upi-hits-record-25-47-bn-transactions-in-october-daily-value-crosses-inr-1-l-cr)).

Two structural changes in 2026 [F]:
- **A first merchant discount rate (MDR):** 0.4% on person-to-merchant payments above ₹2,000, capped at ₹300. It was due 15 Oct 2026 and has been deferred until after Diwali.
- **Persistent duopoly:** PhonePe 45.6% and Google Pay 32.2% of volume.

Why: zero-MDR left banks and apps unable to fund fraud controls and uptime (INTERPRETATION; [National Herald [S]](https://www.nationalheraldindia.com/business/upi-ends-2025-at-record-highs-but-outages-fraud-and-fee-concerns-loom) flags outages, fraud and fee stress).

Findex shows the gap between access and use. Indian account ownership is 89%, but only 48.5% of adults made or received a digital payment in 2024 (up from 34.9%) [F].

**Brazil (Pix).** My own aggregation of BCB open data for September each year [F] ([BCB Dados Abertos](https://olinda.bcb.gov.br/olinda/servico/Pix_DadosAbertos/versao/v1/odata/EstatisticasTransacoesPix)):

| September of | Transactions | Value | P2B share |
|---|---|---|---|
| 2023 | 3.35bn | R$1.28trn | 33.5% |
| 2024 | 4.90bn | R$1.94trn | 39.9% |
| 2025 | 6.13bn | R$2.65trn | 43.4% |
| 2026 | 7.17bn | R$3.23trn | 46.5% |

Full year 2025: 79.8bn transactions (+25.7%) and R$35.4trn. The daily record was 313.3m on 5 Dec 2025. Pix was 54.7% of all payment transactions in H2 2025 [S] ([Diário do Comércio](https://diariodocomercio.com.br/?p=616704); [Band](https://www.band.com.br/economia/noticias/pix-lidera-pagamentos-no-brasil-com-547-das-transacoes-diz-banco-central-202604081055)).

Pix Automático (recurring payments) went live on 16 Jun 2025 after a delay from Oct 2024 [S] ([CNN Brasil](https://www.cnnbrasil.com.br/economia/macroeconomia/bc-atualiza-normas-do-pix-e-define-data-para-lancamento-da-modalidade-automatica/)). In the BCB data, the "AUTO" initiation code rose from 92k (Sep 2025) to 8.9m (Sep 2026), which is still only about 0.1% of volume [F]. INTERPRETATION: recurring payments and NFC "aproximação" are early, and cards and boletos still hold subscriptions.

**Nigeria (NIP).**
- NIBSS NIP value: N600.3trn (2023) and N1.078 quadrillion (2024) [S] ([Nairametrics](https://nairametrics.com/2025/01/29/e-payment-transactions-in-nigeria-hit-all-time-high-of-n1-07-quadrillion-in-2024)). Q1 2025 was about N285trn (+21.5% YoY) [S] ([Nairametrics](https://nairametrics.com/2025/07/26/e-payment-transactions-in-nigeria-hit-n284-9-trillion-in-q1-2025/)).
- AfricaNenda's case study [F] ([SIIPS 2025 NIP case study](https://africanenda.org/wp-content/uploads/siips_2025_NIP-Nigeria_CaseStudy_en.pdf)):
  - NIP volume grew to about 11bn transactions in 2024 (53% CAGR over five years), and value from $457bn to $1.1trn.
  - It has 57.7m unique users, about 52% of adults, and 699 direct and indirect participants.
  - Men account for 69% of volume and 81% of value.
- In Nov 2025 NIP became the first African IPS rated "Mature" on AfricaNenda's inclusivity spectrum [F] ([NIBSS](https://nibss-plc.com.ng/nigeria-emerged-the-winner-as-nibss-instant-payment-nip-attains-1st-instant-payment-system-ips-in-africa-to-reach-maturity-on-the-africanendas-ips-inclusivity-spectrum/)).
- The CBN 2025 Annual Report, as reported by Leadership [F] ([Leadership](https://leadership.ng/e-payments-hit-n3-46quadrillion-amid-143-4m-pan-african-transactions-cbn/)), shows:
  - Total e-payments of N3.458 quadrillion and 47.9bn transactions.
  - Mobile money operator (MMO) volume of 28.7bn (up from 17.3bn) and PoS volume of 15.7bn.
  - ATM volume up 61.9%. INTERPRETATION: cash demand persisted after the 2023 naira-redesign shock.

**Kenya.**
- Safaricom FY26 (to 31 Mar 2026) [F] ([Techweez](https://techweez.com/2026/05/07/safaricom-fy26-results/)): M-PESA revenue KES182.7bn (+13.4%), 45.6% of Kenya service revenue. It handled KES41.7trn and 46.4bn transactions (+25.1%).
- M-PESA has 43.7m 90-day active customers (+18%) and 3.13m merchants [S] ([People Daily](https://peopledaily.digital/business/m-pesa-processes-ksh41-7t-in-a-year-heres-where-the-money-went)). Fuliza disbursements were KSh1.47trn [S].
- CBK data [F] ([CBK](https://www.centralbank.go.ke/national-payments-system/mobile-payments/)):
  - Active agents went from 322,404 (Dec 2023) to 473,536 (Dec 2025) to 563,605 (Aug 2026).
  - Registered mobile money accounts went from 77.3m to 89.5m to 95.3m.
  - Monthly agent cash-in/out value fell from KSh788bn (Dec 2023) to KSh722bn (Dec 2025). INTERPRETATION: money is staying digital longer.

**Ethiopia.**
- Safaricom Ethiopia: 13.6m 90-day customers (+54%), but an EBIT loss of KES37.7bn [F].
- M-Pesa Ethiopia: 5.2m active users and 442m transactions. Telebirr (launched May 2021) has 58.6m subscriptions as of Dec 2025 [F] ([Ecofin](https://www.ecofinagency.com/news-digital/0805-55402-m-pesa-ethiopia-subscriber-base-jumps-120-to-5-2-million)).
- Findex: Ethiopia account ownership barely moved, from 46.5% to 48.8%, and only 9.5% have mobile money [F]. INTERPRETATION: the incumbent state telco's wallet dominates and broad inclusion lags.

**Egypt (InstaPay/IPN).**
- Launched 2022. P2P fees were waived for three years, and capped fees were introduced on 1 Apr 2025.
- An inbound cross-border use case launched in Dec 2024 [F] ([SIIPS Egypt case study](https://africanenda.org/wp-content/uploads/siips_2025_IPN-Egypt_CaseStudy_en.pdf)).
- Account ownership rose from 27.4% to 43.1% (2021 to 2024) [F].

**Ghana.** The 1% E-Levy on electronic transfers was abolished in the March 2025 budget, costing an estimated GH¢1.9bn in revenue. The government later claimed "We committed to Scrapping the E-Levy – We have delivered!" [F] ([MoF 2025 Budget Speech](https://mofep.gov.gh/sites/default/files/budget-statements/2025-Budget-Speech.pdf)). Account ownership rose from 68.2% to 81.2%, and 78.3% of adults have mobile money [F]. The FSB's Box 10 independently cites a "tax on digital financial transactions" as a cost driver in an SSA corridor [F].

**South Africa.** Findex shows account ownership slipping from 85.4% to 81.1%, and digital payments from 80.8% to 67.2% (2021 to 2024) [F]. This is DISPUTED or unclear: it may reflect survey effects rather than a real reversal. PayShap (launched March 2023) is still a small, cash-displacement-oriented rail. The SIIPS 2024 page notes that about 8 in 10 retail transactions were cash before COVID [F] ([SIIPS 2024](https://africanenda.org/siips/siips-2024-report)). The SARB opened consultation on "Vision 2030+" on 24 Feb 2026 [F] ([SARB](https://www.resbank.co.za/en/home/what-we-do/payments-and-settlements)). I could not obtain PayShap volumes (gap).

**Indonesia (QRIS).** Launched 17 Aug 2019. MDR is 0% for micro merchants on payments up to Rp500k and 0.3% above that. It links cross-border with Thailand's PromptPay, Malaysia's DuitNow and Singapore's NETS [F] ([Bank Indonesia](https://www.bi.go.id/en/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/default.aspx)). Account ownership is only 56.3% (2024) [F].

**Philippines.** Account ownership fell from 51.4% to 50.2% and digital payments from 43.5% to 40.3% (2021 to 2024) [F]. INTERPRETATION: post-COVID wallet churn. Thailand's PromptPay volumes were not retrievable (gap).

**Pan-African.**
- African IPS volume grew from 19.7bn (2020) to 64.6bn (2024), and value from $776bn to $1.98trn. Mobile-money IPS carry 50.3bn of those transactions [F] ([SIIPS 2025](https://africanenda.org/wp-content/uploads/siips_2025_ExecutiveSummary_en.pdf)).
- There are 36 live IPS in 31 countries, but only 11 enable cross-border payments.
- PAPSS supplied no data to SIIPS.
- Nigerian participants' PAPSS flows: $143.4m and 44,088 transactions in 2025 (up from $29.2m), with Nigerian participating banks falling from 22 to 20 [F] (Leadership/CBN). The PAPSS homepage publishes no volumes [F] ([papss.com](https://papss.com/)).

REPORTED: PAPSS remains tiny relative to Nigeria's diaspora inflows. Nigeria received about 38% of SSA remittances, over $20bn expected for 2023 [F] ([BusinessDay](https://businessday.ng/news/article/nigeria-ssa-peers-record-highest-remittance-costs-for-15th-straight-year/)).

**Asia (Project Nexus).**
- BIS announced Nexus's move to live implementation in Jul 2024 [S] ([BIS](https://www.bis.org/press/p240701.htm)).
- Nexus Global Payments (NGP) was incorporated in Singapore on 3 Apr 2025 as a not-for-profit. Its founders are the RBI, BNM, BSP, MAS and BoT, with the ECB and Bank Indonesia as observers. The BIS supports it until the first live transaction but is not an owner [F] ([Bank of Thailand](https://www.bot.or.th/en/news-and-media/news/news-20250403.html)).
- As of Nov 2026, the NGP site gives no go-live date [F] ([NGP](https://nexusglobalpayments.org/)). The first live Nexus transaction is not confirmed in my sources.

### 2.3 Cross-border payments and remittances

**FSB/CPMI G20 targets.** The FSB's consolidated report (9 Oct 2025) [F] ([FSB](https://www.fsb.org/uploads/P091025-1.pdf)) concludes: "It is unlikely that satisfactory improvements at the global level will be achieved in line with the 2027 Roadmap timetable." Remittance KPIs, taken from World Bank Remittance Prices Worldwide (RPW) data for Q1 of each year:

| KPI | 2023 | 2024 | 2025 |
|---|---|---|---|
| Average cost of a $200 remittance | 6.3% | 6.4% | 6.5% |
| Average cost of a $500 remittance | 4.3% | 4.3% | 4.3% |
| SmaRT average, $200 | 3.5% | 3.2% | 3.3% |
| Corridors with SmaRT above 5% | 20% | 17% | 19.3% |
| Services delivering within 1 hour | 52.6% | 53.1% | 54.4% |
| Services delivering within 1 day | 76.6% | 76.6% | 76.3% |

Further findings from the report:
- Digital services are cheaper than cash. Mobile money is the cheapest funding method and debit cards the cheapest payout method.
- Costs rose for every provider type in 2025 except money transfer operators (MTOs).
- SSA is the costliest region to receive in, at 8.8%, even though it is relatively fast.

Box 10's SSA corridor diagnostic lists the causes:
- reliance on USD cash;
- a tax on digital transactions;
- banks showing little interest in remittances;
- non-bank PSPs lacking direct access to payment systems, and being de-risked by banks;
- KYC burdens that exclude undocumented migrants.

The Dep. Secretary General said "the (G20) targets are not going to be hit by 2027" [S] ([PaymentsJournal/Reuters](https://www.paymentsjournal.com/g20-likely-wont-meet-goals-for-improving-cross-border-payments/)).

**World Bank RPW.**
- Global $200 average: 6.26% (Q4 2024), 6.49% (Q1 2025, Issue 53) [S] ([RPW Q1 2025, fetch blocked 403](https://remittanceprices.worldbank.org/sites/default/files/rpw_main_report_and_annex_q125_1_0.pdf)), 6.36% (Q3 2025). Digital was 4.59% and non-digital 7.30% [S] ([RemitRoutes](https://remitroutes.com/blog/world-bank-remittance-prices-report-april-2026)).
- SSA: 7.8% (Q2 2022) to 7.9% (Q2 2023), the most expensive region for the 15th year running, with fees up to 36% [F] ([BusinessDay](https://businessday.ng/news/article/nigeria-ssa-peers-record-highest-remittance-costs-for-15th-straight-year/)). It was 7.9% in Q4 2023 [S] ([Nairametrics](https://nairametrics.com/2024/06/30/diaspora-remittances-average-cost-of-sending-200-to-ssa-increases-to-7-9-in-2023-world-bank)).
- VERIFIED: still more than twice the SDG 10.c target of 3%.

**Remittance flows to LMICs.**
- 2023: $656bn (+0.7%) [S] ([World Bank, Jun 2024](https://www.worldbank.org/en/news/press-release/2024/06/26/remittances-slowed-in-2023-expected-to-grow-faster-in-2024)).
- 2024e: $685bn (+5.8%). India $129bn, Mexico $68bn, Philippines $40bn, Pakistan $33bn, SSA $56bn (+2.4%) [F] ([World Bank People Move, 18 Dec 2024](https://blogs.worldbank.org/en/peoplemove/in-2024--remittance-flows-to-low--and-middle-income-countries-ar)).
- 2025: $728.6bn per IFAD [S] ([APP](https://www.app.com.pk/?p=1277230)).

Note that KNOMAD ended in 2024 [S], so the long-running Migration and Development Brief series is discontinued and the evidence base is thinner.

**US remittance excise.**
- OBBBA was enacted on 4 Jul 2025. Its §4475 imposes 1% on remittance transfers made after 31 Dec 2025 where the sender provides "cash, a money order, a cashier's check, or other similar physical instrument" [F] ([IRS IRB 2026-18](https://www.irs.gov/irb/2026-18_IRB)).
- Transfers funded from accounts and US cards are excluded under §4475(d) [S].
- Proposed regulations (REG-114499-25) were published Apr 2026 [S] ([Federal Register](https://public-inspection.federalregister.gov/2026-07085.pdf)).
- Penalty relief for failing to deposit the tax covers Q1 to Q3 2026 [S] ([IRS Notice 2025-55](https://www.irs.gov/pub/irs-drop/n-25-55.pdf)).
- Digital remitters such as Remitly market themselves as exempt [S] ([Remitly](https://www.remitly.com/blog/money-transfer/federal-remittance-tax-guide)).

VERIFIED that the tax is 1% and cash-only. The brief's "1% excise" is correct, but it is not a general remittance tax. Higher rates in earlier drafts were not verified in this slice.

**SWIFT ISO 20022.** The MT/MX coexistence period for cross-border payment instructions (MT103/202, categories 1, 2 and 9) ended on 22 Nov 2025. Non-migrated MT payments are now rejected or handled only through costly emergency processing. MT exceptions and investigations retire by Nov 2027 [S] ([Deutsche Bank](https://corporate-bank.db.com/files/documents/publications/Deutsche-Bank-flow-briefing-ISO-20022-The-end-of-the-MT-coexistence-period-Mar-2025.pdf); [DPS](https://dps.de/en/news/iso-20022-only-100-days-left-until-the-end-of-mt-mx-coexistence/)).

INTERPRETATION: richer structured data helps screening, and FATF R.16 was revised alongside it [F, FSB]. It also raises fixed costs for small respondent banks, which adds to de-risking.

**Correspondent banking and de-risking.** The CPMI baseline: active correspondent relationships fell about 20% from 2011 to 2018, and the Americas outside North America lost about 30% [F] ([BIS 2019](https://www.bis.org/publications/new-correspondent-banking-data-decline-continues)). The FSB's 2025 Box 10 shows de-risking of non-bank PSPs in SSA is still a live cost driver [F]. Later commentary documents continued contraction in Africa, the Caribbean, Eastern Europe and the Pacific [S] ([The Paypers](https://thepaypers.com/fraud-and-fincrime/expert-views/how-aml-de-risking-is-reshaping-correspondent-banking-evolution-risk-and-the-road-ahead)). A stablecoin vendor claims that "127 banks exited emerging markets in 2025". I could not verify this, and the page 404'd on fetch; treat it as marketing (DISPUTED/unverified). Gap: I found no fresh CPMI relationship counts for 2023 to 2026.

**mBridge.**
- The BIS "graduated out" of mBridge on 31 Oct 2024. Carstens said "mBridge is not a BRICS bridge". Participants are China, Hong Kong, Thailand and the UAE, and the minimum viable product (MVP) dates from Jun 2024 [F] ([Fintech News SG](https://fintechnews.sg/102951/payments/bis-exits-project-mbridge/)).
- Saudi Arabia joined in Jun 2024, completed a proof of concept on 13 May 2025, and later said it is no longer a participating member [S] ([Crowdfund Insider](https://www.crowdfundinsider.com/2026/09/312023-saudi-arabia-ends-public-role-in-china-linked-mbridge-cbdc-platform-after-completing-trial/)).
- e-CNY is more than 95% of mBridge settlement volume [F] (Atlantic Council).

INTERPRETATION: mBridge is now effectively a China-led wholesale rail.

### 2.4 Stablecoins

**Supply, from the DefiLlama API, USD-pegged** [F] ([chart](https://stablecoins.llama.fi/stablecoincharts/all)):

| Date | Supply |
|---|---|
| 1 Jan 2023 | $137.4bn |
| 31 Dec 2023 | $130.0bn (post-FTX and BUSD wind-down) |
| 31 Dec 2024 | $203.8bn |
| 18 Jul 2025 (GENIUS signed) | $257.7bn |
| 31 Dec 2025 | $304.4bn |
| 30 Jun 2026 | $304.1bn |
| 4 Nov 2026 | $295.1bn |

Current issuers [F] ([list](https://stablecoins.llama.fi/stablecoins?includePrices=true)): USDT $177.7bn (about 60%) and USDC $71.2bn (about 24%). PYUSD is $2.65bn, down from $2.89bn the previous month, comparable to USDG at $2.75bn and RLUSD at $2.59bn. EURC is about €0.51bn.

INTERPRETATION: regulation produced a 2025 surge and then a 2026 plateau. Concentration in two issuers persists, and euro stablecoins are marginal despite MiCA.

**Regulation.**
- **GENIUS Act (US), signed 18 Jul 2025:**
  - 100% reserves in liquid assets, with monthly disclosure;
  - holders have priority in insolvency;
  - the Bank Secrecy Act (BSA) applies;
  - issuers must be able to freeze or burn tokens [F] ([White House](https://www.whitehouse.gov/fact-sheets/2025/07/fact-sheet-president-donald-j-trump-signs-genius-act-into-law/)).
- **MiCA (EU):** in force Jun 2023, full application 30 Dec 2024, grandfathering until 1 Jul 2026 [F]. The earlier application date for the stablecoin titles was not verified here ([ESMA](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)).
- **BIS (2023 survey, published Jun 2024):** "stablecoins are rarely used for payments outside the crypto ecosystem", and about 2 in 3 jurisdictions have or are building stablecoin frameworks [F] ([BIS Paper 147](https://www.bis.org/publ/bppdf/bispap147.htm)).
- **Nigeria:** the CBN reversed its 2021 ban on bank accounts for crypto service providers in Dec 2023 [F] ([CBN VASP guidelines](https://www.cbn.gov.ng/Out/2024/FPRD/GUIDELINES%20ON%20OPERATIONS%20OF%20BANK%20ACCOUNTS%20FOR%20VIRTUAL%20Asset%20Providers.pdf)).

**Payments use.**
- Stripe completed its Bridge acquisition on 4 Feb 2025 (announced Oct 2024): "stablecoins will play a critical role in turbocharging cross-border commerce" [F] ([Stripe](https://stripe.com/newsroom/news/stripe-completes-bridge-acquisition)).
- PayPal launched PYUSD on 7 Aug 2023 [S] ([PayPal](https://newsroom.paypal-corp.com/2023-08-07-PayPal-Launches-U-S-Dollar-Stablecoin)), allowed it as a Xoom funding source from Apr 2024 [S] ([PayPal](https://newsroom.paypal-corp.com/2024-04-04-Xoom-Enables-PayPal-USD-as-a-Funding-Option-for-Cross-Border-Money-Transfers)), and planned Stellar use cases from Jun 2025 [S].
- The FSB (Oct 2025) says the role of stablecoins in fixing cross-border inefficiencies "remains uncertain, especially at origination and receipt points" [F] ([The Paypers](https://thepaypers.com/payments/news/g20-expected-to-miss-2027-target-for-cross-border-payment-reforms)).
- UK Finance (Aug 2026) now names "tokenised deposits and regulated stablecoins" as a next growth driver [F].

### 2.5 CBDCs

- **Atlantic Council (May 2026)** [F] ([tracker](https://www.atlanticcouncil.org/cbdctracker/)):
  - 146 jurisdictions are exploring a CBDC (98% of GDP), up from 87 in May 2022.
  - 77 are in development, pilot or launch, with 41 pilots and 3 launched.
  - e-CNY reached 3.4bn retail transactions worth RMB16.7trn by Dec 2025. In Jan 2026 the PBOC reclassified it as deposit liabilities.
  - The US is the only G20 country not exploring a CBDC.
- **BIS (2023 survey):** 94% of central banks are exploring, and wholesale is now seen as more likely than retail within six years [F].
- **eNaira:** the IMF (May 2023) found adoption had "not moved beyond the initial wave of limited adoption" because of weak network effects [F] ([IMF](https://www.imf.org/en/Publications/WP/Issues/2023/05/16/Nigerias-eNaira-One-Year-After-533487)). The CBN tried an eNaira payout option for diaspora remittances (Jun 2023 circular) [F, CBN circular list]. SIIPS 2025 says eNaira data is folded into NIP and that it is Africa's only sovereign-digital-currency IPS [F]. VERIFIED: the eNaira is a failed retail product, and the tracker lists it as launched in name only.
- **Digital euro:** the ECB moved to the next phase in Oct 2025. Rulebook v0.91 came out in Jul 2026, and network service providers were selected on 30 Oct 2026. A pilot is planned for 2027 and possible first issuance for 2029, assuming EU legislation passes in 2026 [F] ([ECB](https://www.ecb.europa.eu/euro/digital_euro/html/index.en.html)).
- **India e-rupee:** not verified in this slice (gap).

### 2.6 Financial inclusion

**Findex 2025 (2024 data), from the Little Data Book 2025** [F] ([World Bank](https://thedocs.worldbank.org/en/doc/be6615202d1f08a25855c8ac2d615122-0050012025/related/Little-Data-Book-2025-Web.pdf); [Findex hub [F]](https://www.worldbank.org/en/publication/globalfindex)). Account ownership, 2021 to 2024:

| Economy | 2021 | 2024 | Other figures |
|---|---|---|---|
| World | 73.8% | 78.7% | 15.3% have mobile money |
| LMICs | 69.0% | 75.4% | digital payments 54.8% to 62.1%; women 73.0%; 64.3% own a smartphone |
| SSA | 49.3% | 58.2% | 40.0% mobile money; women 52.3%; 12.4% borrowed formally; 32.9% own a smartphone |
| Nigeria | 45.3% | 63.3% | women 52.2%; digital merchant payments 9.1% to 28.4%; formal saving 17.9% to 43.4%; formal borrowing 9.1% against 78.9% borrowing any way; 28.5% financially resilient |
| Kenya | 79.2% | 90.1% | 87.5% mobile money |
| Ghana | 68.2% | 81.2% | |
| Senegal | 56.0% | 76.5% | |
| Tanzania | 52.4% | 59.8% | |
| Egypt | 27.4% | 43.1% | |
| Ethiopia | 46.5% | 48.8% | |
| South Africa | 85.4% | 81.1% | |
| India | 77.5% | 89% | |
| Brazil | 84.0% | 86.4% | |
| Indonesia | 51.8% | 56.3% | |
| Mexico | 49.0% | 53.0% | |
| Philippines | 51.4% | 50.2% | |
| Pakistan | 21.0% | 27.3% | women 11.9% |
| Bangladesh | 52.8% | 43.3% | |

The Findex hub also reports that saving in an account in developing economies reached 40%, up 16 points: "the fastest rise in more than a decade" [F].

INTERPRETATION: new inclusion is overwhelmingly through mobile money and fintech accounts. Nigeria's 18-point jump coincides with the 2023 cash crunch and fintech or PSB onboarding. Use of credit has not followed access.

**GSMA State of the Industry Report (SOTIR) on mobile money** [F]:
- **2024 edition (2023 data):** 1.75bn registered accounts (+12%, down from 15% in 2022 and 19% in 2021), about 435m monthly active (+9%), $1.4trn processed, international remittances about $29bn, merchant payments about $74bn ([SOTIR 2024](https://www.gsma.com/sotir/wp-content/uploads/2024/03/GSMA-SOTIR-2024_Report.pdf)).
- **2025 edition (2024 data):** 2.1bn registered (+14%) and 514m monthly active (+11%). About 108bn transactions worth $1.68trn. Merchant payments exceeded $100bn (+21%) and international remittances reached $34bn. SSA has more than 1bn registered accounts, about two-thirds of new accounts ([SOTIR 2025](https://www.gsma.com/sotir/wp-content/uploads/2025/04/The-State-of-the-Industry-Report-2025_English.pdf)).
- DISPUTED: active-account baselines were restated between editions. 435m for 2023 in the 2024 edition is inconsistent with 514m being +11% in the 2025 edition.
- The 2026 edition was not retrievable (gap); the gsma.com HTML is behind Cloudflare.
- The 2023 edition was not retrieved.

**Africa fintech funding (Partech)** [F]:
- 2024: $3.2bn total (-7% from $3.5bn), 534 deals. Fintech was about 60% of equity, about $1.3 to 1.4bn (the report is internally inconsistent) ([Partech 2024](https://partechpartners.com/africa-reports/2024-africa-tech-venture-capital-report)).
- 2025: $4.1bn (+25%), "strongest since 2022". Equity $2.41bn, record debt $1.64bn ([Partech 2025](https://partechpartners.com/africa-reports/2025-africa-tech-venture-capital-report)).
- Fintech fell to $1.49bn (-12%) in 2025, and fintech equity to $769m (-43%).
- By country in 2025: Kenya $1.04bn (+72%), South Africa $715m, Egypt $604m, Nigeria $572m (-3%).

INTERPRETATION: Nigeria lost its funding lead amid naira devaluation, and capital is shifting to debt and to energy and climate tech in Kenya. Briter Bridges and Africa: The Big Deal were not fetched (search budget exhausted).

**Digital lending abuses and regulation (Nigeria).**
- The FCCPC's Digital, Electronic, Online or Non-Traditional Consumer Lending (DEON) Regulations 2025 were suspended by an interim court order in Apr 2026 after WASPAN sued. The Federal High Court in Lagos (FHC/L/CS/760/2026) dismissed the suit, upheld the rules and discharged the order. The FCCPC resumed enforcement on 20 Jul 2026 [F] ([FCCPC](https://fccpc.gov.ng/fccpc-resumes-digital-lending-regulation/)).
- The FCCPC register has about 1,050 table rows of approved apps, 74 conditional approvals, 228 entries on a watchlist, 112 delisted apps and 70 CBN-licensed waivers. These are row counts and include headers [F] ([FCCPC register](https://fccpc.gov.ng/registration-of-digital-money-lenders/approvals-of-dmls/)).
- The watchlist and delisted lists are evidence of continuing predatory apps.
- Kenya's ODPC loan-app enforcement could not be fetched; the site sits behind a bot wall (gap).

**MSME credit gap (IFC):** not retrieved; the SME Finance Forum page carried no figures (gap).

### 2.7 Nigeria regulatory timeline (from CBN's own circular API [F])

Source: ([CBN API](https://www.cbn.gov.ng/api/GetAllCirculars)).

- **21 Jan 2023:** Naira redesign "Cash Swap Programme" in rural and underserved areas.
- **8 Mar 2023:** Operational guidelines for open banking.
- **9 Mar 2023:** Agent banking framework (exposure draft).
- **15 Jun 2023:** eNaira payout option for diaspora remittances.
- **12 Jul 2023:** Naira payout option for diaspora remittances.
- **31 Jul 2023:** Microfinance banks (MFBs) and primary mortgage banks (PMBs) exempted from cash withdrawal limits.
- **13 Sep 2023:** International money transfer operator (IMTO) rate conduct.
- **22 Dec 2023:** VASP bank accounts permitted.
- **31 Jan 2024:** Revised IMTO guidelines, and removal of the exchange-rate band for IMTOs.
- **28 Mar 2024:** Bank recapitalisation.
- **May 2024:** Cybersecurity levy implementation circular (6 May), followed by a withdrawal circular (17 May).
- **17 Dec 2024:** Agent cash-out limits [F]: N100k per customer per day at agents, N500k per customer per week across all channels, N1.2m per agent per day, merchant category code 6010, and daily reporting to NIBSS.
- **6 Oct 2025:** Agent banking guidelines [F]: each agent exclusive to one principal, PoS terminals geo-fenced, and integration with the CBN's CARDS system.
- **1 Dec 2025:** APP fraud reimbursement exposure draft [F]: report within 72 hours, reimbursement within 16 working days, and shared liability between sending and receiving institutions.
- **24 Mar 2026:** "Measures to further deepen diaspora remittances" (scanned PDF; contents not extracted).

Not verified in this slice:
- The Supreme Court ruling and the 2023 cash-crunch magnitudes.
- FX limits on naira cards abroad, which were bank-level suspensions in 2023–24.
- Dollar virtual-card shutdowns.
- Payment Service Bank (PSB) performance metrics.

**PayPal in Nigeria and Africa.**
- Paga's "Paga x PayPal" page lets Nigerians link PayPal to receive international payments and withdraw in naira or USD. Topping up PayPal from Paga is "coming soon". Paga Remit, a CBN-licensed IMTO, "provides limited access … for PayPal account holders" [F] ([Paga](https://www.mypaga.com/pagapaypal)). Launch date not verified.
- PayPal committed $100m to the Middle East and Africa (24 Sep 2025) via Ventures stakes in Tabby, Paymob and Stitch, with no Nigeria-specific item [F] ([PayPal](https://newsroom.paypal-corp.com/2025-09-24-PayPal-Commits-100-Million-to-Accelerate-Digital-Growth-Across-the-Middle-East-and-Africa)).
- PayPal World (announced 23 Jul 2025) links UPI, Tenpay/Weixin Pay, Mercado Pago (MoU), PayPal and Venmo, about 2bn users. No African wallet is among the launch partners [F] ([PayPal](https://newsroom.paypal-corp.com/2025-07-23-Introducing-PayPal-World-a-global-platform-connecting-the-worlds-largest-payment-systems-and-digital-wallets,-starting-with-interoperability-to-PayPal-and-Venmo)).

---

## 3. Contradictions and disputed claims

- **SSA remittance cost.** The FSB gives SSA's $200 cost as 8.8% (2025) [F]. The Paypers' summary of the same FSB report says "fees in sub-Saharan Africa average 4%, up from 3.2%" [F]. That probably confuses a different KPI, such as SmaRT or P2B. Trust the FSB primary figure.
- **Global remittance cost trend.**
  - The FSB KPI (Q1 data) shows 6.3%, 6.4%, 6.5%, i.e. rising slightly.
  - RPW Q3 2025 is 6.36% [S], and BusinessDay cites "above 6.9%" for an earlier quarter.
  - These are quarter-specific series, so do not mix them.
- **2023 remittance flows** were first $656bn (Jun 2024) [S]. The Dec 2024 blog implies 1.2% growth in 2023, a revised base [F]. Revisions are routine.
- **Nigeria NIP values.** NIBSS gives N1.078 quadrillion for 2024. A Vanguard analysis cited about N105trn [S]. The CBN annual report gives total e-payments of N3.458 quadrillion for 2025. That is a different aggregate (all channels, with possible double counting), so it is not comparable with NIP.
- **Wero e-commerce start:** Nov 2025 [S] or a "summer 2026" plan [S]. Probably a staggered rollout by bank group.
- **GSMA active accounts:** restated between editions (see 2.6).
- **Safaricom net profit:** about KES99.7bn, ~100bn or 118.4bn in different outlets [S]. The KES119.1bn (Kenya-only net income) in Techweez [F] is a different perimeter.
- **mBridge exit motive:** the BIS says maturity [F]. Some outlets allege US pressure [S]. No primary evidence for pressure was found.
- **South Africa and Philippines Findex declines:** these may be a methodology or survey artefact rather than real exclusion. INTERPRETATION, unresolved.

---

## 4. How things evolved, year by year

| Theme | 2023 | 2024 | 2025 | 2026 (to Nov) |
|---|---|---|---|---|
| US instant payments | FedNow launch (Jul), 47k payments; RTP about 249m (derived from +38% in 2024) | FedNow 1.5m; RTP 343m, $246bn | FedNow 8.4m, $853bn; RTP limit $10m, >$1.3trn | FedNow 14.1m in Q1–Q3; >1,800 FIs |
| UPI | 117.6bn | 172.2bn | about 228bn | 25.5bn in Oct alone; MDR planned then deferred |
| Pix (Sep month) | 3.35bn | 4.90bn | 6.13bn; Pix Automático (Jun) | 7.17bn; P2B 46.5% |
| SEPA Inst share | 11% (H1) | IPR receive mandate approaching (9 Jan 2025) | 23% (H1); send + VoP (9 Oct) | 25% (H2-25 data) |
| $200 remittance cost (FSB) | 6.3% | 6.4% | 6.5%; FSB says 2027 targets will be missed | US 1% cash-remittance tax live (1 Jan) |
| Stablecoins (USD) | $130bn (falling) | $204bn; Stripe–Bridge announced | $304bn; GENIUS (18 Jul); MiCA full | about $295bn (flat/down) |
| CBDC | eNaira stalls; naira-redesign crisis | BIS exits mBridge (Oct) | Saudi completes PoC; digital euro next phase | e-CNY reclassified; digital euro pilot prep |
| Inclusion | — | Findex fieldwork (2024 data) | Findex 2025 published; 79% global | — |
| Mobile money | 1.75bn accounts, $1.4trn | 2.1bn, $1.68trn | SOTIR 2025 | (2026 edition not retrieved) |
| Africa VC (Partech) | $3.5bn | $3.2bn | $4.1bn; fintech -12% | — |
| Nigeria rules | Open banking, cash swap, eNaira payout | VASP accounts, IMTO reform, recapitalisation, agent cash-out limits | Agent guidelines, APP-fraud draft, DEON regs | DEON upheld in court (Jul) |

Direction of change (INTERPRETATION):
- 2023 was about crisis and launch: the naira redesign, FedNow, the stablecoin trough.
- 2024 was about mandates and regulation catching up: IPR, MiCA, CBN liberalisation.
- 2025 was the peak policy year: GENIUS, the IPR deadlines, the end of ISO 20022 coexistence, the FSB admitting the targets will be missed, the OBBBA remittance tax.
- 2026 is about monetisation and consolidation:
  - UPI MDR plans and Egypt InstaPay fees;
  - the stablecoin supply plateau;
  - court-tested lending rules;
  - FedNow finally gaining volume.

---

## 5. Implications for PayPal and the wider industry

1. **Public instant rails are commoditising P2P and checkout in PayPal's growth markets** (VERIFIED trend, INTERPRETATION of impact):
   - Pix P2B reached 46.5%, and Pix accounts for 54.7% of all Brazilian payment transactions.
   - UPI is at about 25bn a month.
   - Wero is entering German e-commerce, and SEPA Inst holds a 25% share.

   PayPal's answer, PayPal World (UPI, Weixin Pay, Mercado Pago), concedes that it must interoperate rather than compete in those markets.
2. **Fee pressure cuts both ways.** UPI's planned 0.4% MDR and InstaPay's fees from Apr 2025 show "free" rails need revenue (INTERPRETATION). That narrows, but does not close, the price gap against wallets that charge fees.
3. **Cross-border is still costly and slow for Africa.** The 8.8% SSA cost and only 11 of 36 IPS linked cross-border mean Xoom and PayPal's inbound and outbound remittance business there still has margin room. But regulators (FSB, CBN) now push non-bank access and reimbursement duties.
4. **Stablecoins are concentrated, and PYUSD is small (about 0.9% of supply) and shrinking month on month** [F]. GENIUS gives clarity, but distribution and acceptance at the endpoints remain the bottleneck (FSB). PayPal's advantage would be on-ramps and off-ramps and merchant acceptance, not issuance (INTERPRETATION).
5. **US policy favours digital remitters.** The cash-only 1% tax nudges senders toward account- or card-funded services like Xoom, Remitly and Wise (INTERPRETATION).
6. **Nigeria access is via partners.** Paga x PayPal gives receive-and-withdraw, with top-up "coming soon". Nigerian users remain second-class PayPal users in practice: limited services through a licensed IMTO intermediary [F].

---

## 6. Still broken as of Nov 2026 (evidence-backed)

- **Remittance cost.** Global $200 cost is about 6.4–6.5%, SSA 8.8%, and corridors with SmaRT above 5% rose to 19.3%. The 2027 G20 and 2030 SDG targets will be missed [F, FSB].
- **African cross-border interoperability.** Only 11 of 36 IPS are cross-border. PAPSS flows from Nigerian participants were $143m in 2025, and PAPSS gave SIIPS no data [F].
- **Non-bank access and de-risking.** Non-bank PSPs lack direct access to payment systems and are treated as high-risk by banks [F, FSB Box 10].
- **Gender gaps.** Nigerian women's account ownership is 52.2% against 63.3% overall. Men are 69% of NIP volume and 81% of value. Pakistani women's account ownership is 11.9% [F].
- **Credit after access.** Only 9.1% of Nigerians borrowed formally, while 78.9% borrowed somehow. Only 28.5% of Nigerians are financially resilient [F]. Predatory apps persist: 228 watchlist entries and 112 delisted apps on the FCCPC register [F].
- **Fraud on instant rails.** Nigeria's APP reimbursement rule is still an exposure draft (Dec 2025) [F]. The UK's "certainty of fate" is undelivered [F]. UPI fraud and outage stress were flagged [S].
- **CBDCs.** Retail CBDCs remain unused: the eNaira, and the 3 launches worldwide [F].
- **US FedNow reach.** About 79% of small institutions are not on FedNow, and its average payment is $58k, so it is not a consumer rail yet [F].
- **Cash persistence in Nigeria.** ATM volume rose 61.9% in 2025, and the CBN is still rationing agent cash-outs [F].

---

## 7. Opportunity signals (all SPECULATIVE)

1. **A digital-first US-to-Nigeria remittance product built for former cash senders.** Fund from a US debit card or account (exempt from the §4475 1% tax) and pay out instantly over NIP, which reaches 57.7m users. Basis: IRS IRB 2026-18 and the SIIPS NIP case study. The cash-to-digital shift is a policy tailwind, and SSA's 8.8% cost leaves margin.
2. **Payee confirmation and APP-fraud tooling for Nigerian FIs, in the style of VoP.** The CBN's draft requires reimbursement within 16 working days and shared liability between sending and receiving institutions. The EU made VoP mandatory on 9 Oct 2025. Banks, MFBs and PSBs will need name-matching, mule-account detection and dispute workflows. Basis: CBN APP draft and ECB IPR.
3. **Agent-network compliance SaaS.** The CBN now requires agent exclusivity, geo-fenced PoS, CARDS integration, daily NIBSS reporting and cash-out caps. Super-agents and payment terminal service aggregators (PTSAs) need software for these. Kenya has 564k active agents, so it is a second market. Basis: CBN Oct 2025 and Dec 2024 circulars, CBK statistics.
4. **Compliant digital-lending infrastructure.** The DEON rules were upheld in court, and only 9.1% of Nigerians borrow formally. Possible products: a registry-checked lending-as-a-service platform, ethical-collections tooling, or cash-flow underwriting from NIP and mobile-money data for FCCPC-approved lenders. Basis: FCCPC, Findex.
5. **An intra-African B2B settlement layer for SMEs.** Possible services: corridor FX, pre-funding and reconciliation on top of PAPSS, regional IPS and mobile-money IPS. Basis: only 11 of 36 IPS cross-border, PAPSS volume tiny, mobile-money international remittances at $34bn and the fastest-growing use.
6. **Products designed for women.** Women's accounts lag by about 11 points in Nigeria, and men dominate NIP volume. Possible products: savings pots, merchant tools for women-run micro-businesses and agent networks staffed by women. Basis: Findex and the SIIPS gender split.
7. **Merchant acceptance and QR in Nigeria.** Digital merchant payments tripled from 9.1% to 28.4% of adults (2021 to 2024). PoS is at 15.7bn transactions a year. Basis: Findex, CBN annual report. The QRIS model of a free MDR tier for micro merchants is worth studying (Bank Indonesia).
8. **Freelancer and creator payouts combining PayPal and stablecoins with naira or USD withdrawal.** Paga x PayPal shows demand. The CBN's VASP-account reversal plus GENIUS-compliant USDC or PYUSD create a regulated path. Risk: stablecoin supply is plateauing and FX rules keep changing. Basis: Paga page, CBN VASP circular, DefiLlama.
9. **Recurring payments on instant rails.** Pix Automático is only about 0.1% of Pix volume a year after launch, and UK commercial VRP slipped. Subscription and billing orchestration on account-to-account rails is early everywhere. Basis: BCB data, TrueLayer.

---

## 8. Coverage self-audit

**Covered with primary or fetched evidence:**
- FedNow (Fed data); RTP (TCH); SEPA Inst (ECB); UK (UK Finance); Australia (AP+).
- Pix (BCB API); UPI (press, fetched).
- Nigeria NIP (AfricaNenda, CBN via Leadership); Kenya (CBK, Safaricom via press); Ethiopia; Egypt; Ghana (MoF).
- QRIS (Bank Indonesia); Nexus (Bank of Thailand, NGP); PAPSS; African IPS (SIIPS).
- FSB 2025 KPIs; remittance flows (World Bank); US remittance tax (IRS); mBridge; correspondent baseline (BIS).
- Stablecoin supply (DefiLlama); GENIUS; MiCA; Stripe/Bridge.
- CBDCs (Atlantic Council, BIS, ECB, IMF).
- Findex 2025, with country tables; GSMA SOTIR 2024 and 2025; Partech 2024 and 2025.
- FCCPC DEON; the CBN regulatory timeline; PayPal and Paga.

**Snippet-only or partial:**
- UPI annual totals (press); Pix annual totals; Pix Automático launch date.
- RTP 2025 full-year and 2026; FedNow participant milestones before 2026.
- RPW quarterly figures (the World Bank RPW PDF returned 403); ISO 20022 cutover; Saudi exit from mBridge.
- IFAD 2025 remittance figure; Fuliza.

**Gaps (unfilled because the search budget was exhausted mid-task; known URLs were blocked or unknown):**
- GSMA SOTIR 2023 and 2026 editions; Briter Bridges and Africa: The Big Deal.
- Thailand PromptPay statistics; PayShap volumes; Philippines InstaPay/QR Ph.
- India e-rupee circulation; e-CNY beyond the Atlantic Council figures.
- Nigeria:
  - naira redesign impact numbers and the Supreme Court ruling (3 Mar 2023);
  - FX limits on naira cards abroad and dollar virtual-card shutdowns (2023–24);
  - PSB licensing and performance.
- Kenya loan-app harassment (ODPC enforcement); IFC MSME finance gap.
- Wise pricing and mission metrics (owners.wise.com returned 403); Visa stablecoin settlement.
- Fresh CPMI correspondent banking counts; the contents of the CBN's Mar 2026 diaspora circular (scanned PDF).

**Blocked sites:** remittanceprices.worldbank.org (403), gsma.com HTML (Cloudflare), owners.wise.com (403), payshap.co.za (403), npci.org.in (403/JS), safaricom.co.ke (403), odpc.go.ke (bot wall), the FSB HTML page (404; I used the PDF instead), business-standard (403), paymentexpert (403).

These gaps should be filled by other slices or a follow-up session with search budget.
