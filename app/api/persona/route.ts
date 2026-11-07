import { z } from "zod";
import { errorResponse, json, sameOrigin } from "@/lib/http";
import { PERSONA_COOKIE, PERSONAS, personaCookieValue, type PersonaKey } from "@/lib/security/persona";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    const { persona } = z.object({ persona: z.enum(Object.keys(PERSONAS) as [PersonaKey, ...PersonaKey[]]) }).parse(await req.json());
    const res = json({ ok: true });
    res.cookies.set(PERSONA_COOKIE, personaCookieValue(persona), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 86400 });
    return res;
  } catch (e) { return errorResponse(e); }
}
