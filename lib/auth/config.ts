/**
 * Human authentication: Auth.js v5 (`@auth/core`) with a generic OpenID Connect provider.
 *
 * Why this implementation (Stage Two of the brief):
 *
 *   • it is maintained, and it already implements authorization code + PKCE, state and nonce validation,
 *     issuer/subject checks, CSRF and origin handling, and server-side sessions;
 *   • it fits the existing Next.js 15 / React 19 stack without a framework migration (the handler is a plain
 *     `Request → Response` function under `app/api/auth/[...auth]`);
 *   • `@auth/nextjs` publishes no stable 0.41.x on npm, so the core package is used directly — the adapter and
 *     the route are all that wrapper would add;
 *   • the provider is generic OIDC (issuer + client id + secret), so the deployment is not tied to one vendor.
 *
 * Session policy: database sessions, 8 hours, renewed at most hourly, `HttpOnly`, `SameSite=Lax`, and `Secure`
 * whenever this is a production deployment. No token is ever written to `localStorage`, and no identity is read
 * from a request header.
 *
 * Production is fail-closed: `assertAuthConfigured()` refuses a production deployment without an issuer, a
 * client, a strong secret or with a development bypass enabled. `instrumentation.ts` calls it at startup.
 */
import type { AuthConfig } from "@auth/core";
import { identityAdapter } from "./adapter";

export const OIDC_PROVIDER_ID = "oidc";
/** A local OIDC provider a developer may run; only ever added outside production. */
export const TEST_PROVIDER_ID = "test-oidc";

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60;
/** Auth.js requires enough entropy; 32 characters is its documented floor for a secret. */
export const MIN_SECRET_LENGTH = 32;

export type AuthEnv = Partial<Record<
  "NODE_ENV" | "AUTH_SECRET" | "AUTH_OIDC_ISSUER" | "AUTH_OIDC_CLIENT_ID" | "AUTH_OIDC_CLIENT_SECRET" |
  "AUTH_TEST_OIDC_ISSUER" | "AUTH_TEST_OIDC_CLIENT_ID" | "AUTH_TEST_OIDC_CLIENT_SECRET" |
  "AUTH_DEV_BYPASS" | "ENVELOPE_DEV_AUTH" | "AUTH_TRUST_HOST" | "AUTH_URL" | "APP_BASE_URL" | "VERCEL",
  string
>>;

