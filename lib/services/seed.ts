/**
 * Demo data: one freelancer (fictional), one client (fictional), one contract.
 *
 *  DEMO_REPO            repository the contract covers (default: the simulated lagosroast/storefront)
 *  DEMO_CLIENT_EMAIL    where the PayPal invoice goes (in sandbox: a sandbox *personal* account email)
 *  MERGEPAY_MCP_TOKEN   the editor's bearer token (only its SHA-256 is stored)
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { clients, companies, contracts, developers, freelancers } from "../db/schema";
import { DEMO_FREELANCER_ID } from "../security/session";
import { DEMO_REPO as SIM_REPO } from "../github/emulator";
import { githubMode } from "../github/client";
import { newReceiptToken } from "../ids";
import { resetSimMemory } from "../sim/store";

export const DEMO_CLIENT_ID = "cl_demo";
export const DEMO_CONTRACT_ID = "ct_demo";

export function demoRepo(): string {
  return process.env.DEMO_REPO || (githubMode() === "simulated" ? SIM_REPO : SIM_REPO);
}

export async function seedAll(db: DB) {
  await seedDemo(db);
  await seedBountyDemo(db);
}

export async function seedDemo(db: DB) {
  const token = process.env.MERGEPAY_MCP_TOKEN;
  const tokenHash = token ? createHash("sha256").update(token).digest("hex") : null;
  await db.insert(freelancers).values({ id: DEMO_FREELANCER_ID, name: "Tobi Adeyemi", email: "tobi@example.com", businessName: "Tobi Adeyemi · Web Development", mcpTokenHash: tokenHash })
    .onConflictDoUpdate({ target: freelancers.id, set: { mcpTokenHash: tokenHash } });
  await db.insert(clients).values({ id: DEMO_CLIENT_ID, freelancerId: DEMO_FREELANCER_ID, name: "Funmi Bello", company: "Lagos Roast Coffee", email: process.env.DEMO_CLIENT_EMAIL || "funmi@lagosroast.example" })
    .onConflictDoUpdate({ target: clients.id, set: { email: process.env.DEMO_CLIENT_EMAIL || "funmi@lagosroast.example" } });
  await db.insert(contracts).values({
    id: DEMO_CONTRACT_ID, freelancerId: DEMO_FREELANCER_ID, clientId: DEMO_CLIENT_ID, repo: demoRepo(), title: "Storefront: PayPal checkout and mobile fixes",
    currency: "USD", pricing: "FIXED_PER_ISSUE", issuePrices: { "12": 45000, "14": 8000 }, mergeOnPayment: true, mergeMethod: "squash", clientToken: newReceiptToken(),
  }).onConflictDoUpdate({ target: contracts.id, set: { repo: demoRepo() } });
}

export const DEMO_COMPANY_ID = "co_lagosroast";
export const DEMO_DEVELOPERS = { honest: "dev_chidi", cheat: "dev_quickfix" } as const;

/** Bounty side: one company, two developers (one honest, one who games CI). All fictional. */
export async function seedBountyDemo(db: DB) {
  await db.insert(companies).values({ id: DEMO_COMPANY_ID, name: "Lagos Roast Coffee", email: process.env.DEMO_COMPANY_EMAIL || "eng@lagosroast.example" }).onConflictDoNothing();
  const devToken = process.env.MERGEPAY_DEV_MCP_TOKEN;
  await db.insert(developers).values({ id: DEMO_DEVELOPERS.honest, name: "Chidi Okafor", githubLogin: "chidi-dev", paypalEmail: process.env.DEMO_DEVELOPER_PAYPAL_EMAIL || "chidi@example.com", country: "NG",
    mcpTokenHash: devToken ? createHash("sha256").update(devToken).digest("hex") : null })
    .onConflictDoUpdate({ target: developers.id, set: { paypalEmail: process.env.DEMO_DEVELOPER_PAYPAL_EMAIL || "chidi@example.com", mcpTokenHash: devToken ? createHash("sha256").update(devToken).digest("hex") : null } });
  await db.insert(developers).values({ id: DEMO_DEVELOPERS.cheat, name: "Quick Fix", githubLogin: "quickfix-dev", paypalEmail: "quickfix@example.com", country: "US" }).onConflictDoNothing();
}

/** Remove all invoices, events and audit entries; re-seed; the client has to accept the terms again. */
export async function resetDemo(db: DB) {
  await db.execute(sql`truncate table audit_log, paypal_events, invoices, rate_limits, nda_signatures, submissions, bounties restart identity cascade`);
  await db.execute(sql`delete from emulator_state`);
  resetSimMemory(); // the simulated repo and PayPal start over too
  await db.execute(sql`update contracts set client_accepted_at = null, issue_prices = '{"12": 45000, "14": 8000}'::jsonb`);
  await seedDemo(db);
  await seedBountyDemo(db);
}
