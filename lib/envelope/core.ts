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
/** A statement from the key a promise named: "the work is delivered and accepted; release the money". */
export const ACCEPT_VERSION = "envelope-accept/1" as const;
/** An agent's account for RECEIVING money: where payments to its account number are settled. */
export const ACCOUNT_VERSION = "envelope-account/1" as const;
/** An agent moving money out of its own balance: to another agent, to a PayPal address, or back to its owner. */
export const TRANSFER_VERSION = "envelope-transfer/1" as const;
/** The owner freezing or unfreezing an agent's account. */
export const FREEZE_VERSION = "envelope-freeze/1" as const;
/** A card: an agent's standing permission for ONE merchant to charge its balance, within limits. */
export const CARD_VERSION = "envelope-card/1" as const;
/** A merchant charging a card. Signed by the merchant the card is locked to. */
export const CHARGE_VERSION = "envelope-charge/1" as const;
export const CARD_CANCEL_VERSION = "envelope-card-cancel/1" as const;
/** An owner asking to read their own books. A public key names an owner; only a signature proves who is asking. */
export const READ_VERSION = "envelope-read/1" as const;

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
  /**
   * Optional. A single payment above this amount (minor units) needs the owner's own signature: the
   * agent must set the money aside naming the owner, and only the owner's acceptance pays it.
   * Down the chain it can be lowered, never raised or removed.
   */
  approveOver?: number;
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
export type PromiseRequest = Omit<SpendRequest, "v"> & {
  v: typeof PROMISE_VERSION; ttl: number;
  /**
   * Optional: a public key whose signed acceptance pays this promise without asking its maker again.
   * Name the payee for "paid on delivery", or a third agent that checks the work for "paid on verified work".
   */
  releaseBy?: string;
};
export type SignedPromise = { request: PromiseRequest; sig: string; chain: Envelope };
export type KeepRequest = { v: typeof KEEP_VERSION; promise: string; action: "pay" | "release"; nonce: string; at: string };
export type SignedKeep = { request: KeepRequest; sig: string; by: string };
/** `work` is a SHA-256 fingerprint of what was delivered (or empty); it ends up on the receipt. */
export type AcceptRequest = { v: typeof ACCEPT_VERSION; promise: string; work: string; note: string; nonce: string; at: string; /** Present and true when the named key refuses: the money is released back. */ decline?: true };
export type SignedAccept = { request: AcceptRequest; sig: string; by: string };

/**
 * Opening an account that can receive. Signed twice: by the agent's own key (so nobody can point
 * someone else's account number at their own PayPal address) and by the owner who answers for it.
 */
export type AccountBody = {
  v: typeof ACCOUNT_VERSION; agent: string; label: string; owner: string; ownerName: string; settleTo: string; at: string;
  /** "hold": what the agent earns stays in its account as a balance it can spend. Absent: income is paid straight out to `settleTo`. */
  mode?: "hold";
  /** The most the agent may move out of its balance in one payment (minor units). Set by the owner; absent = no cap. Withdrawals to the owner are never capped. */
  perPayment?: number;
  /** The most that may leave the balance in any 24 hours, payments and card charges together. Set by the owner; absent = no cap. */
  perDay?: number;
};
/**
 * A card is not a number to be kept secret. It is a signed statement by the agent: "this one merchant
 * may charge my balance, at most this much per charge, at most this many times, no more often than
 * this, until then." Only that merchant's key can charge it, so the card's details are worth nothing
 * to anyone else, and it stops by itself.
 */
