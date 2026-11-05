import { z } from "zod";
import { cartLines, createSession } from "@/lib/services/chat";
import { checkoutPricing } from "@/lib/services/pricing";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return json({ sessionId: await createSession() });
  } catch (e) { return errorResponse(e); }
}

export async function GET(req: Request) {
  try {
    const id = z.string().regex(/^chat_[A-Za-z0-9_-]{16}$/).parse(new URL(req.url).searchParams.get("id"));
    const { session, lines } = await cartLines(id);
    const checkout = lines.length ? checkoutPricing(lines, session.shippingOption) : null;
    return json({
      messages: session.messages,
      cart: session.cart,
      shipping: session.shippingOption,
      orderId: session.orderId,
      checkout: checkout && { itemTotalMinor: checkout.itemTotalMinor, shippingMinor: checkout.shippingMinor - checkout.promoMinor, totalMinor: checkout.totalMinor },
    });
  } catch (e) { return errorResponse(e); }
}
