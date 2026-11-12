/**
 * The SDK against the real gateway handlers, in-process, on the built-in PayPal simulator.
 * Nothing here calls the gateway's functions directly: every action goes through the SDK and the
 * same HTTP handlers a deployed gateway serves.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import { handlerFetch, type Seen } from "./helpers/gateway-http";
import { Agent, EnvelopeError, Gateway, Owner, protocol, checkIntroduction, checkPromiseNote, checkReference, fingerprint, getReceipt, getStatus, toMinor, verifyReceipt, verifyTransferReceipt } from "../sdk/src";
import type * as Sdk from "../sdk/src";
import type { PromiseNote as GwNote, Receipt as GwReceipt, TransferReceipt as GwTransferReceipt } from "../lib/db/schema";
import type { Reference as GwReference, Standing as GwStanding } from "../lib/gateway/service";

// Compile-time: what the gateway produces must fit what the SDK says it returns.
export const _fits = {
  receipt: (x: GwReceipt): Sdk.Receipt => x,
  note: (x: GwNote): Sdk.PromiseNote => x,
  transferReceipt: (x: GwTransferReceipt): Sdk.TransferReceipt => x,
  standing: (x: GwStanding): Sdk.Standing => x,
  reference: (x: GwReference): Sdk.Reference => x,
};

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("@envelope/sdk against the gateway (simulated PayPal)", () => {
  const seen: Seen[] = [];
  let gateway: Gateway;
  let ada: Owner, bea: Owner, lo: Owner;
  let researcher: Agent, helper: Agent, writer: Agent, proofreader: Agent, lexica: Agent, stranger: Agent;
  let rootId = "";
  const secrets: string[] = [];

  const refused = async (p: Promise<unknown>): Promise<EnvelopeError> => {
    try { await p; } catch (e) { expect(e).toBeInstanceOf(EnvelopeError); return e as EnvelopeError; }
    throw new Error("expected the call to be refused");
  };
  const calls = (path: string) => seen.filter((s) => s.path === path).length;

  beforeAll(async () => {
    const { getDb } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    const { resetSimMemory } = await import("../lib/sim/store");
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
    resetSimMemory();
    gateway = new Gateway("http://gateway.test", { fetch: await handlerFetch(seen), retries: 1 });
    [ada, bea, lo] = await Promise.all(["Ada", "Bea", "Lexica Ltd"].map((label) => Owner.generate({ gateway, label }))) as [Owner, Owner, Owner];
    [researcher, helper, writer, proofreader, lexica, stranger] = await Promise.all(["researcher", "helper", "writer-agent", "proofreader-agent", "Lexica Pro", "stranger"].map((label) => Agent.generate({ gateway, label }))) as [Agent, Agent, Agent, Agent, Agent, Agent];
    for (const p of [ada, bea, lo, researcher, helper, writer, proofreader, lexica, stranger]) secrets.push((await p.exportKey()).d!);
  });

  it("opens accounts with two signatures, and an owner seals an envelope backed by a PayPal hold", async () => {
    const acct = await writer.openAccount({ owner: bea, settleTo: "bea@example.com", hold: true, perPayment: "30.00" });
    expect(acct).toMatchObject({ payee: writer.payee, holds: true, perPaymentMinor: 3000, owner: "Bea" });
    await proofreader.openAccount({ owner: bea, settleTo: "bea@example.com", hold: true });
    await lexica.openAccount({ owner: lo, settleTo: "billing@lexica.example" });

    const sealed = await ada.seal({ to: researcher.identity, limit: "200.00", perPayment: "80.00", payees: [writer.payee, "designer@example.com"], purposes: ["writing", "design"], hours: 2, splits: 2, title: "Report budget" });
    rootId = sealed.root.id;
    expect(sealed.root).toMatchObject({ limitMinor: 20000, status: "ACTIVE", principal: ada.publicKey, principalName: "Ada" });
    expect(sealed.root.authorizationId).toBeTruthy();
    await researcher.hold(sealed.chain);

    const a = await researcher.authority();
    expect(a).toMatchObject({ verified: true, live: true, availableMinor: 20000, rootStatus: "ACTIVE", depth: 0 });
    expect((await ada.envelopes()).map((r) => r.id)).toContain(rootId);
  });

  it("refuses to hold an envelope addressed to someone else, and to act with none", async () => {
    const e = await refused(stranger.hold(researcher.envelope!));
    expect(e.kind).toBe("local");
    expect(e.codes).toContain("NOT_THE_HOLDER");
    expect((await refused(stranger.pay({ amount: "1.00", payee: "x@example.com", purpose: "writing" }))).codes).toContain("NO_ENVELOPE");
  });

  it("splits a narrower envelope, and refuses locally to sign a wider one", async () => {
    const before = calls("/api/gateway/announce");
    const wide = await refused(researcher.split({ to: helper.identity, limit: "500.00" }));
    expect(wide.kind).toBe("local");
    expect(calls("/api/gateway/announce")).toBe(before);

    const s = await researcher.split({ to: helper.identity, limit: "60.00", payees: [writer.payee], purposes: ["writing"] });
    expect(s.announced).toBe(true);
    await helper.hold(s.chain);
    const a = await helper.authority();
    expect(a).toMatchObject({ depth: 1, availableMinor: 6000, live: true });
    expect(a.caps).toMatchObject({ limit: 6000, perPayment: 6000, payees: [writer.payee], purposes: ["writing"], splits: 0 });
    expect(a.path.map((p) => p.label)).toEqual(["researcher", "helper"]);
  });

  it("pays an agent's account: captured from the hold, credited to its balance, with a receipt that verifies here", async () => {
    const p = await helper.pay({ amount: "45.00", payee: writer.payee, purpose: "writing", memo: "Chapter 1", note: "Agreed fee" });
    expect(p).toMatchObject({ status: "PAID", delivered: true, heldInBalance: true, duplicate: false });
    expect(p.paypal?.captureId).toBeTruthy();
    expect(p.paypal?.payoutBatchId).toBeNull();

    const r = await getReceipt(gateway, p.spendId);
    expect(r.paypal.ok).toBe(true);
    const v = await r.verify();
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
    // a receipt altered after the fact does not verify
    const forged = await verifyReceipt({ chain: r.chain, receipt: { ...r.receipt, paypal: { ...r.receipt.paypal, captureId: "SOMETHING-ELSE" } } }, (await gateway.key()).publicKey);
    expect(forged.ok).toBe(false);
    // nor does a real receipt presented as coming from another gateway
    expect((await verifyReceipt(r, stranger.publicKey)).ok).toBe(false);

    expect(await getStatus(gateway, p.spendId)).toMatchObject({ status: "PAID", delivered: true, hasReceipt: true });
    expect((await helper.authority()).availableMinor).toBe(1500);
    expect((await researcher.authority()).availableMinor).toBe(15500);
  });

  it("pays a PayPal address through a payout", async () => {
    const p = await researcher.pay({ amount: "30.00", payee: "designer@example.com", purpose: "design" });
    expect(p.heldInBalance).toBe(false);
    expect(p.paypal?.payoutBatchId).toBeTruthy();
    expect(["PAID", "PAYOUT_PENDING"]).toContain(p.status);
    expect(p.delivered).toBe(p.status === "PAID");
  });

  it("a refusal by the gateway is an EnvelopeError with reason codes, and moves nothing", async () => {
    const before = (await researcher.authority()).availableMinor;
    const e = await refused(helper.pay({ amount: "5.00", payee: "attacker@evil.example", purpose: "writing" }));
    expect(e).toMatchObject({ kind: "gateway", status: 403, outcome: "DENIED", denied: true, retryable: false });
    expect(e.codes).toContain("PAYEE_NOT_ALLOWED");
    expect(e.reasons[0]!.meaning).toBeTruthy();
    const over = await refused(helper.pay({ amount: "20.00", payee: writer.payee, purpose: "writing" }));
    expect(over.codes).toContain("OVER_ENVELOPE_LIMIT");
    expect((await researcher.authority()).availableMinor).toBe(before);
  });

  it("refuses ambiguous or malformed amounts before anything is signed or sent", async () => {
    const before = seen.length;
    for (const bad of [45 as never, "45.001", "-1", "abc", "0", { minor: 12.5 }, { minor: -3 }, "" as never]) {
      const e = await refused(helper.pay({ amount: bad, payee: writer.payee, purpose: "writing" }));
      expect(e.kind).toBe("local");
      expect(e.codes).toContain("BAD_AMOUNT");
    }
    expect(seen.length).toBe(before);
    expect(toMinor("45")).toBe(4500);
    expect(toMinor("45.5")).toBe(4550);
    expect(toMinor("$0.07")).toBe(7);
    expect(toMinor({ minor: 4500 })).toBe(4500);
    expect(toMinor("19.99")).toBe(1999);
  });

  it("sets money aside, lets the payee check the note, then keeps, releases, or is released by a named key", async () => {
    const aside = await researcher.setAside({ amount: "20.00", payee: "designer@example.com", purpose: "design", minutes: 10 });
    expect(aside.note).toMatchObject({ amount: 2000, payee: "designer@example.com" });
    expect((await checkPromiseNote(gateway, aside.token)).good).toBe(true);
    expect((await researcher.authority()).availableMinor).toBe(10500);
    const kept = await researcher.keep(aside.promiseId);
    expect(["PAID", "PAYOUT_PENDING"]).toContain(kept.status);
    expect((await researcher.keep(aside.promiseId)).duplicate).toBe(true);

    const second = await researcher.setAside({ amount: "10.00", payee: "designer@example.com", purpose: "design" });
    expect(await researcher.release(second.promiseId)).toMatchObject({ released: true });
    expect((await refused(researcher.keep(second.promiseId))).outcome).toBe("LAPSED");
    expect((await researcher.authority()).availableMinor).toBe(10500);

    // paid on delivery: the writer's own signed acceptance releases the money, with a fingerprint of the work
    const third = await researcher.setAside({ amount: "25.00", payee: writer.payee, purpose: "writing", releaseBy: writer });
    const notNamed = await refused(stranger.accept(third.promiseId));
    expect(notNamed).toMatchObject({ kind: "gateway", status: 403 });
    expect(notNamed.detail).toMatch(/different key/);
    const work = await fingerprint("Chapter 2, final text");
    const paid = await writer.accept(third.promiseId, { work, note: "Delivered and checked" });
    expect(paid).toMatchObject({ status: "PAID", heldInBalance: true });
    expect(paid.receipt?.releasedBy).toMatchObject({ key: writer.publicKey, work });

    const fourth = await researcher.setAside({ amount: "5.00", payee: writer.payee, purpose: "writing", releaseBy: writer });
    expect(await writer.decline(fourth.promiseId, { note: "Not doing this one" })).toMatchObject({ declined: true });
  });

  it("an introduction can be checked by the payee, with the gateway's signature verified locally", async () => {
    const hi = await researcher.introduce({ amount: "40.00", payee: "designer@example.com", purpose: "design" });
    const c = await checkIntroduction(gateway, hi.token);
    expect(c.signature.ok).toBe(true);
    expect(c.good).toBe(true);
    expect(c.standing).toMatchObject({ agentLabel: "researcher", good: true });
    expect(c.standing.sponsors[0]).toMatchObject({ role: "owner", label: "Ada" });
    const tooMuch = await checkIntroduction(gateway, (await researcher.introduce({ amount: "79.00", payee: "nobody@example.com", purpose: "design" })).token);
    expect(tooMuch.good).toBe(false);
    expect(tooMuch.standing.reasons.map((r) => r.code)).toContain("PAYEE_NOT_ALLOWED");
    expect((await refused(checkIntroduction(gateway, "not-a-token!"))).kind).toBe("local");
  });

  it("an agent uses the balance it earned: a transfer on the ledger, a withdrawal by PayPal, the owner's cap and freeze", async () => {
    expect((await writer.balance())?.minor).toBe(7000);
    const payouts = calls("/api/bank/transfer");
    const t = await writer.transfer({ amount: "12.00", payee: proofreader.payee, purpose: "proofreading" });
    expect(t).toMatchObject({ status: "BOOKED", balanceMinor: 5800, paypal: null });
    expect((await verifyTransferReceipt(t.receipt!, (await gateway.key()).publicKey)).ok).toBe(true);
    expect((await proofreader.balance())?.minor).toBe(1200);
    expect(calls("/api/bank/transfer")).toBe(payouts + 1);

    expect((await refused(writer.transfer({ amount: "40.00", payee: "someone@example.com" }))).codes).toContain("OVER_ACCOUNT_LIMIT");
    const w = await writer.withdraw({ amount: "10.00" });
    expect(w.paypal?.payoutBatchId).toBeTruthy();
    expect(w.balanceMinor).toBe(4800);

    expect(await bea.freeze(writer)).toMatchObject({ frozen: true });
    expect((await refused(writer.transfer({ amount: "1.00", payee: proofreader.payee }))).codes).toContain("ACCOUNT_FROZEN");
    expect(await bea.freeze(writer, false)).toMatchObject({ frozen: false });
    expect((await refused(ada.freeze(writer))).status).toBeGreaterThanOrEqual(400);

    const books = await gateway.books();
    expect(books.checks.every((c) => c.ok)).toBe(true);
  });

  it("a card lets one merchant charge within limits, and nobody else; the holder cancels it", async () => {
    const card = await writer.issueCard({ merchant: lexica.payee, label: "Lexica Pro", perCharge: "9.00", maxCharges: 2, everySeconds: 0, validDays: 10 });
    expect(card).toMatchObject({ state: "ACTIVE", perChargeMinor: 900, maxCharges: 2 });
    expect((await writer.cards()).map((c) => c.id)).toContain(card.id);

    const first = await lexica.charge({ card: card.id, amount: "9.00", memo: "November" });
    expect(first.card).toMatchObject({ charges: 1, maxCharges: 2 });
    expect((await refused(lexica.charge({ card: card.id, amount: "19.00" }))).codes).toContain("OVER_CARD_LIMIT");
    expect((await refused(stranger.charge({ card: card.id, amount: "9.00" }))).codes).toContain("NOT_THE_MERCHANT");

    expect((await refused(stranger.cancelCard(card.id))).status).toBeGreaterThanOrEqual(400);
    expect(await writer.cancelCard(card.id)).toMatchObject({ state: "CANCELLED", charges: 1 });
    expect((await refused(lexica.charge({ card: card.id, amount: "9.00" }))).codes).toContain("CARD_CANCELLED");
    expect((await gateway.card(card.id)).state).toBe("CANCELLED");
  });

  it("resends the identical signed request when the answer is lost, and the gateway pays once", async () => {
    const real = await handlerFetch(seen);
    let dropped = 0;
    const flaky = new Gateway("http://gateway.test", { retries: 2, fetch: async (input, init) => {
      const res = await real(input, init);
      if (input.endsWith("/api/gateway/spend") && dropped++ === 0) throw new TypeError("socket hang up");
      return res;
    } });
    const again = await Agent.fromJSON(await helper.export(), { gateway: flaky });
    const before = seen.length;
    const p = await again.pay({ amount: "10.00", payee: writer.payee, purpose: "writing" });
    const sent = seen.slice(before).filter((s) => s.path === "/api/gateway/spend");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toBe(sent[1]!.body);
    expect(p).toMatchObject({ status: "PAID", duplicate: true });
    expect((await helper.authority()).availableMinor).toBe(500);
    expect((await writer.balance())?.minor).toBe(4800 - 900 + 1000);
  });

  it("an unreachable gateway is a network error that says it can be retried", async () => {
    const down = new Gateway("http://gateway.test", { retries: 1, fetch: async () => { throw new TypeError("fetch failed"); } });
    const a = await Agent.fromJSON(await helper.export(), { gateway: down });
    const e = await refused(a.pay({ amount: "1.00", payee: writer.payee, purpose: "writing" }));
    expect(e).toMatchObject({ kind: "network", status: 0, retryable: true });
    // authority still answers from the chain alone, and says what it could not learn
    expect(await a.authority()).toMatchObject({ verified: true, availableMinor: null, rootStatus: null });
  });

  it("a signed reference can be handed over and checked", async () => {
    const { reference, token } = await researcher.reference();
    expect(reference.facts.paymentsSettled).toBeGreaterThanOrEqual(2);
    expect((await checkReference(gateway, token)).good).toBe(true);
    expect((await checkReference(gateway, { ...reference, facts: { ...reference.facts, paymentsSettled: 999 } })).good).toBe(false);
  });

  it("any payment can be looked up, the owner recalls one nobody claimed, and the PayPal calls behind it can be read", async () => {
    const scout = await Agent.generate({ gateway, label: "scout-agent" });
    const nobody = "unclaimed.nobody@example.com";
    const { chain, root } = await ada.seal({ to: scout.identity, limit: "15.00", perPayment: "10.00", payees: [nobody], purposes: ["research"], hours: 1 });
    await scout.hold(chain);
    // a refused payment has no receipt, and can still be looked up
    const denied = await refused(scout.pay({ amount: "5.00", payee: "attacker@evil.example", purpose: "research" }));
    expect(await getStatus(gateway, denied.spendId!)).toMatchObject({ status: "DENIED", delivered: false, hasReceipt: false });
    const lost = await scout.pay({ amount: "7.00", payee: nobody, purpose: "research" });
    expect(lost).toMatchObject({ status: "UNCLAIMED", delivered: false });
    // the agent that paid cannot take it back; its owner can
    expect((await refused(gateway.recall(lost.spendId, await protocol.signRead(await protocol.importPrivateJwk(await scout.exportKey()), "recall", lost.spendId)))).status).toBe(401);
    const back = await ada.recall(lost.spendId);
    expect(back).toMatchObject({ status: "FAILED", payoutStatus: "RETURNED" });
    expect(back.refundId).toBeTruthy();
    expect(back.reasons[0]!.code).toBe("RECALLED_BY_OWNER");
    expect((await scout.authority()).availableMinor).toBe(800); // the owner has the $7 back; PayPal does not return it to the hold
    const trail = await gateway.paypalTrail(root.id);
    expect(trail.summary).toMatchObject({ holds: 1, captures: 1, payouts: 1, cancels: 1, refunds: 1 });
    expect(trail.calls.every((c) => typeof c.path === "string" && !/\d{13,19}/.test(JSON.stringify(c)))).toBe(true);
    await ada.close(root.id);
  });

  it("an agent gives a payment back, and the books can be read against PayPal's own", async () => {
    const giver = await Agent.generate({ gateway, label: "giver-agent" });
    const keeper = await Agent.generate({ gateway, label: "keeper-agent" });
    await keeper.openAccount({ owner: bea, settleTo: "bea@example.com", hold: true });
    const { chain, root } = await ada.seal({ to: giver.identity, limit: "40.00", perPayment: "40.00", payees: [keeper.payee], purposes: ["research"], hours: 1 });
    await giver.hold(chain);
    const paid = await giver.pay({ amount: "25.00", payee: keeper.payee, purpose: "research" });
    expect((await keeper.balance())?.minor).toBe(2500);
    // only the agent that was paid can give it back
    expect((await refused(giver.refund(paid.spendId))).codes).toEqual(["NOT_THE_HOLDER"]);
    const back = await keeper.refund(paid.spendId, { memo: "Cannot take this on" });
    expect(back).toMatchObject({ status: "REFUNDED", balanceMinor: 0 });
    expect(back.refundId).toBeTruthy();
    expect(await getStatus(gateway, paid.spendId)).toMatchObject({ status: "FAILED", delivered: false, refundId: back.refundId });
    // the owner has the money back; that part of the hold stays used, as it does at PayPal
    expect((await giver.authority()).availableMinor).toBe(1500);
    expect((await gateway.envelope(root.id)).root).toMatchObject({ capturedMinor: 0, refundedMinor: 2500 });

    const books = await gateway.books();
    expect(books.checks.every((c) => c.ok)).toBe(true);
    expect(books.reserves.covered).toBe(true);
    const st = await gateway.statement();
    expect(st.ok).toBe(true);
    expect(st.matches.find((m) => m.spend === paid.spendId)).toMatchObject({ what: "capture", verdict: "listed", amountMinor: 2500 });
    const ev = await gateway.evidence(paid.spendId);
    expect(ev.chainVerifies).toBe(true);
    expect(ev.summary).toContain(paid.paypal!.captureId!);
    await ada.close(root.id);
  });

  it("the owner reads their own books, revokes a sub-envelope and closes the root", async () => {
    const t = await ada.treasury();
    expect(t).toBeTruthy();
    // someone who only knows Ada's public key signs the read with their own key and names hers
    const impostor = await protocol.signRead(await protocol.importPrivateJwk(await stranger.exportKey()), "treasury", ada.publicKey);
    expect((await refused(gateway.treasury({ ...impostor, by: ada.publicKey }))).status).toBe(401);

    await ada.revoke(helper.envelope![1]!.body.id);
    expect((await refused(helper.pay({ amount: "1.00", payee: writer.payee, purpose: "writing" }))).codes).toContain("REVOKED");
    expect((await helper.authority()).live).toBe(false);

    const closed = await ada.close(rootId);
    expect(closed.root.status).toBe("CLOSED");
    expect(closed.root.releasedMinor).toBe(20000 - closed.root.capturedMinor);
    expect((await researcher.authority())).toMatchObject({ rootStatus: "CLOSED", live: false });
    expect((await refused(researcher.pay({ amount: "1.00", payee: "designer@example.com", purpose: "design" }))).denied).toBe(true);
  });

  it("no private key material ever left the process, and a party does not serialize its key", async () => {
    expect(secrets.every((s) => typeof s === "string" && s.length > 20)).toBe(true);
    expect(seen.length).toBeGreaterThan(40);
    for (const s of seen) {
      for (const secret of secrets) expect(s.body.includes(secret)).toBe(false);
      expect(/"d"\s*:/.test(s.body)).toBe(false);
      expect(/"kty"\s*:/.test(s.body)).toBe(false);
    }
    const dump = JSON.stringify({ researcher, ada, writer });
    for (const secret of secrets) expect(dump.includes(secret)).toBe(false);
    expect(JSON.parse(dump).researcher).toEqual({ label: "researcher", publicKey: researcher.publicKey, account: researcher.account });
    expect(Object.keys(researcher)).not.toContain("key");
    // every path the SDK used is a gateway path; it has no other destination
    expect(seen.every((s) => s.path.startsWith("/api/"))).toBe(true);
  });
});
