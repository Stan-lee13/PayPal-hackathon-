/**
 * The three things that can hold a key in Envelope:
 *
 *   Owner   a person (or a service acting for one). Seals envelopes, revokes them, answers for agents' accounts.
 *   Agent   software with its own key. Holds an envelope someone gave it, and can hold an account and a card.
 *   Party   what both are underneath: a key, a name and a gateway.
 *
 * A private key never leaves the process: every method here signs locally and sends only the
 * signature. `JSON.stringify(agent)` gives the public half only; the private key comes out only when
 * you call `exportKey()` or `export()` on purpose.
 */
import * as E from "../../lib/envelope/core";
import { EnvelopeError, refuseLocally } from "./errors";
import { Gateway, type GatewayOptions } from "./gateway";
import { toMinor, type Amount } from "./money";
import type { AccountOpened, AgentProfile, Balance, Card, ChargeOutcome, EnvelopeState, FreezeResult, PromiseNote, PromiseOutcome, ReceiptResponse, Reference, RevokeResult, RootState, SpendOutcome, SpendStatus, Standing, TransferOutcome } from "./types";
import { decodeToken, encodeToken, verifyPromiseNote, verifyReceipt, verifyReference, verifyStanding, type Verification } from "./verify";

const KEY = /^[A-Za-z0-9_-]{43}$/;
const text = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw refuseLocally(`${field} is required (up to ${max} characters).`);
  return v.trim();
};
const optional = (v: unknown, field: string, max: number): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw refuseLocally(`${field} must be text.`);
  return v.slice(0, max);
};
const wholeNumber = (v: unknown, field: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw refuseLocally(`${field} must be a whole number from ${min} to ${max}.`);
  return v;
};
const publicKeyOf = (who: string | { publicKey: string }, field: string): string => {
  const k = typeof who === "string" ? who : who?.publicKey;
  if (typeof k !== "string" || !KEY.test(k)) throw refuseLocally(`${field} must be a public key (43 base64url characters).`);
  return k;
};
const connect = (g: Gateway | string, opts?: GatewayOptions): Gateway => (typeof g === "string" ? new Gateway(g, opts) : g);

/** Private keys are kept here, off the objects, so printing or serializing a party can never show one. */
const keys = new WeakMap<object, E.KeyPair>();
const keyOf = (p: Party): E.KeyPair => keys.get(p)!;

/** What you save to disk to be the same party tomorrow. It contains the private key. */
export type SavedParty = { label: string; key: JsonWebKey; envelope?: E.Envelope | null };
export type PartyInit = { gateway: Gateway | string; key: E.KeyPair; label: string };

/** How a payment from an envelope came out. */
export type Payment = {
  /** The gateway's word. Only "PAID" means the money arrived; see `delivered`. */
  status: SpendStatus;
  spendId: string;
  /** True when this exact request had already been carried out; it was not paid again. */
  duplicate: boolean;
  /** True only when PayPal has delivered the payout, or the money is in the payee agent's balance. */
  delivered: boolean;
  /** True when the money was credited to an agent's balance at the gateway and no payout was made. */
  heldInBalance: boolean;
  paypal: SpendOutcome["paypal"];
  receipt: SpendOutcome["receipt"];
  /** A page a person can open. */
  receiptUrl: string;
};

/** Limits for a sub-envelope. Anything left out is inherited from the envelope it is cut from. */
export type SplitTerms = {
  to: { publicKey: string; label: string };
  /** Total it may ever spend. */
  limit: Amount;
  /** Most it may spend in one payment. Default: the total, or the parent's cap if that is lower. */
  perPayment?: Amount;
  payees?: string[] | null;
  purposes?: string[] | null;
  /** When it dies. Default: when the parent does. Give one of `notAfter` or `hours`. */
  notAfter?: Date | string;
  hours?: number;
  /** How many further levels it may be split. Default 0. */
  splits?: number;
  /** Payments above this need the owner's signature. Can be lowered, never raised or removed. */
  approveOver?: Amount;
  /** Tell the gateway, so the owner can see and revoke it. Default true. The split is valid either way. */
  announce?: boolean;
};

