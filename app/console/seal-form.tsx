"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fingerprint, randomId, seal, type KeyPair } from "@/lib/envelope/core";
import { principalKey } from "@/lib/principal-key";

const cents = (s: string) => Math.round(Number(s) * 100);

export function SealForm({ defaultPayees }: { defaultPayees: string[] }) {
  const router = useRouter();
  const [key, setKey] = useState<KeyPair | null>(null);
  const [f, setF] = useState({ name: "Ada", title: "Store launch budget", limit: "200", per: "80", payees: defaultPayees.join(", "), purposes: "translation, design", hours: "6", splits: "2", holder: "demo", agentKey: "", agentLabel: "my-agent" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void principalKey().then(setKey); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key) return;
    setErr(null);
    try {
      let holder = { publicKey: f.agentKey.trim(), label: f.agentLabel.trim() || "agent" };
      const draftId = randomId("draft");
      if (f.holder === "demo") {
        setBusy("Creating the demo agents…");
        const r = await fetch("/api/demo/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Couldn't create demo agents.");
        holder = { publicKey: j.opsPublicKey, label: "ops-agent" };
      } else if (!/^[A-Za-z0-9_-]{43}$/.test(holder.publicKey)) throw new Error("Paste the agent's public key (43 characters, from `agent.ts keygen`).");
      setBusy("Signing in your browser…");
      const chain = await seal(key, holder, { currency: "USD", limit: cents(f.limit), perPayment: cents(f.per), payees: list(f.payees).length ? list(f.payees) : null, purposes: list(f.purposes).length ? list(f.purposes) : null, notAfter: new Date(Date.now() + Number(f.hours) * 3600_000).toISOString(), splits: Number(f.splits) });
      setBusy("Placing the PayPal hold…");
      const r = await fetch("/api/envelopes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, principalName: f.name, title: f.title, draftId: f.holder === "demo" ? draftId : undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The gateway refused the envelope.");
      router.push(`/e/${j.root.id}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); setBusy(null); }
  }

  const L = "block text-sm font-medium";
  return (
    <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={L}>Your name<input className="field mt-1" value={f.name} onChange={set("name")} required /></label>
        <label className={L}>What it's for<input className="field mt-1" value={f.title} onChange={set("title")} required /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <label className={L}>Total (USD)<input className="field mt-1 money" value={f.limit} onChange={set("limit")} inputMode="decimal" required /></label>
        <label className={L}>Max per payment<input className="field mt-1 money" value={f.per} onChange={set("per")} inputMode="decimal" required /></label>
        <label className={L}>Valid for (hours)<input className="field mt-1" value={f.hours} onChange={set("hours")} inputMode="numeric" required /></label>
        <label className={L}>Splits allowed<input className="field mt-1" value={f.splits} onChange={set("splits")} inputMode="numeric" required /></label>
      </div>
      <label className={L}>Only these payees <span className="font-normal text-ink-soft">(PayPal emails, comma-separated; empty = any)</span><input className="field mt-1 mono text-sm" value={f.payees} onChange={set("payees")} /></label>
      <label className={L}>Only these purposes <span className="font-normal text-ink-soft">(empty = any)</span><input className="field mt-1" value={f.purposes} onChange={set("purposes")} /></label>
      <label className={L}>Give it to
        <select className="field mt-1" value={f.holder} onChange={set("holder")}>
          <option value="demo">Built-in demo agents (scripted, keys held by this demo server)</option>
          <option value="own">My own agent (I'll paste its public key)</option>
        </select>
      </label>
      {f.holder === "own" && (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <label className={L}>Agent public key<input className="field mt-1 mono text-xs" value={f.agentKey} onChange={set("agentKey")} placeholder="from: npx tsx scripts/agent.ts keygen ops" /></label>
          <label className={L}>Agent name<input className="field mt-1" value={f.agentLabel} onChange={set("agentLabel")} /></label>
        </div>
      )}
      <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-ink-soft">Signed with your key <span className="mono text-ink">{key ? fingerprint(key.publicKey) : "…"}</span>, which stays in this browser. The gateway can enforce your envelope but can't forge one.</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button className="btn btn-primary" disabled={!key || Boolean(busy)}>{busy ?? `Seal & hold $${Number(f.limit || 0).toFixed(2)} on PayPal`}</button>
    </form>
  );
}
