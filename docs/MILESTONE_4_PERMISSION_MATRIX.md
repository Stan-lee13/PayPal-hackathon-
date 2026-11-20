# Milestone 4.1 — permission matrix

The matrix is implemented in [`lib/identity/permissions.ts`](../lib/identity/permissions.ts) and checked
server-side by `requirePermission` in [`lib/auth/context.ts`](../lib/auth/context.ts). This document is the audit
view of the same table; a test asserts the pure rules (no read-only role can move money, the recovery roles are
separated, every permission is granted to someone).

| Permission | Owner | Admin | Finance | Approver | Auditor | Developer |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `org.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.manage` | ✓ | ✓ | | | | |
| `member.read` | ✓ | ✓ | | | ✓ | |
| `member.manage` | ✓ | ✓ | | | | |
| `provider.read` | ✓ | ✓ | ✓ | | ✓ | |
| `provider.manage` | ✓ | ✓ | | | | |
| `envelope.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `envelope.seal` | ✓ | ✓ | ✓ | | | |
| `envelope.revoke` | ✓ | ✓ | ✓ | | | |
| `budget.manage` | ✓ | ✓ | ✓ | | | |
| `payment.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payment.initiate` | ✓ | ✓ | ✓ | | | |
| `refund.issue` | ✓ | ✓ | ✓ | | | |
| `payout.recover` | ✓ | ✓ | ✓ | | | |
| `payout.recover.approve` | ✓ | | | ✓ | | |
| `statement.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `audit.read` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `audit.export` | ✓ | ✓ | | | ✓ | |
| `api_key.read` | ✓ | ✓ | | | | ✓ |
| `api_key.manage` | ✓ | ✓ | | | | |

## Enforced rules

1. **Read-only never implies write.** `auditor` and `developer` have no permission in
   `MONEY_PERMISSIONS` (`envelope.seal`, `envelope.revoke`, `budget.manage`, `payment.initiate`,
   `refund.issue`, `payout.recover`, `payout.recover.approve`).
2. **Credential management is not money movement.** `provider.manage` is a separate permission; a context that
   holds only it fails `payment.initiate`. No role receives `payment.initiate` *because* it manages credentials.
3. **Two-person recovery.** `finance` may propose a reconciliation (`payout.recover`) and cannot approve one
   (`payout.recover.approve`); `approver` may approve and cannot propose. Only the owner holds both, which is why
   the two-person rule is enforced **per user** (`decided_by <> proposed_by`) when the route is exposed in a later
   milestone. This milestone does not expose the recovery route at all.
4. **Suspension is enforced centrally.** `requirePermission` refuses every money permission while the
   organization's status is not `ACTIVE`, for every role including owner. Reads stay available.
5. **Membership revocation is immediate.** `requireOrganizationMembership` reads the row on every request and
   accepts only `status = 'ACTIVE'`. An `INVITED` row is not a membership.
6. **The UI is not the control.** Nothing here is consulted by a page; the checks run in the server path.

## What is not yet enforced, stated plainly

* The **existing financial routes** still authorize by signature or by nothing (see the route matrix). The
  permission matrix is the model they will be checked against in the tenant-partitioning phase; this milestone
  establishes it and enforces it on the context/permission functions, not across every legacy handler.
* `api_key.*` is a permission with no credential implementation yet. Issuing API keys is a later phase; the
  permission exists so the matrix does not have to change then.
