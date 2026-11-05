import { z } from "zod";
import { cartLines, createSession } from "@/lib/services/chat";
import { planCheckout } from "@/lib/services/checkout-guard";
import { getDb } from "@/lib/db";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
    const merchant = (await getDb().query.merchants.findFirst({ where: eq(merchants.id, session.merchantId) }))!;
    const plan = lines.length ? planCheckout(session.messages, lines, session.shippingOption, merchant.policy, merchant.currency) : null;
    const checkout = plan?.price ?? null;
    const g = plan?.guard;
    return json({
      messages: session.messages,
      cart: session.cart,
      shipping: session.shippingOption,
      orderId: session.orderId,
      mode: session.mode,
      mandate: session.mandate,
      verdict: session.agentVerdict,
      checkout: checkout && g && {
        itemTotalMinor: checkout.itemTotalMinor, shippingMinor: checkout.shippingMinor - checkout.promoMinor, totalMinor: g.totalMinor,
        guard: { action: g.action, quotedMinor: g.quotedMinor, quote: g.quote, checkoutMinor: g.checkoutMinor, gapMinor: g.gapMinor, honorDiscountMinor: g.honorDiscountMinor },
      },
    });
  } catch (e) { return errorResponse(e); }
}
