import { allow, chat, modelConfig } from "@/lib/ai/model";
import { sanitizeContext, sanitizeTurns, stageOpening, STAGES, STAGE_TOOLS, type Stage } from "@/lib/ai/mission";
import { clientIp, json, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One turn of a demo agent played by a real model. The server owns the instructions and the tool
 * list; the browser sends back only what the model said and what the gateway answered. The reply is
 * a proposal: the browser turns each tool call into a signed request and the gateway decides.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
  const cfg = modelConfig(req);
  if (!cfg) return json({ error: "No model is connected to this copy. Use the scripted agents, or bring your own agent with the CLI or MCP server." }, 503);
  const ip = clientIp(req);
  if (!allow(`turn:${ip}`, 90, 600_000) || !allow("turn:all", 3000, 86_400_000)) return json({ error: "The model has been used a lot from here; try again in a few minutes." }, 429);
  let b: { stage?: string; ctx?: unknown; messages?: unknown };
  try { b = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const stage = STAGES.find((s) => s === b.stage) as Stage | undefined;
  const ctx = sanitizeContext(b.ctx);
  const turns = sanitizeTurns(b.messages ?? []);
  if (!stage || !ctx || !turns) return json({ error: "Invalid request." }, 400);
  const r = await chat(cfg, { messages: [...stageOpening(stage, ctx), ...turns], tools: STAGE_TOOLS[stage], maxTokens: 450 });
  if (!r.ok) return json({ error: `The model could not answer (${r.status}): ${r.error}` }, 502);
  return json({ message: r.message, model: cfg.model, via: cfg.via });
}
