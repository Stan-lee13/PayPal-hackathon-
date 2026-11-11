/**
 * A corpus of attacks on the gateway, run against the built-in PayPal simulator.
 *
 * Every case is something a compromised agent, a thief with a copied envelope, or a dishonest
 * counterparty could try. A case passes when the attack is refused AND the simulator saw no capture
 * or payout because of it. `runCorpus` returns one row per case; tests/attacks.test.ts asserts on
 * them and scripts/attack-suite.ts writes them to docs/evidence/attack-suite.json.
 */
import * as E from "../lib/envelope/core";

export type AttackRow = { category: string; attack: string; refused: boolean; how: string; moneyMoved: boolean };

type G = typeof import("../lib/gateway/service");
type Bank = typeof import("../lib/gateway/bank");
type Sim = typeof import("../lib/paypal/emulator");

export async function runCorpus(deps: { G: G; B: Bank; sim: Sim; reset: () => Promise<void>; balanceOf(agent: string): Promise<number>; db: { expirePromise(id: string): Promise<void> } }): Promise<AttackRow[]> {
  const { G, B, sim } = deps;
  const rows: AttackRow[] = [];
  const EXP = () => new Date(Date.now() + 3600_000).toISOString();
  const moved = async () => (await sim.simCalls()).filter((c) => c.includes("/capture") || c.includes("/payouts")).length;

  /** Run one attack. `fn` returns the gateway's verdict: denial codes, a thrown refusal, or `false` from a verifier. */
  async function attack(category: string, name: string, fn: () => Promise<unknown>, legitMoves = 0) {
    const before = await moved();
    let refused = false, how = "";
    try {
      const r = await fn();
      if (r === false) { refused = true; how = "verification failed"; }
      else if (r && typeof r === "object" && "status" in r) {
        const s = r as { status: string; reasons?: Array<{ code: string }>; good?: boolean; duplicate?: boolean };
        refused = s.status === "DENIED" || s.status === "LAPSED";
        how = refused ? [...new Set((s.reasons ?? []).map((x) => x.code))].sort().join(", ") || s.status : `NOT REFUSED (${s.status})`;
      } else if (r && typeof r === "object" && "good" in r) {
        const s = r as { good: boolean; reasons: Array<{ code: string }> };
        refused = !s.good; how = refused ? s.reasons.map((x) => x.code).sort().join(", ") : "NOT REFUSED (good)";
      } else if (typeof r === "string") { refused = true; how = r; }
      else how = `NOT REFUSED (${JSON.stringify(r)?.slice(0, 60)})`;
    } catch (e) { refused = true; how = `refused: ${e instanceof Error ? e.message.slice(0, 90) : "error"}`; }
    rows.push({ category, attack: name, refused, how, moneyMoved: (await moved()) - before !== legitMoves });
  }

  async function world() {
    await deps.reset();
    const [ada, ops, loc, art, rogue, bea, tr] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com" }));
    const acct = E.accountPayee(tr!.publicKey);
    const base: E.Caps = { currency: "USD", limit: 20000, perPayment: 8000, payees: [acct, "designer@example.com"], purposes: ["translation", "design"], notAfter: EXP(), splits: 2 };
    const rootChain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, base);
    const root = await G.registerRoot({ chain: rootChain, principalName: "Ada", title: "Launch budget" });
    const locChain = await E.split(rootChain, ops!, { publicKey: loc!.publicKey, label: "localization-agent" }, { ...base, limit: 6000, perPayment: 5000, payees: [acct], purposes: ["translation"], splits: 0 });
    const artChain = await E.split(rootChain, ops!, { publicKey: art!.publicKey, label: "creative-agent" }, { ...base, limit: 9000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], splits: 1 });
    return { ada: ada!, ops: ops!, loc: loc!, art: art!, rogue: rogue!, bea: bea!, tr: tr!, acct, base, rootChain, locChain, artChain, root };
  }
  type W = Awaited<ReturnType<typeof world>>;
  /** A block signed by hand, skipping the library's refusal to sign anything wider than its parent. */
  async function forge(parent: E.Envelope, issuer: E.KeyPair, holder: E.KeyPair, caps: Partial<E.Caps>, tweak: (b: E.BlockBody) => void = () => {}): Promise<E.Envelope> {
    const last = parent[parent.length - 1]!;
    const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: parent[0]!.body.id, parent: await E.blockHash(last), issuer: issuer.publicKey, holder: holder.publicKey, holderLabel: "helper", caps: E.normalizeCaps({ ...last.body.caps, splits: 0, ...caps }), issuedAt: new Date().toISOString() };
    tweak(body);
    return [...parent, { body, sig: await E.signDetached(issuer.privateKey, E.BLOCK_VERSION, body) }];
  }
  const pay = (chain: E.Envelope, key: E.KeyPair, p: Partial<{ amount: number; payee: string; purpose: string }> = {}) => E.signSpend(chain, key, { amount: 1000, payee: "designer@example.com", purpose: "design", ...p }).then((s) => G.spend(s));

  // ---- 1. A sub-agent signs itself (or a helper) a wider envelope ---------------------------------
  let w = await world();
  const widenings: Array<[string, Partial<E.Caps>, Partial<{ amount: number; payee: string; purpose: string }>]> = [
    ["limit 1 cent above the parent's", { limit: 9001, perPayment: 8000 }, {}],
    ["limit doubled", { limit: 18000 }, {}],
    ["limit 100 times the root", { limit: 2_000_000, perPayment: 2_000_000 }, { amount: 50000 }],
    ["per-payment cap above the parent's", { perPayment: 9000 }, {}],
    ["one extra payee added", { payees: ["designer@example.com", "attacker@evil.example"] }, { payee: "attacker@evil.example" }],
    ["payee list replaced by 'any payee'", { payees: null }, { payee: "attacker@evil.example" }],
    ["payee list replaced by the attacker only", { payees: ["attacker@evil.example"] }, { payee: "attacker@evil.example" }],
    ["one extra purpose added", { purposes: ["design", "gift-cards"] }, { purpose: "gift-cards" }],
    ["purposes replaced by 'any purpose'", { purposes: null }, { purpose: "anything" }],
    ["expiry one second after the parent's", { notAfter: new Date(Date.parse(w.artChain[1]!.body.caps.notAfter) + 1000).toISOString() }, {}],
    ["expiry a year later", { notAfter: new Date(Date.now() + 365 * 86400_000).toISOString() }, {}],
    ["currency changed", { currency: "EUR" }, {}],
    ["more splits than the parent allows", { splits: 5 }, {}],
  ];
  for (const [name, caps, p] of widenings) {
    await attack("Forged wider envelope", name, async () => pay(await forge(w.artChain, w.art, w.rogue, caps), w.rogue, p));
  }
  await attack("Forged wider envelope", "split an envelope that may not be split", async () => pay(await forge(w.locChain, w.loc, w.rogue, {}), w.rogue, { payee: w.acct, purpose: "translation" }));
  await attack("Forged wider envelope", "two forged levels, each a little wider", async () => {
    const one = await forge(w.artChain, w.art, w.rogue, { limit: 9500, splits: 1 });
    return pay(await forge(one, w.rogue, w.loc, { limit: 9900 }), w.loc);
  });

  // ---- 2. Broken or stolen chains ------------------------------------------------------------------
  w = await world();
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  await attack("Tampered chain", "limit edited after signing", async () => { const c = clone(w.artChain); c[1]!.body.caps.limit = 20000; return pay(c, w.art); });
  await attack("Tampered chain", "payee list edited after signing", async () => { const c = clone(w.artChain); c[1]!.body.caps.payees = ["attacker@evil.example"]; return pay(c, w.art, { payee: "attacker@evil.example" }); });
  await attack("Tampered chain", "holder swapped for the thief's key", async () => { const c = clone(w.artChain); c[1]!.body.holder = w.rogue.publicKey; return pay(c, w.rogue); });
  await attack("Tampered chain", "root block's limit edited", async () => { const c = clone(w.artChain); c[0]!.body.caps.limit = 999999; return pay(c, w.art); });
  await attack("Tampered chain", "signature bytes replaced", async () => { const c = clone(w.artChain); c[1]!.sig = c[0]!.sig; return pay(c, w.art); });
  await attack("Tampered chain", "child block signed by a key that doesn't hold the parent", async () => pay(await forge(w.rootChain, w.rogue, w.rogue, { limit: 5000 }), w.rogue));
  await attack("Tampered chain", "middle block removed", async () => { const deep = await E.split(w.artChain, w.art, { publicKey: w.rogue.publicKey, label: "helper" }, { ...w.artChain[1]!.body.caps, limit: 1000, perPayment: 1000, splits: 0 }); return pay([deep[0]!, deep[2]!], w.rogue); });
  await attack("Tampered chain", "blocks presented out of order", async () => pay([w.artChain[1]!, w.artChain[0]!], w.art));
  await attack("Tampered chain", "child grafted onto a different root", async () => { const other = await world(); return pay([other.rootChain[0]!, w.artChain[1]!], w.art); });
  w = await world();
  await attack("Tampered chain", "root that was never sealed with the gateway (no PayPal hold)", async () => { const fake = await E.seal(w.rogue, { publicKey: w.rogue.publicKey, label: "self" }, { ...w.base, payees: null, purposes: null }); return pay(fake, w.rogue, { payee: "attacker@evil.example" }); });
  await G.announce(w.artChain); // the gateway has the real block on record; a different block with its id is a fork
  await attack("Tampered chain", "second block reusing a known id with different limits (fork)", async () => pay(await forge(w.rootChain, w.ops, w.rogue, { limit: 15000 }, (b) => { b.id = w.artChain[1]!.body.id; }), w.rogue));
  await attack("Tampered chain", "empty chain", async () => G.spend({ request: (await E.signSpend(w.artChain, w.art, { amount: 100, payee: "designer@example.com", purpose: "design" })).request, sig: "x", chain: [] }));
  await attack("Tampered chain", "chain of nine blocks", async () => { const c = [...w.artChain]; while (c.length < 9) c.push(c[1]!); return pay(c, w.art); });
  await attack("Tampered chain", "block with a malformed body", async () => { const c = clone(w.artChain) as unknown as Array<{ body: Record<string, unknown>; sig: string }>; delete c[1]!.body.caps; return pay(c as never, w.art); });

  // ---- 3. Requests ----------------------------------------------------------------------------------
  w = await world();
  await attack("Bad request", "copied envelope, signed with the thief's own key", async () => pay(w.artChain, w.rogue));
  await attack("Bad request", "request signed by the parent agent instead of the holder", async () => pay(w.artChain, w.ops));
  for (const [name, amount] of [["amount of zero", 0], ["negative amount", -500], ["fractional cents", 10.5], ["amount beyond safe integers", Number.MAX_SAFE_INTEGER * 2], ["amount as a string", "1000" as unknown as number], ["NaN amount", NaN]] as const) {
    await attack("Bad request", name, async () => pay(w.artChain, w.art, { amount: amount as number }));
  }
  await attack("Bad request", "one cent over the per-payment cap", async () => pay(w.artChain, w.art, { amount: 8001 }));
  await attack("Bad request", "payee not on the envelope", async () => pay(w.artChain, w.art, { payee: "attacker@evil.example" }));
  await attack("Bad request", "look-alike payee (designer@exarnple.com)", async () => pay(w.artChain, w.art, { payee: "designer@exarnple.com" }));
  await attack("Bad request", "payee with the real address as a prefix", async () => pay(w.artChain, w.art, { payee: "designer@example.com.evil.example" }));
  await attack("Bad request", "two payees in one field", async () => pay(w.artChain, w.art, { payee: "designer@example.com,attacker@evil.example" }));
  await attack("Bad request", "sibling's payee (allowed by the root, not by this envelope)", async () => pay(w.artChain, w.art, { payee: w.acct }));
  await attack("Bad request", "purpose not on the envelope", async () => pay(w.artChain, w.art, { purpose: "gift-cards" }));
  await attack("Bad request", "sibling's purpose", async () => pay(w.artChain, w.art, { purpose: "translation" }));
  await attack("Bad request", "request dated ten minutes ago", async () => G.spend(await E.signSpend(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" }, new Date(Date.now() - 600_000))));
  await attack("Bad request", "request dated ten minutes ahead", async () => G.spend(await E.signSpend(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" }, new Date(Date.now() + 600_000))));
  await attack("Bad request", "request names a different envelope than the one presented", async () => { const s = await E.signSpend(w.locChain, w.loc, { amount: 1000, payee: w.acct, purpose: "translation" }); return G.spend({ ...s, chain: w.artChain }); });
  await attack("Bad request", "amount edited after signing", async () => { const s = await E.signSpend(w.artChain, w.art, { amount: 100, payee: "designer@example.com", purpose: "design" }); return G.spend({ ...s, request: { ...s.request, amount: 8000 } }); });
  await attack("Bad request", "payee edited after signing", async () => { const s = await E.signSpend(w.artChain, w.art, { amount: 100, payee: "designer@example.com", purpose: "design" }); return G.spend({ ...s, request: { ...s.request, payee: "attacker@evil.example" } }); });
  await attack("Bad request", "wrong currency", async () => { const s = await E.signSpend(w.artChain, w.art, { amount: 100, payee: "designer@example.com", purpose: "design" }); const request = { ...s.request, currency: "EUR" }; return G.spend({ request, sig: await E.signDetached(w.art.privateKey, E.SPEND_VERSION, request), chain: s.chain }); });

  // ---- 4. Budgets, replay, races ---------------------------------------------------------------------
  w = await world();
  await pay(w.artChain, w.art, { amount: 7000 });
  await attack("Budget", "spend more than is left in the agent's own envelope", async () => pay(w.artChain, w.art, { amount: 2001 }));
  await attack("Budget", "many small payments past the limit (41 x $0.50 against $20.00 left)", async () => { let last: unknown; for (let i = 0; i < 41; i++) last = await pay(w.artChain, w.art, { amount: 50 }); return last; }, 80);
  w = await world();
  await attack("Budget", "replay one signed payment five times (paid once)", async () => {
    const s = await E.signSpend(w.artChain, w.art, { amount: 3000, payee: "designer@example.com", purpose: "design" });
    const all = [await G.spend(s), await G.spend(s), await G.spend(s), await G.spend(s), await G.spend(s)];
    return all.filter((x) => !x.duplicate).length === 1 && all.every((x) => x.spend!.id === all[0]!.spend!.id) ? "paid once; four replays returned the first result" : { status: "REPLAYED" };
  }, 2);
  w = await world();
  await attack("Budget", "twenty agents race for one $90.00 envelope with $80.00 payments (one wins)", async () => {
    const all = await Promise.all(Array.from({ length: 20 }, () => pay(w.artChain, w.art, { amount: 8000 })));
    return all.filter((x) => x.status === "PAID").length === 1 ? "exactly one paid; nineteen refused" : { status: `${all.filter((x) => x.status === "PAID").length} PAID` };
  }, 2);
  w = await world();
  await attack("Budget", "orchestrator hands out more than it holds, children try to spend it all", async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair()));
    const any = { ...w.base, limit: 8000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], splits: 0 };
    const chains = await Promise.all([a!, b!, c!].map((k, i) => E.split(w.rootChain, w.ops, { publicKey: k.publicKey, label: `child-${i}` }, any)));
    const res = [await pay(chains[0]!, a!, { amount: 8000 }), await pay(chains[1]!, b!, { amount: 8000 }), await pay(chains[2]!, c!, { amount: 8000 })];
    return res[2]!.status === "DENIED" && res[2]!.reasons.some((x) => x.code === "OVER_ANCESTOR_LIMIT") ? "third child refused: OVER_ANCESTOR_LIMIT" : { status: "ALL PAID" };
  }, 4);
  w = await world();
  await G.announce(w.artChain);
  await G.revoke(await E.signRevoke(w.ada, w.artChain[1]!.body.id));
  await attack("Budget", "spend from a revoked envelope", async () => pay(w.artChain, w.art));
  await attack("Budget", "spend from an envelope split off a revoked one", async () => pay(await E.split(w.artChain, w.art, { publicKey: w.rogue.publicKey, label: "helper" }, { ...w.artChain[1]!.body.caps, limit: 1000, perPayment: 1000, splits: 0 }), w.rogue));
  await G.revoke(await E.signRevoke(w.ada, w.root.id));
  await attack("Budget", "spend after the owner closed the envelope (hold voided)", async () => pay(w.locChain, w.loc, { payee: w.acct, purpose: "translation" }));
  w = await world();
  await attack("Budget", "spend from an expired envelope", async () => {
    const soon = { ...w.base, limit: 1000, perPayment: 1000, payees: ["designer@example.com"], purposes: ["design"], splits: 0, notAfter: new Date(Date.now() + 700).toISOString() };
    const chain = await E.split(w.rootChain, w.ops, { publicKey: w.rogue.publicKey, label: "short-lived" }, soon);
    await new Promise((r) => setTimeout(r, 900));
    return pay(chain, w.rogue);
  });

  // ---- 5. One kind of signed message passed off as another ---------------------------------------------
  w = await world();
  await attack("Cross-use", "an introduction replayed as a payment", async () => { const h = await E.signHello(w.artChain, w.art, { amount: 5000, payee: "designer@example.com", purpose: "design" }); return G.spend({ request: { ...h.request, v: E.SPEND_VERSION, memo: "" }, sig: h.sig, chain: h.chain }); });
  await attack("Cross-use", "a promise replayed as a payment", async () => { const p = await E.signPromise(w.artChain, w.art, { amount: 5000, payee: "designer@example.com", purpose: "design" }); const { ttl: _t, ...rest } = p.request; return G.spend({ request: { ...rest, v: E.SPEND_VERSION }, sig: p.sig, chain: p.chain }); });
  await attack("Cross-use", "a payment replayed as a promise", async () => { const s = await E.signSpend(w.artChain, w.art, { amount: 5000, payee: "designer@example.com", purpose: "design" }); return G.promise({ request: { ...s.request, v: E.PROMISE_VERSION, ttl: 600 }, sig: s.sig, chain: s.chain }); });
  await attack("Cross-use", "revocation signed by a sibling agent", async () => G.revoke(await E.signRevoke(w.loc, w.artChain[1]!.body.id)));
  await attack("Cross-use", "revocation signed by an outsider", async () => G.revoke(await E.signRevoke(w.rogue, w.root.id)));
  await attack("Cross-use", "revocation dated ten minutes ago", async () => G.revoke(await E.signRevoke(w.ada, w.root.id, new Date(Date.now() - 600_000))));

  // ---- 6. Promises --------------------------------------------------------------------------------------
  w = await world();
  const promise = (p: Partial<{ amount: number; payee: string; purpose: string; ttl: number }> = {}) => E.signPromise(w.locChain, w.loc, { amount: 4000, payee: w.acct, purpose: "translation", ttl: 600, ...p }).then((s) => G.promise(s));
  await attack("Promise", "set money aside for a payee not on the envelope", async () => promise({ payee: "attacker@evil.example" }));
  await attack("Promise", "set aside more than the envelope holds", async () => promise({ amount: 6001 }));
  await attack("Promise", "hold money for a week (lifetime out of range)", async () => promise({ ttl: 7 * 86400 }));
  const p1 = await promise();
  await attack("Promise", "spend money that is already set aside for someone", async () => pay(w.locChain, w.loc, { amount: 2500, payee: w.acct, purpose: "translation" }));
  await attack("Promise", "set aside the same money twice", async () => promise({ amount: 2500 }));
  await attack("Promise", "another agent pays out a promise it didn't make", async () => G.keep(await E.signKeep(w.rogue, p1.spend!.id, "pay")));
  await attack("Promise", "the payee's owner tries to pay itself from the promise", async () => G.keep(await E.signKeep(w.bea, p1.spend!.id, "pay")));
  await G.keep(await E.signKeep(w.loc, p1.spend!.id, "release"));
  await attack("Promise", "pay a promise after releasing it", async () => G.keep(await E.signKeep(w.loc, p1.spend!.id, "pay")));
  const p2 = await promise();
  await deps.db.expirePromise(p2.spend!.id);
  await attack("Promise", "pay a promise after it ran out", async () => G.keep(await E.signKeep(w.loc, p2.spend!.id, "pay")));
  const p3 = await promise();
  await G.revoke(await E.signRevoke(w.ada, w.locChain[1]!.body.id));
  await attack("Promise", "pay a promise after the owner revoked the agent", async () => G.keep(await E.signKeep(w.loc, p3.spend!.id, "pay")));
  // promises that a named key can release
  w = await world();
  const work = await E.sha256("delivered files");
  const named = await E.signPromise(w.locChain, w.loc, { amount: 2000, payee: w.acct, purpose: "translation", ttl: 600, releaseBy: w.ops.publicKey }).then((s) => G.promise(s));
  const unnamed = await E.signPromise(w.locChain, w.loc, { amount: 1000, payee: w.acct, purpose: "translation", ttl: 600 }).then((s) => G.promise(s));
  await attack("Promise", "the payee signs its own acceptance when another key was named", async () => G.accept(await E.signAccept(w.tr, named.spend!.id, { work })));
  await attack("Promise", "an outsider signs the acceptance", async () => G.accept(await E.signAccept(w.rogue, named.spend!.id, { work })));
  await attack("Promise", "the payee collects a promise that named no release key", async () => G.accept(await E.signAccept(w.tr, unnamed.spend!.id, { work })));
  await attack("Promise", "a genuine acceptance pointed at a different promise", async () => { const a = await E.signAccept(w.ops, named.spend!.id, { work }); return G.accept({ ...a, request: { ...a.request, promise: unnamed.spend!.id } }); });
  await attack("Promise", "a keep signature replayed as an acceptance", async () => { const k = await E.signKeep(w.ops, named.spend!.id, "pay"); return G.accept({ request: { v: E.ACCEPT_VERSION, promise: named.spend!.id, work: "", note: "", nonce: k.request.nonce, at: k.request.at }, sig: k.sig, by: k.by }); });
  await attack("Promise", "an acceptance dated ten minutes ago", async () => G.accept(await E.signAccept(w.ops, named.spend!.id, { work }, new Date(Date.now() - 600_000))));
  await attack("Promise", "release key set to something that is not a key", async () => G.promise(await E.signPromise(w.locChain, w.loc, { amount: 500, payee: w.acct, purpose: "translation", ttl: 600, releaseBy: "anyone" })));
  await G.revoke(await E.signRevoke(w.ada, w.locChain[1]!.body.id));
  await attack("Promise", "the named key accepts after the owner revoked the payer", async () => G.accept(await E.signAccept(w.ops, named.spend!.id, { work })));
  w = await world();
  const p3again = await E.signPromise(w.locChain, w.loc, { amount: 4000, payee: w.acct, purpose: "translation", ttl: 600 }).then((s) => G.promise(s));
  void p3again;

  await attack("Promise", "forged note: amount edited", async () => G.verifyPromiseNote({ ...p3.note!, amount: 999999 }));
  await attack("Promise", "forged note: signed by a different key", async () => { const { sig: _s, ...body } = p3.note!; const fake = { ...body, gateway: w.rogue.publicKey }; return G.verifyPromiseNote({ ...fake, sig: await E.signDetached(w.rogue.privateKey, G.PROMISE_NOTE_VERSION, fake) }).then(async (ok) => (ok && fake.gateway !== (await G.gatewayKey()).publicKey ? "valid only under the attacker's key; a payee pins the gateway's key" : ok)); });

  // owner approval above a threshold
  {
    await deps.reset();
    const [ada, ops, helper] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair()));
    const caps: E.Caps = { currency: "USD", limit: 20000, perPayment: 8000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP(), splits: 2, approveOver: 5000 };
    const root = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, caps);
    await G.registerRoot({ chain: root, principalName: "Ada", title: "Launch budget" });
    const ask = (p: Partial<{ amount: number; releaseBy: string }> = {}) => E.signPromise(root, ops!, { amount: 7000, payee: "designer@example.com", purpose: "design", ttl: 600, ...p }).then((x) => G.promise(x));
    await attack("Promise", "pay over the owner's approval threshold without asking", async () => G.spend(await E.signSpend(root, ops!, { amount: 5001, payee: "designer@example.com", purpose: "design" })));
    await attack("Promise", "set the money aside to pay it oneself later", async () => ask());
    await attack("Promise", "name a friendly agent instead of the owner as approver", async () => ask({ releaseBy: helper!.publicKey }));
    await attack("Promise", "name oneself as approver", async () => ask({ releaseBy: ops!.publicKey }));
    const pending = await ask({ releaseBy: ada!.publicKey });
    await attack("Promise", "the agent pays its own request that awaits the owner", async () => G.keep(await E.signKeep(ops!, pending.spend!.id, "pay")));
    await attack("Promise", "the agent signs the owner's approval itself", async () => G.accept(await E.signAccept(ops!, pending.spend!.id)));
    await attack("Promise", "a sub-envelope that drops the approval threshold", async () => { const { approveOver: _d, ...without } = caps; return pay(await forge(root, ops!, helper!, { ...without, limit: 8000 } as E.Caps, (b) => { delete (b.caps as Partial<E.Caps>).approveOver; }), helper!, { amount: 8000 }); });
    await attack("Promise", "a sub-envelope that raises the approval threshold", async () => pay(await forge(root, ops!, helper!, { approveOver: 8000, limit: 8000 }), helper!, { amount: 8000 }));
    await attack("Promise", "split payments just under the threshold are not an attack, but one cent over is", async () => G.spend(await E.signSpend(root, ops!, { amount: 5001, payee: "designer@example.com", purpose: "design" })));
  }

  // ---- 7. Accounts ---------------------------------------------------------------------------------------
  w = await world();
  await attack("Account", "point someone else's account at the attacker's PayPal address", async () => { const f = await E.signAccount(w.rogue, w.rogue, { label: "translator-agent", ownerName: "Mallory", settleTo: "mallory@evil.example" }); f.body.agent = w.tr.publicKey; return G.openAccount(f); });
  await attack("Account", "owner alone moves the account without the agent's signature", async () => { const real = await E.signAccount(w.tr, w.bea, { label: "translator-agent", ownerName: "Bea", settleTo: "elsewhere@example.com" }, new Date(Date.now() + 1000)); return G.openAccount({ ...real, agentSig: real.ownerSig }); });
  await attack("Account", "replay an old account opening to move the money back", async () => {
    const first = (await G.accountByNumber(w.acct))!.signed;
    await G.openAccount(await E.signAccount(w.tr, w.bea, { label: "translator-agent", ownerName: "Bea", settleTo: "bea-new@example.com" }, new Date(Date.now() + 2000)));
    return (await G.openAccount(first)).settleTo === "bea-new@example.com" ? "ignored: the newer signed opening stands" : { status: "MOVED BACK" };
  });
  await attack("Account", "pay an account number nobody opened", async () => pay(w.locChain, w.loc, { payee: E.accountPayee(w.rogue.publicKey), purpose: "translation" }));
  await attack("Account", "settlement address that isn't an address", async () => G.openAccount(await E.signAccount(w.rogue, w.rogue, { label: "x", ownerName: "x", settleTo: "not-an-email" })));

  // ---- 8. Evidence -------------------------------------------------------------------------------------
  w = await world();
  const paidOk = await pay(w.artChain, w.art, { amount: 2500 });
  const st = await G.standing(await E.signHello(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" }));
  await attack("Forged evidence", "receipt with the amount edited", async () => G.verifyReceipt({ ...paidOk.receipt!, request: { ...paidOk.receipt!.request, amount: 1 } }));
  await attack("Forged evidence", "receipt with a different PayPal capture id", async () => G.verifyReceipt({ ...paidOk.receipt!, paypal: { ...paidOk.receipt!.paypal, captureId: "SIMCAPFAKE" } }));
  await attack("Forged evidence", "statement of standing with 'good' flipped", async () => G.verifyStanding({ ...st, good: !st.good }));
  await attack("Forged evidence", "statement of standing with more money available", async () => G.verifyStanding({ ...st, availableMinor: 999999 }));
  await attack("Forged evidence", "statement of standing used after it expired", async () => G.verifyStanding(st, new Date(Date.now() + 6 * 60_000)));
  await attack("Forged evidence", "proof of funds asked by an impostor without the agent's key", async () => G.standing(await E.signHello(w.artChain, w.rogue, { amount: 1000, payee: "designer@example.com", purpose: "design" })));
  await attack("Forged evidence", "proof of funds for a payee the agent can't pay", async () => G.standing(await E.signHello(w.artChain, w.art, { amount: 1000, payee: "attacker@evil.example", purpose: "design" })));

  // A signed request presented again with its signature written another way (same bytes, different text).
  {
    const sp = await E.signSpend(w.artChain, w.art, { amount: 1000, payee: "designer@example.com", purpose: "design" });
    await G.spend(sp);
    const last = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const i = last.indexOf(sp.sig[sp.sig.length - 1]!);
    const spellings: Array<[string, string]> = [["base64 padding added", `${sp.sig}==`], ["a space in front", ` ${sp.sig}`], ["the other base64 alphabet", sp.sig.replace(/-/g, "+").replace(/_/g, "/") === sp.sig ? `${sp.sig}=` : sp.sig.replace(/-/g, "+").replace(/_/g, "/")], ["spare bits flipped in the last character", sp.sig.slice(0, -1) + last[i ^ 1]]];
    for (const [how, sig] of spellings) await attack("Bad request", `replay a paid request with its signature re-spelled: ${how}`, async () => { const r = await G.spend({ ...sp, sig }); return r.duplicate ? "ignored: the same request, already paid once" : r; });
  }

  // ---- 9. Balances -------------------------------------------------------------------------------------
  // Bea's translator-agent keeps its income (her cap: $30 a payment); Cy's proofreader-agent does too.
  {
    await deps.reset();
    const [ada, ops, bea, tr, cy, pf, rogue] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold", perPayment: 3000 }));
    await G.openAccount(await E.signAccount(pf!, cy!, { label: "proofreader-agent", ownerName: "Cy", settleTo: "cy@example.com", mode: "hold" }));
    const [me, other] = [E.accountPayee(tr!.publicKey), E.accountPayee(pf!.publicKey)];
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 10000, payees: [me], purposes: ["translation"], notAfter: EXP(), splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const income = await E.signSpend(chain, ops!, { amount: 5000, payee: me, purpose: "translation" });
    const paidIn = await G.spend(income);
    const bal = () => deps.balanceOf(tr!.publicKey);
    const send = async (p: Parameters<typeof E.signTransfer>[1], by = tr!, now?: Date) => B.transfer(await E.signTransfer(by, p, now));
    /** The attack must be refused AND leave both balances exactly where they were. */
    const guarded = (name: string, fn: () => Promise<unknown>) => attack("Balance", name, async () => {
      const before = [await bal(), await deps.balanceOf(pf!.publicKey)];
      let r: unknown;
      try { r = await fn(); } catch (e) { r = `refused: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`; }
      const after = [await bal(), await deps.balanceOf(pf!.publicKey)];
      return before[0] === after[0] && before[1] === after[1] ? r : { status: `BALANCE CHANGED ${before} -> ${after}` };
    });

    await guarded("move another agent's balance by writing its key in the request", async () => { const t = await E.signTransfer(rogue!, { amount: 1000, payee: "mallory@evil.example" }); t.request.from = tr!.publicKey; return B.transfer(t); });
    await guarded("raise the amount after the agent signed", async () => { const t = await E.signTransfer(tr!, { amount: 100, payee: other }); return B.transfer({ ...t, request: { ...t.request, amount: 5000 } }); });
    await guarded("redirect a signed transfer to another payee", async () => { const t = await E.signTransfer(tr!, { amount: 100, payee: other }); return B.transfer({ ...t, request: { ...t.request, payee: "mallory@evil.example" } }); });
    await guarded("turn a signed payment into a withdrawal", async () => { const t = await E.signTransfer(tr!, { amount: 100, payee: other }); return B.transfer({ ...t, request: { ...t.request, kind: "withdraw" } }); });
    await guarded("a signature made for another kind of message, reused as a transfer", async () => { const t = await E.signTransfer(tr!, { amount: 100, payee: other }); return B.transfer({ ...t, sig: await E.signDetached(tr!.privateKey, E.ACCEPT_VERSION, t.request) }); });
    await guarded("the owner moves the agent's money without the agent's key", async () => { const t = await E.signTransfer(bea!, { amount: 1000, payee: "bea@example.com" }); t.request.from = tr!.publicKey; return B.transfer(t); });
    await guarded("spend one cent more than the balance", async () => send({ kind: "withdraw", amount: 5001 }));
    await guarded("pay more at once than the owner allows", async () => send({ amount: 3001, payee: other }));
    await guarded("a negative amount, to pull money in", async () => send({ amount: -1000, payee: other }));
    await guarded("a fraction of a cent", async () => send({ amount: 10.5, payee: other }));
    await guarded("pay itself to inflate its record", async () => send({ amount: 100, payee: me }));
    await guarded("a transfer signed ten minutes ago", async () => send({ amount: 100, payee: other }, tr!, new Date(Date.now() - 10 * 60_000)));
    await guarded("a transfer from a key that has no account", async () => send({ amount: 100, payee: other }, rogue!));
    await guarded("pay an account number nobody opened", async () => send({ amount: 100, payee: E.accountPayee(rogue!.publicKey) }));
    await guarded("credit the same income twice by presenting the payment again", async () => { const again = await G.spend(income); await G.settle(paidIn.spend!.id); return again.duplicate ? "ignored: the ledger takes one entry per payment" : { status: "CREDITED TWICE" }; });
    await guarded("the agent swaps in an owner key of its own to drop the cap", async () => G.openAccount(await E.signAccount(tr!, rogue!, { label: "translator-agent", ownerName: "Bea", settleTo: "mine@evil.example", mode: "hold" }, new Date(Date.now() + 1000))));
    await guarded("a stranger freezes someone's account", async () => B.freeze(await E.signFreeze(rogue!, tr!.publicKey, true)));
    // one real transfer, then replays of it
    const real = await E.signTransfer(tr!, { amount: 1000, payee: other, purpose: "proofreading" });
    const done = await B.transfer(real);
    await guarded("replay a completed transfer to move the money again", async () => { const again = await B.transfer(real); return again.duplicate && again.status === "BOOKED" ? "ignored: already booked once" : { status: "MOVED TWICE" }; });
    await attack("Balance", "transfer receipt with the amount edited", async () => B.verifyTransferReceipt({ ...done.receipt!, request: { ...done.receipt!.request, amount: 1 } }));
    await attack("Balance", "transfer receipt naming a different recipient", async () => B.verifyTransferReceipt({ ...done.receipt!, to: { kind: "paypal", address: "mallory@evil.example", payoutBatchId: "X", mode: "sandbox" } }));
    // eight transfers race for a balance that covers four
    await attack("Balance", "eight transfers at once for a balance that covers four", async () => {
      const rs = await Promise.all((await Promise.all(Array.from({ length: 8 }, () => E.signTransfer(tr!, { amount: 1000, payee: other })))).map((t) => B.transfer(t)));
      const ok = rs.filter((r) => r.status === "BOOKED").length;
      return ok === 4 && (await bal()) === 0 && (await B.position()).checks.every((c) => c.ok) ? "4 booked, 4 refused INSUFFICIENT_BALANCE; the books balance" : { status: `${ok} BOOKED` };
    });
    // the owner freezes; then nothing leaves, and the agent cannot lift it
    await G.spend(await E.signSpend(chain, ops!, { amount: 2000, payee: me, purpose: "translation" }));
    await B.freeze(await E.signFreeze(bea!, tr!.publicKey, true));
    await guarded("pay out of a frozen account", async () => send({ amount: 100, payee: other }));
    await guarded("withdraw from a frozen account", async () => send({ kind: "withdraw", amount: 100 }));
    await guarded("the agent lifts its owner's freeze itself", async () => B.freeze(await E.signFreeze(tr!, tr!.publicKey, false)));
    await guarded("replay a completed transfer with its signature re-spelled", async () => { const r = await B.transfer({ ...real, sig: `${real.sig}==` }); return r.duplicate ? "ignored: already booked once" : r; });
    await guarded("present the owner's earlier unfreeze again to lift a newer freeze", async () => {
      const t = Date.now();
      const old = await E.signFreeze(bea!, tr!.publicKey, false, new Date(t - 2000));
      await B.freeze(old); await B.freeze(await E.signFreeze(bea!, tr!.publicKey, true, new Date(t - 1000)));
      return B.freeze(old);
    });
    await guarded("a freeze signed by the owner, flipped to an unfreeze", async () => { const f = await E.signFreeze(bea!, tr!.publicKey, true); return B.freeze({ ...f, request: { ...f.request, frozen: false } }); });
  }

  return rows;
}
