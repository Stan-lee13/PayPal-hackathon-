/**
 * Envelope gateway state. Authority lives in signed envelopes that agents hold (lib/envelope/core.ts);
 * this database only holds what signatures can't: how much has been spent at each level, what has
 * been revoked, which requests were already seen, and what PayPal did.
 * Money is always integer minor units.
 */
import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
  /** The hold on the principal's funding instrument. Spends are partial captures of it; closing voids the rest. */
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id").unique(),
  authorizationExpiresAt: ts("authorization_expires_at"),
  capturedMinor: integer("captured_minor").notNull().default(0),
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

export type Receipt = {
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
  paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string | null; payoutItemId: string | null };
  issuedAt: string;
  gateway: string;
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
  reasons: jsonb("reasons").$type<Violation[]>().notNull().default([]),
  captureId: text("capture_id"),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  payoutTransactionId: text("payout_transaction_id"),
  payoutStatus: text("payout_status"),
  refundId: text("refund_id"),
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

/** Every change to a balance, one row each. `(agent, kind, ref)` is unique so a credit or debit can never be applied twice. */
export const ledger = pgTable("ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agent: text("agent").notNull(),
  kind: text("kind", { enum: ["income", "transfer_in", "transfer_out", "payout", "withdrawal", "reversal"] }).notNull(),
  /** The spend or transfer this entry belongs to. */
  ref: text("ref").notNull(),
  deltaMinor: integer("delta_minor").notNull(),
  balanceAfterMinor: integer("balance_after_minor").notNull(),
  counterparty: text("counterparty"),
  memo: text("memo").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ledger_once").on(t.agent, t.kind, t.ref), index("ledger_agent").on(t.agent, t.id)]);

export const TRANSFER_STATES = ["DENIED", "BOOKED", "SENDING", "PAID", "PAYOUT_PENDING", "UNCLAIMED", "FAILED"] as const;
export type TransferReceipt = {
  v: "envelope-transfer-receipt/1";
  transfer: string;
  request: SignedTransfer["request"] | SignedCharge["request"];
  requestSig: string;
  /** Present when the money was pulled by a merchant through a card the agent issued. */
  card?: { id: string; number: string; label: string; charge: number; of: number };
  from: { account: string; agent: string; agentLabel: string };
  /** A book transfer between two accounts here, or a PayPal payout. */
  to: { kind: "account"; account: string; agent: string; agentLabel: string } | { kind: "paypal"; address: string; payoutBatchId: string; mode: string };
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
