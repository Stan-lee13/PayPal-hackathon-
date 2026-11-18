/**
 * The rail contract, run twice: once against the deterministic mock rail and once against the PayPal
 * adapter talking to the repository's own simulator (the same wire shapes the sandbox was measured on).
 *
 * The point is not that PayPal works — `tests/paypal-rail.test.ts` covers the gateway end to end. The
 * point is that **the financial engine's guarantees hold for any rail that claims them**, and that a
 * rail which does not claim a capability refuses instead of pretending. Both adapters are pure I/O:
 * this file needs no database and no credentials.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RailError, UnsupportedCapabilityError, amount, railRef, requireCapability,
  type Amount, type Rail, type WebhookRequest,
} from "../lib/rails";
import { mockEmptyRail, mockPayoutOnlyRail, mockRail } from "../lib/rails/mock-rail";

const USD = (minor: number): Amount => amount(minor, "USD");
const holdRef = (r: Rail, id: string) => railRef(r.id, "authorization", id);

type ProviderEvent = { id: string; event_type: string; resource?: Record<string, unknown> };

type Fixture = {
  name: string;
  rail(): Rail;
  /** Fresh, empty provider state. */
  fresh(): Promise<void>;
  /** The next call to this operation is interrupted: the effect is unknown (`in_doubt`, retryable). */
  interrupt(op: "capture" | "payout" | "refund"): Promise<void>;
  /** The next call to this operation is definitively refused by the provider. */
  refuse(op: "capture" | "payout" | "refund"): Promise<void>;
  clearFailures(): Promise<void>;
  /** The payer presses approve in the provider's checkout. */
  approve(orderId: string): Promise<boolean>;
  /** Move a payout on, as a provider does days later. */
  settlePayout(batchId: string, status: string): Promise<void>;
  /** A correctly signed delivery of this event. */
  signed(ev: ProviderEvent): WebhookRequest;
  /** A delivery that claims to be the same event but has been altered. */
  tampered(ev: ProviderEvent): WebhookRequest;
};

/** Build the PayPal fixture. `PAYPAL_MODE=simulated` routes the adapter at lib/paypal/emulator.ts. */
async function paypalFixture(): Promise<Fixture> {
  process.env.PAYPAL_MODE = "simulated";
  delete process.env.ENVELOPE_SIM_PERSIST; // never touch Postgres from a contract test
  const client = await import("../lib/paypal/client");
  const sim = await import("../lib/paypal/emulator");
  const store = await import("../lib/sim/store");
  const { PayPalRail } = await import("../lib/rails/paypal-rail");
  let rail: Rail = new PayPalRail();
  const headers = (sig: string): Record<string, string> => ({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-SIM",
    "paypal-transmission-id": `t-${Math.random().toString(16).slice(2)}`,
    "paypal-transmission-sig": sig,
    "paypal-transmission-time": new Date().toISOString(),
  });
  return {
    name: "PayPal rail (built-in simulator)",
    rail: () => rail,
    async fresh() {
      store.resetSimMemory();
      client.setPayPalForTesting(null);
      rail = new PayPalRail();
      await sim.simRefuseRefunds(false);
      await sim.simFailNext(null);
    },
    async interrupt(op) {
      // Four failures defeats the client's two retries, so the adapter itself sees the outage.
      await sim.simFailNext(op === "capture" ? "/capture" : op === "payout" ? "/payouts" : "/refund", 4);
    },
    async refuse(op) {
      if (op === "refund") await sim.simRefuseRefunds(true);
      else throw new Error(`The simulator cannot definitively refuse a ${op}.`);
    },
    async clearFailures() {
      await sim.simFailNext(null);
      await sim.simRefuseRefunds(false);
    },
    async approve(orderId) {
      return sim.simApproveOrder(orderId);
    },
    async settlePayout(batchId, status) {
      await sim.simSetPayout(batchId, status as "SUCCESS" | "UNCLAIMED" | "RETURNED" | "FAILED");
    },
    signed(ev) {
      return { headers: headers(sim.SIM_SIGNATURE), rawBody: JSON.stringify(ev), endpointId: sim.SIM_WEBHOOK_ID };
    },
    tampered(ev) {
      return { headers: headers(sim.SIM_SIGNATURE), rawBody: JSON.stringify({ ...ev, resource: { ...(ev.resource ?? {}), amount: "999.99" } }), endpointId: sim.SIM_WEBHOOK_ID };
    },
  };
}

