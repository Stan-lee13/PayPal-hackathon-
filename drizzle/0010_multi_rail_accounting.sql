CREATE TABLE "position_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"rail" text NOT NULL,
	"currency" text NOT NULL,
	"custody" text DEFAULT 'provider' NOT NULL,
	"external_account_id" text,
	"bucket" text NOT NULL,
	"kind" text NOT NULL,
	"delta_minor" integer NOT NULL,
	"ref" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"rail" text NOT NULL,
	"currency" text NOT NULL,
	"custody" text NOT NULL,
	"external_account_id" text,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner" text,
	"rail" text NOT NULL,
	"currency" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"available" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "rail" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "position_entries_once" ON "position_entries" USING btree ("rail","currency","bucket","kind","ref");--> statement-breakpoint
CREATE INDEX "position_entries_owner" ON "position_entries" USING btree ("owner","rail","currency","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "rail_accounts_identity" ON "rail_accounts" USING btree ("owner","rail","currency","custody",coalesce("external_account_id", '-'));--> statement-breakpoint
CREATE INDEX "reconciliation_runs_at" ON "reconciliation_runs" USING btree ("rail","at");--> statement-breakpoint
CREATE INDEX "ledger_agent_rail" ON "ledger" USING btree ("agent","rail","currency");