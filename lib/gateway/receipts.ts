/**
 * Financial receipts, in two versions.
 *
 * `envelope-receipt/1` was written around PayPal: it has a `paypal` block with PayPal's field names. Those
 * receipts are signed, stored and will verify for ever, and nothing here invalidates them.
 *
 * They could not stay the only format. A rail boundary that moves money through another provider still has
 * to issue a receipt, and writing that provider's capture id into a field called `paypal.captureId` would be
 * a false statement about where money went — the kind of error that survives every application test and
 * fails an audit. So new receipts are `envelope-receipt/2`: provider-neutral, with the provider named, its
 * identifiers labelled by kind, and its status passed through uninterpreted.
 *
 * The second thing v2 fixes is a category error. A signature proves *authority and record-keeping*: that the
 * gateway said this, about this chain of authority, at this time. It cannot prove *delivery*: that the payee
 * has the money. v2 therefore separates `verification.offline` (what a signature proves) from
 * `verification.external` (what only the provider can confirm, and which operation to ask about), and says
 * the difference in a sentence. No code path may report a cryptographically valid receipt as proof of
 * settlement.
 */
import * as E from "../envelope/core";
import type { Rail } from "../rails";
import type { Receipt, ReceiptV1, ReceiptV2, Root, Spend } from "../db/schema";

export const RECEIPT_V1 = "envelope-receipt/1" as const;
export const RECEIPT_V2 = "envelope-receipt/2" as const;
export const RECEIPT_VERSIONS = [RECEIPT_V1, RECEIPT_V2] as const;
export type ReceiptVersion = (typeof RECEIPT_VERSIONS)[number];

export const isReceiptV2 = (r: Receipt | null | undefined): r is ReceiptV2 => Boolean(r && r.v === RECEIPT_V2);
export const isKnownReceiptVersion = (v: unknown): v is ReceiptVersion => v === RECEIPT_V1 || v === RECEIPT_V2;

/**
 * Verify a receipt's own signature. The version string is the signing domain, so a receipt whose version was
 * edited does not verify: there is no version confusion between v1 and v2, and an unknown version is refused
 * outright rather than being tried against a default.
 */
export async function verifyReceiptSignature(r: Receipt): Promise<boolean> {
  if (!r || !isKnownReceiptVersion((r as { v?: unknown }).v)) return false;
  if (typeof r.sig !== "string" || typeof r.gateway !== "string") return false;
  const { sig, ...body } = r;
  return E.verifyDetached(r.gateway, r.v, body, sig).catch(() => false);
}

/** The provider named by a receipt: v2 says it; a v1 receipt is PayPal-shaped by construction. */
export function receiptRail(r: Receipt): string {
  return isReceiptV2(r) ? r.provider.rail : "paypal";
}

/**
 * What the receipt says about settlement, in one shape for both versions, so callers never read a
 * provider-specific field to find out what happened.
 */
export function settlementStateOf(o: { held: boolean; payoutStatus: string | null | undefined }): ReceiptV2["settlement"]["state"] {
  if (o.held) return "credited";
  const s = o.payoutStatus ?? null;
  if (s === "SUCCESS") return "delivered";
  if (s === "UNCLAIMED") return "unclaimed";
  if (s === "REFUNDED" || s === "REVERSED" || s === "FAILED" || s === "RETURNED") return "refunded";
  if (s === "AWAITING_CAPTURE") return "pending_capture";
  return "payout_pending";
}

/** A sentence a person can act on. It never upgrades "asked" to "delivered". */
export function settlementMeaning(state: ReceiptV2["settlement"]["state"], railLabel: string): string {
  switch (state) {
    case "credited": return `The money was captured at ${railLabel} and credited to this agent's balance here. No payout was made.`;
    case "delivered": return `${railLabel} reports the payout delivered to the payee.`;
    case "unclaimed": return `${railLabel} accepted the payout and is holding it for the payee to claim: the address has no account there yet. This is not delivery.`;
    case "payout_pending": return `${railLabel} accepted the payout and has not finished it. This is not delivery yet.`;
    case "pending_capture": return `${railLabel} accepted the capture but has not completed it; nothing was paid out against it.`;
    case "refunded": return `The capture was refunded to the payer's funding source at ${railLabel}; nothing was delivered.`;
  }
}

