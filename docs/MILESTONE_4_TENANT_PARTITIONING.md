# Milestone 4.2 — tenant columns and explicit attribution

**Status:** migration `0015_tenant_partitioning.sql` adds an `org_id` to every financial table and attributes
existing rows from the explicit principal mapping. Composite foreign keys make cross-organization filing
impossible. What this milestone does **not** do is as important as what it does: `org_id` is nullable, RLS is not
enabled, and no read is organization-scoped yet. **Do not claim tenant isolation from this document.**

| | |
| --- | --- |
| Migration | `drizzle/0015_tenant_partitioning.sql` |
| Operator tools | `npm run tenant:inventory`, `npm run tenant:backfill` |
| Tests | `tests/tenant-partitioning.test.ts` (7), `npm run db:upgrade-check` (legacy 0009 database) |
| Predecessors | `MILESTONE_4_IDENTITY_AND_MIGRATION.md` (4.1), `MILESTONE_4_DATABASE_TENANCY_INVENTORY.md` |

## What a row's organization means

`org_id` answers one question: **whose money is this row about?** It is not a permission, and it does not by
itself authorize anything. It is the column that a later phase can scope reads and writes by, and that a
composite key can use to make a cross-tenant write structurally impossible.

| Table | Column | Attribute from | Why |
| --- | --- | --- | --- |
| `roots` | `org_id` | `principals.public_key = roots.principal` (**ACTIVE** only) | the sealed envelope belongs to the organization of the principal who sealed it |
| `blocks` | `org_id` | its root | a split cannot belong to a different organization than the envelope it splits |
| `spends` | `org_id` | its root | a payment moves the envelope's money |
| `accounts` | `org_id` | `principals.public_key = accounts.owner` (**ACTIVE** only) | the owner who co-signed the account open answers for it |
| `ledger` | `org_id` | its account (`accounts.agent`) | a balance is a liability to exactly one organization |
| `cards` | `org_id` | the holder's account | a card draws on that balance |
| `transfers` | `org_id` | the debited account (`from_agent`) | a transfer debits exactly one balance |
| `audit_log` | `org_id` | the envelope it is about, else the principal whose chain it extends | the trail follows the money, and `seq`/`prev_hash`/`hash` are untouched |

Deliberately **not** given a single `org_id`, because they are not one organization's:

* `rail_accounts`, `position_entries`, `position_attributions`, `paypal_calls`, `paypal_events` — provider-scoped
  (pooled funds and provider events). Their organization attribution is a separate, later design
  (`MILESTONE_4_WEBHOOK_TENANCY_DESIGN.md`).
* `organizations`, `users`, `memberships`, `principals`, `sessions` — the identity tables, where `org_id` already
  means something precise or means nothing at all.
* `gateway_keys`, `rate_limits`, `demo_keys`, `emulator_state` — deployment-global or demo-only.

## The attribution rule: explicit, or nothing

A row is attributed **only** when the key that owns it has an `ACTIVE` row in `principals` — the explicit mapping
an operator writes, never an inference. From that point the parent chain is followed: root → block/spend,
account → ledger/card/transfer.

* An unmapped principal leaves its rows `NULL`. They are **unattributed**, not "default organization".
* A `REVOKED` mapping leaves its rows `NULL`. Revoking a mapping does not silently reassign history.
* No organization is created, merged or split by attribution. `organizations` and `principals` are unchanged by
  both the migration and the backfill.
* No financial value is rewritten: amounts, balances, statuses, audit `seq`, `prev_hash` and `hash` stay exactly
  as they were. `org_id` is added beside them.

This follows the same principle as the unattributed provider positions in 3.2: *a guess about whose money this is,
is worse than an honest gap.*

## Enforcement: what is already structural

The migration adds composite foreign keys, so these are refused by the database, not by a code review:

