/**
 * The narrowing rule, term by term, on the pure core (no database, no PayPal).
 *
 * An envelope has eight terms. For each one this file takes a sub-envelope that is narrower than,
 * equal to and wider than its parent in that term alone, and checks three things about it:
 *   1. the rule itself (narrowingViolations) names exactly the expected reasons;
 *   2. the honest path (split) signs it only when it is not wider;
 *   3. a block signed by hand, skipping split, is caught by verification with the same reasons,
 *      pinned to that block, and a payment request made with it does not verify.
 * Then: one term narrowed while another is widened (every ordered pair), and chains of every depth.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as E from "../lib/envelope/core";

const T = Date.now() + 3600_000;
const at = (ms: number) => new Date(ms).toISOString();
const A = "a@x.example", B = "b@x.example", C = "c@x.example", EVIL = "attacker@evil.example";
/** The parent every row starts from unless it says otherwise. */
const PARENT: E.Caps = { currency: "USD", limit: 20000, perPayment: 8000, payees: [A, B, C], purposes: ["design", "translation"], notAfter: at(T), splits: 3, approveOver: 5000 };
const codes = (v: E.Violation[]) => v.map((x) => x.code).sort();

let owner: E.KeyPair, ops: E.KeyPair, sub: E.KeyPair, extra: E.KeyPair[];
beforeAll(async () => {
  [owner, ops, sub] = await Promise.all([1, 2, 3].map(() => E.generateKeyPair())) as [E.KeyPair, E.KeyPair, E.KeyPair];
  extra = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => E.generateKeyPair()));
});

/** A block signed by hand by the parent's holder: what an agent that ignores split() would produce. */
async function forge(parent: E.Envelope, issuer: E.KeyPair, holder: E.KeyPair, caps: E.Caps): Promise<E.Envelope> {
  const last = parent[parent.length - 1]!;
  const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: parent[0]!.body.id, parent: await E.blockHash(last), issuer: issuer.publicKey, holder: holder.publicKey, holderLabel: "sub-agent", caps: E.normalizeCaps(caps), issuedAt: new Date().toISOString() };
  return [...parent, { body, sig: await E.signDetached(issuer.privateKey, E.BLOCK_VERSION, body) }];
}
/** The child that is equal to its parent in every term: same everything, one split fewer (each split uses one up). */
const sameAs = (p: E.Caps): E.Caps => ({ ...p, splits: Math.max(0, p.splits - 1) });

type Pay = { amount: number; payee?: string; purpose?: string; refused: E.Reason[] };
type Row = {
  term: string; relation: "narrower" | "equal" | "wider"; name: string;
  /** Changes to the standard parent. */ parent?: Partial<E.Caps>;
  /** Changes to the child that otherwise equals its parent. */ child: Partial<E.Caps>;
  /** Reasons the rule must give. Empty: a valid narrowing. */ refuse: E.Reason[];
  /** What split() does when that differs from the rule on the literal terms (it carries the owner's approval threshold down). */ split?: "inherits-approval";
  /** The terms the signed sub-envelope must end up with. */ becomes?: Partial<E.Caps>;
  /** The sub-envelope's own expiry has passed: narrowing is fine, the chain is dead. */ expired?: true;
  /** What the holder of the resulting sub-envelope can and cannot ask for. */ then?: Pay[];
};

