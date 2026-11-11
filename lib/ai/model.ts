/**
 * The one place the app talks to a language model. Server-side only.
 *
 * A model is used for exactly two things: drafting an envelope from plain words (a person reviews
 * and signs it) and playing the demo agents live. Nothing a model says is ever read by the gateway:
 * its tool calls become signed requests like any other agent's, and the gateway decides.
 *
 * Where the model comes from, in order:
 *   1. AI_BASE_URL + AI_API_KEY (+ AI_MODEL): any OpenAI-compatible endpoint.
 *   2. AI_GATEWAY_API_KEY, or on Vercel the deployment's own OIDC token: Vercel AI Gateway.
 *   3. Nothing configured: the app says so and offers the scripted agents instead.
 */
export type ModelConfig = { url: string; key: string; model: string; via: "custom" | "vercel-ai-gateway" };

export function modelConfig(req: Request): ModelConfig | null {
  const base = process.env.AI_BASE_URL?.replace(/\/$/, "");
  if (base && process.env.AI_API_KEY) return { url: `${base}/chat/completions`, key: process.env.AI_API_KEY, model: process.env.AI_MODEL || "gpt-4o-mini", via: "custom" };
  const key = process.env.AI_GATEWAY_API_KEY || req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;
  if (key) return { url: "https://ai-gateway.vercel.sh/v1/chat/completions", key, model: process.env.AI_MODEL || "anthropic/claude-haiku-5.5", via: "vercel-ai-gateway" };
  return null;
}

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatResult = { ok: true; message: { content: string | null; tool_calls?: ToolCall[] }; usage?: { prompt_tokens?: number; completion_tokens?: number } } | { ok: false; status: number; error: string };

export async function chat(cfg: ModelConfig, a: { messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number }): Promise<ChatResult> {
  try {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model, messages: a.messages, ...(a.tools?.length ? { tools: a.tools, tool_choice: "auto" } : {}), max_tokens: a.maxTokens ?? 500, temperature: 0.2 }),
      signal: AbortSignal.timeout(40_000),
    });
    const j = (await r.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } | string } | null;
    if (!r.ok || !j?.choices?.[0]?.message) {
      const msg = typeof j?.error === "string" ? j.error : j?.error?.message;
      return { ok: false, status: r.status, error: (msg ?? `the model endpoint answered ${r.status}`).slice(0, 300) };
    }
    const m = j.choices[0].message;
    return { ok: true, message: { content: m.content ?? null, tool_calls: m.tool_calls?.slice(0, 4) }, usage: j.usage };
  } catch (e) {
    return { ok: false, status: 504, error: e instanceof Error ? e.message.slice(0, 200) : "the model endpoint did not answer" };
  }
}

/** Small in-memory limiter so an open demo can't be used as a free model proxy. Per server instance. */
const hits = new Map<string, { n: number; at: number }>();
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > windowMs) { hits.set(key, { n: 1, at: now }); if (hits.size > 5000) hits.clear(); return true; }
  h.n += 1;
  return h.n <= max;
}
