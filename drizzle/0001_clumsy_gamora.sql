CREATE TABLE "accounts" (
	"agent" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"label" text NOT NULL,
	"owner" text NOT NULL,
	"owner_name" text NOT NULL,
	"settle_to" text NOT NULL,
	"signed" jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_unique" UNIQUE("account")
);
--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "payee_agent" text;--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "payout_to" text;--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "promise_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "promise_note" jsonb;--> statement-breakpoint
CREATE INDEX "spends_payee_agent" ON "spends" USING btree ("payee_agent","created_at");