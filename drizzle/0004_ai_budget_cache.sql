CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_created" ON "ai_usage" ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
