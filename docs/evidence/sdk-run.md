# The SDK against the real PayPal sandbox

`examples/hire-an-agent/index.mjs` is a program that uses only the packed SDK (`@envelope/sdk`, built with `npm run sdk:pack`) and a gateway's URL. On 11 November 2026 it was run with plain `node` against a gateway started from this repository in sandbox mode. No PayPal credential appears in the program: the gateway is the only thing that has one.

```bash
PAYPAL_MODE=sandbox DATABASE_URL=… npx next start -p 3000      # the gateway, with sandbox credentials
npm run sdk:pack && cd examples/hire-an-agent && npm install
GATEWAY=http://localhost:3000 node index.mjs
```

## What it printed

```text
writer      can be paid as acct:x2d8-cn2d-c1tm; Bea answers for it
Ada         sealed $50.00 for researcher; PayPal is holding it (authorization 54F500064B6966112)
researcher  may spend $50.00: only to acct:x2d8-cn2d-c1tm, only for writing, until 2026-11-11T22:38:38.836Z
writer      checked the researcher: GOOD (behind it: Ada; PayPal hold CREATED; gateway signature valid)
researcher  split off $10.00 for outline-agent (the owner can see and revoke it)
outline     tried to hand on more than it has: refused before anything was signed (A sub-envelope can only narrow its parent: limit $40.00 is more than t…)
outline     paid $10.00: PAID, credited to the payee agent's balance (no payout needed) (PayPal capture 1H271137N1562351G)
outline     asked to pay a stranger: DENIED (PAYEE_NOT_ALLOWED); nothing moved
researcher  set $20.00 aside for the writer until 2026-11-11T21:48:45.161Z; only editor-agent's signature releases it
writer      checked the note before starting: real, and the money is still set aside
editor      accepted the chapter; that signature paid $20.00: PAID, credited to the payee agent's balance (no payout needed)
anyone      receipt pr_ruFkVD3QM29BPcIT: PayPal matches; signatures all valid (6 checks run on this machine)
anyone      it names the work by fingerprint 1081e40777e39f44… and who authorized it: researcher
writer      balance $30.00, earned from two payments
researcher  has $20.00 left of $50.00
Ada         closed the envelope: $30.00 was captured, PayPal released $20.00

Proof graph: http://localhost:3000/proof/env_VvJTjq7flWxFxZoX
```

Both payments went to an agent's account that keeps its balance, so PayPal captured them from the hold and no payout was needed. A payout to a PayPal address is exercised by `scripts/sandbox-run.ts` (see [`sandbox-run.json`](sandbox-run.json)).

## What PayPal was asked to do

Read back from the gateway's own record of its PayPal calls for that envelope (`GET /api/envelopes/:id/paypal`), which is also what the envelope's page shows. Amounts are in cents; the last id on each line is PayPal's debug id for the call.

```text
sandbox {'total': 8, 'changed': 4, 'asked': 4, 'repeats': 0, 'refused': 0, 'holds': 1, 'captures': 2, 'payouts': 0, 'refunds': 0, 'cancels': 0, 'voids': 1}
  21:38:42 POST /v2/checkout/orders 201 CREATED 5000 54F500064B6966112 debug f444234e7aec1 2966ms 
  21:38:45 POST /v2/payments/authorizations/{id}/capture 201 COMPLETED 1000 1H271137N1562351G debug f226109ea0143 1739ms 
  21:38:48 POST /v2/payments/authorizations/{id}/capture 201 COMPLETED 2000 5YY30567ED5168815 debug f163175ec2233 2161ms 
  21:38:50 POST /v2/payments/authorizations/{id}/void 204 VOIDED None 54F500064B6966112 debug f301128688a58 1050ms
```

Eight calls in all: the hold, two partial captures, the release, and four reads. PayPal refused none.

The same program runs against the simulator in the automated tests' setup, and its output there is in the example's own README.
