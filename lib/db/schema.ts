/**
 * Envelope gateway state. Authority lives in signed envelopes that agents hold (lib/envelope/core.ts);
 * this database only holds what signatures can't: how much has been spent at each level, what has
 * been revoked, which requests were already seen, and what PayPal did.
 * Money is always integer minor units.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Block, Caps, SignedAccount, SignedCard, SignedCharge, SignedPromise, SignedSpend, SignedTransfer, Violation } from "../envelope/core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A sealed root envelope and the PayPal authorization that backs it. */
export const roots = pgTable("roots", {
  /** Id of the root block. */
  id: text("id").primaryKey(),
  /** Public key of the human principal who sealed it. */
  principal: text("principal").notNull(),
  principalName: text("principal_name").notNull(),
  title: text("title").notNull(),
  currency: text("currency").notNull(),
  limitMinor: integer("limit_minor").notNull(),
  status: text("status", { enum: ["ACTIVE", "CLOSED"] }).notNull().default("ACTIVE"),
  /** Which financial rail placed this hold: "paypal" until another adapter is deployed (lib/rails). */
  railProvider: text("rail_provider").notNull().default("paypal"),
  /** The hold on the principal's funding instrument. Spends are partial captures of it; closing voids the rest. */
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id").unique(),
  authorizationExpiresAt: ts("authorization_expires_at"),
  capturedMinor: integer("captured_minor").notNull().default(0),
  /**
   * Captured and then refunded to the owner. PayPal does not give a refunded amount back to the hold
   * (checked on the sandbox: a capture of it is refused with MAX_CAPTURE_AMOUNT_EXCEEDED), so what is left
   * of the hold is limit − captured − refunded, and the owner was charged `capturedMinor`.
   */
  refundedMinor: integer("refunded_minor").notNull().default(0),
  /** What PayPal released back to the principal when the envelope was closed. */
  releasedMinor: integer("released_minor"),
  closedAt: ts("closed_at"),
  closeReason: text("close_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("roots_principal").on(t.principal, t.createdAt)]);

/** Every block the gateway has seen (announced at split time or first presented with a spend). */
export const blocks = pgTable("blocks", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull().references(() => roots.id),
  parentId: text("parent_id"),
  depth: integer("depth").notNull(),
  /** SHA-256 of the signed block: a second block with the same id but different content is a forgery. */
  hash: text("hash").notNull(),
  holder: text("holder").notNull(),
  holderLabel: text("holder_label").notNull(),
  caps: jsonb("caps").$type<Caps>().notNull(),
  raw: jsonb("raw").$type<Block>().notNull(),
  /** Settled spend through this block (its own and its descendants'). */
  spentMinor: integer("spent_minor").notNull().default(0),
  /** In-flight spend: reserved before PayPal is called, so concurrent agents can't overspend. */
  reservedMinor: integer("reserved_minor").notNull().default(0),
  revokedAt: ts("revoked_at"),
  revokedBy: text("revoked_by"),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
}, (t) => [index("blocks_root").on(t.rootId, t.depth)]);

export const SPEND_STATES = ["DENIED", "PROMISED", "LAPSED", "RESERVED", "CAPTURED", "PAID", "PAYOUT_PENDING", "UNCLAIMED", "FAILED", "REFUND_DUE"] as const;
export type SpendState = (typeof SPEND_STATES)[number];

/**
 * A financial receipt, as issued. `envelope-receipt/1` names PayPal in its structure; it is kept, signed and
 * verifiable for ever, but nothing new is issued in it. `envelope-receipt/2` names whichever rail moved the
 * money, so no other provider's identifiers are ever written into PayPal-shaped fields.
 */
export type Receipt = ReceiptV1 | ReceiptV2;

export type ReceiptV1 = {
  v: "envelope-receipt/1";
  spend: string;
  decision: "PAID";
  request: SignedSpend["request"] | SignedPromise["request"];
  requestSig: string;
  /** Present when the payee is an agent's account: whose account it is and where PayPal sent the money. */
  paidTo?: { account: string; agent: string; agentLabel: string; settledTo: string; /** Set when the money was credited to the agent's balance here and not paid out by PayPal. */ held?: { ledgerEntry: number; balanceAfterMinor: number } };
  /** Present when the money was released by the key the promise named: who signed for the work, and its fingerprint. */
  releasedBy?: { key: string; work: string; note: string; at: string };
  /** The authority chain: block ids and hashes, root first. */
  chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>;
  principal: string;
  /** `payoutBatchId` is null when the money was credited to an agent's balance: there was no payout. */
  paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string | null; payoutItemId: string | null; /** PayPal's word on the payout at the moment of signing. A receipt records that money was captured and a payout was asked for; whether it was delivered is PayPal's to say, live. */ payoutStatus?: string | null };
  issuedAt: string;
  gateway: string;
  sig: string;
};

/**
 * The provider-neutral receipt (v2). It separates three things that v1 ran together:
 *
 *   • *authority* — who allowed this, provable offline from signatures;
 *   • *provider operations* — which rail was asked to do what, by its own identifiers;
 *   • *settlement* — what was true at issue time, in words, with the provider's status passed through.
 *
 * A valid signature says the gateway recorded this and the authority behind it. It never says the money
 * arrived: `verification.external` names the operations to ask the provider about, and
 * `verification.note` says so in a sentence.
 */
export type ReceiptV2 = {
  v: "envelope-receipt/2";
  operation: { kind: "payment"; ref: string };
  /** The organization whose money this is: the principal who sealed the envelope. */
  organization: { principal: string; name: string };
  /** The paying agent, and the envelope it acted under. */
  agent: { key: string; label: string; account: string };
  authority: {
    principal: string;
    request: SignedSpend["request"] | SignedPromise["request"];
    requestSig: string;
    chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>;
    releasedBy?: { key: string; work: string; note: string; at: string };
  };
  amount: { minor: number; currency: string };
  /** Which financial rail moved (or did not move) the money, and where custody sits. */
  provider: {
    rail: string;
    label: string;
    mode: string;
    custody: "provider" | "gateway-ledger" | "safeguarded-partner";
    /** The provider's own account id when it issues one. */
    externalAccountId: string | null;
    /** False when nothing left this gateway: the money stayed as an internal balance. */
    movedExternally: boolean;
  };
  /** The provider's identifiers, each labelled with what it is. Empty when the rail issued none. */
  providerOps: Array<{ kind: "order" | "authorization" | "capture" | "refund" | "payout" | "payout_item"; id: string }>;
  settlement: {
    state: "credited" | "delivered" | "unclaimed" | "payout_pending" | "pending_capture" | "refunded";
    asOf: string;
    meaning: string;
    /** The provider's own status word, unmodified. Never interpreted here. */
    providerStatus: string | null;
  };
  paidTo?: ReceiptV1["paidTo"];
  issuedAt: string;
  /** The gateway's public key. The signature covers the body excluding `sig`. */
  gateway: string;
  verification: {
    /** What the signature alone proves, with no trust in this server. */
    offline: string[];
    /** What only the provider can confirm, and which operation to ask about. */
    external: string[];
    note: string;
  };
  sig: string;
};

export const spends = pgTable("spends", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull(),
  leafId: text("leaf_id").notNull(),
  leafLabel: text("leaf_label").notNull(),
  chainIds: jsonb("chain_ids").$type<string[]>().notNull(),
  /** SHA-256 of the signed request: the same request can never be executed twice. */
  requestHash: text("request_hash").notNull().unique(),
  signed: jsonb("signed").$type<SignedSpend | SignedPromise>().notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  payee: text("payee").notNull(),
  purpose: text("purpose").notNull(),
  memo: text("memo").notNull().default(""),
  /** Free text from the agent: why it wants to pay. Shown to the principal; never used for decisions. */
  agentNote: text("agent_note"),
  status: text("status", { enum: SPEND_STATES }).notNull(),
  /** Which financial rail moved (or refused) this payment: "paypal" until another adapter is deployed. */
  railProvider: text("rail_provider").notNull().default("paypal"),
  /**
   * Claimed by the arrival that is finishing this payment. One arrival at a time captures and pays out; the
   * others wait for it. A claim older than 30 seconds is taken over, so a process that died mid-way does not
   * strand the money.
   */
  settlingAt: ts("settling_at"),
  /**
   * A fencing token: incremented every time an arrival claims the settlement. Every write that decides what
   * happens to the money must still hold the current generation, so an arrival whose lease expired cannot
   * finish a decision that a takeover already owns. See lib/gateway/service.ts › settle().
   */
  settleGeneration: integer("settle_generation").notNull().default(0),
  reasons: jsonb("reasons").$type<Violation[]>().notNull().default([]),
  captureId: text("capture_id"),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  payoutTransactionId: text("payout_transaction_id"),
  payoutStatus: text("payout_status"),
  refundId: text("refund_id"),
  /** A dispute PayPal holds against this payment's capture, when there is one, and PayPal's status for it as last read. */
  disputeId: text("dispute_id"),
  disputeStatus: text("dispute_status"),
  receipt: jsonb("receipt").$type<Receipt>(),
  /** When the payee is an agent's account: that agent's key, and the PayPal address fixed at admission. */
  payeeAgent: text("payee_agent"),
  payoutTo: text("payout_to"),
  /** Set for promises: money set aside for the payee until this time. */
  promiseExpiresAt: ts("promise_expires_at"),
  promiseNote: jsonb("promise_note").$type<PromiseNote>(),
  /** The signed acceptance that released a promise, when it was released by the key it named. */
  delivery: jsonb("delivery").$type<{ by: string; work: string; note: string; at: string; sig: string; /** The signed acceptance itself, so anyone can check the acceptor's signature. */ request?: unknown }>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  settledAt: ts("settled_at"),
}, (t) => [index("spends_root").on(t.rootId, t.createdAt), index("spends_payee_agent").on(t.payeeAgent, t.createdAt)]);

