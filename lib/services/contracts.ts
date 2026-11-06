import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { clients, contracts, type Contract } from "../db/schema";
import { UserFacingError } from "../errors";
import { audit } from "./audit";

export async function contractByClientToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const rows = await getDb().select({ c: contracts, client: clients }).from(contracts).innerJoin(clients, eq(clients.id, contracts.clientId)).where(eq(contracts.clientToken, token)).limit(1);
  return rows[0] ?? null;
}

/** The client agrees, on their own page, that a PR merges once its invoice is paid in full. */
export async function acceptTerms(token: string, meta: { ip: string; userAgent: string }): Promise<Contract> {
  const found = await contractByClientToken(token);
  if (!found) throw new UserFacingError("This contract link isn't valid.", 404);
  const [c] = await getDb().update(contracts).set({ clientAcceptedAt: new Date() })
    .where(and(eq(contracts.id, found.c.id), isNull(contracts.clientAcceptedAt))).returning();
  if (!c) return found.c; // already accepted
  await audit(getDb(), {
    freelancerId: c.freelancerId, actor: "client", action: "contract.terms_accepted", ref: c.id, outcome: "OK",
    detail: { repo: c.repo, client: found.client.name, mergeOnPayment: c.mergeOnPayment, prices: c.issuePrices, ip: meta.ip.slice(0, 64), userAgent: meta.userAgent.slice(0, 200) },
  });
  return c;
}
