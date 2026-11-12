import { auditorModelTools, auditorOpening } from "@/lib/ai/auditor";
import { sanitizeTurns } from "@/lib/ai/mission";
import { allow, chat, modelConfig } from "@/lib/ai/model";
import { clientIp, json, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One turn of the auditor played by a real model. The server owns the instructions and the tool
 * list (PayPal's Agent Toolkit read tools, the gateway's books, and `propose`); the browser sends
 * back only what the model said and what the gateway answered. The model's tool calls are reads and
 * proposals: there is no tool here that moves money.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
  const cfg = modelConfig(req);
  if (!cfg) return json({ error: "No model is connected to this copy. The audit runs by its fixed procedure instead." }, 503);
  const ip = clientIp(req);
  if (!allow(`audit:${ip}`, 60, 600_000) || !allow("audit:all", 2000, 86_400_000)) return json({ error: "The model has been used a lot from here; try again in a few minutes." }, 429);
  let b: { messages?: unknown };
  try { b = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const turns = sanitizeTurns(b.messages ?? []);
  if (!turns) return json({ error: "Invalid request." }, 400);
  const { auditorTools } = await import("@/lib/gateway/auditor");
  const r = await chat(cfg, { messages: [...auditorOpening(), ...turns], tools: auditorModelTools(await auditorTools()), maxTokens: 600 });
  if (!r.ok) return json({ error: `The model could not answer (${r.status}): ${r.error}` }, 502);
  return json({ message: r.message, model: cfg.model, via: cfg.via });
}
