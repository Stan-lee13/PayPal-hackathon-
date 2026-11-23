# Milestone 4.5 — a session that can say which organization it is for

Milestone 4.4 made a session mandatory for every read that serves one organization, and scoped that read to the
caller's organization. It left one dead end, stated in its own closing section: *a person in two organizations is
served the oldest active membership; there is no chooser yet.* Someone who owned two organizations could see one
of them, permanently, with no way to reach the other. This milestone closes that.

## The choice lives on the session row

`active_org_id` is a new nullable column on `sessions` (migration
`0017_session_active_organization.sql`). A session names at most one organization; a session with none behaves
exactly as before.

It is **not** a cookie, a header, or a body field that the client sets and the server trusts. Two reasons:

* a value the browser can write is a value the browser can forge, and the whole point of 4.3–4.4 was that the
  organization must come from something the caller cannot invent;
* the selection has to die with the session. Revoking a session deletes the row, and the choice goes with it.

The column is therefore written by one endpoint, after a membership check, and read by the request scope:

```
GET  /api/session/organization           the memberships this person may choose between, and the current one
POST /api/session/organization {orgId}    serve the rest of this session for that organization
```

`POST` refuses with 403 when the organization is not one of the person's **active** memberships — the same 403 an
organization that does not exist returns, so the endpoint cannot be used to discover which organization ids exist.
An `INVITED` membership is not a membership for this purpose, exactly as it is not one for authorization.

## What the reads do with it

`requestScope` (the one place a session becomes an organization) now:

1. validates the session row and the user's status (401 as before);
2. loads every **active** membership of that user, oldest first;
3. serves the one the session chose, if that organization is still among them;
4. otherwise serves the oldest active membership, which is the pre-4.5 behaviour.

Step 3 is a preference among rows the person already has, never an addition to them, so selection cannot widen
access. Step 4 is what makes revocation graceful: a membership revoked after it was chosen drops out of the list
and the session falls back instead of failing every request.

## The console

`components/session-bar.tsx` shows a picker when the person has more than one active membership, and the plain
organization name when they have one. Switching posts the choice and reloads, so every panel on the page is
re-read under the new organization rather than showing one organization's figures under another's name.

## What this still does not claim

* ~~**No invitation flow.** An `INVITED` row is required for a person to appear in an organization and cannot be
  selected; there is still no screen that accepts an invitation, and no email is sent.~~ Milestone 4.6 added the
  flow: an owner or admin issues a single-use, address-bound link and the invitee accepts it at `/invitations/[token]`
  (`docs/MILESTONE_4_INVITATIONS.md`). No email is sent even now — the creator passes the link on.
* **No per-page memory.** The choice is per session, not per route: every read in that session uses it. A second
  tab shares the session and therefore the organization, which is the intended behaviour of a session-level
  selection.
* **Membership is still the only authority.** An owner is an owner in every organization they belong to, with the
  role of that organization's own membership row. There is no cross-organization role inheritance, and the
  organizations remain rows in one database rather than separate databases.

## Evidence

* `tests/organization-selection.test.ts` (5): the start state is the oldest membership and every organization is
  listed; a switch moves the reads in both directions (the envelope that was 404 becomes 200 and the one that was
  200 becomes 404) and is written to the session row; a foreign, unknown or merely `INVITED` organization is 403
  and changes nothing; a membership revoked after selection falls back to the oldest remaining one; the endpoint
  needs a session (401), refuses a cross-origin POST (403) and a body with no organization (400).
* `tests/session-required.test.ts`, `tests/tenant-reads.test.ts`, `tests/tenant-rls.test.ts`,
  `tests/route-authorization.test.ts` unchanged and passing: the session requirement, the organization scoping,
  the row level security policies and the route classification are unaffected.
* `tsc --noEmit` and the whole suite on PostgreSQL 16 and PostgreSQL 18.
