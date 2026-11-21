/*
  Milestone 4.2 — organization columns on financial records.

  Every row that belongs to exactly one organization gains `org_id`. It is filled **only** from the explicit
  `principals` mapping (one public key to one organization, added in 4.1) or from its parent chain: a root from
  its sealing principal, a block or spend from its root, an account from its owner, and a balance, card or
  transfer from its account. No row is guessed into an organization, no organization is created or consolidated
  here, and no historical amount, hash, sequence number or signature is touched: a record whose owner cannot be
  established from that mapping stays NULL and is reported as unattributed by scripts/tenant-inventory.ts.

  Two things are deliberately left out, and they are the next phase's work
  (docs/MILESTONE_4_TENANT_PARTITIONING.md):

    • `org_id` is nullable. A legacy row may predate the mapping, and a guess is worse than an honest gap.
      `NOT NULL` is only safe once a deployment has zero unattributed rows, which is an operational decision.
    • RLS is not enabled. Reads are not organization-scoped yet, so a policy would break every read instead of
      protecting it. The columns and the transaction-local helper it needs are in place for that phase.

  The composite foreign keys are the integrity part that *is* enforced: a block or spend cannot be filed under
  an organization that is not its root envelope's, and a balance, card or transfer cannot be filed under an
  organization that is not its account's.
*/
ALTER TABLE "accounts" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "roots" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "spends" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "org_id" text;--> statement-breakpoint

-- The composite foreign keys below reference these unique indexes, so they are created first.
CREATE UNIQUE INDEX "accounts_org_id_agent" ON "accounts" USING btree ("org_id","agent");--> statement-breakpoint
CREATE UNIQUE INDEX "roots_org_id_id" ON "roots" USING btree ("org_id","id");--> statement-breakpoint

/*
  Attribution, from the parent chain only. Each statement is idempotent (`IS NULL`), so this block can be run
  again after a mapping is corrected (npm run tenant:backfill) without rewriting anything it already set.
*/

-- A sealed envelope belongs to the organization its sealing principal is explicitly mapped to.
UPDATE "roots" SET "org_id" = p."org_id" FROM "principals" p
  WHERE p."public_key" = "roots"."principal" AND p."status" = 'ACTIVE' AND "roots"."org_id" IS NULL;--> statement-breakpoint

-- Every block and payment under it belongs to the same organization as the envelope.
UPDATE "blocks" SET "org_id" = r."org_id" FROM "roots" r
  WHERE r."id" = "blocks"."root_id" AND r."org_id" IS NOT NULL AND "blocks"."org_id" IS NULL;--> statement-breakpoint
UPDATE "spends" SET "org_id" = r."org_id" FROM "roots" r
  WHERE r."id" = "spends"."root_id" AND r."org_id" IS NOT NULL AND "spends"."org_id" IS NULL;--> statement-breakpoint

-- An account belongs to the organization of the owner who co-signed it open.
UPDATE "accounts" SET "org_id" = p."org_id" FROM "principals" p
  WHERE p."public_key" = "accounts"."owner" AND p."status" = 'ACTIVE' AND "accounts"."org_id" IS NULL;--> statement-breakpoint

-- Balance movements, cards and transfers belong to the organization of the account that carries them.
UPDATE "ledger" SET "org_id" = a."org_id" FROM "accounts" a
  WHERE a."agent" = "ledger"."agent" AND a."org_id" IS NOT NULL AND "ledger"."org_id" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "org_id" = a."org_id" FROM "accounts" a
  WHERE a."agent" = "cards"."holder" AND a."org_id" IS NOT NULL AND "cards"."org_id" IS NULL;--> statement-breakpoint
UPDATE "transfers" SET "org_id" = a."org_id" FROM "accounts" a
  WHERE a."agent" = "transfers"."from_agent" AND a."org_id" IS NOT NULL AND "transfers"."org_id" IS NULL;--> statement-breakpoint

-- Audit entries take the organization of the envelope they are about, or of the principal whose chain they extend.
UPDATE "audit_log" SET "org_id" = r."org_id" FROM "roots" r
  WHERE r."id" = "audit_log"."subject_id" AND r."org_id" IS NOT NULL AND "audit_log"."org_id" IS NULL;--> statement-breakpoint
UPDATE "audit_log" SET "org_id" = p."org_id" FROM "principals" p
  WHERE p."public_key" = "audit_log"."scope_id" AND p."status" = 'ACTIVE' AND "audit_log"."org_id" IS NULL;--> statement-breakpoint

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_org_root_fk" FOREIGN KEY ("org_id","root_id") REFERENCES "public"."roots"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_org_holder_fk" FOREIGN KEY ("org_id","holder") REFERENCES "public"."accounts"("org_id","agent") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_org_account_fk" FOREIGN KEY ("org_id","agent") REFERENCES "public"."accounts"("org_id","agent") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roots" ADD CONSTRAINT "roots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spends" ADD CONSTRAINT "spends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spends" ADD CONSTRAINT "spends_org_root_fk" FOREIGN KEY ("org_id","root_id") REFERENCES "public"."roots"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_org_from_fk" FOREIGN KEY ("org_id","from_agent") REFERENCES "public"."accounts"("org_id","agent") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "accounts_org" ON "accounts" USING btree ("org_id","opened_at");--> statement-breakpoint
CREATE INDEX "audit_org" ON "audit_log" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "cards_org" ON "cards" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_org" ON "ledger" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "roots_org" ON "roots" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "spends_org" ON "spends" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "transfers_org" ON "transfers" USING btree ("org_id","created_at");
