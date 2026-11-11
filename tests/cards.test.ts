/**
 * Cards: an agent's signed permission for one merchant to charge its balance. Against the built-in
 * PayPal simulator.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("cards (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const codes = (v: Array<{ code: string }>) => v.map((x) => x.code).sort();
  const bal = (k: string) => getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, k) }).then((a) => a!.balanceMinor);
  const cardRow = (id: string) => getDb().query.cards.findFirst({ where: eq(schema.cards.id, id) }).then((c) => c!);
  const payouts = async () => (await sim.simCalls()).filter((c) => c === "POST /v1/payments/payouts").length;

  /**
   * Bea's translator-agent holds $90 (cap $30 a payment). Lexica is a merchant whose income is paid
   * straight out to PayPal; Glossa is a merchant that keeps a balance here.
   */
  async function world(opts: { perDay?: number; lexicaTo?: string } = {}) {
    const [ada, ops, bea, tr, lo, lx, go, gl, rogue] = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold", perPayment: 3000, ...(opts.perDay ? { perDay: opts.perDay } : {}) }));
    await G.openAccount(await E.signAccount(lx!, lo!, { label: "Lexica Pro", ownerName: "Lexica Ltd", settleTo: opts.lexicaTo ?? "billing@lexica.example" }));
    await G.openAccount(await E.signAccount(gl!, go!, { label: "Glossa", ownerName: "Glossa Inc", settleTo: "pay@glossa.example", mode: "hold" }));
    const payee = E.accountPayee(tr!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 10000, payees: [payee], purposes: ["translation"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    expect((await G.spend(await E.signSpend(chain, ops!, { amount: 9000, payee, purpose: "translation" }))).status).toBe("PAID");
    const lexica = E.accountPayee(lx!.publicKey), glossa = E.accountPayee(gl!.publicKey);
    return { bea: bea!, tr: tr!, lx: lx!, gl: gl!, rogue: rogue!, lexica, glossa };
  }

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  it("a card is signed by the agent whose balance it charges, locked to one merchant that exists", async () => {
    const w = await world();
    const card = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 2, every: 30 * 86400, life: 70 * 86400 }));
    expect(card).toMatchObject({ holder: w.tr.publicKey, merchantAgent: w.lx.publicKey, perChargeMinor: 900, maxCharges: 2, charges: 0 });
    expect(card.number).toMatch(/^XN[0-9A-F]{2} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
    expect(await bal(w.tr.publicKey)).toBe(9000); // issuing moves nothing
    // someone else signs a card on the translator's balance
    const forged = await E.signCard(w.rogue, { merchant: w.lexica, label: "Lexica Pro", perCharge: 9000, maxCharges: 9, life: 3600 });
    forged.body.holder = w.tr.publicKey;
    await expect(B.issueCard(forged)).rejects.toThrow(/not signed by the key whose balance/);
    // the merchant widens a card after the agent signed it
    const real = await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 2, life: 3600 });
    await expect(B.issueCard({ ...real, body: { ...real.body, perCharge: 90000 } })).rejects.toThrow(/not signed/);
    await expect(B.issueCard({ ...real, body: { ...real.body, maxCharges: 100 } })).rejects.toThrow(/not signed/);
    // nonsense terms
    for (const p of [{ perCharge: 0 }, { perCharge: 1.5 }, { maxCharges: 0 }, { maxCharges: 1000 }, { every: -1 }, { life: 5 * 366 * 86400 }, { merchant: "billing@lexica.example" }])
      await expect(B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "x", perCharge: 900, maxCharges: 2, life: 3600, ...p }))).rejects.toThrow();
    await expect(B.issueCard(await E.signCard(w.tr, { merchant: E.accountPayee(w.rogue.publicKey), label: "x", perCharge: 900, maxCharges: 1, life: 3600 }))).rejects.toThrow(/No merchant has opened/);
    await expect(B.issueCard(await E.signCard(w.tr, { merchant: E.accountPayee(w.tr.publicKey), label: "x", perCharge: 900, maxCharges: 1, life: 3600 }))).rejects.toThrow(/its own holder/);
    await expect(B.issueCard(await E.signCard(w.rogue, { merchant: w.lexica, label: "x", perCharge: 900, maxCharges: 1, life: 3600 }))).rejects.toThrow(/needs an account/);
  });

  it("the merchant charges it: PayPal pays a merchant that settles; a merchant with a balance is credited at once", async () => {
    const w = await world();
    const c1 = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 2, life: 3600 }));
    const signed = await E.signCharge(w.lx, { card: c1.id, amount: 900, memo: "November" });
    const r = await B.charge(signed);
    expect(r.status).toBe("PAID");
    expect(r.transfer).toMatchObject({ kind: "charge", cardId: c1.id, payoutTo: "billing@lexica.example", amountMinor: 900 });
    expect(await payouts()).toBe(1);
    expect(await bal(w.tr.publicKey)).toBe(8100);
    expect(r.card).toMatchObject({ charges: 1, chargedMinor: 900 });
    expect(r.receipt).toMatchObject({ card: { id: c1.id, label: "Lexica Pro", charge: 1, of: 2 }, to: { kind: "paypal" }, balanceAfterMinor: 8100 });
    expect(await B.verifyTransferReceipt(r.receipt!)).toBe(true);
    // the same signed charge again, or re-spelled, takes nothing more
    expect(await B.charge(signed)).toMatchObject({ duplicate: true, balanceMinor: 8100 });
    expect((await B.charge({ ...signed, sig: `${signed.sig}==` })).status).toBe("DENIED");
    expect(await bal(w.tr.publicKey)).toBe(8100);
    // a merchant that keeps a balance
    const c2 = await B.issueCard(await E.signCard(w.tr, { merchant: w.glossa, label: "Glossa", perCharge: 500, maxCharges: 1, life: 3600 }));
    const before = await payouts();
    const g = await B.charge(await E.signCharge(w.gl, { card: c2.id, amount: 400 }));
    expect(g.status).toBe("BOOKED");
    expect(await payouts()).toBe(before);
    expect(await bal(w.gl.publicKey)).toBe(400);
    expect(await bal(w.tr.publicKey)).toBe(7700);
    expect((await B.position()).checks.every((x) => x.ok)).toBe(true);
  });

  it("refuses what the card does not allow: another merchant, too much, too soon, too many times, after expiry", async () => {
    const w = await world();
    const c = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 2, every: 3600, life: 7200 }));
    // someone who has the card's details but not the merchant's key
    expect(codes((await B.charge(await E.signCharge(w.rogue, { card: c.id, amount: 100 }))).reasons)).toEqual(["NOT_THE_MERCHANT"]);
    expect(codes((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 100 }))).reasons)).toEqual(["NOT_THE_MERCHANT"]);
    const posing = await E.signCharge(w.rogue, { card: c.id, amount: 100 }); posing.request.merchant = w.lx.publicKey;
    expect(codes((await B.charge(posing)).reasons)).toEqual(["NOT_THE_MERCHANT"]);
    // the holder itself cannot charge its own card to move money past the owner's rules
    expect(codes((await B.charge(await E.signCharge(w.tr, { card: c.id, amount: 100 }))).reasons)).toEqual(["NOT_THE_MERCHANT"]);
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 901 }))).reasons)).toEqual(["OVER_CARD_LIMIT"]);
    for (const amount of [0, -900, 9.5]) expect((await B.charge(await E.signCharge(w.lx, { card: c.id, amount }))).status).toBe("DENIED");
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: "card_doesnotexist", amount: 100 }))).reasons)).toEqual(["UNKNOWN_CARD"]);
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 100 }, new Date(Date.now() - 10 * 60_000)))).reasons)).toEqual(["STALE_REQUEST"]);
    expect(await bal(w.tr.publicKey)).toBe(9000);
    // first period
    expect((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }))).status).toBe("PAID");
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }))).reasons)).toEqual(["CHARGE_TOO_SOON"]);
    // a billing period later
    await getDb().update(schema.cards).set({ lastChargeAt: new Date(Date.now() - 3601_000) }).where(eq(schema.cards.id, c.id));
    expect((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }))).status).toBe("PAID");
    // the card allowed two charges: it has ended by itself
    await getDb().update(schema.cards).set({ lastChargeAt: new Date(Date.now() - 3601_000) }).where(eq(schema.cards.id, c.id));
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }))).reasons)).toEqual(["CARD_USED_UP"]);
    expect(B.cardState(await cardRow(c.id))).toBe("USED_UP");
    expect(await bal(w.tr.publicKey)).toBe(7200);
    // expiry
    const short = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Trial", perCharge: 900, maxCharges: 5, life: 3600 }));
    await getDb().update(schema.cards).set({ notAfter: new Date(Date.now() - 1000) }).where(eq(schema.cards.id, short.id));
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: short.id, amount: 100 }))).reasons)).toEqual(["CARD_EXPIRED"]);
  });

  it("five charges at once on a card that allows two: exactly two go through", async () => {
    const w = await world();
    const c = await B.issueCard(await E.signCard(w.tr, { merchant: w.glossa, label: "Glossa", perCharge: 500, maxCharges: 2, life: 3600 }));
    const rs = await Promise.all((await Promise.all(Array.from({ length: 5 }, () => E.signCharge(w.gl, { card: c.id, amount: 500 })))).map((s) => B.charge(s)));
    expect(rs.filter((r) => r.status === "BOOKED")).toHaveLength(2);
    expect(rs.filter((r) => r.status === "DENIED").every((r) => codes(r.reasons).includes("CARD_USED_UP"))).toBe(true);
    expect(await bal(w.tr.publicKey)).toBe(8000);
    expect(await bal(w.gl.publicKey)).toBe(1000);
    expect((await cardRow(c.id)).charges).toBe(2);
    expect((await B.position()).checks.every((x) => x.ok)).toBe(true);
  });

  it("the agent cancels its card; so can its owner; nobody else can; and a cancelled card stays cancelled", async () => {
    const w = await world();
    const c = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 12, life: 3600 }));
    await expect(B.cancelCard(await E.signCardCancel(w.rogue, c.id))).rejects.toThrow(/Only the card's holder or the owner/);
    await expect(B.cancelCard(await E.signCardCancel(w.lx, c.id))).rejects.toThrow(/Only the card's holder or the owner/);
    const cancel = await E.signCardCancel(w.tr, c.id);
    await expect(B.cancelCard({ ...cancel, request: { ...cancel.request, card: "card_another0001" } })).rejects.toThrow(/properly signed/);
    expect((await B.cancelCard(cancel)).cancelledBy).toBe("holder");
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }))).reasons)).toEqual(["CARD_CANCELLED"]);
    expect(await bal(w.tr.publicKey)).toBe(9000);
    // the owner cancels another one without the agent
    const c2 = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 12, life: 3600 }));
    expect((await B.cancelCard(await E.signCardCancel(w.bea, c2.id))).cancelledBy).toBe("owner");
    expect(B.cardState(await cardRow(c2.id))).toBe("CANCELLED");
    // presenting the same signed card again does not bring it back
    expect((await B.issueCard(c2.signed)).cancelledAt).toBeTruthy();
    expect(codes((await B.charge(await E.signCharge(w.lx, { card: c2.id, amount: 900 }))).reasons)).toEqual(["CARD_CANCELLED"]);
  });

  it("the owner's rules bind every card: the cap per payment, the freeze, the daily limit, the balance", async () => {
    const w = await world({ perDay: 4000 });
    const c = await B.issueCard(await E.signCard(w.tr, { merchant: w.glossa, label: "Glossa", perCharge: 5000, maxCharges: 20, life: 3600 }));
    // the card says $50 a charge, the owner says $30 a payment
    expect(codes((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 3001 }))).reasons)).toEqual(["OVER_ACCOUNT_LIMIT"]);
    expect((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 3000 }))).status).toBe("BOOKED");
    // $30 has left today; the owner allows $40 a day, across cards and transfers alike
    expect(codes((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 1001 }))).reasons)).toEqual(["OVER_DAILY_LIMIT"]);
    expect(codes((await B.transfer(await E.signTransfer(w.tr, { amount: 1001, payee: w.glossa }))).reasons)).toEqual(["OVER_DAILY_LIMIT"]);
    expect((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 1000 }))).status).toBe("BOOKED");
    // a withdrawal to the owner is not spending
    expect((await B.transfer(await E.signTransfer(w.tr, { kind: "withdraw", amount: 2000 }))).status).toBe("PAID");
    // yesterday's spending no longer counts
    await getDb().execute(sql`update ledger set created_at = now() - interval '25 hours' where kind = 'transfer_out'`);
    expect((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 500 }))).status).toBe("BOOKED");
    // frozen: no card works
    await B.freeze(await E.signFreeze(w.bea, w.tr.publicKey, true));
    expect(codes((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 100 }))).reasons)).toEqual(["ACCOUNT_FROZEN"]);
    await B.freeze(await E.signFreeze(w.bea, w.tr.publicKey, false, new Date(Date.now() + 1000)));
    // the balance
    await B.transfer(await E.signTransfer(w.tr, { kind: "withdraw", amount: await bal(w.tr.publicKey) - 50 }));
    expect(codes((await B.charge(await E.signCharge(w.gl, { card: c.id, amount: 100 }))).reasons)).toEqual(["INSUFFICIENT_BALANCE"]);
    expect((await B.position()).checks.every((x) => x.ok)).toBe(true);
  });

  it("a charge PayPal refuses to pay out goes back to the balance and does not count against the card", async () => {
    const w = await world({ lexicaTo: "refused@lexica.example" });
    const c = await B.issueCard(await E.signCard(w.tr, { merchant: w.lexica, label: "Lexica Pro", perCharge: 900, maxCharges: 1, every: 3600, life: 7200 }));
    const r = await B.charge(await E.signCharge(w.lx, { card: c.id, amount: 900 }));
    expect(r.status).toBe("FAILED");
    expect(codes(r.reasons)).toEqual(["PAYPAL_PAYOUT_FAILED"]);
    expect(await bal(w.tr.publicKey)).toBe(9000);
    expect(await cardRow(c.id)).toMatchObject({ charges: 0, chargedMinor: 0 });
    expect((await B.position()).checks.every((x) => x.ok)).toBe(true);
  });
});
