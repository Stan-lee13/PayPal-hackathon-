/**
 * DEMO merchant access: one shared passcode → HMAC-signed, HttpOnly, SameSite=Strict
 * cookie. This is NOT production authentication (no users, no MFA, no rotation).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE = "kept_merchant";
const TTL_MS = 12 * 3600_000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars).");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionValue(now = Date.now()): string {
  const payload = `merchant:mer_adaeze:${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(v: string | undefined, now = Date.now()): string | null {
  if (!v) return null;
  const i = v.lastIndexOf(".");
  if (i < 0) return null;
  const payload = v.slice(0, i);
  const sig = Buffer.from(v.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const [, merchantId, exp] = payload.split(":");
  if (!merchantId || !exp || Number(exp) < now) return null;
  return merchantId;
}

export function checkPasscode(input: string): boolean {
  const expected = process.env.MERCHANT_PASSCODE;
  if (!expected) return false;
  const a = createHmac("sha256", "kept").update(input).digest();
  const b = createHmac("sha256", "kept").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Merchant id for the current request, or null. */
export async function currentMerchant(): Promise<string | null> {
  const jar = await cookies();
  return verifySessionValue(jar.get(COOKIE)?.value);
}
