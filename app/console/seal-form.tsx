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

  const L = "label block";
  return (
    <form onSubmit={submit} className="sheet sheet-lift mt-8 space-y-6 p-6 sm:p-8">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <label className={L}>Your name<input className="field mt-1" value={f.name} onChange={set("name")} required /></label>
        <label className={L}>What it's for<input className="field mt-1" value={f.title} onChange={set("title")} required /></label>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
        <label className={L}>Total (USD)<input className="field figure mt-1 !text-[1.7rem]" value={f.limit} onChange={set("limit")} inputMode="decimal" required /></label>
        <label className={L}>Per payment<input className="field figure mt-1 !text-[1.7rem]" value={f.per} onChange={set("per")} inputMode="decimal" required /></label>
        <label className={L}>Hours valid<input className="field figure mt-1 !text-[1.7rem]" value={f.hours} onChange={set("hours")} inputMode="numeric" required /></label>
        <label className={L}>Splits<input className="field figure mt-1 !text-[1.7rem]" value={f.splits} onChange={set("splits")} inputMode="numeric" required /></label>
      </div>
      <label className={L}>Only these payees <span className="normal-case tracking-normal text-ink-3">(PayPal emails, comma-separated; empty = any)</span><input className="field mono mt-1 !text-[.9rem]" value={f.payees} onChange={set("payees")} /></label>
      <label className={L}>Only these purposes <span className="normal-case tracking-normal text-ink-3">(empty = any)</span><input className="field mt-1" value={f.purposes} onChange={set("purposes")} /></label>
      <label className={L}>Give it to
        <select className="field mt-1" value={f.holder} onChange={set("holder")}>
          <option value="demo">Built-in demo agents (scripted)</option>
          <option value="own">My own agent (paste its public key)</option>
        </select>
      </label>
      {f.holder === "demo" && <p className="-mt-3 text-xs text-ink-3">The demo agents follow a fixed script and their keys are held by this demo server. Real agents keep their own keys.</p>}
      {f.holder === "own" && (
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-[2fr_1fr]">
          <label className={L}>Agent public key<input className="field mono mt-1 !text-[.78rem]" value={f.agentKey} onChange={set("agentKey")} placeholder="from: npx tsx scripts/agent.ts keygen ops" /></label>
          <label className={L}>Agent name<input className="field mt-1" value={f.agentLabel} onChange={set("agentLabel")} /></label>
        </div>
      )}
      <div className="perforated flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pt-6">
        <div className="min-w-0 flex-1 basis-64">
          <p className="border-b-[1.5px] border-ink pb-1 font-serif text-[1.6rem] italic leading-none text-blue" aria-hidden="true">{f.name || "—"}</p>
          <p className="mt-1.5 text-xs text-ink-2">Signed with your key <span className="mono text-ink">{key ? fingerprint(key.publicKey) : "…"}</span>, which stays in this browser. The gateway can enforce your envelope but can't forge one.</p>
        </div>
        <button className="btn btn-ink shrink-0" disabled={!key || Boolean(busy)}>{busy ?? `Seal & hold $${Number(f.limit || 0).toFixed(2)} on PayPal`}</button>
      </div>
      {err && <p role="alert" className="text-sm text-red">{err}</p>}
    </form>
  );
}