export type Authority = {
  /** The envelope this agent holds. */
  envelope: string;
  root: string;
  depth: number;
  caps: E.Caps;
  /** Local check of the whole chain, with no call to anyone. */
  verified: boolean;
  violations: E.Violation[];
  /** One line per level, owner's envelope first: what is left there once spending and reservations are counted. Null when the gateway could not be asked. */
  path: Array<{ id: string; label: string; limitMinor: number; leftMinor: number | null; revoked: boolean }>;
  /** The most this agent could spend in total right now: the smallest amount left at any level. Null when the gateway could not be asked. */
  availableMinor: number | null;
  rootStatus: "ACTIVE" | "CLOSED" | null;
  /** True when the chain verifies, nothing on the path is revoked, the root is open and it has not expired. */
  live: boolean;
};

export class Party {
  readonly gateway: Gateway;
  readonly label: string;
  readonly publicKey: string;

  constructor(init: PartyInit) {
    if (!init?.key?.privateKey || !KEY.test(init.key.publicKey ?? "")) throw refuseLocally("A party needs a key pair. Use Agent.generate() or Agent.fromJSON().");
    this.gateway = connect(init.gateway);
    this.label = text(init.label, "label", 80);
    this.publicKey = init.key.publicKey;
    keys.set(this, init.key);
  }
  /** @internal The key handle, for signing inside this package. */
  protected get key(): E.KeyPair { return keyOf(this); }

  /** The readable account number derived from the key: XXXX-XXXX-XXXX. */
  get account(): string { return E.accountNumber(this.publicKey); }
  /** How others name this party as a payee: acct:xxxx-xxxx-xxxx. */
  get payee(): string { return E.accountPayee(this.publicKey); }
  /** For passing to `split({ to })` or `seal({ to })`. */
  get identity(): { publicKey: string; label: string } { return { publicKey: this.publicKey, label: this.label }; }
  /** Deliberately public-only, so logging or serializing a party cannot leak its key. */
  toJSON(): { label: string; publicKey: string; account: string } { return { label: this.label, publicKey: this.publicKey, account: this.account }; }

  /** The private key, as a JWK. Keep it on this machine. */
  exportKey(): Promise<JsonWebKey> { return E.exportPrivateJwk(this.key.privateKey); }

  /**
   * Sign that work is delivered and accepted, for a promise that named THIS key as the one that
   * releases it. The signature pays the promise. An owner approving a payment over their threshold
   * is the same call. `work` is a SHA-256 fingerprint of what was delivered (see `fingerprint`).
   */
  async accept(promiseId: string, p: { work?: string; note?: string } = {}): Promise<Payment> {
    const work = optional(p.work, "work", 64) ?? "";
    if (work && !/^[0-9a-f]{64}$/.test(work)) throw refuseLocally("work must be a SHA-256 fingerprint: 64 lowercase hex characters. Use fingerprint(text).");
    return payment(this.gateway, await this.gateway.accept(await E.signAccept(this.key, text(promiseId, "promise", 60), { work, note: optional(p.note, "note", 200) })));
  }
  /** As the key a promise named: refuse it. The money goes back to the envelope. */
  async decline(promiseId: string, p: { note?: string } = {}): Promise<{ declined: boolean; status: SpendStatus }> {
    const o = await this.gateway.accept(await E.signAccept(this.key, text(promiseId, "promise", 60), { note: optional(p.note, "note", 200), decline: true }));
    return { declined: o.status === "LAPSED", status: o.status };
  }

  /** Revoke one envelope and everything split from it. Allowed for the owner and for any holder above it. */
  revoke(blockId: string): Promise<RevokeResult> {
    return E.signRevoke(this.key, text(blockId, "envelope id", 60)).then((s) => this.gateway.revoke(s));
  }

  /** Cancel a card. Allowed for the agent that issued it and for the owner of its account. */
  cancelCard(cardId: string): Promise<Card> {
    return E.signCardCancel(this.key, text(cardId, "card", 60)).then((s) => this.gateway.cancelCard(s));
  }

