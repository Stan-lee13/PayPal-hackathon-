# Milestone 4.6b — administering a member who is already here

Milestone 4.6 closed with a gap it named itself: *no membership editing beyond invitations — there is no screen to
change an existing member's role, and no self-service removal.* An invitation deliberately cannot change a role, so
until this existed a role change was a deliberate database operation. This milestone is the two writes that replace
it, and nothing else.

## What exists now

```
POST /api/organizations/members/:userId/role     member.manage  {role}
POST /api/organizations/members/:userId/remove   member.manage
GET  /api/organizations/members                  member.read    roster, now with the caller's own id
```

`lib/identity/members.ts` holds both. The organization still comes from `requestScope` — the session's, never the
request's — so there is no organization id to forge and the addressed member is looked up *inside* that
organization. A member of another organization, or an id that does not exist, is the same 404.

## Four bounds, all from the same rules as invitations

**Authority is a set, and it is compared on both sides.** A role may be granted only if the caller holds every
permission of it (`assertMayGrant`), and a role may be changed or revoked only if the caller holds every permission
of the role being taken away (`assertMayActOn`). For an admin that means neither making an owner nor demoting one:
`payout.recover.approve` is the second signature that keeps recovery from being a one-person operation, and the
refusal names it. Sideways moves where the sets do contain each other — an admin moving finance to developer — are
allowed, because no authority is created or destroyed by them.

**Nobody changes their own row.** A self-change is a 409, so an escalation is never one click and a demotion is
never a slip of the mouse.

**The organization never loses its last owner.** Demoting or removing the only active owner is a 409 with a message
that says to add another owner first. The check runs before the self-check, so the sole owner attempting either
action gets the reason that actually matters.

**Removal is a revocation, not a deletion.** The row keeps its role, its acceptance date, and gains `revoked_by`
and `revoked_at`: who removed them and when stay readable, and the roster stops listing them because the roster
only ever lists `ACTIVE` memberships. A session that was pointed at this organization has `active_org_id` cleared,
so the person's next page falls back to another organization if they have one rather than being a 403 for no
reason — and `requestScope` re-checks the membership on every request regardless, which is what actually enforces
it.

**A pending invitation cannot undo a removal.** Acceptance requires an invitation created *after* the revocation,
so an invitation that was in flight when someone was removed is refused (409) rather than quietly reversing the
decision. Once removed, the address is invitable again — the "already an active member" 409 no longer applies —
and accepting that new invitation restores the membership with `revoked_at` and `revoked_by` still on the row.

## It cannot be done quietly

Every decision in `lib/identity/members.ts` — invite, withdraw, accept, change a role, remove — appends one entry
to the hash-chained `audit_log`, **inside the same transaction as the write it describes**, so the trail cannot
commit without the change or disagree with it afterwards. The chain's scope is the organization itself
(`scope_id = org_id`, no subject), the actor is the new `user` value, and the entry names who did what to whom. It
never contains the invitation token: that exists only in the creation response.

This is what closes the gap this milestone opened with. The chain already existed for money (`principal`, `agent`,
`gateway`, `paypal`, `ai`); identity administration now uses it too, rather than being invisible history. The
detail carries the transition (`from`, `to`), the address, and the actor's user id, and `audit_log.org_id` makes
the organization's administrative history one indexed read — the same read `GET /api/auditor` already offers for an
envelope's chain.

## The screen

`/members` now has, on each row other than the caller's own, a role selector and a `Remove` button, both drawn only
for `member.manage` and both refused by the server regardless of what the page draws. The caller's own row shows
their role and `· you` instead of controls, matching the 409 the server would answer. Everything is read back from
`GET /api/organizations/members` after a change, so the screen never shows a state the server did not confirm.

## What this still does not claim

* **No self-service leave.** A member cannot take themselves out of an organization; that needs a decision about
  what happens to the records they sealed and is not the same thing as an administrator removing them.
* **No chain entry for a session change.** Choosing which organization a session is served for (4.5) writes only
  the session row; it grants nothing, so it is not an administrative decision and is not in the chain.
* **No email.** Still true from 4.6: the link is passed on by hand.
* **No re-invitation from the roster.** A removed member is invited through the same invite form as anyone else;
  the screen does not offer a shortcut for them.
* **No provider-level partitioning.** Unchanged from 4.4.

## Evidence

`tests/member-administration.test.ts` (6 tests, PostgreSQL):

* an owner moves a developer to auditor; the row, the roster and the permissions all follow; setting the role they
  already have returns `changed: false`; a member of another organization and an unknown id are both 404;
