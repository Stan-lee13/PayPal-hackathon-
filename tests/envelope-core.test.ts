import { describe, expect, it } from "vitest";
import * as E from "../lib/envelope/core";

const EXP = new Date(Date.now() + 3600_000).toISOString();
const in1h = () => EXP;
const caps = (over: Partial<E.Caps> = {}): E.Caps => ({ currency: "USD", limit: 20000, perPayment: 8000, payees: ["translator@example.com", "designer@example.com"], purposes: ["translation", "design"], notAfter: in1h(), splits: 2, ...over });
const codes = (v: E.Violation[]) => v.map((x) => x.code).sort();

async function world() {
  const [ada, ops, loc, rogue] = await Promise.all([E.generateKeyPair(), E.generateKeyPair(), E.generateKeyPair(), E.generateKeyPair()]);
  const root = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, caps());
  const sub = await E.split(root, ops, { publicKey: loc.publicKey, label: "localization-agent" }, caps({ limit: 6000, perPayment: 5000, payees: ["translator@example.com"], purposes: ["translation"], splits: 0 }));
  return { ada, ops, loc, rogue, root, sub };
}

describe("envelope chain", () => {
  it("a sealed root and a narrower sub-envelope verify", async () => {
    const w = await world();
    const v = await E.verifyChain(w.sub);
    expect(v.ok).toBe(true);
    expect(v.principal).toBe(w.ada.publicKey);
    expect(v.caps).toMatchObject({ limit: 6000, payees: ["translator@example.com"], splits: 0 });
    expect(v.ids).toHaveLength(2);
  });

  it("split refuses to widen anything", async () => {
    const w = await world();
    const to = { publicKey: w.loc.publicKey, label: "x" };
    await expect(E.split(w.root, w.ops, to, caps({ limit: 20001 }))).rejects.toThrow(/more than the parent/);
    await expect(E.split(w.root, w.ops, to, caps({ payees: ["attacker@evil.example"] }))).rejects.toThrow(/payees/);
    await expect(E.split(w.root, w.ops, to, caps({ payees: null }))).rejects.toThrow(/payees/);
    await expect(E.split(w.root, w.ops, to, caps({ purposes: ["ads"] }))).rejects.toThrow(/purposes/);
    await expect(E.split(w.root, w.ops, to, caps({ notAfter: new Date(Date.now() + 2 * 3600_000).toISOString() }))).rejects.toThrow(/expires later/);
    await expect(E.split(w.root, w.ops, to, caps({ splits: 2 }))).rejects.toThrow(/split/);
    await expect(E.split(w.sub, w.loc, to, caps({ limit: 100, perPayment: 100, payees: ["translator@example.com"], purposes: ["translation"], splits: 0 }))).rejects.toThrow(/may not be split/);
    await expect(E.split(w.root, w.loc, to, caps({ limit: 1 }))).rejects.toThrow(/Only the holder/);
  });

  it("a hand-forged wider block is caught by verification, with the exact reasons", async () => {
    const w = await world();
    // the ops agent signs a block that gives away more than it has (bypassing split())
    const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: w.root[0]!.body.id, parent: await E.blockHash(w.root[0]!), issuer: w.ops.publicKey, holder: w.rogue.publicKey, holderLabel: "greedy", caps: E.normalizeCaps(caps({ limit: 999999, perPayment: 999999, payees: null, purposes: null, splits: 5 })), issuedAt: new Date().toISOString() };
    const forged: E.Envelope = [...w.root, { body, sig: await E.signDetached(w.ops.privateKey, E.BLOCK_VERSION, body) }];
    const v = await E.verifyChain(forged);
    expect(v.ok).toBe(false);
    expect(codes(v.violations)).toEqual(["SPLIT_NOT_ALLOWED", "WIDENED_LIMIT", "WIDENED_PAYEES", "WIDENED_PER_PAYMENT", "WIDENED_PURPOSES"]);
  });

  it("tampering, wrong signer, re-rooting and expiry are caught", async () => {
    const w = await world();
    const tampered = structuredClone(w.sub); tampered[1]!.body.caps.limit = 19000;
    expect(codes((await E.verifyChain(tampered)).violations)).toContain("BAD_SIGNATURE");
    const rootEdited = structuredClone(w.sub); rootEdited[0]!.body.caps.limit = 99999999;
    expect(codes((await E.verifyChain(rootEdited)).violations)).toEqual(expect.arrayContaining(["BAD_SIGNATURE", "BROKEN_LINK"]));
    // a stranger signs a "sub-envelope" of someone else's root
    const body = { ...w.sub[1]!.body, issuer: w.rogue.publicKey, holder: w.rogue.publicKey };
    const stolen: E.Envelope = [w.root[0]!, { body, sig: await E.signDetached(w.rogue.privateKey, E.BLOCK_VERSION, body) }];
    expect(codes((await E.verifyChain(stolen)).violations)).toContain("WRONG_ISSUER");
    expect(codes((await E.verifyChain(w.sub, new Date(Date.now() + 2 * 3600_000))).violations)).toEqual(["EXPIRED", "EXPIRED"]);
    expect((await E.verifyChain([])).ok).toBe(false);
    expect((await E.verifyChain("nope")).ok).toBe(false);
  });
});

