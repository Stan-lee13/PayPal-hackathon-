"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="mt-6 space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const r = await fetch("/api/app/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: pass }) });
      setBusy(false);
      if (r.ok) router.push("/app"); else setErr((await r.json().catch(() => ({}))).error ?? "Couldn't sign in.");
    }}>
      <label className="block text-sm font-medium" htmlFor="pass">Passcode</label>
      <input id="pass" className="field" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} required />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
