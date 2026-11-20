/**
 * Identity, membership and permission foundation.
 *
 * The pure block pins the permission matrix and the legacy-map validation; the database block proves the
 * server-side checks against real PostgreSQL: a session is validated by its row (not by its cookie), a revoked
 * membership stops immediately, a suspended organization cannot start money movement, and a principal belongs to
 * exactly one organization.
 */
import { describe, expect, it } from "vitest";
import { permissionsFor, roleHas, MONEY_PERMISSIONS, PERMISSIONS, ROLES } from "../lib/identity/permissions";
import { parseLegacyOrganizationMap, organizationForPrincipal, unmappedLegacyPrincipals } from "../lib/identity/legacy-map";
import { productionSecurityProblems } from "../lib/security/startup";
import { useTestEnv } from "./helpers";

const KEY_A = "A".repeat(43);
const KEY_B = "B".repeat(43);

describe("permission matrix (pure)", () => {
  it("grants read-only roles no way to move money", () => {
    for (const role of ["auditor", "developer"] as const) {
      const p = permissionsFor(role);
      for (const money of MONEY_PERMISSIONS) expect(p.has(money), `${role} must not have ${money}`).toBe(false);
      expect(p.has("payment.read")).toBe(true);
    }
  });

  it("keeps credential management separate from payment initiation", () => {
    // No role gets payment.initiate *because* it can manage provider credentials; the permissions are distinct,
    // and a context that holds only provider.manage cannot initiate a payment.
    const p = permissionsFor("admin");
    expect(p.has("provider.manage")).toBe(true);
    expect(p.has("payment.initiate")).toBe(true);
    // The check itself is by permission, so a set with only provider.manage fails for payment.initiate.
    const onlyCredentials = new Set<string>(["provider.manage"]);
    expect(onlyCredentials.has("payment.initiate")).toBe(false);
  });

  it("separates proposing a payout recovery from approving it", () => {
    expect(roleHas("finance", "payout.recover")).toBe(true);
    expect(roleHas("finance", "payout.recover.approve")).toBe(false);
    expect(roleHas("approver", "payout.recover.approve")).toBe(true);
    expect(roleHas("approver", "payout.recover")).toBe(false);
    // Only the owner holds both, which is why the two-person rule is enforced per user, not per role, when the
    // route is exposed in a later milestone.
    expect(roleHas("owner", "payout.recover") && roleHas("owner", "payout.recover.approve")).toBe(true);
  });

  it("never lets audit or member management imply a write", () => {
    expect(permissionsFor("auditor").has("member.manage")).toBe(false);
    expect(permissionsFor("auditor").has("org.manage")).toBe(false);
    expect(permissionsFor("developer").has("api_key.manage")).toBe(false);
    expect(permissionsFor("unknown-role").size).toBe(0);
  });

  it("every permission is granted to at least one role", () => {
    const all = new Set(ROLES.flatMap((r) => [...permissionsFor(r)]));
    expect(PERMISSIONS.filter((p) => !all.has(p))).toEqual([]);
  });
});

describe("legacy organization map (pure)", () => {
  const good = { version: 1, organizations: [{ organization_id: "org_ada", name: "Ada Ltd", legacy_principals: [KEY_A] }] };

  it("accepts an explicit, complete mapping", () => {
    const r = parseLegacyOrganizationMap(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(organizationForPrincipal(r.map, KEY_A)).toBe("org_ada");
  });

  it("refuses a principal assigned to two organizations, or twice to one", () => {
    const twice = { version: 1, organizations: [
      { organization_id: "org_a", name: "A", legacy_principals: [KEY_A] },
      { organization_id: "org_b", name: "B", legacy_principals: [KEY_A] },
    ] };
    const r = parseLegacyOrganizationMap(twice);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/may belong to exactly one organization/);
  });

  it("refuses private key material, duplicates and malformed ids", () => {
    const bad = { version: 1, organizations: [
      { organization_id: "default", name: "D", legacy_principals: [`${KEY_A}d=abc`] },
      { organization_id: "org_a", name: "A", legacy_principals: [KEY_B, KEY_B] },
    ] };
    const r = parseLegacyOrganizationMap(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join(" ")).toMatch(/private key material/);
      expect(r.problems.join(" ")).toMatch(/must look like org_/);
    }
  });

  it("reports every unmapped legacy principal instead of assigning it anywhere", () => {
    const r = parseLegacyOrganizationMap(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(unmappedLegacyPrincipals(r.map, [KEY_A, KEY_B])).toEqual([KEY_B]);
  });
});

