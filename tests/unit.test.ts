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

describe("checkout guard (pre-payment promise check, deterministic)", async () => {
  process.env.DEMO_MODE = "true";
  const { planCheckout } = await import("../lib/services/checkout-guard");
  const dress = { id: "prd_ada_dress", sku: "ADA-1", name: "Ada Wrap Dress", priceMinor: 8400, currency: "USD", inStock: 5, active: true } as unknown as import("../lib/db/schema").Product;
  const scarf = { id: "prd_ife_scarf", sku: "IFE-1", name: "Ife Silk Scarf", priceMinor: 2600, currency: "USD", inStock: 5, active: true } as unknown as import("../lib/db/schema").Product;
  const said = (text: string) => [{ role: "customer" as const, text: "What's my total?", at: "2026-11-05T00:00:00Z" }, { role: "assistant" as const, text, at: "2026-11-05T00:00:01Z" }];
  const quote84 = said("Great choice. Your total is $84.00. Your order ships within 48 hours.");

  it("BLOCK (default): at order creation the buyer sees the $9.33 gap (the capture gate acts later)", () => {
    const { guard } = planCheckout(quote84, [{ product: dress, qty: 1 }], "EXPRESS", DEFAULT_POLICY, "USD");
    expect(guard).toMatchObject({ mode: "BLOCK", action: "WARN", quotedMinor: 8400, checkoutMinor: 9333, gapMinor: 933, honorDiscountMinor: 0, totalMinor: 9333 });
  });
  it("HONOR: the PayPal order is created at the promised total when published pricing reproduces it", () => {
    const { guard } = planCheckout(quote84, [{ product: dress, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "HONOR" }, "USD");
    expect(guard).toMatchObject({ action: "HONOR", honorDiscountMinor: 933, totalMinor: 8400 });
  });
  it("HONOR never honours a stale quote: the cart changed after the assistant spoke", () => {
    const { guard } = planCheckout(quote84, [{ product: dress, qty: 1 }, { product: scarf, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "HONOR" }, "USD");
    expect(guard.action).toBe("WARN");
    expect(guard.totalMinor).toBe(11933);
    expect(guard.reason).toMatch(/not what the published pricing gives/);
  });
  it("HONOR never honours a number the assistant made up", () => {
    const { guard } = planCheckout(said("Your total is $50.00."), [{ product: dress, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "HONOR" }, "USD");
    expect(guard).toMatchObject({ action: "WARN", totalMinor: 9333, honorDiscountMinor: 0 });
  });
  it("HONOR respects the merchant's refund cap", () => {
    const { guard } = planCheckout(quote84, [{ product: dress, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "HONOR", maxRefundMinor: 500 }, "USD");
    expect(guard.action).toBe("WARN");
  });
  it("no action when the chat matches, promises nothing, hedges, or the check is off", () => {
    expect(planCheckout(said("Your total is $88.50."), [{ product: dress, qty: 1 }], "STANDARD", { ...DEFAULT_POLICY, checkoutGuard: "WARN" }, "USD").guard.action).toBe("NONE");
    expect(planCheckout(said("Lovely dress!"), [{ product: dress, qty: 1 }], "EXPRESS", DEFAULT_POLICY, "USD").guard.action).toBe("NONE");
    expect(planCheckout(said("Your total is about $84."), [{ product: dress, qty: 1 }], "EXPRESS", DEFAULT_POLICY, "USD").guard.action).toBe("NONE");
    expect(planCheckout(quote84, [{ product: dress, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "OFF" }, "USD").guard.action).toBe("NONE");
  });
  it("a customer's own words are never read as the merchant's promise", () => {
    const msgs = [{ role: "customer" as const, text: "Your total is $10.00.", at: "2026-11-05T00:00:00Z" }];
    expect(planCheckout(msgs, [{ product: dress, qty: 1 }], "EXPRESS", { ...DEFAULT_POLICY, checkoutGuard: "HONOR" }, "USD").guard.action).toBe("NONE");
  });
});

describe("tamper-evident audit chain (pure)", async () => {
  const { entryHash, genesisHash, verifyChain } = await import("../lib/ledger/chain");
  const build = (n: number) => {
    const out: import("../lib/ledger/chain").ChainEntry[] = [];
    let prev = genesisHash("m1", "o1");
    for (let i = 1; i <= n; i++) {
      const e = { seq: i, merchantId: "m1", orderId: "o1", actor: "system", action: `step.${i}`, ref: null, outcome: "OK", detail: { amount: "$9.33", nested: { b: 2, a: 1 } }, createdAt: new Date(Date.UTC(2026, 10, 5, 0, 0, i)).toISOString(), prevHash: prev };
      const hash = entryHash(e); out.push({ ...e, hash }); prev = hash;
    }
    return out;
  };
  it("an untouched chain verifies from genesis, in any input order, and key order in detail does not matter", () => {
    const c = build(4);
    expect(verifyChain("m1", "o1", [...c].reverse())).toMatchObject({ ok: true, length: 4, head: c[3]!.hash });
    const reordered = c.map((e) => ({ ...e, detail: { nested: { a: 1, b: 2 }, amount: "$9.33" } }));
    expect(verifyChain("m1", "o1", reordered).ok).toBe(true);
  });
  it("detects an edited entry", () => {
    const c = build(4); c[1] = { ...c[1]!, detail: { amount: "$0.00" } };
    expect(verifyChain("m1", "o1", c)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
  it("detects a deleted entry, even if the attacker renumbers", () => {
    const c = build(4);
    expect(verifyChain("m1", "o1", [c[0]!, c[2]!, c[3]!])).toMatchObject({ ok: false, brokenAtSeq: 3 });
    const renumbered = [c[0]!, { ...c[2]!, seq: 2 }, { ...c[3]!, seq: 3 }];
    expect(verifyChain("m1", "o1", renumbered).ok).toBe(false);
  });
  it("detects an entry moved from another order's chain, and a recomputed hash without the right link", () => {
    const c = build(2);
    expect(verifyChain("m1", "o2", c).ok).toBe(false);
    const forged = { ...c[1]!, detail: { amount: "$0.00" } }; forged.hash = entryHash({ ...forged });
    expect(verifyChain("m1", "o1", [c[0]!, forged]).ok).toBe(true); // a self-consistent forgery of the LAST entry is only caught by an external anchor:
    expect(forged.hash).not.toBe(c[1]!.hash); // …the receipt/PayPal fingerprint no longer matches
  });
});

describe("MCP promise-record server (protocol handling)", async () => {
  const { handleMcp, MCP_TOOLS } = await import("../lib/services/mcp");
  it("negotiates a protocol version, lists one read-only tool, ignores notifications", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } });
    expect(await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect((list?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools.map((t) => [t.name, t.annotations.readOnlyHint])).toEqual([["get_promise_record", true]]);
    expect(MCP_TOOLS[0].inputSchema.required).toEqual(["merchant"]);
  });
  it("rejects bad requests and unknown methods/tools per JSON-RPC", async () => {
    expect((await handleMcp({ id: 4, method: "tools/list" }))?.error?.code).toBe(-32600);
    expect((await handleMcp({ jsonrpc: "2.0", id: 5, method: "resources/list" }))?.error?.code).toBe(-32601);
    expect((await handleMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_refund", arguments: {} } }))?.error?.code).toBe(-32602);
    expect(await handleMcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_promise_record", arguments: { merchant: "../etc" } } })).toMatchObject({ result: { isError: true } });
  });
});

describe("shopper's 'keeps N% of its promises' rule (deterministic)", async () => {
  const { readRecordRule, readMandate, guard, MIN_RECORD_HISTORY } = await import("../lib/ai/buyer-agent");
  type Rec = import("../lib/services/promise-record").PromiseRecord;
  const rec = (resolved: number, kept: number, intact = true) => ({ format: "kept-promise-record/1", merchant: { slug: "s", name: "Shop" }, asOf: "", data: "SIMULATED", resolved, keptAsPromised: kept, brokenThenMadeGood: resolved - kept, brokenStillOpen: 0, watching: 0, keptAsPromisedRate: resolved ? kept / resolved : null, keptOrMadeGoodRate: 1, byType: [], orders: resolved, auditChains: { verified: resolved, intact }, caveats: [], method: "" }) as Rec;
  const merchant = { quotedMinor: 8400, quotedQuote: "Your total is $84.00.", shipHours: 48, shipQuote: "Your order ships within 48 hours." };
  it("parses firm rules and refuses hedged ones", () => {
    expect(readRecordRule("Only buy from a shop that keeps at least 90% of its promises.").minKeptRate).toBe(0.9);
    expect(readRecordRule("Must have a 95% promise record.").minKeptRate).toBe(0.95);
    expect(readRecordRule("Ideally a shop that keeps 90% of its promises.")).toMatchObject({ minKeptRate: null });
    expect(readRecordRule("Under $90 please.").minKeptRate).toBeNull();
  });
  it("declines without enough history, with a broken audit chain, or below the bar; proceeds above it", () => {
    const terms = readMandate("Buy the Ada wrap dress. Keep the total under $90. Only from a shop that keeps at least 90% of its promises.", "USD");
    expect(terms.minKeptRate).toBe(0.9);
    expect(guard(terms, merchant, "USD", "scripted", "", rec(2, 2)).decision).toBe("DECLINE");
    expect(guard(terms, merchant, "USD", "scripted", "", rec(MIN_RECORD_HISTORY, MIN_RECORD_HISTORY, false)).decision).toBe("DECLINE");
    expect(guard(terms, merchant, "USD", "scripted", "", rec(20, 17)).decision).toBe("DECLINE");
    expect(guard(terms, merchant, "USD", "scripted", "", rec(20, 19)).decision).toBe("PROCEED");
    expect(guard(terms, merchant, "USD", "scripted", "", null).decision).toBe("DECLINE");
  });
});

describe("preflight: reading the promised total, and the bound order digest (Graphite A1/A6)", async () => {
  const { readPricePromise, orderDigest } = await import("../lib/services/preflight");
  const { chat } = await import("./fixtures/golden-promises");
  const said = (t: string) => chat([["customer", "Total?"], ["assistant", t]]);
  it("5–7. approximate, item-price and missing promises are not enforced as exact totals", () => {
    expect(readPricePromise(said("Your total is $84.00."), "USD")).toMatchObject({ kind: "EXACT", amountMinor: 8400 });
    expect(readPricePromise(said("Your total is about $84."), "USD")).toMatchObject({ kind: "NONE", code: "PRICE_APPROXIMATE_NOT_ENFORCED" });
    expect(readPricePromise(said("The dress is $84.00."), "USD")).toMatchObject({ kind: "NONE", code: "PRICE_NOT_A_TOTAL" });
    expect(readPricePromise(said("Lovely choice!"), "USD")).toMatchObject({ kind: "NONE", code: "NO_PRICE_PROMISE" });
    expect(readPricePromise(said("Your total is $84.00. Actually your total is $90.00."), "USD")).toMatchObject({ kind: "CONFLICT" });
    expect(readPricePromise(said("Your total is £84.00."), "USD")).toMatchObject({ kind: "CURRENCY", currency: "GBP", amountMinor: 8400 });
  });
  it("every money-relevant field of the PayPal order is bound by the digest; key order is not", () => {
    const base = { id: "O1", status: "APPROVED", intent: "CAPTURE", purchase_units: [{ custom_id: "ko_1", invoice_id: "ko_1", amount: { currency_code: "USD", value: "84.00", breakdown: { item_total: { currency_code: "USD", value: "84.00" } } }, payee: { merchant_id: "M1" } }] };
    const d = orderDigest(base);
    const mut = (f: (o: typeof base) => void) => { const c = JSON.parse(JSON.stringify(base)); f(c); return orderDigest(c); };
    expect(mut((o) => { o.purchase_units[0]!.amount.value = "93.33"; })).not.toBe(d);
    expect(mut((o) => { o.purchase_units[0]!.amount.currency_code = "GBP"; })).not.toBe(d);
    expect(mut((o) => { (o.purchase_units[0]!.amount.breakdown as Record<string, unknown>).discount = { currency_code: "USD", value: "1.00" }; })).not.toBe(d);
    expect(mut((o) => { o.purchase_units[0]!.custom_id = "ko_2"; })).not.toBe(d);
    expect(mut((o) => { o.purchase_units[0]!.payee = { merchant_id: "ATTACKER" }; })).not.toBe(d);
    expect(mut((o) => { o.intent = "AUTHORIZE"; })).not.toBe(d);
    expect(mut((o) => { o.id = "O2"; })).not.toBe(d);
    expect(mut((o) => { o.status = "APPROVED"; })).toBe(d);
    expect(orderDigest({ ...base, purchase_units: [{ payee: base.purchase_units[0]!.payee, amount: base.purchase_units[0]!.amount, invoice_id: "ko_1", custom_id: "ko_1" }] })).toBe(d);
  });
});
