# Demo runbook

How to show Envelope to someone, step by step, in three settings: the hosted copy (nothing to install), a local gateway on the real PayPal sandbox, and from code with the SDK. Then a script for a video under three minutes, and how to register a PayPal webhook.

Every screen says which PayPal it is talking to. A red strip means the simulator; a dark strip means the real sandbox. Nothing here moves real money.

## A. The hosted copy (two minutes, nothing to install)

Open the site: <https://envelope-paypal.vercel.app> (also <https://kept-paypal.vercel.app>). The red strip says the whole gateway is running in your browser on a PayPal simulator.

| # | Do this | You should see | What it shows |
|---|---|---|---|
| 1 | **Seal an envelope** (top right), then **Seal & hold $200.00 on PayPal** | The envelope's page, a blue PayPal postmark, $200 held | A person signs the limits; PayPal holds the money; nothing is charged |
| 2 | **Run the launch** | Two smaller envelopes appear; $45 is set aside, then paid to translator-agent; $67 is paid to the designer | Agents split authority they cannot enlarge, and pay inside it |
| 3 | Look at **What PayPal did for this envelope** | One hold placed, three captures, payouts, and each call with PayPal's id | PayPal is doing the holding, the taking and the delivering. Envelope only decides who may ask |
| 4 | **Compromise the creative agent** | Three red "Denied" rows with reason codes | A new payee, an overspend and a forged bigger envelope are refused by signatures and arithmetic |
| 5 | **Agent asks for a bigger payment**, then **Sign & pay** | A card "Waiting for your signature", then a paid row | Above the owner's threshold an agent can only ask |
| 6 | **Proof graph** (top of the page), click a **PayPal capture**, then **Ask PayPal now** | The path back to the person lights up; PayPal's answer appears on the right | Any dollar traces back to one human signature, checked in your browser |
| 7 | Back on the envelope, click **translator-agent** | Its passport, a $45 balance, a ledger, a card section | An agent that gets paid and keeps a balance |
| 8 | **Pay proofreader-agent $12**, **Compromised: drain to a stranger**, **Subscribe to Lexica Pro with its card**, **A thief uses the card details** | A transfer, a refusal over the owner's cap, a card, a declined charge | Agent-to-agent money, an owner's cap, a card only one merchant can charge |
| 9 | **Treasury** (top right), **Reconcile with PayPal** | Every agent under your signature; "3 of 3 match PayPal" | The owner's books checked against PayPal's records |
| 9a | **Accounts** (top right), then **Compare with PayPal** | "Is the money really there?" with what agents are owed beside what PayPal says the account holds, stamped "Covered at PayPal"; then each capture and payout marked "listed" | The gateway's books checked against two things it did not write: PayPal's reported balance and PayPal's statement of the account |
| 9b | Open any **Receipt & authority chain**, then **Show what would be sent** | Seven checks, the last "PayPal holds no dispute against this capture"; then the evidence in words | If the payer disputes a payment at PayPal, the answer is their own signature and every signature between it and the payment |
| 10 | **Close envelope & release the hold** | The postmark turns grey; "released back by PayPal" shows the rest | You paid for what your agents did, and nothing else |

To see a refund: on **translator-agent**'s page, before it spends any of the $45, press **Give its last payment back**. Its balance goes to zero, the page says "Refunded by PayPal.", and on the envelope the payment is stamped "Refunded by the payee" with a line saying the refunded amount is not spendable again. (The balance has to cover the whole payment, so do this before step 8, or on a fresh envelope.)

To see a recall: seal an envelope whose payee address contains the word `unclaimed` (the simulator then holds payouts to it unclaimed), pay it with **Run the launch**, and press **Recall this payment** on that row. The owner gets the money back; the amount stays used in the envelope, as it does at PayPal.

You can open the site in several tabs: they share one database, and closing or reloading one does not hold up the others. If the gateway in your browser has not answered for twenty seconds the page says so; reload it. The hosted copy keeps its data in your browser; clearing site data starts it fresh.

## B. A local gateway on the real PayPal sandbox (ten minutes)

You need Node 20+, and the client id and secret of a PayPal sandbox REST app (developer.paypal.com → Apps & Credentials).

