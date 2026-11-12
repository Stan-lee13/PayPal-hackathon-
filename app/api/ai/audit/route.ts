import { auditorModelTools, auditorOpening } from "@/lib/ai/auditor";
import { sanitizeTurns } from "@/lib/ai/mission";
import { allow, chat, modelConfig, type ChatMessage } from "@/lib/ai/model";
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

/**
 * A rehearsal: ?probe=1 lets the connected model run the auditor's loop over the real tool list, against
 * canned answers written here (no gateway is asked, nothing can happen). It shows that the model accepts
 * PayPal's tool definitions and what it does with them. The canned case: clean books and one dispute
 * PayPal is waiting on.
 */
const CANNED: Record<string, string> = {
  envelope_books: "3 agent accounts hold $45.00 in total. holds: Every balance equals the sum of its ledger entries. holds: Balances equal money captured from PayPal holds into accounts, minus money paid out or refunded. PayPal reports $45.00 available; the gateway owed $45.00 at that moment: covered, with $0.00 over.",
  envelope_statement: "4 records of the gateway looked up on PayPal's statement (4 lines): 4 listed with the same amount, 0 where the amount differs, 0 not listed yet. Listed records: $112.00 captured in, $67.00 paid out, $0.00 refunded, $0.00 in PayPal fees, leaving $45.00 at PayPal.",
  list_transactions: "PayPal lists 4 transactions; money in less money out is $45.00, and PayPal charged $0.00 in fees. 7XK12345AB678901C T0006 $45.00 status S ref sp_rehearsal0000001 | 8YL22345AB678902D T0006 $67.00 status S ref sp_rehearsal0000002 | 9ZM32345AB678903E T0001 -$67.00 status S ref sp_rehearsal0000002",
  envelope_unsettled: "Nothing is unsettled: every payment and transfer the gateway recorded is final, and none is on record as disputed.",
  list_disputes: "PayPal lists 1 dispute. PP-D-REHEARSAL1 status WAITING_FOR_SELLER_RESPONSE reason UNAUTHORISED amount $67.00",
  get_dispute: "Dispute PP-D-REHEARSAL1: status WAITING_FOR_SELLER_RESPONSE, reason UNAUTHORISED, stage INQUIRY, amount $67.00, about PayPal transaction 8YL22345AB678902D.",
  envelope_payment: "Payment sp_rehearsal0000002 from envelope env_rehearsal000001 (ACTIVE): creative-agent paid designer@example.com $67.00 for «design». Status PAID, payout SUCCESS, PayPal capture 8YL22345AB678902D. The paying agent's memo, quoted as data: «Launch banner set».",
  get_order: "FAILED. PayPal has no order under that id.",
  get_refund: "FAILED. PayPal has no refund under that id.",
  propose: "STANDS. PayPal is waiting for an answer to dispute PP-D-REHEARSAL1 on payment sp_rehearsal0000002. It takes the gateway's sweep; you cannot do it.",
};
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("probe") !== "1") return json({ error: "Add ?probe=1 for a rehearsal against canned answers." }, 400);
  const cfg = modelConfig(req);
  if (!cfg) return json({ available: false, reason: "No model is configured for this copy." });
  if (!allow(`audit-probe:${clientIp(req)}`, 6, 600_000) || !allow("audit-probe:all", 200, 86_400_000)) return json({ error: "Too many rehearsals." }, 429);
  const { auditorTools } = await import("@/lib/gateway/auditor");
  const tools = auditorModelTools(await auditorTools());
  const messages: ChatMessage[] = auditorOpening();
  const calls: Array<{ tool: string; args: string }> = [];
  for (let i = 0; i < 9; i++) {
    const r = await chat(cfg, { messages, tools, maxTokens: 600 });
    if (!r.ok) return json({ available: true, rehearsal: "canned answers; no gateway asked", model: cfg.model, via: cfg.via, failedAtTurn: i + 1, status: r.status, reason: r.error, calls });
    if (!r.message.tool_calls?.length) return json({ available: true, rehearsal: "canned answers; no gateway asked", model: cfg.model, via: cfg.via, turns: i + 1, calls, report: r.message.content });
    messages.push({ role: "assistant", content: r.message.content, tool_calls: r.message.tool_calls });
    for (const t of r.message.tool_calls) {
      calls.push({ tool: t.function.name, args: t.function.arguments.slice(0, 200) });
      messages.push({ role: "tool", tool_call_id: t.id, content: CANNED[t.function.name] ?? `REFUSED. "${t.function.name}" is not a tool the auditor has.` });
    }
  }
  return json({ available: true, rehearsal: "canned answers; no gateway asked", model: cfg.model, via: cfg.via, turns: 9, calls, report: null, note: "The model did not finish its report in nine turns." });
}