  /** As the merchant a card is locked to: take a charge. Refused unless this key is that merchant and the card's limits allow it. */
  async charge(p: { card: string; amount: Amount; memo?: string }): Promise<ChargeOutcome> {
    return this.gateway.charge(await E.signCharge(this.key, { card: text(p.card, "card", 60), amount: toMinor(p.amount), memo: optional(p.memo, "memo", 200) }));
  }

  /** A receipt, checked against PayPal by the gateway, with `verify()` to re-check every signature here. */
  receipt(spendId: string): ReturnType<typeof getReceipt> { return getReceipt(this.gateway, spendId); }
  /** Where a payment stands now. */
  status(spendId: string): ReturnType<typeof getStatus> { return getStatus(this.gateway, spendId); }
  /** As a payee: is the agent that sent this introduction good for the money? */
  checkIntroduction(tokenOrHello: string | E.SignedHello): ReturnType<typeof checkIntroduction> { return checkIntroduction(this.gateway, tokenOrHello); }
  /** As a payee: is this promise note real, and is the money still set aside? */
  checkPromiseNote(tokenOrNote: string | PromiseNote): ReturnType<typeof checkPromiseNote> { return checkPromiseNote(this.gateway, tokenOrNote); }

  /** What anyone can see about this party at the gateway. Null if the gateway has never seen this key. */
  async profile(): Promise<AgentProfile | null> {
    try { return await this.gateway.agent(this.publicKey); } catch (e) { if (e instanceof EnvelopeError && e.status === 404) return null; throw e; }
  }
}

function payment(gateway: Gateway, o: SpendOutcome): Payment {
  const held = o.paypal?.payoutStatus === "HELD_IN_ACCOUNT";
  return { status: o.status, spendId: o.spendId!, duplicate: o.duplicate, delivered: o.status === "PAID", heldInBalance: held, paypal: o.paypal, receipt: o.receipt, receiptUrl: gateway.receiptUrl(o.spendId!) };
}

export class Agent extends Party {
  private chain: E.Envelope | null = null;

  /** A new agent with a fresh key. Nothing is sent anywhere. */
  static async generate(init: { gateway: Gateway | string; label: string }): Promise<Agent> {
    return new Agent({ ...init, key: await E.generateKeyPair() });
  }
  /** The agent you saved with `export()`. */
  static async fromJSON(saved: SavedParty, init: { gateway: Gateway | string }): Promise<Agent> {
    const a = new Agent({ gateway: init.gateway, label: saved.label, key: await E.importPrivateJwk(saved.key) });
    if (saved.envelope) a.chain = saved.envelope;
    return a;
  }
  /** Everything needed to be this agent again, INCLUDING ITS PRIVATE KEY. Write it somewhere only the agent can read. */
  async export(): Promise<SavedParty> { return { label: this.label, key: await this.exportKey(), envelope: this.chain }; }

  // ───────────────────────────── the envelope it holds ─────────────────────────────

  /**
   * Take up an envelope someone sealed or split for this agent. Checked locally first: every
   * signature back to the owner, that nothing was widened, and that it is addressed to this key.
   */
  async hold(chain: E.Envelope): Promise<this> {
    const v = await E.verifyChain(chain);
    if (!v.ok) throw new EnvelopeError(`That envelope does not verify: ${v.violations.map((x) => `${x.code} (${x.detail})`).join("; ")}`, { kind: "local", outcome: "REFUSED_LOCALLY", reasons: v.violations });
    if (chain[chain.length - 1]!.body.holder !== this.publicKey) throw refuseLocally("That envelope was given to a different key.", "NOT_THE_HOLDER");
    this.chain = chain;
    return this;
  }
  /** The chain of signed blocks this agent holds, owner's first; null if it holds none. Safe to share: it contains no secret. */
  get envelope(): E.Envelope | null { return this.chain; }
  private held(): E.Envelope {
    if (!this.chain) throw refuseLocally(`${this.label} holds no envelope yet. Someone has to seal one for it, or split one off for it; then call hold(chain).`, "NO_ENVELOPE");
    return this.chain;
  }

