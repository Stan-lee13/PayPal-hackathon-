/**
 * Checks anyone can run on what a gateway hands out, with no trust in the gateway that served it.
 * Each takes the gateway's public key as the caller knows it (`pinned`): a document signed by some
 * other key is not accepted just because its signature is valid.
 */
import * as E from "../../lib/envelope/core";
import type { Check, PromiseNote, Receipt, ReceiptResponse, Reference, Standing, TransferReceipt } from "./types";

export type Verification = { ok: boolean; checks: Check[] };
const verdict = (checks: Check[]): Verification => ({ ok: checks.every((c) => c.ok), checks });

async function signedBy<T extends { sig: string; gateway: string }>(doc: T, domain: string): Promise<boolean> {
  if (!doc || typeof doc.sig !== "string" || typeof doc.gateway !== "string") return false;
  const { sig, ...body } = doc;
  return E.verifyDetached(doc.gateway, domain, body, sig).catch(() => false);
}

/**
 * Re-run, locally, everything a receipt claims: the chain of envelopes back to the owner, the
 * agent's own signature on the request, and the gateway's signature on the receipt.
 * It says who authorized the payment and that the gateway recorded a PayPal capture for it.
 * Whether PayPal has since delivered the payout is in `response.checks` (the gateway asks PayPal)
 * and `response.spend.status`; a signature cannot tell you that.
 */
/**
 * One flat view of either receipt version: who authorized it, what the rail was, and which of that rail's
 * operations to ask about delivery. The neutral names (`provider`, `ops`) never relabel one provider's ids as
 * another's.
 */
export function receiptView(r: Receipt) {
  if ("authority" in r) {
    const op = (k: "order" | "authorization" | "capture" | "refund" | "payout" | "payout_item") => r.providerOps.find((o) => o.kind === k)?.id ?? null;
    return {
      version: r.v, spend: r.operation.ref, request: r.authority.request, requestSig: r.authority.requestSig,
      chain: r.authority.chain, principal: r.authority.principal, paidTo: r.paidTo, releasedBy: r.authority.releasedBy,
      amount: r.amount, provider: { rail: r.provider.rail, label: r.provider.label, mode: r.provider.mode, custody: r.provider.custody, externalAccountId: r.provider.externalAccountId },
      settlement: r.settlement,
      ops: { order: op("order"), authorization: op("authorization"), capture: op("capture"), refund: op("refund"), payout: op("payout"), payout_item: op("payout_item") },
      legacyV1: false,
    };
  }
  return {
    version: r.v, spend: r.spend, request: r.request, requestSig: r.requestSig, chain: r.chain, principal: r.principal,
    paidTo: r.paidTo, releasedBy: r.releasedBy, amount: { minor: r.request.amount, currency: r.request.currency },
    provider: { rail: "paypal", label: "PayPal", mode: r.paypal.mode, custody: "provider", externalAccountId: null },
    settlement: { state: r.paypal.payoutStatus === "SUCCESS" ? "delivered" : r.paypal.payoutBatchId ? "payout_pending" : "credited", asOf: r.issuedAt, meaning: "A v1 receipt: the provider's own word decides delivery.", providerStatus: r.paypal.payoutStatus ?? null },
    ops: { order: null, authorization: r.paypal.authorizationId, capture: r.paypal.captureId, refund: null, payout: r.paypal.payoutBatchId, payout_item: r.paypal.payoutItemId },
    legacyV1: true,
  };
}

/** The request, chain and principal of either receipt version, without reading a provider-specific field. */
const partsOf = (r: Receipt) => "authority" in r
  ? { request: r.authority.request, requestSig: r.authority.requestSig, chain: r.authority.chain, principal: r.authority.principal }
  : { request: r.request, requestSig: r.requestSig, chain: r.chain, principal: r.principal };

