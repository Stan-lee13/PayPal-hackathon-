# An agent subscribes with its own card, then ends the subscription itself

Run on 11 November 2026 against the real PayPal sandbox. The agent was a language model (Claude Haiku, through the Claude Code command line) using the Envelope MCP server (`scripts/mcp.ts`) with its own key on disk. It was given four tools: `envelope_balance`, `envelope_card_issue`, `envelope_card_list`, `envelope_card_cancel`. The merchant's side was run from the command line with the merchant's own key. Nothing was scripted on the agent's side.

| | |
|---|---|
| Owner's hold | Dana sealed $40.00: PayPal authorization `9W7659235B003944P` |
| The agent's allowance | $30.00 paid from that hold into research-agent's account: capture `0DY50111BH3445144`, credited to its balance, no payout |
| The owner's rule on the account | at most $30.00 in one payment |
| Merchant | lexica-pro, account `acct:nc4p-nxbf-x213`, income paid straight out by PayPal |
| Card the model issued | `card_vPxMYb-wC1E-sKlM`, shown as `XNC5 D648 DBAE 3102`: $9.00 a charge, 2 charges, one per 30 days, expires 12 January 2027 |
| Month 1, charged by the merchant | charged: PayPal payout `SKTPQ2DFR837J`, `PENDING` at the time, `SUCCESS` when asked a few minutes later; receipt signature valid |
| Merchant charges again at once | declined: `CHARGE_TOO_SOON` (next charge allowed from 11 December) |
| Merchant charges $19.00 | declined: `OVER_CARD_LIMIT` |
| A key that is not the merchant's charges $9.00 | declined: `NOT_THE_MERCHANT` |
| The model is told the study is cancelled | it listed its cards, then cancelled the card |
| Merchant charges after that | declined: `CARD_CANCELLED` |
| End | balance $21.00; the books: $30.00 in, $9.00 out, $21.00 held, all three checks passing; the hold was closed with $30.00 captured and $10.00 released |

The placeholder address used for the merchant's and the owner's PayPal (`translator@example.com`) happens to have a sandbox account, which is why PayPal reported the payout as delivered.

## What the model was told, and what it answered

**First instruction**

> You are research-agent, an AI agent that works for Dana. You have an account of your own with a balance. For a study that will run exactly two months you need Lexica Pro, a terminology service that costs $9.00 a month. Its merchant account is acct:nc4p-nxbf-x213. Dana will not hand over her bank card, and she does not want anything charged after the study ends. Set this up with your tools so that Lexica Pro can bill you for the two months and nothing more. Then report in a few plain sentences: what you did, the card id to give the merchant, and what the most is that this can ever cost.

**The model (5 turns)**

> Lexica Pro is set up for two monthly charges of $9.00 and nothing more. I issued a card on my own balance locked to merchant acct:nc4p-nxbf-x213. It allows at most $9.00 per charge, two charges total, one charge every 30 days, and it expires on 2027-01-12. Dana's bank card was not involved.
>
> **Card id to give the merchant: `card_vPxMYb-wC1E-sKlM`**
>
> **The most this can ever cost is $18.00** (2 × $9.00). The card ends itself after the second charge or on expiry, and the merchant can't charge it again after that. I didn't check the envelope's own limits because my permission to read them was declined, but the card was issued and confirmed by the gateway.

(The last sentence refers to a tool the model tried that was not among the four it was allowed.)

**Second instruction**, after the merchant's charges above

> You are research-agent, an AI agent that works for Dana. Earlier you subscribed to Lexica Pro with a card on your own balance. Dana has just told you the study is cancelled after its first month. Make sure Lexica Pro cannot charge you again, then report in two or three plain sentences what you checked, what you did, and what the subscription cost in the end.

**The model (5 turns)**

> I cancelled the Lexica Pro card (XNC5 D648 DBAE 3102), so the merchant can no longer charge it. I checked the card list first, which showed one active card for lexica-pro at $9.00 a charge with 1 of 2 charges used. The subscription cost $9.00 in total: the one charge that went through, with no further charges coming.

## The merchant's side

```
--- merchant charges month 1
PAYOUT_PENDING: charged $9.00. Charge 1 of 2.
  PayPal payout SKTPQ2DFR837J (PENDING)
--- merchant charges again at once
DECLINED. Nothing moved.
  CHARGE_TOO_SOON: The card was charged too recently: it allows one charge per billing period. (the next charge is allowed from 2026-12-11T15:35:21.283Z)
--- merchant overcharges
DECLINED. Nothing moved.
  OVER_CARD_LIMIT: The amount is over the card's cap per charge. ($19.00 is over the card's $9.00 per charge)
  CHARGE_TOO_SOON: The card was charged too recently: it allows one charge per billing period. (the next charge is allowed from 2026-12-11T15:35:21.283Z)
--- a key that is not the merchant
DECLINED. Nothing moved.
  NOT_THE_MERCHANT: Only the merchant a card is locked to can charge it. (this card is locked to lexica-pro; only that merchant's key can charge it)
--- merchant charges after the cancellation
DECLINED. Nothing moved.
  CARD_CANCELLED: The card was cancelled. (the card was cancelled on 2026-11-11T15:35:30.618Z)
```

## What this run does not show

- The second month. The card's billing period was 30 real days, so the second charge could not be made in this run. The rule that lets it through after a period, and the rule that ends the card after its last charge, are covered by `tests/cards.test.ts`.
- A merchant outside this gateway. A Xenoncard works where the merchant has an account here. It is not a Visa, Mastercard or Verve card.
- More than one model or one run. This is a single run with one model.

## To reproduce

```bash
export ENVELOPE_DIR=.envelope
A="npx tsx scripts/agent.ts"
for k in dana research-agent lexica-ltd lexica-pro; do $A keygen $k; done
$A open-account --as research-agent --owner dana --settle-to you@example.com --hold --per-payment 30
$A open-account --as lexica-pro --owner lexica-ltd --settle-to merchant@example.com
$A seal --as dana --to dana-ops --limit 40 --per 40 --payees <research-agent's acct:…> --purposes allowance --hours 2
$A pay  --as dana-ops --amount 30 --payee <research-agent's acct:…> --purpose allowance
# the agent, by hand instead of a model:
$A card --as research-agent --merchant <lexica-pro's acct:…> --label "Lexica Pro" --per-charge 9 --charges 2 --every-days 30 --valid-days 62
# the merchant:
$A charge --as lexica-pro --card <card id> --amount 9 --memo "Month 1"
$A cancel-card --as research-agent <card id>
```