  /** What this agent may spend: its limits (checked locally) and what is left at every level above it (asked of the gateway). */
  async authority(): Promise<Authority> {
    const chain = this.held();
    const leaf = chain[chain.length - 1]!.body;
    const v = await E.verifyChain(chain);
    let state: EnvelopeState | null = null;
    try { state = await this.gateway.envelope(chain[0]!.body.id); } catch (e) { if (!(e instanceof EnvelopeError) || (e.kind !== "network" && e.status !== 404)) throw e; }
    const path = chain.map((b) => {
      const row = state?.blocks.find((x) => x.id === b.body.id);
      return { id: b.body.id, label: b.body.holderLabel, limitMinor: b.body.caps.limit, leftMinor: row ? row.caps.limit - row.spentMinor - row.reservedMinor : state ? b.body.caps.limit : null, revoked: Boolean(row?.revokedAt) };
    });
    const rootStatus = state?.root.status ?? null;
    const availableMinor = state ? Math.max(0, Math.min(...path.map((p) => p.leftMinor ?? 0))) : null;
    return {
      envelope: leaf.id, root: leaf.root, depth: chain.length - 1, caps: leaf.caps, verified: v.ok, violations: v.violations, path, availableMinor, rootStatus,
      live: v.ok && !path.some((p) => p.revoked) && rootStatus !== "CLOSED" && Date.parse(leaf.caps.notAfter) > Date.now(),
    };
  }

  /**
   * Cut a smaller envelope from this one for another agent. It can only narrow: the library refuses
   * to sign anything wider, and the gateway and every payee would refuse it if it were signed anyway.
   * Returns the new chain: hand it to the other agent (`other.hold(chain)`). It contains no secret.
   */
  async split(p: SplitTerms): Promise<{ chain: E.Envelope; envelope: string; announced: boolean; announceError: string | null }> {
    const mine = this.held();
    const parent = mine[mine.length - 1]!.body.caps;
    const to = { publicKey: publicKeyOf(p.to, "to"), label: text(p.to?.label, "to.label", 80) };
    if (to.publicKey === this.publicKey) throw refuseLocally("An agent cannot split an envelope for itself.");
    const limit = toMinor(p.limit, "limit");
    if (p.notAfter !== undefined && p.hours !== undefined) throw refuseLocally("Give notAfter or hours, not both.");
    const notAfter = p.notAfter !== undefined ? new Date(p.notAfter).toISOString() : p.hours !== undefined ? new Date(Date.now() + p.hours * 3600_000).toISOString() : parent.notAfter;
    let chain: E.Envelope;
    try {
      chain = await E.split(mine, this.key, to, {
        currency: parent.currency, limit,
        perPayment: p.perPayment === undefined ? Math.min(limit, parent.perPayment) : toMinor(p.perPayment, "perPayment"),
        payees: p.payees === undefined ? parent.payees : p.payees,
        purposes: p.purposes === undefined ? parent.purposes : p.purposes,
        notAfter, splits: p.splits === undefined ? 0 : wholeNumber(p.splits, "splits", 0, 8),
        ...(p.approveOver !== undefined ? { approveOver: toMinor(p.approveOver, "approveOver") } : {}),
      });
    } catch (e) {
      if (e instanceof EnvelopeError) throw e;
      throw refuseLocally((e as Error).message, "CANNOT_WIDEN");
    }
    let announced = false, announceError: string | null = null;
    if (p.announce !== false) {
      try { await this.gateway.announce(chain); announced = true; } catch (e) { announceError = e instanceof EnvelopeError ? e.detail : String(e); }
    }
    return { chain, envelope: chain[chain.length - 1]!.body.id, announced, announceError };
  }

