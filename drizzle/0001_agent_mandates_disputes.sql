ALTER TABLE "chat_sessions" ADD COLUMN "mode" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "mandate" text;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD COLUMN "agent_verdict" jsonb;--> statement-breakpoint
ALTER TABLE "remedies" ADD COLUMN "dispute_action" jsonb;