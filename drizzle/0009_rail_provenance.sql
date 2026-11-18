ALTER TABLE "roots" ADD COLUMN "rail_provider" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "rail_provider" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "rail_provider" text DEFAULT 'paypal' NOT NULL;