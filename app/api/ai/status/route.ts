import { allow, chat, modelConfig } from "@/lib/ai/model";
import { clientIp, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Is a model connected to this copy? `?probe=1` also sends it one tiny request. Never returns a key. */
export async function GET(req: Request) {
  const cfg = modelConfig(req);
  if (!cfg) return json({ available: false, reason: "No model is configured for this copy." });
  if (new URL(req.url).searchParams.get("probe") !== "1") return json({ available: true, via: cfg.via, model: cfg.model });
  if (!allow(`probe:${clientIp(req)}`, 6, 600_000)) return json({ error: "Too many probes." }, 429);
  const r = await chat(cfg, { messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 8 });
  return json(r.ok ? { available: true, via: cfg.via, model: cfg.model, reply: r.message.content } : { available: false, via: cfg.via, model: cfg.model, status: r.status, reason: r.error });
}