const clean = (v: string | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const configuredIssuer = (env: AuthEnv = process.env): string | null => clean(env.AUTH_OIDC_ISSUER);

/** Everything that must be present for a real sign-in to work. */
export function authConfigurationProblems(env: AuthEnv = process.env): string[] {
  const problems: string[] = [];
  if (!clean(env.AUTH_OIDC_ISSUER)) problems.push("AUTH_OIDC_ISSUER is not set (the identity provider's issuer URL).");
  if (!clean(env.AUTH_OIDC_CLIENT_ID)) problems.push("AUTH_OIDC_CLIENT_ID is not set.");
  if (!clean(env.AUTH_OIDC_CLIENT_SECRET)) problems.push("AUTH_OIDC_CLIENT_SECRET is not set.");
  const secret = clean(env.AUTH_SECRET);
  if (!secret) problems.push("AUTH_SECRET is not set.");
  else if (secret.length < MIN_SECRET_LENGTH) problems.push(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  if (env.AUTH_DEV_BYPASS === "1" || env.ENVELOPE_DEV_AUTH === "1") {
    problems.push("A development authentication bypass is enabled (AUTH_DEV_BYPASS / ENVELOPE_DEV_AUTH); it must never be on in production.");
  }
  if (env.NODE_ENV === "production" && !clean(env.AUTH_URL) && !clean(env.APP_BASE_URL) && !clean(env.VERCEL) && env.AUTH_TRUST_HOST !== "1") {
    problems.push("Set AUTH_URL (or APP_BASE_URL, or AUTH_TRUST_HOST=1 on a host that controls the Host header) so callbacks cannot be built from an attacker-supplied Host.");
  }
  return problems;
}

export function assertAuthConfigured(env: AuthEnv = process.env): void {
  const problems = authConfigurationProblems(env);
  if (problems.length) {
    throw new Error(`Authentication is not configured: ${problems.join(" ")}`);
  }
}

/** True when a real OIDC sign-in is configured (used by the sign-in page and by health). */
export const oidcConfigured = (env: AuthEnv = process.env): boolean =>
  Boolean(configuredIssuer(env) && clean(env.AUTH_OIDC_CLIENT_ID) && clean(env.AUTH_OIDC_CLIENT_SECRET) && clean(env.AUTH_SECRET));

function provider(a: { id: string; name: string; issuer: string; clientId: string; clientSecret: string }) {
  return {
    id: a.id,
    name: a.name,
    type: "oidc" as const,
    issuer: a.issuer,
    clientId: a.clientId,
    clientSecret: a.clientSecret,
    // The authorization-code flow with PKCE, state and nonce. All three are validated by @auth/core; the OIDC
    // `nonce` is what binds the ID token to this browser's request.
    checks: ["pkce", "state", "nonce"] as ("pkce" | "state" | "nonce" | "none")[],
    authorization: { params: { scope: "openid email profile" } },
    client: { token_endpoint_auth_method: "client_secret_basic" as const },
    // A stable subject is the provider's `sub`, never its email.
    profile(profile: Record<string, unknown>) {
      return {
        id: String(profile.sub ?? ""),
        name: typeof profile.name === "string" ? profile.name : typeof profile.preferred_username === "string" ? profile.preferred_username : "",
        email: typeof profile.email === "string" ? profile.email : null,
        image: null,
      };
    },
  };
}

/** The configured OIDC provider, or null when this deployment has none. */
export function oidcProvider(env: AuthEnv = process.env) {
  const issuer = configuredIssuer(env);
  const clientId = clean(env.AUTH_OIDC_CLIENT_ID);
  const clientSecret = clean(env.AUTH_OIDC_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) return null;
  return provider({ id: OIDC_PROVIDER_ID, name: "Organization identity", issuer, clientId, clientSecret });
}

/**
 * A provider for a local test identity provider (a real OIDC server run by the test harness or a developer).
 * Strictly non-production: in production this returns null even if the variables are set, so a test IdP cannot
 * become a production sign-in path.
 */
export function testIdentityProvider(env: AuthEnv = process.env) {
  if (env.NODE_ENV === "production") return null;
  const issuer = clean(env.AUTH_TEST_OIDC_ISSUER);
  const clientId = clean(env.AUTH_TEST_OIDC_CLIENT_ID);
  const clientSecret = clean(env.AUTH_TEST_OIDC_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) return null;
  return provider({ id: TEST_PROVIDER_ID, name: "Test identity (development only)", issuer, clientId, clientSecret });
}

/** The Auth.js configuration. Evaluated per request so a test can change the environment between cases. */
export function authConfig(env: AuthEnv = process.env): AuthConfig {
  const providers = [oidcProvider(env), testIdentityProvider(env)].filter((p): p is NonNullable<typeof p> => Boolean(p));
  const trustHost = env.AUTH_TRUST_HOST === "1" || Boolean(clean(env.VERCEL));
  return {
    providers,
    adapter: identityAdapter(),
    secret: clean(env.AUTH_SECRET) ?? undefined,
    // Server-side sessions: the browser holds an opaque token, and every protected operation validates the row.
    session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
    useSecureCookies: env.NODE_ENV === "production",
    trustHost,
    callbacks: {
      async signIn({ account, profile }) {
        // Only the configured issuer may sign anyone in. A token from another issuer is refused here, before a
        // user row can be created.
        const expected = configuredIssuer(env);
        if (!expected) return false;
        const iss = profile && typeof (profile as { iss?: unknown }).iss === "string" ? String((profile as { iss?: string }).iss) : null;
        if (iss && iss !== expected) return false;
        if (account && account.provider === TEST_PROVIDER_ID && env.NODE_ENV === "production") return false;
        return true;
      },
      async session({ session, user }) {
        // The server-side user id is what authorization uses; it is added to the session object Auth.js
        // returns, not to anything the browser can change.
        if (session.user) (session.user as { id?: string }).id = user.id;
        return session;
      },
      async redirect({ url, baseUrl }) {
        // Only this host. An open redirect on the callback is how a session token is handed to somebody else.
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        try { return new URL(url).origin === new URL(baseUrl).origin ? url : baseUrl; } catch { return baseUrl; }
      },
    },
  };
}
