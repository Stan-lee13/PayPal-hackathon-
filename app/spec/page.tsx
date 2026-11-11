import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ModeBanner } from "@/components/mode-banner";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Protocol" };

/** Minimal Markdown → blocks (headings, code fences, lists, tables as preformatted text, paragraphs). */
function blocks(md: string) {
  const out: Array<{ kind: "h1" | "h2" | "h3" | "code" | "li" | "p"; text: string }> = [];
  let code: string[] | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) { if (code) { out.push({ kind: "code", text: code.join("\n") }); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    if (line.startsWith("### ")) out.push({ kind: "h3", text: line.slice(4) });
    else if (line.startsWith("## ")) out.push({ kind: "h2", text: line.slice(3) });
    else if (line.startsWith("# ")) out.push({ kind: "h1", text: line.slice(2) });
    else if (/^\s*[-*] /.test(line) || /^\d+\. /.test(line)) out.push({ kind: "li", text: line.replace(/^\s*([-*]|\d+\.) /, "") });
    else if (line.startsWith("|")) { const last = out[out.length - 1]; if (last?.kind === "code" && last.text.startsWith("|")) last.text += "\n" + line; else out.push({ kind: "code", text: line }); }
    else if (line.trim()) { const last = out[out.length - 1]; if (last?.kind === "p") last.text += " " + line.trim(); else out.push({ kind: "p", text: line.trim() }); }
    else out.push({ kind: "p", text: "" });
  }
  return out.filter((b) => b.text !== "");
}
const inline = (s: string) => s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("`") ? <code key={i} className="kbd">{part.slice(1, -1)}</code> : part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);

export default function Spec() {
  const md = readFileSync(path.join(process.cwd(), "docs", "SPEC.md"), "utf8");
  return (
    <>
      <ModeBanner />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl space-y-3 px-4 pb-16">
        {blocks(md).map((b, i) =>
          b.kind === "h1" ? <h1 key={i} className="pt-2 text-3xl font-semibold">{b.text}</h1>
          : b.kind === "h2" ? <h2 key={i} className="pt-6 text-xl font-semibold">{b.text}</h2>
          : b.kind === "h3" ? <h3 key={i} className="pt-3 font-semibold">{b.text}</h3>
          : b.kind === "code" ? <pre key={i} className="code overflow-x-auto p-4 text-xs">{b.text}</pre>
          : b.kind === "li" ? <p key={i} className="pl-4 text-[15px] before:mr-2 before:content-['•']">{inline(b.text)}</p>
          : <p key={i} className="text-[15px] leading-relaxed">{inline(b.text)}</p>)}
      </main>
    </>
  );
}
