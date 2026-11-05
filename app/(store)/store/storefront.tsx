"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";

type Product = { id: string; name: string; description: string; priceMinor: number; currency: string; swatch: string; imageAlt: string; inStock: number };
type Ship = "STANDARD" | "EXPRESS";
type Msg = { role: "customer" | "assistant" | "agent"; text: string; at: string; generatedBy?: "ai" | "scripted" };
type Verdict = { decision: "PROCEED" | "DECLINE"; checks: Array<{ check: string; ok: boolean; detail: string }>; summary: string; by: "ai" | "scripted"; record?: string } | null;
const DEFAULT_MANDATE = "Buy me the Ada wrap dress. Keep the total under $90 and it must ship within 2 days.";
type Guard = { mode?: "BLOCK" | "WARN" | "HONOR" | "OFF"; action: "NONE" | "WARN" | "HONOR"; quotedMinor: number | null; quote: string | null; checkoutMinor: number; gapMinor: number; honorDiscountMinor: number };
type Gate = { verdict: "READY_TO_CAPTURE" | "BLOCKED_MISMATCH" | "NEEDS_CONFIRMATION" | "PRECHECK_FAILED"; reasons: string[]; enforced: boolean; paypalOrderId: string; promisedMinor: number | null; promisedCurrency: string | null; orderMinor: number | null; orderCurrency: string | null; diffMinor: number | null; quote: string | null; checkedAt: string; explanation: string };
type OrderState = { keptOrderId: string; status: string; paypalOrderId: string | null; totalMinor: number; captured: boolean; corrected: boolean; preflight: Gate | null } | null;
type Checkout = { itemTotalMinor: number; shippingMinor: number; totalMinor: number; guard?: Guard } | null;

const usd = (m: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(m / 100);
const SESSION_KEY = "kept.store.session";

async function api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `Request failed (${res.status})`), { data });
  return data as T;
}

