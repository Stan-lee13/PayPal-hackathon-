/**
 * The gateway against the built-in PayPal simulator: seal → hold, split, spend → capture + payout,
 * budgets at every level, replay, revocation, forged chains, concurrency, close → void.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("gateway (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, asc, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  const { verifyChain: verifyAudit } = await import("../lib/ledger/chain");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const caps = (over: Partial<E.Caps> = {}): E.Caps => ({ currency: "USD", limit: 20000, perPayment: 8000, payees: ["translator@example.com", "designer@example.com"], purposes: ["translation", "design"], notAfter: EXP, splits: 2, ...over });
  const codes = (v: E.Violation[]) => v.map((x) => x.code).sort();

  async function world() {
    const [ada, ops, loc, art, rogue] = await Promise.all([1, 2, 3, 4, 5].map(() => E.generateKeyPair()));
    const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, caps());
    const root = await G.registerRoot({ chain: rootChain, principalName: "Ada", title: "Launch budget" });
    const locChain = await E.split(rootChain, ops!, { publicKey: loc!.publicKey, label: "localization-agent" }, caps({ limit: 6000, perPayment: 5000, payees: ["translator@example.com"], purposes: ["translation"], splits: 0 }));
    const artChain = await E.split(rootChain, ops!, { publicKey: art!.publicKey, label: "creative-agent" }, caps({ limit: 9000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], splits: 0 }));
    return { ada: ada!, ops: ops!, loc: loc!, art: art!, rogue: rogue!, rootChain, locChain, artChain, root };
  }
  const blockRow = (id: string) => getDb().query.blocks.findFirst({ where: eq(schema.blocks.id, id) }).then((b) => b!);

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("sealing places a PayPal hold for the whole limit", async () => {
    const w = await world();
    expect(w.root.authorizationId).toMatch(/^SIMAUTH/);
    const auth = await sim.simAuthorization(w.root.authorizationId!);
    expect(auth).toMatchObject({ status: "CREATED", amount: { value: "200.00" }, custom_id: w.root.id });
    // a second registration of the same root doesn't place a second hold
    await G.registerRoot({ chain: w.rootChain, principalName: "Ada", title: "again" });
    expect((await sim.simCalls()).filter((c) => c === "POST /v2/checkout/orders")).toHaveLength(1);
  });

  it("a sub-agent's spend is captured from the hold, paid out, debited at every level, and receipted", async () => {
    const w = await world();
    const r = await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 4500, payee: "translator@example.com", purpose: "translation", memo: "FR + YO strings" }), "Translator delivered both files.");
    expect(r.status).toBe("PAID");
    expect(r.spend).toMatchObject({ captureId: expect.stringMatching(/^SIMCAP/), payoutBatchId: expect.stringMatching(/^SIMBATCH/), agentNote: "Translator delivered both files." });
    expect((await blockRow(w.locChain[1]!.body.id)).spentMinor).toBe(4500);
    expect((await blockRow(w.root.id)).spentMinor).toBe(4500); // the ancestor is debited too
    expect((await sim.simAuthorization(w.root.authorizationId!))!.status).toBe("PARTIALLY_CAPTURED");

    const rec = r.receipt!;
    expect(await G.verifyReceipt(rec)).toBe(true);
    expect(rec.chain.map((c) => c.holderLabel)).toEqual(["ops-agent", "localization-agent"]);
    expect(rec.principal).toBe(w.ada.publicKey);
    expect(rec.paypal).toMatchObject({ authorizationId: w.root.authorizationId, captureId: r.spend!.captureId, payoutBatchId: r.spend!.payoutBatchId });
    expect(await G.verifyReceipt({ ...rec, request: { ...rec.request, amount: 1 } })).toBe(false); // receipts can't be edited

    const rc = await G.reconcile(r.spend!.id);
    expect(rc.ok).toBe(true);
    expect(rc.checks).toHaveLength(7); // the seventh: PayPal holds no dispute against the capture
  });

  it("a child can never spend more than any ancestor has left, however the limits were handed out", async () => {
    const [ada, ops, a, b] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
    const any = { payees: null, purposes: null };
    const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops" }, caps({ limit: 10000, perPayment: 10000, ...any }));
    await G.registerRoot({ chain: rootChain, principalName: "Ada", title: "t" });
    // the parent hands out 8000 + 8000 from an envelope of 10000: allowed, but the total can't exceed 10000
    const ca = await E.split(rootChain, ops!, { publicKey: a!.publicKey, label: "a" }, caps({ limit: 8000, perPayment: 8000, ...any, splits: 0 }));
    const cb = await E.split(rootChain, ops!, { publicKey: b!.publicKey, label: "b" }, caps({ limit: 8000, perPayment: 8000, ...any, splits: 0 }));
    expect((await G.spend(await E.signSpend(ca, a!, { amount: 7000, payee: "x@example.com", purpose: "p" }))).status).toBe("PAID");
    const over = await G.spend(await E.signSpend(cb, b!, { amount: 4000, payee: "x@example.com", purpose: "p" }));
    expect(over.status).toBe("DENIED");
    expect(codes(over.reasons)).toEqual(["OVER_ANCESTOR_LIMIT"]);
    expect((await G.spend(await E.signSpend(cb, b!, { amount: 3000, payee: "x@example.com", purpose: "p" }))).status).toBe("PAID");
    const mine = await G.spend(await E.signSpend(ca, a!, { amount: 1001, payee: "x@example.com", purpose: "p" }));
    expect(codes(mine.reasons)).toEqual(["OVER_ANCESTOR_LIMIT", "OVER_ENVELOPE_LIMIT"]);
  });

  it("the same signed request is never executed twice", async () => {
    const w = await world();
    const signed = await E.signSpend(w.locChain, w.loc, { amount: 2000, payee: "translator@example.com", purpose: "translation" });
    const first = await G.spend(signed);
    const again = await G.spend(signed);
    expect(again).toMatchObject({ status: "PAID", duplicate: true });
    expect(again.spend!.id).toBe(first.spend!.id);
    const calls = await sim.simCalls();
    expect(calls.filter((c) => c.endsWith("/capture"))).toHaveLength(1);
    expect(calls.filter((c) => c === "POST /v1/payments/payouts")).toHaveLength(1);
    expect((await blockRow(w.root.id)).spentMinor).toBe(2000);
  });

  it("twenty agents racing for the same envelope cannot overspend it", async () => {
    const w = await world();
    const reqs = await Promise.all(Array.from({ length: 20 }, () => E.signSpend(w.locChain, w.loc, { amount: 1000, payee: "translator@example.com", purpose: "translation" })));
    const results = await Promise.all(reqs.map((r) => G.spend(r)));
    expect(results.filter((r) => r.status === "PAID")).toHaveLength(6); // limit 6000
    expect(results.filter((r) => r.status === "DENIED").every((r) => codes(r.reasons).includes("OVER_ENVELOPE_LIMIT"))).toBe(true);
    const row = await blockRow(w.locChain[1]!.body.id);
    expect([row.spentMinor, row.reservedMinor]).toEqual([6000, 0]);
    expect((await sim.simCalls()).filter((c) => c.endsWith("/capture"))).toHaveLength(6);
  });

  it("a compromised agent is contained: wrong payee, too much, a forged wider envelope, a stolen copy", async () => {
    const w = await world();
    const attack = async (s: E.SignedSpend) => { const r = await G.spend(s); expect(r.status).toBe("DENIED"); return codes(r.reasons); };
    expect(await attack(await E.signSpend(w.artChain, w.art, { amount: 5000, payee: "attacker@evil.example", purpose: "design" }))).toEqual(["PAYEE_NOT_ALLOWED"]);
    expect(await attack(await E.signSpend(w.artChain, w.art, { amount: 8500, payee: "designer@example.com", purpose: "design" }))).toEqual(["OVER_PER_PAYMENT"]);
    // it mints itself a bigger envelope
    const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: w.root.id, parent: await E.blockHash(w.artChain[1]!), issuer: w.art.publicKey, holder: w.rogue.publicKey, holderLabel: "helper", caps: E.normalizeCaps(caps({ limit: 50000, perPayment: 50000, payees: null, purposes: null, splits: 0 })), issuedAt: new Date().toISOString() };
    const forged: E.Envelope = [...w.artChain, { body, sig: await E.signDetached(w.art.privateKey, E.BLOCK_VERSION, body) }];
    expect(await attack(await E.signSpend(forged, w.rogue, { amount: 20000, payee: "attacker@evil.example", purpose: "anything" }))).toEqual(expect.arrayContaining(["WIDENED_LIMIT", "WIDENED_PAYEES", "SPLIT_NOT_ALLOWED"]));
    // someone who copied the envelope but doesn't have the agent's key
    const stolen = await E.signSpend(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" });
    expect(await attack({ ...stolen, sig: await E.signDetached(w.rogue.privateKey, E.SPEND_VERSION, stolen.request) })).toEqual(["NOT_THE_HOLDER"]);
    // nothing moved
    expect((await sim.simCalls()).filter((c) => c.endsWith("/capture"))).toHaveLength(0);
    expect((await getDb().select().from(schema.spends)).every((s) => s.status === "DENIED")).toBe(true);
  });

  it("revoking an envelope kills it and everything split from it, but not its siblings", async () => {
    const w = await world();
    await G.announce(w.artChain);
    await expect(G.revoke(await E.signRevoke(w.rogue, w.artChain[1]!.body.id))).rejects.toThrow(/Only the owner/);
    await expect(G.revoke(await E.signRevoke(w.loc, w.artChain[1]!.body.id))).rejects.toThrow(/Only the owner/); // a sibling can't
    await G.revoke(await E.signRevoke(w.ada, w.artChain[1]!.body.id));
    const dead = await G.spend(await E.signSpend(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" }));
    expect(codes(dead.reasons)).toEqual(["REVOKED"]);
    expect((await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 1000, payee: "translator@example.com", purpose: "translation" }))).status).toBe("PAID");
    // a parent holder may revoke what it handed out
    await G.announce(w.locChain);
    await G.revoke(await E.signRevoke(w.ops, w.locChain[1]!.body.id));
    expect(codes((await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 100, payee: "translator@example.com", purpose: "translation" }))).reasons)).toEqual(["REVOKED"]);
  });

  it("closing the root releases the rest of the hold at PayPal: the owner pays only for what was spent", async () => {
    const w = await world();
    await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 4500, payee: "translator@example.com", purpose: "translation" }));
    const { root } = await G.revoke(await E.signRevoke(w.ada, w.root.id));
    expect(root).toMatchObject({ status: "CLOSED", capturedMinor: 4500, releasedMinor: 15500 });
    expect((await sim.simAuthorization(w.root.authorizationId!))!.status).toBe("VOIDED");
    expect(codes((await G.spend(await E.signSpend(w.locChain, w.loc, { amount: 100, payee: "translator@example.com", purpose: "translation" }))).reasons)).toContain("REVOKED");

    const trail = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, w.root.id)).orderBy(asc(schema.auditLog.seq));
    expect(trail.map((t) => t.action)).toEqual(["envelope.sealed", "hold.placed", "spend.requested", "hold.captured", "payout.sent", "envelope.closed", "hold.released", "spend.denied"]);
    expect(verifyAudit(w.ada.publicKey, w.root.id, trail.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) as never).ok).toBe(true);
  });

  it("an envelope the gateway never sealed can't spend, and a payout to an unregistered payee is reported as unclaimed", async () => {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const ghost = await E.seal(ada, { publicKey: ops.publicKey, label: "ops" }, caps());
    expect(codes((await G.spend(await E.signSpend(ghost, ops, { amount: 100, payee: "translator@example.com", purpose: "translation" }))).reasons)).toEqual(["UNKNOWN_ROOT"]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops" }, caps({ payees: ["nobody-unclaimed@example.com"] }));
    await G.registerRoot({ chain, principalName: "Ada", title: "t" });
    expect((await G.spend(await E.signSpend(chain, ops, { amount: 100, payee: "nobody-unclaimed@example.com", purpose: "design" }))).status).toBe("UNCLAIMED");
  });
  it("standing: a counterparty gets a signed answer to 'is this agent good for the money?'", async () => {
    const w = await world();
    await G.announce(w.locChain);
    const hello = await E.signHello(w.locChain, w.loc, { amount: 4500, payee: "translator@example.com", purpose: "translation" });
    const s = await G.standing(hello);
    expect(s).toMatchObject({ good: true, agentLabel: "localization-agent", account: E.accountNumber(w.loc.publicKey), availableMinor: 5000, ask: { amount: 4500, payee: "translator@example.com" }, paypal: { status: "CREATED", unusedMinor: 20000 } });
    expect(s.sponsors.map((x) => `${x.role}:${x.label}`)).toEqual(["owner:Ada", "agent:ops-agent"]);
    expect(await G.verifyStanding(s)).toBe(true);
    expect(await G.verifyStanding({ ...s, availableMinor: 999999 })).toBe(false); // tampered
    expect(await G.verifyStanding(s, new Date(Date.now() + G.STANDING_TTL_MS + 1000))).toBe(false); // expired
    // asking moves nothing and reserves nothing
    expect((await blockRow(w.locChain[1]!.body.id))).toMatchObject({ spentMinor: 0, reservedMinor: 0 });
    expect((await sim.simCalls()).some((c) => c.includes("/capture") || c.includes("/payouts"))).toBe(false);

    // an introduction can never be replayed as a payment: different signature domain
    const asSpend = await G.spend({ request: { ...hello.request, v: E.SPEND_VERSION, memo: "" } as E.SpendRequest, sig: hello.sig, chain: hello.chain });
    expect(asSpend.status).toBe("DENIED");
    expect(codes(asSpend.reasons)).toContain("NOT_THE_HOLDER");
  });

  it("standing is refused for a wrong payee, a spent budget, an impostor and a revoked agent", async () => {
    const w = await world();
    const ask = (chain: E.Envelope, key: E.KeyPair, p: { amount: number; payee: string; purpose: string }) => E.signHello(chain, key, p).then(G.standing);
    const wrongPayee = await ask(w.artChain, w.art, { amount: 2000, payee: "attacker@evil.example", purpose: "design" });
    expect(wrongPayee).toMatchObject({ good: false, availableMinor: 0 });
    expect(wrongPayee.reasons.map((x) => x.code)).toEqual(["PAYEE_NOT_ALLOWED"]);

    await G.spend(await E.signSpend(w.artChain, w.art, { amount: 7000, payee: "designer@example.com", purpose: "design" }));
    const after = await ask(w.artChain, w.art, { amount: 1500, payee: "designer@example.com", purpose: "design" });
    expect(after).toMatchObject({ good: true, availableMinor: 2000, paypal: { status: "PARTIALLY_CAPTURED", unusedMinor: 13000 } });
    // PayPal recommends capturing within three days of the authorization: the statement says when that ends, and when the authorization itself does
    expect(Date.parse(after.paypal.authorizedUntil!) - Date.parse(after.paypal.honoredUntil!)).toBe(26 * 86400_000);
    expect(Date.parse(after.paypal.honoredUntil!) - Date.now()).toBeGreaterThan(2.9 * 86400_000);
    expect(await G.verifyStanding(after)).toBe(true);
    expect((await ask(w.artChain, w.art, { amount: 2500, payee: "designer@example.com", purpose: "design" })).reasons.map((x) => x.code)).toEqual(["OVER_ENVELOPE_LIMIT"]);

    // someone who copied the envelope but lacks the key
    expect((await ask(w.artChain, w.rogue, { amount: 1000, payee: "designer@example.com", purpose: "design" })).reasons.map((x) => x.code)).toContain("NOT_THE_HOLDER");

    await G.revoke(await E.signRevoke(w.ada, w.artChain[1]!.body.id));
    const revoked = await ask(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" });
    expect(revoked.good).toBe(false);
    expect(revoked.reasons.map((x) => x.code)).toContain("REVOKED");
  });

  it("agent profile: who stands behind it, what it holds, and its record", async () => {
    const w = await world();
    await G.spend(await E.signSpend(w.artChain, w.art, { amount: 7000, payee: "designer@example.com", purpose: "design" }));
    await G.spend(await E.signSpend(w.artChain, w.art, { amount: 2000, payee: "attacker@evil.example", purpose: "design" }));
    const p = (await G.agentProfile(w.art.publicKey))!;
    expect(p).toMatchObject({ label: "creative-agent", account: E.accountNumber(w.art.publicKey), record: { payments: 1, paidMinor: 7000, refused: 1, refusedCodes: ["PAYEE_NOT_ALLOWED"], availableMinor: 2000 } });
    expect(p.accounts[0]).toMatchObject({ state: "LIVE", availableMinor: 2000, openedBy: { role: "agent", label: "ops-agent" } });
    expect(p.accounts[0]!.sponsors.map((x) => x.label)).toEqual(["Ada", "ops-agent"]);
    expect(p.statement).toHaveLength(2);
    const ops = (await G.agentProfile(w.ops.publicKey))!;
    expect(ops.accounts[0]!.issued.map((x) => x.label)).toEqual(["creative-agent"]); // only splits the gateway has seen
    expect(await G.agentProfile(w.rogue.publicKey)).toBeNull();
    expect(E.accountNumber(w.art.publicKey)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});