```bash
git clone <this repository> && cd <it>
npm install
bash scripts/local-postgres.sh           # a local Postgres on port 5433; or set DATABASE_URL yourself
cp .env.example .env                      # put PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in it
npm run db:migrate
npm run build && npm start                # http://localhost:3000, dark strip: "PayPal sandbox"
```

Then follow section A on `http://localhost:3000`. Differences you will see on the sandbox:

- The PayPal ids are real. You can look them up in the sandbox dashboard.
- A payout to an address that has no sandbox account ends as **Unclaimed**, and the page says so. It is never shown as delivered.
- **Recall this payment** currently gets a server error from PayPal's sandbox. The page reports that PayPal would not cancel and changes nothing.
- **Give its last payment back** is a real PayPal refund: the capture reads `REFUNDED` in the sandbox dashboard.
- On **Accounts**, the balance PayPal reports is dated (about two hours old) and includes test money from earlier runs, so it covers what agents are owed many times over.
- **Compare with PayPal** marks fresh records "not listed yet": PayPal's statement can lag by up to three hours. Run it again later, or `npx tsx scripts/statement-check.ts`. On the sandbox it also shows PayPal's fee on each line and what the listed records left at PayPal; the simulator charges no fees and says so.
- No dispute exists on a fresh sandbox account, so the seventh receipt check reads "none". Finding and answering a dispute can only be seen on the simulator.

Without a browser, the whole flow and its evidence file:

```bash
npx tsx scripts/sandbox-run.ts            # three envelopes, a refund, reserves, the statement, disputes; writes docs/evidence/sandbox-run.json
npx tsx scripts/statement-check.ts        # some hours later, same database: PayPal's statement against that run's records
```

Checks to run:

```bash
npm test                                  # 109 tests, on the simulator
npx tsx scripts/attack-suite.ts           # 171 attacks, all refused
PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/e2e.mjs    # the browser walk-through, automated
# two tabs on the in-browser copy (start it with: DATABASE_URL= PAYPAL_MODE=simulated npx next start -p 3001)
BASE=http://localhost:3001 PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/tabs-stress.mjs
```

Optional, to let PayPal's own events finish settlements: register a webhook (section E). Without one, the sweep (`/api/sweep`, scheduled daily by `vercel.json` on Vercel, or called by any scheduler) does the same job by asking PayPal.

## C. From code, with the SDK (five minutes)

With the gateway from section B running:

```bash
npm run sdk:pack                          # builds sdk/envelope-sdk-0.1.0.tgz
cd examples/hire-an-agent && npm install
GATEWAY=http://localhost:3000 node index.mjs
```

