"use client";

/**
 * Which organization this browser is signed in to.
 *
 * On a deployment with a server database, the reads that serve one organization's records require a session.
 * This says which organization that is, and offers the development sign-in a laptop has. A real deployment has
 * no development sign-in (the route 404s), so it offers the identity provider's own sign-in page instead. When
 * the gateway runs in the visitor's browser there is no server session at all, and this renders nothing.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Status = {
  available?: boolean; signedIn?: boolean;
  org?: { id: string; name: string; role?: string } | null;
  user?: { email: string | null } | null;
};

export function SessionBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [browser, setBrowser] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (document.documentElement.dataset.gateway === "browser") return;
    setBrowser(false);
    void api<Status>("/api/dev/session").then((r) => setStatus(r.ok ? r.json : { available: false }));
  }, []);

  if (browser) return null;

  // A deployment without the development sign-in signs people in through its identity provider.
  if (status && !status.available) {
    return (
      <a className="btn btn-quiet btn-sm !min-h-[34px] !text-[.84rem]" href="/api/auth/signin" data-testid="session-oidc">
        Sign in
      </a>
    );
  }

  if (!status?.available) return null;

  const act = async (method: "POST" | "DELETE") => {
    setBusy(true);
    const r = await api("/api/dev/session", { method });
    setBusy(false);
    if (r.ok) window.location.reload();
  };

  if (!status.signedIn) {
    return (
      <button type="button" className="btn btn-quiet btn-sm !min-h-[34px] !text-[.84rem]" onClick={() => act("POST")} disabled={busy} title="Sign in to a development organization. A real deployment signs in through its identity provider.">
        Sign in <span className="hidden sm:inline">&nbsp;(dev)</span>
      </button>
    );
  }

  return (
    <span className="hidden items-center gap-2 lg:flex" title={`Signed in as ${status.user?.email ?? "a development user"}`}>
      <span className="micro !text-[.6rem] text-ink-2">{status.org?.name ?? "No organization"}</span>
      <button type="button" className="btn btn-quiet btn-sm !min-h-[34px] !text-[.84rem]" onClick={() => act("DELETE")} disabled={busy}>Sign out</button>
    </span>
  );
}
