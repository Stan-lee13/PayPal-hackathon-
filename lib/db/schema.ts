/**
 * Envelope gateway state. Authority lives in signed envelopes that agents hold (lib/envelope/core.ts);
 * this database only holds what signatures can't: how much has been spent at each level, what has
 * been revoked, which requests were already seen, and what PayPal did.
 * Money is always integer minor units.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Block, Caps, SignedSpend, Violation } from "../envelope/core";

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

export const SPEND_STATES = ["DENIED", "RESERVED", "CAPTURED", "PAID", "PAYOUT_PENDING", "UNCLAIMED", "FAILED"] as const;
export type SpendState = (typeof SPEND_STATES)[number];

export type Receipt = {
  v: "envelope-receipt/1";
  spend: string;
  decision: "PAID";
  request: SignedSpend["request"];
  requestSig: string;
  /** The authority chain: block ids and hashes, root first. */
  chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>;
  principal: string;
  paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string; payoutItemId: string | null };
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
  signed: jsonb("signed").$type<SignedSpend>().notNull(),
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
  createdAt: ts("created_at").notNull().defaultNow(),
  settledAt: ts("settled_at"),
}, (t) => [index("spends_root").on(t.rootId, t.createdAt)]);

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

export const paypalEvents = pgTable("paypal_events", {
  id: text("id").primaryKey(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  verification: text("verification", { enum: ["SUCCESS", "SIMULATED"] }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processingStatus: text("processing_status", { enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] }).notNull().default("RECEIVED"),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

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

export const aiUsage = pgTable("ai_usage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("ai_usage_created").on(t.createdAt)]);

export const aiCache = pgTable("ai_cache", {
  key: text("key").primaryKey(),
  purpose: text("purpose").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

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
