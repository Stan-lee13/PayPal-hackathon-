/**
 * Findings from an independent review of the money code (11 November), each as a test.
 * Against the built-in PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("review findings (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const { handlers } = await import("../lib/api/handlers");
  const demo = await import("../lib/demo/agents");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const count = async (t: "spends" | "transfers" | "audit_log") => Number(((await getDb().execute(sql.raw(`select count(*)::int as n from ${t}`))) as unknown as Array<{ n: number }>)[0]!.n);
  const call = (key: string, body: unknown, params: Record<string, string> = {}) => handlers[key]!({ params, body });

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("the built-in agents act only for the owner who sealed the envelope", async () => {
    const [ada, eve] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    const draftId = "draft_abcdefgh12345678";
    const { opsPublicKey } = await demo.createDemoAgents(draftId);
    const chain = await E.seal(ada!, { publicKey: opsPublicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: null, purposes: null, notAfter: EXP, splits: 2 });
    const sealed = await call("POST /api/envelopes", { chain, principalName: "Ada", title: "Launch", draftId });
    expect((sealed.body as { demoAgents: boolean }).demoAgents).toBe(true);
    const rootId = chain[0]!.body.id;
    const pay = { rootId, agent: "ops-agent", tool: "pay", args: { amount_usd: 75, payee: "me@evil.example", purpose: "design" } };
    // anyone on the internet, with no proof of who they are
    expect((await call("POST /api/demo/tool", pay)).status).toBe(401);
    expect((await call("POST /api/demo/act", { rootId, action: "split-localization" })).status).toBe(401);
    // a stranger signing with their own key, or writing the owner's key next to their own signature
    expect((await call("POST /api/demo/tool", { ...pay, owner: await E.signRead(eve!, "demo", rootId) })).status).toBe(401);
    const posing = await E.signRead(eve!, "demo", rootId); posing.by = ada!.publicKey;
    expect((await call("POST /api/demo/tool", { ...pay, owner: posing })).status).toBe(401);
    // the owner's signature for another envelope, or for reading the treasury
    expect((await call("POST /api/demo/tool", { ...pay, owner: await E.signRead(ada!, "demo", "env_someoneelses") })).status).toBe(401);
    expect((await call("POST /api/demo/tool", { ...pay, owner: await E.signRead(ada!, "treasury", rootId) })).status).toBe(401);
    expect(await count("spends")).toBe(0);
    expect((await sim.simCalls()).some((c) => c.includes("/capture"))).toBe(false);
    // the owner
    const ok = await call("POST /api/demo/act", { rootId, action: "split-localization", owner: await E.signRead(ada!, "demo", rootId) });
    expect(ok.status ?? 200).toBe(200);
    // a second envelope cannot take over the first one's agents by naming its id as the draft
    const chain2 = await E.seal(eve!, { publicKey: opsPublicKey, label: "ops-agent" }, { currency: "USD", limit: 5000, perPayment: 5000, payees: null, purposes: null, notAfter: EXP, splits: 0 });
    await expect(call("POST /api/envelopes", { chain: chain2, principalName: "Eve", title: "Takeover", draftId: rootId })).rejects.toThrow();
  });

  it("an owner sees only their own envelopes, and only with their signature", async () => {
    const [ada, ops, eve] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: null, purposes: null, notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    expect(handlers["GET /api/envelopes"]).toBeUndefined();
    expect((await call("POST /api/envelopes/mine", {})).status).toBe(401);
    const eves = await call("POST /api/envelopes/mine", { signed: await E.signRead(eve!, "treasury", eve!.publicKey) });
    expect((eves.body as { roots: unknown[] }).roots).toHaveLength(0);
    const adas = await call("POST /api/envelopes/mine", { signed: await E.signRead(ada!, "treasury", ada!.publicKey) });
    expect((adas.body as { roots: unknown[] }).roots).toHaveLength(1);
  });

  it("requests nobody really signed leave no trace on someone else's envelope, account or card", async () => {
    const [ada, ops, bea, tr, lo, lx, rogue] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    await G.openAccount(await E.signAccount(lx!, lo!, { label: "Lexica", ownerName: "Lexica Ltd", settleTo: "pay@lexica.example", mode: "hold" }));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const card = await B.issueCard(await E.signCard(tr!, { merchant: E.accountPayee(lx!.publicKey), label: "Lexica", perCharge: 900, maxCharges: 2, life: 3600 }));
    const before = [await count("spends"), await count("transfers"), await count("audit_log")];
    // junk naming the victim's root and block
    const junk = { request: {}, sig: "x", chain: [{ body: { id: root.id } }, { body: { id: root.id, holderLabel: "ops-agent" } }] };
    expect((await G.spend(junk as never)).status).toBe("DENIED");
    // a real signature by the wrong key, on the victim's chain
    const forged = await E.signSpend(chain, rogue!, { amount: 100, payee: "designer@example.com", purpose: "design" });
    for (let i = 0; i < 5; i++) expect((await G.spend({ ...forged, request: { ...forged.request, nonce: `n_${i}` } })).status).toBe("DENIED");
    // a forged block that reuses the victim's block id with the attacker as holder
    const fake: E.Envelope = [{ body: { ...chain[0]!.body, holder: rogue!.publicKey }, sig: chain[0]!.sig }];
    expect((await G.spend(await E.signSpend(fake, rogue!, { amount: 100, payee: "designer@example.com", purpose: "design" }))).status).toBe("DENIED");
    // the same against a balance and a card
    const t = await E.signTransfer(rogue!, { amount: 100, payee: "x@example.com" }); t.request.from = tr!.publicKey;
    expect((await B.transfer(t)).status).toBe("DENIED");
    expect((await B.charge(await E.signCharge(rogue!, { card: card.id, amount: 100 }))).status).toBe("DENIED");
    expect([await count("spends"), await count("transfers"), await count("audit_log")]).toEqual(before);
    // the holder's own refused request is still recorded, because it is theirs
    const own = await G.spend(await E.signSpend(chain, ops!, { amount: 100, payee: "attacker@evil.example", purpose: "design" }));
    expect(own.status).toBe("DENIED");
    expect(await count("spends")).toBe(before[0]! + 1);
    // and so is a request under an envelope a real holder signed wider than its own: every signature is genuine, the rules are broken
    const helper = await E.generateKeyPair();
    const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: root.id, parent: await E.blockHash(chain[0]!), issuer: ops!.publicKey, holder: helper.publicKey, holderLabel: "helper", caps: E.normalizeCaps({ currency: "USD", limit: 100000, perPayment: 100000, payees: null, purposes: null, notAfter: EXP, splits: 0 }), issuedAt: new Date().toISOString() };
    const wider: E.Envelope = [...chain, { body, sig: await E.signDetached(ops!.privateKey, E.BLOCK_VERSION, body) }];
    expect((await G.spend(await E.signSpend(wider, helper, { amount: 20000, payee: "attacker@evil.example", purpose: "anything" }))).status).toBe("DENIED");
    expect(await count("spends")).toBe(before[0]! + 2);
    // the same wider block with a signature the holder never made is forgotten
    const unsigned: E.Envelope = [...chain, { body: { ...body, id: E.randomId("env") }, sig: await E.signDetached(rogue!.privateKey, E.BLOCK_VERSION, body) }];
    expect((await G.spend(await E.signSpend(unsigned, helper, { amount: 20000, payee: "attacker@evil.example", purpose: "anything" }))).status).toBe("DENIED");
    expect(await count("spends")).toBe(before[0]! + 2);
  });

  it("a refused withdrawal does not make room under the daily limit", async () => {
    const [ada, ops, bea, tr, cy, pf] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "refused@example.com", mode: "hold", perDay: 5000 }));
    await G.openAccount(await E.signAccount(pf!, cy!, { label: "proofreader-agent", ownerName: "Cy", settleTo: "cy@example.com", mode: "hold" }));
    const payee = E.accountPayee(tr!.publicKey), other = E.accountPayee(pf!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 30000, perPayment: 30000, payees: [payee], purposes: ["translation"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    await G.spend(await E.signSpend(chain, ops!, { amount: 20000, payee, purpose: "translation" }));
    expect((await B.transfer(await E.signTransfer(tr!, { amount: 5000, payee: other }))).status).toBe("BOOKED");
    // a withdrawal PayPal refuses comes back as a reversal
    const wd = await B.transfer(await E.signTransfer(tr!, { kind: "withdraw", amount: 5000 }));
    expect(wd.status).toBe("FAILED");
    // the day's $50 is still spent
    expect((await B.transfer(await E.signTransfer(tr!, { amount: 100, payee: other }))).reasons.map((x) => x.code)).toEqual(["OVER_DAILY_LIMIT"]);
  });

  it("a timestamp that is not a time is never fresh", async () => {
    const [ada, ops, bea, tr] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 8000, payees: null, purposes: null, notAfter: EXP, splits: 0 });
    const never = new Date("never");
    const far = new Date(Date.now() + 400 * 86_400_000);
    const spend = await E.signSpend(chain, ops!, { amount: 100, payee: "x@example.com", purpose: "design" }, never).catch(() => null);
    if (spend) expect((await E.verifySpend(spend, far)).violations.map((v) => v.code)).toContain("STALE_REQUEST");
    // built by hand, as an attacker with the key would
    const req = { ...(await E.signSpend(chain, ops!, { amount: 100, payee: "x@example.com", purpose: "design" })).request, at: "never" };
    const handSigned = { request: req, sig: await E.signDetached(ops!.privateKey, req.v, req), chain };
    expect((await E.verifySpend(handSigned as never, far)).violations.map((v) => v.code)).toContain("STALE_REQUEST");
    const tReq = { ...(await E.signTransfer(tr!, { amount: 100, payee: "x@example.com" })).request, at: "never" };
    expect((await E.verifyTransfer({ request: tReq, sig: await E.signDetached(tr!.privateKey, tReq.v, tReq) }, far)).map((v) => v.code)).toContain("STALE_REQUEST");
    const fReq = { ...(await E.signFreeze(bea!, tr!.publicKey, true)).request, at: "never" };
    expect(await E.verifyFreezeSignature({ request: fReq, sig: await E.signDetached(bea!.privateKey, fReq.v, fReq), by: bea!.publicKey }, far)).toBe(false);
  });

  it("a payment admitted but not yet captured is stopped if its envelope is revoked in between", async () => {
    const [ada, ops, sub] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair()));
    const caps: E.Caps = { currency: "USD", limit: 20000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 1 };
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, caps);
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const subChain = await E.split(chain, ops!, { publicKey: sub!.publicKey, label: "creative-agent" }, { ...caps, limit: 5000, perPayment: 5000, splits: 0 });
    // PayPal is unreachable for the capture (every retry fails), so the payment stays reserved
    await sim.simFailNext("/capture", 20);
    const r = await G.spend(await E.signSpend(subChain, sub!, { amount: 2500, payee: "designer@example.com", purpose: "design" }));
    expect(r.status).toBe("RESERVED");
    await sim.simFailNext(null);
    await G.revoke(await E.signRevoke(ada!, subChain[1]!.body.id));
    const after = await G.syncSpend(r.spend!.id);
    expect(after.status).toBe("FAILED");
    expect(after.reasons.map((x) => x.code)).toEqual(["REVOKED"]);
    expect((await sim.simCalls()).some((c) => c.includes("/payouts"))).toBe(false);
    expect((await getDb().query.roots.findFirst({ where: eq(schema.roots.id, root.id) }))!.capturedMinor).toBe(0);
  });
});
