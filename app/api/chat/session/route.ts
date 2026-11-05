import { z } from "zod";
import { cartLines, createSession } from "@/lib/services/chat";
import { planCheckout } from "@/lib/services/checkout-guard";
import { getDb } from "@/lib/db";
import { merchants, orders } from "@/lib/db/schema";
import { latestPreflight } from "@/lib/services/preflight";
import { preflightView } from "@/lib/services/orders";
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
    const order = session.orderId ? await getDb().query.orders.findFirst({ where: eq(orders.id, session.orderId) }) : null;
    const pf = order ? await latestPreflight(order.id) : null;
    return json({
      order: order && { keptOrderId: order.id, status: order.status, paypalOrderId: order.paypalOrderId, totalMinor: order.requestedTotalMinor, captured: Boolean(order.paypalCaptureId),
        corrected: order.supersededPaypalOrderIds.length > 0, preflight: pf ? preflightView(pf) : null },
      messages: session.messages,
      cart: session.cart,
      shipping: session.shippingOption,
      orderId: session.orderId,
      mode: session.mode,
      mandate: session.mandate,
      verdict: session.agentVerdict,
      checkout: checkout && g && {
        itemTotalMinor: checkout.itemTotalMinor, shippingMinor: checkout.shippingMinor - checkout.promoMinor, totalMinor: g.totalMinor,
        guard: { mode: g.mode, action: g.action, quotedMinor: g.quotedMinor, quote: g.quote, checkoutMinor: g.checkoutMinor, gapMinor: g.gapMinor, honorDiscountMinor: g.honorDiscountMinor },
      },
    });
  } catch (e) { return errorResponse(e); }
}