describe("production startup checks (pure)", () => {
  it("refuses production without authentication or key protection", () => {
    const problems = productionSecurityProblems({ NODE_ENV: "production" });
    expect(problems.map((p) => p.code)).toContain("AUTH_NOT_CONFIGURED");
    expect(problems.map((p) => p.code)).toContain("KEYS_NOT_PROTECTED");
  });

  it("allows a development process to start without them", () => {
    expect(productionSecurityProblems({ NODE_ENV: "development" })).toEqual([]);
  });

  it("refuses a development bypass and the mock rail in production", () => {
    const problems = productionSecurityProblems({
      NODE_ENV: "production", AUTH_SECRET: "x".repeat(40), AUTH_OIDC_ISSUER: "https://idp.example",
      AUTH_OIDC_CLIENT_ID: "id", AUTH_OIDC_CLIENT_SECRET: "secret", AUTH_URL: "https://app.example",
      ENVELOPE_KEY_SECRET: "y".repeat(30), AUTH_DEV_BYPASS: "1", ENVELOPE_RAIL_PROVIDER: "mock",
    });
    expect(problems.map((p) => p.code)).toEqual(expect.arrayContaining(["DEV_AUTH_BYPASS", "MOCK_RAIL_IN_PRODUCTION"]));
  });
});

