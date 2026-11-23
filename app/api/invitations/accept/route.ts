/**
 * Accept an invitation. A route file rather than a shared handler because the caller has a session and, by
 * definition, no membership in the organization yet: `requestScope` answers 403 to exactly that person, so this
 * cannot go through the session-required wrapper. `requireAuthenticatedUser` is the check it needs instead.
 *
 *   POST {"token": "..."} — the signed-in person joins the organization the invitation names
 *
 * The GET of an invitation link never consumes anything: an email client that prefetches a link would otherwise
 * burn the invitation. Only this POST, which a person has to press, marks it used.
 */
import { sessionTokenFromRequest } from "@/lib/auth/context";
import { getDb } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { clientIp, json, sameOrigin } from "@/lib/http";
import { acceptOrganizationInvitation } from "@/lib/identity/members";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const token = (body as { token?: unknown } | null)?.token;
  try {
    // A link is guessable only by brute force, so attempts are limited per address: 20 is far more than a person
    // needs and far fewer than a search would take.
    if (!(await rateLimit(getDb(), `invitation-accept:${clientIp(req)}`, 20, 3600))) return json({ error: "Too many attempts; try again later." }, 429);
    const out = await acceptOrganizationInvitation({ sessionToken: sessionTokenFromRequest(req), token });
    return json(out);
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
    console.error("[envelope] invitation acceptance failed", e);
    return json({ error: "The gateway's database is not reachable." }, 503);
  }
}
