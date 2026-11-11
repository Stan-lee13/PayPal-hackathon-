/**
 * Envelope — spending authority that can be split but never enlarged.
 *
 * An envelope is a chain of signed blocks. Block 0 is sealed by a human principal for an agent.
 * Whoever holds an envelope can split off a sub-envelope for another agent by appending a block
 * signed with their own key; the new block may only NARROW what the parent allows (less money,
 * fewer payees, fewer purposes, earlier expiry, less delegation depth). Splitting needs no server.
 *
 * To spend, the holder signs a spend request with the key named in the last block (proof of
 * possession) and presents request + chain to a gateway, which verifies everything here and then
 * applies the stateful rules (budgets at every level, revocation, replay) before touching PayPal.
 *
 * This module is pure and isomorphic (WebCrypto Ed25519 + SHA-256): the same code verifies an
 * envelope in the browser, in an agent's process and in the gateway.
 *
 * Prior art this pattern comes from: macaroons, Biscuit, UCAN, L402, and the 2026 IETF drafts on
 * attenuating agent tokens. What is added here: money-denominated caps debited at every ancestor,
 * and receipts that bind a PayPal transaction to the full chain (see lib/gateway).
 */

export const BLOCK_VERSION = "envelope/1" as const;
export const SPEND_VERSION = "envelope-spend/1" as const;
export const REVOKE_VERSION = "envelope-revoke/1" as const;
/** A request for a statement of standing ("can this agent pay me?"). Same shape as a spend, different signature domain, so it can never be replayed as a payment. */
export const HELLO_VERSION = "envelope-hello/1" as const;
/** A request to set money aside for one payee ("earmark"). Same shape as a spend plus a lifetime; its own signature domain. */
export const PROMISE_VERSION = "envelope-promise/1" as const;
/** The holder's later decision on its own promise: pay it or release it. */
export const KEEP_VERSION = "envelope-keep/1" as const;
/** An agent's account for RECEIVING money: where payments to its account number are settled. */
export const ACCOUNT_VERSION = "envelope-account/1" as const;

export type Caps = {
  currency: string;
  /** Total this envelope may ever spend, in minor units. Spending also counts against every ancestor. */
  limit: number;
  /** Largest single payment, minor units. */
  perPayment: number;
  /** Exact PayPal payee emails (lower-case). null = any payee the parent allows. */
  payees: string[] | null;
  /** Allowed purpose tags. null = any purpose the parent allows. */
  purposes: string[] | null;
  /** ISO time after which the envelope is dead. */
  notAfter: string;
  /** How many more times this authority may be split. 0 = cannot be passed on. */
  splits: number;
};

export type BlockBody = {
  v: typeof BLOCK_VERSION;
  /** Random id of this block. */
  id: string;
  /** Id of the root block (equals `id` for the root). */
  root: string;
  /** SHA-256 of the parent block, or null for the root. */
  parent: string | null;
  /** Public key that signed this block: the principal for the root, the parent's holder otherwise. */
  issuer: string;
  /** Public key of the agent this block gives authority to. */
  holder: string;
  holderLabel: string;
  caps: Caps;
  issuedAt: string;
};
export type Block = { body: BlockBody; sig: string };
export type Envelope = Block[];

export type SpendRequest = {
  v: typeof SPEND_VERSION;
  /** Id of the last block of the chain being used. */
  leaf: string;
  amount: number;
  currency: string;
  payee: string;
  purpose: string;
  memo: string;
  nonce: string;
  at: string;
};
export type SignedSpend = { request: SpendRequest; sig: string; chain: Envelope };
/** An agent introducing itself to a counterparty: "I hold this envelope and intend to pay you this much for this". Moves no money. */
export type HelloRequest = Omit<SpendRequest, "v" | "memo"> & { v: typeof HELLO_VERSION };
export type SignedHello = { request: HelloRequest; sig: string; chain: Envelope };

