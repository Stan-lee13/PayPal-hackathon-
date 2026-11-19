# Milestone 4 — organization security architecture

**Status: design only.** Nothing in this document is implemented. It is written against the schema and the
routes as they exist at migration `0012`, so that the next milestone can be planned without re-reading the
codebase. No migration is proposed here that is applied by Milestone 3.2.

---

## 1. What exists today, precisely

The financial core is single-tenant by construction. A "tenant" is implicit in one column per table:

| Table | Tenant-bearing column | How it is set today |
| --- | --- | --- |
| `roots` | `principal` (the owner's Ed25519 public key) | from the signed envelope |
| `blocks` | (via `root_id`) | — |
| `spends` | (via `roots.principal`) | — |
| `accounts` | `owner` | from the owner signature on `openAccount` |
| `ledger` | (via `accounts.agent`) | — |
| `cards` | (via `accounts.agent`) | — |
| `transfers` | (via the from-account) | — |
| `rail_accounts` | `owner` | from the root's principal |
| `position_entries` | `owner` | from the root's principal |
| `reconciliation_runs` | `owner` (nullable = the provider account itself) | from the caller |
| `audit_log` | `scope_id` (set to `roots.principal`) | from the root |
| `paypal_calls` | none — keyed by provider/domain ids | — |
| `paypal_events` | none — keyed by provider event ids | — |
| `gateway_keys` | one row, id `default` | — |

Identity today means: **a public key that signed an envelope.** There is no human account, no session, no
organization, no membership, no role, and no per-tenant isolation at the database level. `roots.principal` is a
key, and a key is not an organization.

The API surface (`app/api/**/route.ts`) is unauthenticated except where a *signed* request proves authority:
`/api/gateway/spend`, `/keep`, `/accept`, `/revoke` verify the agent's signature; `/treasury/[principal]`,
`/recall`, `/close`, `/freeze`, `/bank/refund` verify an owner read signature or an account-holder signature.
Read endpoints such as `/api/envelopes/[id]` and `/api/spends/[id]` are addressed by id and are **not**
tenant-scoped at the transport layer. That is acceptable while one operator runs one deployment, and is the
central problem this milestone solves.

`resolvePayoutDoubt()` is a service function with **no HTTP route**. It is an operator action waiting for the
authenticated operator identity this milestone designs.

---

## 2. Threat model

| # | Threat | Impact | Mitigation this milestone must provide |
| --- | --- | --- | --- |
| T1 | A user of organization A reads or mutates a record of organization B by guessing an id (IDOR) | cross-tenant disclosure; possible payout | server-derived organization context; every query scoped; RLS as defense in depth |
| T2 | A member of A approves a payout-recovery decision and also executes it | fraud, no separation of duties | role permissions plus an explicit two-person rule for recovery |
| T3 | A stolen API key acts for an organization | full financial control | scoped, revocable API keys bound to an organization and a role; hashed at rest; rotation |
| T4 | A webhook is replayed or forged to move money into the wrong tenant | money recorded for the wrong organization | signature verification first, then the provider account is looked up **from our own configuration**, never from event metadata |
| T5 | Provider credentials leak through logs, browser storage or receipts | account takeover at the provider | secrets abstraction; no secrets in client bundles, logs, receipts or error messages |
| T6 | A request reaches the database as a superuser, bypassing RLS | isolation is only conventional | non-superuser runtime role, `FORCE ROW LEVEL SECURITY`, session identity set per transaction |
| T7 | Organization context leaks between pooled connections | cross-tenant reads | `set_config(..., true)` (transaction-local), asserted per request, tested with a reused connection |
| T8 | Historical signed receipts or envelope chains are invalidated by the migration | loss of auditability | additive schema only; `org_id` on new tables/columns; nothing re-signed, nothing rewritten |
| T9 | A developer with read-only access initiates a payout | unauthorized money movement | permission matrix: `read` never implies `move-money` |
| T10 | Key rotation breaks verification of old receipts | receipts become unverifiable | key history table; verification tries the key id embedded at issue time |

---

## 3. Identity model

Five different things, kept apart:

```
human user (authenticated identity)          e.g. user_…, verified email at the IdP
    │  membership (role)
    ▼
organization (tenant)  ──────────────►  provider accounts (rail + currency + external id)
    │                                        │
    │  owns                                  │  positions (capture, payout, refund, fee)
    ▼                                        ▼
envelope principals (Ed25519 public keys)   agent accounts (an agent's internal balance)
    │
    ▼
agents (keys that hold envelope blocks)
```

* **Human user** — created by the identity provider on first sign-in. Never inferred from a key.
* **Organization** — the tenant. Has an id (`org_…`), a display name, and a status.
* **Membership** — `(org_id, user_id, role)`, with an invitation/acceptance lifecycle.
* **Principal** — unchanged: the Ed25519 key that signed a root envelope. A principal belongs to exactly one
  organization through `principal_org (principal_key, org_id)`; the key itself is never re-issued, so every
  existing signed envelope and receipt keeps its identity and still verifies.
* **Agent** — unchanged: a key that holds a block. Agents are not users and never authenticate to the HTTP API;
  they present signed requests.
* **Provider account** — the external account money moves through, identified by the provider's own account id
  (`rail_accounts.external_account_id`). An organization owns one or more; a deployment may still run one.
* **API credential** — a machine credential owned by an organization, scoped to permissions, hashed at rest.

**Migration of existing owners.** Every distinct `roots.principal` (and `accounts.owner`) becomes a principal in
a newly created organization. If a deployment has more than one, the operator names the organizations during
the migration; the default is one organization (`org_default`) that holds all of them. No envelope is re-signed,
no receipt is re-issued, and no public key changes. `roots.principal` stays the authority identity; `org_id` is
added beside it.

---

## 4. Roles and permissions

Roles are named sets of permissions; permissions are checked server-side, never in the UI.

| Permission | Owner | Admin | Finance operator | Approver | Auditor | Developer |
| --- | --- | --- | --- | --- | --- | --- |
| `org.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.manage` (name, settings) | ✓ | ✓ | | | | |
| `member.read` | ✓ | ✓ | | | ✓ | |
| `member.manage` (invite, revoke, role) | ✓ | ✓ | | | | |
| `provider.read` (accounts, balances) | ✓ | ✓ | ✓ | | ✓ | |
| `provider.manage` (credentials, account) | ✓ | ✓ | | | | |
| `envelope.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `envelope.seal` | ✓ | ✓ | ✓ | | | |
| `envelope.revoke` | ✓ | ✓ | ✓ | | | |
| `budget.manage` (agent caps) | ✓ | ✓ | ✓ | | | |
| `payment.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payment.initiate` | ✓ | ✓ | ✓ | | | |
| `payout.recover` (resolve doubt) | ✓ | ✓ | ✓ | | | |
| `payout.recover.approve` (second signature) | ✓ | | | ✓ | | |
| `refund.issue` | ✓ | ✓ | ✓ | | | |
| `statement.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `audit.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `audit.export` | ✓ | ✓ | | | ✓ | |
| `api_key.read` | ✓ | ✓ | | | | ✓ |
| `api_key.manage` | ✓ | ✓ | | | | |

**Separation of duties.** These rules are enforced in code, not convention:

1. `payout.recover` may *propose* a reconciliation; `payout.recover.approve` must be held by a **different
   user** for any amount above the organization's recovery threshold, or for any `not-sent` decision (the one
   that makes a retry legitimate).
2. A user may not approve their own proposal: `decided_by <> proposed_by` is a database constraint on the
   approval row.
3. `provider.manage` does not imply `payment.initiate`; the person who can rotate credentials cannot move money
   with them alone.
4. `audit.read` never implies any write permission.

---

## 5. Authenticated request context

Every tenant-sensitive request resolves, in order, before touching a financial row:

1. **Who** — the session's user id (or API key's service id), from the server-validated session, never a header.
2. **Membership** — an active row in `memberships` for that user.
3. **Organization** — taken from the membership, or from the target record and then *checked* against the
   membership. A client-supplied `orgId` is only a *selector*; it is never the authorization.
4. **Permission** — the role's permission set must contain the action.
5. **Ownership** — the target record's `org_id` must equal the request's organization.

Implementation shape:

```ts
type Ctx = { userId: string; orgId: string; role: Role; permissions: Set<Permission> };
async function requireContext(req: Request, action: Permission, target?: { orgId: string }): Promise<Ctx>;
```

`requireContext` returns 401 for no session, 403 for no membership, 403 for a missing permission, and **404**
(not 403) for a record that exists in another organization, so ids cannot be probed for existence.

Untrusted inputs that must never become authorization: `orgId` in a body, `principal` in a query string,
`X-Org-Id` headers, the `by` field of `PayoutDoubtEvidence`, an email address in a webhook resource, and any
provider-supplied metadata.

---

## 6. Database isolation

### 6.1 Where `org_id` goes

Add `org_id` (not null, FK `organizations(id)`) to every tenant-owned table. For child tables the column is
denormalized so that RLS and composite keys work without joins:

| Table | `org_id` | Composite key / index |
| --- | --- | --- |
| `roots` | yes | `(org_id, id)` unique; `(org_id, principal)` |
| `blocks` | yes (denormalized from root) | `(org_id, id)` unique; FK `(org_id, root_id) → roots(org_id, id)` |
| `spends` | yes | `(org_id, id)` unique; FK `(org_id, root_id)` |
| `accounts` | yes | `(org_id, agent)` unique |
| `ledger` | yes | `(org_id, agent, kind, ref)` unique (replaces the current global unique) |
| `cards` | yes | `(org_id, id)`; `(org_id, agent)` |
| `transfers` | yes | `(org_id, id)`; `(org_id, from_agent)` |
| `rail_accounts` | yes | `(org_id, rail, currency, custody)` unique |
| `position_entries` | yes | `(org_id, rail, currency, bucket, kind, ref)` unique |
| `reconciliation_runs` | yes | `(org_id, at)` |
| `audit_log` | yes | `(org_id, subject_id, at)` |
| `paypal_calls` | yes (nullable for pre-migration rows) | `(org_id, id)` |
| `paypal_events` | yes, resolved from the configured account | `(org_id, id)` |
| `gateway_keys` | yes (one active signing key per org) | `(org_id, state)` |
| `api_keys` (new) | yes | `(org_id, prefix)` unique |
| `memberships` (new) | yes | `(org_id, user_id)` unique |
| `principals` (new) | yes | `(org_id, public_key)` unique |
| `provider_accounts` (new) | yes | `(org_id, rail, currency, external_account_id)` unique |

Composite foreign keys are what stop a child row from pointing at a parent in another tenant, even if an
application bug writes the wrong `org_id`.

### 6.2 Row-level security

```sql
alter table spends enable row level security;
alter table spends force row level security;

create policy spends_tenant on spends
  using (org_id = current_setting('envelope.org_id', true)::text)
  with check (org_id = current_setting('envelope.org_id', true)::text);
```

Rules for every tenant table: `ENABLE` **and** `FORCE` (so the table owner is subject to it too), and the same
`USING`/`WITH CHECK` pair. `FORCE` matters because the migration runner and any debugging session otherwise
bypass the policy.

### 6.3 Connection-pool safety

The organization is set **per transaction**, never per session:

```sql
select set_config('envelope.org_id', $1, true);   -- true = transaction-local
```

and the application asserts it before any financial statement:

```ts
await tx.execute(sql`select set_config('envelope.org_id', ${orgId}, true)`);
const [{ current }] = await tx.execute(sql`select current_setting('envelope.org_id', true) as current`);
if (current !== orgId) throw new Error("organization context was not established");
```

A pooled connection returned to the pool therefore carries no organization. The test that proves it: take a
connection, run a transaction as A and roll it back, then run a transaction as B on the **same** connection and
assert that a query without an explicit predicate sees only B's rows (and none at all when the setting is
absent — RLS with an unset setting compares against `null` and matches nothing; fail closed).

### 6.4 Runtime database role

The application must connect as a role that cannot bypass RLS:

```sql
create role envelope_app login password '…' nosuperuser nobypassrls;
grant select, insert, update, delete on all tables in schema public to envelope_app;
-- no ownership of tables; migrations run as a separate role
```

A startup assertion checks `current_user` is not a superuser and not `BYPASSRLS`, and refuses to serve
financial routes otherwise.

---

## 7. Secrets and key management

### 7.1 What must be secret

| Secret | Where it may live | Where it must never live |
| --- | --- | --- |
| Provider client id/secret | server environment or a managed secret store, read at boot | client bundle, logs, receipts, error bodies |
| Webhook verification configuration (webhook id, cert trust) | server config, per provider account | request echoes, audit detail |
| Gateway signing key (private) | KMS/managed key, or the sealed `gateway_keys.private_jwk` for local development | logs, API responses, `localStorage` |
| Organization gateway key per tenant (M4) | KMS with a key id in the database | the same row as the public key |
| User/principal signing keys | the holder's device only; the gateway stores public keys | anywhere server-side |
| API keys | hash at rest (SHA-256), prefix + last4 for display, shown once at creation | logs, list endpoints, receipts |

### 7.2 Abstraction

```ts
interface SecretStore {
  get(name: string): Promise<string>;      // throws if absent; never returns ""
  rotate(name: string, value: string): Promise<{ version: string }>;
}
```

Two implementations: `LocalEnvSecretStore` (development, reads `process.env`, refuses `NODE_ENV=production`) and
`ManagedSecretStore` (production). Provider clients receive a `SecretStore`, not `process.env`.

### 7.3 Key rotation and receipt verification

* `gateway_keys` gains `org_id`, `key_id`, `state` (`active`/`retired`), `created_at`, `retired_at`.
* Receipts v2 already carry `gateway` (the public key). Add nothing to signed bodies: verification looks the key
  up by value in the organization's key history, so v1 and v2 receipts verify unchanged, forever.
* Rotation = create a new active key, keep the old one `retired` and usable for verification only. Nothing is
  re-signed. A receipt signed by a retired key still verifies; a receipt signed by an unknown key does not.
* Private material is decrypted only inside the signing call and never returned from a function.

---

## 8. API and webhook isolation

### 8.1 Routes

Every route in `app/api/**` must be classified in a table committed with the implementation:

| Class | Example | Rule |
| --- | --- | --- |
| Public | `/api/health`, `/api/spec` | no tenant data, no writes |
| Signed-agent | `/api/gateway/spend`, `/keep`, `/accept`, `/revoke` | signature is the authority; the envelope chain binds the organization, which must match the root's `org_id` |
| Signed-owner | `/api/spends/[id]/recall`, `/close`, `/freeze` | owner signature **and** an authenticated session in the same organization |
| Session + permission | `/api/treasury/*`, `/api/statements`, `/api/audit/*`, `/api/api-keys/*` | `requireContext` with the action from §4 |
| Webhook | `/api/paypal/webhook` | signature first, then account→organization resolution |
| Simulation only | `/api/sim/*`, `/api/demo/*` | refused when `NODE_ENV=production` |

The SDK, CLI and MCP server are clients of these routes and must carry the session (or an API key) the same way;
none of them may hold a provider credential.

New route this milestone introduces, behind `payout.recover` **and** `payout.recover.approve`:

```
POST /api/spends/:id/payout-doubt
  body: { kind: "sent"|"not-sent", batchRef?, itemRef?, source, rationale }
```

* `by` is **removed from the request body**; the server uses the session user id.
* `checkedAt` is the server's clock at the moment of the call, not a client value.
* `not-sent` requires a second approver above the threshold.
* The route is never exposed without a session; there is no anonymous form of it.

### 8.2 Webhooks

Order of operations, non-negotiable:

1. Read the raw bytes; reject bodies above a size limit.
2. Verify the provider signature with the endpoint id configured **for a specific provider account row**.
3. If several accounts exist, try the configured endpoints and take the one that verifies (bounded, no
   attacker-controlled list).
4. Resolve the organization from that account row. **Never** from `resource.custom_id`, an email, a
   `sender_batch_id`, or any other field inside the event.
5. Apply the event under that organization's context (transaction-local RLS setting).
6. The event is a hint: read the record from the provider by id before changing anything (already true today).

An event whose organization cannot be resolved is stored as `unrouted` for an operator, and applies nothing.

---

## 9. Data migration

Additive and recoverable, in this order (migrations `0013` onward):

1. **0013 — organizations, memberships, principals, api_keys.** Create tables; insert `org_default`; backfill
   one principal row per distinct `roots.principal` and `accounts.owner`, all into `org_default`.
2. **0014 — `org_id` columns, nullable.** Add to every tenant table; backfill from the parent
   (`blocks.org_id ← roots.org_id`, `spends.org_id ← roots.org_id`, `ledger.org_id ← accounts.org_id`,
   `transfers.org_id ← accounts.org_id of from_agent`, `audit_log.org_id ← the root's`).
3. **0015 — validate.** Assert zero rows with `org_id is null` in every table; add `NOT NULL`; add composite
   FKs and the tenant-scoped unique indexes (drop the global ones in the same migration, in one transaction).
4. **0016 — policies.** Enable and force RLS on every tenant table; create the policies.
5. **0017 — runtime role.** Create `envelope_app`; document that the deployment uses it.
6. **0018 — provider accounts.** Create `provider_accounts`; backfill from `rail_accounts` where a non-null
   `external_account_id` exists; leave historical null-identity rows unattributed and *visible as such*.

Validation queries the migration must run and fail on:

```sql
select count(*) from spends s join roots r on r.id = s.root_id where s.org_id <> r.org_id;         -- 0
select count(*) from ledger l join accounts a on a.agent = l.agent where l.org_id <> a.org_id;     -- 0
select count(*) from position_entries where org_id is null;                                        -- 0
select count(*) from audit_log where org_id is null;                                               -- 0
```

Preserved by construction: every existing id, every external provider identifier, every envelope chain, every
v1 and v2 receipt, every audit row, and every owner public key. The migration adds columns; it never rewrites a
financial fact.

Migration tests required: a clean install to head, and an upgrade from a database seeded at `0012` with a
receipt, a payout, a refund and a `REFUND_DUE` row, asserting the receipts still verify and the rows keep their
provider ids.

---

## 10. Phased sequence

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| 4.1 | `organizations`, `memberships`, `principals`, `org_default` backfill; session middleware; `requireContext` | an unauthenticated request to any session route is 401; a member of A gets 404 for B's ids |
| 4.2 | `org_id` columns + backfill + composite keys (0014–0015) | migration validation queries return 0; upgrade and clean install both pass |
| 4.3 | RLS policies, transaction-local context, non-superuser role (0016–0017) | pooled-connection leak test passes; app refuses to boot as a superuser |
| 4.4 | Permission matrix enforcement on every route; separation-of-duties constraints | route table committed; a finance operator cannot approve their own recovery |
| 4.5 | `payout.recover` HTTP route with two-person approval; `by`/`checkedAt` server-derived | the route exists, is authenticated, and the no-session form is 401 |
| 4.6 | `provider_accounts`, per-organization attribution, credential rotation through `SecretStore` | two organizations cannot pay from each other's account; rotation keeps old receipts verifying |
| 4.7 | API keys, webhook account routing, analytics-free audit export | a key can be revoked and stops working immediately; an unrouted event moves nothing |

Each phase is a separate migration and a separate review. None of them may be merged into the financial paths
without the Stage E transition table being updated in the same change.

---

## 11. What this milestone will not do

* It will not introduce a second payment provider.
* It will not change the envelope or receipt signature formats; v1 and v2 keep verifying.
* It will not make `roots.principal` an organization id, or delete it.
* It will not grant a "super admin" that bypasses RLS at runtime; break-glass access is a separate, audited
  connection with `BYPASSRLS`, used only by a human operator with a recorded reason.