function mockFixture(): Fixture {
  let rail = mockRail();
  return {
    name: "deterministic mock rail",
    rail: () => rail,
    async fresh() { rail = mockRail(); },
    async interrupt(op) {
      rail.failNext(op === "capture" ? "hold.capture" : op === "payout" ? "payout.send" : "refund.capture", 1);
    },
    async refuse(op) { rail.declineNext(op === "capture" ? "hold.capture" : op === "payout" ? "payout.send" : "refund.capture", 1); },
    async clearFailures() { rail.failNext("", 0); },
    async approve(orderId) { return rail.approveOrder(orderId); },
    async settlePayout(batchId, status) { rail.setPayoutStatus(batchId, status as "SUCCESS" | "UNCLAIMED" | "RETURNED" | "FAILED"); },
    signed(ev) { return { headers: { "mock-signature": "MOCK-VALID" }, rawBody: JSON.stringify(ev), endpointId: "MOCK-ENDPOINT" }; },
    tampered(ev) { return { headers: { "mock-signature": "MOCK-VALID" }, rawBody: JSON.stringify({ ...ev, resource: { ...(ev.resource ?? {}), amount: "999.99" } }), endpointId: "MOCK-ENDPOINT" }; },
  };
}

const FIXTURES: Array<{ name: string; make: () => Promise<Fixture> | Fixture }> = [
  { name: "mock rail", make: mockFixture },
  { name: "PayPal rail (simulated)", make: paypalFixture },
];