/** "Set this much aside for this payee until `ttl` seconds from now." Reserves at every level like a spend; moves no money. */
export type PromiseRequest = Omit<SpendRequest, "v"> & { v: typeof PROMISE_VERSION; ttl: number };
export type SignedPromise = { request: PromiseRequest; sig: string; chain: Envelope };
export type KeepRequest = { v: typeof KEEP_VERSION; promise: string; action: "pay" | "release"; nonce: string; at: string };
export type SignedKeep = { request: KeepRequest; sig: string; by: string };

/**
 * Opening an account that can receive. Signed twice: by the agent's own key (so nobody can point
 * someone else's account number at their own PayPal address) and by the owner who answers for it.
 */
export type AccountBody = { v: typeof ACCOUNT_VERSION; agent: string; label: string; owner: string; ownerName: string; settleTo: string; at: string };
export type SignedAccount = { body: AccountBody; agentSig: string; ownerSig: string };

export type RevokeRequest = { v: typeof REVOKE_VERSION; block: string; nonce: string; at: string };
export type SignedRevoke = { request: RevokeRequest; sig: string; by: string };

export type Reason =
  | "MALFORMED" | "BAD_SIGNATURE" | "BROKEN_LINK" | "WRONG_ISSUER" | "WRONG_ROOT"
  | "WIDENED_LIMIT" | "WIDENED_PER_PAYMENT" | "WIDENED_PAYEES" | "WIDENED_PURPOSES" | "EXTENDED_EXPIRY" | "SPLIT_NOT_ALLOWED" | "CURRENCY_CHANGED"
  | "EXPIRED" | "NOT_THE_HOLDER" | "STALE_REQUEST" | "WRONG_LEAF"
  | "OVER_PER_PAYMENT" | "PAYEE_NOT_ALLOWED" | "PURPOSE_NOT_ALLOWED" | "WRONG_CURRENCY" | "BAD_AMOUNT"
  // stateful (gateway)
  | "PAYEE_ACCOUNT_UNKNOWN" | "PROMISE_LAPSED"
  | "UNKNOWN_ROOT" | "ROOT_NOT_FUNDED" | "REVOKED" | "REPLAY" | "OVER_ENVELOPE_LIMIT" | "OVER_ANCESTOR_LIMIT" | "FORKED_BLOCK"
  | "PAYPAL_CAPTURE_FAILED" | "PAYPAL_PAYOUT_FAILED";

export type Violation = { code: Reason; at: string | null; detail: string };

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** JSON with keys sorted at every level: the bytes that get signed and hashed. */
export function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(norm(v));
}

const enc = new TextEncoder();
export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
export function randomId(prefix: string): string {
  return `${prefix}_${b64u(crypto.getRandomValues(new Uint8Array(12)))}`;
}

// ---------------------------------------------------------------------------
// Keys and signatures (Ed25519)
// ---------------------------------------------------------------------------

export type KeyPair = { publicKey: string; privateKey: CryptoKey };

export async function generateKeyPair(extractable = true): Promise<KeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, extractable, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), privateKey: kp.privateKey };
}
export async function exportPrivateJwk(k: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", k);
}
export async function importPrivateJwk(jwk: JsonWebKey): Promise<KeyPair> {
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["sign"]);
  return { publicKey: jwk.x!, privateKey };
}
async function sign(privateKey: CryptoKey, domain: string, payload: unknown): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, enc.encode(`${domain}\n${canonical(payload)}`))));
}
async function verify(publicKey: string, domain: string, payload: unknown, sig: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", unb64u(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, unb64u(sig), enc.encode(`${domain}\n${canonical(payload)}`));
  } catch {
    return false;
  }
}
export const signDetached = sign;
export const verifyDetached = verify;

export async function blockHash(b: Block): Promise<string> {
  return sha256(canonical(b));
}

// ---------------------------------------------------------------------------
// Sealing and splitting
// ---------------------------------------------------------------------------