export async function verifyReceipt(response: Pick<ReceiptResponse, "receipt" | "chain">, pinned?: string): Promise<Verification> {
  const r: Receipt = response.receipt;
  const parts = partsOf(r);
  const at = new Date(parts.request.at);
  const signed = { request: parts.request as never, sig: parts.requestSig, chain: response.chain };
  const [chain, request, gatewaySig] = await Promise.all([
    E.verifyChain(response.chain, at),
    parts.request.v === E.PROMISE_VERSION ? E.verifyPromise(signed, at) : E.verifySpend(signed, at),
    // The version string is the signing domain: a v1 receipt does not verify as v2, or the reverse.
    signedBy(r, r.v),
  ]);
  const hashes = await Promise.all(response.chain.map((b) => E.blockHash(b).catch(() => "")));
  const sameChain = parts.chain.length === response.chain.length && parts.chain.every((c, i) => c.id === response.chain[i]!.body.id && c.hash === hashes[i]);
  return verdict([
    { name: "Every envelope in the chain is signed by the holder above it, and only narrows it", ok: chain.ok, detail: chain.violations.map((v) => v.code).join(", ") || undefined },
    { name: "The root is signed by the owner's key named on the receipt", ok: chain.principal === parts.principal },
    { name: "The request is signed by the agent the last envelope was given to, and fits its limits", ok: request.ok, detail: request.violations.map((v) => v.code).join(", ") || undefined },
    { name: "The receipt names exactly this chain", ok: sameChain },
    { name: "The receipt is signed by the gateway", ok: gatewaySig },
    ...(pinned ? [{ name: "That gateway key is the one this client knows", ok: r.gateway === pinned }] : []),
    { name: "Delivery is not proved by any signature: ask the provider, by the operation the receipt names", ok: true },
  ]);
}

/** A statement of standing: signed by the gateway, by the key the caller knows, and not yet expired. */
export async function verifyStanding(s: Standing, pinned?: string, now = new Date()): Promise<Verification> {
  return verdict([
    { name: "Signed by the gateway", ok: s?.v === "envelope-standing/1" && (await signedBy(s, "envelope-standing/1")) },
    ...(pinned ? [{ name: "That gateway key is the one this client knows", ok: s?.gateway === pinned }] : []),
    { name: "Still within its five minutes", ok: Date.parse(s?.validUntil) > now.getTime() },
  ]);
}

/** A promise note: signed by the gateway, by the key the caller knows, and the money is still set aside. */
export async function verifyPromiseNote(n: PromiseNote, pinned?: string, now = new Date()): Promise<Verification> {
  return verdict([
    { name: "Signed by the gateway", ok: n?.v === "envelope-promise-note/1" && (await signedBy(n, "envelope-promise-note/1")) },
    ...(pinned ? [{ name: "That gateway key is the one this client knows", ok: n?.gateway === pinned }] : []),
    { name: "The money is still set aside (not expired)", ok: Date.parse(n?.expiresAt) > now.getTime() },
  ]);
}

export async function verifyReference(r: Reference, pinned?: string): Promise<Verification> {
  return verdict([
    { name: "Signed by the gateway", ok: r?.v === "envelope-reference/1" && (await signedBy(r, "envelope-reference/1")) },
    ...(pinned ? [{ name: "That gateway key is the one this client knows", ok: r?.gateway === pinned }] : []),
  ]);
}

export async function verifyTransferReceipt(r: TransferReceipt, pinned?: string): Promise<Verification> {
  const known = r?.v === "envelope-transfer-receipt/1" || r?.v === "envelope-transfer-receipt/2";
  return verdict([
    // The version is the signing domain: v1 stays verifiable, and neither version can pose as the other.
    { name: "Signed by the gateway", ok: known && (await signedBy(r, r.v)) },
    ...(pinned ? [{ name: "That gateway key is the one this client knows", ok: r?.gateway === pinned }] : []),
  ]);
}

/** Tokens are how agents hand each other introductions, promise notes and references: base64url of the JSON. */
export const encodeToken = (doc: unknown): string => E.b64u(new TextEncoder().encode(JSON.stringify(doc)));
export function decodeToken<T = unknown>(token: string): T {
  return JSON.parse(new TextDecoder().decode(E.unb64u(token))) as T;
}
