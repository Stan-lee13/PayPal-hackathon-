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
	"invoice_id" text,
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
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"freelancer_id" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
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
ALTER TABLE "clients" ADD CONSTRAINT "clients_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_freelancer_id_freelancers_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."freelancers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_invoice" ON "audit_log" USING btree ("invoice_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_seq" ON "audit_log" USING btree ("freelancer_id",coalesce("invoice_id", '-'),"seq");--> statement-breakpoint
CREATE INDEX "contracts_repo" ON "contracts" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "invoices_freelancer" ON "invoices" USING btree ("freelancer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_live_pr" ON "invoices" USING btree ("repo","pr_number") WHERE status <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "paypal_events_status" ON "paypal_events" USING btree ("processing_status");