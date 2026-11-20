# Milestone 4.1 — identity, authentication and legacy migration

This document records the decisions Milestone 4.1 made, so the next phase inherits reasons rather than guesses.

## 1. The model

```
human user (issuer, subject)  ── membership (role, status) ──►  organization (tenant, status)
                                                                    │
                                                                    │ principal mapping (exactly one org per key)
                                                                    ▼
                                                     Ed25519 principals ──► root envelopes ──► agents
                                                                                                (signed requests)
```

* **A human user** is `(oidc_issuer, oidc_subject)`. Email is an attribute with a `verified` flag; it is never the
  identity key and never a reason to merge two accounts. `getUserByEmail` returns null on purpose.
* **An organization** has an immutable id, a name, and a status. `SUSPENDED` and `CLOSED` block every money
  permission centrally.
* **A membership** is one row per `(org, user)`; `status` is `INVITED`, `ACTIVE` or `REVOKED`. Only `ACTIVE`
  authorizes. Revocation is read on every request, so it takes effect immediately.
* **A principal** is an existing Ed25519 public key. `principals.public_key` is unique, so a key belongs to exactly
  one organization. No key is reissued and no envelope signature changes.
* **An agent** is still a key that holds a block. Agents never sign in and never receive a session; their
  authority remains the signed chain. `organizationForPrincipal` / `requirePrincipalOrganization` resolve *which
  organization* a signed request belongs to, once the tenant phase scopes handlers by it.
* **Provider accounts** are not forced to one organization: `rail_accounts` is provider-scoped and pooled mode
  means several organizations share one external account. See `MILESTONE_4_WEBHOOK_TENANCY_DESIGN.md`.

## 2. Authentication implementation

**Auth.js v5 core (`@auth/core` 0.41.x)** with a generic OIDC provider, a database adapter over the new tables, and
database sessions.

Why:

* it is maintained and implements the authorization-code flow with PKCE, state and nonce, issuer/subject
  validation, CSRF/origin handling and sign-out;
* it needs no framework migration on Next.js 15 / React 19 — the handler is `Auth(request, config)`;
* `@auth/nextjs` has no stable 0.41.x release on npm (only a prerelease), so the core package is used directly;
* the provider is generic OIDC (issuer + client id + secret), not a vendor SDK.

Session policy (`lib/auth/config.ts`): database strategy, 8-hour lifetime, hourly renewal, `HttpOnly`,
`SameSite=Lax`, `Secure` in production, opaque token in an `authjs.session-token` cookie. No privileged token is
written to `localStorage`. Every protected operation calls `requireAuthenticatedUser`, which loads the session row
and the user row; a cookie alone proves nothing.

Production is fail-closed (`lib/security/startup.ts`, called from `instrumentation.ts`):

* missing issuer/client/secret or a secret shorter than 32 characters → refuse to start;
* `AUTH_DEV_BYPASS=1` or `ENVELOPE_DEV_AUTH=1` → refuse to start;
* no canonical origin and no controlled Host (`AUTH_URL` / `APP_BASE_URL` / `AUTH_TRUST_HOST=1`) → refuse;
* unsealed gateway private keys → refuse;
* `ENVELOPE_RAIL_PROVIDER=mock` → refuse.

A development-only OIDC provider can be configured with `AUTH_TEST_OIDC_*`; in production that function returns
null even when the variables are set. Tests use `lib/auth/testing.ts`, which writes the rows an OIDC callback
would have written and refuses to run when `NODE_ENV=production`.

**No password system exists**, and none was added.

## 3. Key management

* `ENVELOPE_KEY_SECRET` seals private JWKs with AES-256-GCM (HKDF-derived key). `assertKeyProtection()` refuses to
  store a plain JWK in production, and `sealJwk` calls it on the write path as well as at startup.
* `lib/secrets.ts` provides `SecretStore` with two honest implementations: `LocalEnvSecretStore` (development
  only, refuses production) and `EnvironmentSecretStore` (production-capable, reads the process environment).
  There is no fake "managed" store: an environment secret is not a KMS, and the description says so.
* `keyProtectionSummary()` states the difference for health pages: encryption at rest under an environment secret
  protects a database copy, not a host compromise.
* **Receipt trust is separate from signature validity.** `lib/gateway/trust.ts` records a key fingerprint per
  organization (`gateway_key_trust`) and `verifyTrustedReceipt` reports `signatureValid`, `trusted` and the
  organization whose registry contains the key. Retiring a key keeps historical receipts trusted and stops it
  being used for new ones. The signed bodies of v1 and v2 receipts are untouched; a future version that embeds a
  key id is a separately versioned protocol change.

## 4. Legacy principal mapping (explicit, never automatic)

1. **Inventory.** `npm run identity:inventory` prints every distinct public key with its record counts per table
   (`roots.principal`, `accounts.owner`, `rail_accounts.owner`, `position_entries.owner`, `audit_log.scope_id`),
   the gateway keys, and the provider accounts (masked). It writes nothing.
2. **Map.** The operator writes `config/legacy-organization-map.json` (see the `.example` file). Each principal
   appears exactly once; private key material is rejected by shape.
3. **Validate and apply.** `npm run identity:migrate -- --map <file> --dry-run` validates the file, inventories the
   database and refuses if any principal is unmapped. `--apply` writes only `organizations` and `principals` rows,
   idempotently. A contradiction with an existing mapping aborts.
4. **Unmapped is a valid state.** `--allow-unmapped` does not assign anything: it records the mapped principals
   and reports the rest, which stay without an organization.

A single organization holding every principal is acceptable only if the inventory genuinely shows one operator and
the operator says so in the file. The script never creates `org_default` on its own, and no financial row is
rewritten: envelopes, receipts, provider ids, spend/transfer references and audit hashes are untouched.

## 5. Known limitations of 4.1

* No `org_id` on financial tables and no RLS: **tenant isolation is not implemented**. The route matrix names each
  route that must gain a session/permission check in the next phase.
* No HTTP route for organization creation, invitations or membership management yet. The tables, statuses and
  permission checks exist; the API is deliberately not exposed before the tenant partitioning.
* No API-key credentials (`api_key.*` permissions reserved).
* No per-organization gateway signing keys; the trust registry is ready for them.
* No payout-recovery endpoint. The permission split and the "different user approves" rule are documented and
  modelled, not published.