const ROWS: Row[] = [
  // ---- limit ----------------------------------------------------------------------------------------
  { term: "limit", relation: "narrower", name: "one cent, the smallest envelope there is", child: { limit: 1 }, refuse: [], becomes: { limit: 1, perPayment: 1 }, then: [{ amount: 1, refused: [] }, { amount: 2, refused: ["OVER_PER_PAYMENT"] }] },
  { term: "limit", relation: "narrower", name: "one cent under the parent's", child: { limit: 19999 }, refuse: [], becomes: { limit: 19999, perPayment: 8000 } },
  { term: "limit", relation: "narrower", name: "below the per-payment cap, which comes down with it", child: { limit: 5000 }, refuse: [], becomes: { limit: 5000, perPayment: 5000 }, then: [{ amount: 5000, refused: [] }, { amount: 5001, refused: ["NEEDS_OWNER_APPROVAL", "OVER_PER_PAYMENT"] }] },
  { term: "limit", relation: "equal", name: "the parent's whole limit", child: { limit: 20000 }, refuse: [], becomes: { limit: 20000 } },
  { term: "limit", relation: "wider", name: "one cent over the parent's", child: { limit: 20001 }, refuse: ["WIDENED_LIMIT"] },
  { term: "limit", relation: "wider", name: "the largest amount the system allows", child: { limit: E.MAX_MINOR }, refuse: ["WIDENED_LIMIT"] },
  // ---- per-payment cap ------------------------------------------------------------------------------
  { term: "perPayment", relation: "narrower", name: "one cent per payment", child: { perPayment: 1 }, refuse: [], then: [{ amount: 1, refused: [] }, { amount: 2, refused: ["OVER_PER_PAYMENT"] }] },
  { term: "perPayment", relation: "narrower", name: "one cent under the parent's", child: { perPayment: 7999 }, refuse: [], becomes: { perPayment: 7999 } },
  { term: "perPayment", relation: "equal", name: "the parent's cap", child: { perPayment: 8000 }, refuse: [], then: [{ amount: 5000, refused: [] }, { amount: 8001, refused: ["NEEDS_OWNER_APPROVAL", "OVER_PER_PAYMENT"] }] },
  { term: "perPayment", relation: "wider", name: "one cent over the parent's", child: { perPayment: 8001 }, refuse: ["WIDENED_PER_PAYMENT"] },
  { term: "perPayment", relation: "wider", name: "raised to the whole limit", child: { perPayment: 20000 }, refuse: ["WIDENED_PER_PAYMENT"] },
  { term: "perPayment", relation: "narrower", name: "asked above the sub-envelope's own smaller limit: held to that limit, so not wider", child: { limit: 6000, perPayment: 9000 }, refuse: [], becomes: { limit: 6000, perPayment: 6000 } },
  // ---- payees -----------------------------------------------------------------------------------------
  { term: "payees", relation: "narrower", name: "one of the parent's three", child: { payees: [B] }, refuse: [], then: [{ amount: 100, payee: B, refused: [] }, { amount: 100, payee: A, refused: ["PAYEE_NOT_ALLOWED"] }] },
  { term: "payees", relation: "narrower", name: "nobody at all", child: { payees: [] }, refuse: [], becomes: { payees: [] }, then: [{ amount: 100, payee: A, refused: ["PAYEE_NOT_ALLOWED"] }] },
  { term: "payees", relation: "equal", name: "the same three, written in another order and case", child: { payees: [" C@X.example", B.toUpperCase(), A] }, refuse: [], becomes: { payees: [A, B, C] } },
  { term: "payees", relation: "wider", name: "the same three and one more", child: { payees: [A, B, C, EVIL] }, refuse: ["WIDENED_PAYEES"] },
  { term: "payees", relation: "wider", name: "a different payee instead", child: { payees: [EVIL] }, refuse: ["WIDENED_PAYEES"] },
  { term: "payees", relation: "wider", name: "a look-alike of an allowed payee", child: { payees: ["a@x.exarnple"] }, refuse: ["WIDENED_PAYEES"] },
  { term: "payees", relation: "wider", name: "any payee", child: { payees: null }, refuse: ["WIDENED_PAYEES"] },
  { term: "payees", relation: "narrower", name: "a list, where the parent allowed anyone", parent: { payees: null }, child: { payees: [EVIL] }, refuse: [], then: [{ amount: 100, payee: EVIL, refused: [] }, { amount: 100, payee: A, refused: ["PAYEE_NOT_ALLOWED"] }] },
  { term: "payees", relation: "equal", name: "anyone, where the parent allowed anyone", parent: { payees: null }, child: { payees: null }, refuse: [], then: [{ amount: 100, payee: EVIL, refused: [] }] },
  // ---- purposes ---------------------------------------------------------------------------------------
  { term: "purposes", relation: "narrower", name: "one of the parent's two", child: { purposes: ["design"] }, refuse: [], then: [{ amount: 100, purpose: "design", refused: [] }, { amount: 100, purpose: "translation", refused: ["PURPOSE_NOT_ALLOWED"] }] },
  { term: "purposes", relation: "narrower", name: "no purpose at all", child: { purposes: [] }, refuse: [], becomes: { purposes: [] }, then: [{ amount: 100, purpose: "design", refused: ["PURPOSE_NOT_ALLOWED"] }] },
  { term: "purposes", relation: "equal", name: "the same two, written in another order and case", child: { purposes: ["Translation ", "DESIGN"] }, refuse: [], becomes: { purposes: ["design", "translation"] } },
  { term: "purposes", relation: "wider", name: "the same two and one more", child: { purposes: ["design", "translation", "gift-cards"] }, refuse: ["WIDENED_PURPOSES"] },
  { term: "purposes", relation: "wider", name: "a different purpose instead", child: { purposes: ["gift-cards"] }, refuse: ["WIDENED_PURPOSES"] },
  { term: "purposes", relation: "wider", name: "any purpose", child: { purposes: null }, refuse: ["WIDENED_PURPOSES"] },
  { term: "purposes", relation: "narrower", name: "a list, where the parent allowed any", parent: { purposes: null }, child: { purposes: ["hosting"] }, refuse: [], then: [{ amount: 100, purpose: "hosting", refused: [] }, { amount: 100, purpose: "design", refused: ["PURPOSE_NOT_ALLOWED"] }] },
  { term: "purposes", relation: "equal", name: "any, where the parent allowed any", parent: { purposes: null }, child: { purposes: null }, refuse: [], then: [{ amount: 100, purpose: "whatever", refused: [] }] },
  // ---- expiry -----------------------------------------------------------------------------------------
  { term: "notAfter", relation: "narrower", name: "one millisecond before the parent's", child: { notAfter: at(T - 1) }, refuse: [], becomes: { notAfter: at(T - 1) } },
  { term: "notAfter", relation: "narrower", name: "already past: a valid narrowing of a dead envelope", child: { notAfter: at(Date.now() - 1000) }, refuse: [], expired: true },
  { term: "notAfter", relation: "equal", name: "the same instant, written in another time zone", child: { notAfter: at(T).replace("Z", "+00:00") }, refuse: [], becomes: { notAfter: at(T) } },
  { term: "notAfter", relation: "wider", name: "one millisecond after the parent's", child: { notAfter: at(T + 1) }, refuse: ["EXTENDED_EXPIRY"] },
  { term: "notAfter", relation: "wider", name: "a year after the parent's", child: { notAfter: at(T + 365 * 86400_000) }, refuse: ["EXTENDED_EXPIRY"] },
  // ---- splits left --------------------------------------------------------------------------------------
  { term: "splits", relation: "narrower", name: "none: the sub-envelope cannot be passed on", child: { splits: 0 }, refuse: [], becomes: { splits: 0 } },
  { term: "splits", relation: "equal", name: "one fewer than the parent, the most a split can leave", child: { splits: 2 }, refuse: [], becomes: { splits: 2 } },
  { term: "splits", relation: "wider", name: "as many as the parent has: the split itself is not counted", child: { splits: 3 }, refuse: ["SPLIT_NOT_ALLOWED"] },
  { term: "splits", relation: "wider", name: "more than the parent has", child: { splits: 4 }, refuse: ["SPLIT_NOT_ALLOWED"] },
  { term: "splits", relation: "equal", name: "the parent's last split, leaving none", parent: { splits: 1 }, child: { splits: 0 }, refuse: [], becomes: { splits: 0 } },
  { term: "splits", relation: "wider", name: "the parent's last split, keeping one", parent: { splits: 1 }, child: { splits: 1 }, refuse: ["SPLIT_NOT_ALLOWED"] },
  { term: "splits", relation: "wider", name: "any split of a parent that has none left, however narrow", parent: { splits: 0 }, child: { splits: 0, limit: 1, perPayment: 1, payees: [A], purposes: ["design"] }, refuse: ["SPLIT_NOT_ALLOWED"] },
  // ---- currency -----------------------------------------------------------------------------------------
  { term: "currency", relation: "equal", name: "the parent's, written in lower case", child: { currency: "usd" }, refuse: [], becomes: { currency: "USD" } },
  { term: "currency", relation: "wider", name: "a different currency", child: { currency: "EUR" }, refuse: ["CURRENCY_CHANGED"] },
  { term: "currency", relation: "wider", name: "a different currency with every amount cut to a cent", child: { currency: "JPY", limit: 1, perPayment: 1 }, refuse: ["CURRENCY_CHANGED"] },
  // ---- the owner's approval threshold -----------------------------------------------------------------
  { term: "approveOver", relation: "narrower", name: "lower than the parent's", child: { approveOver: 1000 }, refuse: [], becomes: { approveOver: 1000 }, then: [{ amount: 1000, refused: [] }, { amount: 1001, refused: ["NEEDS_OWNER_APPROVAL"] }] },
  { term: "approveOver", relation: "narrower", name: "zero: every payment needs the owner", child: { approveOver: 0 }, refuse: [], becomes: { approveOver: 0 }, then: [{ amount: 1, refused: ["NEEDS_OWNER_APPROVAL"] }] },
  { term: "approveOver", relation: "equal", name: "the parent's", child: { approveOver: 5000 }, refuse: [], then: [{ amount: 5000, refused: [] }, { amount: 5001, refused: ["NEEDS_OWNER_APPROVAL"] }] },
  { term: "approveOver", relation: "wider", name: "one cent higher than the parent's", child: { approveOver: 5001 }, refuse: ["WIDENED_APPROVAL"] },
  { term: "approveOver", relation: "wider", name: "left out: split carries the parent's down, a hand-signed block without it is refused", child: { approveOver: undefined }, refuse: ["WIDENED_APPROVAL"], split: "inherits-approval", becomes: { approveOver: 5000 } },
  { term: "approveOver", relation: "narrower", name: "added, where the parent had none", parent: { approveOver: undefined }, child: { approveOver: 3000 }, refuse: [], becomes: { approveOver: 3000 }, then: [{ amount: 3001, refused: ["NEEDS_OWNER_APPROVAL"] }] },
  { term: "approveOver", relation: "equal", name: "none, where the parent had none", parent: { approveOver: undefined }, child: {}, refuse: [], then: [{ amount: 8000, refused: [] }] },
];