  /**
   * Pay a payee from this agent's envelope. The gateway checks the signed request against this
   * envelope and every envelope above it; if it is allowed, PayPal captures exactly that amount from
   * the owner's hold and pays the payee. A refusal throws an EnvelopeError with the reasons and moves
   * no money. `note` is shown to the owner and never used to decide.
   *
   * Check `delivered` before telling anyone they were paid: "UNCLAIMED" and "PAYOUT_PENDING" are not delivery.
   */
  async pay(p: { amount: Amount; payee: string; purpose: string; memo?: string; note?: string }): Promise<Payment> {
    const signed = await E.signSpend(this.held(), this.key, { amount: toMinor(p.amount), payee: text(p.payee, "payee", 254), purpose: text(p.purpose, "purpose", 60), memo: optional(p.memo, "memo", 200) });
    return payment(this.gateway, await this.gateway.spend(signed, optional(p.note, "note", 500)));
  }

  /**
   * Set money aside for a payee before any work is done. Nothing else can spend it until it is paid,
   * released or runs out (at most an hour). Returns a note signed by the gateway to hand to the payee.
   * This is earmarked money, not escrow: the owner can still revoke the envelope.
   * With `releaseBy`, that key's signed acceptance pays it without asking this agent again.
   */
  async setAside(p: { amount: Amount; payee: string; purpose: string; memo?: string; minutes?: number; releaseBy?: string | { publicKey: string }; note?: string }): Promise<{ promiseId: string; expiresAt: string; note: PromiseNote; token: string; outcome: PromiseOutcome }> {
    const minutes = p.minutes === undefined ? 15 : p.minutes;
    if (typeof minutes !== "number" || !(minutes >= 1 && minutes <= 60)) throw refuseLocally("minutes must be from 1 to 60.");
    const signed = await E.signPromise(this.held(), this.key, {
      amount: toMinor(p.amount), payee: text(p.payee, "payee", 254), purpose: text(p.purpose, "purpose", 60), memo: optional(p.memo, "memo", 200),
      ttl: Math.round(minutes * 60), releaseBy: p.releaseBy === undefined ? undefined : publicKeyOf(p.releaseBy, "releaseBy"),
    });
    const o = await this.gateway.promise(signed, optional(p.note, "note", 500));
    if (o.status !== "PROMISED" || !o.promiseId || !o.note) throw new EnvelopeError(`The gateway answered ${o.status}; nothing was set aside.`, { kind: "gateway", status: 200, outcome: o.status, reasons: o.reasons, body: o });
    return { promiseId: o.promiseId, expiresAt: o.expiresAt!, note: o.note, token: encodeToken(o.note), outcome: o };
  }
  /** Pay a promise this agent made. Paying twice pays once. */
  async keep(promiseId: string, p: { note?: string } = {}): Promise<Payment> {
    return payment(this.gateway, await this.gateway.keep(await E.signKeep(this.key, text(promiseId, "promise", 60), "pay"), optional(p.note, "note", 500)));
  }
  /** Give a promise up: the money goes back to the envelope. */
  async release(promiseId: string, p: { note?: string } = {}): Promise<{ released: boolean; status: SpendStatus }> {
    const o = await this.gateway.keep(await E.signKeep(this.key, text(promiseId, "promise", 60), "release"), optional(p.note, "note", 500));
    return { released: o.status === "LAPSED", status: o.status };
  }

  /**
   * Introduce this agent to a payee before any work is done: a signed "I intend to pay you this much
   * for this". The payee checks it with `checkIntroduction`. It moves no money and cannot be used as a payment.
   */
  async introduce(p: { amount: Amount; payee: string; purpose: string }): Promise<{ hello: E.SignedHello; token: string }> {
    const hello = await E.signHello(this.held(), this.key, { amount: toMinor(p.amount), payee: text(p.payee, "payee", 254), purpose: text(p.purpose, "purpose", 60) });
    return { hello, token: encodeToken(hello) };
  }

  // ───────────────────────────── an account of its own ─────────────────────────────