export type CardBody = {
  v: typeof CARD_VERSION; id: string; holder: string; label: string;
  /** The only account that may charge it, as "acct:xxxx-xxxx-xxxx". */
  merchant: string;
  perCharge: number; maxCharges: number;
  /** Least number of seconds between two charges (a billing period). 0 = no spacing. */
  every: number;
  notAfter: string; at: string;
};
export type SignedCard = { body: CardBody; sig: string };
export type ChargeRequest = { v: typeof CHARGE_VERSION; card: string; merchant: string; amount: number; currency: string; memo: string; nonce: string; at: string };
export type SignedCharge = { request: ChargeRequest; sig: string };
export type CardCancelRequest = { v: typeof CARD_CANCEL_VERSION; card: string; nonce: string; at: string };
export type SignedCardCancel = { request: CardCancelRequest; sig: string; by: string };
export type ReadRequest = { v: typeof READ_VERSION; what: "treasury"; subject: string; nonce: string; at: string };
export type SignedRead = { request: ReadRequest; sig: string; by: string };
export type TransferRequest = { v: typeof TRANSFER_VERSION; from: string; kind: "pay" | "withdraw"; amount: number; currency: string; payee: string; purpose: string; memo: string; nonce: string; at: string };
export type SignedTransfer = { request: TransferRequest; sig: string };
export type FreezeRequest = { v: typeof FREEZE_VERSION; agent: string; frozen: boolean; nonce: string; at: string };
export type SignedFreeze = { request: FreezeRequest; sig: string; by: string };
export type SignedAccount = { body: AccountBody; agentSig: string; ownerSig: string };

export type RevokeRequest = { v: typeof REVOKE_VERSION; block: string; nonce: string; at: string };
export type SignedRevoke = { request: RevokeRequest; sig: string; by: string };

export type Reason =
  | "MALFORMED" | "BAD_SIGNATURE" | "BROKEN_LINK" | "WRONG_ISSUER" | "WRONG_ROOT"
  | "WIDENED_LIMIT" | "WIDENED_PER_PAYMENT" | "WIDENED_PAYEES" | "WIDENED_PURPOSES" | "EXTENDED_EXPIRY" | "SPLIT_NOT_ALLOWED" | "CURRENCY_CHANGED"
  | "EXPIRED" | "NOT_THE_HOLDER" | "STALE_REQUEST" | "WRONG_LEAF"
  | "OVER_PER_PAYMENT" | "PAYEE_NOT_ALLOWED" | "PURPOSE_NOT_ALLOWED" | "WRONG_CURRENCY" | "BAD_AMOUNT"
  // stateful (gateway)
  | "PAYEE_ACCOUNT_UNKNOWN" | "PROMISE_LAPSED" | "NEEDS_OWNER_APPROVAL" | "WIDENED_APPROVAL"
  | "NO_BALANCE_ACCOUNT" | "INSUFFICIENT_BALANCE" | "ACCOUNT_FROZEN" | "OVER_ACCOUNT_LIMIT" | "OVER_DAILY_LIMIT"
  | "UNKNOWN_CARD" | "NOT_THE_MERCHANT" | "CARD_CANCELLED" | "CARD_EXPIRED" | "CARD_USED_UP" | "OVER_CARD_LIMIT" | "CHARGE_TOO_SOON"
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
/**
 * Strict: a value has exactly one accepted spelling. Padding, "+" and "/", whitespace and stray
 * bits in the last character all decode to the same bytes in a lenient decoder, which would let a
 * signed request be presented again as if it were new. Anything but the canonical form throws.
 */
export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (b64u(out) !== s) throw new Error("not canonical base64url");
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
  return { currency: c.currency.toUpperCase(), limit: c.limit, perPayment: Math.min(c.perPayment, c.limit), payees: list(c.payees), purposes: list(c.purposes), notAfter: new Date(c.notAfter).toISOString(), splits: c.splits, ...(c.approveOver !== undefined && c.approveOver !== null ? { approveOver: c.approveOver } : {}) };
}

