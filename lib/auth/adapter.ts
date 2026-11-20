/**
 * The Auth.js (v5, `@auth/core`) adapter over the organization-identity tables.
 *
 * The identity that matters is the pair `(oidc_issuer, oidc_subject)`. `createUser` takes the issuer from the
 * provider's own ID-token claims, and refuses an issuer that is not the one this deployment configured: a
 * second issuer cannot create users here by presenting a token. The subject is the provider's `sub`, verified by
 * Auth.js (signature, nonce, state); it is never taken from a header, a query or a cookie.
 *
 * `getUserByEmail` deliberately returns null. This deployment never links two identities because their email
 * addresses match: email can be reassigned, and an account takeover by email is exactly what the brief forbids.
 * Linking an additional identity requires an authenticated session and proof of control of both, which is a
 * separate flow (not part of this milestone).
 */
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "@auth/core/adapters";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { authAccounts, sessions, users, type User } from "../db/schema";
import { newId } from "../ids";
import { configuredIssuer } from "./config";

/** Auth.js only tests `emailVerified` for null; the database records the fact as a boolean. */
const verifiedAt = (u: User): Date | null => (u.emailVerified ? u.createdAt : null);

const adapterUser = (u: User): AdapterUser => ({
  id: u.id,
  // Auth.js wants a string. An identity may legitimately have no email; the placeholder is never used for
  // identity and is not unique-keyed.
  email: u.email ?? `${u.id}@no-email.invalid`,
  emailVerified: verifiedAt(u),
  name: u.displayName || null,
  image: null,
});

export function identityAdapter(): Adapter {
  const db = getDb();

  return {
    async createUser(user: AdapterUser & { iss?: string; sub?: string; email_verified?: boolean }) {
      const configured = configuredIssuer();
      const issuer = (typeof user.iss === "string" && user.iss.trim()) || configured;
      if (!issuer) throw new Error("No OIDC issuer is configured; refusing to create a user with an unknown issuer.");
      if (configured && issuer !== configured) {
        throw new Error(`The identity provider's issuer (${issuer}) is not the issuer this deployment trusts (${configured}).`);
      }
      const subject = (typeof user.sub === "string" && user.sub.trim()) || user.id;
      if (!subject) throw new Error("The identity provider returned no subject; refusing to create a user.");
      const values = {
        id: newId("usr"), oidcIssuer: issuer, oidcSubject: subject,
        email: typeof user.email === "string" && user.email && !user.email.endsWith("@no-email.invalid") ? user.email.toLowerCase() : null,
        emailVerified: user.emailVerified !== null || user.email_verified === true,
        displayName: (user.name ?? "").slice(0, 120),
      };
      await db.insert(users).values(values).onConflictDoNothing();
      // A concurrent first sign-in may have inserted the same identity: return the row that exists.
      const row = await db.query.users.findFirst({ where: and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, subject)) });
      if (!row) throw new Error("The user could not be recorded.");
      return adapterUser(row);
    },

    async getUser(id: string) {
      const row = await db.query.users.findFirst({ where: eq(users.id, id) });
      return row ? adapterUser(row) : null;
    },

    /** Never used to merge identities. See the file comment. */
    async getUserByEmail() {
      return null;
    },

    async getUserByAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      const link = await db.query.authAccounts.findFirst({ where: and(eq(authAccounts.provider, provider), eq(authAccounts.providerAccountId, providerAccountId)) });
      if (!link) return null;
      const row = await db.query.users.findFirst({ where: eq(users.id, link.userId) });
      return row ? adapterUser(row) : null;
    },

    async linkAccount(account: AdapterAccount) {
      await db.insert(authAccounts).values({
        id: newId("oac"), userId: account.userId, type: account.type, provider: account.provider,
        providerAccountId: account.providerAccountId,
        refreshToken: account.refresh_token ?? null, accessToken: account.access_token ?? null,
        expiresAt: typeof account.expires_at === "number" ? account.expires_at : null,
        tokenType: account.token_type ?? null, scope: account.scope ?? null,
        idToken: account.id_token ?? null, sessionState: (account.session_state as string | undefined) ?? null,
      }).onConflictDoNothing();
      return account;
    },

    async createSession(session: { sessionToken: string; userId: string; expires: Date }) {
      const [row] = await db.insert(sessions).values(session).onConflictDoUpdate({ target: sessions.sessionToken, set: { userId: session.userId, expires: session.expires } }).returning();
      return { sessionToken: row!.sessionToken, userId: row!.userId, expires: row!.expires };
    },

    async getSessionAndUser(sessionToken: string): Promise<[AdapterSession, AdapterUser] | null> {
      const s = await db.query.sessions.findFirst({ where: eq(sessions.sessionToken, sessionToken) });
      if (!s) return null;
      const u = await db.query.users.findFirst({ where: eq(users.id, s.userId) });
      if (!u) return null;
      return [{ sessionToken: s.sessionToken, userId: s.userId, expires: s.expires }, adapterUser(u)];
    },

    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      const [row] = await db.update(users).set({
        ...(typeof user.email === "string" && user.email ? { email: user.email.toLowerCase() } : {}),
        ...(typeof user.name === "string" ? { displayName: user.name.slice(0, 120) } : {}),
        ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified !== null } : {}),
      }).where(eq(users.id, user.id)).returning();
      if (!row) throw new Error("No such user.");
      return adapterUser(row);
    },

    async deleteUser(userId: string) {
      // Sessions and account links first: they point at the user. Memberships are kept only if the caller
      // removed them; deleting an identity is a deliberate administrative act, not a sign-out.
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(authAccounts).where(eq(authAccounts.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    },

    async deleteSession(sessionToken: string) {
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },
  } as Adapter;
}
