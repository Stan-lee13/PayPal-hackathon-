/** Wraps a handler from lib/api/handlers.ts as a Next.js route: rate limit, same-origin check, JSON in and out. */
import { getDb } from "../db";
import { clientIp, json, sameOrigin } from "../http";
import { rateLimit } from "../security/rate-limit";
import { handlers, run } from "./handlers";

const MAX_BODY_BYTES = 128 * 1024;
type Opts = { limit?: [name: string, max: number, windowSec: number]; global?: [name: string, max: number, windowSec: number]; sameOrigin?: boolean; /** Refuse callers that are not a browser page of this site (no Origin header). Not authentication: it keeps scripts off the shared demo buttons. */ browserOnly?: boolean };

export function route(key: keyof typeof handlers & string, opts: Opts = {}) {
  const handler = handlers[key]!;
  const hasBody = key.startsWith("POST");
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (opts.sameOrigin && !sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
      if (opts.browserOnly && !req.headers.get("origin")) return json({ error: "This demo button works from the site itself." }, 403);
      if (opts.limit && !(await rateLimit(getDb(), `${opts.limit[0]}:${clientIp(req)}`, opts.limit[1], opts.limit[2]))) return json({ error: "Too many requests; try again later." }, 429);
      if (opts.global && !(await rateLimit(getDb(), `${opts.global[0]}:global`, opts.global[1], opts.global[2]))) return json({ error: "Too many requests; try again later." }, 429);
    } catch (e) {
      console.error("[envelope] database unavailable", e);
      return json({ error: "The gateway's database is not reachable." }, 503);
    }
    let body: unknown = undefined;
    let raw: string | undefined;
    if (hasBody) {
      // A signed envelope with a full chain is a few kilobytes. Nothing legitimate is close to this.
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
      try { const text = await req.text(); if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413); raw = text; body = text ? JSON.parse(text) : {}; } catch { return json({ error: "Send JSON." }, 400); }
    }
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { if (k.startsWith("paypal-") || k === "authorization") headers[k] = v; });
    const out = await run(handler, { params: (await ctx.params) ?? {}, body, headers, raw });
    return json(out.body, out.status);
  };
}