describe("spend requests", () => {
  it("the holder can spend inside the caps", async () => {
    const w = await world();
    const s = await E.signSpend(w.sub, w.loc, { amount: 4500, payee: "Translator@Example.com", purpose: "translation", memo: "FR + YO" });
    const v = await E.verifySpend(s);
    expect(v.ok).toBe(true);
    expect(s.request.payee).toBe("translator@example.com");
  });

  it("anyone else holding a copy of the envelope cannot", async () => {
    const w = await world();
    const s = await E.signSpend(w.sub, w.loc, { amount: 4500, payee: "translator@example.com", purpose: "translation" });
    const stolen = { ...s, sig: await E.signDetached(w.rogue.privateKey, E.SPEND_VERSION, s.request) };
    expect(codes((await E.verifySpend(stolen)).violations)).toEqual(["NOT_THE_HOLDER"]);
    // changing the amount after signing breaks the signature
    const edited = structuredClone(s); edited.request.amount = 5000;
    expect(codes((await E.verifySpend(edited)).violations)).toEqual(["NOT_THE_HOLDER"]);
  });

  it("caps are enforced: payee, purpose, per-payment, currency, freshness", async () => {
    const w = await world();
    const bad = async (p: Parameters<typeof E.signSpend>[2], at?: Date) => codes((await E.verifySpend(await E.signSpend(w.sub, w.loc, p, at))).violations);
    expect(await bad({ amount: 4500, payee: "attacker@evil.example", purpose: "translation" })).toEqual(["PAYEE_NOT_ALLOWED"]);
    expect(await bad({ amount: 4500, payee: "designer@example.com", purpose: "translation" })).toEqual(["PAYEE_NOT_ALLOWED"]); // allowed for the parent, not for this sub-envelope
    expect(await bad({ amount: 4500, payee: "translator@example.com", purpose: "ads" })).toEqual(["PURPOSE_NOT_ALLOWED"]);
    expect(await bad({ amount: 5001, payee: "translator@example.com", purpose: "translation" })).toEqual(["OVER_PER_PAYMENT"]);
    expect(await bad({ amount: 0, payee: "translator@example.com", purpose: "translation" })).toEqual(["BAD_AMOUNT"]);
    expect(await bad({ amount: 100, payee: "translator@example.com", purpose: "translation" }, new Date(Date.now() - 10 * 60_000))).toEqual(["STALE_REQUEST"]);
  });

  it("revocation requests are signed and time-bound", async () => {
    const w = await world();
    const r = await E.signRevoke(w.ada, w.sub[1]!.body.id);
    expect(await E.verifyRevokeSignature(r)).toBe(true);
    expect(await E.verifyRevokeSignature({ ...r, by: w.rogue.publicKey })).toBe(false);
    expect(await E.verifyRevokeSignature(r, new Date(Date.now() + 10 * 60_000))).toBe(false);
  });

  it("keys survive export and import (what the agent CLI stores on disk)", async () => {
    const k = await E.generateKeyPair();
    const again = await E.importPrivateJwk(await E.exportPrivateJwk(k.privateKey));
    expect(again.publicKey).toBe(k.publicKey);
    const sig = await E.signDetached(again.privateKey, "t", { a: 1 });
    expect(await E.verifyDetached(k.publicKey, "t", { a: 1 }, sig)).toBe(true);
  });
});
