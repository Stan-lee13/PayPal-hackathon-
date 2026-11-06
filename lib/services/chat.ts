import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { chatSessions, products, sources, type ChatMessage, type Product } from "../db/schema";
import { newId } from "../ids";
import { aiConfigured, aiModel } from "../ai/client";
import { cachedAi } from "../ai/budget";
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

export async function postCustomerMessage(sessionId: string, text: string, role: "customer" | "agent" = "customer"): Promise<{ reply: ChatMessage; messages: ChatMessage[] }> {
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
      // A repeated demo conversation (same cart, same words) reuses the reply: no new cost.
      const key = { model: aiModel(), cart: ctx.cart.map((l) => [l.product.id, l.qty]), shipping: ctx.shipping, products: ctx.products.map((p) => [p.id, p.priceMinor, p.inStock]),
        sources: ctx.sources.map((s) => s.text), history: ctx.history.map((m) => [m.role, m.text]), message: ctx.message };
      replyText = (await cachedAi("assistant_reply", key, () => replyWithClaude(ctx))).value;
      generatedBy = "ai";
    } catch (e) {
      replyText = replyScripted(ctx);
      await audit(db, { merchantId: session.merchantId, actor: "system", action: "assistant.ai_failed_fallback_scripted", ref: sessionId, outcome: "FAILED", detail: { error: String(e) } });
    }
  } else {
    replyText = replyScripted(ctx);
  }
  const now = new Date().toISOString();
  const customerMsg: ChatMessage = { role, text: clean, at: now };
  const reply: ChatMessage = { role: "assistant", text: replyText, at: new Date().toISOString(), generatedBy };
  const messages = [...session.messages, customerMsg, reply];
  await db.update(chatSessions).set({ messages, updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
  return { reply, messages };
}

/**
 * Agent-to-agent mode: the shopper's agent negotiates with the merchant's assistant.
 * The decision to proceed is made by the deterministic guard, never by a model.
 */
export async function runBuyerAgent(sessionId: string, mandate: string) {
  const db = getDb();
  const s = await getSession(sessionId);
  if (!s) throw new Error("unknown session");
  if (s.orderId) throw new Error("This conversation already has an order.");
  const clean = mandate.replace(/[\r\n]+/g, " ").trim().slice(0, 400);
  const { readMandate, merchantTerms, guard, runClaudeAgent, runScriptedAgent } = await import("../ai/buyer-agent");
  const terms = readMandate(clean, DEMO_MERCHANT.currency);
  await db.update(chatSessions).set({ mode: "agent", mandate: clean, messages: [], cart: [], agentVerdict: null, updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
  const prods = await activeProducts(s.merchantId);
  const { promiseRecord } = await import("./promise-record");
  let record: Awaited<ReturnType<typeof promiseRecord>> = null;
  const io = {
    products: prods,
    getPromiseRecord: async () => (record ??= await promiseRecord(DEMO_MERCHANT.slug)),
    setCart: async (productId: string, qty: number, shipping: "STANDARD" | "EXPRESS") => { await setCart(sessionId, [{ productId, qty }], shipping); },
    askMerchant: async (message: string) => (await postCustomerMessage(sessionId, message, "agent")).reply.text,
  };
  let narrative: string;
  let by: "ai" | "scripted" = "scripted";
  if (aiConfigured()) {
    try { narrative = await runClaudeAgent(clean, io); by = "ai"; }
    catch (e) {
      await audit(db, { merchantId: s.merchantId, actor: "system", action: "buyer_agent.ai_failed_fallback_scripted", ref: sessionId, outcome: "FAILED", detail: { error: String(e).slice(0, 200) } });
      narrative = await runScriptedAgent(clean, terms, io);
    }
  } else {
    narrative = await runScriptedAgent(clean, terms, io);
  }
  const after = (await getSession(sessionId))!;
  const verdict = guard(terms, merchantTerms(after.messages, DEMO_MERCHANT.currency), DEMO_MERCHANT.currency, by, narrative, record ?? await io.getPromiseRecord());
  const closing: ChatMessage = { role: "agent", text: verdict.decision === "PROCEED" ? "Thank you — that meets my user's limits. My user will approve the payment in PayPal." : "Thank you — that does not meet my user's limits, so I won't proceed.", at: new Date().toISOString(), generatedBy: by };
  await db.update(chatSessions).set({ agentVerdict: verdict, messages: [...after.messages, closing], updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
  return { verdict, terms, messages: [...after.messages, closing] };
}