export function normalizeCaps(c: Caps): Caps {
  const list = (x: string[] | null) => (x === null ? null : [...new Set(x.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort());
  return { currency: c.currency.toUpperCase(), limit: c.limit, perPayment: Math.min(c.perPayment, c.limit), payees: list(c.payees), purposes: list(c.purposes), notAfter: new Date(c.notAfter).toISOString(), splits: c.splits };
}

function capsShapeProblems(c: Caps): string | null {
  if (!c || typeof c !== "object") return "caps missing";
  if (!/^[A-Z]{3}$/.test(c.currency ?? "")) return "currency";
  for (const k of ["limit", "perPayment", "splits"] as const) if (!Number.isSafeInteger(c[k]) || c[k] < 0) return k;
  if (c.limit <= 0 || c.perPayment <= 0) return "limit and perPayment must be positive";
  if (Number.isNaN(Date.parse(c.notAfter))) return "notAfter";
  for (const k of ["payees", "purposes"] as const) if (c[k] !== null && (!Array.isArray(c[k]) || c[k]!.some((s) => typeof s !== "string" || !s))) return k;
  return null;
}

/** A principal seals a root envelope for an agent. */
export async function seal(principal: KeyPair, holder: { publicKey: string; label: string }, caps: Caps, now = new Date()): Promise<Envelope> {
  const id = randomId("env");
  const body: BlockBody = { v: BLOCK_VERSION, id, root: id, parent: null, issuer: principal.publicKey, holder: holder.publicKey, holderLabel: holder.label, caps: normalizeCaps(caps), issuedAt: now.toISOString() };
  const problem = capsShapeProblems(body.caps);
  if (problem) throw new Error(`Invalid caps: ${problem}`);
  return [{ body, sig: await sign(principal.privateKey, BLOCK_VERSION, body) }];
}

/** Minor units as a readable amount, for messages only. */
export const money = (minor: number, currency = "USD") => `${currency === "USD" ? "$" : ""}${(minor / 100).toFixed(2)}${currency === "USD" ? "" : " " + currency}`;

/** Ways `child` is wider than `parent`. Empty = a valid narrowing. */
export function narrowingViolations(parent: Caps, child: Caps, at: string | null = null): Violation[] {
  const v: Violation[] = [];
  const add = (code: Reason, detail: string) => v.push({ code, at, detail });
  if (child.currency !== parent.currency) add("CURRENCY_CHANGED", `${parent.currency} → ${child.currency}`);
  if (child.limit > parent.limit) add("WIDENED_LIMIT", `limit ${money(child.limit, parent.currency)} is more than the parent's ${money(parent.limit, parent.currency)}`);
  if (child.perPayment > parent.perPayment) add("WIDENED_PER_PAYMENT", `per-payment cap ${money(child.perPayment, parent.currency)} is more than the parent's ${money(parent.perPayment, parent.currency)}`);
  if (parent.payees !== null && (child.payees === null || child.payees.some((p) => !parent.payees!.includes(p)))) add("WIDENED_PAYEES", "adds payees the parent doesn't allow");
  if (parent.purposes !== null && (child.purposes === null || child.purposes.some((p) => !parent.purposes!.includes(p)))) add("WIDENED_PURPOSES", "adds purposes the parent doesn't allow");
  if (Date.parse(child.notAfter) > Date.parse(parent.notAfter)) add("EXTENDED_EXPIRY", "expires later than the parent");
  if (parent.splits < 1) add("SPLIT_NOT_ALLOWED", "the parent may not be split");
  else if (child.splits > parent.splits - 1) add("SPLIT_NOT_ALLOWED", `may be split ${child.splits} more times; the parent allows at most ${parent.splits - 1}`);
  return v;
}

/** The holder of `chain` splits off a narrower sub-envelope for another agent. No server involved. */
export async function split(chain: Envelope, holderKey: KeyPair, to: { publicKey: string; label: string }, caps: Caps, now = new Date()): Promise<Envelope> {
  const last = chain[chain.length - 1]!;
  if (last.body.holder !== holderKey.publicKey) throw new Error("Only the holder of an envelope can split it.");
  const next = normalizeCaps(caps);
  const problem = capsShapeProblems(next);
  if (problem) throw new Error(`Invalid caps: ${problem}`);
  const bad = narrowingViolations(last.body.caps, next);
  if (bad.length) throw new Error(`A sub-envelope can only narrow its parent: ${bad.map((b) => b.detail).join("; ")}`);
  const body: BlockBody = { v: BLOCK_VERSION, id: randomId("env"), root: last.body.root, parent: await blockHash(last), issuer: holderKey.publicKey, holder: to.publicKey, holderLabel: to.label, caps: next, issuedAt: now.toISOString() };
  return [...chain, { body, sig: await sign(holderKey.privateKey, BLOCK_VERSION, body) }];
}

// ---------------------------------------------------------------------------
// Verification (stateless part)
// ---------------------------------------------------------------------------

export type ChainVerdict = { ok: boolean; violations: Violation[]; caps: Caps | null; principal: string | null; ids: string[] };

/** Verify signatures, links and narrowing along the whole chain. Does not know about budgets or revocation. */
export async function verifyChain(chain: unknown, now = new Date()): Promise<ChainVerdict> {
  const out: ChainVerdict = { ok: false, violations: [], caps: null, principal: null, ids: [] };
  const fail = (code: Reason, at: string | null, detail: string) => { out.violations.push({ code, at, detail }); };
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > 8) { fail("MALFORMED", null, "an envelope is a chain of 1 to 8 blocks"); return out; }
  const blocks = chain as Envelope;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const body = b?.body;
    if (!body || typeof b.sig !== "string" || body.v !== BLOCK_VERSION || typeof body.id !== "string" || typeof body.holder !== "string" || typeof body.issuer !== "string" || capsShapeProblems(body.caps)) {
      fail("MALFORMED", body?.id ?? null, `block ${i} is malformed`); return out;
    }
    out.ids.push(body.id);
    if (canonical(normalizeCaps(body.caps)) !== canonical(body.caps)) fail("MALFORMED", body.id, "caps are not in normal form");
    if (!(await verify(body.issuer, BLOCK_VERSION, body, b.sig))) fail("BAD_SIGNATURE", body.id, `block ${i} is not signed by its issuer`);
    if (i === 0) {
      if (body.parent !== null || body.root !== body.id) fail("BROKEN_LINK", body.id, "the first block must be a root");
      out.principal = body.issuer;
    } else {
      const prev = blocks[i - 1]!;
      if (body.parent !== (await blockHash(prev))) fail("BROKEN_LINK", body.id, `block ${i} does not point at block ${i - 1}`);
      if (body.root !== blocks[0]!.body.id) fail("WRONG_ROOT", body.id, "block names a different root");
      if (body.issuer !== prev.body.holder) fail("WRONG_ISSUER", body.id, "a sub-envelope must be signed by the holder of its parent");
      out.violations.push(...narrowingViolations(prev.body.caps, body.caps, body.id));
    }
    if (Date.parse(body.caps.notAfter) <= now.getTime()) fail("EXPIRED", body.id, `expired ${body.caps.notAfter}`);
  }
  out.caps = blocks[blocks.length - 1]!.body.caps;
  out.ok = out.violations.length === 0;
  return out;
}