* an admin cannot promote to owner (403 naming `payout.recover.approve`), cannot demote an owner (403, role
  unchanged) and cannot remove one; an admin *can* move a finance member to developer; a developer is 403 on both
  writes, an auditor reads the roster with `canManage: false` and is 403 on both writes, and no session is a 401;
* the only owner cannot demote or remove themselves (409, "only owner", role unchanged); with a second owner a
  self-change is still a 409 while moving the other owner is allowed;
* removal sets `REVOKED` with `revoked_by`/`revoked_at`, keeps the role, drops the person from the roster, clears
  their session's `active_org_id`, and their next read is a 403; removing twice is a 404;
* a removed person's address is invitable again; accepting that invitation restores `ACTIVE` at the invited role
  with the revocation still recorded, and the link is spent afterwards;
* a role change, a removal and an invitation leave three entries in one chain for the organization — `seq` 1, 2, 3,
  the first starting at the organization's genesis hash and each naming its predecessor — with `actor: "user"`, the
  `from`/`to` transition, the actor's id, and no copy of the invitation token anywhere in the rows.

`tests/route-authorization.test.ts` passes: both endpoints are classified as `session: "required"` with
`member.manage`, and `docs/MILESTONE_4_ROUTE_AUTHORIZATION_MATRIX.md` is regenerated from that table.

---

# Milestone 4.6c — the decision and the write are the same moment

4.6b decided correctly and wrote separately. Every rule above was checked against rows read *before* the
mutation's transaction opened, and the write then matched on `id` and `ACTIVE` alone. Sequential tests cannot see
the difference; two independent PostgreSQL connections can. Three things could go wrong, and this milestone closes
each of them:

1. **Two owners could demote each other.** With Alice and Bob both owners, both requests count two owners, both
   pass the last-owner check, both update a different row, and the organization ends with none.
2. **A role could be acted on after it changed.** An admin reads a `finance` member, an owner promotes that member
   to owner, and the admin's waiting request — still authorized for `finance` — demotes an owner without holding
   `payout.recover.approve`.
3. **A caller could act on authority they no longer had.** The scope's role is what the caller held when the
   request arrived. Demoted or removed while the request waits, they would still be authorized.

## The organization's membership lock

```
organization-membership|<orgId>   →  pg_advisory_xact_lock(hashtextextended(…, 0))
```

One transaction-scoped PostgreSQL lock per organization, taken as the first statement of every membership
mutation: role change, removal, invitation creation, invitation withdrawal, invitation acceptance. It is
PostgreSQL's lock, so another Node process, a serverless instance or a worker takes the same one — a process-local
mutex would serialize nothing across them. It is keyed by the organization, so two organizations never wait for
each other, and it is domain-separated from the audit chain's `envelope-audit|…` key so the two cannot collide.
It is held until the outer transaction commits or rolls back, and the audit entry is written inside it (in its own
savepoint), so a trail can neither outlive a rolled-back change nor record one that never committed.

`inMembershipTransaction(orgId, run)` in `lib/identity/members.ts` is the only way in.

## The order inside the lock

Every mutation now runs: begin → lock → re-read the caller → confirm the caller is `ACTIVE` and its current role
still has `member.manage` → re-read the target → recheck `assertMayActOn`/`assertMayGrant` against those fresh
roles → count active owners **inside the transaction** → conditional update → confirm exactly one row → append the
success audit entry → commit.

**The last-owner invariant** is `ActiveOwners(org) ≥ 1` after every committed mutation. `assertNotOnlyOwner` now
takes the transaction, so the count and the update see the same state; it runs for demotions and removals of an
owner, after the target's role has been re-read. Two owners demoting each other serialize: the first commits, the
second re-reads, counts one owner and is refused with a 409.

**The caller is re-authorized from the database.** `scope.role` is the initial context, not the authority for a
write. `requireMemberManager(tx, scope)` re-reads the membership by `(org_id, user_id)` and refuses a 403 if it is
missing, not `ACTIVE`, or its current role no longer includes `member.manage`. The audit entry names the id from
that fresh row.

**The target is re-authorized from the database.** The target is read by `(org_id, user_id)` inside the lock, and
both permission-set comparisons use the roles as they are now. A member promoted to owner while the request
waited is no longer actionable by an admin, because the comparison is against `owner`, not the `finance` the
request saw.

## Conditional writes, and nothing recorded for a write that changed nothing

Both writes are `UPDATE … RETURNING` conditional on the state that was authorized, and the returned row is the
only thing that produces a result:

