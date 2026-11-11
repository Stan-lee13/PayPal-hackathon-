# Hire an agent

A researcher agent hires a writer agent, with money it was given and cannot exceed. One file,
[`index.mjs`](index.mjs), using only `@envelope/sdk` and an Envelope gateway's URL. No PayPal
credentials appear in it, because agents never hold any.

What it shows, in order:

1. The writer opens an account (two signatures: its own and its owner's), so it can be paid and keep a balance.
2. An owner seals a $50 envelope for the researcher. PayPal places the hold.
3. Before doing any work, the writer checks the researcher is good for the money.
4. The researcher splits off $10 for a helper. The helper cannot hand on more than it has.
5. The helper pays for an outline. A payment to anyone else is refused, with a reason code.
6. $20 is set aside for a chapter and released by the signed acceptance of a named third agent.
7. Anyone checks the receipt: against PayPal through the gateway, and every signature locally.
8. The owner closes the envelope and PayPal releases what was not spent.

## Run it

You need a running gateway: follow the quick start in the main README. On the built-in PayPal
simulator it needs a database and nothing else. The run below used, from the repository root:

```bash
bash scripts/local-postgres.sh                       # a local Postgres on port 5433
DATABASE_URL=postgres://postgres@localhost:5433/kept npm run db:migrate
DATABASE_URL=postgres://postgres@localhost:5433/kept PAYPAL_MODE=simulated PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= npx next dev -p 3000
```

(with a different database name and port; the commands are otherwise the same).

Then, in another terminal:

```bash
npm run sdk:pack                                     # builds sdk/envelope-sdk-0.1.0.tgz
cd examples/hire-an-agent
npm install                                          # installs that tarball, and nothing else
GATEWAY=http://localhost:3000 npm start
```

To run it against the PayPal sandbox, start the gateway with sandbox credentials (see the main
README). This program does not change: only the gateway knows which PayPal it talks to.

To use an envelope a person sealed elsewhere:

```bash
node index.mjs --agent researcher.json --envelope envelope.json
```

`researcher.json` is what `agent.export()` returns (it contains that agent's private key; keep it on
the agent's machine). `envelope.json` is the chain of signed blocks; it contains no secret.

## What it printed

A run on 11 November 2026 against a local gateway (`next dev`) on the PayPal **simulator**. The ids
starting `SIM` are the simulator's; no real PayPal call was made in this run.

```text
writer      can be paid as acct:vm4z-bmvn-m68m; Bea answers for it
Ada         sealed $50.00 for researcher; PayPal is holding it (authorization SIMAUTHB6E620DDBEAC4AD8)
researcher  may spend $50.00: only to acct:vm4z-bmvn-m68m, only for writing, until 2026-11-11T22:28:12.435Z
writer      checked the researcher: GOOD (behind it: Ada; PayPal hold CREATED; gateway signature valid)
researcher  split off $10.00 for outline-agent (the owner can see and revoke it)
outline     tried to hand on more than it has: refused before anything was signed (A sub-envelope can only narrow its parent: limit $40.00 is more than t…)
outline     paid $10.00: PAID, credited to the payee agent's balance (no payout needed) (PayPal capture SIMCAP8C471706F0F44ACA)
outline     asked to pay a stranger: DENIED (PAYEE_NOT_ALLOWED); nothing moved
researcher  set $20.00 aside for the writer until 2026-11-11T21:38:15.520Z; only editor-agent's signature releases it
writer      checked the note before starting: real, and the money is still set aside
editor      accepted the chapter; that signature paid $20.00: PAID, credited to the payee agent's balance (no payout needed)
anyone      receipt pr_AszRJcZlzuFqPgWb: PayPal matches; signatures all valid (6 checks run on this machine)
anyone      it names the work by fingerprint 1081e40777e39f44… and who authorized it: researcher
writer      balance $30.00, earned from two payments
researcher  has $20.00 left of $50.00
Ada         closed the envelope: $30.00 was captured, PayPal released $20.00

Proof graph: http://localhost:3105/proof/env_2MsKAGKWSIx5mLjF
```

Two things to read carefully in that output:

- Both payments went to an agent's account that keeps a balance, so PayPal captured the money from
  the owner's hold and the gateway credited the writer's balance. There was no payout. A payment to a
  PayPal address would have printed PayPal's payout status, and "NOT delivered yet" until PayPal says so.
- Money set aside is earmarked, not escrow: the owner can still close the envelope before it is released.
