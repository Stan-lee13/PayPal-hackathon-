import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatMoney, toDecimalString, toMinor } from "../lib/money";
import { evaluate, type EvalInput } from "../lib/ledger/evaluator";
import { validateProposal, type PolicyContext } from "../lib/policy/engine";
import { crc32, isTrustedCertUrl, signedMessage, verifyWebhookSignature } from "../lib/paypal/webhook-verify";
import { buildRefundRequest, parseCapture, parseRefund, parseTrackers } from "../lib/paypal/api";
import { DEFAULT_POLICY } from "../lib/services/defaults";

describe("money (integer minor units)", () => {
  it("parses decimal strings exactly", () => {
    expect(toMinor("93.33", "USD")).toBe(9333);
    expect(toMinor("84", "USD")).toBe(8400);
    expect(toMinor("0.1", "USD")).toBe(10);
    expect(toMinor("1,234.50", "USD")).toBe(123450);
    expect(toMinor("500", "JPY")).toBe(500);
  });
  it("rejects malformed or over-precise amounts", () => {
    expect(() => toMinor("9.333", "USD")).toThrow();
    expect(() => toMinor("-1", "USD")).toThrow();
    expect(() => toMinor("1e3", "USD")).toThrow();
    expect(() => toMinor("12.5", "JPY")).toThrow();
  });
  it("formats for PayPal and humans", () => {
    expect(toDecimalString(933, "USD")).toBe("9.33");
    expect(toDecimalString(5, "USD")).toBe("0.05");
    expect(formatMoney(9333, "USD")).toBe("$93.33");
    expect(() => toDecimalString(1.5, "USD")).toThrow();
  });
  it("0.1+0.2 style float bugs cannot occur", () => {
    expect(toMinor("0.10", "USD") + toMinor("0.20", "USD")).toBe(toMinor("0.30", "USD"));
  });
});

const now = new Date("2026-11-05T12:00:00Z");
const capturedAt = new Date("2026-11-05T10:00:00Z");
const base: EvalInput = {
  type: "PRICE_AS_QUOTED", params: { amountMinor: 8400, currency: "USD" }, enforceable: true, currentState: "PENDING",
  capture: { status: "COMPLETED", amountMinor: 9333, currency: "USD", capturedAt, verified: true }, refunds: [], trackers: [], now,
  policy: { shipAtRiskHours: 12, refundAtRiskDays: 1 },
};

