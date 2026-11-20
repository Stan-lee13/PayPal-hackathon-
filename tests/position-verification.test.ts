/**
 * Unverified provider positions.
 *
 * A movement recorded while the provider's account identity was unavailable is not the same thing as a
 * movement proven to sit in the account a payout would leave from. These tests reproduce the sequence that
 * used to launder one into the other:
 *
 *   1. capture while the provider account identity is unavailable;
 *   2. the provider identity becomes available and the account registry is updated;
 *   3. the historical movement stays unverified, exactly as it was recorded;
 *   4. a payout is refused while it depends on that movement;
 *   5. the movement is attributed to a specific provider record, and only then does it fund a payout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("unverified provider positions", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const A = await import("../lib/accounting");

  const movements = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);

  beforeEach(async () => {
    await getDb().execute(sql`truncate table position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });

  it("does not let a later balance read turn a historical movement into spendable liquidity", async () => {
    // 1. The capture arrives while the provider's account identity is unavailable.
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 900, ref: "sp_historical" });
    const [historical] = await movements();
    expect(historical!.externalAccountId).toBeNull();

    // 2. The provider identity becomes available; the account registry is completed.
    const filled = await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    expect(filled.externalAccountId).toBe("MOCK-ACCOUNT");

    // 3. History still says what was known when it was recorded.
    expect((await movements())[0]!.externalAccountId).toBeNull();
    // ... and it is reported as unverified, not silently folded into the position.
    const p = await A.positionOf("ada", "mock", "USD");
    expect(p.unverifiedMinor).toBe(900);
    expect((await A.unverifiedMovements({ rail: "mock", currency: "USD" })).map((m) => m.id)).toEqual([historical!.id]);

    // 4. A payout may not be funded by it.
    await expect(A.requireProviderLiquidity({ rail: "mock", currency: "USD", amountMinor: 100, what: "A payout", owner: "ada" }))
      .rejects.toThrow(/without the provider's account identity/);
    const l = await A.liquidityAt({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 100 });
    expect(l.ok).toBe(false);
    expect(l.availableMinor).toBe(0);
    expect(l.detail).toMatch(/unverified/);
  });

  it("attributes one specific movement to a provider record, and only that one becomes spendable", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 400, ref: "sp_one" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 600, ref: "sp_two" });
    // Neither movement names the account: both are historical.
    expect(await A.liquidityAt({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 1 })).toMatchObject({ ok: false, availableMinor: 0 });

    const entries = await movements();
    const proof = { rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT", source: "provider statement 2026-11-18", evidence: "TXN-ONE", attributedBy: "ops@example.com" };
    const first = await A.attributePositionMovement({ ...proof, positionEntryId: entries[0]!.id });
    expect(first.alreadyVerified).toBe(false);

    // Exactly one movement is now proven; the other is untouched and still unverified.
    expect((await A.unverifiedMovements({ rail: "mock", currency: "USD" })).map((m) => m.ref)).toEqual(["sp_two"]);
    expect(await A.liquidityAt({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 400 })).toMatchObject({ ok: true, availableMinor: 400 });
    expect(await A.liquidityAt({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 401 })).toMatchObject({ ok: false });
    // The original movement is preserved: the proof is a separate row.
    expect((await movements()).find((m) => m.id === entries[0]!.id)!.externalAccountId).toBeNull();

    // Repeating the same proof is idempotent: one attribution row.
    const again = await A.attributePositionMovement({ ...proof, positionEntryId: entries[0]!.id });
    expect(again.alreadyVerified).toBe(true);
    const rows = await getDb().select().from(schema.positionAttributions);
    expect(rows).toHaveLength(1);
  });

  it("refuses an ambiguous selector and an attribution that contradicts the account on record", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 100, ref: "sp_both" });
    await A.postPayout({ owner: "ada", rail: "mock", currency: "USD", amountMinor: 100, ref: "sp_both" });
    const base = { rail: "mock", currency: "USD", externalAccountId: "MOCK-ACCOUNT", source: "statement", evidence: "TXN" };
    // The reference identifies two movements (a capture and a payout); which one is meant is unknown.
    await expect(A.attributePositionMovement({ ...base, ref: "sp_both" })).rejects.toThrow(/2 movements match/);
    // A proof that names a different account than the one the provider reported is refused.
    await expect(A.attributePositionMovement({ ...base, externalAccountId: "SOMEONE-ELSE", positionEntryId: (await movements())[0]!.id }))
      .rejects.toThrow(/has not established/);
    expect(await getDb().select().from(schema.positionAttributions)).toHaveLength(0);
  });

  it("never rewrites a movement that already names another provider account", async () => {
    await A.ensureRailAccount({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-ONE" });
    await A.postCapture({ owner: "ada", rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-ONE", amountMinor: 500, ref: "sp_verified" });
    const [row] = await movements();
    await expect(A.attributePositionMovement({
      rail: "mock", currency: "USD", externalAccountId: "ACCOUNT-TWO", source: "statement", evidence: "TXN", positionEntryId: row!.id,
    })).rejects.toThrow(/History is not rewritten/);
    expect((await movements())[0]!.externalAccountId).toBe("ACCOUNT-ONE");
    void eq;
  });
});
