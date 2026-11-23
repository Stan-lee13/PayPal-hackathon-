"use client";

/**
 * Accepting an invitation, from the link.
 *
 * Opening the page does nothing: the invitation is consumed only by the button, so a mail client that prefetches
 * the URL cannot use it up. The signed-in address has to be the address invited, and the server checks that —
 * this screen only reports what it said.
 */
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { SignInNotice } from "@/components/sign-in-notice";

type Joined = { orgId: string; orgName: string; role: string; alreadyMember: boolean };

export function AcceptInvitation({ token }: { token: string }) {
  const [joined, setJoined] = useState<Joined | null>(null);
  const [need, setNeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true); setError(null);
    const r = await api<Joined & { error?: string }>("/api/invitations/accept", { method: "POST", body: { token } });
    setBusy(false);
    if (r.status === 401) { setNeed(true); return; }
    if (!r.ok) { setError(r.json?.error ?? "The invitation could not be accepted."); return; }
    setJoined(r.json);
  };

  if (need) return <SignInNotice what="organization" />;

  if (joined) {
    return (
      <div className="sheet mt-8 max-w-xl p-7" data-testid="invitation-accepted">
        <p className="label">Joined</p>
        <h2 className="title mt-2 text-[1.6rem]">{joined.orgName || "The organization"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          {joined.alreadyMember
            ? "You were already a member; nothing about your role changed."
            : `You are now a member as ${joined.role}. This session is served for this organization from now on, so every page shows its records.`}
        </p>
        <Link className="btn btn-ink mt-5" href="/members">See the members</Link>
      </div>
    );
  }

  return (
    <div className="sheet mt-8 max-w-xl p-7">
      <p className="text-sm leading-relaxed text-ink-2">
        This link admits you to one organization, at the role it names. It works once, and only if you are signed in
        as the address it was sent to. Nothing is consumed until you press the button.
      </p>
      <button type="button" className="btn btn-ink mt-5" onClick={() => void accept()} disabled={busy} data-testid="invitation-accept">
        {busy ? "Accepting…" : "Accept the invitation"}
      </button>
      {error && <p className="mt-4 text-sm text-red-700" data-testid="invitation-error">{error}</p>}
    </div>
  );
}
