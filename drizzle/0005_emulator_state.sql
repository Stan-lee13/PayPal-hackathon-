CREATE TABLE IF NOT EXISTS "emulator_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
