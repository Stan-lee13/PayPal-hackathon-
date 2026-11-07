// Interop check: connect to MergePay's MCP endpoint with the official MCP TypeScript SDK client.
// Usage: npm i --no-save @modelcontextprotocol/sdk@1 && BASE_URL=http://localhost:3000 MERGEPAY_MCP_TOKEN=… node scripts/mcp-check.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const token = process.env.MERGEPAY_MCP_TOKEN;
if (!token) throw new Error("set MERGEPAY_MCP_TOKEN");

// 1. without a token: refused
const anon = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
console.log("no token →", anon.status);

// 2. with the token, through the official SDK
const client = new Client({ name: "mergepay-interop-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const contracts = await client.callTool({ name: "list_contracts", arguments: {} });
console.log("list_contracts:", contracts.content[0].text.split("\n")[0]);
const pr = Number(process.argv[2] ?? 18);
const draft = await client.callTool({ name: "draft_invoice", arguments: { repo: process.env.REPO ?? "lagosroast/storefront", pr } });
console.log(draft.isError ? `draft_invoice ERROR: ${draft.content[0].text}` : `draft_invoice: ${draft.structuredContent.amount}, ${draft.structuredContent.items.length} items, out of scope: ${draft.structuredContent.scope.outOfScope.map((o) => o.files.join(",")).join("; ") || "none"}`);
const refused = await client.callTool({ name: "send_invoice", arguments: { invoice_id: draft.structuredContent?.id ?? "inv_xxxxxxxxxxxx", confirm: false } });
console.log("send_invoice without confirm →", refused.isError ? "refused" : "SENT (unexpected!)");
await client.close();