describe("deterministic evaluator", () => {
  it("$84 promised vs $93.33 captured → BROKEN with $9.33 discrepancy", () => {
    const r = evaluate(base);
    expect(r.state).toBe("BROKEN");
    expect(r.evaluation).toMatchObject({ discrepancyMinor: 933, outstandingMinor: 933, capturedMinor: 9333, promisedMinor: 8400 });
  });
  it("exact match → KEPT", () => {
    expect(evaluate({ ...base, capture: { ...base.capture!, amountMinor: 8400 } }).state).toBe("KEPT");
  });
  it("unverified capture (webhook body only) is not evidence", () => {
    expect(evaluate({ ...base, capture: { ...base.capture!, verified: false } }).state).toBe("PENDING");
  });
  it("PENDING capture is not final money", () => {
    expect(evaluate({ ...base, capture: { ...base.capture!, status: "PENDING" } }).state).toBe("PENDING");
  });
  it("PENDING refund does not count; COMPLETED refund makes it good", () => {
    const pend = evaluate({ ...base, refunds: [{ refundId: "r1", amountMinor: 933, currency: "USD", status: "PENDING", createdAt: now, verifiedAt: now }] });
    expect(pend.evaluation).toMatchObject({ outstandingMinor: 933 });
    const done = evaluate({ ...base, refunds: [{ refundId: "r1", amountMinor: 933, currency: "USD", status: "COMPLETED", createdAt: now, verifiedAt: now }] });
    expect(done.state).toBe("BROKEN");
    expect(done.evaluation).toMatchObject({ outstandingMinor: 0, madeGood: true });
  });
  it("currency mismatch needs a human", () => {
    expect(evaluate({ ...base, capture: { ...base.capture!, currency: "EUR" } }).state).toBe("NEEDS_CONFIRMATION");
  });
  const ship: EvalInput = { ...base, type: "SHIP_BY", params: { withinHours: 48 } };
  it("SHIP_BY: pending → at risk → broken without tracking", () => {
    expect(evaluate(ship).state).toBe("PENDING");
    expect(evaluate({ ...ship, now: new Date(capturedAt.getTime() + 40 * 3600_000) }).state).toBe("AT_RISK");
    expect(evaluate({ ...ship, now: new Date(capturedAt.getTime() + 49 * 3600_000) }).state).toBe("BROKEN");
  });
  it("SHIP_BY: tracker before deadline → KEPT; after → BROKEN", () => {
    expect(evaluate({ ...ship, trackers: [{ trackingNumber: "T1", recordedAt: new Date(capturedAt.getTime() + 47 * 3600_000) }] }).state).toBe("KEPT");
    expect(evaluate({ ...ship, now: new Date(capturedAt.getTime() + 60 * 3600_000), trackers: [{ trackingNumber: "T1", recordedAt: new Date(capturedAt.getTime() + 50 * 3600_000) }] }).state).toBe("BROKEN");
  });
  const refund: EvalInput = { ...base, type: "REFUND_BY", params: { withinDays: 5, trigger: "RETURN_RECEIVED" } };
  it("REFUND_BY: not started until trigger recorded", () => {
    expect(evaluate(refund).state).toBe("PENDING");
  });
  it("REFUND_BY: completed within window KEPT, pending refund AT_RISK, nothing past deadline BROKEN", () => {
    const trig = { ...refund, params: { ...refund.params, triggeredAt: "2026-11-01T00:00:00Z" } };
    expect(evaluate({ ...trig, refunds: [{ refundId: "r", amountMinor: 9333, currency: "USD", status: "COMPLETED", createdAt: new Date("2026-11-03T00:00:00Z"), verifiedAt: now }] }).state).toBe("KEPT");
    expect(evaluate({ ...trig, refunds: [{ refundId: "r", amountMinor: 9333, currency: "USD", status: "PENDING", createdAt: new Date("2026-11-03T00:00:00Z"), verifiedAt: now }] }).state).toBe("AT_RISK");
    expect(evaluate({ ...trig, now: new Date("2026-11-07T00:00:00Z") }).state).toBe("BROKEN");
  });
  it("non-enforceable promises are never auto-promoted", () => {
    expect(evaluate({ ...base, enforceable: false, currentState: "UNVERIFIABLE" }).state).toBe("UNVERIFIABLE");
    expect(evaluate({ ...base, currentState: "WAIVED" }).state).toBe("WAIVED");
  });
});

const pctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  policy: DEFAULT_POLICY,
  commitment: { type: "PRICE_AS_QUOTED", state: "BROKEN", enforceable: true, evaluation: { discrepancyMinor: 933, refundedMinor: 0 } },
  capture: { id: "CAP1", status: "COMPLETED", amountMinor: 9333, currency: "USD" },
  refundedMinor: 0, inFlightRefundMinor: 0, otherActiveRemedy: false, ...over,
});

describe("policy engine", () => {
  it("accepts a $9.33 partial refund for a $9.33 overcharge", () => {
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx()).ok).toBe(true);
  });
  it("rejects a refund larger than the computed discrepancy", () => {
    const r = validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 1000, currency: "USD" }, pctx());
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.check === "within_computed_discrepancy")?.ok).toBe(false);
  });
  it("rejects currency mismatch, fractional amounts, disallowed kinds and double remedies", () => {
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "EUR" }, pctx()).ok).toBe(false);
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 9.33, currency: "USD" }, pctx()).ok).toBe(false);
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx({ otherActiveRemedy: true })).ok).toBe(false);
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx({ policy: { ...DEFAULT_POLICY, allowedRemedies: ["MESSAGE_ONLY"] } })).ok).toBe(false);
  });
  it("in-flight refunds reduce what can be refunded (no double refund)", () => {
    const r = validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx({ inFlightRefundMinor: 933 }));
    expect(r.ok).toBe(false);
  });
  it("respects the merchant's cap", () => {
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx({ policy: { ...DEFAULT_POLICY, maxRefundMinor: 500 } })).ok).toBe(false);
  });
  it("won't refund a capture that is still pending", () => {
    expect(validateProposal({ kind: "PARTIAL_REFUND", amountMinor: 933, currency: "USD" }, pctx({ capture: { id: "C", status: "PENDING", amountMinor: 9333, currency: "USD" } })).ok).toBe(false);
  });
});

