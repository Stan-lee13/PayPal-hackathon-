ALTER TABLE "audit_log" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_seq" ON "audit_log" ("merchant_id", (coalesce("order_id", '-')), "seq") WHERE "seq" IS NOT NULL;