/** What the gateway hands a payee when money has been set aside for it. */
export type PromiseNote = {
  v: "envelope-promise-note/1";
  promise: string;
  agent: string; agentLabel: string; account: string;
  sponsors: Array<{ role: "owner" | "agent"; label: string; key: string }>;
  root: string;
  amount: number; currency: string; payee: string; purpose: string;
  expiresAt: string;
  /** Set when the promise names a key whose signed acceptance pays it. */
  releaseBy?: string;
  paypal: { mode: string; authorizationId: string; status: string };
  issuedAt: string; gateway: string; sig: string;
};

/** Accounts that can receive: an agent's key, the owner who answers for it, and where its income is settled. */
export const accounts = pgTable("accounts", {
  agent: text("agent").primaryKey(),
  /** Readable account number derived from the key; unique so a number always means one agent. */
  account: text("account").notNull().unique(),
  label: text("label").notNull(),
  owner: text("owner").notNull(),
  ownerName: text("owner_name").notNull(),
  settleTo: text("settle_to").notNull(),
  signed: jsonb("signed").$type<SignedAccount>().notNull(),
  openedAt: ts("opened_at").notNull().defaultNow(),
  /** "hold": income stays here as a balance. "settle": income is paid straight out to settleTo. */
  mode: text("mode", { enum: ["settle", "hold"] }).notNull().default("settle"),
  /** What the account holds, in minor units. Only ever changed together with a ledger entry. */
  balanceMinor: integer("balance_minor").notNull().default(0),
  /** Owner's cap on a single payment out of the balance; null = none. */
  perPaymentMinor: integer("per_payment_minor"),
  frozenAt: ts("frozen_at"),
  /** The signing time of the last freeze or unfreeze applied; an older one is refused. */
  freezeSignedAt: ts("freeze_signed_at"),
  /** Owner's cap on what may leave in any 24 hours (payments and card charges); null = none. */
  perDayMinor: integer("per_day_minor"),
});