describe("narrowing, one term at a time", () => {
  it("the table covers every term an envelope has, in every direction it can move", () => {
    const terms = Object.keys(PARENT).sort();
    expect([...new Set(ROWS.map((r) => r.term))].sort()).toEqual(terms);
    for (const t of terms) {
      const rel = new Set(ROWS.filter((r) => r.term === t).map((r) => r.relation));
      expect([...rel].sort(), t).toEqual(t === "currency" ? ["equal", "wider"] : ["equal", "narrower", "wider"]); // a currency has no "narrower"
    }
    expect(new Set(ROWS.map((r) => `${r.term} ${r.name}`)).size).toBe(ROWS.length);
  });

  it.each(ROWS.map((r) => [r.term, r.relation, r.name, r] as const))("%s · %s · %s", async (_t, relation, _n, row) => {
    const parentCaps = E.normalizeCaps({ ...PARENT, ...row.parent });
    const asked: E.Caps = { ...sameAs(parentCaps), ...row.child };
    const literal = E.normalizeCaps(asked);
    // a row marked wider must be refused, and nothing else may be
    expect(row.refuse.length > 0).toBe(relation === "wider");

    // 1. the rule
    expect(codes(E.narrowingViolations(parentCaps, literal))).toEqual([...row.refuse].sort());

    // 2. the honest path
    const root = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, parentCaps);
    const to = { publicKey: sub.publicKey, label: "sub-agent" };
    let signed: E.Envelope | null = null;
    if (row.refuse.length === 0 || row.split === "inherits-approval") {
      signed = await E.split(root, ops, to, asked);
      expect(signed).toHaveLength(2);
      if (row.becomes) expect(signed[1]!.body.caps).toMatchObject(row.becomes);
      const v = await E.verifyChain(signed);
      expect(codes(v.violations)).toEqual(row.expired ? ["EXPIRED"] : []);
      expect(v.ok).toBe(!row.expired);
      // whatever split signed is never wider than the parent
      expect(E.narrowingViolations(parentCaps, signed[1]!.body.caps)).toEqual([]);
    } else {
      await expect(E.split(root, ops, to, asked)).rejects.toThrow(/can only narrow its parent/);
    }

    // 3. the same terms signed by hand
    const forged = await forge(root, ops, sub, asked);
    const fv = await E.verifyChain(forged);
    expect(codes(fv.violations)).toEqual([...row.refuse, ...(row.expired ? ["EXPIRED" as const] : [])].sort());
    expect(fv.violations.every((x) => x.at === forged[1]!.body.id)).toBe(true); // the blame lands on the block that widened
    if (row.refuse.length) {
      const pay = await E.verifySpend(await E.signSpend(forged, sub, { amount: 1, payee: A, purpose: "design" }));
      expect(pay.ok).toBe(false);
      expect(codes(pay.violations)).toEqual(expect.arrayContaining(row.refuse));
    }

    // what the holder of the sub-envelope can then ask for
    for (const p of row.then ?? []) {
      const caps = signed![1]!.body.caps;
      const s = await E.signSpend(signed!, sub, { amount: p.amount, payee: p.payee ?? caps.payees?.[0] ?? A, purpose: p.purpose ?? caps.purposes?.[0] ?? "design" });
      expect(codes((await E.verifySpend(s)).violations), `paying ${p.amount} to ${p.payee ?? "an allowed payee"}`).toEqual([...p.refused].sort());
    }
  });
});