| Constraint | Refuses |
| --- | --- |
| `blocks_org_root_fk (org_id, root_id) → roots(org_id, id)` | a block filed under an organization that is not its envelope's |
| `spends_org_root_fk (org_id, root_id) → roots(org_id, id)` | a payment filed under another organization's envelope |
| `ledger_org_account_fk (org_id, agent) → accounts(org_id, agent)` | a balance filed under another organization's account |
| `cards_org_holder_fk (org_id, holder) → accounts(org_id, agent)` | a card filed under another organization's balance |
| `transfers_org_from_fk (org_id, from_agent) → accounts(org_id, agent)` | a transfer debited from another organization's account |

A `NULL` `org_id` is not checked by a composite key (SQL `MATCH SIMPLE`), which is exactly the unattributed case:
the row is allowed to exist and is reported, but it can never be *mis*filed.

## Enforcement: what is not there yet

1. **`org_id` is nullable.** Making it `NOT NULL` is an operational decision, made per deployment with
   `npm run tenant:inventory -- --fail-unattributed` green first. Forcing it now would fail the upgrade of any
   database whose principals predate the mapping — or, worse, invite a backfill by guess.
2. **RLS is not enabled.** Reads are not organization-scoped yet, so a policy would return zero rows for every
   legitimate read (or, with a superuser connection, silently do nothing). The enabling work is: a
   transaction-local `envelope.org_id` (`lib/db/tenant-context.ts` in the next phase), `ENABLE` **and** `FORCE`
   ROW LEVEL SECURITY, and an application role that is neither the table owner nor a superuser.
3. **Reads and routes are scoped only when a session is present.** As of 4.3 (`MILESTONE_4_TENANT_READS.md`) the
   ten `documented-gap` routes in `MILESTONE_4_ROUTE_AUTHORIZATION_MATRIX.md` resolve the caller's organization
   from a server-validated session and answer another organization's id as 404; a row filed under no organization
   is not shown to a scoped caller. They still answer **without** a session, which is why they remain documented
   gaps: requiring one is the next step, and it needs a production sign-in page (the console now has a
   development-only one).
4. **Global unique indexes stay global.** `ledger_once (agent, kind, ref)`, `position_entries_once` and the
   `paypal_events` primary key are unchanged, deliberately: an agent key, a spend id and a provider event id are
   unique across the deployment, and a per-tenant key would weaken idempotency rather than add isolation.

## Operating it

```
npm run tenant:inventory                       # rows, attributed vs unattributed, per table and per organization
npm run tenant:inventory -- --json             # the same, machine-readable
npm run tenant:inventory -- --fail-unattributed  # exit 1 while any financial row is unattributed
npm run tenant:backfill                        # apply a new or corrected mapping to existing rows
```

`tenant:backfill` only fills `NULL`s: it never moves a row that already has an organization, and never rewrites a
row it has already attributed. It takes an advisory lock so two operators cannot interleave. It mirrors the
statements the migration runs once, so a deployment that upgrades and a deployment that re-runs the script end up
in the same state.

`--fail-unattributed` is the gate for step 1 above: when it exits zero, `SET NOT NULL` is safe.

## Evidence

* `tests/tenant-partitioning.test.ts`
  * attributes an envelope, its block, its payment, its account and its audit entry from the mapping;
  * leaves a `REVOKED` mapping and an unmapped key unattributed, and creates no organization or principal;
  * refuses a block, payment, balance, card and transfer filed under another organization's parent, and accepts
    the same rows with the right one;
  * is idempotent (a second run attributes nothing) and never moves an attributed row;
  * leaves amounts, audit `seq` and audit `hash` byte-identical (`org_id` aside);
  * writes the organization when an envelope is sealed and a payment is made, and writes none when the principal
    is unmapped — while the unmapped envelope still works, because attribution never gates money.
* `npm run db:upgrade-check` now also proves, against a database seeded at migration 0009: the eight `org_id`
  columns exist and are nullable, the upgrade attributes nothing by itself, a legacy payment is attributed
  through a mapping without its amount changing, and a block cannot be moved to another organization.
