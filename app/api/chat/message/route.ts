import { z } from "zod";
import { getDb } from "@/lib/db";
import { postCustomerMessage } from "@/lib/services/chat";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, errorResponse, json } from "@/lib/http";
import { UserFacingError } from "@/lib/services/orders";

const Body = z.object({ sessionId: z.string().regex(/^chat_[A-Za-z0-9_-]{16}$/), text: z.string().trim().min(1).max(600) });

export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const db = getDb();
    if (!(await rateLimit(db, `chat:ip:${clientIp(req)}`, 30, 300)) || !(await rateLimit(db, `chat:s:${b.sessionId}`, 20, 300))) {
      throw new UserFacingError("Too many messages — please wait a few minutes.", 429);
    }
    const { reply, messages } = await postCustomerMessage(b.sessionId, b.text);
    return json({ reply, messages });
  } catch (e) { return errorResponse(e); }
}
