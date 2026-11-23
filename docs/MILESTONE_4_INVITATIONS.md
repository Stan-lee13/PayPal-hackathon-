# Milestone 4.6 — the way into an organization from outside it

Milestone 4.5 gave a session a way to choose which of its memberships it is served for, and closed with the gap it
had not touched: *an `INVITED` row is required for a person to appear in an organization and cannot be selected;
there is still no screen that accepts an invitation, and no email is sent.* That status and the
`organization_invitations` table have existed since 4.1 with no code writing either of them. This milestone is that
code.

## Two decisions, both from the tenancy work

**The organization is the session's, never the request's.** `POST /api/organizations/invitations` takes an address
and a role. It does not take an organization id. The inviter's organization comes from `requestScope`, which reads a
server-validated session and an active membership in it, exactly as every other tenant route does. There is
therefore no field to forge and no id to aim at somebody else's roster.

**The address is a hint; the token is the proof, and the session says who is holding it.** An invitation is bound to
one address, but an address is not an identity — anyone can type one. So an acceptance requires all three: the raw
token (control of the link), a valid session row (who is asking), and a **verified** email on that user matching the
address invited (that the two are the same person). Any one of those missing is a 403, and the invitation stays
unused.

## What exists now

```
GET  /api/organizations/members                       member.read   roster + outstanding invitations
POST /api/organizations/invitations                   member.manage {email, role, ttlHours?} → the link, once
POST /api/organizations/invitations/:id/revoke        member.manage withdraw a pending invitation
POST /api/invitations/accept                          a session, no membership yet {token}
```

`lib/identity/members.ts` is the whole implementation. The four properties worth stating outright:

* **The token exists once.** Thirty-two random bytes (256 bits), returned in the creation response together with
  `acceptPath`, and never stored: the row keeps `sha256("envelope-invitation/1|" + token)`. A second copy of the link
  cannot be recovered from the database, so losing it means issuing another, which withdraws the first (one live
  invitation per address).
* **Single use is a database rule.** Acceptance is one conditional `UPDATE … WHERE accepted_at IS NULL AND
  revoked_at IS NULL AND expires_at > now() RETURNING …` inside a transaction. Two simultaneous clicks cannot both
  match, and the membership write happens in the same transaction, so a failure rolls the claim back too.
* **A role may not carry a permission the inviter lacks.** Roles are named permission sets, so `admin` can invite
  `admin` but not `owner` — the missing `payout.recover.approve` is exactly the second signature that keeps
  recovery from being a one-person operation. The refusal names the permission.
* **Accepting never changes an existing role.** An `ACTIVE` member who accepts is told they already are one; the
  invitation is consumed and nothing else moves. A `REVOKED` membership is restored only by an invitation created
  *after* the revocation: the invitation records a later decision by an owner, whereas one that was in flight when
  the revocation happened must not quietly undo it. `revoked_at` and `revoked_by` are left in place as the history.

Accepting also writes the organization to the session's `active_org_id` (Milestone 4.5), so the person lands in the
organization they just joined rather than whichever membership happens to be oldest. It is a session-row write after
the membership exists, not a grant: `requestScope` still re-checks the membership on every request.

## The two screens

* `/members` — the roster with each role, the outstanding invitations with their expiry, an invite form, the
  one-time link with a copy button, and a withdraw button. Visible to `member.read`; the controls appear only for
  `member.manage`, and the server refuses them regardless of what the page draws.
* `/invitations/[token]` — the accept page. **Opening it consumes nothing**: the invitation is used only by the
  button, so a mail client that prefetches links cannot spend one. Signed out, it offers the sign-in the deployment
  has (the development one on a laptop, the identity provider otherwise), and the token stays in the URL across
  that round trip.

## What this still does not claim

* **No email is sent.** The creator gets the link and passes it on. Sending it would mean choosing a transactional
  email provider and holding one more credential; the flow is honest about not doing that yet.
* ~~**No membership editing beyond invitations.** There is no screen to *change* an existing member's role, and no
  self-service removal. A role change is still a deliberate database operation; accepting an invitation is
  explicitly not a path to one.~~ **Closed by Milestone 4.6b** (`docs/MILESTONE_4_MEMBER_ADMIN.md`): a role can be
  changed and a membership removed from `/members`, bounded on both sides by the same permission-set comparison an
  invitation uses. There is still no self-service leave.
* **No invitation list for the invitee.** A person discovers an invitation through the link they were given, not
  through a page that lists what is waiting for them. That needs the address to be trusted as a lookup key, which
  is a different decision from this milestone's.
* **No provider-level partitioning.** Members belong to organizations in one database; PayPal accounts are still
  the deployment's, as Milestone 4.4 said.

## Evidence

`tests/invitations.test.ts` (9) holds the implementation to each of the above:

* creation is 201, the token is 43 characters, the stored row is a 64-character hash that does not contain the
  token, the inviter sees the invitation and the `canManage` flag, and an owner of another organization sees
  neither the roster nor the invitation;
* acceptance adds one `ACTIVE` membership at the invited role, points the session at that organization, and a
  replay of the same link is a 404 with still exactly one membership row;
* an expired invitation and a withdrawn one are both refused (404), and withdrawing twice is a 404;
* a different signed-in address is a 403 **and the invitation is still pending**, so a wrong attempt cannot grief
  the real invitee; the invited address then accepts;
* a developer has neither `member.read` nor `member.manage` (403/403), an auditor reads the roster but has
  `canManage: false` and cannot invite, an admin cannot grant `owner` (403 naming `payout.recover.approve`) but can
  grant `admin`, and the owner can grant `owner`;
* an invitation that predates a revocation is refused (409) and the membership stays `REVOKED`; one issued after it
  restores the membership with `revoked_at` still recorded;
* an existing auditor who accepts an `owner` invitation stays an auditor (`alreadyMember: true`, role unchanged);
* no session is a 401 and a cross-origin POST is a 403, neither of which consumes the invitation;
* an active member cannot be invited again (409), and a second invitation to the same address withdraws the first
  (the old link is a 404, the new one works).

`tests/route-authorization.test.ts` passes unchanged: the four new endpoints are classified in
`lib/api/route-policy.ts` and the matrix is regenerated from it.