// ---- one term narrowed, another widened ------------------------------------------------------------------
/** One clean narrowing and one clean widening per term, chosen so that neither changes what the other means. */
const MOVES: Array<{ term: string; narrow: Partial<E.Caps> | null; widen: Partial<E.Caps>; code: E.Reason }> = [
  { term: "limit", narrow: { limit: 15000 }, widen: { limit: 20001 }, code: "WIDENED_LIMIT" },
  { term: "perPayment", narrow: { perPayment: 100 }, widen: { perPayment: 8001 }, code: "WIDENED_PER_PAYMENT" },
  { term: "payees", narrow: { payees: [A] }, widen: { payees: [A, EVIL] }, code: "WIDENED_PAYEES" },
  { term: "purposes", narrow: { purposes: ["design"] }, widen: { purposes: null }, code: "WIDENED_PURPOSES" },
  { term: "notAfter", narrow: { notAfter: at(T - 60_000) }, widen: { notAfter: at(T + 60_000) }, code: "EXTENDED_EXPIRY" },
  { term: "splits", narrow: { splits: 0 }, widen: { splits: 3 }, code: "SPLIT_NOT_ALLOWED" },
  { term: "approveOver", narrow: { approveOver: 10 }, widen: { approveOver: 7000 }, code: "WIDENED_APPROVAL" },
  { term: "currency", narrow: null, widen: { currency: "EUR" }, code: "CURRENCY_CHANGED" },
];
const PAIRS = MOVES.flatMap((n) => (n.narrow ? MOVES.filter((w) => w.term !== n.term).map((w) => [n.term, w.term, n, w] as const) : []));

