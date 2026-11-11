/**
 * Accounts that receive, agent-to-agent payments and promises (money set aside), against the
 * built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("accounts and promises (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const codes = (v: Array<{ code: string }>) => v.map((x) => x.code).sort();
  const blockRow = (id: string) => getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, id) }).then((b) => b!);
  const spendRow = (id: string) => getDb().query.spends.findFirst({ where: eq(schema.spends.id, id) }).then((b) => b!);

  /** Ada → ops-agent ($200) → localization-agent ($60, only to Bea's translator-agent). */
  async function world() {
    const [ada, ops, loc, bea, tr, rogue] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));
    const acct = await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com" }));
    const payee = E.accountPayee(tr!.publicKey);
    const base: E.Caps = { currency: "USD", limit: 20000, perPayment: 8000, payees: [payee, "designer@example.com"], purposes: ["translation", "design"], notAfter: EXP, splits: 2 };
    const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, base);
    const root = await G.registerRoot({ chain: rootChain, principalName: "Ada", title: "Launch budget" });
    const locChain = await E.split(rootChain, ops!, { publicKey: loc!.publicKey, label: "localization-agent" }, { ...base, limit: 6000, perPayment: 6000, payees: [payee], purposes: ["translation"], splits: 0 });
    return { ada: ada!, ops: ops!, loc: loc!, bea: bea!, tr: tr!, rogue: rogue!, acct, payee, rootChain, locChain, root };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts restart identity cascade`);
  });

  it("an account can only be opened with the agent's own signature, so income can't be hijacked", async () => {
    const w = await world();
    expect(w.acct).toMatchObject({ account: E.accountNumber(w.tr.publicKey), label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com" });
    // the rogue signs as "owner" and as "agent" for a key it doesn't control
    const forged = await E.signAccount(w.rogue, w.rogue, { label: "translator-agent", ownerName: "Mallory", settleTo: "mallory@evil.example" });
    forged.body.agent = w.tr.publicKey;
    await expect(G.openAccount(forged)).rejects.toThrow(/signed by both/);
    // a later, properly signed opening by the same agent updates where it is settled
    const moved = await G.openAccount(await E.signAccount(w.tr, w.bea, { label: "translator-agent", ownerName: "Bea", settleTo: "bea-new@example.com" }, new Date(Date.now() + 1000)));
    expect(moved.settleTo).toBe("bea-new@example.com");
    // an older signed opening can't be replayed to move it back
    const replay = await G.openAccount(w.acct.signed);
    expect(replay.settleTo).toBe("bea-new@example.com");
  });

  it("paying an agent's account settles to its owner's PayPal address and shows as income", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 4500, payee: w.payee, purpose: "translation" }));
    expect(r.status).toBe("PAID");
    expect(r.spend).toMatchObject({ payee: w.payee, payeeAgent: w.tr.publicKey, payoutTo: "bea@example.com" });
    expect(r.receipt!.paidTo).toEqual({ account: E.accountNumber(w.tr.publicKey), agent: w.tr.publicKey, agentLabel: "translator-agent", settledTo: "bea@example.com" });
    expect(await G.verifyReceipt(r.receipt!)).toBe(true);
    expect((await G.reconcile(r.spend!.id)).ok).toBe(true); // PayPal's payout went to the settlement address

    // moving the account afterwards does not redirect a payment already admitted
    await G.openAccount(await E.signAccount(w.tr, w.bea, { label: "translator-agent", ownerName: "Bea", settleTo: "elsewhere@example.com" }, new Date(Date.now() + 1000)));
    expect((await spendRow(r.spend!.id)).payoutTo).toBe("bea@example.com");

    const p = (await G.agentProfile(w.tr.publicKey))!; // an agent that holds no envelope still has a profile
    expect(p).toMatchObject({ label: "translator-agent", accounts: [], receives: { payee: w.payee, owner: { label: "Bea" }, settlesTo: "e•••@example.com" }, record: { received: 1, receivedMinor: 4500, payments: 0 } });
    expect(p.incoming).toHaveLength(1);
    expect(JSON.stringify(p)).not.toContain("elsewhere@example.com"); // the full address is never published
  });

  it("an account number nobody opened is refused, and so is one the envelope doesn't list", async () => {
    const w = await world();
    const ghost = E.accountPayee(w.rogue.publicKey);
    const any = await E.split(w.rootChain, w.ops, { publicKey: w.rogue.publicKey, label: "helper" }, { currency: "USD", limit: 3000, perPayment: 3000, payees: null, purposes: null, notAfter: EXP, splits: 0 }).catch((e: Error) => e);
    expect(String(any)).toMatch(/narrow/); // "any payee" would widen the root
    const r = await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 1000, payee: ghost, purpose: "translation" }));
    expect(r.status).toBe("DENIED");
    expect(codes(r.reasons)).toEqual(["PAYEE_ACCOUNT_UNKNOWN", "PAYEE_NOT_ALLOWED"]);
    expect((await sim.simCalls()).some((c) => c.includes("/capture"))).toBe(false);
  });

  it("a promise sets money aside at every level, gives the payee a signed note, and is then paid", async () => {
    const w = await world();
    const p = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 4500, payee: w.payee, purpose: "translation", ttl: 600 }), "setting it aside");
    expect(p.status).toBe("PROMISED");
    expect(p.note).toMatchObject({ amount: 4500, payee: w.payee, agentLabel: "localization-agent", paypal: { status: "CREATED", authorizationId: w.root.authorizationId } });
    expect(p.note!.sponsors.map((x) => x.label)).toEqual(["Ada", "ops-agent"]);
    expect(await G.verifyPromiseNote(p.note!)).toBe(true);
    expect(await G.verifyPromiseNote({ ...p.note!, amount: 9999 })).toBe(false);
    // reserved at the leaf and at every ancestor; no money has moved
    expect(await blockRow(w.locChain[1]!.body.id)).toMatchObject({ reservedMinor: 4500, spentMinor: 0 });
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 4500, spentMinor: 0 });
    expect((await sim.simCalls()).some((c) => c.includes("/capture") || c.includes("/payouts"))).toBe(false);
    // the money is spoken for: the same agent can't spend it elsewhere
    const other = await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 2000, payee: w.payee, purpose: "translation" }));
    expect(codes(other.reasons)).toEqual(["OVER_ENVELOPE_LIMIT"]);
    // a statement of standing sees it too
    const st = await G.standing(await E.signHello(w.locChain, w.loc, { amount: 2000, payee: w.payee, purpose: "translation" }));
    expect(st).toMatchObject({ good: false, availableMinor: 0 });
    expect((await G.agentProfile(w.tr.publicKey))!.record.setAsideForItMinor).toBe(4500);

    // only the agent that made the promise can pay it
    await expect(G.keep(await E.signKeep(w.rogue, p.spend!.id, "pay"))).rejects.toThrow(/Only the agent/);
    const paid = await G.keep(await E.signKeep(w.loc, p.spend!.id, "pay"), "delivered");
    expect(paid.status).toBe("PAID");
    expect(paid.spend).toMatchObject({ captureId: expect.stringMatching(/^SIMCAP/), payoutTo: "bea@example.com", agentNote: "delivered" });
    expect(await G.verifyReceipt(paid.receipt!)).toBe(true);
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0, spentMinor: 4500 });
    // paying twice pays once
    const again = await G.keep(await E.signKeep(w.loc, p.spend!.id, "pay"));
    expect(again).toMatchObject({ status: "PAID", duplicate: true });
    expect((await sim.simCalls()).filter((c) => c.includes("/capture"))).toHaveLength(1);
    expect((await G.agentProfile(w.loc.publicKey))!.record).toMatchObject({ promisesKept: 1, promisesLapsed: 0 });
  });

  it("a promise is not a payment and a payment is not a promise: the signatures don't cross over", async () => {
    const w = await world();
    const pr = await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation", ttl: 600 });
    const { ttl: _ttl, ...rest } = pr.request;
    const asSpend = await G.spend({ request: { ...rest, v: E.SPEND_VERSION }, sig: pr.sig, chain: pr.chain });
    expect(codes(asSpend.reasons)).toContain("NOT_THE_HOLDER");
    const sp = await E.signSpend(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation" });
    const asPromise = await G.promise({ request: { ...sp.request, v: E.PROMISE_VERSION, ttl: 600 }, sig: sp.sig, chain: sp.chain });
    expect(codes(asPromise.reasons)).toContain("NOT_THE_HOLDER");
    // a promise obeys the same caps as a payment, and its lifetime is bounded
    const tooLong = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation", ttl: 999999 }));
    expect(codes(tooLong.reasons)).toContain("MALFORMED");
    const wrongPayee = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: "attacker@evil.example", purpose: "translation" }));
    expect(codes(wrongPayee.reasons)).toEqual(["PAYEE_NOT_ALLOWED"]);
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0 });
  });

  it("a promise that runs out, is released, or is revoked gives the money back at every level", async () => {
    const w = await world();
    const make = () => E.signPromise(w.locChain, w.loc, { amount: 2000, payee: w.payee, purpose: "translation", ttl: 600 }).then((s) => G.promise(s));
    // 1. runs out
    const a = await make();
    await getDb().update(schema.spends).set({ promiseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.spends.id, a.spend!.id));
    expect(await G.verifyPromiseNote({ ...a.note!, expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(false);
    const late = await G.keep(await E.signKeep(w.loc, a.spend!.id, "pay"));
    expect(late.status).toBe("LAPSED");
    expect(codes(late.reasons)).toEqual(["PROMISE_LAPSED"]);
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0, spentMinor: 0 });
    // 2. released by its maker
    const b = await make();
    expect((await G.keep(await E.signKeep(w.loc, b.spend!.id, "release"))).status).toBe("LAPSED");
    expect(await blockRow(w.locChain[1]!.body.id)).toMatchObject({ reservedMinor: 0 });
    // 3. the owner revokes the agent: its promises die with it
    const c = await make();
    await G.revoke(await E.signRevoke(w.ada, w.locChain[1]!.body.id));
    expect((await spendRow(c.spend!.id)).status).toBe("LAPSED");
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0 });
    const dead = await G.keep(await E.signKeep(w.loc, c.spend!.id, "pay"));
    expect(dead.status).toBe("LAPSED");
    expect((await sim.simCalls()).some((x) => x.includes("/capture"))).toBe(false);
    expect((await G.agentProfile(w.loc.publicKey))!.record).toMatchObject({ promisesKept: 0, promisesLapsed: 3 });
  });

  it("a promise can name a key whose signed acceptance pays it, and the receipt carries the work's fingerprint", async () => {
    const w = await world();
    const checker = await E.generateKeyPair();
    const work = await E.sha256("fr.json + yo.json, as delivered");
    // "paid on verified work": the promise names a third agent that checks the delivery
    const p = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 4500, payee: w.payee, purpose: "translation", ttl: 600, releaseBy: checker.publicKey }));
    expect(p.status).toBe("PROMISED");
    expect(p.note!.releaseBy).toBe(checker.publicKey);
    expect(await G.verifyPromiseNote(p.note!)).toBe(true);
    // nobody else can release it: not the payee, not an outsider, not an edited statement
    await expect(G.accept(await E.signAccept(w.tr, p.spend!.id, { work }))).rejects.toThrow(/names a different key/);
    await expect(G.accept(await E.signAccept(w.rogue, p.spend!.id, { work }))).rejects.toThrow(/names a different key/);
    const real = await E.signAccept(checker, p.spend!.id, { work, note: "Both files checked against the brief." });
    await expect(G.accept({ ...real, request: { ...real.request, promise: "pr_other" } })).rejects.toThrow(/properly signed/);
    expect((await sim.simCalls()).some((c) => c.includes("/capture"))).toBe(false);
    // the named key signs: PayPal captures and pays, with no further word from the payer
    const paid = await G.accept(real);
    expect(paid.status).toBe("PAID");
    expect(paid.receipt!.releasedBy).toEqual({ key: checker.publicKey, work, note: "Both files checked against the brief.", at: real.request.at });
    expect(paid.receipt!.paidTo!.settledTo).toBe("bea@example.com");
    expect(await G.verifyReceipt(paid.receipt!)).toBe(true);
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 0, spentMinor: 4500 });
    // accepting twice pays once
    expect(await G.accept(await E.signAccept(checker, p.spend!.id, { work }))).toMatchObject({ status: "PAID", duplicate: true });
    expect((await sim.simCalls()).filter((c) => c.includes("/capture"))).toHaveLength(1);

    // a promise that names no key can only be paid by its maker
    const plain = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation", ttl: 600 }));
    await expect(G.accept(await E.signAccept(w.tr, plain.spend!.id))).rejects.toThrow(/only be paid by the agent that made it/);
    // "paid on delivery": naming the payee itself; but the owner's revocation still wins
    await G.keep(await E.signKeep(w.loc, plain.spend!.id, "release"));
    const cod = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation", ttl: 600, releaseBy: w.tr.publicKey }));
    await G.revoke(await E.signRevoke(w.ada, w.locChain[1]!.body.id));
    const late = await G.accept(await E.signAccept(w.tr, cod.spend!.id, { work }));
    expect(late.status).toBe("LAPSED");
    expect((await sim.simCalls()).filter((c) => c.includes("/capture"))).toHaveLength(1);
  });

  it("closing the envelope releases open promises and voids the whole hold", async () => {
    const w = await world();
    const p = await G.promise(await E.signPromise(w.locChain, w.loc, { amount: 3000, payee: w.payee, purpose: "translation", ttl: 600 }));
    const closed = await G.revoke(await E.signRevoke(w.ada, w.root.id));
    expect(closed.root).toMatchObject({ status: "CLOSED", releasedMinor: 20000, capturedMinor: 0 });
    expect((await spendRow(p.spend!.id)).status).toBe("LAPSED");
    expect((await sim.simAuthorization(w.root.authorizationId!))!.status).toBe("VOIDED");
  });

  it("twenty promises race for a $60 envelope: exactly $60 is set aside", async () => {
    const w = await world();
    const all = await Promise.all(Array.from({ length: 20 }, () => E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.payee, purpose: "translation", ttl: 600 }).then((s) => G.promise(s))));
    expect(all.filter((x) => x.status === "PROMISED")).toHaveLength(6);
    expect(await blockRow(w.locChain[1]!.body.id)).toMatchObject({ reservedMinor: 6000 });
    expect(await blockRow(w.root.id)).toMatchObject({ reservedMinor: 6000 });
  });
});
