/**
 * Milestone 4.2 — organization columns on financial records.
 *
 * What is proved here:
 *   • a row is attributed only from the explicit `principals` mapping or its parent chain, and an unmapped or
 *     revoked principal leaves it unattributed (no default organization, no consolidation, nothing created);
 *   • the composite foreign keys refuse a block, payment, balance, card or transfer filed under an organization
 *     that is not its parent's;
 *   • attribution is idempotent and never rewrites a row that already has an organization;
 *   • a sealed envelope, its payments and its audit chain carry the organization of the sealing principal;
 *   • nothing financial changes: amounts, sequence numbers and audit hashes are the same before and after.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("tenant attribution (organization columns on financial rows)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const { attributeTenantRows } = await import("../lib/identity/tenant-attribution");
  const { resetSimMemory } = await import("../lib/sim/store");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const caps = (over: Partial<E.Caps> = {}): E.Caps => ({
    currency: "USD", limit: 20000, perPayment: 8000, payees: ["translator@example.com"], purposes: ["translation"], notAfter: EXP, splits: 0, ...over,
  });

  let seq = 0;
  const next = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

  async function makeOrg(name: string): Promise<string> {
    const id = next("org");
    await getDb().insert(schema.organizations).values({ id, name });
    return id;
  }

  async function mapPrincipal(orgId: string, publicKey: string, status: "ACTIVE" | "REVOKED" = "ACTIVE"): Promise<void> {
    await getDb().insert(schema.principals).values({ id: next("prn"), orgId, publicKey, label: "test principal", status });
  }

  /** A root envelope row, its root block, a payment and an audit entry — all unattributed when inserted. */
  async function seedEnvelope(principal: string) {
    const db = getDb();
    const rootId = next("rt");
    await db.insert(schema.roots).values({ id: rootId, principal, principalName: "Ada", title: "Budget", currency: "USD", limitMinor: 20000 });
    const blockId = next("bl");
    await db.insert(schema.blocks).values({
      id: blockId, rootId, depth: 0, hash: `h_${blockId}`, holder: principal, holderLabel: "ada", caps: {} as never, raw: {} as never,
    });
    const spendId = next("sp");
    await db.insert(schema.spends).values({
      id: spendId, rootId, leafId: blockId, leafLabel: "ada", chainIds: [blockId], requestHash: `rh_${spendId}`,
      signed: {} as never, amountMinor: 100, currency: "USD", payee: "translator@example.com", purpose: "translation", status: "PAID",
    });
    await db.insert(schema.auditLog).values({
      scopeId: principal, subjectId: rootId, actor: "principal", action: "envelope.sealed", outcome: "OK", detail: {}, seq: 1, prevHash: `g_${rootId}`, hash: `h_${rootId}`,
    });
    return { rootId, blockId, spendId };
  }

  /** An agent account with a balance, a card and a transfer out of it. */
  async function seedAccount(owner: string) {
    const db = getDb();
    const agent = next("ag");
    await db.insert(schema.accounts).values({
      agent, account: next("acct").toUpperCase(), label: "earner", owner, ownerName: "Owner", settleTo: "earner@example.com", signed: {} as never, mode: "hold",
    });
    await db.insert(schema.ledger).values({ agent, kind: "income", ref: next("ref"), deltaMinor: 500, balanceAfterMinor: 500 });
    const cardId = next("cd");
    await db.insert(schema.cards).values({
      id: cardId, number: next("num"), holder: agent, label: "card", merchantAgent: next("mer"), perChargeMinor: 100, maxCharges: 1, everySeconds: 0,
      notAfter: new Date(Date.now() + 3600_000), signed: {} as never,
    });
    const transferId = next("tr");
    await db.insert(schema.transfers).values({
      id: transferId, fromAgent: agent, kind: "pay", payee: "someone@example.com", amountMinor: 100, currency: "USD",
      requestHash: `rh_${transferId}`, signed: {} as never, status: "BOOKED",
    });
    return { agent, cardId, transferId };
  }

  const orgOf = async (table: "roots" | "blocks" | "spends" | "accounts" | "ledger" | "cards" | "transfers" | "auditLog", where: ReturnType<typeof eq>) =>
    (await (getDb().select({ orgId: schema[table].orgId }).from(schema[table] as never).where(where as never).limit(1)) as Array<{ orgId: string | null }>)[0]?.orgId ?? null;

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table organizations, principals, memberships, users, sessions, organization_invitations, gateway_key_trust, auth_accounts, verification_tokens, position_entries, position_attributions, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("attributes an envelope, its rows and an account from the explicit mapping, and leaves an unmapped one alone", async () => {
    const db = getDb();
    const mapped = await makeOrg("Mapped Co");
    const ada = await E.generateKeyPair();
    const bob = await E.generateKeyPair();
    await mapPrincipal(mapped, ada.publicKey);
    await mapPrincipal(mapped, bob.publicKey, "REVOKED");

    const mine = await seedEnvelope(ada.publicKey);
    const revoked = await seedEnvelope(bob.publicKey);
    const stranger = await seedEnvelope((await E.generateKeyPair()).publicKey);
    const account = await seedAccount(ada.publicKey);
    const unmappedAccount = await seedAccount((await E.generateKeyPair()).publicKey);

    const orgsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations);
    const counts = await attributeTenantRows(db);
    expect(counts.some((n) => n > 0)).toBe(true);

    // The mapped envelope, its block, its payment and its audit entry all carry the organization.
    expect(await orgOf("roots", eq(schema.roots.id, mine.rootId))).toBe(mapped);
    expect(await orgOf("blocks", eq(schema.blocks.id, mine.blockId))).toBe(mapped);
    expect(await orgOf("spends", eq(schema.spends.id, mine.spendId))).toBe(mapped);
    expect(await orgOf("accounts", eq(schema.accounts.agent, account.agent))).toBe(mapped);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog).where(eq(schema.auditLog.orgId, mapped)))[0]!.n).toBe(1);

    // A revoked mapping and an unmapped key attribute nothing: no default organization is invented.
    expect(await orgOf("roots", eq(schema.roots.id, revoked.rootId))).toBeNull();
    expect(await orgOf("roots", eq(schema.roots.id, stranger.rootId))).toBeNull();
    expect(await orgOf("accounts", eq(schema.accounts.agent, unmappedAccount.agent))).toBeNull();
    // ... and no organization or principal was created by attributing.
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations))[0]!.n).toBe(orgsBefore[0]!.n);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.principals))[0]!.n).toBe(2);
  });

  it("files balances, cards and transfers under their account's organization", async () => {
    const db = getDb();
    const orgId = await makeOrg("Balance Co");
    const owner = await E.generateKeyPair();
    await mapPrincipal(orgId, owner.publicKey);
    const a = await seedAccount(owner.publicKey);

    await attributeTenantRows(db);

    expect(await orgOf("accounts", eq(schema.accounts.agent, a.agent))).toBe(orgId);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.ledger).where(eq(schema.ledger.orgId, orgId)))[0]!.n).toBe(1);
    expect(await orgOf("cards", eq(schema.cards.id, a.cardId))).toBe(orgId);
    expect(await orgOf("transfers", eq(schema.transfers.id, a.transferId))).toBe(orgId);
  });

  it("refuses a block, payment, balance or transfer filed under another organization's parent", async () => {
    const db = getDb();
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const owner = await E.generateKeyPair();
    const other = await E.generateKeyPair();
    await mapPrincipal(a, owner.publicKey);
    await mapPrincipal(b, other.publicKey);
    const mine = await seedEnvelope(owner.publicKey);
    const account = await seedAccount(owner.publicKey);
    await attributeTenantRows(db);

    await expect(db.insert(schema.blocks).values({
      id: next("bl"), rootId: mine.rootId, orgId: b, depth: 1, hash: "h", holder: "k", holderLabel: "x", caps: {} as never, raw: {} as never,
    })).rejects.toThrow();

    await expect(db.insert(schema.spends).values({
      id: next("sp"), rootId: mine.rootId, orgId: b, leafId: "l", leafLabel: "l", chainIds: [], requestHash: next("rh"),
      signed: {} as never, amountMinor: 1, currency: "USD", payee: "p@example.com", purpose: "p", status: "DENIED",
    })).rejects.toThrow();

    await expect(db.insert(schema.ledger).values({ agent: account.agent, orgId: b, kind: "income", ref: next("ref"), deltaMinor: 1, balanceAfterMinor: 1 })).rejects.toThrow();
    await expect(db.insert(schema.transfers).values({
      id: next("tr"), fromAgent: account.agent, orgId: b, kind: "pay", payee: "p@example.com", amountMinor: 1, currency: "USD",
      requestHash: next("rh"), signed: {} as never, status: "BOOKED",
    })).rejects.toThrow();

    // The same rows with the right organization are accepted.
    await db.insert(schema.ledger).values({ agent: account.agent, orgId: a, kind: "income", ref: next("ref"), deltaMinor: 1, balanceAfterMinor: 2 });
  });

  it("is idempotent and never moves a row that already has an organization", async () => {
    const db = getDb();
    const orgId = await makeOrg("Mapped Co");
    const ada = await E.generateKeyPair();
    await mapPrincipal(orgId, ada.publicKey);
    const mine = await seedEnvelope(ada.publicKey);

    await attributeTenantRows(db);
    // A later, different organization must not steal the row: attribution only fills NULLs.
    const other = await makeOrg("Other Co");
    expect(await attributeTenantRows(db)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await orgOf("roots", eq(schema.roots.id, mine.rootId))).toBe(orgId);
    expect(await orgOf("roots", eq(schema.roots.id, mine.rootId))).not.toBe(other);
  });

  it("leaves amounts, audit sequence numbers and audit hashes untouched", async () => {
    const db = getDb();
    const orgId = await makeOrg("Mapped Co");
    const ada = await E.generateKeyPair();
    await mapPrincipal(orgId, ada.publicKey);
    const mine = await seedEnvelope(ada.publicKey);

    const before = {
      spend: (await db.query.spends.findFirst({ where: eq(schema.spends.id, mine.spendId) }))!,
      root: (await db.query.roots.findFirst({ where: eq(schema.roots.id, mine.rootId) }))!,
      audit: (await db.select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, mine.rootId)))[0]!,
    };
    await attributeTenantRows(db);
    const after = {
      spend: (await db.query.spends.findFirst({ where: eq(schema.spends.id, mine.spendId) }))!,
      root: (await db.query.roots.findFirst({ where: eq(schema.roots.id, mine.rootId) }))!,
      audit: (await db.select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, mine.rootId)))[0]!,
    };
    expect({ ...after.spend, orgId: null }).toEqual({ ...before.spend, orgId: null });
    expect({ ...after.root, orgId: null }).toEqual({ ...before.root, orgId: null });
    expect({ ...after.audit, orgId: null }).toEqual({ ...before.audit, orgId: null });
    expect(after.spend.amountMinor).toBe(100);
    expect(after.audit.seq).toBe(1);
  });

  it("writes the organization when an envelope is sealed and a payment is made", async () => {
    const db = getDb();
    const orgId = await makeOrg("Sealing Co");
    const ada = await E.generateKeyPair();
    const ops = await E.generateKeyPair();
    await mapPrincipal(orgId, ada.publicKey);

    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, caps());
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    expect(root.orgId).toBe(orgId);
    expect((await db.query.blocks.findFirst({ where: eq(schema.blocks.id, root.id) }))!.orgId).toBe(orgId);

    const r = await G.spend(await E.signSpend(chain, ops, { amount: 1200, payee: "translator@example.com", purpose: "translation" }));
    expect(r.status).toBe("PAID");
    expect(r.spend!.orgId).toBe(orgId);

    const auditRows = await db.select({ orgId: schema.auditLog.orgId }).from(schema.auditLog).where(eq(schema.auditLog.subjectId, root.id));
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows.every((x) => x.orgId === orgId)).toBe(true);
  });

  it("writes no organization when the sealing principal is not mapped", async () => {
    const db = getDb();
    const ada = await E.generateKeyPair();
    const ops = await E.generateKeyPair();
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, caps());
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Unmapped budget" });
    expect(root.orgId).toBeNull();
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations))[0]!.n).toBe(0);
    // It is still a working envelope: attribution never gates money movement.
    const r = await G.spend(await E.signSpend(chain, ops, { amount: 100, payee: "translator@example.com", purpose: "translation" }));
    expect(r.status).toBe("PAID");
    expect(r.spend!.orgId).toBeNull();
  });
});
