/**
 * The OIDC sign-in, callback and sign-out endpoint (Auth.js v5, `@auth/core`).
 *
 * All configuration — provider, adapter, session policy, issuer validation, cookie flags — lives in
 * lib/auth/config.ts, so the route is only a transport. No identity is read from a header, a query or a body:
 * Auth.js validates the authorization code, PKCE, state and nonce, and the session row is created server-side.
 */
import { Auth } from "@auth/core";
import { authConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => Auth(request, authConfig());
export const POST = (request: Request) => Auth(request, authConfig());