function capsShapeProblems(c: Caps): string | null {
  if (!c || typeof c !== "object") return "caps missing";
  if (!/^[A-Z]{3}$/.test(c.currency ?? "")) return "currency";
  for (const k of ["limit", "perPayment", "splits"] as const) if (!Number.isSafeInteger(c[k]) || c[k] < 0) return k;
  if (c.limit <= 0 || c.perPayment <= 0) return "limit and perPayment must be positive";
  if (c.approveOver !== undefined && (!Number.isSafeInteger(c.approveOver) || c.approveOver < 0)) return "approveOver";
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
  if (parent.approveOver !== undefined && (child.approveOver === undefined || child.approveOver > parent.approveOver)) add("WIDENED_APPROVAL", `the parent needs the owner's signature above ${money(parent.approveOver, parent.currency)}; a sub-envelope can lower that, not raise or drop it`);
  if (parent.splits < 1) add("SPLIT_NOT_ALLOWED", "the parent may not be split");
  else if (child.splits > parent.splits - 1) add("SPLIT_NOT_ALLOWED", `may be split ${child.splits} more times; the parent allows at most ${parent.splits - 1}`);
  return v;
}

/** The holder of `chain` splits off a narrower sub-envelope for another agent. No server involved. */
export async function split(chain: Envelope, holderKey: KeyPair, to: { publicKey: string; label: string }, caps: Caps, now = new Date()): Promise<Envelope> {
  const last = chain[chain.length - 1]!;
  if (last.body.holder !== holderKey.publicKey) throw new Error("Only the holder of an envelope can split it.");
  // The owner's approval threshold carries down unless the splitter chooses a lower one.
  const next = normalizeCaps({ ...caps, approveOver: caps.approveOver ?? last.body.caps.approveOver });
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
  // Above the owner's threshold, the only thing an agent can do is set the money aside for the owner to sign.
  if (c.approveOver !== undefined && Number.isSafeInteger(r.amount) && r.amount > c.approveOver && !(version === PROMISE_VERSION && (r as { releaseBy?: string }).releaseBy === chain.principal)) {
    add("NEEDS_OWNER_APPROVAL", `payments over ${money(c.approveOver, c.currency)} need the owner's signature: set the money aside naming the owner as the key that releases it`);
  }
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
export async function signPromise(chain: Envelope, holderKey: KeyPair, p: { amount: number; payee: string; purpose: string; memo?: string; ttl?: number; releaseBy?: string }, now = new Date()): Promise<SignedPromise> {
  const leaf = chain[chain.length - 1]!.body;
  const request: PromiseRequest = { v: PROMISE_VERSION, leaf: leaf.id, amount: p.amount, currency: leaf.caps.currency, payee: p.payee.trim().toLowerCase(), purpose: p.purpose.trim().toLowerCase(), memo: (p.memo ?? "").slice(0, 200), ttl: p.ttl ?? 900, ...(p.releaseBy ? { releaseBy: p.releaseBy } : {}), nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(holderKey.privateKey, PROMISE_VERSION, request), chain };
}
export async function verifyPromise(s: SignedPromise, now = new Date()): Promise<IntentVerdict> {
  const v = await verifyIntent(PROMISE_VERSION, s, now);
  const ttl = s?.request?.ttl;
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > PROMISE_MAX_TTL_S) { v.violations.push({ code: "MALFORMED", at: s?.request?.leaf ?? null, detail: `a promise lasts between 30 seconds and ${PROMISE_MAX_TTL_S / 60} minutes` }); v.ok = false; }
  const rb = s?.request?.releaseBy;
  if (rb !== undefined && (typeof rb !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(rb))) { v.violations.push({ code: "MALFORMED", at: s?.request?.leaf ?? null, detail: "releaseBy must be a public key" }); v.ok = false; }
  return v;
}
export async function signAccept(by: KeyPair, promise: string, p: { work?: string; note?: string; decline?: boolean } = {}, now = new Date()): Promise<SignedAccept> {
  const request: AcceptRequest = { v: ACCEPT_VERSION, promise, work: (p.work ?? "").slice(0, 64), note: (p.note ?? "").slice(0, 200), nonce: randomId("n"), at: now.toISOString(), ...(p.decline ? { decline: true as const } : {}) };
  return { request, sig: await sign(by.privateKey, ACCEPT_VERSION, request), by: by.publicKey };
}
export async function verifyAcceptSignature(a: SignedAccept, now = new Date()): Promise<boolean> {
  const r = a?.request;
  if (!r || r.v !== ACCEPT_VERSION || typeof r.promise !== "string" || typeof r.work !== "string" || !/^([0-9a-f]{64})?$/.test(r.work) || typeof r.note !== "string" || r.note.length > 200 || (r.decline !== undefined && r.decline !== true) || Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) return false;
  return verify(a.by, ACCEPT_VERSION, r, a.sig);
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

export async function signAccount(agent: KeyPair, owner: KeyPair, p: { label: string; ownerName: string; settleTo: string; mode?: "hold"; perPayment?: number; perDay?: number }, now = new Date()): Promise<SignedAccount> {
  const body: AccountBody = { v: ACCOUNT_VERSION, agent: agent.publicKey, label: p.label.trim().slice(0, 80), owner: owner.publicKey, ownerName: p.ownerName.trim().slice(0, 80), settleTo: p.settleTo.trim().toLowerCase(), at: now.toISOString(), ...(p.mode ? { mode: p.mode } : {}), ...(p.perPayment !== undefined ? { perPayment: p.perPayment } : {}), ...(p.perDay !== undefined ? { perDay: p.perDay } : {}) };
  return { body, agentSig: await sign(agent.privateKey, ACCOUNT_VERSION, body), ownerSig: await sign(owner.privateKey, ACCOUNT_VERSION, body) };
}
export async function verifyAccount(a: SignedAccount): Promise<boolean> {
  const b = a?.body;
  if (!b || b.v !== ACCOUNT_VERSION || typeof b.agent !== "string" || typeof b.owner !== "string" || typeof b.label !== "string" || !b.label || typeof b.ownerName !== "string" || Number.isNaN(Date.parse(b.at))) return false;
  if (typeof b.settleTo !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.settleTo) || b.settleTo.length > 127 || b.settleTo !== b.settleTo.toLowerCase()) return false;
  if (b.mode !== undefined && b.mode !== "hold") return false;
  if (b.perPayment !== undefined && (!Number.isSafeInteger(b.perPayment) || b.perPayment <= 0)) return false;
  if (b.perDay !== undefined && (!Number.isSafeInteger(b.perDay) || b.perDay <= 0)) return false;
  return (await verify(b.agent, ACCOUNT_VERSION, b, a.agentSig)) && (await verify(b.owner, ACCOUNT_VERSION, b, a.ownerSig));
}

