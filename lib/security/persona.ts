/**
 * DEMO personas for the bounty marketplace: switch between the company and two developers.
 * HMAC-signed cookie; production would use real accounts (e.g. Log in with PayPal).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEMO_COMPANY_ID, DEMO_DEVELOPERS } from "../services/seed";

export const PERSONA_COOKIE = "mp_persona";
export const PERSONAS = {
  company: { kind: "company" as const, id: DEMO_COMPANY_ID, label: "Lagos Roast Coffee (company)" },
  chidi: { kind: "developer" as const, id: DEMO_DEVELOPERS.honest, label: "Chidi Okafor (developer)" },
  quickfix: { kind: "developer" as const, id: DEMO_DEVELOPERS.cheat, label: "Quick Fix (developer)" },
};
export type PersonaKey = keyof typeof PERSONAS;

const sign = (v: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "dev-only-secret-change-me-please-32ch").update(`persona|${v}`).digest("base64url");
export const personaCookieValue = (k: PersonaKey) => `${k}.${sign(k)}`;

export async function currentPersona(): Promise<(typeof PERSONAS)[PersonaKey] & { key: PersonaKey }> {
  const v = (await cookies()).get(PERSONA_COOKIE)?.value ?? "";
  const [k, s] = v.split(".");
  if (k && s && k in PERSONAS) {
    const a = Buffer.from(s), b = Buffer.from(sign(k));
    if (a.length === b.length && timingSafeEqual(a, b)) return { key: k as PersonaKey, ...PERSONAS[k as PersonaKey] };
  }
  return { key: "company", ...PERSONAS.company };
}
