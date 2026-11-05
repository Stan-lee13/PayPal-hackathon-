import { z } from "zod";
import { getDb } from "@/lib/db";
import { createOrderFromSession, UserFacingError } from "@/lib/services/orders";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";

const Body = z.object({ sessionId: z.string().regex(/^chat_[A-Za-z0-9_-]{16}$/) });

/** Called by the PayPal JS SDK's createOrder callback. Returns the PayPal order id. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    if (!(await rateLimit(getDb(), `order:ip:${clientIp(req)}`, 20, 600))) throw new UserFacingError("Too many checkout attempts.", 429);
    const r = await createOrderFromSession(b.sessionId);
    return json({ id: r.paypalOrderId, keptOrderId: r.keptOrderId });
  } catch (e) { return errorResponse(e); }
}
