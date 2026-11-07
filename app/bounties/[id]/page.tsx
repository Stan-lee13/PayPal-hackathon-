import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { ModeBanner } from "@/components/mode-banner";
import { BountyHeader } from "@/components/bounty-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { getDb } from "@/lib/db";
import { auditLog, bounties, companies, developers, submissions } from "@/lib/db/schema";
import { currentPersona } from "@/lib/security/persona";
import { hasSignedNda } from "@/lib/services/bounties";
import { formatMoney } from "@/lib/money";
import { verifyChain, type ChainEntry } from "@/lib/ledger/chain";
import { Actions, Decision } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounty" };

const GATE: Record<string, string> = { PASS: "text-paid", FAIL: "text-danger", WARN: "text-blocked", UNKNOWN: "text-ink-soft" };
const CRIT: Record<string, [string, string]> = { PROVEN: ["Proven", "chip-PAID"], LIKELY: ["Probably met", "chip-SENT"], UNCLEAR: ["Unclear", "chip-DRAFT"], NOT_MET: ["Not met", "chip-MERGE_BLOCKED"] };
const REC: Record<string, [string, string]> = { APPROVE: ["Recommend paying", "chip-PAID"], REQUEST_CHANGES: ["Recommend changes", "chip-SENT"], NEEDS_REVIEW: ["Needs a human", "chip-DRAFT"], REJECT: ["Recommend rejecting: integrity", "chip-MERGE_BLOCKED"] };

