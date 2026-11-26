"use client";

/**
 * The organization's administrative audit trail, read-only.
 *
 * Everything here comes from `GET /api/organizations/audit`, which selects the session's organization on the
 * server and requires `audit.read`. This file sends no organization id, offers no button that writes, and cannot
 * append to the chain: an entry exists only because a membership change committed, in the same transaction.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { SignInNotice } from "@/components/sign-in-notice";

type Entry = {
  id: number;
  seq: number;
  actor: string;
  action: string;
  outcome: string;
  ref: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  hash: string;
};
type History = {
  organization: { id: string; name: string };
  entries: Entry[];
  total: number;
  showing: number;
  chain: { verified: boolean | null; length: number; head: string | null; reason: string | null };
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** One line a person can read, from the entry's action and the fields the write recorded. */
function describe(e: Entry): { line: string; who: string | null } {
  const d = e.detail;
  const subject = str(d.email) || e.ref || str(d.userId) || "someone";
  switch (e.action) {
    case "member.invited":
      return { line: `Invited ${subject} as ${str(d.role)}`, who: str(d.invitedBy) || null };
    case "member.invitation_withdrawn":
      return {
        line: `Withdrew the invitation to ${subject}${d.supersededBy ? " (replaced by a newer one)" : ""}`,
        who: str(d.withdrawnBy) || null,
      };
    case "member.invitation_accepted":
      return {
        line: `${subject} accepted the invitation as ${str(d.role)}${d.alreadyMember ? ", and was already a member" : ""}`,
        who: str(d.acceptedBy) || null,
      };
    case "member.role_changed":
      return { line: `Changed ${subject} from ${str(d.from)} to ${str(d.to)}`, who: str(d.by) || null };
    case "member.removed":
      return { line: `Removed ${subject} (was ${str(d.role)})`, who: str(d.by) || null };
    default:
      return { line: `${e.action}${e.ref ? ` · ${e.ref}` : ""}`, who: null };
  }
}

export function AuditView() {
  const [d, setD] = useState<History | null>(null);
  const [need, setNeed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await api<History & { error?: string }>("/api/organizations/audit");
      if (r.status === 401) { setNeed(true); return; }
      if (!r.ok) { setError(r.json?.error ?? "The audit trail could not be read."); return; }
      setD(r.json);
    })();
  }, []);

  if (need) return <SignInNotice what="audit trail" />;
  if (error && !d) return <p className="sheet mt-8 max-w-xl p-6 text-sm text-red-700" data-testid="audit-error">{error}</p>;
  if (!d) return <p className="label py-10">Reading the trail…</p>;

  return (
    <div className="mt-10 space-y-8">
      <section className="sheet max-w-2xl p-5" data-testid="audit-chain">
        <p className="label">In {d.organization.name}</p>
        {d.chain.verified === true ? (
          <p className="mt-2 text-sm text-ink-2">
            Chain verified from the first entry: {d.chain.length} {d.chain.length === 1 ? "entry" : "entries"}, head{" "}
            <span className="mono text-[.72rem]">{d.chain.head?.slice(0, 16)}…</span>
          </p>
        ) : d.chain.verified === false ? (
          <p className="mt-2 text-sm text-red-700">
            The chain does not verify: {d.chain.reason}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-2">{d.chain.reason}</p>
        )}
        {d.total > d.showing && (
          <p className="micro mt-2 !text-[.62rem] text-ink-3">
            Showing the most recent {d.showing} of {d.total} decisions.
          </p>
        )}
      </section>

      <section data-testid="audit-list">
        <h2 className="label">Decisions, newest first</h2>
        {d.entries.length === 0 ? (
          <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">
            No administrative decision has been recorded for this organization yet.
          </p>
        ) : (
          <ul className="ledger mt-3 border-t-[1.5px] border-ink">
            {d.entries.map((e) => {
              const { line, who } = describe(e);
              return (
                <li key={e.id} className="border-b border-rule py-4" data-testid="audit-entry">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[.98rem]">{line}</p>
                    <p className="micro !text-[.6rem] text-ink-3">#{e.seq} · {when(e.createdAt)}</p>
                  </div>
                  <p className="mono mt-1.5 break-all text-[.68rem] text-ink-3">
                    {e.action} · {e.actor}
                    {who ? ` · ${who}` : ""}
                    {e.outcome !== "OK" ? ` · ${e.outcome}` : ""}
                  </p>
                  <p className="mono mt-1 break-all text-[.64rem] text-ink-3">{e.hash}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
        Each entry is written in the same transaction as the change it describes, so the trail cannot disagree with
        the roster: an entry that is here is a change that committed, and a change that was refused left none.
      </p>
    </div>
  );
}
