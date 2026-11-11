/**
 * Use a local Claude Code login as the model behind Envelope's live agents.
 *
 * Envelope talks to any OpenAI-compatible chat endpoint (lib/ai/model.ts). This small server offers
 * one on localhost and answers each request by running the `claude` CLI once, headless, with no
 * tools of its own. It lets you watch a real model play the agents without an API key:
 *
 *   node scripts/claude-bridge.mjs                    # listens on http://localhost:8787
 *   AI_BASE_URL=http://localhost:8787/v1 AI_API_KEY=local AI_MODEL=haiku npm start
 *
 * Local use only: it has no authentication and binds to 127.0.0.1.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const CLAUDE = process.env.CLAUDE_BIN ?? "claude";
const cwd = mkdtempSync(join(tmpdir(), "envelope-bridge-")); // an empty directory: nothing for the CLI to read

function runClaude(system, prompt, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--model", model, "--output-format", "json", "--system-prompt", system, "--tools", "", "--strict-mcp-config", "--no-session-persistence"];
    const child = spawn(CLAUDE, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("the claude CLI did not answer in 60 seconds")); }, 60_000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`unreadable CLI output: ${out.slice(0, 200)}`)); }
    });
  });
}

/** Pull the {say, calls} object out of whatever the CLI returned. */
function extract(res) {
  if (res.structured_output && typeof res.structured_output === "object") return res.structured_output;
  const text = String(res.result ?? "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ } }
  return { say: text.trim(), calls: [] };
}

function toPrompt(messages, tools) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const lines = [];
  const names = new Map();
  for (const m of messages) {
    if (m.role === "user") lines.push(`MESSAGE TO YOU:\n${m.content}`);
    else if (m.role === "assistant") {
      if (m.content) lines.push(`YOU SAID: ${m.content}`);
      for (const t of m.tool_calls ?? []) { names.set(t.id, t.function.name); lines.push(`YOU REQUESTED: ${t.function.name}(${t.function.arguments})`); }
    } else if (m.role === "tool") lines.push(`RESULT OF ${names.get(m.tool_call_id) ?? "the tool"}: ${m.content}`);
  }
  const toolText = (tools ?? []).map((t) => `- ${t.function.name}: ${t.function.description}\n  arguments (JSON Schema): ${JSON.stringify(t.function.parameters)}`).join("\n");
  const protocol = `HOW YOU ACT IN THIS SESSION\nYou have no function-calling tools of your own here, and you cannot run commands, read files or browse. You act by REQUESTING one of the actions listed below: put it in the "calls" array of your JSON answer. The system then carries it out for you and sends you the result in the next message. Every action listed below is available this way; never say one is unavailable, and never try to invoke one any other way. Where your instructions mention a "tool" or a "tool call", they mean these actions, requested through "calls". Each answer is one step: request, then wait for the result.\n\nACTIONS YOU CAN REQUEST\n${toolText || "(none)"}\n\nAnswer with one JSON object and nothing else: {"say": "<one or two sentences>", "calls": [{"name": "<action name>", "arguments": {…}}]}. Request the actions you want carried out now (usually one). When you are finished, return an empty "calls" array and a closing sentence in "say".`;
  return { system: `${system}\n\n${protocol}`, prompt: `${lines.join("\n\n")}\n\nWhat do you do next? Answer with the JSON object only; request actions through "calls".` };
}

const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/v1/models")) return send(res, 200, { object: "list", data: [{ id: "haiku", object: "model" }, { id: "sonnet", object: "model" }] });
  if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) return send(res, 404, { error: { message: "Only POST /v1/chat/completions is served." } });
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 400_000) return send(res, 413, { error: { message: "Request too large." } }); }
  try {
    const body = JSON.parse(raw);
    const { system, prompt } = toPrompt(body.messages ?? [], body.tools);
    const started = Date.now();
    const allowed = new Set((body.tools ?? []).map((t) => t.function.name));
    let out = { say: "", calls: [] }, calls = [];
    // An answer with neither words nor a request is a misfire of the CLI, not a decision: ask again.
    let nudge = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await runClaude(system, prompt + nudge, String(body.model ?? "haiku"));
      out = extract(raw);
      calls = (Array.isArray(out.calls) ? out.calls : []).filter((c) => c && allowed.has(c.name)).slice(0, 4)
        .map((c, i) => ({ id: `call_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } }));
      // The CLI model sometimes reaches for a function-calling tool it does not have and reports the
      // action as unavailable. That is a misfire of this bridge, not a decision: remind it and ask again.
      const confused = !calls.length && /no such tool|not available|unavailable|isn't available|is not available/i.test(String(out.say ?? ""));
      if (confused) { nudge = '\n\nREMINDER: nothing is unavailable. To act, list the action in "calls" in your JSON answer; the system carries it out and reports back.'; continue; }
      if (calls.length || (typeof out.say === "string" && out.say.trim())) break;
      if (process.env.BRIDGE_DEBUG) console.log("empty answer, raw:", JSON.stringify(raw).slice(0, 600));
    }
    console.log(`${new Date().toISOString().slice(11, 19)} ${String(body.model ?? "haiku")} ${Date.now() - started}ms → ${calls.map((c) => c.function.name).join(", ") || "(no tool call)"}`);
    send(res, 200, { id: `chatcmpl_${Date.now()}`, object: "chat.completion", model: String(body.model ?? "haiku"), choices: [{ index: 0, finish_reason: calls.length ? "tool_calls" : "stop", message: { role: "assistant", content: typeof out.say === "string" && out.say ? out.say : null, ...(calls.length ? { tool_calls: calls } : {}) } }] });
  } catch (e) {
    console.error("bridge error:", e?.message ?? e);
    send(res, 502, { error: { message: String(e?.message ?? e).slice(0, 300) } });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Claude bridge listening on http://localhost:${PORT}/v1 (model via the "${CLAUDE}" CLI)`));