  /**
   * Open an account so this agent can be paid. It takes two signatures: the agent's and that of the
   * owner who answers for it. With `hold`, income stays as a balance the agent can spend from; without,
   * income is paid straight out to `settleTo`. `perPayment` and `perDay` are the owner's caps on that balance.
   */
  async openAccount(p: { owner: Party | E.KeyPair; ownerName?: string; settleTo: string; hold?: boolean; perPayment?: Amount; perDay?: Amount }): Promise<AccountOpened> {
    const ownerKey = p.owner instanceof Party ? keyOf(p.owner) : p.owner;
    if (!ownerKey?.privateKey || !KEY.test(ownerKey.publicKey ?? "")) throw refuseLocally("owner must be an Owner (or a key pair): the owner co-signs the opening of an agent's account.");
    const ownerName = p.ownerName ?? (p.owner instanceof Party ? p.owner.label : undefined);
    const signed = await E.signAccount(this.key, ownerKey, {
      label: this.label, ownerName: text(ownerName, "ownerName", 80), settleTo: text(p.settleTo, "settleTo", 127),
      ...(p.hold ? { mode: "hold" as const } : {}),
      ...(p.perPayment !== undefined ? { perPayment: toMinor(p.perPayment, "perPayment") } : {}),
      ...(p.perDay !== undefined ? { perDay: toMinor(p.perDay, "perDay") } : {}),
    });
    return this.gateway.openAccount(signed);
  }

  /** This agent's balance and recent ledger; null if it has no account that keeps one. */
  async balance(): Promise<Balance | null> { return (await this.profile())?.balance ?? null; }

  /**
   * Send money out of this agent's own balance. To another agent's account (acct:xxxx-xxxx-xxxx) it
   * moves on the gateway's ledger with no PayPal call; to a PayPal address it leaves as a PayPal payout.
   * Refused if the balance is too low, the account is frozen, or it is over what the owner allows.
   */
  async transfer(p: { amount: Amount; payee: string; purpose?: string; memo?: string }): Promise<TransferOutcome> {
    return this.gateway.sendTransfer(await E.signTransfer(this.key, { amount: toMinor(p.amount), payee: text(p.payee, "payee", 127), purpose: optional(p.purpose, "purpose", 60), memo: optional(p.memo, "memo", 200) }));
  }
  /** Send money home to the owner's PayPal address. */
  async withdraw(p: { amount: Amount; memo?: string }): Promise<TransferOutcome> {
    return this.gateway.sendTransfer(await E.signTransfer(this.key, { kind: "withdraw", amount: toMinor(p.amount), memo: optional(p.memo, "memo", 200) }));
  }

  /**
   * Issue a card on this agent's balance so ONE merchant can charge it. Only that merchant's key can
   * charge it, so the card's details are not a secret. It ends by itself when the charges are used
   * up or the date passes: to subscribe for two months, allow two charges.
   */
  async issueCard(p: { merchant: string; label: string; perCharge: Amount; maxCharges: number; everySeconds?: number; everyDays?: number; lifeSeconds?: number; validDays?: number }): Promise<Card> {
    if (p.everySeconds !== undefined && p.everyDays !== undefined) throw refuseLocally("Give everySeconds or everyDays, not both.");
    if (p.lifeSeconds !== undefined && p.validDays !== undefined) throw refuseLocally("Give lifeSeconds or validDays, not both.");
    const maxCharges = wholeNumber(p.maxCharges, "maxCharges", 1, E.CARD_MAX_CHARGES);
    const every = p.everySeconds !== undefined ? p.everySeconds : Math.round((p.everyDays ?? 30) * 86400);
    const life = p.lifeSeconds !== undefined ? p.lifeSeconds : p.validDays !== undefined ? Math.round(p.validDays * 86400) : every * maxCharges + 7 * 86400;
    if (!Number.isFinite(every) || every < 0) throw refuseLocally("The time between charges cannot be negative.");
    if (!Number.isFinite(life) || life <= 0) throw refuseLocally("A card must be valid for some time.");
    return this.gateway.issueCard(await E.signCard(this.key, { merchant: text(p.merchant, "merchant", 40), label: text(p.label, "label", 60), perCharge: toMinor(p.perCharge, "perCharge"), maxCharges, every: Math.round(every), life: Math.round(life) }));
  }
  /** The cards this agent has issued, newest first. */
  async cards(): Promise<Card[]> { return (await this.profile())?.cards ?? []; }

