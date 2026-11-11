CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"delta_minor" integer NOT NULL,
	"balance_after_minor" integer NOT NULL,
	"counterparty" text,
	"memo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"from_agent" text NOT NULL,
	"kind" text NOT NULL,
	"payee" text NOT NULL,
	"to_agent" text,
	"payout_to" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"request_hash" text NOT NULL,
	"signed" jsonb NOT NULL,
	"status" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payout_batch_id" text,
	"payout_item_id" text,
	"payout_status" text,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_request_hash_unique" UNIQUE("request_hash")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "mode" text DEFAULT 'settle' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "per_payment_minor" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_once" ON "ledger" USING btree ("agent","kind","ref");--> statement-breakpoint
CREATE INDEX "ledger_agent" ON "ledger" USING btree ("agent","id");--> statement-breakpoint
CREATE INDEX "transfers_from" ON "transfers" USING btree ("from_agent","created_at");--> statement-breakpoint
CREATE INDEX "transfers_to" ON "transfers" USING btree ("to_agent","created_at");