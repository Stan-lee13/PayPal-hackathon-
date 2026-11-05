import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { chatSessions, products, sources, type ChatMessage, type Product } from "../db/schema";
import { newId } from "../ids";
import { aiConfigured } from "../ai/client";
import { replyScripted, replyWithClaude, type AssistantContext } from "../ai/assistant";
import { scrubPii } from "../security/redact";
import { quoteForCustomer } from "./pricing";
import { DEMO_MERCHANT } from "./merchant-data";
import { audit } from "./audit";

export async function getSession(id: string) {
  const db = getDb();
  return db.query.chatSessions.findFirst({ where: eq(chatSessions.id, id) });
}

export async function createSession() {
  const db = getDb();
  const id = newId("chat");
  await db.insert(chatSessions).values({ id, merchantId: DEMO_MERCHANT.id, messages: [] });
  return id;
}

export async function activeProducts(merchantId = DEMO_MERCHANT.id): Promise<Product[]> {
  return getDb().select().from(products).where(and(eq(products.merchantId, merchantId), eq(products.active, true))).orderBy(asc(products.sku));
}

/** Cart is set from the storefront; product ids/qty are validated against the DB. */
export async function setCart(sessionId: string, cart: Array<{ productId: string; qty: number }>, shipping: "STANDARD" | "EXPRESS") {
  const db = getDb();
  const s = await getSession(sessionId);
  if (!s) throw new Error("unknown session");
  if (s.orderId) throw new Error("This conversation already has an order. Start a new chat for a new order.");
  const ids = [...new Set(cart.map((c) => c.productId))];
  const found = ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : [];
  const clean = cart
    .filter((c) => found.some((p) => p.id === c.productId && p.inStock >= c.qty && p.active))
    .map((c) => ({ productId: c.productId, qty: Math.max(1, Math.min(10, Math.trunc(c.qty))) }));
  await db.update(chatSessions).set({ cart: clean, shippingOption: shipping, updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
  return clean;
}

export async function cartLines(sessionId: string) {
  const s = await getSession(sessionId);
  if (!s) throw new Error("unknown session");
  const prods = await activeProducts(s.merchantId);
  const lines = s.cart.map((c) => ({ product: prods.find((p) => p.id === c.productId)!, qty: c.qty })).filter((l) => l.product);
  return { session: s, lines };
}

export async function postCustomerMessage(sessionId: string, text: string): Promise<{ reply: ChatMessage; messages: ChatMessage[] }> {
  const db = getDb();
  const { session, lines } = await cartLines(sessionId);
  if (session.orderId) throw new Error("This conversation is attached to a placed order and is now read-only.");
  const clean = text.slice(0, 600);
  const prods = await activeProducts(session.merchantId);
  const merchantSources = await db.select().from(sources).where(and(eq(sources.merchantId, session.merchantId)));
  const quote = lines.length ? quoteForCustomer(lines, session.shippingOption) : null;
  const ctx: AssistantContext = {
    merchantName: DEMO_MERCHANT.name,
    products: prods,
    sources: merchantSources.filter((s) => s.orderId === null).map((s) => ({ title: s.title, text: s.text })),
    cart: lines,
    shipping: session.shippingOption,
    quote,
    history: session.messages,
    message: scrubPii(clean),
  };
  let replyText: string;
  let generatedBy: "ai" | "scripted" = "scripted";
  if (aiConfigured()) {
    try {
      replyText = await replyWithClaude(ctx);
      generatedBy = "ai";
    } catch (e) {
      replyText = replyScripted(ctx);
      await audit(db, { merchantId: session.merchantId, actor: "system", action: "assistant.ai_failed_fallback_scripted", ref: sessionId, outcome: "FAILED", detail: { error: String(e) } });
    }
  } else {
    replyText = replyScripted(ctx);
  }
  const now = new Date().toISOString();
  const customerMsg: ChatMessage = { role: "customer", text: clean, at: now };
  const reply: ChatMessage = { role: "assistant", text: replyText, at: new Date().toISOString(), generatedBy };
  const messages = [...session.messages, customerMsg, reply];
  await db.update(chatSessions).set({ messages, updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
  return { reply, messages };
}