export function Storefront(props: {
  products: Product[];
  shipping: Record<Ship, { label: string; priceMinor: number; line: string }>;
  mode: "sandbox" | "live" | "simulated";
  paypalClientId: string;
  aiEnabled: boolean;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cart, setCartState] = useState<Record<string, number>>({});
  const [ship, setShip] = useState<Ship>("EXPRESS");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [checkout, setCheckout] = useState<Checkout>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [simApproval, setSimApproval] = useState<{ keptOrderId: string; paypalOrderId: string } | null>(null);
  const keptOrderRef = useRef<string | null>(null);
  const [mode, setMode] = useState<"customer" | "agent">("customer");
  const [mandate, setMandate] = useState(DEFAULT_MANDATE);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [orderState, setOrderState] = useState<OrderState>(null);
  const [verified, setVerified] = useState<Gate | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (id: string) => {
    const s = await api<{ messages: Msg[]; cart: Array<{ productId: string; qty: number }>; shipping: Ship; orderId: string | null; checkout: Checkout; mode: "customer" | "agent"; mandate: string | null; verdict: Verdict; order: OrderState }>(`/api/chat/session?id=${id}`, undefined, "GET");
    setOrderState(s.order);
    if (s.order) { keptOrderRef.current = s.order.keptOrderId; if (s.order.preflight && s.order.preflight.verdict !== "READY_TO_CAPTURE" && !s.order.captured) setGate(s.order.preflight); }
    setMessages(s.messages);
    if (s.mode === "agent") { setMode("agent"); if (s.mandate) setMandate(s.mandate); }
    setVerdict(s.verdict);
    setCartState(Object.fromEntries(s.cart.map((c) => [c.productId, c.qty])));
    setShip(s.shipping);
    setCheckout(s.checkout);
    return s;
  }, []);

  const newSession = useCallback(async () => {
    const { sessionId: id } = await api<{ sessionId: string }>("/api/chat/session");
    try { localStorage.setItem(SESSION_KEY, id); } catch { /* storage unavailable */ }
    setSessionId(id);
    setMessages([]); setCartState({}); setCheckout(null); setReceiptUrl(null); setVerdict(null); keptOrderRef.current = null;
    return id;
  }, []);

  useEffect(() => {
    (async () => {
      let id: string | null = null;
      try { id = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
      if (id) {
        try {
          const s = await refresh(id);
          if (s.orderId && (!s.order || s.order.captured)) { await newSession(); return; } // previous chat became a paid order
          setSessionId(id);
          return;
        } catch { /* stale */ }
      }
      await newSession();
    })().catch((e) => setError(String(e.message ?? e)));
  }, [newSession, refresh]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  async function saveCart(next: Record<string, number>, nextShip: Ship) {
    if (!sessionId) return;
    setCartState(next); setShip(nextShip);
    try {
      await api("/api/chat/cart", { sessionId, shipping: nextShip, cart: Object.entries(next).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty })) });
      await refresh(sessionId);
    } catch (e) { setError((e as Error).message); }
  }

  async function send(text: string) {
    if (!sessionId || !text.trim()) return;
    setBusy(true); setError(null);
    setMessages((m) => [...m, { role: "customer", text, at: new Date().toISOString() }]);
    setDraft("");
    try {
      const r = await api<{ messages: Msg[] }>("/api/chat/message", { sessionId, text });
      setMessages(r.messages);
      await refresh(sessionId); // re-run the pre-payment price check against what was just said
    } catch (e) { setError((e as Error).message); await refresh(sessionId).catch(() => {}); }
    finally { setBusy(false); }
  }

  async function sendAgent() {
    if (!sessionId) return;
    setBusy(true); setError(null); setVerdict(null); setMessages([]);
    try {
      const r = await api<{ messages: Msg[]; verdict: Verdict }>("/api/agent/run", { sessionId, mandate });
      setMessages(r.messages); setVerdict(r.verdict);
      await refresh(sessionId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function switchMode(next: "customer" | "agent") {
    if (next === mode) return;
    setMode(next);
    if (messages.length > 0 || lines.length > 0) await newSession();
  }

  async function createOrder(): Promise<string> {
    setError(null);
    const r = await api<{ id: string; keptOrderId: string }>("/api/orders", { sessionId });
    keptOrderRef.current = r.keptOrderId;
    return r.id;
  }

  async function capture(paypalOrderId: string) {
    const keptOrderId = keptOrderRef.current;
    if (!keptOrderId) throw new Error("Missing order reference");
    let r: { receiptUrl: string; preflight: Gate | null };
    try { r = await api<{ receiptUrl: string; preflight: Gate | null }>("/api/orders/capture", { keptOrderId, paypalOrderId }); }
    catch (e) {
      const pf = (e as { data?: { preflight?: Gate } }).data?.preflight;
      if (pf) { setGate(pf); if (sessionId) await refresh(sessionId); return; } // Kept's gate refused: nothing was charged
      throw e;
    }
    setGate(null); setVerified(r.preflight);
    setReceiptUrl(r.receiptUrl);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  // While Kept holds the checkout, watch for the merchant's correction or confirmation.
  useEffect(() => {
    if (!gate || !sessionId || gate.verdict === "READY_TO_CAPTURE") return;
    const t = setInterval(() => { void refresh(sessionId).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [gate, sessionId, refresh]);
  const correctedReady = Boolean(gate && orderState && !orderState.captured && orderState.status === "PAYPAL_CREATED" && orderState.paypalOrderId !== gate.paypalOrderId);
  const confirmedReady = Boolean(gate && gate.verdict === "NEEDS_CONFIRMATION" && orderState?.status === "NEEDS_CONFIRMATION");
  const held = Boolean(gate && !correctedReady);

  const lines = props.products.filter((p) => (cart[p.id] ?? 0) > 0);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3 py-6 rule-b">
        <div>
          <p className="eyebrow">Demonstration merchant</p>
          <h1 className="quote text-3xl sm:text-4xl">Adaeze Studio</h1>
          <p className="text-sm text-ink-soft">Hand-dyed adire from Abeokuta, shipped from Lagos.</p>
        </div>
        <Link href="/" className="text-sm underline">About Kept</Link>
      </header>

      {!receiptUrl && (
        <div role="tablist" aria-label="How to shop" className="mt-6 inline-flex rounded-lg border border-rule p-1">
          {(["customer", "agent"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => void switchMode(m)} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === m ? "bg-accent text-accent-ink" : "text-ink-soft"}`}>
              {m === "customer" ? "Shop myself" : "Send my AI agent"}
            </button>
          ))}
        </div>
      )}

      {receiptUrl ? (
        <section className="paper mt-8 p-6" aria-live="polite">
          <p className="eyebrow">Payment captured by PayPal</p>
          <h2 className="quote mt-2 text-2xl">Thank you — your order is in.</h2>
          {verified && verified.verdict === "READY_TO_CAPTURE" && verified.promisedMinor !== null && (
            <div className="mt-3 rounded border border-kept bg-kept-wash p-3 text-sm">
              <p className="eyebrow text-kept">Promise verified before capture · Kept</p>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4">
                <dt className="text-ink-soft">Agreed total</dt><dd className="money text-right">{usd(verified.promisedMinor)}</dd>
                <dt className="text-ink-soft">PayPal order</dt><dd className="money text-right">{verified.orderMinor !== null ? usd(verified.orderMinor) : "—"}</dd>
                <dt className="text-ink-soft">Currency</dt><dd className="text-right">{verified.orderCurrency}</dd>
              </dl>
            </div>
          )}
          <p className="mt-2 text-ink-soft">Kept is now checking every promise made in your chat against PayPal&rsquo;s records. Your living receipt updates as things change.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="btn btn-primary" href={receiptUrl}>Open my living receipt</Link>
            <button className="btn" onClick={() => newSession()}>Start a new order</button>
          </div>
        </section>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <section aria-labelledby="shop-h">
            <h2 id="shop-h" className="eyebrow">The collection</h2>
            <ul className="mt-3 divide-y divide-[var(--rule)] border-y border-rule">
              {props.products.map((p) => (
                <li key={p.id} className="flex gap-4 py-4">
                  <div role="img" aria-label={p.imageAlt} className="h-24 w-20 shrink-0 rounded" style={{ background: `repeating-linear-gradient(135deg, ${p.swatch} 0 10px, color-mix(in srgb, ${p.swatch} 75%, white) 10px 14px)` }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold">{p.name}</h3>
                      <span className="money">{usd(p.priceMinor)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{p.description}</p>
                    {p.inStock > 0 ? (
                      <div className="mt-2 flex items-center gap-2">
                        <label className="sr-only" htmlFor={`qty-${p.id}`}>Quantity of {p.name}</label>
                        <select id={`qty-${p.id}`} className="field w-20" value={cart[p.id] ?? 0} onChange={(e) => saveCart({ ...cart, [p.id]: Number(e.target.value) }, ship)} disabled={!sessionId}>
                          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className="text-sm text-ink-soft">{(cart[p.id] ?? 0) > 0 ? "in your bag" : "add to bag"}</span>
                      </div>
                    ) : <p className="mt-2 text-sm font-semibold text-ink-soft">Sold out</p>}
                  </div>
                </li>
              ))}
            </ul>

            <fieldset className="mt-6">
              <legend className="eyebrow">Shipping</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(["STANDARD", "EXPRESS"] as Ship[]).map((s) => (
                  <label key={s} className={`paper flex cursor-pointer gap-3 p-3 ${ship === s ? "outline outline-2 outline-[var(--accent)]" : ""}`}>
                    <input type="radio" name="ship" value={s} checked={ship === s} onChange={() => saveCart(cart, s)} className="mt-1" />
                    <span>
                      <span className="font-semibold">{props.shipping[s].label}</span> <span className="money">{usd(props.shipping[s].priceMinor)}</span>
                      <span className="block text-sm text-ink-soft">{props.shipping[s].line}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <section className="paper mt-6 p-4" aria-labelledby="bag-h">
              <h2 id="bag-h" className="eyebrow">Your bag · charged at checkout</h2>
              {lines.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Empty. Add a piece, then ask the assistant for your total.</p> : (
                <dl className="mt-2 space-y-1 text-sm">
                  {lines.map((p) => <div key={p.id} className="flex justify-between"><dt>{cart[p.id]} × {p.name}</dt><dd className="money">{usd(p.priceMinor * (cart[p.id] ?? 0))}</dd></div>)}
                  {checkout && <>
                    <div className="flex justify-between"><dt>{props.shipping[ship].label} shipping</dt><dd className="money">{usd(checkout.shippingMinor)}</dd></div>
                    {checkout.guard?.action === "HONOR" && <div className="flex justify-between text-kept"><dt>Price promised in this chat</dt><dd className="money">−{usd(checkout.guard.honorDiscountMinor)}</dd></div>}
                    <div className="flex justify-between rule-t pt-1 font-semibold"><dt>PayPal will be asked to charge</dt><dd className="money">{usd(checkout.totalMinor)}</dd></div>
                  </>}
                </dl>
              )}
              {!gate && checkout?.guard?.action === "WARN" && checkout.guard.quotedMinor !== null && (
                <div role="status" className="mt-3 rounded border border-risk bg-risk-wash p-3 text-sm">
                  <p className="eyebrow text-risk">Kept · price check before you pay</p>
                  <p className="mt-1">The assistant told you <span className="quote">&ldquo;{checkout.guard.quote}&rdquo;</span> but checkout is <span className="money font-semibold">{usd(checkout.guard.checkoutMinor)}</span>, which is <span className="money font-semibold">{usd(checkout.guard.gapMinor)}</span> more.</p>
                  <p className="mt-1 text-ink-soft">{checkout.guard.mode === "BLOCK"
                    ? "Kept checks the PayPal order against this promise before any money moves. If they still differ, the payment is not taken and Adaeze Studio is asked to correct it."
                    : "If you pay, Kept records the promise and checks it against what PayPal charges; Adaeze Studio is asked to make up the difference."}</p>
                </div>
              )}
              {checkout?.guard?.action === "HONOR" && (
                <p role="status" className="mt-3 text-xs text-kept">Kept checked this chat: Adaeze Studio honours the total its assistant promised (&ldquo;{checkout.guard.quote}&rdquo;) before you pay.</p>
              )}
              {gate && <GatePanel gate={gate} correctedReady={correctedReady} correctedTotal={orderState?.totalMinor ?? null} merchant="Adaeze Studio"
                onRetry={confirmedReady || gate.verdict === "PRECHECK_FAILED" ? async () => { try { setBusy(true); await capture(gate.paypalOrderId); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } } : null} busy={busy} />}
              {!held && lines.length > 0 && sessionId && (mode === "customer" || verdict?.decision === "PROCEED") && (
                <div className="mt-4">
                  {mode === "agent" && <p className="mb-2 text-xs text-ink-soft">Your agent cleared this purchase against your mandate. You still approve the payment yourself.</p>}
                  {props.mode === "simulated" ? (
                    <button className="btn btn-primary w-full" disabled={busy} onClick={async () => {
                      try { setBusy(true); const id = await createOrder(); setSimApproval({ keptOrderId: keptOrderRef.current!, paypalOrderId: id }); }
                      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
                    }}>Pay with simulated PayPal</button>
                  ) : props.paypalClientId ? (
                    <PayPalScriptProvider options={{ clientId: props.paypalClientId, currency: "USD", intent: "capture" }}>
                      <PayPalButtons style={{ layout: "vertical", label: "pay", height: 45 }}
                        createOrder={async () => createOrder()}
                        onApprove={async (data) => { try { await capture(data.orderID); } catch (e) { setError((e as Error).message); } }}
                        onError={(err) => setError(`PayPal error: ${String(err)}`)} />
                    </PayPalScriptProvider>
                  ) : <p className="text-sm text-broken">NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set.</p>}
                </div>
              )}
            </section>
          </section>

          <section aria-labelledby="chat-h" className="paper flex min-h-[28rem] flex-col">
            {mode === "agent" && (
              <div className="rule-b space-y-2 p-4">
                <h2 id="chat-h" className="font-semibold">Your agent&rsquo;s mandate</h2>
                <p className="text-xs text-ink-soft">Your own AI agent negotiates with Adaeze Studio&rsquo;s assistant. It can only proceed if every hard limit you set is met — checked by code, not by the model. Kept keeps your words and the merchant&rsquo;s words as evidence.</p>
                <label htmlFor="mandate" className="sr-only">Mandate</label>
                <textarea id="mandate" className="field min-h-20 quote text-base" value={mandate} maxLength={400} onChange={(e) => setMandate(e.target.value)} disabled={busy} />
                <button className="btn btn-primary w-full" disabled={busy || !sessionId || mandate.trim().length < 8} onClick={() => void sendAgent()}>{busy ? "Your agent is negotiating…" : "Send my agent"}</button>
              </div>
            )}
            <div className={`rule-b p-4 ${mode === "agent" ? "hidden" : ""}`}>
              <h2 id={mode === "agent" ? undefined : "chat-h"} className="font-semibold">Ask our assistant</h2>
              <p className="text-xs text-ink-soft">{props.aiEnabled ? "AI assistant (Claude). It may only use Adaeze Studio's published information." : "Scripted demo assistant (no AI key configured) — grounded in the same published information."} Kept saves this conversation as evidence when you pay.</p>
            </div>
            <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Conversation">
              {messages.length === 0 && <p className="text-sm text-ink-soft">Try: <em>&ldquo;What&rsquo;s my total with express shipping?&rdquo;</em></p>}
              {messages.map((m, i) => (
                <div key={i} className={m.role !== "assistant" ? "ml-8 text-right" : "mr-8"}>
                  <p className="text-[0.7rem] uppercase tracking-wider text-ink-soft">{m.role === "customer" ? "You" : m.role === "agent" ? `Your AI agent${m.generatedBy === "scripted" ? " (scripted)" : ""}` : `Adaeze Studio ${m.generatedBy === "scripted" ? "assistant (scripted)" : "assistant"}`}</p>
                  <p className={`mt-0.5 inline-block rounded-lg px-3 py-2 text-left ${m.role !== "assistant" ? "bg-accent text-accent-ink" : "quote border border-rule bg-paper text-[1.05rem]"}`}>{m.text}</p>
                </div>
              ))}
              {busy && <p className="text-sm text-ink-soft">Assistant is typing…</p>}
            </div>
            {mode === "agent" && verdict && (
              <div className={`rule-t p-4 text-sm ${verdict.decision === "PROCEED" ? "bg-kept-wash" : "bg-broken-wash"}`} aria-live="polite">
                <p className={`eyebrow ${verdict.decision === "PROCEED" ? "text-kept" : "text-broken"}`}>Mandate check (deterministic) · {verdict.decision === "PROCEED" ? "cleared" : "declined"}</p>
                <ul className="mt-1 space-y-0.5">{verdict.checks.map((c, i) => <li key={i}><span aria-hidden="true">{c.ok ? "✓" : "✕"}</span><span className="sr-only">{c.ok ? "passed" : "failed"}</span> {c.detail}</li>)}</ul>
                <p className="mt-2">{verdict.summary}</p>
                {verdict.record && <p className="mt-2 text-xs text-ink-soft"><span className="eyebrow">Merchant&rsquo;s promise record on Kept · </span>{verdict.record}</p>}
              </div>
            )}
            <form className={`rule-t flex gap-2 p-3 ${mode === "agent" ? "hidden" : ""}`} onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
              <label htmlFor="chat-in" className="sr-only">Message</label>
              <input id="chat-in" className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about price, shipping, returns…" maxLength={600} disabled={!sessionId || busy} />
              <button className="btn btn-primary" disabled={!sessionId || busy || !draft.trim()}>Send</button>
            </form>
            {lines.length > 0 && !lastAssistant && <p className="px-4 pb-3 text-xs text-ink-soft">Tip: ask for your total before paying — that&rsquo;s the promise Kept will hold the merchant to.</p>}
          </section>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded border border-broken bg-broken-wash p-3 text-sm text-broken">{error}</p>}

      {simApproval && (
        <div role="dialog" aria-modal="true" aria-labelledby="sim-h" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="paper w-full max-w-sm p-5">
            <p className="eyebrow text-risk">Simulated PayPal — not real PayPal</p>
            <h2 id="sim-h" className="mt-2 font-semibold">Approve payment</h2>
            <p className="mt-2 text-sm text-ink-soft">This stands in for the buyer approving in PayPal&rsquo;s window. PayPal order <span className="mono">{simApproval.paypalOrderId}</span> for <span className="money">{correctedReady && orderState ? usd(orderState.totalMinor) : checkout ? usd(checkout.totalMinor) : "—"}</span>.</p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={async () => {
                try { setBusy(true); await api("/api/sim/approve", { paypalOrderId: simApproval.paypalOrderId }); await capture(simApproval.paypalOrderId); setSimApproval(null); }
                catch (e) { setError((e as Error).message); setSimApproval(null); } finally { setBusy(false); }
              }}>Approve &amp; pay</button>
              <button className="btn" onClick={() => setSimApproval(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function GatePanel({ gate, correctedReady, correctedTotal, merchant, onRetry, busy }: { gate: Gate; correctedReady: boolean; correctedTotal: number | null; merchant: string; onRetry: (() => Promise<void>) | null; busy: boolean }) {
  const m = (v: number | null, c: string | null) => (v === null || !c ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(v / 100));
  if (correctedReady) return (
    <div role="status" className="mt-3 rounded border border-kept bg-kept-wash p-3 text-sm">
      <p className="eyebrow text-kept">Corrected order ready</p>
      <p className="mt-1">{merchant} corrected the order to the total you were promised: <span className="money font-semibold">{m(correctedTotal, gate.orderCurrency)}</span>. Approve it with PayPal below. The earlier order was never charged.</p>
    </div>
  );
  const blockedish = gate.verdict === "BLOCKED_MISMATCH";
  return (
    <div role="alert" className={`mt-3 rounded border p-3 text-sm ${blockedish ? "border-broken bg-broken-wash" : "border-risk bg-risk-wash"}`}>
      <p className={`eyebrow ${blockedish ? "text-broken" : "text-risk"}`}>{blockedish ? "Payment mismatch detected · Kept" : gate.verdict === "NEEDS_CONFIRMATION" ? "Waiting for the shop to confirm · Kept" : "Could not verify with PayPal · Kept"}</p>
      {gate.verdict !== "PRECHECK_FAILED" && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <dt className="text-ink-soft">You were promised</dt><dd className="money text-right">{m(gate.promisedMinor, gate.promisedCurrency)}</dd>
          <dt className="text-ink-soft">PayPal order amount</dt><dd className="money text-right">{m(gate.orderMinor, gate.orderCurrency)}</dd>
          {gate.diffMinor !== null && <><dt className="text-ink-soft">Difference</dt><dd className="money text-right font-semibold">{m(Math.abs(gate.diffMinor), gate.orderCurrency)}</dd></>}
          <dt className="text-ink-soft">Status</dt><dd className="text-right font-semibold">{blockedish ? "Capture blocked" : gate.verdict === "NEEDS_CONFIRMATION" ? "Capture on hold" : "Not captured"}</dd>
        </dl>
      )}
      <p className="mt-2">{gate.explanation} <strong>Nothing has been charged.</strong></p>
      {gate.quote && <p className="mt-1 text-xs text-ink-soft">What the assistant said: <span className="quote">&ldquo;{gate.quote}&rdquo;</span></p>}
      <p className="mt-1 text-xs text-ink-soft">PayPal order <span className="mono">{gate.paypalOrderId}</span> · checked {gate.checkedAt.slice(11, 19)} UTC</p>
      {blockedish && <p className="mt-2 text-xs">{merchant} has been asked to correct the order. This page updates when it is ready.</p>}
      {onRetry && <button className="btn mt-2" disabled={busy} onClick={() => void onRetry()}>{gate.verdict === "PRECHECK_FAILED" ? "Try again" : "Continue payment"}</button>}
    </div>
  );
}
