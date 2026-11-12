# The outside review of 12 November, and what was done with it

An outside reviewer (Manus) audited a local checkout of this repository on 12 November 2026. The checkout
was on the branch `stormbreaker-paypal-2026-11-09` at commit `4333c6e`. That branch holds an earlier
application in this repository (contract-bound invoices for freelance work, and bounties); it forked from
`main` on 9 November and is not in `main`'s history. The submission, Envelope, is on `main`.

So most of the 26 findings name files that do not exist in the submission (`lib/services/invoices.ts`,
`app/api/bounties/…`, `lib/services/seed.ts`, `lib/security/persona.ts` and others). They were not applied,
because there is nothing here to apply them to. The findings below are the ones whose kind of fault could
exist in Envelope too. Each was checked against the code on `main`.

| Finding in the review | In Envelope | What was done |
|---|---|---|
| Buttons that stay busy, or skip navigation, when a request never reaches the server | The pages call the gateway through one helper, `lib/client/api.ts`. A failed network request rejected its promise there | Fixed in the helper: a request that cannot reach the gateway now comes back as an answer with a message, so every caller shows it and frees its button |
| `npm test` can pass while every database-backed suite is skipped | True here as well: without `TEST_DATABASE_URL` only the pure tests ran, with a one-line warning | With `CI` or `REQUIRE_TEST_DB=1` set, a run without the test database now fails. Otherwise the warning says in capitals that this is not a full run |
| Production dependency advisories (`next` and its nested `postcss`) | Present. `npm audit --omit=dev` reports 14 advisories: 2 moderate and 12 high. Two are `next` 15 and its nested `postcss`; the other twelve came in with PayPal's Agent Toolkit (`ai`, `openai`, `@langchain/core`, `langsmith`, `mathjs`, `zod` 3, `uuid` and others) | Not changed. The fixes npm offers are `next` 16 (a major version) and a downgrade of the toolkit to 1.3.5. Of the toolkit's code, only its five read tools run here, with arguments bounded by the gateway's 128 KB request limit. No request path to any of the advisories was demonstrated, and none was ruled out by testing |
| The same-origin check accepts a request with no `Origin` header | True, and intended. Agents call the gateway from servers and command lines, which send no `Origin`. Nothing is authorised by origin: every change is authorised by a signature the gateway verifies | No change |
| A webhook body is read in full before its size is checked | The route wrapper refuses on the `Content-Length` header first and checks the length again after reading. A sender that lies about the length is bounded by the platform's own request limit, not by this code | No change |
| The health endpoint tells an unauthenticated caller operational details | `/api/health` returns four fields: ok, where the gateway runs, whether the database answers, and the PayPal mode. Every page already shows the mode | No change |
| Concurrent webhook deliveries may be processed twice | PayPal events are recorded under their id with a unique constraint and applied once; a delivery only makes the gateway read the record it names from PayPal. Covered in `tests/paypal-rail.test.ts` and `tests/settlement.test.ts` | No change |
| Published test counts disagree | Checked: the documents say 447 tests in 17 files, which is what `npm test` reports | No change |

Not carried over, with the reason: the payout-status authorisation gap, the demo reset, the invoice
mismatch race, the manifest drift bug, the simulator's single balance across currencies, fractional
quantities, GitHub pagination, the persona cookie's fallback secret, the AI budget race and the invoice
dashboard's cap all concern code that is only on the other branch. Envelope has no reset endpoint, no
persona cookie and no GitHub client, and its simulator handles one currency per hold.

The review's general advice that did apply, about pages a visitor cannot find, was acted on the same day:
see "Finding your way" in the README.