export async function signSpend(chain: Envelope, holderKey: KeyPair, p: { amount: number; payee: string; purpose: string; memo?: string }, now = new Date()): Promise<SignedSpend> {
  const leaf = chain[chain.length - 1]!.body;
  const request: SpendRequest = { v: SPEND_VERSION, leaf: leaf.id, amount: p.amount, currency: leaf.caps.currency, payee: p.payee.trim().toLowerCase(), purpose: p.purpose.trim().toLowerCase(), memo: (p.memo ?? "").slice(0, 200), nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(holderKey.privateKey, SPEND_VERSION, request), chain };
}

/** Requests older or newer than this are refused, which bounds how long a replay cache must be kept. */
export const SPEND_WINDOW_MS = 5 * 60_000;

type Intent = { v: string; leaf: string; amount: number; currency: string; payee: string; purpose: string; nonce: string; at: string };
type IntentVerdict = { ok: boolean; violations: Violation[]; chain: ChainVerdict };

/** Shared by spends and hellos: chain, possession of the leaf key, freshness, and the leaf's caps. */
async function verifyIntent(version: string, s: { request: Intent; sig: string; chain: Envelope }, now: Date): Promise<IntentVerdict> {
  const chain = await verifyChain(s?.chain, now);
  const violations = [...chain.violations];
  const r = s?.request;
  const add = (code: Reason, detail: string) => violations.push({ code, at: r?.leaf ?? null, detail });
  if (!r || r.v !== version || typeof s.sig !== "string" || typeof r.payee !== "string" || typeof r.purpose !== "string" || typeof r.nonce !== "string") { add("MALFORMED", "malformed request"); return { ok: false, violations, chain }; }
  if (!chain.caps) return { ok: false, violations, chain };
  const leaf = s.chain[s.chain.length - 1]!.body;
  if (r.leaf !== leaf.id) add("WRONG_LEAF", "the request names a different envelope than the chain presented");
  if (!(await verify(leaf.holder, version, r, s.sig))) add("NOT_THE_HOLDER", "the request is not signed by the key this envelope was given to");
  if (Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) add("STALE_REQUEST", "the request is outside the 5-minute acceptance window");
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) add("BAD_AMOUNT", "amount must be a positive whole number of minor units");
  const c = chain.caps;
  if (r.currency !== c.currency) add("WRONG_CURRENCY", `this envelope is in ${c.currency}`);
  if (r.amount > c.perPayment) add("OVER_PER_PAYMENT", `${money(r.amount, c.currency)} is over the per-payment cap of ${money(c.perPayment, c.currency)}`);
  if (c.payees !== null && !c.payees.includes(r.payee)) add("PAYEE_NOT_ALLOWED", `${r.payee} is not a payee this envelope allows`);
  if (c.purposes !== null && !c.purposes.includes(r.purpose)) add("PURPOSE_NOT_ALLOWED", `"${r.purpose}" is not a purpose this envelope allows`);
  return { ok: violations.length === 0, violations, chain };
}

