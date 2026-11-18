/**
 * Race acceptance tests against a REAL Postgres server with several connections.
 *
 * Everything else in this repository runs against one serialized connection, which cannot show whether the
 * locks hold when two payments really overlap. These tests are therefore gated twice:
 *
 *   • `REAL_DATABASE_URL` must be set (the CI workflow sets it; a local run must opt in), and
 *   • a preflight asserts the server is a real Postgres with more than one backend and that the pool is not
 *     one connection. If any of that is untrue the suite FAILS rather than skipped-passing, because a
 *     single-connection run proves nothing about locking.
 *
 * They are deliberately not part of the default suite: `vitest.config.ts` includes every `*.test.ts`, so this
 * file skips itself (loudly, in its name) unless opted in. `npm run test:concurrency` runs it.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const database = useTestEnv();
const optedIn = Boolean(process.env.REAL_DATABASE_URL);
const enabled = Boolean(database && optedIn);
const d = enabled ? describe : describe.skip;

d("Postgres concurrency acceptance (real server, multiple connections)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const E = await import("../lib/envelope/core");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting, forgetRails } = await import("../lib/rails/registry");

  type Mock = ReturnType<typeof mockRail>;
  let rail: Mock;
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const PAYEE = "designer@example.com";

  beforeAll(async () => {
    const db = getDb();
    const versions = (await db.execute(sql`select version() as v`)) as unknown as Array<{ v: string }>;
    const version = String(versions[0]?.v ?? "");
    if (/pglite/i.test(version)) throw new Error(`These tests need a real Postgres server, not PGlite (got: ${version}).`);
    // Four queries at once must land on four different backends: that is what "multiple connections" means.
    const pids = new Set<number>();
    const rows = await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_backend_pid() as pid`).catch(() => [])));
    for (const r of rows as unknown as Array<Array<{ pid: number | string }>>) pids.add(Number(r[0]?.pid));
    if (pids.size < 2) throw new Error(`The pool handed every query the same backend (pids: ${[...pids].join(", ")}): concurrency is not being exercised.`);
    if (Number(process.env.DB_POOL_MAX ?? 5) < 2) throw new Error("DB_POOL_MAX is 1: a single connection cannot establish locking behaviour. Set DB_POOL_MAX=8.");
  });

  beforeEach(async () => {
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  const rootRow = (id: string) => getDb().query.roots.findFirst({ where: eq(schema.roots.id, id) }).then((r) => r!);
  const ledgerSum = async (agent: string) =>
    ((await getDb().execute(sql`select coalesce(sum(delta_minor), 0)::int as total from ledger where agent = ${agent}`)) as unknown as Array<{ total: number }>)[0]!.total;
  const balanceOf = (agent: string) => getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, agent) }).then((a) => a!.balanceMinor);

  /** Owner → ops. `children` gives each child its own envelope under the same root. */
  async function world(opts: { limit?: number; perPayment?: number; children?: number; childLimit?: number; payees?: string[] } = {}) {
    const [owner, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const kids = await Promise.all(Array.from({ length: opts.children ?? 0 }, () => E.generateKeyPair()));
    const base = { currency: "USD", limit: opts.limit ?? 20000, perPayment: opts.perPayment ?? 20000, payees: [PAYEE, ...(opts.payees ?? [])], purposes: ["design", "supplies", "translation"], notAfter: EXP, splits: (opts.children ?? 0) + 1 };
    const chain = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, base);
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const chains = await Promise.all(kids.map((k) => E.split(chain, ops, { publicKey: k.publicKey, label: "child" }, { ...base, limit: opts.childLimit ?? 6000, perPayment: opts.childLimit ?? 6000, splits: 0 })));
    return { owner, ops, kids, chain, chains, root, ask: (amount: number, payee = PAYEE) => E.signSpend(chain, ops, { amount, payee, purpose: "design" }) };
  }

  it("two agents spending the same ancestor budget at once: one pays, the other is refused, and the budget is debited once", async () => {
    const w = await world({ limit: 10000, children: 2, childLimit: 6000 });
    const [a, b] = await Promise.all(w.chains.map((c, i) => E.signSpend(c, w.kids[i]!, { amount: 6000, payee: PAYEE, purpose: "design" })));
    const results = await Promise.all([G.spend(a!), G.spend(b!)]);
    const paid = results.filter((r) => r.status === "PAID");
    const refused = results.filter((r) => r.status === "DENIED");
    expect(paid).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reasons.map((x) => x.code)).toContain("OVER_ANCESTOR_LIMIT");
    const root = await rootRow(w.root.id);
    expect(root.capturedMinor).toBe(6000);
    const blocks = await getDb().select().from(schema.blocks).where(eq(schema.blocks.rootId, w.root.id));
    expect(blocks.find((x) => x.depth === 0)).toMatchObject({ spentMinor: 6000, reservedMinor: 0 });
    expect(blocks.filter((x) => x.depth === 1).reduce((n, x) => n + x.spentMinor, 0)).toBe(6000);
    // one capture and one payout at the rail, for the one payment that was allowed
    expect(rail.captureCount()).toBe(1);
    expect(rail.payoutCount()).toBe(1);
  });

  it("the same signed request eight times at once is one payment, one capture and one payout", async () => {
    const w = await world();
    const signed = await w.ask(2500);
    const results = await Promise.all(Array.from({ length: 8 }, () => G.spend(signed)));
    expect(new Set(results.map((r) => r.spend!.id)).size).toBe(1);
    expect(results.every((r) => r.status === "PAID")).toBe(true);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const id = results[0]!.spend!.id;
    expect(rail.captureCount(id)).toBe(1);
    expect(rail.payoutCount(id)).toBe(1);
    expect(await getDb().select().from(schema.spends)).toHaveLength(1);
    expect(await rootRow(w.root.id)).toMatchObject({ capturedMinor: 2500 });
  });

  it("several transfers against one balance at once never overdraw it", async () => {
    // Fund the account with a payment it keeps.
    const [bea, tr] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const w = await world({ payees: [E.accountPayee(tr.publicKey)] });
    await G.openAccount(await E.signAccount(tr, bea, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    const paid = await G.spend(await w.ask(10000, E.accountPayee(tr.publicKey)));
    expect(paid.status).toBe("PAID");
    expect(await balanceOf(tr.publicKey)).toBe(10000);

    const outgoing = await Promise.all(Array.from({ length: 5 }, (_, i) => E.signTransfer(tr, { amount: 4000, payee: `payee${i}@example.com`, purpose: "translation" })));
    const results = await Promise.all(outgoing.map((s) => B.transfer(s)));
    const ok = results.filter((r) => r.status === "PAID");
    const refused = results.filter((r) => r.status === "DENIED");
    expect(ok).toHaveLength(2);
    expect(refused).toHaveLength(3);
    expect(refused.every((r) => r.reasons.some((x) => x.code === "INSUFFICIENT_BALANCE"))).toBe(true);
    expect(await balanceOf(tr.publicKey)).toBe(2000);
    expect(await ledgerSum(tr.publicKey)).toBe(2000);
    // a hold account keeps its money at the provider until it leaves: only the two allowed transfers paid out
    expect(rail.payoutCount()).toBe(2);
  });

  it("a freeze racing a payment leaves the books and the balance consistent either way", async () => {
    const [bea, tr] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const w = await world({ payees: [E.accountPayee(tr.publicKey)] });
    await G.openAccount(await E.signAccount(tr, bea, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    expect((await G.spend(await w.ask(5000, E.accountPayee(tr.publicKey)))).status).toBe("PAID");

    const signed = await E.signTransfer(tr, { amount: 3000, payee: "supplier@example.com", purpose: "supplies" });
    const [moved, frozen] = await Promise.all([B.transfer(signed), B.freeze(await E.signFreeze(bea, tr.publicKey, true))]);
    expect(frozen.frozenAt).toBeTruthy();
    // Whichever got the lock first, the result is coherent: either the money left before the freeze, or it did not.
    expect(["PAID", "DENIED"]).toContain(moved.status);
    const balance = await balanceOf(tr.publicKey);
    expect(balance).toBe(moved.status === "PAID" ? 2000 : 5000);
    expect(await ledgerSum(tr.publicKey)).toBe(balance);
    expect(rail.payoutCount()).toBe(moved.status === "PAID" ? 1 : 0);
    // And nothing can leave afterwards.
    const after = await B.transfer(await E.signTransfer(tr, { amount: 100, payee: "supplier@example.com", purpose: "supplies" }));
    expect(after.status).toBe("DENIED");
    expect(after.reasons.map((x) => x.code)).toContain("ACCOUNT_FROZEN");
  });

  it("five card charges at once on a card that allows two: exactly two are taken", async () => {
    const [bea, tr, lx, lo] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
    const w = await world({ payees: [E.accountPayee(tr!.publicKey)] });
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "buyer", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    await G.openAccount(await E.signAccount(lx!, lo!, { label: "Lexica", ownerName: "Lexica Ltd", settleTo: "billing@lexica.example" }));
    expect((await G.spend(await w.ask(5000, E.accountPayee(tr!.publicKey)))).status).toBe("PAID");
    const card = await B.issueCard(await E.signCard(tr!, { merchant: E.accountPayee(lx!.publicKey), label: "Lexica Pro", perCharge: 500, maxCharges: 2, every: 0, life: 3600 }));
    const signed = await Promise.all(Array.from({ length: 5 }, () => E.signCharge(lx!, { card: card.id, amount: 500, memo: "burst" })));
    const results = await Promise.all(signed.map((s) => B.charge(s)));
    expect(results.filter((r) => r.status === "PAID")).toHaveLength(2);
    const cardAfter = await getDb().query.cards.findFirst({ where: eq(schema.cards.id, card.id) });
    expect(cardAfter).toMatchObject({ charges: 2, chargedMinor: 1000 });
    expect(await balanceOf(tr!.publicKey)).toBe(4000);
    expect(await ledgerSum(tr!.publicKey)).toBe(4000);
  });

  it("the same provider event eight times at once is applied once and changes nothing twice", async () => {
    const w = await world();
    const paid = await G.spend(await w.ask(1200));
    expect(paid.status).toBe("PAID");
    const events = await rail.events.list();
    const ev = events.find((e) => e.type.startsWith("PAYMENT.CAPTURE"))!;
    const S = await import("../lib/gateway/settlement");
    const body = { id: ev.id, event_type: ev.type, resource: ev.resource };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => S.applyPayPalEvent(body, "feed")));
    expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1);
    expect(outcomes.filter((o) => o.duplicate)).toHaveLength(7);
    expect(await getDb().select().from(schema.paypalEvents)).toHaveLength(1);
    // The payment is exactly where it was: one capture, one payout, one ledger effect.
    expect(rail.captureCount(paid.spend!.id)).toBe(1);
    expect(rail.payoutCount(paid.spend!.id)).toBe(1);
    expect(await rootRow(w.root.id)).toMatchObject({ capturedMinor: 1200 });
  });

  it("a payment interrupted at the provider finishes once when several arrivals retry it together", async () => {
    const w = await world();
    const signed = await w.ask(1800);
    rail.failNext("hold.capture", 1); // the first arrival's capture is in doubt
    const first = await G.spend(signed);
    expect(first.status).toBe("RESERVED");
    const id = first.spend!.id;
    rail.failNext("", 0);
    const results = await Promise.all(Array.from({ length: 6 }, () => G.settle(id)));
    expect(results.every((r) => r.status === "PAID")).toBe(true);
    expect(results.every((r) => r.receipt)).toBeTruthy();
    expect(rail.captureCount(id)).toBe(1);
    expect(rail.payoutCount(id)).toBe(1);
    expect(await rootRow(w.root.id)).toMatchObject({ capturedMinor: 1800 });
    const blocks = await getDb().select().from(schema.blocks).where(eq(schema.blocks.rootId, w.root.id));
    expect(blocks.find((x) => x.depth === 0)).toMatchObject({ reservedMinor: 0, spentMinor: 1800 });
  });

  it("accepting and releasing one promise at the same time does exactly one of them", async () => {
    const w = await world({ perPayment: 5000 });
    const [checker] = await Promise.all([E.generateKeyPair()]);
    const promise = await G.promise(await E.signPromise(w.chain, w.ops, { amount: 3000, payee: PAYEE, purpose: "design", ttl: 600, releaseBy: checker.publicKey }));
    expect(promise.status).toBe("PROMISED");
    const id = promise.spend!.id;
    const accept = await E.signAccept(checker, id, { work: await E.sha256("final files") });
    const release = await E.signKeep(w.ops, id, "release");
    const [a, r] = await Promise.all([G.accept(accept), G.keep(release)]);
    const root = await rootRow(w.root.id);
    const blocks = await getDb().select().from(schema.blocks).where(eq(schema.blocks.rootId, w.root.id));
    const top = blocks.find((x) => x.depth === 0)!;
    expect(top.reservedMinor).toBe(0);
    // Either the acceptance paid it, or the release gave the budget back — never both.
    const paid = a.status === "PAID" || r.status === "PAID";
    if (paid) {
      expect([a.status, r.status]).toContain("PAID");
      expect(root.capturedMinor).toBe(3000);
      expect(top.spentMinor).toBe(3000);
      expect(rail.captureCount(id)).toBe(1);
      expect(rail.payoutCount(id)).toBe(1);
    } else {
      expect(root.capturedMinor).toBe(0);
      expect(top.spentMinor).toBe(0);
      expect(rail.captureCount(id)).toBe(0);
    }
    expect(await getDb().select().from(schema.spends)).toHaveLength(1);
  });
});

if (!enabled) {
  // Named, so a reader of the log cannot mistake this for a run.
  describe.skip("Postgres concurrency acceptance — SKIPPED (set REAL_DATABASE_URL and DB_POOL_MAX>=2)", () => {
    it("is not being exercised in this run", () => undefined);
  });
}
