CREATE TABLE "position_attributions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_entry_id" bigint NOT NULL,
	"rail" text NOT NULL,
	"currency" text NOT NULL,
	"external_account_id" text NOT NULL,
	"source" text NOT NULL,
	"evidence" text NOT NULL,
	"attributed_by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "position_attributions" ADD CONSTRAINT "position_attributions_position_entry_id_position_entries_id_fk" FOREIGN KEY ("position_entry_id") REFERENCES "public"."position_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "position_attributions_once" ON "position_attributions" USING btree ("position_entry_id");