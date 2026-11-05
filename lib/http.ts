import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UserFacingError } from "./services/orders";
import { currentMerchant } from "./security/session";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Map errors to safe responses: user-facing messages pass through, everything else is generic. */
export function errorResponse(e: unknown) {
  if (e instanceof UserFacingError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) return json({ error: "Invalid request", issues: e.issues.map((i) => i.path.join(".") + ": " + i.message) }, 400);
  console.error("[kept] unhandled", e);
  return json({ error: "Something went wrong. It has been logged." }, 500);
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, cron) carry no Origin; auth still applies
  try {
    return new URL(origin).host === new URL(req.url).host || origin === (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  } catch {
    return false;
  }
}

export async function requireMerchant(req: Request): Promise<string> {
  if (!sameOrigin(req)) throw new UserFacingError("Cross-origin request refused.", 403);
  const m = await currentMerchant();
  if (!m) throw new UserFacingError("Merchant sign-in required.", 401);
  return m;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
