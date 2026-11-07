import type { Metadata } from "next";
import Link from "next/link";
import { ModeBanner } from "@/components/mode-banner";
import { appBaseUrl } from "@/lib/base-url";
import { MCP_TOOLS } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect your editor" };

export default function Connect() {
  const url = `${appBaseUrl()}/api/mcp`;
  const cursor = JSON.stringify({ mcpServers: { mergepay: { url, headers: { Authorization: "Bearer YOUR_MERGEPAY_TOKEN" } } } }, null, 2);
  const claude = `claude mcp add --transport http mergepay ${url} \\\n  --header "Authorization: Bearer YOUR_MERGEPAY_TOKEN"`;
  return (
    <>
      <ModeBanner />
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">Merge<span className="text-accent">Pay</span></Link>
        <Link className="btn btn-sm" href="/demo">Try it in the browser instead</Link>
      </header>
      <main id="main" className="mx-auto max-w-4xl space-y-8 px-4 pb-16">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Connect your editor</h1>
          <p className="mt-1.5 max-w-2xl text-ink-soft">MergePay is a remote MCP server. Add it to any MCP client, then just ask: &ldquo;bill Lagos Roast for PR 18&rdquo;, &ldquo;has it been paid?&rdquo;. The token identifies you; the server stores only its hash.</p>
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold">Cursor <span className="font-normal text-ink-soft">· <span className="mono text-sm">~/.cursor/mcp.json</span></span></h2>
          <pre className="code overflow-x-auto p-4">{cursor}</pre>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Claude Code</h2>
          <pre className="code overflow-x-auto p-4">{claude}</pre>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Windsurf and others</h2>
          <p className="text-sm text-ink-soft">Any client that speaks MCP over Streamable HTTP: server URL <span className="kbd">{url}</span>, header <span className="kbd">Authorization: Bearer …</span>.</p>
        </section>

        <section>
          <h2 className="font-semibold">Tools</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {MCP_TOOLS.map((t) => (
              <li key={t.name} className="card p-4">
                <p className="mono text-sm font-semibold">{t.name}</p>
                <p className="mt-1 text-sm text-ink-soft">{t.description.split(". ").slice(0, 2).join(". ")}.</p>
                {t.annotations.readOnlyHint ? <span className="chip chip-DRAFT mt-2">read-only</span> : "confirm" in t.inputSchema.properties ? <span className="chip chip-SENT mt-2">needs your explicit yes</span> : null}
              </li>
            ))}
          </ul>
        </section>
        <p className="text-sm text-ink-soft">Judging this project? You don&rsquo;t need a token: the <Link className="link" href="/demo">browser demo</Link> runs these exact tools.</p>
      </main>
    </>
  );
}
