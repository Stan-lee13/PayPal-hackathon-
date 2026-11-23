"use client";

/**
 * The member screen.
 *
 * Everything it shows comes from `GET /api/organizations/members`, which is scoped to the session's organization
 * on the server: this file never sends an organization id, so it cannot ask about someone else's roster. The
 * invitation link is shown once, because the server has nothing but a hash of it afterwards.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { SignInNotice } from "@/components/sign-in-notice";

type Role = "owner" | "admin" | "finance" | "approver" | "auditor" | "developer";
type Roster = {
  organization: { id: string; name: string };
  members: { userId: string; email: string | null; displayName: string; role: Role; acceptedAt: string | null; since: string }[];
  invitations: { id: string; email: string; role: Role; invitedBy: string; expiresAt: string; createdAt: string }[];
  canManage: boolean;
};
type Issued = { token: string; acceptPath: string; invitation: { email: string; role: Role } };

const ROLES: Role[] = ["owner", "admin", "finance", "approver", "auditor", "developer"];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function MembersView() {
  const [d, setD] = useState<Roster | null>(null);
  const [need, setNeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Roster & { error?: string }>("/api/organizations/members");
    if (r.status === 401) { setNeed(true); return; }
    if (!r.ok) { setError(r.json?.error ?? "This page could not be read."); return; }
    setNeed(false);
    setError(null);
    setD(r.json);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setLink(null); setCopied(false);
    const r = await api<Issued & { error?: string }>("/api/organizations/invitations", { method: "POST", body: { email, role } });
    setBusy(false);
    if (!r.ok) { setError(r.json?.error ?? "The invitation could not be issued."); return; }
    setLink(`${window.location.origin}${r.json.acceptPath}`);
    setEmail("");
    await load();
  };

  const withdraw = async (id: string) => {
    setBusy(true); setError(null);
    const r = await api<{ error?: string }>(`/api/organizations/invitations/${id}/revoke`, { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) { setError(r.json?.error ?? "The invitation could not be withdrawn."); return; }
    await load();
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };

  if (need) return <SignInNotice what="roster" />;
  if (error && !d) return <p className="sheet mt-8 max-w-xl p-6 text-sm text-red-700" data-testid="members-error">{error}</p>;
  if (!d) return <p className="label py-10">Reading the roster…</p>;

  return (
    <div className="mt-10 space-y-12">
      <section data-testid="members-roster">
        <h2 className="label">In {d.organization.name}</h2>
        <ul className="ledger mt-3 border-t-[1.5px] border-ink">
          {d.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[.98rem]">{m.displayName || "Member"}</p>
                <p className="mono mt-0.5 text-[.7rem] text-ink-3">{m.email ?? "no address on file"}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="micro !text-[.62rem] text-ink-2">{m.role}</span>
                <span className="micro !text-[.6rem] text-ink-3">since {day(m.acceptedAt ?? m.since)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="members-invitations">
        <h2 className="label">Invited, not yet joined</h2>
        {d.invitations.length === 0 ? (
          <p className="mt-3 border-t-[1.5px] border-ink pt-4 text-sm text-ink-2">No invitation is outstanding.</p>
        ) : (
          <ul className="ledger mt-3 border-t-[1.5px] border-ink">
            {d.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="mono text-[.8rem]">{i.email}</p>
                  <p className="micro mt-0.5 !text-[.6rem] text-ink-3">{i.role} · expires {day(i.expiresAt)}</p>
                </div>
                {d.canManage && (
                  <button type="button" className="btn btn-quiet btn-sm !text-[.8rem]" onClick={() => void withdraw(i.id)} disabled={busy}>Withdraw</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.canManage && (
        <section data-testid="members-invite" className="sheet max-w-xl p-6">
          <h2 className="title text-[1.3rem]">Invite someone</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            The link works once, for the address below, and expires in a week. The role you may grant is limited to
            what you already hold, so nobody can be invited with an authority the inviter does not have.
          </p>
          <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={invite}>
            <label className="min-w-[15rem] flex-1">
              <span className="label">Address</span>
              <input className="field mt-1 w-full" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" data-testid="invite-email" />
            </label>
            <label>
              <span className="label">Role</span>
              <select className="field mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="invite-role">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button type="submit" className="btn btn-ink" disabled={busy} data-testid="invite-submit">Issue link</button>
          </form>

          {link && (
            <div className="mt-5 border-t border-rule pt-4" data-testid="invite-link">
              <p className="label">Send this to them — it is shown once</p>
              <p className="mono mt-2 break-all text-[.75rem]">{link}</p>
              <button type="button" className="btn btn-quiet btn-sm mt-3 !text-[.8rem]" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
            </div>
          )}
        </section>
      )}

      {error && <p className="text-sm text-red-700" data-testid="members-error">{error}</p>}
    </div>
  );
}
