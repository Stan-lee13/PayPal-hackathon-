CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"ref" text,
	"outcome" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cart" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipping_option" text DEFAULT 'STANDARD' NOT NULL,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"quote" text NOT NULL,
	"source_id" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"confidence" real NOT NULL,
	"enforceable" boolean NOT NULL,
	"validation" jsonb NOT NULL,
	"extractor" text NOT NULL,
	"state" text NOT NULL,
	"state_reason" text NOT NULL,
	"due_at" timestamp with time zone,
	"evaluation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"paypal_dispute_id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"reason" text,
	"status" text,
	"stage" text,
	"amount_minor" integer,
	"currency" text,
	"paypal_created_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"policy" jsonb NOT NULL,
	"demo_clock_offset_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"chat_session_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb NOT NULL,
	"item_total_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"requested_total_minor" integer NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"capture_status" text,
	"capture_status_reason" text,
	"capture_amount_minor" integer,
	"capture_currency" text,
	"paypal_fee_minor" integer,
	"net_amount_minor" integer,
	"captured_at" timestamp with time zone,
	"capture_verified_at" timestamp with time zone,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"buyer_first_name" text,
	"buyer_email_redacted" text,
	"receipt_token" text NOT NULL,
	"extraction_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"extraction_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "orders_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "orders_receipt_token_unique" UNIQUE("receipt_token")
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
	"order_id" text,
	"processing_status" text DEFAULT 'RECEIVED' NOT NULL,
	"processing_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "paypal_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"image_alt" text NOT NULL,
	"swatch" text NOT NULL,
	"in_stock" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"paypal_refund_id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"remedy_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"paypal_created_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remedies" (
	"id" text PRIMARY KEY NOT NULL,
	"commitment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer,
	"currency" text,
	"customer_message" text NOT NULL,
	"rationale" text NOT NULL,
	"citations" jsonb NOT NULL,
	"proposed_by" text NOT NULL,
	"policy_checks" jsonb NOT NULL,
	"state" text NOT NULL,
	"paypal_request_id" text NOT NULL,
	"paypal_refund_id" text,
	"paypal_refund_status" text,
	"error_code" text,
	"error_detail" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remedies_paypal_request_id_unique" UNIQUE("paypal_request_id"),
	CONSTRAINT "remedies_paypal_refund_id_unique" UNIQUE("paypal_refund_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trackers" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"paypal_tracker_id" text,
	"tracking_number" text NOT NULL,
	"carrier" text NOT NULL,
	"status" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remedies" ADD CONSTRAINT "remedies_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remedies" ADD CONSTRAINT "remedies_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remedies" ADD CONSTRAINT "remedies_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trackers" ADD CONSTRAINT "trackers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_order" ON "audit_log" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_merchant" ON "audit_log" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "commitments_order" ON "commitments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commitments_merchant_state" ON "commitments" USING btree ("merchant_id","state");--> statement-breakpoint
CREATE INDEX "orders_merchant" ON "orders" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "paypal_events_order" ON "paypal_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "paypal_events_status" ON "paypal_events" USING btree ("processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "products_merchant_sku" ON "products" USING btree ("merchant_id","sku");--> statement-breakpoint
CREATE INDEX "refunds_order" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "remedies_order" ON "remedies" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remedies_one_active_per_commitment" ON "remedies" USING btree ("commitment_id") WHERE state in ('PROPOSED','APPROVED','EXECUTING','PENDING');--> statement-breakpoint
CREATE INDEX "sources_order" ON "sources" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sources_merchant" ON "sources" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "trackers_order" ON "trackers" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trackers_order_number" ON "trackers" USING btree ("order_id","tracking_number");