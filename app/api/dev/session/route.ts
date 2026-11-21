/**
 * Development sign-in for the browser console. A route file rather than a handler because it sets and clears a
 * cookie, which the shared JSON handler contract does not do.
 *
 *   GET     who this browser is signed in to (404 when this deployment has no development sign-in)
 *   POST    sign in: a real user, organization, membership and server-side session
 *   DELETE  sign out: the session row is deleted and the cookie cleared
 *
 * Refused in production and refused when the gateway runs in the browser: `devSessionAllowed` is the only gate,
 * and every answer below is the same 404 either way.
 */
import { and, asc, eq } from "drizzle-orm";
import { SESSION_COOKIE_NAMES, sessionTokenFromRequest } from "@/lib/auth/context";
import { closeDevelopmentSession, devSessionAllowed, openDevelopmentSession } from "@/lib/auth/dev-session";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/config";
import { getDb } from "@/lib/db";
import { memberships, organizations, sessions, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const COOKIE = SESSION_COOKIE_NAMES[0];
const unavailable = () => Response.json({ error: "Development sign-in is not available on this deployment." }, { status: 404 });

function cookie(value: string, maxAge: number): string {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function GET(req: Request) {
  if (!devSessionAllowed()) return unavailable();
  const db = getDb();
  const token = sessionTokenFromRequest(req);
  const session = token ? await db.query.sessions.findFirst({ where: eq(sessions.sessionToken, token) }) : null;
  if (!session || session.expires.getTime() <= Date.now()) return Response.json({ available: true, signedIn: false, org: null, user: null });
  const [org] = await db.select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.status, "ACTIVE")))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1);
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  return Response.json({ available: true, signedIn: Boolean(org), org: org ?? null, user: user ? { email: user.email } : null });
}

export async function POST() {
  if (!devSessionAllowed()) return unavailable();
  const s = await openDevelopmentSession();
  return Response.json(
    { signedIn: true, org: { id: s.orgId, name: s.orgName }, user: { email: s.email }, expires: s.expires.toISOString() },
    { headers: { "set-cookie": cookie(s.sessionToken, SESSION_MAX_AGE_SECONDS) } },
  );
}

export async function DELETE(req: Request) {
  if (!devSessionAllowed()) return unavailable();
  await closeDevelopmentSession(sessionTokenFromRequest(req));
  return Response.json({ signedIn: false }, { headers: { "set-cookie": cookie("", 0) } });
}
