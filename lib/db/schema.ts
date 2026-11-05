import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Kept data model.
 *
 * Money is ALWAYS stored as integer minor units (e.g. cents) together with an
 * ISO-4217 currency code. Nothing in this schema stores floating-point money.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type MerchantPolicy = {
  /** Remedy kinds the merchant allows Kept to propose. */
  allowedRemedies: Array<"PARTIAL_REFUND" | "FULL_REFUND" | "ADD_TRACKING_REMINDER" | "MESSAGE_ONLY" | "DISPUTE_OFFER">;
  /** Hard cap on any single refund remedy, minor units. */
  maxRefundMinor: number;
  /** Partial refunds above this need an explicit "large refund" acknowledgement in the UI. */
  reviewThresholdMinor: number;
  /** Minimum extractor confidence required before a commitment can be enforceable. */
  minConfidence: number;
  /** Hours before a SHIP_BY deadline at which the commitment becomes AT_RISK. */
  shipAtRiskHours: number;
  /** Days before a REFUND_BY deadline at which the commitment becomes AT_RISK. */
  refundAtRiskDays: number;
  /** Default message tone shown to the merchant when drafting customer messages. */
  supportEmail: string;
  /** Pre-payment check of the chat's promised total. Absent = "BLOCK" (verify the PayPal order before capture). */
  checkoutGuard?: "OFF" | "WARN" | "HONOR" | "BLOCK";
};

export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  policy: jsonb("policy").$type<MerchantPolicy>().notNull(),
  /** Demo-only simulated clock offset (ms). Ignored unless DEMO_MODE=true. */
  demoClockOffsetMs: integer("demo_clock_offset_ms").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceMinor: integer("price_minor").notNull(),
  currency: text("currency").notNull(),
  imageAlt: text("image_alt").notNull(),
  swatch: text("swatch").notNull(),
  inStock: integer("in_stock").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("products_merchant_sku").on(t.merchantId, t.sku)]);

/**
 * Immutable source documents. Promises are only enforceable if their quote is
 * found verbatim in one of these. Chat transcripts are snapshotted into a source
 * at checkout so a later edit to the conversation cannot change the evidence.
 */
export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  orderId: text("order_id"),
  kind: text("kind", { enum: ["CHAT_TRANSCRIPT", "REFUND_POLICY", "SHIPPING_POLICY", "PRODUCT_PAGE", "USER_MANDATE"] }).notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("sources_order").on(t.orderId), index("sources_merchant").on(t.merchantId)]);

export type AgentVerdict = {
  decision: "PROCEED" | "DECLINE";
  checks: Array<{ check: string; ok: boolean; detail: string }>;
  summary: string;
  /** One-line summary of the merchant's Kept promise record, as the agent saw it. */
  record?: string;
  by: "ai" | "scripted";
};

export type ChatMessage = { role: "customer" | "assistant" | "agent"; text: string; at: string; generatedBy?: "ai" | "scripted" };