/** Everything about a spend that can be decided without state: chain, possession, caps. */
export const verifySpend = (s: SignedSpend, now = new Date()): Promise<IntentVerdict> => verifyIntent(SPEND_VERSION, s, now);

export async function signHello(chain: Envelope, holderKey: KeyPair, p: { amount: number; payee: string; purpose: string }, now = new Date()): Promise<SignedHello> {
  const leaf = chain[chain.length - 1]!.body;
  const request: HelloRequest = { v: HELLO_VERSION, leaf: leaf.id, amount: p.amount, currency: leaf.caps.currency, payee: p.payee.trim().toLowerCase(), purpose: p.purpose.trim().toLowerCase(), nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(holderKey.privateKey, HELLO_VERSION, request), chain };
}
export const verifyHello = (s: SignedHello, now = new Date()): Promise<IntentVerdict> => verifyIntent(HELLO_VERSION, s, now);

/** Longest a promise may hold money aside. */
export const PROMISE_MAX_TTL_S = 3600;
export async function signPromise(chain: Envelope, holderKey: KeyPair, p: { amount: number; payee: string; purpose: string; memo?: string; ttl?: number }, now = new Date()): Promise<SignedPromise> {
  const leaf = chain[chain.length - 1]!.body;
  const request: PromiseRequest = { v: PROMISE_VERSION, leaf: leaf.id, amount: p.amount, currency: leaf.caps.currency, payee: p.payee.trim().toLowerCase(), purpose: p.purpose.trim().toLowerCase(), memo: (p.memo ?? "").slice(0, 200), ttl: p.ttl ?? 900, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(holderKey.privateKey, PROMISE_VERSION, request), chain };
}
export async function verifyPromise(s: SignedPromise, now = new Date()): Promise<IntentVerdict> {
  const v = await verifyIntent(PROMISE_VERSION, s, now);
  const ttl = s?.request?.ttl;
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > PROMISE_MAX_TTL_S) { v.violations.push({ code: "MALFORMED", at: s?.request?.leaf ?? null, detail: `a promise lasts between 30 seconds and ${PROMISE_MAX_TTL_S / 60} minutes` }); v.ok = false; }
  return v;
}
export async function signKeep(by: KeyPair, promise: string, action: KeepRequest["action"], now = new Date()): Promise<SignedKeep> {
  const request: KeepRequest = { v: KEEP_VERSION, promise, action, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(by.privateKey, KEEP_VERSION, request), by: by.publicKey };
}
export async function verifyKeepSignature(k: SignedKeep, now = new Date()): Promise<boolean> {
  if (!k?.request || k.request.v !== KEEP_VERSION || (k.request.action !== "pay" && k.request.action !== "release") || typeof k.request.promise !== "string" || Math.abs(now.getTime() - Date.parse(k.request.at)) > SPEND_WINDOW_MS) return false;
  return verify(k.by, KEEP_VERSION, k.request, k.sig);
}