/** An agent signs a movement out of its own balance. `kind: "withdraw"` sends it to the owner's settlement address. */
export async function signTransfer(agent: KeyPair, p: { kind?: "pay" | "withdraw"; amount: number; payee?: string; purpose?: string; memo?: string }, now = new Date()): Promise<SignedTransfer> {
  const kind = p.kind ?? "pay";
  const request: TransferRequest = { v: TRANSFER_VERSION, from: agent.publicKey, kind, amount: p.amount, currency: "USD", payee: kind === "withdraw" ? "owner" : (p.payee ?? "").trim().toLowerCase(), purpose: (p.purpose ?? (kind === "withdraw" ? "withdrawal" : "")).trim().toLowerCase().slice(0, 60), memo: (p.memo ?? "").slice(0, 200), nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(agent.privateKey, TRANSFER_VERSION, request) };
}
/** Shape, freshness and the agent's signature. Balances and limits are the gateway's to check. */
export async function verifyTransfer(t: SignedTransfer, now = new Date()): Promise<Violation[]> {
  const r = t?.request;
  const v: Violation[] = [];
  if (!r || r.v !== TRANSFER_VERSION || typeof t.sig !== "string" || typeof r.from !== "string" || (r.kind !== "pay" && r.kind !== "withdraw") || typeof r.payee !== "string" || typeof r.purpose !== "string" || typeof r.memo !== "string" || typeof r.nonce !== "string" || r.memo.length > 200) return [{ code: "MALFORMED", at: null, detail: "malformed transfer" }];
  if (!(await verify(r.from, TRANSFER_VERSION, r, t.sig))) v.push({ code: "NOT_THE_HOLDER", at: null, detail: "the transfer is not signed by the key that owns the account" });
  if (Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) v.push({ code: "STALE_REQUEST", at: null, detail: "the request is outside the 5-minute acceptance window" });
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) v.push({ code: "BAD_AMOUNT", at: null, detail: "amount must be a positive whole number of minor units" });
  if (r.currency !== "USD") v.push({ code: "WRONG_CURRENCY", at: null, detail: "balances are in USD" });
  if (r.kind === "pay" && !isAccountPayee(r.payee) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.payee)) v.push({ code: "MALFORMED", at: null, detail: "the payee must be an account (acct:…) or a PayPal address" });
  return v;
}
/** Longest a card may live, and the most charges it may allow. */
export const CARD_MAX_LIFE_MS = 2 * 366 * 86_400_000;
export const CARD_MAX_CHARGES = 120;
/** An agent issues a card on its own balance for one merchant. `every` and `life` are in seconds. */
export async function signCard(agent: KeyPair, p: { merchant: string; label: string; perCharge: number; maxCharges: number; every?: number; life: number }, now = new Date()): Promise<SignedCard> {
  const body: CardBody = { v: CARD_VERSION, id: randomId("card"), holder: agent.publicKey, label: p.label.trim().slice(0, 60), merchant: p.merchant.trim().toLowerCase(), perCharge: p.perCharge, maxCharges: p.maxCharges, every: p.every ?? 0, notAfter: new Date(now.getTime() + p.life * 1000).toISOString(), at: now.toISOString() };
  return { body, sig: await sign(agent.privateKey, CARD_VERSION, body) };
}
/** Shape, sanity of the limits, and the holder's signature. Whether the accounts exist is the gateway's to check. */
export async function verifyCard(c: SignedCard, now = new Date()): Promise<Violation[]> {
  const b = c?.body;
  const bad = (detail: string): Violation[] => [{ code: "MALFORMED", at: null, detail }];
  if (!b || b.v !== CARD_VERSION || typeof c.sig !== "string" || typeof b.id !== "string" || !/^card_[A-Za-z0-9_-]{8,40}$/.test(b.id) || typeof b.holder !== "string" || typeof b.label !== "string" || !b.label.trim() || b.label.length > 60 || typeof b.merchant !== "string") return bad("malformed card");
  if (!isAccountPayee(b.merchant)) return bad("a card must be locked to one merchant's account (acct:…)");
  if (!Number.isSafeInteger(b.perCharge) || b.perCharge <= 0) return bad("the cap per charge must be a positive whole number of minor units");
  if (!Number.isSafeInteger(b.maxCharges) || b.maxCharges < 1 || b.maxCharges > CARD_MAX_CHARGES) return bad(`a card allows between 1 and ${CARD_MAX_CHARGES} charges`);
  if (!Number.isSafeInteger(b.every) || b.every < 0 || b.every > 366 * 86_400) return bad("the spacing between charges must be between 0 seconds and a year");
  const [at, end] = [Date.parse(b.at), Date.parse(b.notAfter)];
  if (!Number.isFinite(at) || !Number.isFinite(end) || end <= at || end - at > CARD_MAX_LIFE_MS) return bad("a card needs an expiry after its issue, at most two years on");
  const v: Violation[] = [];
  if (!(await verify(b.holder, CARD_VERSION, b, c.sig))) v.push({ code: "NOT_THE_HOLDER", at: null, detail: "the card is not signed by the key whose balance it would charge" });
  if (Math.abs(now.getTime() - at) > SPEND_WINDOW_MS) v.push({ code: "STALE_REQUEST", at: null, detail: "a card must be presented within 5 minutes of being signed" });
  return v;
}
/** The merchant a card is locked to asks for money. */
export async function signCharge(merchant: KeyPair, p: { card: string; amount: number; memo?: string }, now = new Date()): Promise<SignedCharge> {
  const request: ChargeRequest = { v: CHARGE_VERSION, card: p.card, merchant: merchant.publicKey, amount: p.amount, currency: "USD", memo: (p.memo ?? "").slice(0, 200), nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(merchant.privateKey, CHARGE_VERSION, request) };
}
export async function verifyCharge(c: SignedCharge, now = new Date()): Promise<Violation[]> {
  const r = c?.request;
  if (!r || r.v !== CHARGE_VERSION || typeof c.sig !== "string" || typeof r.card !== "string" || typeof r.merchant !== "string" || typeof r.memo !== "string" || r.memo.length > 200 || typeof r.nonce !== "string") return [{ code: "MALFORMED", at: null, detail: "malformed charge" }];
  const v: Violation[] = [];
  if (!(await verify(r.merchant, CHARGE_VERSION, r, c.sig))) v.push({ code: "NOT_THE_MERCHANT", at: null, detail: "the charge is not signed by the key it names" });
  if (Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) v.push({ code: "STALE_REQUEST", at: null, detail: "the request is outside the 5-minute acceptance window" });
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) v.push({ code: "BAD_AMOUNT", at: null, detail: "amount must be a positive whole number of minor units" });
  if (r.currency !== "USD") v.push({ code: "WRONG_CURRENCY", at: null, detail: "balances are in USD" });
  return v;
}
/** The card's holder, or the owner of the holder's account, cancels a card. It cannot be undone. */
export async function signCardCancel(by: KeyPair, card: string, now = new Date()): Promise<SignedCardCancel> {
  const request: CardCancelRequest = { v: CARD_CANCEL_VERSION, card, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(by.privateKey, CARD_CANCEL_VERSION, request), by: by.publicKey };
}
export async function verifyCardCancelSignature(c: SignedCardCancel, now = new Date()): Promise<boolean> {
  const r = c?.request;
  if (!r || r.v !== CARD_CANCEL_VERSION || typeof r.card !== "string" || Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) return false;
  return verify(c.by, CARD_CANCEL_VERSION, r, c.sig);
}