for (const spec of FIXTURES) {
  describe(`${spec.name} satisfies the rail contract`, () => {
    let f: Fixture;
    beforeAll(async () => { f = await spec.make(); });
    beforeEach(async () => { await f.fresh(); });

    it("funds a budget: the rail places a hold for exactly the amount asked, and reads it back", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-1", title: "Launch budget", amount: USD(20000) });
      expect(hold.status).toBe("CREATED");
      expect(hold.amount).toEqual(USD(20000));
      expect(hold.externalRef).toBe("root-1");
      expect(hold.ref.provider).toBe(r.id);
      expect(hold.expiresAt).toBeTruthy();
      const read = await r.holds.read(hold.ref);
      expect(read.status).toBe("CREATED");
      expect(read.amount).toEqual(USD(20000));
      // The same reference never places a second hold.
      const again = await r.holds.authorize({ reference: "root-1", title: "Launch budget", amount: USD(20000) });
      expect(again.ref.id).toBe(hold.ref.id);
    });

    it("rejects funding that exceeds the hold, and holds placed on an unapproved order", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-2", title: "Budget", amount: USD(1000) });
      const over = await r.holds.capture({ hold: hold.ref, reference: "spend-over", amount: USD(1001), note: "too much" })
        .catch((e: unknown) => e);
      expect(over).toBeInstanceOf(RailError);
      expect(over).toMatchObject({ code: "declined", retryable: false });
      expect((over as RailError).providerCode).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");

      const approval = await r.holds.requestApproval({ reference: "root-3", title: "Approved budget", amount: USD(1500), returnUrl: "https://app/back", cancelUrl: "https://app/cancel" });
      expect(approval.approvalUrl).toBeTruthy();
      const unapproved = await r.holds.authorizeApproved({ order: approval.orderRef, reference: "root-3" }).catch((e: unknown) => e);
      expect(unapproved).toBeInstanceOf(RailError);
      expect((unapproved as RailError).providerCode).toBe("ORDER_NOT_APPROVED");
      expect(await f.approve(approval.orderRef.id)).toBe(true);
      const funded = await r.holds.authorizeApproved({ order: approval.orderRef, reference: "root-3" });
      expect(funded.amount).toEqual(USD(1500));
      expect(funded.status).toBe("CREATED");
    });

    it("captures part of a hold, leaves the rest, and refuses one minor unit beyond it", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-4", title: "Budget", amount: USD(1000) });
      const first = await r.holds.capture({ hold: hold.ref, reference: "spend-1", amount: USD(400), note: "design" });
      expect(first.status).toBe("COMPLETED");
      expect(first.amount).toEqual(USD(400));
      expect((await r.holds.read(hold.ref)).status).toBe("PARTIALLY_CAPTURED");
      const second = await r.holds.capture({ hold: hold.ref, reference: "spend-2", amount: USD(600), note: "design" });
      expect(second.amount).toEqual(USD(600));
      expect((await r.holds.read(hold.ref)).status).toBe("CAPTURED");
      const third = await r.holds.capture({ hold: hold.ref, reference: "spend-3", amount: USD(1), note: "design" }).catch((e: unknown) => e);
      expect(third).toMatchObject({ code: "declined" });
      // A provider may name the refusal either way once nothing is left; both mean "no more money here".
      expect(["MAX_CAPTURE_AMOUNT_EXCEEDED", "AUTHORIZATION_ALREADY_CAPTURED", "PREVIOUSLY_CAPTURED"]).toContain((third as RailError).providerCode);
    });

    it("settles: pays the payee once and reports what the provider says", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-5", title: "Budget", amount: USD(5000) });
      const cap = await r.holds.capture({ hold: hold.ref, reference: "spend-5", amount: USD(2500), note: "design" });
      const po = await r.payouts.send({ reference: "spend-5", receiver: "designer@example.com", amount: USD(2500), note: "design" });
      expect(po.itemStatus).toBe("SUCCESS");
      expect(po.batchRef.id).toBeTruthy();
      expect(po.itemRef?.id).toBeTruthy();
      const read = await r.payouts.read(po.batchRef);
      expect(read.itemStatus).toBe("SUCCESS");
      expect(read.receiver).toBe("designer@example.com");
      // A different reference is a different payout; the same one never pays twice.
      const dup = await r.payouts.send({ reference: "spend-5", receiver: "designer@example.com", amount: USD(2500), note: "design" });
      expect(dup.batchRef.id).toBe(po.batchRef.id);
      expect(cap.ref.id).toBeTruthy();
    });

    it("fails settlement when the payee cannot be paid, and lets the caller undo the capture", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-6", title: "Budget", amount: USD(3000) });
      const cap = await r.holds.capture({ hold: hold.ref, reference: "spend-6", amount: USD(1200), note: "design" });
      const failed = await r.payouts.send({ reference: "spend-6", receiver: "refused.payee@example.com", amount: USD(1200), note: "design" }).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(RailError);
      expect((failed as RailError).retryable).toBe(false);
      expect((failed as RailError).providerCode).toBe("RECEIVER_ACCOUNT_LOCKED");
      // The compensation path the gateway uses: give the money back to the payer.
      const refund = await r.refunds.refund({ capture: cap.ref, reference: "spend-6", note: "payout could not be delivered" });
      expect(refund.status).toBe("COMPLETED");
      expect((await r.holds.readCapture(cap.ref)).status).toBe("REFUNDED");
    });

    it("refunds once, and a refund does not give the hold its capacity back", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-7", title: "Budget", amount: USD(1000) });
      const cap = await r.holds.capture({ hold: hold.ref, reference: "spend-7", amount: USD(400), note: "design" });
      const refund = await r.refunds.refund({ capture: cap.ref, reference: "spend-7", note: "returned" });
      expect(refund.status).toBe("COMPLETED");
      // The same reference again is the same request: the provider answers with the refund it made.
      const same = await r.refunds.refund({ capture: cap.ref, reference: "spend-7", note: "returned" });
      expect(same.ref.id).toBe(refund.ref.id);
      // A different reference against the same capture is also "already done", not a second refund.
      const other = await r.refunds.refund({ capture: cap.ref, reference: "spend-7-again", note: "returned" }).catch((e: unknown) => e);
      expect(other).toBeInstanceOf(RailError);
      expect((other as RailError).code).toBe("duplicate");
      // The refunded amount stays used: PayPal does not put it back into the authorization.
      const over = await r.holds.capture({ hold: hold.ref, reference: "spend-8", amount: USD(700), note: "design" }).catch((e: unknown) => e);
      expect((over as RailError).providerCode).toBe("MAX_CAPTURE_AMOUNT_EXCEEDED");
      const fits = await r.holds.capture({ hold: hold.ref, reference: "spend-9", amount: USD(600), note: "design" });
      expect(fits.status).toBe("COMPLETED");
    });

    it("treats the same request as one effect, however many times it arrives at once", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-8", title: "Budget", amount: USD(5000) });
      const req = { hold: hold.ref, reference: "spend-10", amount: USD(1000), note: "design" };
      const results = await Promise.all([r.holds.capture(req), r.holds.capture(req), r.holds.capture(req)]);
      expect(new Set(results.map((x) => x.ref.id)).size).toBe(1);
      const again = await r.holds.capture(req);
      expect(again.ref.id).toBe(results[0]!.ref.id);
      // Two different requests cannot both take the last 1000: the hold decides.
      const left = USD(4000);
      const racing = await Promise.all([
        r.holds.capture({ hold: hold.ref, reference: "spend-11a", amount: left, note: "design" }).then(() => "ok" as const).catch(() => "refused" as const),
        r.holds.capture({ hold: hold.ref, reference: "spend-11b", amount: left, note: "design" }).then(() => "ok" as const).catch(() => "refused" as const),
      ]);
      expect(racing.sort()).toEqual(["ok", "refused"]);
      const p = await r.holds.read(hold.ref);
      expect(p.status).toBe("CAPTURED");
    });

    it("recovers from an interrupted call by repeating the same reference, not by compensating", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-9", title: "Budget", amount: USD(2000) });
      await f.interrupt("capture");
      const lost = await r.holds.capture({ hold: hold.ref, reference: "spend-12", amount: USD(900), note: "design" }).catch((e: unknown) => e);
      expect(lost).toBeInstanceOf(RailError);
      expect((lost as RailError).code).toBe("in_doubt");
      expect((lost as RailError).retryable).toBe(true);
      await f.clearFailures();
      const recovered = await r.holds.capture({ hold: hold.ref, reference: "spend-12", amount: USD(900), note: "design" });
      expect(recovered.status).toBe("COMPLETED");
      expect((await r.holds.read(hold.ref)).status).toBe("PARTIALLY_CAPTURED");
      const repeat = await r.holds.capture({ hold: hold.ref, reference: "spend-12", amount: USD(900), note: "design" });
      expect(repeat.ref.id).toBe(recovered.ref.id);
    });

    it("verifies a genuine event, refuses an altered one, and lists what it reported", async () => {
      const r = f.rail();
      await r.holds.authorize({ reference: "root-10", title: "Budget", amount: USD(1000) });
      const events = await r.events.list();
      expect(events.length).toBeGreaterThan(0);
      const ev = events[0]!;
      const body: ProviderEvent = { id: ev.id, event_type: ev.type, resource: ev.resource };
      expect(await r.events.verify(f.signed(body))).toBe(true);
      expect(await r.events.verify(f.tampered(body))).toBe(false);
      // A replay of the same genuine event verifies again: deduplication belongs to the gateway
      // (paypal_events' primary key), not to the rail.
      expect(await r.events.verify(f.signed(body))).toBe(true);
    });

    it("gives the books what they need: a statement and a balance that agree with the money moved", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-11", title: "Budget", amount: USD(4000) });
      const cap = await r.holds.capture({ hold: hold.ref, reference: "spend-13", amount: USD(1500), note: "design" });
      const po = await r.payouts.send({ reference: "spend-13", receiver: "designer@example.com", amount: USD(1500), note: "design" });
      const from = new Date(Date.now() - 3600_000), to = new Date(Date.now() + 60_000);
      const lines = await r.reporting.statement({ from, to });
      const inLine = lines.find((l) => l.id === cap.ref.id);
      expect(inLine).toBeTruthy();
      expect(inLine!.amountMinor).toBe(1500);
      const outLine = lines.find((l) => l.amountMinor === -1500);
      expect(outLine).toBeTruthy();
      const balance = await r.reporting.balance("USD");
      expect(balance).not.toBeNull();
      expect(balance!.availableMinor).toBe(0);
      // The payout's own identifiers are recoverable from the rail, which is what reconciliation needs.
      expect((await r.payouts.read(po.batchRef)).itemStatus).toBe("SUCCESS");
    });

    it("reports a missing or wrong provider reference as not found, never as success", async () => {
      const r = f.rail();
      const missingHold = await r.holds.capture({
        hold: holdRef(r, "AUTHORIZATION-THAT-NEVER-EXISTED"), reference: "spend-14", amount: USD(100), note: "design",
      }).catch((e: unknown) => e);
      expect(missingHold).toBeInstanceOf(RailError);
      expect((missingHold as RailError).code).toBe("not_found");

      const missingCapture = await r.holds.readCapture(railRef(r.id, "capture", "CAPTURE-THAT-NEVER-EXISTED")).catch((e: unknown) => e);
      expect((missingCapture as RailError).code).toBe("not_found");

      const missingPayout = await r.payouts.read(railRef(r.id, "payout", "PAYOUT-THAT-NEVER-EXISTED")).catch((e: unknown) => e);
      expect((missingPayout as RailError).code).toBe("not_found");
    });

    it("moves a payout on when the provider says the payee claimed it or it came back", async () => {
      const r = f.rail();
      const hold = await r.holds.authorize({ reference: "root-12", title: "Budget", amount: USD(2000) });
      await r.holds.capture({ hold: hold.ref, reference: "spend-15", amount: USD(800), note: "design" });
      const po = await r.payouts.send({ reference: "spend-15", receiver: "unclaimed.designer@example.com", amount: USD(800), note: "design" });
      expect(po.itemStatus).toBe("UNCLAIMED");
      await f.settlePayout(po.batchRef.id, "SUCCESS");
      expect((await r.payouts.read(po.batchRef)).itemStatus).toBe("SUCCESS");
    });
  });
}

