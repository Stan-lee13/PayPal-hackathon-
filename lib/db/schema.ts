/**
 * MergePay data model.
 *
 *   freelancer ──< contract >── client          (agreed price per issue, or an hourly rate + cap)
 *                    │
 *                    └──< invoice              (one PR → one PayPal invoice → paid → merged)
 *
 * Money is always integer minor units. Amounts on an invoice come only from the contract
 * (lib/agent/pricing.ts); the AI writes descriptions, never numbers.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const freelancers = pgTable("freelancers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  /** Where the freelancer's PayPal business account receives invoice payments (shown on the invoice). */
  businessName: text("business_name"),
  /** SHA-256 of the bearer token the editor's MCP client sends. The token itself is never stored. */
  mcpTokenHash: text("mcp_token_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  freelancerId: text("freelancer_id").notNull().references(() => freelancers.id),
  name: text("name").notNull(),
  company: text("company"),
  /** The PayPal invoice goes here. */
  email: text("email").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ContractPricing = "FIXED_PER_ISSUE" | "HOURLY";

export const contracts = pgTable("contracts", {
  id: text("id").primaryKey(),
  freelancerId: text("freelancer_id").notNull().references(() => freelancers.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  /** GitHub repository the work lands in, "owner/name". */
  repo: text("repo").notNull(),
  title: text("title").notNull(),
  currency: text("currency").notNull().default("USD"),
  pricing: text("pricing", { enum: ["FIXED_PER_ISSUE", "HOURLY"] }).notNull(),
  /** FIXED_PER_ISSUE: agreed price per issue number, e.g. { "12": 45000 }. */
  issuePrices: jsonb("issue_prices").$type<Record<string, number>>().notNull().default({}),
  /** HOURLY: rate per hour in minor units. */
  hourlyRateMinor: integer("hourly_rate_minor"),
  /** HOURLY: most hours one invoice may bill without the client's say-so. */
  maxHoursPerInvoice: integer("max_hours_per_invoice"),
  /** Both sides agreed: the PR merges once its invoice is paid in full. */
  mergeOnPayment: boolean("merge_on_payment").notNull().default(true),
  mergeMethod: text("merge_method", { enum: ["squash", "merge", "rebase"] }).notNull().default("squash"),
  /** Unguessable link the client opens to read and accept the terms. */
  clientToken: text("client_token").notNull().unique(),
  clientAcceptedAt: ts("client_accepted_at"),
  status: text("status", { enum: ["ACTIVE", "PAUSED"] }).notNull().default("ACTIVE"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("contracts_repo").on(t.repo)]);

export type LineItem = {
  kind: "ISSUE" | "HOURS" | "EXTRA";
  /** Issue number for ISSUE items; free text otherwise. */
  ref: string | null;
  name: string;
  description: string;
  /** Decimal string as PayPal expects it ("1", "2.5"). */
  quantity: string;
  unitAmountMinor: number;
  totalMinor: number;
};

export type ScopeReport = {
  source: "claude" | "rules";
  summary: string;
  inScope: Array<{ issue: string; evidence: string }>;
  /** Work the PR contains that the agreed issues don't cover. Never billed unless the freelancer adds it. */
  outOfScope: Array<{ summary: string; files: string[] }>;
  warnings: string[];
};

export const INVOICE_STATES = ["DRAFT", "SENT", "PAID", "MERGED", "MERGE_BLOCKED", "CANCELLED"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull().references(() => contracts.id),
  freelancerId: text("freelancer_id").notNull().references(() => freelancers.id),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  prTitle: text("pr_title").notNull(),
  prUrl: text("pr_url").notNull(),
  /** The exact commit the client is paying for. Merge is refused if the PR head moves. */
  headSha: text("head_sha").notNull(),
  status: text("status", { enum: INVOICE_STATES }).notNull().default("DRAFT"),
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  lineItems: jsonb("line_items").$type<LineItem[]>().notNull(),
  scope: jsonb("scope").$type<ScopeReport>().notNull(),
  note: text("note"),
  previewUrl: text("preview_url"),
  paypalInvoiceId: text("paypal_invoice_id").unique(),
  paypalInvoiceNumber: text("paypal_invoice_number"),
  payerViewUrl: text("payer_view_url"),
  sentAt: ts("sent_at"),
  paidAt: ts("paid_at"),
  paidAmountMinor: integer("paid_amount_minor"),
  mergedAt: ts("merged_at"),
  mergeCommitSha: text("merge_commit_sha"),
  blockReason: text("block_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("invoices_freelancer").on(t.freelancerId, t.createdAt),
  // one live invoice per pull request
  uniqueIndex("invoices_live_pr").on(t.repo, t.prNumber).where(sql`status <> 'CANCELLED'`),
]);

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
  invoiceId: text("invoice_id"),
  processingStatus: text("processing_status", { enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] }).notNull().default("RECEIVED"),
  processingError: text("processing_error"),
  attempts: integer("attempts").notNull().default(0),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
}, (t) => [index("paypal_events_status").on(t.processingStatus)]);

/** Tamper-evident trail: one SHA-256 chain per invoice, plus one per freelancer for account-level entries. */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  freelancerId: text("freelancer_id").notNull(),
  invoiceId: text("invoice_id"),
  actor: text("actor", { enum: ["ai", "freelancer", "client", "system", "paypal", "github"] }).notNull(),
  action: text("action").notNull(),
  ref: text("ref"),
  outcome: text("outcome", { enum: ["OK", "REJECTED", "FAILED", "PENDING", "INFO"] }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  seq: integer("seq").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [
  index("audit_invoice").on(t.invoiceId, t.seq),
  uniqueIndex("audit_chain_seq").on(t.freelancerId, sql`coalesce(${t.invoiceId}, '-')`, t.seq),
]);

/** Every Claude call: what it was for, which model served it, what it cost (micro-USD). */
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

/** Simulator state (PayPal and GitHub), persisted when MERGEPAY_SIM_PERSIST=1 (serverless hosts). */
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

export type Freelancer = typeof freelancers.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type PaypalEvent = typeof paypalEvents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
