import { allow, chat, modelConfig, type ChatMessage } from "@/lib/ai/model";
import { stageOpening, STAGES, STAGE_TOOLS, type MissionContext } from "@/lib/ai/mission";
import { clientIp, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAMPLE: MissionContext = { owner: "Ada", title: "Store launch budget", limitUsd: 200, perPaymentUsd: 80, payees: [{ payee: "acct:aqzv-spat-kyrk", who: "translator-agent, an agent owned by Bea" }, { payee: "designer@example.com", who: "" }], purposes: ["design", "translation"], brief: "Launch the store in French and Yoruba: get the store strings translated and a banner set designed. Spend as little as the quotes require." };

/**
 * Is a model connected to this copy? Never returns a key.
 *   ?probe=1        also sends the model one tiny request
 *   ?probe=mission  rehearses the three agent roles against canned gateway answers (no gateway, no money)
 */
export async function GET(req: Request) {
  const cfg = modelConfig(req);
  if (!cfg) return json({ available: false, reason: "No model is configured for this copy." });
  const probe = new URL(req.url).searchParams.get("probe");
  if (!probe) return json({ available: true, via: cfg.via, model: cfg.model });
  if (!allow(`probe:${clientIp(req)}`, 8, 600_000)) return json({ error: "Too many probes." }, 429);
  if (probe !== "mission") {
    const r = await chat(cfg, { messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 8 });
    return json(r.ok ? { available: true, via: cfg.via, model: cfg.model, reply: r.message.content } : { available: false, via: cfg.via, model: cfg.model, status: r.status, reason: r.error });
  }
  const canned: Record<string, string> = {
    look_at_my_envelope: "You hold an envelope: up to $60.00 in total, one payee, one purpose. $60.00 is left.",
    split_envelope: "SPLIT. The sub-agent now holds its own envelope.",
    set_aside: "SET ASIDE. The payee checked the gateway's note (signature valid, PayPal hold CREATED) and replied: \"Both files delivered. Please pay what you set aside.\"",
    pay_what_was_set_aside: "PAID. PayPal captured the amount from the hold and paid the payee.",
    pay: "(rehearsal: the gateway is not connected, so this was not sent)",
  };
  const transcript: unknown[] = [];
  for (const stage of STAGES) {
    const turns: ChatMessage[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await chat(cfg, { messages: [...stageOpening(stage, SAMPLE), ...turns], tools: STAGE_TOOLS[stage], maxTokens: 450 });
      if (!r.ok) return json({ available: false, via: cfg.via, model: cfg.model, status: r.status, reason: r.error, transcript });
      transcript.push({ stage, says: r.message.content, calls: r.message.tool_calls?.map((t) => `${t.function.name}(${t.function.arguments})`) ?? [] });
      if (!r.message.tool_calls?.length) break;
      turns.push({ role: "assistant", content: r.message.content, tool_calls: r.message.tool_calls });
      for (const t of r.message.tool_calls) turns.push({ role: "tool", tool_call_id: t.id, content: canned[t.function.name] ?? "Unknown tool." });
    }
  }
  return json({ available: true, via: cfg.via, model: cfg.model, rehearsal: true, transcript });
}