/** Cards an agent has issued on its balance. The signed card is the authority; the counters are what has been used. */
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  /** A number to show and say aloud. It grants nothing: only the merchant's key can charge the card. */
  number: text("number").notNull(),
  holder: text("holder").notNull(),
  label: text("label").notNull(),
  merchantAgent: text("merchant_agent").notNull(),
  perChargeMinor: integer("per_charge_minor").notNull(),
  maxCharges: integer("max_charges").notNull(),
  everySeconds: integer("every_seconds").notNull(),
  notAfter: ts("not_after").notNull(),
  signed: jsonb("signed").$type<SignedCard>().notNull(),
  charges: integer("charges").notNull().default(0),
  chargedMinor: integer("charged_minor").notNull().default(0),
  lastChargeAt: ts("last_charge_at"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("cards_holder").on(t.holder, t.createdAt), index("cards_merchant").on(t.merchantAgent, t.createdAt)]);

/**
 * Every change to a balance, one row each. `(agent, kind, ref)` is unique so a credit or debit can never be applied twice.
 *
 * `rail` and `currency` are the provenance of the claim, not decoration: a balance is only payable through a
 * rail that actually funded it. Money credited by one provider cannot be withdrawn from another, however valid
 * the ledger row is (docs/MULTI_RAIL_ACCOUNTING.md). Existing rows default to `paypal`/`USD`, which is what
 * every balance in this deployment was in fact funded with.
 */
