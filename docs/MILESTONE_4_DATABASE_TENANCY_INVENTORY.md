# Milestone 4.1 — database tenancy inventory

Every table in `lib/db/schema.ts`, classified for the tenant-partitioning phase. This inventory was written for
Milestone 4.1; **Milestone 4.2 has since added `org_id` to the org-owned and org-associated financial tables**
(migration `0015_tenant_partitioning.sql`, see `MILESTONE_4_TENANT_PARTITIONING.md`). `org_id` is still nullable,
and **no RLS policy is enabled**, so nothing here claims isolation today.

Classification legend:

* **Org-owned** — the row belongs to exactly one organization; it must gain `org_id NOT NULL`.
* **Org-associated** — the row belongs to an organization through a parent; it needs a denormalised `org_id` for
  composite keys and RLS.
* **Global** — deployment-wide state with no tenant meaning.
* **Provider-scoped** — belongs to an external provider account, which may back several organizations (pooled).
* **Historical/unattributed** — may contain records whose owner cannot be established.
* **Demo** — development/demo only.

| Table | Class | Tenant-bearing column today | Notes for the partitioning phase |
| --- | --- | --- | --- |
| `roots` | Org-owned | `principal` (Ed25519 key) | Map through `principals.org_id`; add `org_id` and composite `(org_id, id)`. Never rewrite `principal`. |
| `blocks` | Org-associated | via `root_id` | Denormalise `org_id`; composite FK `(org_id, root_id)`. |
| `spends` | Org-associated | via `root_id` | `org_id` from the root; payment reads/receipts become scoped by it. |
| `accounts` | Org-owned | `owner` (key) | The agent's receiving account. `org_id` from `owner`'s principal mapping. |
| `ledger` | Org-associated | via `accounts.agent` | Global unique `(agent, kind, ref)` becomes `(org_id, agent, kind, ref)`. A ledger row is a liability to one organization. |
| `cards` | Org-associated | via `accounts.agent` | `org_id` from the issuing account. |
| `transfers` | Org-associated | via from-account | `org_id` from the debited account. |
| `rail_accounts` | Provider-scoped | `owner` (key) + `external_account_id` | In pooled mode several organizations' money sits in one external account: this row is *not* one organization's. It must not receive a single `org_id`; the allocation lives in a new association table. |
| `position_entries` | Provider-scoped (+ historical) | `owner`, `external_account_id` (nullable) | The movement's provable account. Rows with a null identity are historical/unattributed and stay that way (`position_attributions`, migration 0013, is the proof table). Do not backfill `org_id` from a guess. |
| `reconciliation_runs` | Global (+ optional owner) | `owner` nullable | A run against a provider account; null owner means "the account itself". |
| `audit_log` | Org-associated | `scope_id` = principal key | Hash chain per `(scope_id, subject_id)`. Adding `org_id` must not alter `seq`, `prev_hash` or `hash`. |
| `paypal_calls` | Provider-scoped | none | Call journal. Organization attribution, when needed, comes from the keys the call carried. |
| `paypal_events` | Provider-scoped | none | Global unique provider event id — keep it global; add a nullable resolved `org_id` and an `unrouted` outcome. |
| `gateway_keys` | Global today | none | One signing key (`default`) for the deployment. The trust registry (`gateway_key_trust`) is per organization; per-organization signing keys are a later phase. |
| `demo_keys` | Demo | `root_id` | Private keys the demo server keeps. Never in production data. |
| `emulator_state` | Demo | none | Simulator state. |
| `rate_limits` | Global | none | Keyed by IP/route; deliberately not per organization (it protects the deployment). |
| `organizations` | *(new, 4.1)* | `id` | The tenant. |
| `users` | *(new, 4.1)* | none | A human may belong to several organizations; no `org_id` on the user. |
| `memberships` | *(new, 4.1)* | `org_id` | The link, with role and status. |
| `principals` | *(new, 4.1)* | `org_id` | Public key → exactly one organization (unique `public_key`). |
| `organization_invitations` | *(new, 4.1)* | `org_id` | Hashed single-use token. |
| `auth_accounts`, `sessions`, `verification_tokens` | *(new, 4.1)* | none | OIDC link and server-side session; user-scoped, not organization-scoped. |
| `gateway_key_trust` | *(new, 4.1)* | `org_id` | Which gateway public keys an organization trusts. Unique fingerprint across the deployment. |
| `position_attributions` | *(new, 4.1)* | `rail`, `currency`, `external_account_id` | Proof that one specific movement belongs to one provider account. |

## Deliberate decisions

1. **`audit_log` uniqueness.** `(scope_id, coalesce(subject_id,'-'), seq)` stays as it is; adding `org_id` must
   not change the hash chain or allow a second chain for the same scope.
2. **`position_entries` uniqueness.** `(rail, currency, bucket, kind, ref)` is global because a spend id is unique
   across the deployment. When `org_id` is added, the unique index can become `(org_id, rail, currency, bucket,
   kind, ref)` only if spend ids are guaranteed unique per organization; until then, keep the global index.
3. **`paypal_events` primary key** is the provider's event id and must stay global: the same event is delivered
   once, and a per-tenant key would let a replay apply twice.
4. **`rate_limits`** is global by design; a per-tenant key would let one organization exhaust another's budget.
5. **`demo_keys`** holds private keys the demo keeps server-side. It is excluded from production by the demo
   route guards and must never be copied into a tenant partition.
6. **Nothing is backfilled in 4.1.** No financial row is assigned to an organization by this milestone. The
   mapping in `principals` is the only organization relationship that exists, and it is explicit.

## What the next phase must do before claiming isolation

1. ~~Add nullable `org_id` to every org-owned/associated table and backfill from the parent chain.~~ **Done in
   4.2** for `roots`, `blocks`, `spends`, `accounts`, `ledger`, `cards`, `transfers` and `audit_log`.
2. ~~Add composite foreign keys.~~ **Done in 4.2**, so a block, payment, balance, card or transfer cannot be
   filed under another organization's parent. Still to do: `NOT NULL`, after
   `npm run tenant:inventory -- --fail-unattributed` is green on a real deployment.
3. ~~Replace global unique indexes with tenant-scoped ones where the id is not globally unique.~~ **Decided
   against, deliberately:** the ids in question are globally unique, and a per-tenant key would weaken
   idempotency. Revisit only if a spend id, agent key or provider event id becomes tenant-local.
4. Enable **and force** RLS, with a transaction-local `envelope.org_id`, and run the app as a non-superuser role.
   This cannot happen before the reads are organization-scoped: a policy over unscoped reads breaks them.
   **Half done in 4.3** (`MILESTONE_4_TENANT_READS.md`): the transaction-local setting exists and the addressed
   reads are scoped when the request carries a session. Still to do: require a session on those reads, then the
   policies, `FORCE ROW LEVEL SECURITY` and the runtime role.
5. Prove it with pooled-connection leak tests, cross-tenant 404s, and an upgrade from a seeded 4.1 database. The
   upgrade half already runs in `npm run db:upgrade-check`; the cross-organization 404s and the pooled-connection
   behaviour of the setting are proved in `tests/tenant-reads.test.ts`.
