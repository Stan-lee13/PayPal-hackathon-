/**
 * Replay under a different spelling. A signature is bytes; base64 can spell the same bytes several
 * ways (padding, "+/" for "-_", whitespace, spare bits in the last character). A signed request
 * presented again with its signature re-spelled must not be treated as a new request.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

/** Other spellings of the same signature bytes. */
function respell(sig: string): string[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(sig[sig.length - 1]!);
  // 64 bytes in 86 characters leaves 4 spare bits in the last one
  const spare = alphabet[(last & ~0b1111) | ((last & 0b1111) ^ 0b0001)]!;
  return [`${sig}==`, ` ${sig}`, `${sig}\n`, sig.replace(/-/g, "+").replace(/_/g, "/"), sig.slice(0, -1) + spare, `${sig.slice(0, 40)} ${sig.slice(40)}`].filter((x) => x !== sig);
}

d("replay with a re-spelled signature (simulated PayPal)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const B = await import("../lib/gateway/bank");
  const sim = await import("../lib/paypal/emulator");
  const { resetSimMemory } = await import("../lib/sim/store");
  const EXP = new Date(Date.now() + 3600_000).toISOString();
  const moved = async () => (await sim.simCalls()).filter((c) => c.includes("/capture") || c.includes("/payouts")).length;

  beforeEach(async () => {
    resetSimMemory();
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers restart identity cascade`);
  });

  it("a signature has exactly one accepted spelling", async () => {
    const k = await E.generateKeyPair();
    const sig = await E.signDetached(k.privateKey, "test/1", { a: 1 });
    expect(await E.verifyDetached(k.publicKey, "test/1", { a: 1 }, sig)).toBe(true);
    for (const other of respell(sig)) expect(await E.verifyDetached(k.publicKey, "test/1", { a: 1 }, other), JSON.stringify(other)).toBe(false);
  });

  it("a paid spend presented again with its signature re-spelled pays nothing more", async () => {
    const [ada, ops] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 5000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const signed = await E.signSpend(chain, ops!, { amount: 2500, payee: "designer@example.com", purpose: "design" });
    expect((await G.spend(signed)).status).toBe("PAID");
    const before = await moved();
    for (const sig of respell(signed.sig)) {
      const r = await G.spend({ ...signed, sig });
      expect(r.status === "DENIED" || r.duplicate, `${JSON.stringify(sig)} → ${r.status}`).toBe(true);
    }
    expect(await moved()).toBe(before);
    expect((await getDb().query.roots.findFirst({ where: eq(schema.roots.id, root.id) }))!.capturedMinor).toBe(2500);
  });

  it("a promise, and a transfer out of a balance, cannot be replayed that way either", async () => {
    const [ada, ops, bea, tr, cy, pf] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    await G.openAccount(await E.signAccount(pf!, cy!, { label: "proofreader-agent", ownerName: "Cy", settleTo: "cy@example.com", mode: "hold" }));
    const payee = E.accountPayee(tr!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 5000, payees: [payee], purposes: ["translation"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const pr = await E.signPromise(chain, ops!, { amount: 1000, payee, purpose: "translation", ttl: 600 });
    expect((await G.promise(pr)).status).toBe("PROMISED");
    for (const sig of respell(pr.sig)) { const r = await G.promise({ ...pr, sig }); expect(r.status === "DENIED" || r.duplicate, JSON.stringify(sig)).toBe(true); }
    expect((await getDb().select().from(schema.spends)).filter((s) => s.status === "PROMISED")).toHaveLength(1);
    // income, then a transfer replayed under other spellings
    expect((await G.spend(await E.signSpend(chain, ops!, { amount: 5000, payee, purpose: "translation" }))).status).toBe("PAID");
    const t = await E.signTransfer(tr!, { amount: 1000, payee: E.accountPayee(pf!.publicKey) });
    expect((await B.transfer(t)).status).toBe("BOOKED");
    for (const sig of respell(t.sig)) { const r = await B.transfer({ ...t, sig }); expect(r.status === "DENIED" || r.duplicate, JSON.stringify(sig)).toBe(true); }
    expect((await getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, tr!.publicKey) }))!.balanceMinor).toBe(4000);
    expect((await getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, pf!.publicKey) }))!.balanceMinor).toBe(1000);
  });

  it("an old freeze or unfreeze cannot be presented again to undo a newer one", async () => {
    const [bea, tr] = await Promise.all([1, 2].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    const t = Date.now();
    const unfreeze0 = await E.signFreeze(bea!, tr!.publicKey, false, new Date(t - 3000));
    const freeze1 = await E.signFreeze(bea!, tr!.publicKey, true, new Date(t - 2000));
    await B.freeze(unfreeze0);
    expect((await B.freeze(freeze1)).frozenAt).toBeTruthy();
    // the agent saw the earlier unfreeze and presents it again
    await expect(B.freeze(unfreeze0)).rejects.toThrow(/newer freeze or unfreeze/);
    for (const sig of respell(unfreeze0.sig)) await expect(B.freeze({ ...unfreeze0, sig })).rejects.toThrow();
    expect((await getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, tr!.publicKey) }))!.frozenAt).toBeTruthy();
    // and the other way round: after the owner lifts it, the old freeze can't be replayed to lock the agent out
    await B.freeze(await E.signFreeze(bea!, tr!.publicKey, false, new Date(t - 1000)));
    await expect(B.freeze(freeze1)).rejects.toThrow(/newer freeze or unfreeze/);
    expect((await getDb().query.accounts.findFirst({ where: eq(schema.accounts.agent, tr!.publicKey) }))!.frozenAt).toBeNull();
  });
});
