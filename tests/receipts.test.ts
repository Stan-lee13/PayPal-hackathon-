/**
 * Receipts: v1 stays verifiable, v2 never misattributes a provider, and a valid signature is never
 * reported as proof of delivery.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";
import * as E from "../lib/envelope/core";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("receipt protocol", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const G = await import("../lib/gateway/service");
  const R = await import("../lib/gateway/receipts");
  const { mockRail } = await import("../lib/rails/mock-rail");
  const { setRailForTesting } = await import("../lib/rails/registry");

  const EXP = new Date(Date.now() + 3600_000).toISOString();
  let rail: ReturnType<typeof mockRail>;

  beforeEach(async () => {
    rail = mockRail();
    setRailForTesting(rail);
    G.forgetGatewayKey();
    await getDb().execute(sql`truncate table position_entries, rail_accounts, reconciliation_runs, audit_log, spends, blocks, roots, demo_keys, gateway_keys, emulator_state, rate_limits, accounts, ledger, transfers, cards restart identity cascade`);
  });

  async function paid(amountMinor = 1200) {
    const [ada, ops] = await Promise.all([E.generateKeyPair(), E.generateKeyPair()]);
    const chain = await E.seal(ada, { publicKey: ops.publicKey, label: "ops-agent" }, { currency: "USD", limit: 20000, perPayment: 20000, payees: ["designer@example.com"], purposes: ["design"], notAfter: EXP, splits: 0 });
    const root = await G.registerRoot({ chain, principalName: "Ada", title: "Launch budget" });
    const r = await G.spend(await E.signSpend(chain, ops, { amount: amountMinor, payee: "designer@example.com", purpose: "design" }));
    expect(r.status).toBe("PAID");
    return { root, spend: r.spend!, receipt: r.receipt! };
  }

  /** A receipt in the old format, signed the way the old gateway signed it. */
  async function v1For(spend: Awaited<ReturnType<typeof paid>>["spend"], key: E.KeyPair, patch: Record<string, unknown> = {}) {
    const body = {
      v: "envelope-receipt/1" as const,
      spend: spend.id,
      decision: "PAID" as const,
      request: spend.signed.request,
      requestSig: spend.signed.sig,
      chain: await Promise.all(spend.signed.chain.map(async (b) => ({ id: b.body.id, hash: await E.blockHash(b), holder: b.body.holder, holderLabel: b.body.holderLabel }))),
      principal: spend.signed.chain[0]!.body.issuer,
      paypal: { mode: "simulated", authorizationId: "AUTH-V1", captureId: spend.captureId, payoutBatchId: spend.payoutBatchId, payoutItemId: spend.payoutItemId, payoutStatus: spend.payoutStatus },
      issuedAt: new Date().toISOString(),
      gateway: key.publicKey,
      ...patch,
    };
    return { ...body, sig: await E.signDetached(key.privateKey, R.RECEIPT_V1, body) } as unknown as import("../lib/db/schema").ReceiptV1;
  }

  it("issues a provider-neutral v2 receipt that names the rail and its own operations", async () => {
    const p = await paid();
    expect(p.receipt.v).toBe("envelope-receipt/2");
    if (p.receipt.v !== "envelope-receipt/2") throw new Error("expected v2");
    expect(p.receipt.provider).toMatchObject({ rail: "mock", movedExternally: true });
    expect(p.receipt.providerOps.find((o) => o.kind === "capture")?.id).toBe(p.spend.captureId);
    expect(p.receipt.providerOps.find((o) => o.kind === "payout")?.id).toBe(p.spend.payoutBatchId);
    // PayPal's field names are nowhere in it: this payment never went through PayPal.
    expect(JSON.stringify(p.receipt)).not.toContain("\"paypal\"");
    expect(p.receipt.settlement).toMatchObject({ state: "delivered" });
    expect(p.receipt.verification.note).toMatch(/does not prove the money was delivered/);
    expect(p.receipt.verification.external.join(" ")).toContain(p.spend.payoutBatchId!);
    expect(await G.verifyReceipt(p.receipt)).toBe(true);
    const view = R.receiptView(p.receipt);
    expect(view).toMatchObject({ version: "envelope-receipt/2", legacyV1: false, provider: { rail: "mock" } });
    expect(view.ops.capture).toBe(p.spend.captureId);
  });

  it("refuses a tampered amount, provider, signature, version or operation reference", async () => {
    const p = await paid();
    const r = p.receipt as Extract<typeof p.receipt, { v: "envelope-receipt/2" }>;
    expect(await G.verifyReceipt({ ...r, amount: { minor: 1, currency: "USD" } })).toBe(false);
    expect(await G.verifyReceipt({ ...r, provider: { ...r.provider, rail: "paypal", label: "PayPal" } })).toBe(false);
    expect(await G.verifyReceipt({ ...r, sig: `${r.sig.slice(0, -4)}AAAA` })).toBe(false);
    expect(await G.verifyReceipt({ ...r, v: "envelope-receipt/1" } as never)).toBe(false);
    expect(await G.verifyReceipt({ ...r, v: "envelope-receipt/9" } as never)).toBe(false);
    expect(await G.verifyReceipt({ ...r, operation: { kind: "payment", ref: "sp_someone_else" } })).toBe(false);
    // Attribution is read from the signed body, so a relabelled copy cannot pass as another provider's.
    expect(R.receiptRail(r)).toBe("mock");
    void p.spend;
  });

  it("keeps v1 receipts verifiable for ever, under their own signing domain", async () => {
    const p = await paid();
    const key = await G.gatewayKey();
    const v1 = await v1For(p.spend, key);
    expect(await G.verifyReceipt(v1)).toBe(true);
    expect(R.receiptRail(v1)).toBe("paypal");
    // Old receipts still show a v1 view, and it is labelled as legacy rather than silently rewritten.
    const view = R.receiptView(v1);
    expect(view).toMatchObject({ version: "envelope-receipt/1", legacyV1: true });
    expect(R.receiptAttribution(v1)).toMatchObject({ rail: "paypal", legacyV1: true, ops: { capture: p.spend.captureId } });
    // Tampering with any field breaks it, including a swap to the v2 domain.
    expect(await G.verifyReceipt({ ...v1, paypal: { ...v1.paypal, captureId: "CAP-OTHER" } })).toBe(false);
    expect(await G.verifyReceipt({ ...v1, spend: "sp_other" } as never)).toBe(false);
    const body = { ...v1 } as Record<string, unknown>;
    delete body.sig;
    const resigned = { ...body, sig: await E.signDetached(key.privateKey, R.RECEIPT_V2, body) } as never;
    expect(await G.verifyReceipt(resigned)).toBe(false);
  });

  it("a receipt is bound to its operation: one cannot be replayed as another payment's", async () => {
    const a = await paid(1200);
    const b = await paid(1200);
    expect(a.spend.id).not.toBe(b.spend.id);
    // Same amount, same payer, different payment: the signature is over `operation.ref`.
    const original = a.receipt as Extract<typeof a.receipt, { v: "envelope-receipt/2" }>;
    const swapped = { ...original, operation: { kind: "payment" as const, ref: b.spend.id } };
    expect(await G.verifyReceipt(swapped)).toBe(false);
    // Verifying does not consume anything: the same receipt verifies again.
    expect(await G.verifyReceipt(a.receipt)).toBe(true);
    expect(await G.verifyReceipt(a.receipt)).toBe(true);
  });

  it("says what was true at issue time, and never upgrades it when settlement changes later", async () => {
    const p = await paid(900);
    const r = p.receipt as Extract<typeof p.receipt, { v: "envelope-receipt/2" }>;
    expect(r.settlement.state).toBe("delivered");
    // The provider later returns the payout: the signed receipt is unchanged and still verifies...
    await getDb().update(schema.spends).set({ payoutStatus: "RETURNED", status: "FAILED" }).where(eq(schema.spends.id, p.spend.id));
    expect(await G.verifyReceipt(r)).toBe(true);
    expect(R.receiptView(r).settlement.state).toBe("delivered"); // what it said when it was signed
    // ...but live state is reported from the record, not from the receipt.
    const live = R.settlementStateOf({ held: false, payoutStatus: "RETURNED" });
    expect(live).toBe("refunded");
    expect(R.settlementMeaning(live, "mock")).toMatch(/nothing was delivered/);
    // The distinction is stated, not implied.
    expect(r.verification.offline.join(" ")).toMatch(/signature/);
    expect(r.verification.note).toMatch(/only the provider can confirm/);
  });

  it("a credited payment says so, and claims no external delivery", async () => {
    const [ada, ops, bea, tr] = await Promise.all([1, 2, 3, 4].map(() => E.generateKeyPair()));
    await G.openAccount(await E.signAccount(tr!, bea!, { label: "translator-agent", ownerName: "Bea", settleTo: "bea@example.com", mode: "hold" }));
    const payee = E.accountPayee(tr!.publicKey);
    const chain = await E.seal(ada!, { publicKey: ops!.publicKey, label: "ops" }, { currency: "USD", limit: 9000, perPayment: 9000, payees: [payee], purposes: ["t"], notAfter: EXP, splits: 0 });
    await G.registerRoot({ chain, principalName: "Ada", title: "B" });
    const r = (await G.spend(await E.signSpend(chain, ops!, { amount: 700, payee, purpose: "t" }))).receipt as Extract<import("../lib/db/schema").Receipt, { v: "envelope-receipt/2" }>;
    expect(r.settlement.state).toBe("credited");
    expect(r.provider).toMatchObject({ custody: "gateway-ledger", movedExternally: false });
    // Only the capture is a provider fact: no payout is named, because none happened.
    expect(r.verification.external.join(" ")).toContain(r.providerOps.find((o) => o.kind === "capture")!.id);
    expect(r.verification.external.join(" ")).not.toMatch(/payout/i);
    expect(r.settlement.meaning).toMatch(/credited to this agent's balance/);
    expect(await G.verifyReceipt(r)).toBe(true);
  });
});
