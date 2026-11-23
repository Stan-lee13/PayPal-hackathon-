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

`tests/member-administration.test.ts` (5 tests, PostgreSQL):

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
