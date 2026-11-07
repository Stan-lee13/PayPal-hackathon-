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

/** Tamper-evident trail: one SHA-256 chain per invoice or bounty, plus one per account. `freelancerId` holds the account that owns the chain (a freelancer or a company). */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  freelancerId: text("freelancer_id").notNull(),
  /** The invoice or bounty this entry belongs to (null: account-level). */
  subjectId: text("subject_id"),
  actor: text("actor", { enum: ["ai", "freelancer", "client", "system", "paypal", "github", "company", "developer"] }).notNull(),
  action: text("action").notNull(),
  ref: text("ref"),
  outcome: text("outcome", { enum: ["OK", "REJECTED", "FAILED", "PENDING", "INFO"] }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  seq: integer("seq").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [
  index("audit_subject").on(t.subjectId, t.seq),
  uniqueIndex("audit_chain_seq").on(t.freelancerId, sql`coalesce(${t.subjectId}, '-')`, t.seq),
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

// ---------------------------------------------------------------------------
// Bounties: a company funds a task through PayPal; a developer completes it; verified work is paid.
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const developers = pgTable("developers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  githubLogin: text("github_login").notNull().unique(),
  /** Where payouts go. PayPal performs identity verification (KYC) on the receiving account. */
  paypalEmail: text("paypal_email").notNull(),
  country: text("country"),
  /** SHA-256 of the developer's MCP token (their coding agent can find, claim and submit bounties). */
  mcpTokenHash: text("mcp_token_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const BOUNTY_STATES = ["DRAFT", "AWAITING_FUNDS", "OPEN", "CLAIMED", "IN_REVIEW", "PAYING", "PAID", "PAYOUT_FAILED", "DISPUTED", "CANCELLED", "EXPIRED"] as const;
export type BountyState = (typeof BOUNTY_STATES)[number];

export const bounties = pgTable("bounties", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  repo: text("repo").notNull(),
  issueNumber: integer("issue_number"),
  title: text("title").notNull(),
  /** Public summary, shown on the board. */
  summary: text("summary").notNull(),
  /** Full task details; for NDA bounties only shown after the NDA is signed. */
  details: text("details").notNull(),
  criteria: jsonb("criteria").$type<string[]>().notNull(),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  currency: text("currency").notNull().default("USD"),
  /** What the developer receives, in full. */
  amountMinor: integer("amount_minor").notNull(),
  /** MergePay's fee, paid by the company on top (covers PayPal's fees). */
  feeMinor: integer("fee_minor").notNull(),
  deadline: ts("deadline"),
  ndaRequired: boolean("nda_required").notNull().default(false),
  ndaText: text("nda_text"),
  requiresTests: boolean("requires_tests").notNull().default(true),
  requiredChecks: jsonb("required_checks").$type<string[]>().notNull().default([]),
  scopePaths: jsonb("scope_paths").$type<string[]>().notNull().default([]),
  /** How long a claim lasts before the bounty reopens. */
  claimHours: integer("claim_hours").notNull().default(72),
  status: text("status", { enum: BOUNTY_STATES }).notNull().default("DRAFT"),
  fundingAttempt: integer("funding_attempt").notNull().default(0),
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id").unique(),
  authorizationExpiresAt: ts("authorization_expires_at"),
  captureId: text("capture_id"),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  payoutStatus: text("payout_status"),
  refundId: text("refund_id"),
  claimedBy: text("claimed_by").references(() => developers.id),
  claimedAt: ts("claimed_at"),
  claimExpiresAt: ts("claim_expires_at"),
  paidTo: text("paid_to").references(() => developers.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  fundedAt: ts("funded_at"),
  paidAt: ts("paid_at"),
  closedAt: ts("closed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("bounties_status").on(t.status, t.createdAt)]);

export const SUBMISSION_STATES = ["VERIFYING", "VERIFIED", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "DISPUTED", "WITHDRAWN"] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(),
  bountyId: text("bounty_id").notNull().references(() => bounties.id),
  developerId: text("developer_id").notNull().references(() => developers.id),
  prNumber: integer("pr_number").notNull(),
  prUrl: text("pr_url").notNull(),
  headSha: text("head_sha").notNull(),
  status: text("status", { enum: SUBMISSION_STATES }).notNull().default("VERIFYING"),
  report: jsonb("report").$type<import("../verify/index").VerificationReport>(),
  companyNote: text("company_note"),
  developerNote: text("developer_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
}, (t) => [index("submissions_bounty").on(t.bountyId, t.createdAt)]);

export const ndaSignatures = pgTable("nda_signatures", {
  id: text("id").primaryKey(),
  bountyId: text("bounty_id").notNull().references(() => bounties.id),
  developerId: text("developer_id").notNull().references(() => developers.id),
  /** SHA-256 of the exact NDA text signed, so later edits can't change what was agreed. */
  ndaSha256: text("nda_sha256").notNull(),
  signedName: text("signed_name").notNull(),
  signedAt: ts("signed_at").notNull().defaultNow(),
  ip: text("ip"),
}, (t) => [uniqueIndex("nda_once").on(t.bountyId, t.developerId)]);

export type Company = typeof companies.$inferSelect;
export type Developer = typeof developers.$inferSelect;
export type Bounty = typeof bounties.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
