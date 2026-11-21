-- 0016 — row level security on every table that carries an organization.
--
-- Milestone 4.2 added `org_id`; 4.3 read through a transaction that carried it. This puts the policies behind
-- that filter, so a request that forgot the filter still cannot see another organization's rows.
--
-- RLS is enabled and deliberately **not forced**. Two roles are in play, and this is the split between them:
--
--   • the owner role, which the engine runs as: settlement, provider webhooks, the sweep, the operator tools and
--     the signed-agent paths. It serves every organization by design, so the policies do not apply to it.
--     (FORCE would apply them to the owner as well and stop the engine from working at all.)
--   • the request role (`ENVELOPE_TENANT_ROLE`), which `withTenant` switches to for the duration of one
--     transaction, with `set_config('role', ..., true)`. It owns nothing and holds SELECT on the tables below, so
--     a request-scoped read is confined to the organization that transaction named.
--
-- Both the policy and the query read the same value, set per transaction by `withTenant`:
--
--   select set_config('envelope.org_id', <the caller's organization>, true)
--
-- Unset is NULL, and NULL is not equal to anything, so a transaction that forgot to set it reads nothing. That is
-- the failure direction this system wants.
--
-- Grants are not created here: a migration cannot know a deployment's role names, and creating login roles from
-- an application migration is not something a managed Postgres will allow. Provision them once, by hand:
--
--   CREATE ROLE envelope_request NOLOGIN;
--   GRANT USAGE ON SCHEMA public TO envelope_request;   -- without it every read fails as "relation does not exist"
--   GRANT SELECT ON accounts, audit_log, blocks, cards, ledger, roots, spends, transfers TO envelope_request;
--   GRANT envelope_request TO <the role DATABASE_URL connects as>;
--
-- `npm run tenant:check` (and the production startup check) verifies that the role exists, owns nothing, cannot
-- bypass RLS, and that these policies are on, before the gateway serves traffic.

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "accounts_tenant_read" ON "accounts";--> statement-breakpoint
CREATE POLICY "accounts_tenant_read" ON "accounts" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "audit_log_tenant_read" ON "audit_log";--> statement-breakpoint
CREATE POLICY "audit_log_tenant_read" ON "audit_log" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "blocks_tenant_read" ON "blocks";--> statement-breakpoint
CREATE POLICY "blocks_tenant_read" ON "blocks" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "cards_tenant_read" ON "cards";--> statement-breakpoint
CREATE POLICY "cards_tenant_read" ON "cards" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "ledger_tenant_read" ON "ledger";--> statement-breakpoint
CREATE POLICY "ledger_tenant_read" ON "ledger" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "roots_tenant_read" ON "roots";--> statement-breakpoint
CREATE POLICY "roots_tenant_read" ON "roots" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "spends_tenant_read" ON "spends";--> statement-breakpoint
CREATE POLICY "spends_tenant_read" ON "spends" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "transfers_tenant_read" ON "transfers";--> statement-breakpoint
CREATE POLICY "transfers_tenant_read" ON "transfers" FOR SELECT USING ("org_id" IS NOT NULL AND "org_id" = current_setting('envelope.org_id', true));
