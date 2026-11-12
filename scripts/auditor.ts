/**
 * The auditor from a terminal: an agent on the operator's side that reads PayPal through PayPal's own
 * Agent Toolkit (cut down to its read tools), reads the gateway's books, and proposes. It cannot pay,
 * refund or sign.
 *
 *   npm run auditor                      the fixed procedure, against whatever PAYPAL_MODE says
 *   npm run auditor -- --model           a language model decides what to read (AI_BASE_URL + AI_API_KEY, or AI_GATEWAY_API_KEY)
 *   npm run auditor -- --evidence FILE   also write what happened to FILE
 *
 * Runs inside the gateway's process, where the PayPal credentials already are. An agent somewhere else
 * uses the same tools over HTTP (POST /api/auditor/read, with the operator's key) or over MCP
 * (ENVELOPE_ROLE=auditor npm run mcp).
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
const { paypalMode } = await import("../lib/paypal/client");
const A = await import("../lib/gateway/auditor");
const T = await import("../lib/paypal/toolkit");
const { liveAudit, scriptedAudit, auditorModelTools, auditorOpening } = await import("../lib/ai/auditor");
const { chat, modelConfig } = await import("../lib/ai/model");
const { flushJournal } = await import("../lib/paypal/journal");
const { closeDb } = await import("../lib/db");
type Step = import("../lib/ai/auditor").AuditStep;

const args = process.argv.slice(2);
const wantModel = args.includes("--model");
const out = args.includes("--evidence") ? args[args.indexOf("--evidence") + 1] : null;
const carried: Array<{ method: string; path: string; sent: boolean; status: number }> = [];
T.watchToolkit((r) => carried.push(r));
const steps: Step[] = [];
const io = {
  read: (tool: string, a: Record<string, unknown>) => A.auditorRead(tool, a),
  check: (kind: string, target: string) => A.checkProposal(kind, target),
  step: (s: Step) => {
    steps.push(s);
    if (s.kind === "read") console.log(`\n• ${s.source === "paypal-agent-toolkit" ? "PayPal Agent Toolkit" : s.source === "envelope" ? "Envelope gateway" : "refused"} · ${s.tool} ${Object.keys(s.args).length ? JSON.stringify(s.args) : ""}\n  ${s.answer.brief.replace(/\n/g, "\n  ")}`);
    else if (s.kind === "proposal") console.log(`\n→ proposes ${s.verdict.kind} ${s.verdict.target}: ${s.verdict.stands ? "STANDS" : "DOES NOT STAND"}. ${s.verdict.why}${s.verdict.signer ? ` It takes ${s.verdict.signer}.` : ""}`);
    else if (s.kind === "report") console.log(`\n== The auditor's report (${s.by === "model" ? "written by the model" : "fixed procedure"}) ==\n${s.text}`);
    else console.log(`\n${s.kind === "error" ? "!! " : ""}${s.text}`);
  },
};

console.log(`Auditing the gateway (PayPal: ${paypalMode()}). Tools: ${(await A.auditorTools()).map((t) => t.name).join(", ")}, propose.`);
const cfg = wantModel ? modelConfig(new Request("http://localhost/")) : null;
if (wantModel && !cfg) console.log("No model is configured (AI_BASE_URL + AI_API_KEY, or AI_GATEWAY_API_KEY); running the fixed procedure.");
if (cfg) {
  const tools = auditorModelTools(await A.auditorTools());
  await liveAudit({ ...io, turn: async (turns) => { const r = await chat(cfg, { messages: [...auditorOpening(), ...turns], tools, maxTokens: 600 }); return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }; } });
} else await scriptedAudit(io);

// What PayPal's toolkit does when it is asked to write, from this same process: stopped by name, and again at the wire.
const byName = await A.auditorRead("create_refund", { capture_id: "0AB12345CD678901E" });
const atWire = JSON.parse(await T.runUnguardedForTesting("create_refund", { capture_id: "0AB12345CD678901E" })) as { message?: string };
console.log(`\nAsked to refund a capture: by name → ${byName.refused ? "refused" : "NOT REFUSED"}; with the name check removed → ${atWire.message ?? JSON.stringify(atWire)}`);

if (out) {
  const brief = (s: Step) => (s.kind === "read" ? { read: s.tool, through: s.source, args: s.args, ok: s.answer.ok, brief: s.answer.brief } : s.kind === "proposal" ? { proposal: s.verdict.kind, target: s.verdict.target, stands: s.verdict.stands, why: s.verdict.why, signer: s.verdict.signer } : s);
  writeFileSync(out, JSON.stringify({
    what: "The auditor: PayPal's Agent Toolkit (@paypal/agent-toolkit 1.11.0) cut down to its read tools, run inside the gateway. The toolkit holds no credential; the gateway's PayPal client carries its requests and carries only GETs on listed paths.",
    ranAt: new Date().toISOString(), paypal: paypalMode(), by: cfg ? `model ${cfg.model}` : "fixed procedure",
    toolkitToolsInPackage: (await T.everyToolkitTool()).length, toolkitToolsTheAuditorHas: [...T.TOOLKIT_READS],
    steps: steps.map(brief),
    requestsTheToolkitBuilt: carried,
    writeAttempt: { tool: "create_refund", byName: byName.brief, withTheNameCheckRemoved: atWire.message ?? atWire, sentToPayPal: carried.some((c) => c.method !== "GET" && c.sent) },
  }, null, 2) + "\n");
  console.log(`\nWrote ${out}`);
}
await flushJournal(); await closeDb();
process.exit(0);