export const ledger = pgTable("ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agent: text("agent").notNull(),
  kind: text("kind", { enum: ["income", "transfer_in", "transfer_out", "payout", "withdrawal", "reversal", "refund", "refund_reversal"] }).notNull(),
  /** The spend or transfer this entry belongs to. */
  ref: text("ref").notNull(),
  deltaMinor: integer("delta_minor").notNull(),
  balanceAfterMinor: integer("balance_after_minor").notNull(),
  /** The financial rail that funded this claim (`mock`, `paypal`, a partner id). */
  rail: text("rail").notNull().default("paypal"),
  /** ISO-4217. A balance in one currency is not spendable in another without an explicit conversion. */
  currency: text("currency").notNull().default("USD"),
  counterparty: text("counterparty"),
  memo: text("memo").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ledger_once").on(t.agent, t.kind, t.ref), index("ledger_agent").on(t.agent, t.id), index("ledger_agent_rail").on(t.agent, t.rail, t.currency)]);

/**
 * One provider account this gateway may hold value in, and where that value actually is.
 * `externalAccountId` is the provider's own account id when it issues one.
 */
export const railAccounts = pgTable("rail_accounts", {
  id: text("id").primaryKey(),
  /** The organization that owns the funds: the key of the principal who sealed the envelope. */
  owner: text("owner").notNull(),
  rail: text("rail").notNull(),
  currency: text("currency").notNull(),
  /** Where custody sits. `provider` is a payment account, not a safeguarded or escrow account. */
  custody: text("custody", { enum: ["provider", "gateway-ledger", "safeguarded-partner"] }).notNull(),
  externalAccountId: text("external_account_id"),
  label: text("label").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("rail_accounts_identity").on(t.owner, t.rail, t.currency, t.custody, sql`coalesce(${t.externalAccountId}, '-')`)]);

export const POSITION_BUCKETS = ["available", "pending", "fee"] as const;
export type PositionBucket = (typeof POSITION_BUCKETS)[number];
export const POSITION_KINDS = ["capture", "capture_pending", "payout", "payout_return", "refund", "fee", "adjustment"] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/**
 * An external movement at a provider, append-only and idempotent per `(rail, currency, bucket, kind, ref)`.
 * These rows are the provider side of the books: what is actually at each rail, in which currency.
 * Internal balances (the `ledger`) are what the gateway owes; these are what backs them.
 * Fees live in their own bucket so they never masquerade as spendable liquidity.
 */
export const positionEntries = pgTable("position_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  owner: text("owner").notNull(),
  rail: text("rail").notNull(),
  currency: text("currency").notNull(),
  custody: text("custody").notNull().default("provider"),
  externalAccountId: text("external_account_id"),
  bucket: text("bucket", { enum: POSITION_BUCKETS }).notNull(),
  kind: text("kind", { enum: POSITION_KINDS }).notNull(),
  deltaMinor: integer("delta_minor").notNull(),
  /** The domain record that caused it: a spend, a transfer or a statement line. */
  ref: text("ref").notNull(),
  memo: text("memo").notNull().default(""),
  at: ts("at").notNull().defaultNow(),
}, (t) => [uniqueIndex("position_entries_once").on(t.rail, t.currency, t.bucket, t.kind, t.ref), index("position_entries_owner").on(t.owner, t.rail, t.currency, t.bucket)]);

