/**
 * A development sign-in, for the local demo — never a production path.
 *
 * The addressed reads are being scoped to the caller's organization, and the browser console has had no way to
 * say who it is. A real deployment signs people in through OIDC (`lib/auth/config.ts`) and refuses to start
 * without it. A laptop running `npm run dev` has no identity provider, so this creates the rows an OIDC callback
 * would have created: a user keyed by (issuer, subject), one organization, an owner membership, and a
 * server-side session.
 *
 * What it is not:
 *
 *   • not available in production (`NODE_ENV=production`), and not available when the gateway runs in the
 *     browser (there is no server database to put a session in). Both answer 404, as if the route did not exist;
 *   • not a bypass of any check: everything downstream still reads the session row, the membership status and
 *     the organization from the database, exactly as it would for a real session;
 *   • not an attribution of any financial row. It creates one explicitly named "Development organization" and
 *     files only what is written while signed in under it. Nothing historical is moved or guessed at.
 *
 * The organization is shared by whoever runs the local demo: that is what a single-developer sandbox is. Two
 * organizations, and the isolation between them, are exercised by tests/tenant-reads.test.ts.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, organizations, sessions, users } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { SESSION_MAX_AGE_SECONDS } from "./config";

export const DEV_ISSUER = "urn:envelope:development";
export const DEV_ORG_NAME = "Development organization";
export const DEV_USER_EMAIL = "operator@localhost";

/** Development only, and only where there is a server database to hold the session. */
export function devSessionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && Boolean(env.DATABASE_URL);
}

export type DevSession = {
  orgId: string; orgName: string; userId: string; email: string; sessionToken: string; expires: Date;
};

export async function openDevelopmentSession(email: string = DEV_USER_EMAIL): Promise<DevSession> {
  if (!devSessionAllowed()) throw new UserFacingError("Development sign-in is not available on this deployment.", 404);
  const db = getDb();
  const address = email.trim().toLowerCase().slice(0, 200) || DEV_USER_EMAIL;
  const subject = `dev:${address}`;

  await db.insert(users).values({
    id: newId("usr"), oidcIssuer: DEV_ISSUER, oidcSubject: subject, email: address, emailVerified: true,
    displayName: "Development operator", lastLoginAt: new Date(),
  }).onConflictDoNothing();
  const user = await db.query.users.findFirst({ where: and(eq(users.oidcIssuer, DEV_ISSUER), eq(users.oidcSubject, subject)) });
  if (!user) throw new UserFacingError("The development identity could not be created.", 500);

  // Created on first use and named, never inferred from a financial record. Reused afterwards, so a restart does
  // not scatter the demo's data across organizations.
  const org = (await db.query.organizations.findFirst({ where: eq(organizations.name, DEV_ORG_NAME) }))
    ?? (await db.insert(organizations).values({ id: newId("org"), name: DEV_ORG_NAME }).returning())[0]!;

  await db.insert(memberships).values({
    id: newId("mem"), orgId: org.id, userId: user.id, role: "owner", status: "ACTIVE", invitedAt: new Date(), acceptedAt: new Date(),
  }).onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { status: "ACTIVE", role: "owner" } });

  const sessionToken = `${newId("dev")}-${newId("tok")}`;
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });
  return { orgId: org.id, orgName: org.name, userId: user.id, email: address, sessionToken, expires };
}

/** Sign out: the session row is deleted, so the cookie stops working even if it is presented again. */
export async function closeDevelopmentSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.sessionToken, token));
}
