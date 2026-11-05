import { z } from "zod";
import { setCart } from "@/lib/services/chat";
import { errorResponse, json } from "@/lib/http";

const Body = z.object({
  sessionId: z.string().regex(/^chat_[A-Za-z0-9_-]{16}$/),
  cart: z.array(z.object({ productId: z.string().max(40), qty: z.number().int().min(1).max(10) })).max(10),
  shipping: z.enum(["STANDARD", "EXPRESS"]),
});

export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    return json({ cart: await setCart(b.sessionId, b.cart, b.shipping) });
  } catch (e) { return errorResponse(e); }
}