/** Prove, for the next five minutes, that the holder of `by` is the one asking to read `subject`. Grants nothing but the read. */
export async function signRead(who: KeyPair, what: ReadRequest["what"], subject: string, now = new Date()): Promise<SignedRead> {
  const request: ReadRequest = { v: READ_VERSION, what, subject, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(who.privateKey, READ_VERSION, request), by: who.publicKey };
}
export async function verifyReadSignature(r: SignedRead, what: ReadRequest["what"], subject: string, now = new Date()): Promise<boolean> {
  const q = r?.request;
  if (!q || q.v !== READ_VERSION || q.what !== what || q.subject !== subject || typeof r.by !== "string" || Math.abs(now.getTime() - Date.parse(q.at)) > SPEND_WINDOW_MS) return false;
  return verify(r.by, READ_VERSION, q, r.sig);
}

export async function signFreeze(owner: KeyPair, agent: string, frozen: boolean, now = new Date()): Promise<SignedFreeze> {
  const request: FreezeRequest = { v: FREEZE_VERSION, agent, frozen, nonce: randomId("n"), at: now.toISOString() };
  return { request, sig: await sign(owner.privateKey, FREEZE_VERSION, request), by: owner.publicKey };
}
export async function verifyFreezeSignature(f: SignedFreeze, now = new Date()): Promise<boolean> {
  const r = f?.request;
  if (!r || r.v !== FREEZE_VERSION || typeof r.agent !== "string" || typeof r.frozen !== "boolean" || Math.abs(now.getTime() - Date.parse(r.at)) > SPEND_WINDOW_MS) return false;
  return verify(f.by, FREEZE_VERSION, r, f.sig);
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
