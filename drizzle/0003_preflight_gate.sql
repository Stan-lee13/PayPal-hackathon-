ALTER TABLE "orders" ADD COLUMN "checkout_channel" text DEFAULT 'KEPT_PROTECTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "superseded_paypal_order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preflights" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL REFERENCES "orders"("id"),
	"merchant_id" text NOT NULL,
	"paypal_order_id" text NOT NULL,
	"verdict" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"enforced" boolean NOT NULL,
	"promised_minor" integer,
	"promised_currency" text,
	"order_minor" integer,
	"order_currency" text,
	"diff_minor" integer,
	"quote" text,
	"source_id" text,
	"source_sha256" text,
	"order_digest" text,
	"paypal_status" text,
	"checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preflights_order" ON "preflights" ("order_id","checked_at");
