"use client";

/**
 * Which organization this browser is signed in to.
 *
 * On a deployment with a server database, the addressed reads are scoped to the signed-in organization. This
 * says which one that is, and offers the development sign-in a laptop has (a real deployment signs in through
 * OIDC instead, and this renders nothing). When the gateway runs in the visitor's browser there is no server
 * session at all, so it renders nothing there either.
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (document.documentElement.dataset.gateway === "browser") return;
    void api<Status>("/api/dev/session").then((r) => setStatus(r.ok ? r.json : null));
  }, []);

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
