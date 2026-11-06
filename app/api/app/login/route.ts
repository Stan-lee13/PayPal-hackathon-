import { z } from "zod";
import { getDb } from "@/lib/db";
import { checkPasscode, COOKIE, makeSessionValue } from "@/lib/security/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (!(await rateLimit(getDb(), `login:${clientIp(req)}`, 10, 600))) return json({ error: "Too many attempts. Wait 10 minutes." }, 429);
    const { passcode } = z.object({ passcode: z.string().min(1).max(200) }).parse(await req.json());
    if (!checkPasscode(passcode)) return json({ error: "Wrong passcode." }, 401);
    const res = json({ ok: true });
    res.cookies.set(COOKIE, makeSessionValue(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
    return res;
  } catch (e) { return errorResponse(e); }
}
