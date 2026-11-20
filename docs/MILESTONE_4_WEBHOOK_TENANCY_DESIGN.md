# Milestone 4.1 — webhook and pooled-treasury tenancy design

**Status: design only. No live webhook-routing system is built in this milestone.** What exists today is a
single-account ingress (`/api/paypal/webhook`, `/api/rails/webhook`) that verifies the provider's signature and
then treats the event as a hint: it resolves a record and calls the leased settlement path. This document states
how that ingress becomes tenant-aware without ever letting a provider payload choose the organization.

## 1. Treasury topologies the design must support

The system already distinguishes two models (`ENVELOPE_TREASURY_MODE`, `lib/accounting/policy.ts`):

| Mode | Topology | Consequence for tenancy |
| --- | --- | --- |
| **pooled** | one external provider account backs several organizations | an event belongs to the *account*, never to one org; the organization must be resolved from the internal financial record the provider operation is attached to |
| **allocated** | each organization has its own provider account or an enforceable allocation | the account itself may map to one organization, but the mapping is still configuration, not event metadata |

Nothing in either model allows `resource.custom_id`, a recipient email, `sender_batch_id`, an `X-Org-Id` header or
any other caller-supplied field to *establish* the organization. Those are, at best, lookup hints for a record
that is then read from our own database and confirmed with the provider.

## 2. Required order of operations (unchanged from the brief, mapped to code)

1. **Read the raw body.** `Input.raw` in `lib/api/handlers.ts`; the parsed body is re-derived from it, so a body
   that parses differently from the bytes that were signed is refused.
2. **Enforce a request-size limit.** `lib/api/next.ts` caps the body at 128 KiB before parsing.
3. **Verify the provider signature with the endpoint configured for a specific provider account.** Today:
   `ENVELOPE_WEBHOOK_ID` / `PAYPAL_WEBHOOK_ID` through `genuineEvent()`. The next phase moves the id from a global
   variable to a `provider_accounts` row, and tries only the configured ids — never a list from the request.
4. **Establish the authenticated provider-account identity.** The account the webhook belongs to, from that row.
5. **Resolve the provider account's deployment scope.** `pooled` (shared) or `allocated` (per organization).
6. **Find the internal provider operation using stored, verified provider identifiers.** `payout_batch_id`,
   `capture_id`, `authorization_id` — values this gateway recorded after reading them from the provider.
7. **Resolve the organization from the internal financial record.** `spends.root_id → roots.principal →
   principals.org_id` (once the principal mapping exists). In pooled mode this is the *only* legitimate source.
8. **Execute under that trusted organization context.** The transaction-local organization setting arrives with
   RLS in the partitioning phase; until then, the resolved organization is carried in the call and recorded.
9. **Re-read provider state before changing financial state.** Already true: `applyPayPalEvent` calls
   `syncSpend` / `checkHold` / `syncTransfer`, and those read the record from the provider by id.

## 3. Unknown and ambiguous events

An event that cannot be resolved to exactly one internal record is stored as `unrouted` and changes **nothing**:

* no matching spend, transfer or hold → `unrouted: no internal record`;
* a record whose root principal is not mapped to an organization → `unrouted: principal unmapped`;
* (pooled mode) an event whose provider account is shared and whose record belongs to a different organization
  than the account's default → resolved by the record, or unrouted if the record is missing.

`paypal_events.outcome` already carries the resolution in words; the next phase adds the organization id (or
null) beside it. An operator can list unrouted events; nothing about them moves money.

## 4. What the schema will need (not created in 4.1)

```sql
provider_accounts(id, rail, currency, external_account_id, custody, mode, webhook_endpoint_id, created_at)
provider_account_orgs(provider_account_id, org_id, allocation_minor, ...)  -- pooled: many rows
```

`rail_accounts` today encodes one account per (owner, rail, currency, custody) and the code enforces one external
account per rail+currency. The pooled model keeps that row as the deployment's account and adds the allocation
records; the allocated model gives each organization its own row. Both are additive.

## 5. Explicitly out of scope for 4.1

* Building the routing table or the `provider_accounts` migration.
* Accepting a webhook without a configured verification id.
* Any tenant decision derived from event metadata, an email, a batch id or a client header.
* Exposing a payout-reconciliation endpoint (the two-person model is prepared, not published).
