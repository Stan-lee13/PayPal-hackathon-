# Milestone 4.3 — reads scoped to the caller's organization

**Status (as of 4.3):** the addressed financial reads resolve the caller's organization from a server-validated
session, read inside a transaction that carries it, and answer another organization's id as **404**. At 4.3 the
session was not yet **required**; **Milestone 4.4 made it required and enabled the row level security policies**
(`MILESTONE_4_SESSION_AND_RLS.md`). This document is kept as written for that milestone, with the three items it
listed as open struck through below.

| | |
| --- | --- |
| Context primitive | `lib/db/tenant-context.ts` (`withTenant`, `readInTenant`, `visibleTo`) |
| Session → organization | `requestScope` in `lib/auth/context.ts`, called once per HTTP request in `lib/api/next.ts` |
| Scoped reads | `lib/gateway/{service,bank,books,settlement}.ts` |
| Development sign-in | `lib/auth/dev-session.ts`, `app/api/dev/session/route.ts`, `components/session-bar.tsx` |
| Tests | `tests/tenant-reads.test.ts` (9) |
| Predecessor | `MILESTONE_4_TENANT_PARTITIONING.md` (4.2: the `org_id` columns) |
| Route table | `MILESTONE_4_ROUTE_AUTHORIZATION_MATRIX.md` (regenerated) |

## How a request learns its organization

```
cookie → sessions row (expiry, user status) → ACTIVE membership → organization
```

* The cookie is a lookup key. The row decides, exactly as in 4.1: an expired session, a disabled user or a
  deleted session is a 401; a signed-in user with no active membership is a 403.
* A user may belong to several organizations. Until the console can select one, the oldest active membership is
  used **deterministically**; the selection is a membership row, never `X-Org-Id`, a body field or an email.
* No cookie means **no scope**, and that is the whole of the remaining gap: the signed-agent paths, the CLI, the
  SDK and the in-browser gateway never present a session and keep reading what they read before. The route matrix
  says so on every affected row rather than hiding it here.

## What the database is told

`withTenant(orgId, fn)` opens a transaction, runs `select set_config('envelope.org_id', $1, true)`, reads the
setting back and refuses to continue unless it matches, and then runs the read on that transaction.

* `true` makes it **transaction-local**. The pooled connection goes back with no organization on it, so the next
  request cannot inherit this one's tenant. `tests/tenant-reads.test.ts` runs two organizations one after the
  other and then reads the setting outside any transaction: it is empty.
* Every scoped query **also** filters by `org_id`. The result is therefore identical whether or not row level
  security is enabled later: turning the policies on cannot change an answer that was already scoped, and cannot
  silently empty a page that used to work.
* RLS itself is still **not enabled**. That is the next database step, and it now has the context it needs.

## What each read does

| Route | Scoped by | Cross-organization answer |
| --- | --- | --- |
| `GET /api/envelopes/:id` | the root's `org_id` | 404 |
| `GET /api/envelopes/:id/paypal` | the root's `org_id` | 404 |
| `GET /api/spends/:id` | the payment's `org_id` | 404 before the rail is asked |
| `GET /api/spends/:id/status` | the payment's `org_id` | 404 **before** the provider is contacted |
| `GET /api/spends/:id/evidence` | the payment's `org_id` | 404 |
| `GET /api/bank` | balances and ledger `org_id` | the organization's accounts only |
| `GET /api/bank/transfers/:id` | the movement's `org_id` | 404 before the rail is asked |
| `GET /api/cards` | cards and accounts `org_id` | the organization's cards only |
| `GET /api/cards/:id` | the card's `org_id` | 404 |

Two rules are worth stating separately:

* **An unattributed row (`org_id IS NULL`) is nobody's.** A scoped caller is not shown it. That follows 4.2's
  principle — a guess about whose money this is, is worse than an honest gap — and it means a deployment that
  signs people in must attribute its rows through the explicit mapping (`npm run tenant:backfill`).
* **A provider-level figure is not an organization's.** `GET /api/bank` still returns the deployment's reserve
  comparison, and `GET /api/bank/statement` is still the provider account's statement. They belong to a provider
  account, which is a later phase (`MILESTONE_4_WEBHOOK_TENANCY_DESIGN.md`), and the route table says so.

## Writing into an organization

A read-only scope would be useless the moment someone seals an envelope: the row would be unattributed and then
invisible to the person who just created it. So the scope is used on the two write paths that create a tenant's
first rows:

* `POST /api/envelopes` → `registerRoot({ ..., orgId })`: the envelope is filed under the signed-in organization
  **only when the sealing principal has no mapping**. A principal already mapped to another organization is
  refused with 403: a key belongs to one organization, and no session changes that.
* `POST /api/accounts` → `openAccount(signed, orgId)`: the same rule for the owner key.

Every other row still inherits its organization from its parent (block → root, ledger/card/transfer → account),
which the composite foreign keys already enforce. No historical row is moved, and nothing is re-signed.

## The development sign-in

The console had no way to say who it was, and requiring a session without one would break the demo. `POST
/api/dev/session` creates the rows an OIDC callback would have created — a user keyed by (issuer, subject), one
explicitly named "Development organization", an owner membership and a server-side session — and sets the same
`authjs.session-token` cookie.

It is not a production path and not a bypass:

* it answers 404 when `NODE_ENV=production`, and 404 when the gateway runs in the browser (no server database);
* everything downstream still validates the session row, the membership status and the organization;
* it attributes nothing historical: only what is written while signed in goes into that organization;
* a real deployment signs in through OIDC, which `lib/auth/config.ts` already implements and
  `lib/security/startup.ts` already refuses to start production without.

`DELETE /api/dev/session` deletes the session row, so the cookie stops working even if it is presented again.

## What this milestone did not do (both closed in 4.4)

1. ~~**The ten routes still answer without a session.**~~ Milestone 4.4 made the session mandatory: the route
   table names `session: "required"` and `lib/api/next.ts` refuses a request without one. See
   `MILESTONE_4_SESSION_AND_RLS.md`.
2. ~~**Permissions are not enforced on these reads.**~~ Milestone 4.4 enforces the permission in the table from
   the caller's membership role, in the same wrapper.
3. ~~**RLS is not enabled.**~~ Migration 0016 enables the policies and `withTenant` switches to a SELECT-only
   request role for the transaction.
4. **The expiry sweep runs on its own connection.** `tree` lapses expired spends by the clock, not by the caller,
   and that write is not covered by the tenant setting. It moves nothing between organizations.
5. **Multiple memberships are resolved deterministically, not selected.** A member of two organizations is served
   the oldest active one until the console can choose.

## Evidence

`tests/tenant-reads.test.ts`:

* the organization is in the transaction and gone from the pooled connection afterwards;
* a scoped caller sees its own envelope, card, balance and movement, and neither another organization's nor an
  unattributed one — while the same service calls without a scope behave as before (the HTTP layer is what
  requires the session, in `tests/session-required.test.ts`);
* every addressed read answers 404 for another organization's id, including the paths that would otherwise ask
  the provider, and the owning organization still gets an answer;
* a sealed envelope and an opened account are filed under the signed-in organization, and a principal or owner
  already mapped elsewhere is refused;
* the organization comes from the session row: a different `x-org-id` header changes nothing, a bad token is 401
  and a revoked membership is 403;
* the development sign-in is refused in production and without a server database, and the session it creates is
  real (scoped, reused, and dead after sign-out).
