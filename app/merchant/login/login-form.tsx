"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form className="mt-6 space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const res = await fetch("/api/merchant/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: pass }) });
      setBusy(false);
      if (res.ok) router.push("/merchant"); else setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed");
    }}>
      <label htmlFor="pass" className="block text-sm font-semibold">Passcode</label>
      <input id="pass" type="password" autoComplete="current-password" className="field" value={pass} onChange={(e) => setPass(e.target.value)} required />
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {err && <p role="alert" className="text-sm text-broken">{err}</p>}
    </form>
  );
}
