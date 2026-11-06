import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeBanner } from "@/components/mode-banner";
import { AutoRefresh } from "@/components/auto-refresh";
import { githubMode } from "@/lib/github/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulated pull request", robots: { index: false } };

export default async function SimPr({ params }: { params: Promise<{ owner: string; repo: string; n: string }> }) {
  const { owner, repo, n } = await params;
  if (githubMode() !== "simulated") notFound();
  const { simPullSnapshot } = await import("@/lib/github/emulator");
  const { withSimState } = await import("@/lib/sim/store");
  const pr = await withSimState(() => simPullSnapshot(`${owner}/${repo}`, Number(n)));
  if (!pr) notFound();
  const adds = pr.files.reduce((s, f) => s + f.additions, 0);
  const dels = pr.files.reduce((s, f) => s + f.deletions, 0);
  return (
    <>
      <ModeBanner />
      <AutoRefresh seconds={4} />
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-ink-soft"><span className="mono">{owner}/{repo}</span> · simulated repository</p>
        <h1 className="mt-1 text-2xl font-semibold">{pr.title} <span className="font-normal text-ink-soft">#{pr.number}</span></h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={`chip ${pr.merged ? "chip-MERGED" : pr.state === "open" ? "chip-SENT" : "chip-DRAFT"}`}>{pr.merged ? "Merged" : pr.state === "open" ? "Open" : "Closed"}</span>
          <span className="text-ink-soft">{pr.author} wants to merge {pr.commits.length} commits into <span className="mono">{pr.baseRef}</span> from <span className="mono">{pr.headRef}</span></span>
        </p>
        <pre className="card mt-5 whitespace-pre-wrap p-4 font-sans text-sm">{pr.body}</pre>

        <h2 className="mt-8 font-semibold">Commits</h2>
        <ul className="card mt-2 divide-y divide-rule text-sm">
          {pr.commits.map((c) => <li key={c.sha} className="flex justify-between gap-3 px-4 py-2"><span>{c.message.split("\n")[0]}</span><span className={`mono shrink-0 ${c.sha === pr.headSha ? "font-semibold" : "text-ink-soft"}`}>{c.sha.slice(0, 7)}</span></li>)}
        </ul>

        <h2 className="mt-8 font-semibold">Files changed <span className="font-normal text-ink-soft">(+{adds} −{dels})</span></h2>
        <ul className="card mt-2 divide-y divide-rule text-sm">
          {pr.files.map((f) => <li key={f.filename} className="flex justify-between gap-3 px-4 py-2"><span className="mono">{f.filename}</span><span className="mono text-ink-soft"><span className="text-paid">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span></span></li>)}
        </ul>

        <h2 className="mt-8 font-semibold">Conversation</h2>
        {pr.comments.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No comments yet.</p> : (
          <ol className="mt-2 space-y-3">
            {pr.comments.map((c) => (
              <li key={c.id} className="card p-4 text-sm">
                <p className="text-xs text-ink-soft"><strong className="text-ink">mergepay[bot]</strong> · {new Date(c.at).toUTCString()}</p>
                <p className="mt-1.5 whitespace-pre-wrap">{c.body.replace(/\*\*/g, "").replace(/`/g, "").replace(/<sub>|<\/sub>/g, "")}</p>
              </li>
            ))}
          </ol>
        )}
        {pr.merged && <p className="mt-6 chip chip-MERGED">Merged as <span className="mono">{pr.mergeCommitSha?.slice(0, 7)}</span></p>}
      </main>
    </>
  );
}