const OFFLINE = [
  "The gateway's Ed25519 signature over this body (the version string is the signing domain).",
  "Every envelope in the authority chain, each signed by the holder above it, only ever narrowing.",
  "The paying agent's own signature over the request, inside the limits of that chain.",
];

/** Build the provider-neutral body. The caller signs it with the gateway's key. */
export function paymentReceiptV2(a: {
  spend: Spend;
  root: Root;
  rail: Rail;
  custody: "provider" | "gateway-ledger" | "safeguarded-partner";
  externalAccountId: string | null;
  chain: ReceiptV1["chain"];
  settlementState: ReceiptV2["settlement"]["state"];
  providerStatus: string | null;
  paidTo?: ReceiptV1["paidTo"];
  issuedAt: string;
  gateway: string;
}): Omit<ReceiptV2, "sig"> {
  const { spend: s, root, rail } = a;
  const leaf = s.signed.chain[s.signed.chain.length - 1]!.body;
  const held = a.settlementState === "credited";
  const ops: ReceiptV2["providerOps"] = [];
  if (root.authorizationId) ops.push({ kind: "authorization", id: root.authorizationId });
  if (s.captureId) ops.push({ kind: "capture", id: s.captureId });
  if (s.payoutBatchId) ops.push({ kind: "payout", id: s.payoutBatchId });
  if (s.payoutItemId) ops.push({ kind: "payout_item", id: s.payoutItemId });
  if (s.refundId) ops.push({ kind: "refund", id: s.refundId });
  const external = [
    s.captureId ? `The capture ${s.captureId}: ask ${rail.label} for it by id and compare the amount.` : null,
    s.payoutBatchId ? `The payout ${s.payoutBatchId}: ask ${rail.label} whether the payee has actually been paid.` : null,
  ].filter((x): x is string => Boolean(x));
  return {
    v: RECEIPT_V2,
    operation: { kind: "payment", ref: s.id },
    organization: { principal: root.principal, name: root.principalName },
    agent: { key: leaf.holder, label: String(leaf.holderLabel ?? ""), account: E.accountNumber(leaf.holder) },
    authority: {
      principal: root.principal,
      request: s.signed.request,
      requestSig: s.signed.sig,
      chain: a.chain,
      ...(s.delivery ? { releasedBy: { key: s.delivery.by, work: s.delivery.work, note: s.delivery.note, at: s.delivery.at } } : {}),
    },
    amount: { minor: s.amountMinor, currency: s.currency },
    provider: {
      rail: rail.id, label: rail.label, mode: rail.mode,
      custody: held ? "gateway-ledger" : a.custody,
      externalAccountId: a.externalAccountId,
      movedExternally: !held,
    },
    providerOps: ops,
    settlement: {
      state: a.settlementState,
      asOf: a.issuedAt,
      meaning: settlementMeaning(a.settlementState, rail.label),
      providerStatus: a.providerStatus,
    },
    ...(a.paidTo ? { paidTo: a.paidTo } : {}),
    issuedAt: a.issuedAt,
    gateway: a.gateway,
    verification: {
      offline: OFFLINE,
      external: external.length ? external : ["Nothing left this gateway: the money is an internal balance, and no provider record exists for it."],
      note: "A valid signature proves who authorized this payment and that the gateway issued this record. It does not prove the money was delivered: only the provider can confirm that, by the operations named in `external`.",
    },
  };
}

/** Sign a receipt body under its own version. */
export function signReceipt(key: E.KeyPair, body: ReceiptV2): Promise<string> {
  const { sig: _sig, ...rest } = body;
  return E.signDetached(key.privateKey, RECEIPT_V2, rest);
}

export type ReceiptAttribution = {
  rail: string;
  mode: string;
  custody: string;
  externalAccountId: string | null;
  settlement: string;
  /** True for a stored v1 receipt, whose structure names PayPal. Its identifiers may predate neutral naming. */
  legacyV1: boolean;
  ops: { order: string | null; authorization: string | null; capture: string | null; refund: string | null; payout: string | null; payout_item: string | null };
};

