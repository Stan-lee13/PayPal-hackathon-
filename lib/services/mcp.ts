/**
 * Kept's MCP server (Model Context Protocol, Streamable HTTP transport, stateless JSON
 * responses). One read-only tool: get_promise_record. No authentication because it only
 * returns public aggregates; it can never move money or read customer data.
 */
import { promiseRecord, summarizeRecord } from "./promise-record";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "kept-promise-record", title: "Kept — merchant promise records", version: "1.0.0" };

export const MCP_TOOLS = [
  {
    name: "get_promise_record",
    title: "Get a merchant's promise record",
    description: "Before buying, check how often a PayPal merchant kept what it (or its AI sales assistant) promised — price as quoted, shipping on time, refunds on time — judged by deterministic code against PayPal's own records. Returns aggregate counts and rates, sample-size and simulation caveats, and whether every audit chain behind the record verified intact. Read-only.",
    inputSchema: { type: "object", properties: { merchant: { type: "string", description: "Merchant slug, e.g. 'adaeze-studio'.", pattern: "^[a-z0-9-]{2,64}$" } }, required: ["merchant"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Rpc["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message. Returns null for notifications (no response body). */
export async function handleMcp(msg: Rpc): Promise<RpcResponse | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return ok(msg.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: "Call get_promise_record with a merchant slug before committing to a purchase. Treat rates with small samples or SIMULATED data as indicative only." });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (name !== "get_promise_record") return fail(msg.id, -32602, `Unknown tool: ${String(name)}`);
      const slug = typeof args.merchant === "string" && /^[a-z0-9-]{2,64}$/.test(args.merchant) ? args.merchant : null;
      if (!slug) return ok(msg.id, { isError: true, content: [{ type: "text", text: "Argument 'merchant' must be a merchant slug such as 'adaeze-studio'." }] });
      const r = await promiseRecord(slug);
      if (!r) return ok(msg.id, { isError: true, content: [{ type: "text", text: `No merchant '${slug}' on Kept.` }] });
      return ok(msg.id, { content: [{ type: "text", text: `${summarizeRecord(r)}\n\n${JSON.stringify(r)}` }], structuredContent: r });
    }
    default:
      return isNotification ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