// ---------------------------------------------------------------------------
// Accounts that receive
// ---------------------------------------------------------------------------

/** How an agent's account is written as a payee: "acct:7k2q-9m4x-t0pa". */
export const accountPayee = (publicKey: string) => `acct:${accountNumber(publicKey).toLowerCase()}`;
export const isAccountPayee = (payee: string) => /^acct:[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/.test(payee);

export async function signAccount(agent: KeyPair, owner: KeyPair, p: { label: string; ownerName: string; settleTo: string }, now = new Date()): Promise<SignedAccount> {
  const body: AccountBody = { v: ACCOUNT_VERSION, agent: agent.publicKey, label: p.label.trim().slice(0, 80), owner: owner.publicKey, ownerName: p.ownerName.trim().slice(0, 80), settleTo: p.settleTo.trim().toLowerCase(), at: now.toISOString() };
  return { body, agentSig: await sign(agent.privateKey, ACCOUNT_VERSION, body), ownerSig: await sign(owner.privateKey, ACCOUNT_VERSION, body) };
}
export async function verifyAccount(a: SignedAccount): Promise<boolean> {
  const b = a?.body;
  if (!b || b.v !== ACCOUNT_VERSION || typeof b.agent !== "string" || typeof b.owner !== "string" || typeof b.label !== "string" || !b.label || typeof b.ownerName !== "string" || Number.isNaN(Date.parse(b.at))) return false;
  if (typeof b.settleTo !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.settleTo) || b.settleTo.length > 127 || b.settleTo !== b.settleTo.toLowerCase()) return false;
  return (await verify(b.agent, ACCOUNT_VERSION, b, a.agentSig)) && (await verify(b.owner, ACCOUNT_VERSION, b, a.ownerSig));
}

export async function signRevoke(by: KeyPair, block: string, now = new Date()): Promise<SignedRevoke> {
  const request: RevokeRequest = { v: REVOKE_VERSION, block, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(by.privateKey, REVOKE_VERSION, request), by: by.publicKey };
}
export async function verifyRevokeSignature(r: SignedRevoke, now = new Date()): Promise<boolean> {
  if (!r?.request || r.request.v !== REVOKE_VERSION || Math.abs(now.getTime() - Date.parse(r.request.at)) > SPEND_WINDOW_MS) return false;
  return verify(r.by, REVOKE_VERSION, r.request, r.sig);
}

/** Short fingerprint of a public key for display. */
export const fingerprint = (publicKey: string) => `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`;

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U
/** A readable account number for an agent, derived from its public key (first 60 bits, base32): "7K2Q-9M4X-T0PA". */
export function accountNumber(publicKey: string): string {
  let bytes: Uint8Array;
  try { bytes = unb64u(publicKey); } catch { return "????-????-????"; }
  let bits = 0, acc = 0, out = "";
  for (let i = 0; i < bytes.length && out.length < 12; i++) {
    acc = (acc << 8) | bytes[i]!; bits += 8;
    while (bits >= 5 && out.length < 12) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`.padEnd(14, "0");
}