/**
 * Evidence that one recorded provider movement belongs to a known provider account.
 *
 * A movement written while the provider's account identity was unavailable is deliberately left with a null
 * `external_account_id`: history says what was known when it was recorded. A later balance read establishes the
 * account's *current* identity; it does not prove that this older movement arrived there. Only a match against a
 * reliable provider record for that specific movement — a statement line, a transaction — is evidence, and it is
 * stored here, beside the movement, never by rewriting it.
 *
 * Liquidity counts a movement only when it carries the account identity itself or has one of these rows.
 */
export const positionAttributions = pgTable("position_attributions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /** The exact `position_entries` row this evidence is about. One row per movement. */
  positionEntryId: bigint("position_entry_id", { mode: "number" }).notNull().references(() => positionEntries.id),
  rail: text("rail").notNull(),
  currency: text("currency").notNull(),
  /** The provider account the movement is now proven to belong to. Never null: an attribution is a proof. */
  externalAccountId: text("external_account_id").notNull(),
  /** Where the matching provider record was read, e.g. "PayPal Transaction Search 2026-11-18". */
  source: text("source").notNull(),
  /** The provider's own id for that record (a transaction id), so the match can be re-checked. */
  evidence: text("evidence").notNull(),
  /** Who recorded the match: an operator id or a reconciliation job. */
  attributedBy: text("attributed_by"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [uniqueIndex("position_attributions_once").on(t.positionEntryId)]);

export type ReconciliationFinding = { code: string; severity: "error" | "warning" | "info"; detail: string; ref: string | null };

/** One reconciliation attempt against a rail's own records, kept so "when was this last checked?" has an answer. */
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  owner: text("owner"),
  rail: text("rail").notNull(),
  currency: text("currency").notNull(),
  fromAt: ts("from_at").notNull(),
  toAt: ts("to_at").notNull(),
  /** False when the rail could not give a statement: that is not a reconciliation. */
  available: boolean("available").notNull(),
  ok: boolean("ok").notNull(),
  findings: jsonb("findings").$type<ReconciliationFinding[]>().notNull().default([]),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("reconciliation_runs_at").on(t.rail, t.at)]);

export const TRANSFER_STATES = ["DENIED", "BOOKED", "SENDING", "PAID", "PAYOUT_PENDING", "UNCLAIMED", "FAILED"] as const;
/**
 * A movement out of a balance. v1 is PayPal-shaped (`to.kind: "paypal"`); v2 names the rail that paid, so a
 * payout made through another provider is never described as a PayPal transfer. v1 receipts stay verifiable.
 */
