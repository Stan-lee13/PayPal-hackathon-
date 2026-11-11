CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"holder" text NOT NULL,
	"label" text NOT NULL,
	"merchant_agent" text NOT NULL,
	"per_charge_minor" integer NOT NULL,
	"max_charges" integer NOT NULL,
	"every_seconds" integer NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"signed" jsonb NOT NULL,
	"charges" integer DEFAULT 0 NOT NULL,
	"charged_minor" integer DEFAULT 0 NOT NULL,
	"last_charge_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "per_day_minor" integer;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "card_id" text;--> statement-breakpoint
CREATE INDEX "cards_holder" ON "cards" USING btree ("holder","created_at");--> statement-breakpoint
CREATE INDEX "cards_merchant" ON "cards" USING btree ("merchant_agent","created_at");--> statement-breakpoint
CREATE INDEX "transfers_card" ON "transfers" USING btree ("card_id","created_at");