describe("capability negotiation", () => {
  it("a rail that cannot hold funds refuses, and says which capability is missing", async () => {
    const payoutOnly = mockPayoutOnlyRail();
    expect(payoutOnly.capabilities.has("payout.send")).toBe(true);
    expect(payoutOnly.capabilities.has("hold.capture")).toBe(false);
    expect(payoutOnly.guarantees.has("authorization-hold")).toBe(false);
    const e = await payoutOnly.holds.capture({ hold: holdRef(payoutOnly, "x"), reference: "spend", amount: USD(1), note: "" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnsupportedCapabilityError);
    expect(e).toMatchObject({ code: "unsupported_capability", provider: "mock", capability: "hold.capture", retryable: false });
    expect((e as Error).message).toMatch(/does not support hold\.capture/);
    expect(() => requireCapability(payoutOnly, "funding.authorize-hold")).toThrow(UnsupportedCapabilityError);
    // Nothing was sent: the rail has no state at all.
    expect(payoutOnly.calls()).toEqual([]);
  });

  it("a rail that claims nothing refuses every capability, and every guarantee it lists is real", async () => {
    const empty = mockEmptyRail();
    expect(empty.capabilities.size).toBe(0);
    expect(empty.guarantees.size).toBe(0);
    for (const call of [
      () => empty.holds.authorize({ reference: "r", title: "t", amount: USD(1) }),
      () => empty.holds.read(holdRef(empty, "a")),
      () => empty.payouts.send({ reference: "r", receiver: "a@b", amount: USD(1), note: "" }),
      () => empty.refunds.refund({ capture: railRef(empty.id, "capture", "c"), reference: "r", note: "" }),
      () => empty.reporting.balance("USD"),
      () => empty.reporting.statement({ from: new Date(0), to: new Date() }),
      () => empty.events.list(),
      () => empty.disputes.list(),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    }
  });

  it("no shipped rail claims custody, safeguarding or network card issuing", async () => {
    const rails: Rail[] = [mockRail(), mockPayoutOnlyRail()];
    process.env.PAYPAL_MODE = "simulated";
    const { paypalRail } = await import("../lib/rails/paypal-rail");
    rails.push(paypalRail());
    for (const r of rails) {
      expect(r.guarantees.has("safeguarded-funds")).toBe(false);
      expect(r.guarantees.has("card-issuing")).toBe(false);
    }
  });
});

describe("the rail registry", () => {
  it("resolves the configured rail, refuses an unknown one, and accepts a new adapter without touching the engine", async () => {
    const { configuredRailId, forgetRails, railIds, registerRail, resolveRail, setRailForTesting } = await import("../lib/rails/registry");
    expect(railIds()).toContain("paypal");
    expect(railIds()).toContain("mock");
    const saved = process.env.ENVELOPE_RAIL_PROVIDER;
    process.env.ENVELOPE_RAIL_PROVIDER = "mock";
    expect(configuredRailId()).toBe("mock");
    expect(resolveRail().id).toBe("mock");
    process.env.ENVELOPE_RAIL_PROVIDER = "not-a-rail";
    expect(() => resolveRail("not-a-rail")).toThrow(/Unknown financial rail/);
    if (saved === undefined) delete process.env.ENVELOPE_RAIL_PROVIDER; else process.env.ENVELOPE_RAIL_PROVIDER = saved;

    registerRail("partner-test", () => mockRail());
    expect(resolveRail("partner-test").id).toBe("mock"); // the adapter's own id wins; the registry key is the lookup
    const injected = mockRail();
    setRailForTesting(injected);
    expect(resolveRail("mock")).toBe(injected);
    setRailForTesting(null);
    forgetRails();
  });
});

describe("the money type", () => {
  it("refuses floats, negatives and non-ISO currencies", () => {
    expect(() => amount(10.5, "USD")).toThrow(/integer/);
    expect(() => amount(-1, "USD")).toThrow(/negative/);
    expect(() => amount(1, "usd")).toThrow(/ISO-4217/);
    expect(amount(0, "JPY")).toEqual({ minor: 0, currency: "JPY" });
  });
});