* Role change — `where id = … and org_id = … and status = 'ACTIVE' and role = <the role authorized>`.
* Removal — `where id = … and org_id = … and status = 'ACTIVE'`, the `ACTIVE → REVOKED` transition itself.
* Invitation withdrawal — `where id = … and org_id = … and accepted_at is null and revoked_at is null`.

Zero rows is a 409 (`"This member changed while the request was in flight…"`) or a 404 for a withdrawal: no
`changed: true`, no session cleanup, no audit entry. The audit `detail` uses the *returned* row — `from` is the
role that was actually replaced, `role` the one actually revoked — so the chain records the transition that
committed, never an attempted one.

## Invitations under the same lock

Creation, withdrawal and acceptance all take the organization lock, which is what makes the documented promises
true across connections rather than only in sequence:

* **One live invitation per address.** Concurrent invitations are applied in turn, so the later one withdraws the
  earlier one instead of both staying live. Superseding now writes `member.invitation_withdrawn` for each
  invitation it displaced (with `supersededBy` in the detail), so the chain matches the roster rather than
  silently dropping a live invitation.
* **Withdrawal is once.** The conditional returning update means a second withdrawal — simultaneous or later —
  matches nothing, writes nothing and adds nothing to the chain.
* **Acceptance is once, and cannot undo a newer removal.** The single-use claim keeps its conditional form, and it
  now happens after the lock, so an administrator's removal cannot commit between the claim and the membership
  write it restores.

## Evidence: real PostgreSQL, independent connections, coordinated windows

`tests/member-administration.concurrent.postgres.test.ts` (14 tests) skips unless `REAL_DATABASE_URL` is set, and
fails preflight on PGlite, a single backend or `DB_POOL_MAX < 2`. Each race uses a **gate**: a separate
`postgres` connection takes the organization's lock, the requests under test are parked on it, the competing
change is committed inside the gate, and the gate then releases. That makes the window deterministic instead of
hopeful, and the assertions are on persisted state and the audit rows, not only on HTTP codes.

| Scenario | Test | Expectation |
| --- | --- | --- |
| Two owners demote each other | `two owners demoting each other…` | one 200, one 409, an owner remains, one audit entry |
| Two owners remove each other | `two owners removing each other…` | one revocation, an owner remains, one entry |
| Demotion races removal | `a demotion racing a removal…` | an owner remains |
| Target promoted mid-request | `an admin cannot demote/remove a member who was promoted to owner…` | 403 naming `payout.recover.approve`, role unchanged, no entry |
| Caller demoted mid-request | `a caller demoted while the request waited…` | 403, target unchanged |
| Caller removed mid-request | `a caller removed while the request waited…` | 403, target unchanged |
| Double removal | `two simultaneous removals of one member…` | `[200, 404]`, one revocation, one entry |
| Role change vs removal | `a role change and a removal racing…` | state and chain agree with what committed |
| Cross-organization | `an organization's lock does not serialize another…` | no serialization between organizations |
| Concurrent invitations | `two simultaneous invitations to one address…` | exactly one live invitation |
| Double withdrawal | `two simultaneous withdrawals…` | `[200, 404]`, one entry |
| Concurrent acceptance | `two simultaneous acceptances…` | one membership, one entry |
| Chain under concurrent writes | `concurrent administrative writes produce one unbroken chain` | `seq` 1..5, no gap or fork, `verifyChain` accepts |

**Before the fix** the same suite was run against `HEAD`'s `lib/identity/members.ts` (with only the lock-key
exports appended so the gate could address the lock): **12 of 14 failed** — both demotions succeeded, the queue
never formed ("2 request(s) never queued on the organization's membership lock"), the removed member was revoked
twice, the recorded `from` role was `developer` where the committed one was `auditor`, two invitations stayed
live, and both withdrawals returned 200. **After the fix** all 14 pass. The two that pass either way are the
cross-organization non-serialization test and the concurrent-acceptance test, whose single-use claim was already
conditional.

Local run (PostgreSQL 16.16): `14 passed`. Full suite: `40 files / 664 tests passed`. `tsc --noEmit` and
`next build` green. PostgreSQL 18 results come from the CI matrix; see the run linked in the delivery report.

## The screen, reviewed in a browser

`/members` was loaded in a real browser against a live dev server and a real PostgreSQL database, signed in through
`POST /api/dev/session`, with a seeded owner, admin, auditor, developer and finance member. What was observed:

* the roster loads with name, address, role, `since`, and `· you` on the caller's own row;
* the caller's row has **no** selector and **no** `Remove` — the owner sees three control pairs for three other
  members and none for itself, and an admin sees the same for everyone except itself;