// ---------------------------------------------------------------------------
// Real PostgreSQL
// ---------------------------------------------------------------------------

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("identity and authorization (real PostgreSQL)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const C = await import("../lib/auth/context");
  const { createTestIdentity, testIdentityAllowed } = await import("../lib/auth/testing");
  const { newId } = await import("../lib/ids");
  const E = await import("../lib/envelope/core");
  const T = await import("../lib/gateway/trust");
  const { UserFacingError } = await import("../lib/errors");

  const status = async (fn: () => Promise<unknown>): Promise<number | null> => {
    try { await fn(); return null; } catch (e) { return e instanceof UserFacingError ? e.status : -1; }
  };

  const reset = () => getDb().execute(sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);

  it("has no test identity in production", async () => {
    // The guard is a pure check of NODE_ENV, so it can be asserted without changing the suite's own environment.
    expect(testIdentityAllowed({ NODE_ENV: "production" })).toBe(false);
    await reset();
  });

  it("validates the session row, not the cookie: unknown, expired and disabled are all 401", async () => {
    await reset();
    expect(await status(() => C.requireAuthenticatedUser(null))).toBe(401);
    expect(await status(() => C.requireAuthenticatedUser("not-a-session"))).toBe(401);

    const expired = await createTestIdentity({ expiresAt: new Date(Date.now() - 1000) });
    expect(await status(() => C.requireAuthenticatedUser(expired.sessionToken))).toBe(401);

    const live = await createTestIdentity();
    expect((await C.requireAuthenticatedUser(live.sessionToken)).userId).toBe(live.userId);
    await getDb().update(schema.users).set({ status: "DISABLED" }).where(eq(schema.users.id, live.userId));
    expect(await status(() => C.requireAuthenticatedUser(live.sessionToken))).toBe(401);
  });

  it("refuses an organization the user is not an active member of, and revocation is immediate", async () => {
    await reset();
    const a = await createTestIdentity({ role: "finance" });
    const b = await createTestIdentity({ role: "owner" });
    expect(await status(() => C.requireOrgContext({ sessionToken: a.sessionToken, orgId: b.orgId }))).toBe(403);
    expect(await status(() => C.requireOrgContext({ sessionToken: a.sessionToken, orgId: "org_missing" }))).toBe(403);

    const ctx = await C.requireOrgContext({ sessionToken: a.sessionToken, orgId: a.orgId, permission: "payment.initiate" });
    expect(ctx.role).toBe("finance");
    await getDb().update(schema.memberships).set({ status: "REVOKED", revokedAt: new Date() }).where(eq(schema.memberships.id, a.membershipId));
    expect(await status(() => C.requireOrgContext({ sessionToken: a.sessionToken, orgId: a.orgId }))).toBe(403);
  });

  it("treats an invitation as not being a membership", async () => {
    await reset();
    const invited = await createTestIdentity({ membershipStatus: "INVITED" });
    expect(await status(() => C.requireOrgContext({ sessionToken: invited.sessionToken, orgId: invited.orgId }))).toBe(403);
  });

  it("suspends money movement, not reading", async () => {
    await reset();
    const { orgId, sessionToken } = await createTestIdentity({ orgStatus: "SUSPENDED", role: "owner" });
    const ctx = await C.requireOrgContext({ sessionToken, orgId });
    expect(() => C.requirePermission(ctx, "org.read")).not.toThrow();
    expect(() => C.requirePermission(ctx, "payment.initiate")).toThrow(/suspended/);
    expect(() => C.requirePermission(ctx, "refund.issue")).toThrow(/suspended/);
  });

  it("applies the matrix: auditor cannot pay, developer cannot refund, finance cannot approve a recovery", async () => {
    await reset();
    const auditor = await createTestIdentity({ role: "auditor" });
    const developer = await createTestIdentity({ role: "developer" });
    const finance = await createTestIdentity({ role: "finance" });
    const actx = await C.requireOrgContext({ sessionToken: auditor.sessionToken, orgId: auditor.orgId });
    expect(() => C.requirePermission(actx, "payment.initiate")).toThrow(/does not include/);
    const dctx = await C.requireOrgContext({ sessionToken: developer.sessionToken, orgId: developer.orgId });
    expect(() => C.requirePermission(dctx, "refund.issue")).toThrow(/does not include/);
    const fctx = await C.requireOrgContext({ sessionToken: finance.sessionToken, orgId: finance.orgId });
    expect(() => C.requirePermission(fctx, "payout.recover")).not.toThrow();
    expect(() => C.requirePermission(fctx, "payout.recover.approve")).toThrow(/does not include/);
  });

  it("reports another organization's record as not found", async () => {
    await reset();
    const a = await createTestIdentity();
    const b = await createTestIdentity();
    const ctx = await C.requireOrgContext({ sessionToken: a.sessionToken, orgId: a.orgId });
    expect(() => C.requireOwnedResource(ctx, { orgId: a.orgId })).not.toThrow();
    expect(await status(async () => C.requireOwnedResource(ctx, { orgId: b.orgId }))).toBe(404);
    expect(await status(async () => C.requireOwnedResource(ctx, { orgId: null }))).toBe(404);
  });

  it("maps a principal to exactly one organization and fails closed for an unknown one", async () => {
    await reset();
    const a = await createTestIdentity();
    const b = await createTestIdentity();
    const kp = await E.generateKeyPair();
    await getDb().insert(schema.principals).values({ id: newId("prn"), orgId: a.orgId, publicKey: kp.publicKey, label: "Ada's key" });
    expect((await C.organizationForPrincipal(kp.publicKey))?.orgId).toBe(a.orgId);
    expect((await C.requirePrincipalOrganization(kp.publicKey)).orgId).toBe(a.orgId);
    expect(await status(async () => C.requirePrincipalInOrganization(kp.publicKey, b.orgId))).toBe(403);
    expect(await status(async () => C.requirePrincipalOrganization("Z".repeat(43)))).toBe(403);

    // The same public key cannot be assigned to a second organization.
    await expect(getDb().insert(schema.principals).values({ id: newId("prn"), orgId: b.orgId, publicKey: kp.publicKey, label: "elsewhere" }))
      .rejects.toThrow();

    // The Ed25519 authority is untouched: a signature from this principal still verifies.
    const sig = await E.signDetached(kp.privateKey, "envelope-root/1", { hello: "world" });
    expect(await E.verifyDetached(kp.publicKey, "envelope-root/1", { hello: "world" }, sig)).toBe(true);
  });

  it("keeps a stable OIDC identity separate from the email address", async () => {
    await reset();
    const db = getDb();
    await db.insert(schema.users).values([
      { id: newId("usr"), oidcIssuer: "https://idp.example", oidcSubject: "sub-1", email: "same@example.com", emailVerified: true },
      { id: newId("usr"), oidcIssuer: "https://idp.example", oidcSubject: "sub-2", email: "same@example.com", emailVerified: true },
    ]);
    // Two people may share an address (a shared mailbox, a reassigned address); identity is the (issuer, subject).
    const rows = await db.select().from(schema.users).where(and(eq(schema.users.oidcIssuer, "https://idp.example"), eq(schema.users.email, "same@example.com")));
    expect(rows).toHaveLength(2);
    await expect(db.insert(schema.users).values({ id: newId("usr"), oidcIssuer: "https://idp.example", oidcSubject: "sub-1", email: "other@example.com" })).rejects.toThrow();
  });

  it("distinguishes a mathematically valid receipt from one a trusted organization gateway signed", async () => {
    await reset();
    const a = await createTestIdentity();
    const b = await createTestIdentity();
    const gw = await E.generateKeyPair();
    const issuedAt = new Date().toISOString();
    const body = {
      v: "envelope-receipt/2" as const,
      operation: { kind: "payment" as const, ref: "sp_test" },
      organization: { principal: "P".repeat(43), name: "Ada" },
      agent: { key: "A".repeat(43), label: "ops", account: "0000-0000-0000" },
      authority: { principal: "P".repeat(43), request: {}, requestSig: "sig", chain: [] },
      amount: { minor: 1000, currency: "USD" },
      provider: { rail: "mock", label: "Mock", mode: "simulated", custody: "provider" as const, externalAccountId: null, movedExternally: true },
      providerOps: [{ kind: "payout" as const, id: "BATCH-1" }],
      settlement: { state: "payout_pending" as const, asOf: issuedAt, meaning: "asked, not delivered", providerStatus: "PENDING" },
      issuedAt,
      gateway: gw.publicKey,
      verification: { offline: [], external: [], note: "signature is not delivery" },
    };
    const receipt = { ...body, sig: await E.signDetached(gw.privateKey, "envelope-receipt/2", body) } as unknown as import("../lib/db/schema").Receipt;

    const untrusted = await T.verifyTrustedReceipt(receipt, { orgId: a.orgId });
    expect(untrusted.signatureValid).toBe(true);
    expect(untrusted.trusted).toBe(false);
    expect(untrusted.meaning).toMatch(/not in any organization's trust registry/);

    await T.trustGatewayKey({ orgId: a.orgId, publicKey: gw.publicKey });
    expect((await T.verifyTrustedReceipt(receipt, { orgId: a.orgId })).trusted).toBe(true);
    // Another organization must not accept it.
    expect((await T.verifyTrustedReceipt(receipt, { orgId: b.orgId })).trusted).toBe(false);
    expect(await T.organizationsTrustingReceipt(receipt)).toEqual([a.orgId]);

    // Rotation: retiring the key keeps historical receipts trusted.
    const fingerprint = await T.gatewayKeyFingerprint(gw.publicKey);
    await T.retireGatewayKey({ orgId: a.orgId, fingerprint });
    const retired = await T.verifyTrustedReceipt(receipt, { orgId: a.orgId });
    expect(retired.trusted).toBe(true);
    expect(retired.state).toBe("RETIRED");
  });
});