export const chatSessions = pgTable("chat_sessions", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  messages: jsonb("messages").$type<ChatMessage[]>().notNull().default(sql`'[]'::jsonb`),
  /** The basket under discussion, set by the storefront (product ids + qty). */
  cart: jsonb("cart").$type<Array<{ productId: string; qty: number }>>().notNull().default(sql`'[]'::jsonb`),
  shippingOption: text("shipping_option", { enum: ["STANDARD", "EXPRESS"] }).notNull().default("STANDARD"),
  /** "customer" = the shopper chats; "agent" = the shopper's own AI agent negotiates on their behalf. */
  mode: text("mode", { enum: ["customer", "agent"] }).notNull().default("customer"),
  /** The shopper's verbatim instruction to their agent (agent mode only). */
  mandate: text("mandate"),
  /** Deterministic pre-payment guard result for agent mode. */
  agentVerdict: jsonb("agent_verdict").$type<AgentVerdict>(),
  orderId: text("order_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type OrderLine = { productId: string; sku: string; name: string; qty: number; unitMinor: number };

export const orders = pgTable("orders", {
  /** Kept's internal id. Sent to PayPal as purchase_units[0].custom_id. */
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  chatSessionId: text("chat_session_id").references(() => chatSessions.id),
  status: text("status", {
    enum: ["DRAFT", "PAYPAL_CREATED", "APPROVED", "PREFLIGHT_VALIDATING", "READY_TO_CAPTURE", "CAPTURE_BLOCKED", "NEEDS_CONFIRMATION", "PRECHECK_FAILED",
      "CAPTURE_REQUESTED", "CAPTURED", "CAPTURE_PENDING", "CAPTURE_DECLINED", "VOIDED"],
  }).notNull().default("DRAFT"),
  /** KEPT_PROTECTED: Kept controls capture and runs the preflight gate. EXTERNAL: captured elsewhere; Kept only monitors after payment. */
  checkoutChannel: text("checkout_channel", { enum: ["KEPT_PROTECTED", "EXTERNAL"] }).notNull().default("KEPT_PROTECTED"),
  /** PayPal orders this Kept order used before a correction (blocked, never captured). */
  supersededPaypalOrderIds: jsonb("superseded_paypal_order_ids").$type<string[]>().notNull().default([]),
  currency: text("currency").notNull(),
  lines: jsonb("lines").$type<OrderLine[]>().notNull(),
  itemTotalMinor: integer("item_total_minor").notNull(),
  shippingMinor: integer("shipping_minor").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  /** Amount Kept asked PayPal to charge. Not authoritative — the capture is. */
  requestedTotalMinor: integer("requested_total_minor").notNull(),
  paypalOrderId: text("paypal_order_id").unique(),
  paypalCaptureId: text("paypal_capture_id").unique(),
  /** Authoritative capture facts, only ever written from a PayPal GET. */
  captureStatus: text("capture_status"),
  captureStatusReason: text("capture_status_reason"),
  captureAmountMinor: integer("capture_amount_minor"),
  captureCurrency: text("capture_currency"),
  paypalFeeMinor: integer("paypal_fee_minor"),
  netAmountMinor: integer("net_amount_minor"),
  capturedAt: ts("captured_at"),
  captureVerifiedAt: ts("capture_verified_at"),
  /** Sum of COMPLETED refunds as confirmed by PayPal. */
  refundedMinor: integer("refunded_minor").notNull().default(0),
  buyerFirstName: text("buyer_first_name"),
  /** Redacted (j***@example.com). The raw address is never stored. */
  buyerEmailRedacted: text("buyer_email_redacted"),
  /** 128-bit+ random token for the customer's living receipt. */
  receiptToken: text("receipt_token").notNull().unique(),
  extractionStatus: text("extraction_status", { enum: ["NOT_STARTED", "COMPLETED", "FAILED"] }).notNull().default("NOT_STARTED"),
  extractionNote: text("extraction_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("orders_merchant").on(t.merchantId, t.createdAt)]);

/** Merchant promises (PRICE_AS_QUOTED, SHIP_BY, REFUND_BY, OTHER) and the shopper's mandate to their own agent (MANDATE_*). */
export const COMMITMENT_TYPES = ["PRICE_AS_QUOTED", "SHIP_BY", "REFUND_BY", "OTHER", "MANDATE_MAX_TOTAL", "MANDATE_SHIP_WITHIN"] as const;
export type CommitmentType = (typeof COMMITMENT_TYPES)[number];
export const COMMITMENT_STATES = ["PENDING", "KEPT", "AT_RISK", "BROKEN", "UNVERIFIABLE", "NEEDS_CONFIRMATION", "WAIVED"] as const;
export type CommitmentState = (typeof COMMITMENT_STATES)[number];

export const commitments = pgTable("commitments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  type: text("type", { enum: COMMITMENT_TYPES }).notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  quote: text("quote").notNull(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  spanStart: integer("span_start").notNull(),
  spanEnd: integer("span_end").notNull(),
  confidence: real("confidence").notNull(),
  /** True only if every deterministic validation check passed. */
  enforceable: boolean("enforceable").notNull(),
  validation: jsonb("validation").$type<Array<{ check: string; ok: boolean; detail: string }>>().notNull(),
  extractor: text("extractor", { enum: ["llm", "rules"] }).notNull(),
  state: text("state", { enum: COMMITMENT_STATES }).notNull(),
  stateReason: text("state_reason").notNull(),
  dueAt: ts("due_at"),
  /** Deterministic evaluator output: discrepancy etc. */
  evaluation: jsonb("evaluation").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("commitments_order").on(t.orderId), index("commitments_merchant_state").on(t.merchantId, t.state)]);

export const paypalEvents = pgTable("paypal_events", {
  id: text("id").primaryKey(),
  /** PayPal's event id. Unique => duplicate deliveries are ignored. */
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  summary: text("summary"),
  verification: text("verification", { enum: ["SUCCESS", "SIMULATED"] }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  orderId: text("order_id"),
  processingStatus: text("processing_status", { enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] }).notNull().default("RECEIVED"),
  processingError: text("processing_error"),
  attempts: integer("attempts").notNull().default(0),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
}, (t) => [index("paypal_events_order").on(t.orderId), index("paypal_events_status").on(t.processingStatus)]);

export const REMEDY_KINDS = ["PARTIAL_REFUND", "FULL_REFUND", "ADD_TRACKING_REMINDER", "MESSAGE_ONLY", "DISPUTE_OFFER"] as const;
export type RemedyKind = (typeof REMEDY_KINDS)[number];
export const REMEDY_STATES = ["PROPOSED", "APPROVED", "EXECUTING", "PENDING", "COMPLETED", "FAILED", "REJECTED", "SUPERSEDED"] as const;
export type RemedyState = (typeof REMEDY_STATES)[number];

export type DisputeAction =
  | { type: "PROVIDE_EVIDENCE"; disputeId: string; trackingNumber: string; carrier: string; note: string }
  | { type: "MAKE_OFFER"; disputeId: string; amountMinor: number; currency: string; note: string }
  | { type: "SEND_MESSAGE"; disputeId: string; message: string };

export const remedies = pgTable("remedies", {
  id: text("id").primaryKey(),
  commitmentId: text("commitment_id").notNull().references(() => commitments.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  kind: text("kind", { enum: REMEDY_KINDS }).notNull(),
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  customerMessage: text("customer_message").notNull(),
  rationale: text("rationale").notNull(),
  citations: jsonb("citations").$type<string[]>().notNull(),
  proposedBy: text("proposed_by", { enum: ["ai", "rules"] }).notNull(),
  policyChecks: jsonb("policy_checks").$type<Array<{ check: string; ok: boolean; detail: string }>>().notNull(),
  /** For DISPUTE_OFFER: the exact PayPal Disputes API action to take on approval. */
  disputeAction: jsonb("dispute_action").$type<DisputeAction>(),
  state: text("state", { enum: REMEDY_STATES }).notNull(),
  /** Idempotency key sent as PayPal-Request-Id. Generated once, reused on retry. */
  paypalRequestId: text("paypal_request_id").notNull().unique(),
  paypalRefundId: text("paypal_refund_id").unique(),
  paypalRefundStatus: text("paypal_refund_status"),
  errorCode: text("error_code"),
  errorDetail: text("error_detail"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  executedAt: ts("executed_at"),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("remedies_order").on(t.orderId),
  // At most one live remedy per commitment: prevents double proposals/refunds.
  uniqueIndex("remedies_one_active_per_commitment")
    .on(t.commitmentId)
    .where(sql`state in ('PROPOSED','APPROVED','EXECUTING','PENDING')`),
]);

/** Every refund PayPal knows about for a capture — whether Kept issued it or not. */
export const refunds = pgTable("refunds", {
  paypalRefundId: text("paypal_refund_id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  remedyId: text("remedy_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  statusReason: text("status_reason"),
  paypalCreatedAt: ts("paypal_created_at"),
  verifiedAt: ts("verified_at").notNull(),
}, (t) => [index("refunds_order").on(t.orderId)]);

export const trackers = pgTable("trackers", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  paypalTrackerId: text("paypal_tracker_id"),
  trackingNumber: text("tracking_number").notNull(),
  carrier: text("carrier").notNull(),
  status: text("status").notNull(),
  /** Time PayPal accepted the tracker (or Kept received PayPal's confirmation). */
  recordedAt: ts("recorded_at").notNull(),
}, (t) => [index("trackers_order").on(t.orderId), uniqueIndex("trackers_order_number").on(t.orderId, t.trackingNumber)]);

export const disputes = pgTable("disputes", {
  paypalDisputeId: text("paypal_dispute_id").primaryKey(),
  orderId: text("order_id"),
  reason: text("reason"),
  status: text("status"),
  stage: text("stage"),
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  paypalCreatedAt: ts("paypal_created_at"),
  verifiedAt: ts("verified_at").notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  merchantId: text("merchant_id").notNull(),
  orderId: text("order_id"),
  actor: text("actor", { enum: ["ai", "merchant", "system", "paypal", "customer"] }).notNull(),
  action: text("action").notNull(),
  ref: text("ref"),
  outcome: text("outcome", { enum: ["OK", "REJECTED", "FAILED", "PENDING", "INFO"] }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Position in this entry's chain (per order; merchant-level entries form their own chain). */
  seq: integer("seq"),
  /** SHA-256 links (lib/ledger/chain.ts). Null only for rows written before chaining existed. */
  prevHash: text("prev_hash"),
  hash: text("hash"),
}, (t) => [index("audit_order").on(t.orderId, t.createdAt), index("audit_merchant").on(t.merchantId, t.createdAt)]);

/** Pre-capture verdicts: the authoritative PayPal order compared with the promised total. Append-only. */
export const preflights = pgTable("preflights", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  merchantId: text("merchant_id").notNull(),
  paypalOrderId: text("paypal_order_id").notNull(),
  verdict: text("verdict", { enum: ["READY_TO_CAPTURE", "BLOCKED_MISMATCH", "NEEDS_CONFIRMATION", "PRECHECK_FAILED"] }).notNull(),
  reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
  /** true = protected checkout (verdict gates capture); false = recorded only (monitor-only checkout). */
  enforced: boolean("enforced").notNull(),
  promisedMinor: integer("promised_minor"),
  promisedCurrency: text("promised_currency"),
  orderMinor: integer("order_minor"),
  orderCurrency: text("order_currency"),
  diffMinor: integer("diff_minor"),
  quote: text("quote"),
  sourceId: text("source_id"),
  sourceSha256: text("source_sha256"),
  /** SHA-256 of the money-relevant fields of the PayPal order as fetched (bound verdict). */
  orderDigest: text("order_digest"),
  paypalStatus: text("paypal_status"),
  checkedAt: ts("checked_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  resolution: text("resolution", { enum: ["MERCHANT_CONFIRMED_AMOUNT", "CORRECTED_ORDER"] }),
  resolvedBy: text("resolved_by"),
  resolvedAt: ts("resolved_at"),
  /** Set when this verdict authorised a capture request. */
  consumedAt: ts("consumed_at"),
}, (t) => [index("preflights_order").on(t.orderId, t.checkedAt)]);
export type Preflight = typeof preflights.$inferSelect;

/** Every Claude call: tokens and cost (micro-USD), for the daily spend cap. */
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

/** Memoised AI results keyed by a hash of their exact inputs. */
export const aiCache = pgTable("ai_cache", {
  key: text("key").primaryKey(),
  purpose: text("purpose").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export type Merchant = typeof merchants.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Commitment = typeof commitments.$inferSelect;
export type Remedy = typeof remedies.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Tracker = typeof trackers.$inferSelect;
export type PaypalEvent = typeof paypalEvents.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
