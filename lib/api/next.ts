/** Wraps a handler from lib/api/handlers.ts as a Next.js route: rate limit, same-origin check, JSON in and out. */
import { getDb } from "../db";
import { clientIp, json, sameOrigin } from "../http";
import { rateLimit } from "../security/rate-limit";
import { handlers, run } from "./handlers";

type Opts = { limit?: [name: string, max: number, windowSec: number]; global?: [name: string, max: number, windowSec: number]; sameOrigin?: boolean };

export function route(key: keyof typeof handlers & string, opts: Opts = {}) {
  const handler = handlers[key]!;
  const hasBody = key.startsWith("POST");
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (opts.sameOrigin && !sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
      if (opts.limit && !(await rateLimit(getDb(), `${opts.limit[0]}:${clientIp(req)}`, opts.limit[1], opts.limit[2]))) return json({ error: "Too many requests; try again later." }, 429);
      if (opts.global && !(await rateLimit(getDb(), `${opts.global[0]}:global`, opts.global[1], opts.global[2]))) return json({ error: "Too many requests; try again later." }, 429);
    } catch (e) {
      console.error("[envelope] database unavailable", e);
      return json({ error: "The gateway's database is not reachable." }, 503);
    }
    let body: unknown = undefined;
    if (hasBody) { try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400); } }
    const out = await run(handler, { params: (await ctx.params) ?? {}, body });
    return json(out.body, out.status);
  };
}
