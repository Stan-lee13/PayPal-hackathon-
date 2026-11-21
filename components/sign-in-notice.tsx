"use client";

/**
 * Shown instead of a page that reads one organization's records, when the visitor has no session.
 *
 * The route table makes these reads session-only, so a signed-out visitor gets a 401 rather than a filtered
 * answer. This says which sign-in applies: the development one on a laptop, or the identity provider on a
 * deployment. Nothing here bypasses the check; it only offers the door.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Status = { available?: boolean; signedIn?: boolean };

export function SignInNotice({ what }: { what: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Status>("/api/dev/session").then((r) => setStatus(r.ok ? r.json : { available: false }));
  }, []);

  const signIn = async () => {
    setBusy(true);
    const r = await api("/api/dev/session", { method: "POST" });
    if (r.ok) window.location.reload();
    else setBusy(false);
  };

  return (
    <div className="sheet mx-auto mt-8 max-w-xl p-7" data-testid="sign-in-notice">
      <p className="label">One organization at a time</p>
      <h1 className="title mt-2 text-[1.7rem]">Sign in to see this {what}.</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        This page reads an organization&rsquo;s financial records, so the gateway answers only a request that names
        one — from a session it validated on the server, never from a link, a header or an id. Signed agents are
        unaffected: they never need a session, because their signature is the authority.
      </p>
      {status?.available ? (
        <button type="button" className="btn btn-ink mt-5" onClick={signIn} disabled={busy}>
          {busy ? "Signing in…" : "Sign in (development)"}
        </button>
      ) : (
        <a className="btn btn-ink mt-5" href="/api/auth/signin" data-testid="sign-in-oidc">
          Sign in
        </a>
      )}
    </div>
  );
}
