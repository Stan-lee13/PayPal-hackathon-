CREATE TABLE "paypal_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"op" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_id" text,
	"http_status" integer NOT NULL,
	"paypal_status" text,
	"resource_id" text,
	"amount_minor" integer,
	"currency" text,
	"debug_id" text,
	"ms" integer NOT NULL,
	"error" text,
	"keys" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"resource_id" text,
	"subject" text,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "paypal_calls_at" ON "paypal_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "paypal_events_subject" ON "paypal_events" USING btree ("subject");