export type TransferReceipt = {
  v: "envelope-transfer-receipt/1" | "envelope-transfer-receipt/2";
  transfer: string;
  request: SignedTransfer["request"] | SignedCharge["request"];
  requestSig: string;
  /** Present when the money was pulled by a merchant through a card the agent issued. */
  card?: { id: string; number: string; label: string; charge: number; of: number };
  from: { account: string; agent: string; agentLabel: string };
  /** v2 only: which rail paid, and in what mode. */
  provider?: { rail: string; mode: string };
  /** A book transfer between two accounts here, or a payout through a rail. */
  to: { kind: "account"; account: string; agent: string; agentLabel: string }
    | { kind: "payout"; address: string; payoutBatchId: string; rail: string }
    | { kind: "paypal"; address: string; payoutBatchId: string; mode: string };
  balanceAfterMinor: number;
  issuedAt: string; gateway: string; sig: string;
};
/** Money leaving an agent's balance. */
export const transfers = pgTable("transfers", {
  id: text("id").primaryKey(),
  fromAgent: text("from_agent").notNull(),
  kind: text("kind", { enum: ["pay", "withdraw", "charge"] }).notNull(),
  /** Set when a merchant pulled the money through a card. */
  cardId: text("card_id"),
  payee: text("payee").notNull(),
  toAgent: text("to_agent"),
  /** PayPal address when the money leaves through a payout. */
  payoutTo: text("payout_to"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  purpose: text("purpose").notNull().default(""),
  memo: text("memo").notNull().default(""),
  requestHash: text("request_hash").notNull().unique(),
  signed: jsonb("signed").$type<SignedTransfer | SignedCharge>().notNull(),
  status: text("status", { enum: TRANSFER_STATES }).notNull(),
  /** Which financial rail paid this out (or refused to): "paypal" until another adapter is deployed. */
  railProvider: text("rail_provider").notNull().default("paypal"),
  reasons: jsonb("reasons").$type<Violation[]>().notNull().default([]),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  payoutStatus: text("payout_status"),
  receipt: jsonb("receipt").$type<TransferReceipt>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("transfers_from").on(t.fromAgent, t.createdAt), index("transfers_to").on(t.toAgent, t.createdAt), index("transfers_card").on(t.cardId, t.createdAt)]);

/** The gateway's own signing key for receipts (generated on first use). */
export const gatewayKeys = pgTable("gateway_keys", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateJwk: jsonb("private_jwk").$type<JsonWebKey>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** DEMO ONLY: keys of the console's built-in scripted agents. Real agents keep their keys to themselves. */
export const demoKeys = pgTable("demo_keys", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull(),
  label: text("label").notNull(),
  publicKey: text("public_key").notNull(),
  privateJwk: jsonb("private_jwk").$type<JsonWebKey>().notNull(),
  chain: jsonb("chain").$type<Block[]>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("demo_keys_root_label").on(t.rootId, t.label)]);

/** Tamper-evident trail: one SHA-256 chain per root envelope (`scopeId` = principal key, `subjectId` = root id). */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  scopeId: text("scope_id").notNull(),
  subjectId: text("subject_id"),
  actor: text("actor", { enum: ["principal", "agent", "gateway", "paypal", "ai"] }).notNull(),
  action: text("action").notNull(),
  ref: text("ref"),
  outcome: text("outcome", { enum: ["OK", "REJECTED", "FAILED", "PENDING", "INFO"] }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  seq: integer("seq").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [index("audit_subject").on(t.subjectId, t.seq), uniqueIndex("audit_chain_seq").on(t.scopeId, sql`coalesce(${t.subjectId}, '-')`, t.seq)]);

/** Every call the gateway made to PayPal (lib/paypal/journal.ts). Facts only: no request or response bodies. */
export const paypalCalls = pgTable("paypal_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().defaultNow(),
  mode: text("mode").notNull(),
  op: text("op").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestId: text("request_id"),
  httpStatus: integer("http_status").notNull(),
  paypalStatus: text("paypal_status"),
  resourceId: text("resource_id"),
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  debugId: text("debug_id"),
  ms: integer("ms").notNull(),
  error: text("error"),
  /** Every id the call touched, ours and PayPal's, so the calls behind one envelope can be found. */
  keys: text("keys").array().notNull(),
}, (t) => [index("paypal_calls_at").on(t.at)]);

/** Events PayPal reported (webhook or its event feed). The primary key is PayPal's event id, so each is applied once. */
export const paypalEvents = pgTable("paypal_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  source: text("source", { enum: ["webhook", "feed"] }).notNull(),
  resourceId: text("resource_id"),
  subject: text("subject"),
  outcome: text("outcome").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
}, (t) => [index("paypal_events_subject").on(t.subject)]);

export const emulatorState = pgTable("emulator_state", {
  id: text("id").primaryKey(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export type Root = typeof roots.$inferSelect;
export type BlockRow = typeof blocks.$inferSelect;
export type Spend = typeof spends.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type PayPalCall = typeof paypalCalls.$inferSelect;
export type PayPalEvent = typeof paypalEvents.$inferSelect;
export type RailAccount = typeof railAccounts.$inferSelect;
export type PositionEntry = typeof positionEntries.$inferSelect;
export type PositionAttribution = typeof positionAttributions.$inferSelect;
export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