/**
 * One neutral view of either receipt version, for pages, the SDK and the MCP server. Nothing here is inferred
 * from a field whose name promises a different provider: v2's identifiers come from `providerOps`.
 */
export function receiptAttribution(r: Receipt): ReceiptAttribution {
  if (isReceiptV2(r)) {
    const pick = (k: ReceiptV2["providerOps"][number]["kind"]) => r.providerOps.find((o) => o.kind === k)?.id ?? null;
    return {
      rail: r.provider.rail, mode: r.provider.mode, custody: r.provider.custody,
      externalAccountId: r.provider.externalAccountId, settlement: r.settlement.state, legacyV1: false,
      ops: { order: pick("order"), authorization: pick("authorization"), capture: pick("capture"), refund: pick("refund"), payout: pick("payout"), payout_item: pick("payout_item") },
    };
  }
  return {
    rail: "paypal", mode: r.paypal.mode, custody: "provider", externalAccountId: null,
    settlement: r.paypal.payoutStatus === "SUCCESS" ? "delivered" : r.paypal.payoutBatchId ? "payout_pending" : "credited",
    legacyV1: true,
    ops: { order: null, authorization: r.paypal.authorizationId, capture: r.paypal.captureId, refund: null, payout: r.paypal.payoutBatchId, payout_item: r.paypal.payoutItemId },
  };
}

/**
 * One flat view of either receipt version, for pages, scripts and the SDK. It never re-labels another
 * provider's identifiers as PayPal's: `provider` and `ops` come from the version that named them.
 */
export type ReceiptView = {
  version: string;
  spend: string;
  request: ReceiptV1["request"];
  requestSig: string;
  chain: ReceiptV1["chain"];
  principal: string;
  paidTo: ReceiptV1["paidTo"] | undefined;
  releasedBy: ReceiptV1["releasedBy"] | undefined;
  amount: { minor: number; currency: string };
  provider: { rail: string; label: string; mode: string; custody: string; externalAccountId: string | null };
  ops: ReceiptAttribution["ops"];
  settlement: { state: string; meaning: string; providerStatus: string | null; asOf: string };
  legacyV1: boolean;
};

export function receiptView(r: Receipt): ReceiptView {
  const a = receiptAttribution(r);
  if (isReceiptV2(r)) {
    return {
      version: r.v, spend: r.operation.ref, request: r.authority.request, requestSig: r.authority.requestSig,
      chain: r.authority.chain, principal: r.authority.principal, paidTo: r.paidTo, releasedBy: r.authority.releasedBy,
      amount: r.amount,
      provider: { rail: r.provider.rail, label: r.provider.label, mode: r.provider.mode, custody: r.provider.custody, externalAccountId: r.provider.externalAccountId },
      ops: a.ops,
      settlement: { state: r.settlement.state, meaning: r.settlement.meaning, providerStatus: r.settlement.providerStatus, asOf: r.settlement.asOf },
      legacyV1: false,
    };
  }
  return {
    version: r.v, spend: r.spend, request: r.request, requestSig: r.requestSig, chain: r.chain, principal: r.principal,
    paidTo: r.paidTo, releasedBy: r.releasedBy, amount: { minor: r.request.amount, currency: r.request.currency },
    provider: { rail: a.rail, label: a.rail === "paypal" ? "PayPal" : a.rail, mode: a.mode, custody: a.custody, externalAccountId: a.externalAccountId },
    ops: a.ops,
    settlement: {
      state: a.settlement,
      meaning: r.paypal.payoutStatus === "SUCCESS" ? "The payout is reported delivered." : "A receipt in the v1 format: it records the capture and the payout request; the provider's own word decides delivery.",
      providerStatus: r.paypal.payoutStatus ?? null, asOf: r.issuedAt,
    },
    legacyV1: true,
  };
}

/** The provider operations a receipt names, for the independent check the proof graph points at. */
export function receiptOperations(r: Receipt): Array<{ kind: string; id: string }> {
  const a = receiptAttribution(r);
  return Object.entries(a.ops).filter(([, v]) => Boolean(v)).map(([kind, id]) => ({ kind, id: id! }));
}
