/**
 * Randomized runs against the money rules.
 *
 * Each seed builds two envelope trees over a handful of accounts and then makes 40 to 80 moves chosen
 * by a small seeded generator: payments inside and outside the limits, promises kept, released, expired
 * and accepted, splits (honest and forged wider), revocations by people who may and may not, refunds,
 * recalls, transfers between balances, withdrawals, freezes, cards and charges, replays, closing.
 *
 * Beside the gateway runs a second, much simpler set of books kept by this file (the "model"): plain
 * arithmetic on what should have happened. After EVERY move:
 *   - the gateway's verdict must be the one the model predicts, reason for reason;
 *   - everything the gateway recorded (budgets at every level, what was captured and refunded per hold,
 *     every balance, every card, the state of every payment, how many times PayPal was asked to move
 *     money) must equal the model exactly, so a refused move is seen to have changed nothing;
 *   - and the rules that need no model must hold: no envelope over its limit, no level holding less than
 *     the levels below it, no hold captured past its amount at PayPal, no negative balance, every balance
 *     equal to its ledger, the books' own checks, PayPal's statement matching record for record, and
 *     what the records leave at PayPal equal to the balance PayPal reports.
 *
 * The amounts and choices come from the seed (it is in the test's name and in any failure). Keys and
 * ids are fresh each run. More seeds:  INVARIANT_SEEDS=101,102,103 npx vitest run tests/invariants.test.ts
 */
import { describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;
const SEEDS = (process.env.INVARIANT_SEEDS ?? "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);

/** mulberry32: small, fast, and the same numbers for the same seed everywhere. */
function generator(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo: number, hi: number) => (hi <= lo ? lo : lo + Math.floor(next() * (hi - lo + 1)));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const chance = (p: number) => next() < p;
  /** A non-empty subset, in the order given. */
  const some = <T>(xs: readonly T[], atLeast = 1): T[] => { const out = xs.filter(() => chance(0.55)); while (out.length < Math.min(atLeast, xs.length)) { const x = pick(xs); if (!out.includes(x)) out.push(x); } return xs.filter((x) => out.includes(x)); };
  return { next, int, pick, chance, some };
}

const PURPOSES = ["design", "translation", "hosting", "research"] as const;
const tally = new Map<string, { accepted: number; refused: number }>();
const count = (op: string, accepted: boolean) => { const t = tally.get(op) ?? { accepted: 0, refused: 0 }; t[accepted ? "accepted" : "refused"] += 1; tally.set(op, t); };

d("randomized runs against the money rules (simulated PayPal)", async () => {
  if (!enabled) return;
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, ne, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const K = await import("../lib/gateway/books");
  const S = await import("../lib/gateway/settlement");
  const sim = await import("../lib/paypal/emulator");
  const { flushJournal } = await import("../lib/paypal/journal");
  const { resetSimMemory } = await import("../lib/sim/store");

  // ---- the model: what should be true, kept by plain arithmetic ------------------------------------
  type MAcct = { key: E.KeyPair; owner: E.KeyPair; label: string; hold: boolean; settleTo: string; perPayment: number | null; balance: number; frozen: boolean; payee: string };
  type MRoot = { id: string; owner: E.KeyPair; limit: number; authId: string; captured: number; refunded: number; closed: boolean; released: number | null; nodes: MNode[] };
  type MNode = { id: string; root: MRoot; parent: MNode | null; chain: E.Envelope; key: E.KeyPair; caps: E.Caps; payeeIx: number[] | null; purposeIx: number[] | null; spent: number; reserved: number; revoked: boolean };
  type PayState = "PROMISED" | "LAPSED" | "PAID/held" | "PAID" | "UNCLAIMED" | "FAILED/refunded";
  type MPay = { id: string; node: MNode; amount: number; payeeIx: number; state: PayState; promise: boolean; releaseBy: E.KeyPair | null; signed: E.SignedSpend | null };
  type MCard = { id: string; holder: MAcct; merchant: MAcct; perCharge: number; maxCharges: number; every: number; charges: number; charged: number; cancelled: boolean };
  type Payee = { text: string; kind: "hold" | "settle" | "email" | "unclaimed" | "ghost"; acct: MAcct | null };

  async function run(seed: number) {
    const R = generator(seed);
    const steps = R.int(40, 80);
    const fees = seed % 2 === 0; // every other seed, the simulated PayPal charges the fees the sandbox charged
    const db = getDb();

    await flushJournal();
    resetSimMemory();
    G.forgetGatewayKey();
    K.forgetBalance();
    await db.execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards, paypal_calls, paypal_events restart identity cascade`);
    if (fees) await sim.simChargeFees(true);

    // ---- the cast --------------------------------------------------------------------------------
    const key = () => E.generateKeyPair();
    const accts: MAcct[] = [];
    for (const [label, hold, perPayment] of [["writer-agent", true, null], ["translator-agent", true, R.int(400, 3000)], ["proofreader-agent", true, null], ["studio-agent", false, null]] as const) {
      const k = await key(), owner = await key();
      const settleTo = `${label.split("-")[0]}-owner@example.com`;
      await G.openAccount(await E.signAccount(k, owner, { label, ownerName: `Owner of ${label}`, settleTo, ...(hold ? { mode: "hold" as const } : {}), ...(perPayment ? { perPayment } : {}) }));
      accts.push({ key: k, owner, label, hold, settleTo, perPayment, balance: 0, frozen: false, payee: E.accountPayee(k.publicKey) });
    }
    const ghost = await key(), stranger = await key();
    const POOL: Payee[] = [
      ...accts.map((a): Payee => ({ text: a.payee, kind: a.hold ? "hold" : "settle", acct: a })),
      { text: "designer@example.com", kind: "email", acct: null },
      { text: "unclaimed-freelancer@example.com", kind: "unclaimed", acct: null },
      { text: E.accountPayee(ghost.publicKey), kind: "ghost", acct: null }, // an account number nobody has opened
    ];
    const allIx = POOL.map((_, i) => i);

    const roots: MRoot[] = [];
    const pays: MPay[] = [];
    const cards: MCard[] = [];
    const moved = { captures: 0, payouts: 0, refunds: 0, cancels: 0 };
    const sent: Array<{ what: "spend"; signed: E.SignedSpend } | { what: "transfer"; signed: E.SignedTransfer }> = [];
    const log: string[] = [];
    const usd = (n: number) => `$${(n / 100).toFixed(2)}`;

    for (let i = 0; i < 2; i++) {
      const owner = await key(), holder = await key();
      const limit = R.int(3000, 60000);
      const perPayment = R.int(500, limit);
      const payeeIx = R.chance(0.2) ? null : R.some(allIx, 3);
      const purposeIx = R.chance(0.25) ? null : R.some([0, 1, 2, 3], 2);
      const caps: E.Caps = {
        currency: "USD", limit, perPayment, payees: payeeIx ? payeeIx.map((x) => POOL[x]!.text) : null, purposes: purposeIx ? purposeIx.map((x) => PURPOSES[x]!) : null,
        notAfter: new Date(Date.now() + 3600_000).toISOString(), splits: R.int(0, 3), ...(R.chance(0.3) ? { approveOver: R.int(300, perPayment) } : {}),
      };
      const chain = await E.seal(owner, { publicKey: holder.publicKey, label: `lead-agent-${i + 1}` }, caps);
      const row = await G.registerRoot({ chain, principalName: `Owner ${i + 1}`, title: `Budget ${i + 1}` });
      const root: MRoot = { id: row.id, owner, limit, authId: row.authorizationId!, captured: 0, refunded: 0, closed: false, released: null, nodes: [] };
      root.nodes.push({ id: row.id, root, parent: null, chain, key: holder, caps: chain[0]!.body.caps, payeeIx, purposeIx, spent: 0, reserved: 0, revoked: false });
      roots.push(root);
    }
    const nodes = () => roots.flatMap((r) => r.nodes);
    const line = (n: MNode): MNode[] => (n.parent ? [...line(n.parent), n] : [n]);
    const alive = (n: MNode) => !n.root.closed && line(n).every((b) => !b.revoked);
    const room = (n: MNode) => Math.min(...line(n).map((b) => b.caps.limit - b.spent - b.reserved));

    // ---- what the model expects ------------------------------------------------------------------
    /** The reasons the gateway must give for a payment or a promise from this node. Empty: it must go through. */
    function verdict(n: MNode, amount: number, payeeIx: number, purposeIx: number, promise: { releaseBy: string | null } | null): E.Reason[] {
      const c = n.caps, why = new Set<E.Reason>();
      if (amount > c.perPayment) why.add("OVER_PER_PAYMENT");
      if (n.payeeIx !== null && !n.payeeIx.includes(payeeIx)) why.add("PAYEE_NOT_ALLOWED");
      if (n.purposeIx !== null && !n.purposeIx.includes(purposeIx)) why.add("PURPOSE_NOT_ALLOWED");
      if (c.approveOver !== undefined && amount > c.approveOver && !(promise && promise.releaseBy === n.root.owner.publicKey)) why.add("NEEDS_OWNER_APPROVAL");
      const withinTerms = why.size === 0;
      if (POOL[payeeIx]!.kind === "ghost") why.add("PAYEE_ACCOUNT_UNKNOWN");
      if (n.root.closed) why.add("REVOKED");
      if (withinTerms && why.size === 0) {
        const chain = line(n);
        chain.forEach((b, i) => {
          if (b.revoked) why.add("REVOKED");
          if (amount > b.caps.limit - b.spent - b.reserved) why.add(i === chain.length - 1 ? "OVER_ENVELOPE_LIMIT" : "OVER_ANCESTOR_LIMIT");
        });
      }
      return [...why].sort();
    }
    /** The owner's rules on money leaving a balance. */
    function leaving(a: MAcct, amount: number, capped: boolean): E.Reason[] {
      const why: E.Reason[] = [];
      if (a.frozen) why.push("ACCOUNT_FROZEN");
      if (capped && a.perPayment !== null && amount > a.perPayment) why.push("OVER_ACCOUNT_LIMIT");
      if (amount > a.balance) why.push("INSUFFICIENT_BALANCE");
      return why.sort();
    }
    /** Money captured from the hold reaches the payee: a balance here, or a PayPal payout. */
    function settleInModel(p: MPay) {
      const to = POOL[p.payeeIx]!;
      for (const b of line(p.node)) b.spent += p.amount;
      p.node.root.captured += p.amount;
      moved.captures += 1;
      if (to.kind === "hold") { to.acct!.balance += p.amount; p.state = "PAID/held"; }
      else { moved.payouts += 1; p.state = to.kind === "unclaimed" ? "UNCLAIMED" : "PAID"; }
    }
    const lapseInModel = (p: MPay) => { if (p.state !== "PROMISED") return; for (const b of line(p.node)) b.reserved -= p.amount; p.state = "LAPSED"; };
    const codes = (v: Array<{ code: E.Reason }>) => [...new Set(v.map((x) => x.code))].sort();
    const refusal = (p: Promise<unknown>) => p.then(() => null, (e: { status?: number }) => e.status ?? 500);

    // ---- what the gateway recorded, and the rules that need no model --------------------------------
    async function world() {
      const [bl, rt, ac, cd, sp, led, calls] = await Promise.all([
        db.select().from(schema.blocks), db.select().from(schema.roots), db.select().from(schema.accounts), db.select().from(schema.cards),
        db.select().from(schema.spends).where(ne(schema.spends.status, "DENIED")),
        db.select({ agent: schema.ledger.agent, total: sql<number>`coalesce(sum(${schema.ledger.deltaMinor}), 0)::int` }).from(schema.ledger).groupBy(schema.ledger.agent),
        sim.simCalls(),
      ]);
      const byKey = <T,>(xs: T[], k: (x: T) => string, v: (x: T) => unknown) => Object.fromEntries(xs.map((x) => [k(x), v(x)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
      // -- rules that need no model --
      const kids = new Map<string, typeof bl>();
      for (const b of bl) if (b.parentId) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b]);
      for (const b of bl) {
        expect(b.spentMinor, `spent of ${b.holderLabel}`).toBeGreaterThanOrEqual(0);
        expect(b.reservedMinor, `set aside under ${b.holderLabel}`).toBeGreaterThanOrEqual(0);
        expect(b.spentMinor + b.reservedMinor, `${b.holderLabel} is over its limit`).toBeLessThanOrEqual(b.caps.limit);
        const below = kids.get(b.id) ?? [];
        expect(below.reduce((n, k) => n + k.spentMinor, 0), `the envelopes under ${b.holderLabel} spent more than it did`).toBeLessThanOrEqual(b.spentMinor);
        expect(below.reduce((n, k) => n + k.reservedMinor, 0), `the envelopes under ${b.holderLabel} set aside more than it did`).toBeLessThanOrEqual(b.reservedMinor);
      }
      for (const r of rt) {
        const top = bl.find((b) => b.id === r.id)!;
        expect(r.capturedMinor).toBeGreaterThanOrEqual(0);
        expect(r.refundedMinor).toBeGreaterThanOrEqual(0);
        // every cent the top envelope counts as spent was captured from the hold, and is either still charged to the owner or back with them
        expect(r.capturedMinor + r.refundedMinor).toBe(top.spentMinor);
        expect(r.capturedMinor + r.refundedMinor).toBeLessThanOrEqual(r.limitMinor);
        const hold = (await sim.simAuthorization(r.authorizationId!))!;
        const holdMinor = Math.round(Number(hold.amount.value) * 100);
        expect(holdMinor).toBe(r.limitMinor);
        expect(hold.captured, "PayPal captured a different total than the gateway recorded").toBe(r.capturedMinor + r.refundedMinor);
        expect(hold.captured).toBeLessThanOrEqual(holdMinor);
        if (r.status === "CLOSED") {
          expect(top.reservedMinor).toBe(0);
          expect(r.capturedMinor + r.refundedMinor + r.releasedMinor!).toBe(r.limitMinor);
          expect(hold.status).toBe(hold.captured === holdMinor ? "CAPTURED" : "VOIDED");
        } else expect(hold.status).toBe(hold.captured === 0 ? "CREATED" : hold.captured === holdMinor ? "CAPTURED" : "PARTIALLY_CAPTURED");
      }
      const ledgerOf = new Map(led.map((l) => [l.agent, l.total]));
      for (const a of ac) {
        expect(a.balanceMinor, `${a.label}'s balance`).toBeGreaterThanOrEqual(0);
        expect(ledgerOf.get(a.agent) ?? 0, `${a.label}'s balance against its ledger`).toBe(a.balanceMinor);
      }
      for (const c of cd) { expect(c.charges).toBeLessThanOrEqual(c.maxCharges); expect(c.chargedMinor).toBeLessThanOrEqual(c.perChargeMinor * c.maxCharges); }
      const books = await B.position();
      expect(books.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
      // PayPal's side: its statement lists every record at the recorded amount, and what those records leave is the balance it reports
      const st = await K.statement();
      expect({ differs: st.differs, notListedYet: st.notListedYet, ok: st.ok }).toEqual({ differs: 0, notListedYet: 0, ok: true });
      K.forgetBalance();
      const res = await K.reserves();
      // (PayPal never reports an available balance below zero: when its fees outrun what the account holds, it reports nothing left)
      expect(res.paypal!.availableMinor, "what the records leave at PayPal against the balance PayPal reports").toBe(Math.max(0, st.position.netMinor));
      const owed = ac.reduce((n, a) => n + a.balanceMinor, 0);
      expect(res.owed.totalMinor).toBe(owed);
      // without fees every cent at PayPal is owed to an account; with fees, the records leave exactly the fees less than is owed
      expect(st.position.netMinor).toBe(owed - st.position.feesMinor);
      expect(st.position.feesMinor).toBeGreaterThanOrEqual(0);
      if (!fees) { expect(st.position.feesMinor).toBe(0); expect(res.paypal!.availableMinor).toBe(owed); expect(res.covered).toBe(true); expect(res.surplusMinor).toBe(0); }

      return {
        blocks: byKey(bl, (b) => b.id, (b) => ({ spent: b.spentMinor, reserved: b.reservedMinor, revoked: Boolean(b.revokedAt) })),
        roots: byKey(rt, (r) => r.id, (r) => ({ captured: r.capturedMinor, refunded: r.refundedMinor, closed: r.status === "CLOSED", released: r.releasedMinor })),
        accounts: byKey(ac, (a) => a.agent, (a) => ({ balance: a.balanceMinor, frozen: Boolean(a.frozenAt) })),
        cards: byKey(cd, (c) => c.id, (c) => ({ charges: c.charges, charged: c.chargedMinor, cancelled: Boolean(c.cancelledAt) })),
        payments: byKey(sp, (s) => s.id, (s) => `${s.status}${s.refundId ? "/refunded" : s.payoutStatus === G.HELD ? "/held" : ""}`),
        paypalMoved: {
          captures: calls.filter((c) => c.endsWith("/capture")).length, payouts: calls.filter((c) => c.endsWith("/payouts")).length,
          refunds: calls.filter((c) => c.endsWith("/refund")).length, cancels: calls.filter((c) => c.endsWith("/cancel")).length,
        },
      };
    }
    function model() {
      const byKey = <T,>(xs: T[], k: (x: T) => string, v: (x: T) => unknown) => Object.fromEntries(xs.map((x) => [k(x), v(x)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
      return {
        blocks: byKey(nodes(), (n) => n.id, (n) => ({ spent: n.spent, reserved: n.reserved, revoked: n.revoked })),
        roots: byKey(roots, (r) => r.id, (r) => ({ captured: r.captured, refunded: r.refunded, closed: r.closed, released: r.released })),
        accounts: byKey(accts, (a) => a.key.publicKey, (a) => ({ balance: a.balance, frozen: a.frozen })),
        cards: byKey(cards, (c) => c.id, (c) => ({ charges: c.charges, charged: c.charged, cancelled: c.cancelled })),
        payments: byKey(pays, (p) => p.id, (p) => p.state),
        paypalMoved: { ...moved },
      };
    }

    // ---- the moves ---------------------------------------------------------------------------------
    /** An amount that is usually within reach, sometimes exactly on an edge, sometimes well over. */
    function amountFor(n: MNode): number {
      const cap = n.caps.perPayment, left = Math.max(0, room(n)), edge = Math.min(cap, left);
      const roll = R.next();
      if (roll < 0.55) return R.int(1, Math.max(1, Math.min(edge, 4000)));
      if (roll < 0.7) return Math.max(1, edge + R.pick([0, 0, 1]));       // the last cent, or one past it
      if (roll < 0.8 && n.caps.approveOver !== undefined) return Math.max(1, n.caps.approveOver + R.pick([0, 1]));
      return R.int(1, Math.max(2, Math.round(cap * 1.4)));
    }
    const payeeFor = (n: MNode) => (n.payeeIx && R.chance(0.8) ? R.pick(n.payeeIx) : R.pick(allIx));
    const purposeFor = (n: MNode) => (n.purposeIx && R.chance(0.85) ? R.pick(n.purposeIx) : R.int(0, 3));
    const someNode = () => { const live = nodes().filter(alive); return live.length && R.chance(0.85) ? R.pick(live) : R.pick(nodes()); };

    async function pay(): Promise<string> {
      const n = someNode(), amount = amountFor(n), px = payeeFor(n), ux = purposeFor(n);
      const want = verdict(n, amount, px, ux, null);
      const signed = await E.signSpend(n.chain, n.key, { amount, payee: POOL[px]!.text, purpose: PURPOSES[ux]! });
      const r = await G.spend(signed);
      sent.push({ what: "spend", signed });
      if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(want); }
      else {
        const p: MPay = { id: r.spend!.id, node: n, amount, payeeIx: px, state: "PAID", promise: false, releaseBy: null, signed };
        settleInModel(p); pays.push(p);
        expect(r.status).toBe(p.state.split("/")[0]);
        expect(r.duplicate).toBe(false);
        expect(r.receipt && (await G.verifyReceipt(r.receipt))).toBe(true);
      }
      count("payment", want.length === 0);
      return `${n.chain.at(-1)!.body.holderLabel} pays ${usd(amount)} to ${POOL[px]!.kind} for ${PURPOSES[ux]} → ${want.join(", ") || "paid"}`;
    }
    async function setAside(): Promise<string> {
      const n = someNode(), amount = amountFor(n), px = payeeFor(n), ux = purposeFor(n);
      const checker = R.chance(0.15) ? stranger : null;
      const over = n.caps.approveOver !== undefined && amount > n.caps.approveOver;
      const releaseBy = over && R.chance(0.7) ? n.root.owner : checker ?? (R.chance(0.2) ? n.root.owner : null);
      const want = verdict(n, amount, px, ux, { releaseBy: releaseBy?.publicKey ?? null });
      const r = await G.promise(await E.signPromise(n.chain, n.key, { amount, payee: POOL[px]!.text, purpose: PURPOSES[ux]!, ttl: R.int(60, 3600), ...(releaseBy ? { releaseBy: releaseBy.publicKey } : {}) }));
      if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(want); }
      else {
        expect(r.status).toBe("PROMISED");
        expect(r.note && (await G.verifyPromiseNote(r.note))).toBe(true);
        for (const b of line(n)) b.reserved += amount;
        pays.push({ id: r.spend!.id, node: n, amount, payeeIx: px, state: "PROMISED", promise: true, releaseBy, signed: null });
      }
      count("promise", want.length === 0);
      return `${n.chain.at(-1)!.body.holderLabel} sets ${usd(amount)} aside for ${POOL[px]!.kind}${releaseBy ? " (released by a named key)" : ""} → ${want.join(", ") || "set aside"}`;
    }
    const promises = (open: boolean) => pays.filter((p) => p.promise && (!open || p.state === "PROMISED"));
    async function keep(): Promise<string | null> {
      const all = promises(false); if (!all.length) return null;
      const open = promises(true);
      const p = open.length && R.chance(0.85) ? R.pick(open) : R.pick(all);
      const action = R.chance(0.7) ? "pay" : "release";
      if (R.chance(0.1)) { // someone who did not make it
        expect(await refusal(G.keep(await E.signKeep(R.pick([stranger, p.node.root.owner, accts[0]!.key]), p.id, action)))).toBe(403);
        count("keep a promise", false); return `a key that did not make promise ${p.id} tries to ${action} it → refused`;
      }
      const over = p.node.caps.approveOver !== undefined && p.amount > p.node.caps.approveOver;
      if (action === "pay" && over) {
        expect(await refusal(G.keep(await E.signKeep(p.node.key, p.id, "pay")))).toBe(403);
        count("keep a promise", false); return `the agent tries to pay its own ${usd(p.amount)} promise, over the owner's threshold → refused`;
      }
      const was = p.state;
      const r = await G.keep(await E.signKeep(p.node.key, p.id, action));
      if (was === "PROMISED") { if (action === "pay") { for (const b of line(p.node)) b.reserved -= p.amount; settleInModel(p); } else lapseInModel(p); }
      expect(r.status).toBe(p.state.split("/")[0]);
      expect(r.duplicate).toBe(was !== "PROMISED");
      count("keep a promise", was === "PROMISED");
      return `the agent ${action === "pay" ? "pays" : "releases"} its ${usd(p.amount)} promise (${was}) → ${p.state}`;
    }
    async function accept(): Promise<string | null> {
      const named = pays.filter((p) => p.promise && p.releaseBy); if (!named.length) return null;
      const open = named.filter((p) => p.state === "PROMISED");
      const p = open.length && R.chance(0.85) ? R.pick(open) : R.pick(named);
      if (R.chance(0.15)) {
        expect(await refusal(G.accept(await E.signAccept(p.node.key, p.id)))).toBe(403); // the maker is not the key it named
        count("accept a promise", false); return `the maker tries to accept its own promise ${p.id} → refused`;
      }
      const decline = R.chance(0.2), was = p.state;
      const r = await G.accept(await E.signAccept(p.releaseBy!, p.id, decline ? { decline: true } : { work: await E.sha256(`work for ${p.id}`), note: "checked" }));
      if (was === "PROMISED") { if (decline) lapseInModel(p); else { for (const b of line(p.node)) b.reserved -= p.amount; settleInModel(p); } }
      expect(r.status).toBe(p.state.split("/")[0]);
      count("accept a promise", was === "PROMISED");
      return `the named key ${decline ? "declines" : "accepts"} the ${usd(p.amount)} promise (${was}) → ${p.state}`;
    }
    async function expire(): Promise<string | null> {
      const open = promises(true); if (!open.length) return null;
      const p = R.pick(open);
      await db.update(schema.spends).set({ promiseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.spends.id, p.id)); // its time runs out
      await G.sweepExpired(p.node.root.id);
      lapseInModel(p);
      count("a promise runs out", true);
      return `the ${usd(p.amount)} promise runs out → the money is free again at every level`;
    }
    async function split(): Promise<string | null> {
      const can = nodes().filter((n) => n.caps.splits > 0 && n.root.nodes.length < 7); if (!can.length) return null;
      const par = R.pick(can), c = par.caps;
      const limit = R.chance(0.3) ? c.limit : R.int(Math.max(1, Math.round(c.limit * 0.2)), c.limit);
      const payeeIx = par.payeeIx ? R.some(par.payeeIx, 1) : R.chance(0.5) ? null : R.some(allIx, 2);
      const purposeIx = par.purposeIx ? R.some(par.purposeIx, 1) : R.chance(0.5) ? null : R.some([0, 1, 2, 3], 1);
      const perPayment = R.int(1, Math.min(c.perPayment, limit));
      const approveOver = c.approveOver !== undefined ? (R.chance(0.5) ? undefined : R.int(0, c.approveOver)) : R.chance(0.2) ? R.int(100, perPayment) : undefined;
      const k = await key(), label = `agent-${par.root.nodes.length}-of-${roots.indexOf(par.root) + 1}`;
      const chain = await E.split(par.chain, par.key, { publicKey: k.publicKey, label }, {
        currency: "USD", limit, perPayment, payees: payeeIx ? payeeIx.map((x) => POOL[x]!.text) : null, purposes: purposeIx ? purposeIx.map((x) => PURPOSES[x]!) : null,
        notAfter: new Date(Date.parse(c.notAfter) - R.int(0, 300) * 1000).toISOString(), splits: R.int(0, c.splits - 1), ...(approveOver !== undefined ? { approveOver } : {}),
      });
      await G.announce(chain);
      par.root.nodes.push({ id: chain.at(-1)!.body.id, root: par.root, parent: par, chain, key: k, caps: chain.at(-1)!.body.caps, payeeIx, purposeIx, spent: 0, reserved: 0, revoked: false });
      count("split", true);
      return `${par.chain.at(-1)!.body.holderLabel} splits off ${label} with ${usd(limit)} (${usd(perPayment)} a payment)`;
    }
    /** An agent signs a wider sub-envelope by hand, or a thief uses a copied one. Nothing may move and nothing may be recorded as authority. */
    async function cheat(): Promise<string> {
      const n = someNode(), c = n.caps;
      const rogue = await key();
      const px = n.payeeIx ? R.pick(n.payeeIx) : 4, ux = n.purposeIx ? R.pick(n.purposeIx) : 0;
      if (R.chance(0.25)) { // a copied envelope, signed with a key it was not given to
        const r = await G.spend(await E.signSpend(n.chain, rogue, { amount: 1, payee: POOL[px]!.text, purpose: PURPOSES[ux]! }));
        expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toContain("NOT_THE_HOLDER");
        count("copied envelope", false); return `a thief presents ${n.chain.at(-1)!.body.holderLabel}'s envelope with its own key → refused`;
      }
      const wider: Array<[string, Partial<E.Caps>, E.Reason, Partial<{ amount: number; payee: string; purpose: string }>]> = [
        ["limit", { limit: c.limit + R.int(1, 5000) }, "WIDENED_LIMIT", {}],
        ["per-payment cap", { limit: c.limit + 1, perPayment: c.perPayment + 1 }, "WIDENED_PER_PAYMENT", { amount: c.perPayment + 1 }],
        ["expiry", { notAfter: new Date(Date.parse(c.notAfter) + 60_000).toISOString() }, "EXTENDED_EXPIRY", {}],
        ["splits", { splits: c.splits }, "SPLIT_NOT_ALLOWED", {}],
        ...(c.payees ? [["payees", { payees: null }, "WIDENED_PAYEES", { payee: "attacker@evil.example" }] as [string, Partial<E.Caps>, E.Reason, { payee: string }]] : []),
        ...(c.purposes ? [["purposes", { purposes: [...c.purposes, "gift-cards"] }, "WIDENED_PURPOSES", { purpose: "gift-cards" }] as [string, Partial<E.Caps>, E.Reason, { purpose: string }]] : []),
        ...(c.approveOver !== undefined ? [["approval threshold", { approveOver: c.approveOver + 1000 }, "WIDENED_APPROVAL", {}] as [string, Partial<E.Caps>, E.Reason, object]] : []),
      ];
      const [term, change, code, ask] = R.pick(wider);
      const last = n.chain.at(-1)!;
      const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: n.chain[0]!.body.id, parent: await E.blockHash(last), issuer: n.key.publicKey, holder: rogue.publicKey, holderLabel: "helper", caps: E.normalizeCaps({ ...c, splits: Math.max(0, c.splits - 1), ...change }), issuedAt: new Date().toISOString() };
      const forged: E.Envelope = [...n.chain, { body, sig: await E.signDetached(n.key.privateKey, E.BLOCK_VERSION, body) }];
      const r = await G.spend(await E.signSpend(forged, rogue, { amount: 1, payee: POOL[px]!.text, purpose: PURPOSES[ux]!, ...ask }));
      expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toContain(code);
      expect(await refusal(G.announce(forged))).toBe(422); // nor will the gateway take it on record
      count("forged wider envelope", false);
      return `${last.body.holderLabel} signs itself a wider ${term} and pays with it → ${code}`;
    }
    async function revoke(): Promise<string | null> {
      const subs = nodes().filter((n) => n.parent); if (!subs.length) return null;
      const n = R.pick(subs);
      const may = [n.root.owner, ...line(n).map((b) => b.key)];
      const mayNot = [stranger, ...nodes().filter((x) => x !== n && !line(n).includes(x)).map((x) => x.key)];
      if (R.chance(0.25)) {
        expect(await refusal(G.revoke(await E.signRevoke(R.pick(mayNot), n.id)))).toBe(403);
        count("revoke", false); return `a key with no say over ${n.chain.at(-1)!.body.holderLabel} tries to revoke it → refused`;
      }
      await G.revoke(await E.signRevoke(R.pick(may), n.id));
      n.revoked = true;
      for (const p of pays) if (line(p.node).includes(n)) lapseInModel(p); // money set aside under it goes back up
      count("revoke", true);
      return `${n.chain.at(-1)!.body.holderLabel}'s envelope is revoked`;
    }
    async function close(root: MRoot): Promise<string> {
      await G.revoke(await E.signRevoke(R.chance(0.8) ? root.owner : root.nodes[0]!.key, root.id));
      if (!root.closed) {
        for (const p of pays) if (p.node.root === root) lapseInModel(p);
        root.closed = true; root.nodes[0]!.revoked = true;
        root.released = root.limit - root.captured - root.refunded;
      }
      count("close", true);
      return `envelope ${roots.indexOf(root) + 1} is closed: ${usd(root.released!)} released`;
    }
    async function giveBack(): Promise<string | null> {
      const got = pays.filter((p) => POOL[p.payeeIx]!.acct && ["PAID/held", "PAID", "FAILED/refunded"].includes(p.state)); if (!got.length) return null;
      const held = got.filter((p) => p.state === "PAID/held");
      const p = held.length && R.chance(0.8) ? R.pick(held) : R.pick(got);
      const a = POOL[p.payeeIx]!.acct!;
      if (R.chance(0.15)) {
        const r = await B.refund(await E.signRefund(R.pick([stranger, p.node.key, accts.find((x) => x !== a)!.key]), p.id));
        expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(["NOT_THE_HOLDER"]);
        count("refund by the payee", false); return `a key that was not paid tries to refund ${p.id} → refused`;
      }
      const r = await B.refund(await E.signRefund(a.key, p.id, "returned"));
      if (p.state === "FAILED/refunded") { expect(r.status).toBe("REFUNDED"); count("refund by the payee", false); return `${a.label} refunds a payment it already refunded → nothing more happens`; }
      if (p.state === "PAID") { expect(codes(r.reasons)).toEqual(["NOT_REFUNDABLE"]); count("refund by the payee", false); return `${a.label} tries to refund money PayPal already paid out → refused`; }
      const want: E.Reason[] = [...(a.frozen ? ["ACCOUNT_FROZEN" as const] : []), ...(p.amount > a.balance ? ["INSUFFICIENT_BALANCE" as const] : [])].sort();
      if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(want); }
      else {
        expect(r.status).toBe("REFUNDED"); expect(r.refundId).toBeTruthy();
        a.balance -= p.amount; p.node.root.captured -= p.amount; p.node.root.refunded += p.amount; p.state = "FAILED/refunded"; moved.refunds += 1;
        expect(r.balanceMinor).toBe(a.balance);
      }
      count("refund by the payee", want.length === 0);
      return `${a.label} gives back ${usd(p.amount)} → ${want.join(", ") || "refunded to the owner"}`;
    }
    async function recall(): Promise<string | null> {
      const out = pays.filter((p) => ["UNCLAIMED", "PAID"].includes(p.state) || (p.state === "FAILED/refunded" && POOL[p.payeeIx]!.kind === "unclaimed")); if (!out.length) return null;
      const waiting = out.filter((p) => p.state === "UNCLAIMED");
      const p = waiting.length && R.chance(0.8) ? R.pick(waiting) : R.pick(out);
      const owner = p.node.root.owner;
      if (R.chance(0.15)) {
        const thief = R.pick([stranger, p.node.key]);
        expect(await refusal(S.recall(p.id, await E.signRead(thief, "recall", p.id)))).toBe(401);
        count("recall", false); return `someone who is not the owner tries to recall ${p.id} → refused`;
      }
      if (p.state === "PAID") {
        expect(await refusal(S.recall(p.id, await E.signRead(owner, "recall", p.id)))).toBe(409);
        count("recall", false); return `the owner tries to recall a payment PayPal has delivered → refused`;
      }
      const was = p.state;
      const r = await S.recall(p.id, await E.signRead(owner, "recall", p.id));
      expect(r.status).toBe("FAILED"); expect(r.refundId).toBeTruthy();
      if (was === "UNCLAIMED") { p.node.root.captured -= p.amount; p.node.root.refunded += p.amount; p.state = "FAILED/refunded"; moved.cancels += 1; moved.refunds += 1; }
      count("recall", was === "UNCLAIMED");
      return `the owner recalls the unclaimed ${usd(p.amount)} payout (${was}) → cancelled at PayPal and refunded`;
    }
    async function transfer(): Promise<string> {
      const rich = accts.filter((a) => a.balance > 0);
      const from = rich.length && R.chance(0.85) ? R.pick(rich) : R.pick(accts);
      const amount = from.balance > 0 && R.chance(0.7) ? R.int(1, from.balance) : R.int(1, Math.max(50, Math.round(from.balance * 1.5)));
      if (R.chance(0.25)) {
        const want = leaving(from, amount, false);
        const signed = await E.signTransfer(from.key, { kind: "withdraw", amount });
        const r = await B.transfer(signed); sent.push({ what: "transfer", signed });
        if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(want); }
        else { expect(r.status).toBe("PAID"); from.balance -= amount; moved.payouts += 1; expect(r.balanceMinor).toBe(from.balance); expect(r.receipt && (await B.verifyTransferReceipt(r.receipt))).toBe(true); }
        count("withdrawal", want.length === 0);
        return `${from.label} withdraws ${usd(amount)} to its owner → ${want.join(", ") || "paid out"}`;
      }
      const to = R.pick(POOL.filter((p) => p.acct !== from));
      const want = to.kind === "ghost" ? ["PAYEE_ACCOUNT_UNKNOWN" as const] : leaving(from, amount, true);
      const signed = await E.signTransfer(from.key, { amount, payee: to.text, purpose: "services" });
      const r = await B.transfer(signed); sent.push({ what: "transfer", signed });
      if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(want); }
      else {
        from.balance -= amount;
        if (to.kind === "hold") { to.acct!.balance += amount; expect(r.status).toBe("BOOKED"); }
        else { moved.payouts += 1; expect(r.status).toBe(to.kind === "unclaimed" ? "UNCLAIMED" : "PAID"); }
        expect(r.balanceMinor).toBe(from.balance);
        expect(r.receipt && (await B.verifyTransferReceipt(r.receipt))).toBe(true);
      }
      count("transfer", want.length === 0);
      return `${from.label} pays ${usd(amount)} from its balance to ${to.kind} → ${want.join(", ") || "done"}`;
    }
    async function freeze(): Promise<string> {
      const a = R.pick(accts);
      if (R.chance(0.3)) {
        expect(await refusal(B.freeze(await E.signFreeze(R.pick([stranger, a.key]), a.key.publicKey, !a.frozen)))).toBe(403);
        count("freeze", false); return `a key that does not answer for ${a.label} tries to ${a.frozen ? "unfreeze" : "freeze"} it → refused`;
      }
      a.frozen = !a.frozen;
      await B.freeze(await E.signFreeze(a.owner, a.key.publicKey, a.frozen));
      count("freeze", true);
      return `${a.label}'s owner ${a.frozen ? "freezes" : "unfreezes"} its account`;
    }
    async function issueCard(): Promise<string | null> {
      if (cards.length >= 6) return null;
      const holder = R.pick(accts.filter((a) => a.hold)), merchant = R.pick(accts.filter((a) => a !== holder));
      const perCharge = R.int(50, 2000), maxCharges = R.int(1, 3), every = R.pick([0, 0, 3600]);
      const c = await B.issueCard(await E.signCard(holder.key, { merchant: merchant.payee, label: `${merchant.label} plan`, perCharge, maxCharges, every, life: 3600 }));
      cards.push({ id: c.id, holder, merchant, perCharge, maxCharges, every, charges: 0, charged: 0, cancelled: false });
      count("issue a card", true);
      return `${holder.label} issues a card locked to ${merchant.label}: ${usd(perCharge)} × ${maxCharges}${every ? ", once an hour" : ""}`;
    }
    async function charge(): Promise<string | null> {
      if (!cards.length) return null;
      const usable = cards.filter((x) => !x.cancelled && x.charges < x.maxCharges && x.holder.balance > 0);
      const c = usable.length && R.chance(0.7) ? R.pick(usable) : R.pick(cards);
      const amount = R.chance(0.75) ? R.int(1, Math.max(1, Math.min(c.perCharge, c.holder.balance || c.perCharge))) : R.int(c.perCharge + 1, c.perCharge * 2);
      if (R.chance(0.1)) {
        const r = await B.charge(await E.signCharge(R.pick([stranger, c.holder.key]), { card: c.id, amount }));
        expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual(["NOT_THE_MERCHANT"]);
        count("card charge", false); return `a key the card is not locked to tries to charge it → refused`;
      }
      let want: E.Reason[];
      if (c.cancelled) want = ["CARD_CANCELLED"];
      else if (c.charges >= c.maxCharges) want = ["CARD_USED_UP"];
      else {
        want = [...(amount > c.perCharge ? ["OVER_CARD_LIMIT" as const] : []), ...(c.every > 0 && c.charges > 0 ? ["CHARGE_TOO_SOON" as const] : [])];
        if (!want.length) want = leaving(c.holder, amount, true);
      }
      const r = await B.charge(await E.signCharge(c.merchant.key, { card: c.id, amount, memo: "plan" }));
      if (want.length) { expect(r.status).toBe("DENIED"); expect(codes(r.reasons)).toEqual([...want].sort()); }
      else {
        c.charges += 1; c.charged += amount; c.holder.balance -= amount;
        if (c.merchant.hold) { c.merchant.balance += amount; expect(r.status).toBe("BOOKED"); } else { moved.payouts += 1; expect(r.status).toBe("PAID"); }
      }
      count("card charge", want.length === 0);
      return `${c.merchant.label} charges ${usd(amount)} to ${c.holder.label}'s card → ${want.join(", ") || "charged"}`;
    }
    async function cancelCard(): Promise<string | null> {
      const live = cards.filter((c) => !c.cancelled); if (!live.length) return null;
      const c = R.pick(live);
      if (R.chance(0.35)) { expect(await refusal(B.cancelCard(await E.signCardCancel(c.merchant.key, c.id)))).toBe(403); count("cancel a card", false); return `the merchant tries to cancel a card it does not hold → refused`; }
      await B.cancelCard(await E.signCardCancel(R.chance(0.7) ? c.holder.key : c.holder.owner, c.id));
      c.cancelled = true; count("cancel a card", true);
      return `${c.holder.label}'s card for ${c.merchant.label} is cancelled`;
    }
    /** The same signed request presented again: the answer is the earlier one and nothing happens twice. */
    async function replay(): Promise<string | null> {
      if (!sent.length) return null;
      const s = R.pick(sent);
      if (s.what === "spend") {
        const r = await G.spend(s.signed);
        if (r.spend) expect(r.duplicate).toBe(true); // (a refusal that was never put on record is simply refused again)
        else expect(r.status).toBe("DENIED");
      } else {
        const r = await B.transfer(s.signed);
        if (r.transfer) expect(r.duplicate).toBe(true); else expect(r.status).toBe("DENIED");
      }
      count("replay", false);
      return `a signed ${s.what} is presented a second time → nothing happens twice`;
    }
    /** The gateway's own housekeeping (PayPal's event feed, unfinished payouts, refunds, disputes) finds nothing to change. */
    async function sweep(): Promise<string> {
      await S.sweepUnfinished();
      count("housekeeping sweep", true);
      return "the gateway sweeps for unfinished work and reads PayPal's events → nothing to change";
    }

    const MOVES: Array<[number, () => Promise<string | null>]> = [
      [26, pay], [9, setAside], [7, keep], [4, accept], [2, expire], [8, split], [5, cheat], [3, revoke], [6, giveBack], [3, recall],
      [10, transfer], [3, freeze], [3, issueCard], [7, charge], [2, cancelCard], [3, replay], [1, sweep],
    ];
    const total = MOVES.reduce((n, [w]) => n + w, 0);
    const chooseMove = () => { let x = R.next() * total; for (const [w, f] of MOVES) { if ((x -= w) < 0) return f; } return pay; };

    // ---- the run -------------------------------------------------------------------------------------
    let at = "the start";
    try {
      expect(await world()).toEqual(model());
      const closeAt = R.chance(0.5) ? R.int(Math.round(steps * 0.6), steps - 1) : -1; // in half the runs one envelope is closed part-way
      for (let i = 0; i < steps; i++) {
        at = `move ${i + 1} of ${steps}`;
        const said = i === closeAt ? await close(R.pick(roots)) : (await chooseMove()()) ?? (await pay());
        log.push(`${String(i + 1).padStart(2)}. ${said}`);
        expect(await world()).toEqual(model());
      }
      at = "closing";
      for (const r of roots) { log.push(` ·  ${await close(r)}`); expect(await world()).toEqual(model()); }
      // when everything is closed: nothing is set aside anywhere, and every hold is accounted for to the cent
      expect(nodes().every((n) => n.reserved === 0)).toBe(true);
      expect(pays.every((p) => p.state !== "PROMISED")).toBe(true);
      for (const r of roots) expect(r.captured + r.refunded + r.released!).toBe(r.limit);
      // and a closed envelope pays nothing
      const dead = roots[0]!.nodes[0]!;
      const late = await G.spend(await E.signSpend(dead.chain, dead.key, { amount: 1, payee: POOL[dead.payeeIx?.[0] ?? 4]!.text, purpose: PURPOSES[dead.purposeIx?.[0] ?? 0]! }));
      expect(late.status).toBe("DENIED");
      expect(await world()).toEqual(model());
    } catch (e) {
      if (e instanceof Error) e.message = `seed ${seed}${fees ? " (fees on)" : ""}, at ${at}:\n${e.message}\n\nThe moves so far:\n${log.slice(-14).join("\n")}`;
      throw e;
    }
    return { steps, moves: log.length, paid: moved.captures };
  }

  for (const seed of SEEDS) {
    it(`seed ${seed}: two envelope trees, 40 to 80 random moves, every rule checked after each one${seed % 2 === 0 ? " (PayPal fees on)" : ""}`, async () => {
      const r = await run(seed);
      expect(r.steps).toBeGreaterThanOrEqual(40);
      expect(r.paid, "a run in which no money moved proves nothing").toBeGreaterThan(0);
    }, 120_000);
  }

  it("across the seeds every kind of move was made, and the ones that can be refused were both accepted and refused", () => {
    if (process.env.INVARIANT_TALLY) console.log([...tally].map(([k, v]) => `${k.padEnd(24)} accepted ${String(v.accepted).padStart(4)}  refused ${String(v.refused).padStart(4)}`).join("\n"));
    if (process.env.INVARIANT_SEEDS) return; // a hand-picked seed list need not cover everything
    const both = ["payment", "promise", "keep a promise", "accept a promise", "revoke", "refund by the payee", "recall", "transfer", "withdrawal", "freeze", "card charge", "cancel a card"];
    const once = ["a promise runs out", "split", "close", "issue a card", "housekeeping sweep", "forged wider envelope", "copied envelope", "replay"];
    for (const k of both) expect(tally.get(k), k).toMatchObject({ accepted: expect.any(Number), refused: expect.any(Number) });
    for (const k of both) { expect(tally.get(k)!.accepted, `${k}: never accepted`).toBeGreaterThan(0); expect(tally.get(k)!.refused, `${k}: never refused`).toBeGreaterThan(0); }
    for (const k of once) expect((tally.get(k)?.accepted ?? 0) + (tally.get(k)?.refused ?? 0), k).toBeGreaterThan(0);
    // nothing forged or copied ever went through
    for (const k of ["forged wider envelope", "copied envelope", "replay"]) expect(tally.get(k)!.accepted).toBe(0);
  });
});
