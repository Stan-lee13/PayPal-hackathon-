/**
 * Provider-account attribution.
 *
 * The one-provider-account rule is only worth anything if the account has an identity the provider itself
 * gave us, and if that identity is attached to the money movements. These tests hold the implementation to
 * four claims:
 *
 *   1. a capture learns the account id from the provider and records it, on the account row and on the movement;
 *   2. reading the same account again is idempotent;
 *   3. an account cannot change identity underneath recorded positions — that is refused, not overwritten;
 *   4. a position that never named its account cannot fund a payout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("provider-account attribution", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const A = await import("../lib/accounting");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const accounts = () => getDb().select().from(schema.railAccounts);
  const movements = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);

  beforeEach(async () => {
    const rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    G.forgetProviderAccountIdentity();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });

  async function payOnce(amountMinor = 1000) {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, {
      currency: "USD", limit: 5000, perPayment: 5000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0,
    });
    await G.registerRoot({ chain, principalName: "Ada", title: "Budget" });
    const signed = await E.signSpend(chain, ops, { amount: amountMinor, payee: "designer@example.com", purpose: "design" });
    const spend = (await G.spend(signed)).spend!;
    return { spend, rootId: spend.rootId, ada };
  }

  it("learns the account identity from the provider, and records it on the account and on the movement", async () => {
    const { rootId } = await payOnce(1000);
    const root = (await getDb().query.roots.findFirst({ where: eq(schema.roots.id, rootId) }))!;
    const rows = await accounts();
    expect(rows).toHaveLength(1);
    // "MOCK-ACCOUNT" is what this rail reports for its balance; nothing about the owner, the label or the payment.
    expect(rows[0]).toMatchObject({ owner: root.principal, rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    const capture = (await movements()).find((m) => m.kind === "capture")!;
    expect(capture.externalAccountId).toBe("MOCK-ACCOUNT");
    expect(capture.owner).toBe(root.principal);
  });

  it("registers the same identity twice without creating a second account", async () => {
    const a = await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    const b = await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    expect(b.id).toBe(a.id);
    expect(await accounts()).toHaveLength(1);
    expect((await accounts())[0]!.externalAccountId).toBe("MOCK-ACCOUNT");
  });

  it("refuses an account that changes identity, and never rewrites the positions recorded under the first one", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-ONE" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-ONE", amountMinor: 500, ref: "spend-one" });
    await expect(A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-TWO" }))
      .rejects.toThrow(/cannot migrate between provider accounts/);
    // Nothing was written against the second account, and the recorded movement still says where the money is.
    expect((await accounts()).map((r) => r.externalAccountId)).toEqual(["ACCOUNT-ONE"]);
    expect((await movements())[0]!.externalAccountId).toBe("ACCOUNT-ONE");
  });

  it("refuses to pay out from a position that never named its provider account", async () => {
    // A row from before identities were recorded (or written by hand): the money is tracked, the account is not.
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 900, ref: "spend-unverified" });
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout" }))
      .rejects.toThrow(/without the provider's account identity/);
    // No money moved, and the unverified row is left exactly as it was: distinguishable from a verified one.
    expect((await accounts())[0]!.externalAccountId).toBeNull();
    expect((await movements()).map((m) => m.kind)).toEqual(["capture"]);
  });

  it("completes a null identity once the provider reports it, without marking older rows as verified", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 900, ref: "spend-historical" });
    const before = (await movements())[0]!;
    expect(before.externalAccountId).toBeNull();
    const filled = await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    expect(filled.externalAccountId).toBe("MOCK-ACCOUNT");
    // The movement recorded before the identity was known still says so; history is not rewritten.
    expect((await movements()).find((m) => m.id === before.id)!.externalAccountId).toBeNull();
  });
});