  // ───────────────────────────── what it can show and check ─────────────────────────────

  /** This agent's record at the gateway, signed, with a token it can hand to anyone. */
  async reference(): Promise<{ reference: Reference; token: string }> {
    const reference = await this.gateway.reference(this.publicKey);
    return { reference, token: encodeToken(reference) };
  }
}

/** A person, or a service acting for one. The root of every envelope is an owner's signature. */
export class Owner extends Party {
  static async generate(init: { gateway: Gateway | string; label: string }): Promise<Owner> {
    return new Owner({ ...init, key: await E.generateKeyPair() });
  }
  static async fromJSON(saved: SavedParty, init: { gateway: Gateway | string }): Promise<Owner> {
    return new Owner({ gateway: init.gateway, label: saved.label, key: await E.importPrivateJwk(saved.key) });
  }
  /** Everything needed to be this owner again, INCLUDING THE PRIVATE KEY. */
  async export(): Promise<SavedParty> { return { label: this.label, key: await this.exportKey() }; }

  /**
   * Seal an envelope for an agent: sign its limits and ask the gateway to have PayPal hold the money.
   * Returns the chain (give it to the agent: `agent.hold(chain)`) and the root as the gateway recorded
   * it, including PayPal's authorization id.
   */
  async seal(p: { to: { publicKey: string; label: string }; limit: Amount; perPayment?: Amount; payees?: string[] | null; purposes?: string[] | null; hours?: number; notAfter?: Date | string; splits?: number; approveOver?: Amount; title?: string }): Promise<{ chain: E.Envelope; root: RootState; envelopeUrl: string }> {
    const limit = toMinor(p.limit, "limit");
    if (p.notAfter !== undefined && p.hours !== undefined) throw refuseLocally("Give notAfter or hours, not both.");
    const notAfter = p.notAfter !== undefined ? new Date(p.notAfter).toISOString() : new Date(Date.now() + (p.hours ?? 6) * 3600_000).toISOString();
    const chain = await E.seal(this.key, { publicKey: publicKeyOf(p.to, "to"), label: text(p.to?.label, "to.label", 80) }, {
      currency: "USD", limit, perPayment: p.perPayment === undefined ? limit : toMinor(p.perPayment, "perPayment"),
      payees: p.payees ?? null, purposes: p.purposes ?? null, notAfter, splits: p.splits === undefined ? 2 : wholeNumber(p.splits, "splits", 0, 8),
      ...(p.approveOver !== undefined ? { approveOver: toMinor(p.approveOver, "approveOver") } : {}),
    });
    const root = await this.gateway.seal(chain, { ownerName: this.label, title: optional(p.title, "title", 120) ?? "Envelope" });
    return { chain, root, envelopeUrl: this.gateway.envelopeUrl(root.id) };
  }
  /** Close a root envelope: PayPal voids whatever was not spent. */
  close(rootId: string): Promise<RevokeResult> { return this.revoke(rootId); }

  /** Freeze an agent's account (nothing can leave its balance; income still arrives), or open it again. */
  async freeze(agent: string | { publicKey: string }, frozen = true): Promise<FreezeResult> {
    return this.gateway.freeze(await E.signFreeze(this.key, publicKeyOf(agent, "agent"), frozen));
  }
  /** Every envelope sealed with this key, the agents under them and where the money went. Shown only to the owner. */
  async treasury(): Promise<Record<string, unknown>> { return this.gateway.treasury(await E.signRead(this.key, "treasury", this.publicKey)); }
  /** Have the gateway check this owner's recent payments against PayPal's own records. */
  async reconcile(): Promise<Record<string, unknown>> { return this.gateway.reconcileTreasury(await E.signRead(this.key, "treasury", this.publicKey)); }
  async envelopes(): Promise<RootState[]> { return this.gateway.envelopesOf(await E.signRead(this.key, "treasury", this.publicKey)); }
  /**
   * Call back a payment PayPal is holding unclaimed (the address has no PayPal account): PayPal
   * cancels the payout and the capture is refunded to this owner. Needs a gateway that has the recall endpoint.
   */
  async recall(spendId: string): Promise<Record<string, unknown>> {
    const id = text(spendId, "spend id", 60);
    return this.gateway.recall(id, await E.signRead(this.key, "recall" as E.ReadRequest["what"], id));
  }
}

