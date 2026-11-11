CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope_id" text NOT NULL,
	"subject_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"ref" text,
	"outcome" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"root_id" text NOT NULL,
	"parent_id" text,
	"depth" integer NOT NULL,
	"hash" text NOT NULL,
	"holder" text NOT NULL,
	"holder_label" text NOT NULL,
	"caps" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"spent_minor" integer DEFAULT 0 NOT NULL,
	"reserved_minor" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"root_id" text NOT NULL,
	"label" text NOT NULL,
	"public_key" text NOT NULL,
	"private_jwk" jsonb NOT NULL,
	"chain" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emulator_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_jwk" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roots" (
	"id" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"principal_name" text NOT NULL,
	"title" text NOT NULL,
	"currency" text NOT NULL,
	"limit_minor" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"paypal_order_id" text,
	"authorization_id" text,
	"authorization_expires_at" timestamp with time zone,
	"captured_minor" integer DEFAULT 0 NOT NULL,
	"released_minor" integer,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roots_authorization_id_unique" UNIQUE("authorization_id")
);
--> statement-breakpoint
CREATE TABLE "spends" (
	"id" text PRIMARY KEY NOT NULL,
	"root_id" text NOT NULL,
	"leaf_id" text NOT NULL,
	"leaf_label" text NOT NULL,
	"chain_ids" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"signed" jsonb NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"payee" text NOT NULL,
	"purpose" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"agent_note" text,
	"status" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capture_id" text,
	"payout_batch_id" text,
	"payout_item_id" text,
	"payout_transaction_id" text,
	"payout_status" text,
	"refund_id" text,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "spends_request_hash_unique" UNIQUE("request_hash")
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_root_id_roots_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit_log" USING btree ("subject_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_seq" ON "audit_log" USING btree ("scope_id",coalesce("subject_id", '-'),"seq");--> statement-breakpoint
CREATE INDEX "blocks_root" ON "blocks" USING btree ("root_id","depth");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_keys_root_label" ON "demo_keys" USING btree ("root_id","label");--> statement-breakpoint
CREATE INDEX "roots_principal" ON "roots" USING btree ("principal","created_at");--> statement-breakpoint
CREATE INDEX "spends_root" ON "spends" USING btree ("root_id","created_at");