export default async function BountyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; funded?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const b = await db.query.bounties.findFirst({ where: eq(bounties.id, id) });
  if (!b) notFound();
  const p = await currentPersona();
  const company = (await db.query.companies.findFirst({ where: eq(companies.id, b.companyId) }))!;
  const subs = await db.select({ s: submissions, d: developers }).from(submissions).innerJoin(developers, eq(developers.id, submissions.developerId)).where(eq(submissions.bountyId, b.id)).orderBy(desc(submissions.createdAt));
  const claimer = b.claimedBy ? await db.query.developers.findFirst({ where: eq(developers.id, b.claimedBy) }) : null;
  const isCompany = p.kind === "company" && p.id === b.companyId;
  const ndaOk = p.kind === "developer" ? await hasSignedNda(p.id, b) : true;
  const showDetails = isCompany || !b.ndaRequired || ndaOk;
  const trail = await db.select().from(auditLog).where(eq(auditLog.subjectId, b.id)).orderBy(asc(auditLog.seq));
  const chain = verifyChain(b.companyId, b.id, trail.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) as ChainEntry[]);
  const m = (n: number) => formatMoney(n, b.currency);
  return (
    <>
      <ModeBanner />
      <BountyHeader persona={p.key} />
      {["PAYING", "IN_REVIEW"].includes(b.status) && <AutoRefresh seconds={5} />}
      <main id="main" className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {sp.error && <p role="alert" className="card border-danger/40 bg-danger-wash p-3 text-sm">{sp.error}</p>}
          <div>
            <p className="text-sm text-ink-soft">{company.name} · <span className="mono">{b.repo}</span>{b.issueNumber ? ` · issue #${b.issueNumber}` : ""}</p>
            <h1 className="mt-1 text-2xl font-semibold">{b.title}</h1>
            <p className="mt-2 text-ink-soft">{b.summary}</p>
          </div>

          <section className="card p-5">
            <h2 className="font-semibold">Acceptance criteria</h2>
            <p className="text-xs text-ink-soft">A criterion counts as proven only by a new test that passed CI on the submitted commit.</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">{b.criteria.map((c, i) => <li key={i}>{c}</li>)}</ol>
            {showDetails ? <p className="mt-4 whitespace-pre-wrap border-t border-rule pt-3 text-sm">{b.details}</p> : <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-soft">Full task details are visible after signing the NDA.</p>}
            <p className="mt-3 text-xs text-ink-soft">Requires: {b.requiresTests ? "new tests" : "no new tests"}{b.requiredChecks.length ? ` · CI checks ${b.requiredChecks.join(", ")}` : ""} · claim lasts {b.claimHours}h{b.deadline ? ` · deadline ${b.deadline.toISOString().slice(0, 10)}` : ""}</p>
          </section>

          {subs.map(({ s, d }) => {
            const r = s.report;
            const [rl, rc] = REC[r?.recommendation ?? "NEEDS_REVIEW"]!;
            return (
              <section key={s.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
                  <div><p className="font-semibold">Submission by {d.name} <span className="font-normal text-ink-soft">@{d.githubLogin}</span></p>
                    <p className="text-xs text-ink-soft"><a className="link" href={s.prUrl} target="_blank" rel="noreferrer">PR #{s.prNumber}</a> · commit <span className="mono">{s.headSha.slice(0, 7)}</span> · {s.status.toLowerCase().replace("_", " ")}</p></div>
                  <span className={`chip ${rc}`}>{rl}</span>
                </div>
                {r && (
                  <div className="space-y-4 px-5 py-4 text-sm">
                    <div>
                      <p className="eyebrow">Deterministic checks · commit {r.commit.slice(0, 7)}</p>
                      <ul className="mt-2 space-y-1.5">{r.gates.map((g) => (
                        <li key={g.id} className="flex gap-2"><span className={`mono w-14 shrink-0 text-xs font-semibold ${GATE[g.status]}`}>{g.status}</span><span><span className="font-medium">{g.label}.</span> <span className="text-ink-soft">{g.detail}</span>{g.evidence.length > 0 && g.status !== "PASS" && <span className="mono block text-xs text-ink-soft">{g.evidence.slice(0, 4).join(" · ")}</span>}</span></li>
                      ))}</ul>
                    </div>
                    <div>
                      <p className="eyebrow">Criteria → evidence · {r.criteria.source === "claude" ? "Claude, evidence checked against the PR" : "MergePay rules"}</p>
                      <ul className="mt-2 space-y-2">{r.criteria.results.map((c, i) => { const [cl, cc] = CRIT[c.status]!; return (
                        <li key={i}><div className="flex items-start gap-2"><span className={`chip ${cc} shrink-0`}>{cl}</span><span>{c.criterion}</span></div>
                          <p className="ml-1 mt-0.5 text-xs text-ink-soft">{c.reasoning}{c.tests.length > 0 && <span className="mono block">{c.tests.map((t) => `${t.file} › ${t.name}`).join("  ·  ")}</span>}</p></li>); })}</ul>
                      {r.criteria.concerns.length > 0 && <ul className="mt-2 text-xs text-blocked">{r.criteria.concerns.map((c, i) => <li key={i}>⚠ {c}</li>)}</ul>}
                    </div>
                    <p className="rounded-lg bg-sunken px-3 py-2 text-xs"><strong>Why:</strong> {r.reasons.join(" · ")}</p>
                    {s.companyNote && <p className="text-xs"><strong>Company:</strong> {s.companyNote}</p>}
                    {isCompany && b.status === "IN_REVIEW" && ["VERIFIED", "VERIFYING"].includes(s.status) && <Decision bountyId={b.id} submissionId={s.id} recommendation={r.recommendation} failed={r.gates.some((g) => g.status === "FAIL")} />}
                    {p.kind === "developer" && p.id === s.developerId && s.status === "REJECTED" && r.recommendation !== "REJECT" && <Decision bountyId={b.id} submissionId={s.id} recommendation={r.recommendation} failed={false} dispute />}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <p className="money text-3xl font-semibold">{m(b.amountMinor)}</p>
            <p className="text-xs text-ink-soft">to the developer, in full · company pays {m(b.amountMinor + b.feeMinor)} incl. 5% fee</p>
            <p className="mt-3"><span className="chip chip-SENT">{b.status.replace("_", " ").toLowerCase()}</span>{claimer && b.status === "CLAIMED" && <span className="ml-2 text-xs text-ink-soft">claimed by {claimer.name} until {b.claimExpiresAt?.toISOString().slice(0, 16).replace("T", " ")} UTC</span>}</p>
            <dl className="mt-4 space-y-1.5 border-t border-rule pt-3 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-ink-soft">PayPal authorization</dt><dd className="mono">{b.authorizationId ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-soft">Reserved until</dt><dd>{b.authorizationExpiresAt?.toISOString().slice(0, 10) ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-soft">Captured</dt><dd className="mono">{b.captureId ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-soft">Payout</dt><dd className="mono">{b.payoutBatchId ? `${b.payoutStatus ?? ""} ${b.payoutBatchId}` : "—"}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-ink-soft">An authorization is a PayPal hold on the company&rsquo;s account, not escrow: it&rsquo;s captured only when the company approves verified work, and voided if the bounty is cancelled.</p>
          </section>
          <Actions bountyId={b.id} status={b.status} persona={p.kind} isCompany={isCompany} isClaimer={p.kind === "developer" && b.claimedBy === p.id} ndaRequired={b.ndaRequired && !ndaOk} ndaText={b.ndaText} devName={p.label.split(" (")[0]!} hasCapture={Boolean(b.captureId)} />
          <section className="card p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Trail</h2><span className={`chip ${chain.ok ? "chip-PAID" : "chip-MERGE_BLOCKED"}`}>{chain.ok ? `Chain intact · ${chain.length}` : "Chain broken"}</span></div>
            <ol className="mt-3 space-y-2 text-xs">{trail.map((t) => <li key={t.id}><span className="mono text-ink-soft">#{t.seq}</span> {t.action.replace(/\./g, " › ")} <span className="text-ink-soft">· {t.actor}{t.ref ? ` · ${t.ref.slice(0, 24)}` : ""}</span></li>)}</ol>
          </section>
        </aside>
      </main>
    </>
  );
}
