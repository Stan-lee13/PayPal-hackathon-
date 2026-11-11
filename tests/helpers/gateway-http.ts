/**
 * The gateway's handlers behind `fetch`, for tests: either called in-process, or served by a real
 * HTTP server on a free local port (for anything that runs as a separate process, like the MCP server).
 * Every request body is kept so a test can assert on what was actually sent.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Seen = { method: string; path: string; body: string };

/** A fetch that never touches the network: it runs the handler for the path and answers like the server would. */
export async function handlerFetch(seen: Seen[] = []) {
  const { match, run } = await import("../../lib/api/handlers");
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : "";
    seen.push({ method, path: url.pathname, body: raw });
    const m = match(method, url.pathname);
    if (!m) return new Response(JSON.stringify({ error: "No such endpoint." }), { status: 404, headers: { "content-type": "application/json" } });
    const out = await run(m.handler, { params: m.params, body: raw ? JSON.parse(raw) : undefined });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
  };
}

/** The same handlers on http://127.0.0.1:<free port>. */
export async function startHttpGateway(): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const { match, run } = await import("../../lib/api/handlers");
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const path = (req.url ?? "/").split("?")[0]!;
        seen.push({ method: req.method ?? "GET", path, body: raw });
        const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
        const m = match(req.method ?? "GET", path);
        if (!m) return send(404, { error: "No such endpoint." });
        let body: unknown = undefined;
        if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: "Send JSON." }); } }
        const out = await run(m.handler, { params: m.params, body });
        send(out.status, out.body);
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
