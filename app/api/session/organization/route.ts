/**
 * Which organization the rest of this session is served for.
 *
 *   GET   the organizations this person may choose between, and the one being served now
 *   POST  {"orgId": "..."} — serve this session for that organization from now on
 *
 * A route file rather than a shared handler because the answer depends on the session cookie rather than on a
 * body signature, and because the refusal has to happen before anything is read: `requireAuthenticatedUser` makes
 * a missing or revoked session a 401, and the membership row is the only thing that can authorize a choice.
 *
 * The organization id is validated against an active membership and then written to the session row. A cookie,
 * a header or a body field naming an organization is never authorization by itself — the same rule the read paths
 * follow — so a person can only move between organizations they already belong to.
 */
import { sessionTokenFromRequest, organizationsForSession, selectSessionOrganization } from "@/lib/auth/context";
import { UserFacingError } from "@/lib/errors";
import { json, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { current, memberships } = await organizationsForSession(sessionTokenFromRequest(req));
    return json({ current, memberships });
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    console.error("[envelope] organization list failed", e);
    return json({ error: "The gateway's database is not reachable." }, 503);
  }
}

export async function POST(req: Request) {
  // A cookie-bearing state change: a browser page of this site, or a client that carries no Origin at all.
  if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const orgId = (body as { orgId?: unknown } | null)?.orgId;
  if (typeof orgId !== "string" || orgId.trim() === "") return json({ error: "Name the organization to serve this session for." }, 400);
  try {
    const org = await selectSessionOrganization(sessionTokenFromRequest(req), orgId.trim());
    return json({ org });
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    console.error("[envelope] organization selection failed", e);
    return json({ error: "The gateway's database is not reachable." }, 503);
  }
}
