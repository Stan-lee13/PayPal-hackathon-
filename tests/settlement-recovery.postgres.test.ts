/**
 * Settlement recovery under real concurrency.
 *
 * These are the races Stage Zero 1.2 identified: a payout that came back, and a refund the provider refused
 * earlier, are decided by whichever arrival owns the settlement lease. Two (or more) arrivals must not each
 * send a refund, each post a return, or each write a success line.
 *
 * Gated on `REAL_DATABASE_URL` like the other concurrency suite, and for the same reason: a single serialized
 * connection cannot show whether the lease holds. A run without it skips loudly rather than passing.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const database = useTestEnv();
const enabled = Boolean(database && process.env.REAL_DATABASE_URL);
const d = enabled ? describe : describe.skip;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("settlement recovery concurrency (real server, multiple connections)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const E = await import("../lib/envelope/core");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting } = await import("../lib/rails/registry");

  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const PAYEE = "designer@example.com";

  beforeAll(async () => {
    const db = getDb();
    const versions = (await db.execute(sql`select version() as v`)) as unknown as Array<{ v: string }>;
    if (/pglite/i.test(String(versions[0]?.v ?? ""))) throw new Error("These tests need a real Postgres server, not PGlite.");
    const pids = new Set<number>();
    const rows = await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_backend_pid() as pid`).catch(() => [])));
    for (const r of rows as unknown as Array<Array<{ pid: number | string }>>) pids.add(Number(r[0]?.pid));
    if (pids.size < 2) throw new Error(`The pool handed every query the same backend (pids: ${[...pids].join(", ")}).`);
    if (Number(process.env.DB_POOL_MAX ?? 5) < 2) throw new Error("DB_POOL_MAX is 1: a single connection cannot establish locking behaviour.");
  });

  beforeEach(async () => {
    process.env.SETTLEMENT_LEASE_MS = "5000";
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    G.forgetProviderAccountIdentity();
    await getDb().execute(sql`truncate table position_attributions, position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_events restart identity cascade`);
  });

  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((s) => s!);
  const positions = async () => (await getDb().select().from(schema.positionEntries)).sort((a, b) => a.id - b.id);
  const auditCount = async (action: string) =>
    ((await getDb().execute(sql`select count(*)::int as n from audit_log where action = ${action}`)) as unknown as Array<{ n: number }>)[0]!.n;

  /** Seal an envelope and pay once, so the payment has a payout batch the simulator can change its mind about. */
  async function paidOnce() {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, {
      currency: "USD", limit: 20000, perPayment: 20000, payees: [PAYEE], purposes: ["design"], notAfter: EXP, splits: 0,
    });
    await G.registerRoot({ chain, principalName: "Ada", title: "Budget" });
    const signed = await E.signSpend(chain, ops, { amount: 1000, payee: PAYEE, purpose: "design" });
    const s = (await G.spend(signed)).spend!;
    expect(s.status).toBe("PAID");
    return s;
  }

  it("three concurrent readers of a payout that came back refund once and post one return", async () => {
    const s = await paidOnce();
    rail.setPayoutStatus(s.payoutBatchId!, "FAILED");
    const results = await Promise.all([G.syncSpend(s.id), G.syncSpend(s.id), G.syncSpend(s.id)]);
    // Every arrival reports the same final state, and only one of them moved it there.
    expect(results.map((r) => r.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(rail.refundCount(s.id)).toBe(1);
    const kinds = (await positions()).map((p) => p.kind).sort();
    expect(kinds).toEqual(["capture", "payout", "payout_return", "refund"]);
    expect(await auditCount("payout.failed")).toBe(1);
    const row = await spendRow(s.id);
    expect(row.refundId).toBeTruthy();
  });

  it("a second arrival does not decide while the first holds the settlement lease", async () => {
    const s = await paidOnce();
    rail.setPayoutStatus(s.payoutBatchId!, "FAILED");
    let held = false;
    const holder = G.withSettlementLease(s.id, async () => {
      held = true;
      await sleep(600);
      return (await spendRow(s.id));
    });
    await sleep(60);
    expect(held).toBe(true);
    const meanwhile = await G.syncSpend(s.id);
    // The lease is held, so this arrival reports the current state and changes nothing.
    expect(meanwhile.status).toBe("PAID");
    expect(rail.refundCount(s.id)).toBe(0);
    expect((await positions()).map((p) => p.kind)).not.toContain("refund");
    await holder;
    // Once the lease is released, the usual path does the work exactly once.
    const after = await G.syncSpend(s.id);
    expect(after.status).toBe("FAILED");
    expect(rail.refundCount(s.id)).toBe(1);
  });
});