describe("narrowing one term does not buy room in another", () => {
  it.each(PAIRS)("%s narrowed, %s widened: refused for the widening alone", async (_a, _b, n, w) => {
    const asked: E.Caps = { ...sameAs(PARENT), ...n.narrow, ...w.widen };
    expect(codes(E.narrowingViolations(PARENT, E.normalizeCaps(asked)))).toEqual([w.code]);
    const root = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, PARENT);
    await expect(E.split(root, ops, { publicKey: sub.publicKey, label: "sub-agent" }, asked)).rejects.toThrow(/can only narrow its parent/);
    const fv = await E.verifyChain(await forge(root, ops, sub, asked));
    expect(fv.ok).toBe(false);
    expect(codes(fv.violations)).toEqual([w.code]);
    // and the narrowing by itself is fine, so it is the widening that was refused
    expect(E.narrowingViolations(PARENT, E.normalizeCaps({ ...sameAs(PARENT), ...n.narrow }))).toEqual([]);
  });

  it("every term narrowed at once is accepted; every term widened at once is refused once per term", async () => {
    const root = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, PARENT);
    const narrowAll = Object.assign({}, sameAs(PARENT), ...MOVES.map((m) => m.narrow ?? {})) as E.Caps;
    const ok = await E.split(root, ops, { publicKey: sub.publicKey, label: "sub-agent" }, narrowAll);
    expect((await E.verifyChain(ok)).ok).toBe(true);
    const widenAll = Object.assign({}, sameAs(PARENT), ...MOVES.map((m) => m.widen)) as E.Caps;
    const fv = await E.verifyChain(await forge(root, ops, sub, widenAll));
    expect(codes(fv.violations)).toEqual(MOVES.map((m) => m.code).sort());
    expect(new Set(MOVES.map((m) => m.code)).size).toBe(MOVES.length);
  });
});