describe("PayPal parsing + refund request construction", () => {
  it("parses a capture into minor units, including fee/net", () => {
    const c = parseCapture({ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "93.33" }, custom_id: "ko_1",
      seller_receivable_breakdown: { gross_amount: { currency_code: "USD", value: "93.33" }, paypal_fee: { currency_code: "USD", value: "3.75" }, net_amount: { currency_code: "USD", value: "89.58" } } });
    expect(c).toMatchObject({ amountMinor: 9333, feeMinor: 375, netMinor: 8958, customId: "ko_1" });
  });
  it("parses refunds and links back to the capture", () => {
    const r = parseRefund({ id: "R1", status: "PENDING", status_details: { reason: "ECHECK" }, amount: { currency_code: "USD", value: "9.33" },
      links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1" }] });
    expect(r).toMatchObject({ status: "PENDING", amountMinor: 933, captureId: "CAP1", statusReason: "ECHECK" });
  });
  it("builds the exact refund request with idempotency key", () => {
    const req = buildRefundRequest({ captureId: "CAP1", amountMinor: 933, currency: "USD", keptOrderId: "ko_1", noteToPayer: "Sorry", requestId: "req-1" });
    expect(req).toEqual({ method: "POST", path: "/v2/payments/captures/CAP1/refund", headers: { "PayPal-Request-Id": "req-1", Prefer: "return=representation" },
      body: { amount: { currency_code: "USD", value: "9.33" }, custom_id: "ko_1", note_to_payer: "Sorry" } });
  });
  it("reads trackers from an order", () => {
    expect(parseTrackers({ purchase_units: [{ shipping: { trackers: [{ id: "CAP1-TRK123", status: "SHIPPED" }] } }] })[0]).toMatchObject({ trackingNumber: "TRK123", status: "SHIPPED" });
  });
});

describe("webhook signature verification (real RSA crypto)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-cert-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, "key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync("openssl", ["req", "-new", "-x509", "-key", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=messageverificationcerts.sandbox.paypal.com"]);
  const pem = fs.readFileSync(path.join(dir, "cert.pem"), "utf8");
  new X509Certificate(pem);
  const certUrl = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test";
  const body = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1" } });
  const sentAt = new Date().toISOString();
  const headers = { transmissionId: "tx-1", transmissionTime: sentAt, certUrl, authAlgo: "SHA256withRSA", transmissionSig: "" };
  const sign = (msg: string) => createSign("RSA-SHA256").update(msg).sign(privateKey).toString("base64");
  headers.transmissionSig = sign(signedMessage(headers, "WEBHOOK-ID", body));
  const fetcher = async () => pem;

  it("crc32 matches the IEEE reference value", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });
  it("accepts a correctly signed event", async () => {
    expect(await verifyWebhookSignature({ headers, rawBody: body, webhookId: "WEBHOOK-ID", certFetcher: fetcher })).toEqual({ ok: true, method: "local" });
  });
  it("rejects a tampered body", async () => {
    const r = await verifyWebhookSignature({ headers, rawBody: body.replace("CAP1", "CAP2"), webhookId: "WEBHOOK-ID", certFetcher: fetcher });
    expect(r.ok).toBe(false);
  });
  it("rejects a different webhook id, a non-PayPal cert host, and missing config", async () => {
    expect((await verifyWebhookSignature({ headers, rawBody: body, webhookId: "OTHER", certFetcher: fetcher })).ok).toBe(false);
    expect((await verifyWebhookSignature({ headers: { ...headers, certUrl: "https://evil.example/cert" }, rawBody: body, webhookId: "WEBHOOK-ID", certFetcher: fetcher })).ok).toBe(false);
    expect((await verifyWebhookSignature({ headers, rawBody: body, webhookId: undefined, certFetcher: fetcher })).ok).toBe(false);
    expect(isTrustedCertUrl("https://paypal.com.evil.io/x")).toBe(false);
  });
  it("rejects stale transmissions (replay)", async () => {
    const old = { ...headers, transmissionTime: "2020-01-01T00:00:00Z" };
    old.transmissionSig = sign(signedMessage(old, "WEBHOOK-ID", body));
    expect((await verifyWebhookSignature({ headers: old, rawBody: body, webhookId: "WEBHOOK-ID", certFetcher: fetcher })).ok).toBe(false);
  });
});