// ───────────────────────────── checks a counterparty runs: no key needed ─────────────────────────────

/**
 * Run by a payee: is the agent that sent this introduction good for the money? The gateway confirms
 * the agent controls its key, names who stands behind it back to a person, asks PayPal whether the
 * hold is still there, and says whether that exact payment would be accepted now. The answer is
 * signed, and checked here against the gateway key this client knows.
 */
export async function checkIntroduction(gateway: Gateway | string, tokenOrHello: string | E.SignedHello): Promise<{ standing: Standing; good: boolean; signature: Verification }> {
  const g = connect(gateway);
  let hello: E.SignedHello;
  try { hello = typeof tokenOrHello === "string" ? decodeToken<E.SignedHello>(tokenOrHello) : tokenOrHello; } catch { throw refuseLocally("That is not an introduction token.", "MALFORMED"); }
  const [standing, pinned] = await Promise.all([g.standing(hello), g.key()]);
  const signature = await verifyStanding(standing, pinned.publicKey);
  return { standing, good: standing.good && signature.ok, signature };
}

/** Run by a payee: is this promise note really from the gateway, and is the money still set aside? */
export async function checkPromiseNote(gateway: Gateway | string, tokenOrNote: string | PromiseNote): Promise<{ note: PromiseNote; good: boolean; signature: Verification }> {
  const g = connect(gateway);
  let note: PromiseNote;
  try { note = typeof tokenOrNote === "string" ? decodeToken<PromiseNote>(tokenOrNote) : tokenOrNote; } catch { throw refuseLocally("That is not a promise note.", "MALFORMED"); }
  const signature = await verifyPromiseNote(note, (await g.key()).publicKey);
  return { note, good: signature.ok, signature };
}

/** Check a reference an agent handed over: is it really this gateway's word? */
export async function checkReference(gateway: Gateway | string, tokenOrReference: string | Reference): Promise<{ reference: Reference; good: boolean; signature: Verification }> {
  const g = connect(gateway);
  let reference: Reference;
  try { reference = typeof tokenOrReference === "string" ? decodeToken<Reference>(tokenOrReference) : tokenOrReference; } catch { throw refuseLocally("That is not a reference.", "MALFORMED"); }
  const signature = await verifyReference(reference, (await g.key()).publicKey);
  return { reference, good: signature.ok, signature };
}

/**
 * Fetch a receipt and check it twice: `paypal` is the gateway's comparison with PayPal's own records
 * made just now; `verify()` re-runs every signature on this machine without trusting the gateway.
 */
export async function getReceipt(gateway: Gateway | string, spendId: string): Promise<ReceiptResponse & { paypal: { ok: boolean; checks: ReceiptResponse["checks"] }; verify: () => Promise<Verification> }> {
  const g = connect(gateway);
  const r = await g.receipt(text(spendId, "spend id", 60));
  return { ...r, paypal: { ok: r.ok, checks: r.checks }, verify: async () => verifyReceipt(r, (await g.key()).publicKey) };
}

/** Where a payment stands now. Asking makes the gateway ask PayPal. */
export async function getStatus(gateway: Gateway | string, spendId: string): Promise<{ id: string; status: SpendStatus; delivered: boolean; payoutStatus: string | null; matchesPayPal: boolean }> {
  const r = await connect(gateway).receipt(text(spendId, "spend id", 60));
  return { id: r.spend.id, status: r.spend.status, delivered: r.spend.status === "PAID", payoutStatus: r.spend.payoutStatus, matchesPayPal: r.ok };
}

/** SHA-256 of some delivered work, for `accept({ work })`. It proves which bytes were referred to, not that they are any good. */
export const fingerprint = (work: string): Promise<string> => E.sha256(work);
