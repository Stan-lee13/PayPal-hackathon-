# Milestone 4.4 — a session to read, and policies behind the filter

Two changes, one idea: a read that serves one organization must be able to say *which* organization, and the
answer must come from something the caller cannot invent.

## 1. The session is required, in one place

The route table (`lib/api/route-policy.ts`) now says `session: "required"` on the ten reads that were
`documented-gap`, and `lib/api/next.ts` enforces it for every one of them:

| Route | Permission |
| --- | --- |
| `GET /api/envelopes/:id` | `envelope.read` |
| `GET /api/envelopes/:id/paypal` | `audit.read` |
| `GET /api/spends/:id` | `payment.read` |
| `GET /api/spends/:id/status` | `payment.read` |
| `GET /api/spends/:id/evidence` | `audit.read` |
| `GET /api/bank` | `statement.read` |
| `GET /api/bank/statement` | `statement.read` |
| `GET /api/bank/transfers/:id` | `payment.read` |
| `GET /api/cards` | `provider.read` |
| `GET /api/cards/:id` | `payment.read` |

The order is fixed and tested: rate limit, then session (401), then the permission from the membership role
(403), then the handler, which reads inside the caller's organization and answers another organization's id as
404. Nothing is authorized by a header, a body field or a link.

**What stays public, deliberately.** `GET /api/proof/:root` and `GET /api/proof/:root/:spend` return signed
records only, and anyone may re-verify them in their own browser. That is the payee's evidence. The
`summary` that `evidence()` assembles now points at that page rather than at `/r/{spend}`, because the receipt
page carries live provider checks and the organization's tree.

**Headless callers are untouched.** Sealing, spending, promising, accepting, revoking, recalling, transfers,
cards and the operator tools are signed requests. They never present a cookie, and none was added.

**The console.** A page that gets a 401 renders `components/sign-in-notice.tsx` instead of an empty view. The
header (`components/session-bar.tsx`) offers the development sign-in on a laptop and the identity provider's own
page (`/api/auth/signin`, Auth.js's) on a deployment. The seal form refuses to start when the development
sign-in is available and unused, because an envelope sealed without a session is filed under no organization and
would not be readable afterwards.

## 2. Row level security, and the role that makes it real

Migration `0016_row_level_security.sql` enables RLS and a `FOR SELECT` policy on `accounts`, `audit_log`,
`blocks`, `cards`, `ledger`, `roots`, `spends` and `transfers`. Every policy is the same:

```sql
using (org_id is not null and org_id = current_setting('envelope.org_id', true))
```

The economic decision is what to do about `FORCE`. `FORCE` applies the policies to the table owner, and the owner
is the role the engine runs as: settlement, provider webhooks, the sweep, the operator tools and the signed-agent
paths all serve every organization, by design, as one process. Forcing the policies would not tighten anything;
it would stop the gateway from working.

So the isolation lives in a second role:

* `withTenant` sets `envelope.org_id` and, when `ENVELOPE_TENANT_ROLE` names one, switches to that role for the
  same transaction (`set_config('role', …, true)`), then reads both values back and refuses to continue if either
  is not what it asked for;
* the request role owns nothing and holds `SELECT` only, so a request-scoped read cannot write at all, let alone
  into another organization;
* the switch is transaction-local, so a pooled connection returns to the engine's role.

Provisioning (once per deployment):

```sql
create role envelope_request nologin;
grant usage on schema public to envelope_request;   -- without it every read fails as a missing relation
grant select on accounts, audit_log, blocks, cards, ledger, roots, spends, transfers to envelope_request;
grant envelope_request to <the role DATABASE_URL connects as>;
```

Then:

```
ENVELOPE_TENANT_ROLE=envelope_request npm run tenant:check
```

`tenant:check` (`lib/security/tenant-role.ts`) verifies that the role exists, is not a superuser, cannot
`BYPASSRLS`, owns no table, can `USAGE` the schema, can `SELECT` all eight tables, and that every table has its
policy enabled. In production the same checks run at startup (`instrumentation.ts`) and the gateway refuses to
serve if any fails. `GET /api/health` reports `tenant.requestRole` and `tenant.rlsTables` so an operator can see
the switch, not guess at it.

## What this still does not claim

* **Not a second database.** Isolation is one database with policies and scoped reads, not a database per
  organization. A mistake in a query that runs as the engine's role is still a mistake the engine can make.
* **The engine is trusted.** Settlement, webhooks and the sweep are organization-agnostic by design; they are not
  constrained by these policies, and that is stated rather than implied.
* **Provider accounts are shared.** `GET /api/bank`'s reserve figures and `GET /api/bank/statement` remain the
  deployment's PayPal account until provider accounts are partitioned.
* **Membership selection.** A person in two organizations is served the oldest active membership; there is no
  chooser yet.

## Evidence

* `tests/session-required.test.ts` (5): 401 on all ten without a cookie; own organization 200 and another
  organization's 404 through the wrapper; a `developer` role 403 on the books and the cards; a revoked session
  401 immediately; the proof graph answers an anonymous caller (404 for an unknown id, not 401).
* `tests/tenant-rls.test.ts` (6): policies on all eight tables; a request-role transaction sees only the
  organization it named; no organization named reads nothing; the role cannot delete a row; the role does not
  linger on the pooled connection; the production check passes on this setup and names a missing role, a
  superuser role and an invalid name.
* `tests/route-authorization.test.ts`: no route is left `documented-gap`, none is `public-read`, and no public
  route carries a permission.
* The whole suite on PostgreSQL 18 under Node 20, `tsc --noEmit`, `next build`, `db:upgrade-check` (the full
  migration sequence on an empty database) and the CI matrix on PostgreSQL 16 and 18.
