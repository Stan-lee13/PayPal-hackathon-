CREATE TABLE "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"freelancer_id" text NOT NULL,
	"subject_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"ref" text,
	"outcome" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"repo" text NOT NULL,
	"issue_number" integer,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"details" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount_minor" integer NOT NULL,
	"fee_minor" integer NOT NULL,
	"deadline" timestamp with time zone,
	"nda_required" boolean DEFAULT false NOT NULL,
	"nda_text" text,
	"requires_tests" boolean DEFAULT true NOT NULL,
	"required_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claim_hours" integer DEFAULT 72 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"funding_attempt" integer DEFAULT 0 NOT NULL,
	"paypal_order_id" text,
	"authorization_id" text,
	"authorization_expires_at" timestamp with time zone,
	"capture_id" text,
	"payout_batch_id" text,
	"payout_item_id" text,
	"payout_status" text,
	"refund_id" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"paid_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"funded_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounties_authorization_id_unique" UNIQUE("authorization_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"freelancer_id" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"freelancer_id" text NOT NULL,
	"client_id" text NOT NULL,
	"repo" text NOT NULL,
	"title" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"pricing" text NOT NULL,
	"issue_prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hourly_rate_minor" integer,
	"max_hours_per_invoice" integer,
	"merge_on_payment" boolean DEFAULT true NOT NULL,
	"merge_method" text DEFAULT 'squash' NOT NULL,
	"client_token" text NOT NULL,
	"client_accepted_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_client_token_unique" UNIQUE("client_token")
);
--> statement-breakpoint
CREATE TABLE "developers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"github_login" text NOT NULL,
	"paypal_email" text NOT NULL,
	"country" text,
	"mcp_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developers_github_login_unique" UNIQUE("github_login")
);
--> statement-breakpoint
CREATE TABLE "emulator_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freelancers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"business_name" text,
	"mcp_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"freelancer_id" text NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_title" text NOT NULL,
	"pr_url" text NOT NULL,
	"head_sha" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"line_items" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"note" text,
	"preview_url" text,
	"paypal_invoice_id" text,
	"paypal_invoice_number" text,
	"payer_view_url" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_amount_minor" integer,
	"merged_at" timestamp with time zone,
	"merge_commit_sha" text,
	"block_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "nda_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"bounty_id" text NOT NULL,
	"developer_id" text NOT NULL,
	"nda_sha256" text NOT NULL,
	"signed_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "paypal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"summary" text,
	"verification" text NOT NULL,
	"payload" jsonb NOT NULL,
	"invoice_id" text,
	"processing_status" text DEFAULT 'RECEIVED' NOT NULL,
	"processing_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "paypal_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"bounty_id" text NOT NULL,
	"developer_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text NOT NULL,
	"head_sha" text NOT NULL,
	"status" text DEFAULT 'VERIFYING' NOT NULL,
	"report" jsonb,
	"company_note" text,
	"developer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_claimed_by_developers_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."developers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_paid_to_developers_id_fk" FOREIGN KEY ("paid_to") REFERENCES "public"."developers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_signatures" ADD CONSTRAINT "nda_signatures_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_signatures" ADD CONSTRAINT "nda_signatures_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit_log" USING btree ("subject_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_seq" ON "audit_log" USING btree ("freelancer_id",coalesce("subject_id", '-'),"seq");--> statement-breakpoint
CREATE INDEX "bounties_status" ON "bounties" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contracts_repo" ON "contracts" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "invoices_freelancer" ON "invoices" USING btree ("freelancer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_live_pr" ON "invoices" USING btree ("repo","pr_number") WHERE status <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "nda_once" ON "nda_signatures" USING btree ("bounty_id","developer_id");--> statement-breakpoint
CREATE INDEX "paypal_events_status" ON "paypal_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "submissions_bounty" ON "submissions" USING btree ("bounty_id","created_at");