It prints, line by line: an agent opening an account, an owner sealing $50 (with PayPal's authorization id), a payee checking the payer, a split, a refused widening, a payment, a refused payment with its reason code, money set aside and released by a third agent's signature, a receipt verified on your machine, and the close. The last line is a link to that envelope's proof graph. A recorded run on the sandbox is in [`evidence/sdk-run.md`](evidence/sdk-run.md).

For a model instead of code:

```bash
npx tsx scripts/agent.ts keygen ops-agent                 # paste the printed key into the console's "My own agent" when sealing
claude mcp add envelope -e ENVELOPE_AGENT=ops-agent -- npx tsx scripts/mcp.ts
```

and ask the model to check what it may spend, then pay someone on its envelope, then pay someone who is not. An agent that was paid into a balance can also be asked to give a payment back (`envelope_refund`, or `npx tsx scripts/agent.ts refund --as <agent> <payment id>`).

## D. A video under three minutes

The recorded video in `docs/demo/` predates the last two rounds: it does not show the PayPal panel, recall, the Developers page, refunds, reserves, the statement check or disputes. This is a script for a new take if the owner decides to record one. Nothing here has been recorded.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Title card | "AI agents are starting to spend money. Today they borrow a person's card and pass it around." |
| 0:08 | Landing page hero | "Envelope gives an agent money of its own: a budget a person signed, held by PayPal, that it can split for the agents it hires and never enlarge." |
| 0:20 | Seal form, then the postmark | "Ada signs two hundred dollars, two payees, until tonight. PayPal places the hold. Nothing is charged." |
| 0:32 | A real model runs the launch | "A real model plays her agents. It splits forty-five and sixty-seven, sets the translator's fee aside, pays on delivery, and ignores an instruction planted in the designer's message." |
| 0:55 | Scroll to "What PayPal did" | "Here is everything PayPal did: one hold, each partial capture, each payout, with PayPal's own ids. Envelope decides who may ask. PayPal moves the money." |
| 1:10 | Compromise the creative agent | "Now the agent is compromised. A new payee, an overspend, a forged bigger envelope. All refused, by signatures and arithmetic. No model decides whether money moves." |
| 1:25 | translator-agent's page: balance, transfer, card | "The translator is an agent too. It keeps what it earned, pays another agent, and subscribes with a card of its own that only one merchant can charge." |
| 1:45 | Owner approval | "Above seventy-five dollars the agent can only ask. Ada signs in her browser, and PayPal pays." |
| 1:58 | Proof graph, click a capture, Ask PayPal now | "Every dollar traces back to her signature, checked in your own browser, and confirmed by PayPal." |
| 2:12 | Developers page, then a terminal running the example | "And it is infrastructure. An SDK, an MCP server and a command line. Twenty lines to a first payment; your agent never holds a PayPal credential." |
| 2:28 | Accounts: reserves, Compare with PayPal; then close the envelope | "The books are checked against PayPal's own: what agents are owed against the balance PayPal reports, and every capture and payout against PayPal's statement. She closes the envelope and PayPal gives back the rest." |
| 2:40 | End card with the numbers | "One hundred and seventy-one attacks, all refused. Try it in your browser." |

Rules for the take: record on the real sandbox; show the strip that says so; do not show recall (it does not complete on the sandbox); payouts to placeholder addresses will read "Unclaimed", so say "PayPal is holding it for the payee", not "paid"; on the sandbox "Compare with PayPal" will read "not listed yet" for payments made in the last few hours, so either show an older envelope's records or say that PayPal's statement lags. A refund by translator-agent can be shown at 1:25 if there is time: it is a real PayPal refund on the sandbox.

## E. Registering a PayPal webhook (five minutes, optional)

What it is for: PayPal then tells the gateway when a capture, payout or hold changes, and the gateway finishes the settlement without anyone opening a page. Each event is verified with PayPal, applied once, and even then only causes a read of the named record from PayPal.

It needs a gateway with a database that PayPal can reach over HTTPS. **The hosted try-it copy has no database** (its gateway runs in each visitor's browser), so a webhook pointed at it cannot be applied there. Registering one is still useful: it makes PayPal keep an event feed for the app, and any gateway that has the same sandbox credentials reads that feed through the sweep.

1. Go to developer.paypal.com → **Apps & Credentials** → switch to **Sandbox** → open the REST app whose client id the gateway uses.
2. Scroll to **Sandbox Webhooks** → **Add Webhook**.
3. **Webhook URL**: `https://<host with a database>/api/paypal/webhook`. If you have no such host, use the hosted copy's address (`https://envelope-paypal.vercel.app/api/paypal/webhook`): deliveries there will not be applied, but the feed fills.
4. **Event types**: tick **All Events**, or at least the groups *Payment authorization*, *Payment capture*, *Payment payouts-item* and *Payment payoutsbatch*. (Events about *Customer dispute* are stored but not acted on: disputes are found by the sweep and by every receipt check, which ask PayPal directly.)
5. **Save**. PayPal shows a **Webhook ID**.
6. On the host with a database, set `PAYPAL_WEBHOOK_ID` to that id and redeploy. Without the id the receiver refuses every event.
7. To check: make a payment, then call the sweep (`curl -X POST https://<host>/api/sweep`, with `-H "Authorization: Bearer $CRON_SECRET"` if that is set). Its answer says how many events it read from PayPal's feed and what each changed.

Never paste the client secret or the webhook's signing details into a chat or a file in the repository. The webhook id is not a secret.

State of this on 12 November: no webhook is registered for the sandbox app used in development, and no genuine PayPal event has been received. The receiver and the feed reader are proven on the simulator; on the sandbox a forged event was rejected by PayPal and the feed was read and was empty.
