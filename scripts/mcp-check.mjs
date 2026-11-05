// Interop check: connect to Kept's MCP endpoint with the official MCP TypeScript SDK client.
// Usage: npm i --no-save @modelcontextprotocol/sdk@1 && BASE_URL=http://localhost:3000 node scripts/mcp-check.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const client = new Client({ name: "kept-interop-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "get_promise_record", arguments: { merchant: process.argv[2] ?? "adaeze-studio" } });
console.log(res.isError ? "ERROR" : res.content[0].text.split("\n")[0]);
await client.close();