// ---- depth ---------------------------------------------------------------------------------------------
describe("narrowing down a chain", () => {
  /** Owner → ops → seven more agents, each a little narrower than the one above: the longest chain allowed (8 blocks). */
  async function ladder(rungs = 7) {
    const top: E.Caps = { ...PARENT, splits: rungs, approveOver: undefined };
    let chain = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, top);
    const holders = [ops, ...extra];
    for (let i = 1; i <= rungs; i++) {
      const p = chain[chain.length - 1]!.body.caps;
      chain = await E.split(chain, holders[i - 1]!, { publicKey: holders[i]!.publicKey, label: `agent-${i}` }, { ...p, limit: p.limit - 1000, perPayment: Math.min(p.perPayment, p.limit - 1000), notAfter: at(Date.parse(p.notAfter) - 1000), splits: p.splits - 1 });
    }
    return { chain, holders };
  }

  it.each([1, 2, 3, 4, 5, 6, 7])("a chain %i deep verifies, and its last holder gets exactly the last block's terms", async (depth) => {
    const { chain, holders } = await ladder(depth);
    expect(chain).toHaveLength(depth + 1);
    const v = await E.verifyChain(chain);
    expect(v.ok).toBe(true);
    expect(v.principal).toBe(owner.publicKey);
    expect(v.ids).toEqual(chain.map((b) => b.body.id));
    expect(v.caps).toMatchObject({ limit: 20000 - depth * 1000, splits: 0 });
    // only the last holder can ask; the one just above it cannot use the narrower envelope
    const ask = { amount: 100, payee: A, purpose: "design" };
    expect((await E.verifySpend(await E.signSpend(chain, holders[depth]!, ask))).ok).toBe(true);
    expect(codes((await E.verifySpend(await E.signSpend(chain, holders[depth - 1]!, ask))).violations)).toEqual(["NOT_THE_HOLDER"]);
    // the last block has no splits left, so the chain cannot grow
    await expect(E.split(chain, holders[depth]!, { publicKey: sub.publicKey, label: "one-more" }, { ...v.caps!, limit: 1, perPayment: 1 })).rejects.toThrow(/may not be split/);
  });

  it("a chain of nine blocks is refused whatever it says", async () => {
    const { chain, holders } = await ladder(7);
    const ninth = await forge(chain, holders[7]!, sub, { ...chain[7]!.body.caps, limit: 1, perPayment: 1 });
    expect(ninth).toHaveLength(9);
    expect(codes((await E.verifyChain(ninth)).violations)).toEqual(["MALFORMED"]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("a block at depth %i that takes one cent more than the block above it is caught there, though it is still far under the owner's limit", async (k) => {
    const { chain, holders } = await ladder(7);
    // rebuild from depth k: block k is signed by hand one cent wider than block k-1, everything below narrows honestly from it
    const above = chain[k - 1]!.body.caps;
    let bent = await forge(chain.slice(0, k), holders[k - 1]!, holders[k]!, { ...above, limit: above.limit + 1, splits: above.splits - 1 });
    for (let i = k + 1; i <= 7; i++) {
      const p = bent[bent.length - 1]!.body.caps;
      bent = await E.split(bent, holders[i - 1]!, { publicKey: holders[i]!.publicKey, label: `agent-${i}` }, { ...p, limit: p.limit - 1000, perPayment: Math.min(p.perPayment, p.limit - 1000), splits: p.splits - 1 });
    }
    expect(bent).toHaveLength(8);
    if (k > 1) expect(bent[k]!.body.caps.limit).toBeLessThan(bent[0]!.body.caps.limit); // narrower than the owner's envelope, wider than its parent
    const v = await E.verifyChain(bent);
    expect(v.violations.map((x) => [x.code, x.at])).toEqual([["WIDENED_LIMIT", bent[k]!.body.id]]);
    // everyone below the bent block is refused too: they stand on it
    const pay = await E.verifySpend(await E.signSpend(bent, holders[7]!, { amount: 100, payee: A, purpose: "design" }));
    expect(pay.ok).toBe(false);
    // and the chain cut off just above the bent block is still good
    expect((await E.verifyChain(bent.slice(0, k))).ok).toBe(true);
  });

  /** What an agent gives up when it splits cannot be taken back by the agent below it, even though the owner allowed it. */
  const REGAIN: Array<[string, Partial<E.Caps>, Partial<E.Caps>, E.Reason]> = [
    ["limit", { limit: 6000, perPayment: 6000 }, { limit: 20000, perPayment: 6000 }, "WIDENED_LIMIT"],
    ["perPayment", { perPayment: 500 }, { perPayment: 8000 }, "WIDENED_PER_PAYMENT"],
    ["payees", { payees: [A] }, { payees: [A, B] }, "WIDENED_PAYEES"],
    ["purposes", { purposes: ["design"] }, { purposes: ["design", "translation"] }, "WIDENED_PURPOSES"],
    ["notAfter", { notAfter: at(T - 600_000) }, { notAfter: at(T) }, "EXTENDED_EXPIRY"],
    ["splits", { splits: 1 }, { splits: 1 }, "SPLIT_NOT_ALLOWED"],
    ["approveOver", { approveOver: 100 }, { approveOver: 5000 }, "WIDENED_APPROVAL"],
  ];
  it.each(REGAIN)("%s given up at depth 1 cannot be taken back at depth 2, though the owner's envelope allows it", async (_term, giveUp, takeBack, code) => {
    const root = await E.seal(owner, { publicKey: ops.publicKey, label: "ops-agent" }, PARENT);
    const one = await E.split(root, ops, { publicKey: extra[0]!.publicKey, label: "agent-1" }, { ...sameAs(PARENT), ...giveUp });
    const asked: E.Caps = { ...sameAs(one[1]!.body.caps), ...takeBack };
    // what is asked for is within the owner's envelope…
    expect(E.narrowingViolations(PARENT, E.normalizeCaps({ ...asked, splits: Math.min(asked.splits, PARENT.splits - 1) }))).toEqual([]);
    // …and still refused, because the rule looks at the block directly above
    await expect(E.split(one, extra[0]!, { publicKey: extra[1]!.publicKey, label: "agent-2" }, asked)).rejects.toThrow(/can only narrow its parent/);
    const fv = await E.verifyChain(await forge(one, extra[0]!, extra[1]!, asked));
    expect(fv.violations.map((x) => x.code)).toEqual([code]);
  });

  it("splitting needs the holder's key at every level: the owner cannot split the agent's envelope, nor can the agent above", async () => {
    const { chain, holders } = await ladder(3);
    const two = chain.slice(0, 3); // held by holders[2], with one split left
    const tiny = { ...two[2]!.body.caps, limit: 1, perPayment: 1, splits: 0 };
    for (const notHolder of [owner, holders[0]!, holders[1]!, holders[3]!]) await expect(E.split(two, notHolder, { publicKey: sub.publicKey, label: "x" }, tiny)).rejects.toThrow(/Only the holder/);
    // signed by hand by the agent above the holder: the signature is real, the signer is wrong
    const fv = await E.verifyChain(await forge(two, holders[1]!, sub, tiny));
    expect(codes(fv.violations)).toEqual(["WRONG_ISSUER"]);
  });
});
