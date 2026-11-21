/**
 * Milestone 4.3 — the caller's organization decides what a financial read returns.
 *
 * What is proved here:
 *   • the organization is carried into a transaction and only there (`set_config(..., true)`), so a pooled
 *     connection cannot hand it to the next request;
 *   • a scoped caller sees its own envelope, payments, cards, balances and movements, and nothing that is filed
 *     under another organization — or under none at all;
 *   • another organization's id is answered as 404 by every addressed read, including the ones that would
 *     otherwise ask the provider about it;
 *   • a signed-in person seals into their organization, and a key already mapped to another one is refused;
 *   • the organization comes from a server-validated session row, never from a header or a body field;
 *   • the development sign-in is refused in production and is a real, revocable session, not a bypass.
 */
import { describe, expect, it } from "vitest";
import type { TenantScope } from "../lib/db/tenant-context";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

const scopeFor = (orgId: string): TenantScope => ({ orgId, userId: "usr_test", role: "owner" });
const setting = (rows: unknown): string | null => (rows as Array<{ org: string | null }>)[0]?.org ?? null;

d("organization-scoped reads (real PostgreSQL)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { TENANT_SETTING, visibleTo, withTenant } = await import("../lib/db/tenant-context");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const K = await import("../lib/gateway/books");
  const S = await import("../lib/gateway/settlement");
  const { handlers, run } = await import("../lib/api/handlers");
  const C = await import("../lib/auth/context");
  const { createTestIdentity } = await import("../lib/auth/testing");
  const { closeDevelopmentSession, devSessionAllowed, openDevelopmentSession } = await import("../lib/auth/dev-session");
  const { newId } = await import("../lib/ids");
  const E = await import("../lib/envelope/core");
  const { UserFacingError } = await import("../lib/errors");
  const { resetSimMemory } = await import("../lib/sim/store");

  const reset = () => getDb().execute(sql`truncate table gateway_key_trust, organization_invitations, sessions, auth_accounts, verification_tokens, memberships, principals, users, organizations, position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);

  const status = async (fn: () => Promise<unknown>): Promise<number | null> => {
    try { await fn(); return null; } catch (e) { return e instanceof UserFacingError ? e.status : -1; }
  };

  async function makeOrg(name: string): Promise<string> {
    const id = newId("org");
    await getDb().insert(schema.organizations).values({ id, name });
    return id;
  }

  async function seedEnvelope(principal: string, orgId: string | null) {
    const db = getDb();
    const rootId = newId("rt");
    await db.insert(schema.roots).values({ id: rootId, principal, orgId, principalName: "Ada", title: "Budget", currency: "USD", limitMinor: 20000 });
    const blockId = newId("bl");
    await db.insert(schema.blocks).values({ id: blockId, rootId, orgId, depth: 0, hash: `h_${blockId}`, holder: principal, holderLabel: "ada", caps: {} as never, raw: {} as never });
    const spendId = newId("sp");
    await db.insert(schema.spends).values({
      id: spendId, rootId, orgId, leafId: blockId, leafLabel: "ada", chainIds: [blockId], requestHash: `rh_${spendId}`,
      signed: { request: { releaseBy: null } } as never, amountMinor: 100, currency: "USD", payee: "translator@example.com", purpose: "translation",
      status: "DENIED", captureId: `CAP_${spendId}`,
    });
    return { rootId, blockId, spendId };
  }

  async function seedAccount(owner: string, orgId: string | null) {
    const db = getDb();
    const agent = newId("ag");
    const account = newId("acct").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    await db.insert(schema.accounts).values({ agent, account, orgId, label: "earner", owner, ownerName: "Owner", settleTo: "earner@example.com", signed: {} as never, mode: "hold", balanceMinor: 500 });
    await db.insert(schema.ledger).values({ agent, orgId, kind: "income", ref: newId("ref"), deltaMinor: 500, balanceAfterMinor: 500 });
    const cardId = newId("cd");
    await db.insert(schema.cards).values({ id: cardId, orgId, number: newId("num"), holder: agent, label: "card", merchantAgent: newId("mer"), perChargeMinor: 100, maxCharges: 1, everySeconds: 0, notAfter: new Date(Date.now() + 3600_000), signed: {} as never });
    const transferId = newId("tr");
    await db.insert(schema.transfers).values({ id: transferId, orgId, fromAgent: agent, kind: "withdraw", payee: "bank", amountMinor: 100, currency: "USD", requestHash: newId("rh"), signed: {} as never, status: "BOOKED" });
    return { agent, cardId, transferId };
  }

  it("carries the organization in one transaction and leaves nothing on the connection", async () => {
    await reset();
    const a = await makeOrg("A");
    const b = await makeOrg("B");

    const insideA = setting(await withTenant(a, (tx) => tx.execute(sql`select current_setting(${TENANT_SETTING}, true) as org`)));
    const insideB = setting(await withTenant(b, (tx) => tx.execute(sql`select current_setting(${TENANT_SETTING}, true) as org`)));
    expect(insideA).toBe(a);
    expect(insideB).toBe(b);

    // The setting was transaction-local: the pooled connection carries no organization once it is handed back.
    expect(setting(await getDb().execute(sql`select current_setting(${TENANT_SETTING}, true) as org`)) ?? "").toBe("");
    await expect(withTenant("", async () => null)).rejects.toThrow(/needs an organization/);
  });

  it("shows a scoped caller its own records, and not another organization's or an unattributed one", async () => {
    await reset();
    const [orgA, orgB] = [await makeOrg("A"), await makeOrg("B")];
    const a = await seedEnvelope("A".repeat(43), orgA);
    const b = await seedEnvelope("B".repeat(43), orgB);
    const none = await seedEnvelope("C".repeat(43), null);
    const acctA = await seedAccount("D".repeat(43), orgA);
    const acctB = await seedAccount("E".repeat(43), orgB);

    const scopeA = scopeFor(orgA);
    expect((await G.tree(a.rootId, scopeA))?.root.id).toBe(a.rootId);
    expect(await G.tree(b.rootId, scopeA)).toBeNull();
    expect(await G.tree(none.rootId, scopeA)).toBeNull();
    // Without a session it reads as it did before: that gap is named in the route matrix, not hidden here.
    expect((await G.tree(b.rootId))?.root.id).toBe(b.rootId);

    expect((await B.cardById(acctA.cardId, scopeA))?.id).toBe(acctA.cardId);
    expect(await B.cardById(acctB.cardId, scopeA)).toBeNull();
    expect((await B.allCards(60, scopeA)).map((c) => c.id)).toEqual([acctA.cardId]);
    expect(await B.transferById(acctB.transferId, scopeA)).toBeNull();

    const books = await B.position(scopeA);
    expect(books.accounts.map((x) => x.agent)).toEqual([acctA.agent]);
    expect(books.checks.every((c) => c.ok)).toBe(true);

    expect(await S.paypalTrail(b.rootId, scopeA)).toBeNull();
    expect((await S.paypalTrail(a.rootId, scopeA))?.summary).toBeTruthy();
  });

  it("answers another organization's addressed reads as 404, before the provider is asked", async () => {
    await reset();
    const [orgA, orgB] = [await makeOrg("A"), await makeOrg("B")];
    const a = await seedEnvelope("A".repeat(43), orgA);
    const b = await seedEnvelope("B".repeat(43), orgB);
    const acctB = await seedAccount("E".repeat(43), orgB);
    const scopeA = scopeFor(orgA);

    const envA = await handlers["GET /api/envelopes/:id"]!({ params: { id: a.rootId }, body: undefined, scope: scopeA });
    expect(envA.status ?? 200).toBe(200);
    const envB = await handlers["GET /api/envelopes/:id"]!({ params: { id: b.rootId }, body: undefined, scope: scopeA });
    expect(envB.status).toBe(404);

    expect((await handlers["GET /api/spends/:id/status"]!({ params: { id: b.spendId }, body: undefined, scope: scopeA })).status).toBe(404);
    // Through `run`, as the HTTP layer calls it: a thrown 404 becomes the response, not an exception.
    expect((await run(handlers["GET /api/spends/:id/evidence"]!, { params: { id: b.spendId }, body: undefined, scope: scopeA })).status).toBe(404);
    expect((await handlers["GET /api/envelopes/:id/paypal"]!({ params: { id: b.rootId }, body: undefined, scope: scopeA })).status).toBe(404);
    expect((await handlers["GET /api/cards/:id"]!({ params: { id: acctB.cardId }, body: undefined, scope: scopeA })).status).toBe(404);
    expect((await handlers["GET /api/bank/transfers/:id"]!({ params: { id: acctB.transferId }, body: undefined, scope: scopeA })).status).toBe(404);

    expect(await status(() => G.reconcile(b.spendId, scopeA))).toBe(404);
    expect(await status(() => K.evidence(b.spendId, scopeA))).toBe(404);
    // The same reads, for the organization that owns the rows, still answer.
    expect((await handlers["GET /api/spends/:id/status"]!({ params: { id: a.spendId }, body: undefined, scope: scopeFor(orgA) })).status ?? 200).toBe(200);
  });

  it("files a sealed envelope under the signed-in organization, and refuses to move a mapped key", async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await reset();
    const [orgA, orgB] = [await makeOrg("A"), await makeOrg("B")];
    const caps: Parameters<typeof E.seal>[2] = { currency: "USD", limit: 20000, perPayment: 8000, payees: ["translator@example.com"], purposes: ["translation"], notAfter: new Date(Date.now() + 3600_000).toISOString(), splits: 0 };

    const ada = await E.generateKeyPair();
    const ops = await E.generateKeyPair();
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, caps);
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget", orgId: orgA });
    expect(root.orgId).toBe(orgA);
    const block = await getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, root.id) });
    expect(block?.orgId).toBe(orgA);

    // A key already mapped to another organization cannot be sealed into this one, even by a signed-in member.
    const bea = await E.generateKeyPair();
    await getDb().insert(schema.principals).values({ id: newId("prn"), orgId: orgB, publicKey: bea.publicKey, label: "Bea's key" });
    const other = await E.seal(bea, { publicKey: (await E.generateKeyPair()).publicKey, label: "bea-agent" }, caps);
    expect(await status(() => G.registerRoot({ chain: other, principalName: "Bea", title: "Elsewhere", orgId: orgA }))).toBe(403);
  });

  it("opens an account into the caller's organization, and refuses a mapped owner elsewhere", async () => {
    await reset();
    const [orgA, orgB] = [await makeOrg("A"), await makeOrg("B")];
    const agent = await E.generateKeyPair();
    const owner = await E.generateKeyPair();
    const account = await G.openAccount(await E.signAccount(agent, owner, { label: "earner", ownerName: "Ada", settleTo: "ada@example.com", mode: "hold" }), orgA);
    expect(account.orgId).toBe(orgA);

    await getDb().insert(schema.principals).values({ id: newId("prn"), orgId: orgB, publicKey: owner.publicKey, label: "Ada's key" });
    const second = await E.generateKeyPair();
    const secondAccount = await E.signAccount(second, owner, { label: "second", ownerName: "Ada", settleTo: "ada@example.com" });
    expect(await status(() => G.openAccount(secondAccount, orgA))).toBe(403);
  });

  it("takes the organization from the session row, never from a header or a body field", async () => {
    await reset();
    const a = await createTestIdentity({ role: "finance" });
    const b = await createTestIdentity({ role: "owner" });
    const cookie = (token: string) => new Request("https://app.test/api/bank", { headers: { cookie: `authjs.session-token=${token}` } });

    expect((await C.requestScope(cookie(a.sessionToken)))?.orgId).toBe(a.orgId);
    expect((await C.requestScope(cookie(b.sessionToken)))?.orgId).toBe(b.orgId);
    expect((await C.requestScope(cookie(a.sessionToken)))?.role).toBe("finance");
    expect(await C.requestScope(new Request("https://app.test/api/bank"))).toBeNull();
    // An organization named in a header is not authorization and is not read.
    expect((await C.requestScope(new Request("https://app.test/api/bank", { headers: { cookie: `authjs.session-token=${a.sessionToken}`, "x-org-id": b.orgId } })))?.orgId).toBe(a.orgId);
    expect(await status(() => C.requestScope(cookie("not-a-session")))).toBe(401);

    await getDb().update(schema.memberships).set({ status: "REVOKED", revokedAt: new Date() }).where(eq(schema.memberships.id, a.membershipId));
    expect(await status(() => C.requestScope(cookie(a.sessionToken)))).toBe(403);
  });

  it("offers development sign-in only where it cannot be a production path", async () => {
    expect(devSessionAllowed({ NODE_ENV: "production", DATABASE_URL: "postgres://x" })).toBe(false);
    expect(devSessionAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(devSessionAllowed({ NODE_ENV: "development", DATABASE_URL: "postgres://x" })).toBe(true);
  });

  it("creates a real, revocable session for the development sign-in", async () => {
    await reset();
    const s = await openDevelopmentSession();
    const req = () => new Request("https://app.test/api/bank", { headers: { cookie: `authjs.session-token=${s.sessionToken}` } });
    const scope = await C.requestScope(req());
    expect(scope?.orgId).toBe(s.orgId);
    expect(scope?.role).toBe("owner");
    expect(s.orgName).toBe("Development organization");

    // Signing in twice reuses the organization and the user; it does not scatter the demo across tenants.
    const again = await openDevelopmentSession();
    expect(again.orgId).toBe(s.orgId);
    expect(again.userId).toBe(s.userId);

    await closeDevelopmentSession(s.sessionToken);
    expect(await status(() => C.requestScope(req()))).toBe(401);
  });

  it("has one visibility rule, and no organization means nobody's", () => {
    const scope = scopeFor("org_a");
    expect(visibleTo(scope, "org_a")).toBe(true);
    expect(visibleTo(scope, "org_b")).toBe(false);
    expect(visibleTo(scope, null)).toBe(false);
    expect(visibleTo(null, "org_b")).toBe(true);
  });
});
