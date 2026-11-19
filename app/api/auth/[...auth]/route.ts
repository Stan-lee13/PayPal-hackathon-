import { NextRequest, NextResponse } from "next/server";
import { Auth } from "@auth/core";

// ---------------------------------------------------------------------------
// Provider: a generic OIDC provider. The issuer publishes its own metadata, so we
// only need the issuer URL, client id and secret. Auth.js discovers the rest.
// ---------------------------------------------------------------------------
const oidcProvider = (issuer: string, clientId: string, clientSecret: string) => ({
  id: "oidc",
  name: "Organization identity",
  type: "oidc" as const,
  issuer,
  clientId,
  clientSecret,
  authorization: { params: { scope: "openid email profile" } },
  checks: ["pkce", "state"] as ("pkce" | "state" | "none" | "nonce")[],
});

// ---------------------------------------------------------------------------
// Adapter: persist users, accounts and sessions in the gateway's Postgres database.
// This is the bridge between Auth.js and the organization identity tables we create
// in migration 0013. Right now it is a typed stub to validate the integration shape;
// the real adapter is implemented alongside migration 0013.
// ---------------------------------------------------------------------------
const adapter = () => {
  // The real implementation will use lib/db once the users/accounts/sessions tables
  // exist. For now we return an object whose shape the Auth.ts type expects.
  return {
    createUser: async (user: { id: string; email: string; emailVerified: Date | null }) => user,
    getUser: async (_id: string) => null,
    getUserByEmail: async (_email: string) => null,
    getUserByAccount: async (_providerAccountId: { provider: string; providerAccountId: string }) => null,
    linkAccount: async (_account: { userId: string; type: string; providerAccountId: string; access_token?: string | null; id_token?: string | null; refresh_token?: string | null; expires_at?: number | null; scope?: string | null; token_type?: string | null; session_state?: string | null }) => undefined as void,
    createSession: async (session: { sessionToken: string; userId: string; expires: Date }) => session,
    getSessionAndUser: async (_sessionToken: string) => null,
    updateUser: async (user: { id: string }) => user as { id: string; email: string; emailVerified: Date | null },
    deleteUser: async (_userId: string) => undefined as void,
    deleteSession: async (_sessionToken: string) => {},
    getWeightedScore: async () => 0,
  } as const;
};

// ---------------------------------------------------------------------------
// The Auth.js handler. We only expose signin, callback and signout here; the
// actual route file dispatches on the auth action.
// ---------------------------------------------------------------------------
const auth = async (request: NextRequest) => {
  const issuer = process.env.AUTH_OIDC_ISSUER;
  const clientId = process.env.AUTH_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;

  const providers: ReturnType<typeof oidcProvider>[] = [];
  if (issuer && clientId && clientSecret) {
    providers.push(oidcProvider(issuer, clientId, clientSecret));
  }

  return Auth(request, {
    providers,
    adapter: await adapter(),
    secret: process.env.AUTH_SECRET,
    session: { strategy: "database" },
    pages: { signIn: "/auth/signin" },
    callbacks: {
      async redirect({ url, baseUrl }) {
        // Only allow redirects back to this host.
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        if (new URL(url).origin === baseUrl) return url;
        return baseUrl;
      },
      async session({ session }) {
        // Expose the stable OIDC subject and issuer on the session so downstream
        // code can build the (issuer, subject) tuple without re-validating the JWT.
        // The session object here is what Auth.js stores and returns to the client.
        return session;
      },
    },
    trustHost: true,
  });
};

export async function GET(request: NextRequest) {
  return auth(request);
}

export async function POST(request: NextRequest) {
  return auth(request);
}