* a role change (`developer → auditor`) succeeds and the reloaded roster shows the server's value, and the chain
  gains `member.role_changed` with `from: developer, to: auditor`;
* `Remove` asks `window.confirm` first: dismissing it leaves the member in place, accepting it revokes them, drops
  them from the roster, and adds `member.removed` to the chain — one revocation, one entry, matching the database;
* a refusal is shown, not swallowed: an admin demoting or removing the owner gets *"The admin role cannot change a
owner, because it does not include payout.recover.approve."*, and the owner's row is unchanged afterwards;
* at 390 px the page has no horizontal overflow (`scrollWidth == clientWidth`) and the controls wrap under the
  name instead of being clipped.

One defect was found and fixed here: both handlers called the roster reload before setting the refusal message, so
the reload's `setError(null)` erased the reason and a refused change simply snapped back with no explanation. The
order is now reload-then-message.

**Limitations of this review.** The local dev server could not compile `instrumentation.ts` (its startup hook
imports the `postgres` driver, which Next's edge variant of the hook cannot resolve), so the review ran with that
hook temporarily stubbed and restored immediately afterwards; the membership code under review was untouched.
Loading states and duplicate-submission guards were read in the code (`disabled={busy}` on every control) but not
observed under a deliberately slow response. The only-owner refusal was not exercised in the browser, since the
demo organization has more than one owner and the sole owner cannot be reached without deleting members.

# Milestone 4.6d — the trail, read back

Section 4.6c wrote every membership decision into a hash chain scoped to the organization. Until now the only way
to read that chain was a database client, which is not something to ask an auditor to do. `/audit` is the read
side of it, and it is deliberately the smallest thing that is useful: it shows the decisions, it says whether the
chain verifies, and it cannot change anything.

## The read

| | |
|---|---|
| Route | `GET /api/organizations/audit` (`lib/api/handlers.ts`, policy `session` + `audit.read`) |
| Module | `lib/identity/organization-audit.ts` |
| Screen | `app/audit/page.tsx`, `app/audit/view.tsx`, linked from the site menu as **Audit trail** |
| Scope | `scope_id = <session's organization>` **and** `subject_id IS NULL` — the administration chain, not an envelope's |
| Order | newest first, one page of 100, with `total` so the page can say how much of it is shown |
| Permission | `audit.read`: owner, admin, finance, approver and auditor may read it; a developer is refused (403) |
| Session | required; the organization is resolved from the session row and its membership, never from the request |
| Writes | none. No function in the module writes, and there is no route that appends an entry |

Three properties are the point, and each is a test:

1. **It cannot be pointed elsewhere.** There is no organization id in the request — not a query parameter, not a
   body field — so the rows are selected by the scope `lib/api/next.ts` resolved from the session. Another
   organization's decisions are not filtered out of the answer; they are never candidates for it.
2. **It needs `audit.read`, not merely a membership.** A developer holds no audit permission and is refused,
   rather than shown an empty page that would read as "nothing happened here". A signed-out visitor is a 401.
3. **It is read-only.** Entries exist only as the by-product of a membership change committed in the same
   transaction; the trail cannot be appended to, edited or back-filled through HTTP.

## The chain, checked rather than asserted

The response loads the whole chain (up to 1000 entries) and runs `verifyChain` over it, so the page can say one of
three honest things rather than display an unearned green tick:

* **verified** — every entry's hash matches its content, each `prev_hash` matches its predecessor, and entry 1
  starts at the organization's genesis; the page shows the head hash, which is the value to compare later to
  detect truncation;
* **broken** — with the reason from `verifyChain` (an edited entry, a missing link), and the entries still shown:
  a trail that fails to verify is evidence, not something to hide;
* **not checked** — the chain is longer than the load limit, and the page says so instead of guessing.

## What it does not do

It reads the administration chain only. The per-envelope chains keep their own scope and are read with the
envelope they belong to; this page is not a general audit browser. There is no export (`audit.export` is a
separate permission and nothing exports yet), no filtering or search, and no pagination link — the page returns
the newest 100 and names the total. Nothing is cached: `dynamic = "force-dynamic"` and `cache: "no-store"` on the
request, so a reader never sees a stale trail.

## Evidence

`tests/organization-audit.test.ts` (5 tests, real PostgreSQL): a signed-out read is 401 and a developer is 403
while an auditor reads; the chain is returned newest first with the head equal to the newest stored hash and a
refused change leaving no entry; another organization's decision is absent from an empty trail; an edited entry
turns `verified` to `false` with the reason and still returns the entries; and the route table holds exactly one
`/api/organizations/audit` key, a `GET` requiring `audit.read`.
