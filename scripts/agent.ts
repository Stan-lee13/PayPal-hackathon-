/**
 * Envelope CLI for agents (and for a principal without a browser). Keys and envelopes are kept in
 * ./.envelope/ on the machine that runs it: the gateway never sees a private key.
 *
 *   npx tsx scripts/agent.ts keygen <name>
 *   npx tsx scripts/agent.ts seal   --as <principal> --to <agent> --limit 200 --per 80 --payees a@x,b@y --purposes translation,design --hours 6 --splits 2 --title "Launch budget"
 *   npx tsx scripts/agent.ts split  --as <agent> --to <other> --limit 60 --per 60 --payees a@x --purposes translation
 *   npx tsx scripts/agent.ts pay    --as <agent> --amount 45 --payee a@x --purpose translation --memo "FR strings" --note "why"
 *   npx tsx scripts/agent.ts show   --as <agent>
 *   npx tsx scripts/agent.ts revoke --as <name> --agent <other>      (owner or a holder above)
 *   npx tsx scripts/agent.ts close  --as <principal> --agent <root holder>
 *
 * GATEWAY=http://localhost:3000 by default.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as E from "../lib/envelope/core";

const GATEWAY = (process.env.GATEWAY ?? "http://localhost:3000").replace(/\/$/, "");
const DIR = process.env.ENVELOPE_DIR ?? ".envelope";
const [cmd, ...rest] = process.argv.slice(2);
const args: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) { const a = rest[i]!; if (a.startsWith("--")) args[a.slice(2)] = rest[++i] ?? ""; else positional.push(a); }
const need = (k: string) => { if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); } return args[k]!; };
const cents = (s: string) => { if (!/^\d+(\.\d{1,2})?$/.test(s)) { console.error(`Not an amount: ${s}`); process.exit(2); } return Math.round(Number(s) * 100); };
const list = (s: string | undefined) => (s === undefined ? undefined : s.split(",").map((x) => x.trim()).filter(Boolean));
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
mkdirSync(DIR, { recursive: true });

async function key(name: string, create = false): Promise<E.KeyPair> {
  const f = `${DIR}/${name}.key.json`;
  if (existsSync(f)) return E.importPrivateJwk(JSON.parse(readFileSync(f, "utf8")));
  if (!create) { console.error(`No key for "${name}". Run: keygen ${name}`); process.exit(2); }
  const kp = await E.generateKeyPair();
  writeFileSync(f, JSON.stringify(await E.exportPrivateJwk(kp.privateKey)), { mode: 0o600 });
  return kp;
}
const envFile = (name: string) => `${DIR}/${name}.envelope.json`;
function envelope(name: string): E.Envelope {
  if (!existsSync(envFile(name))) { console.error(`"${name}" holds no envelope.`); process.exit(2); }
  return JSON.parse(readFileSync(envFile(name), "utf8"));
}
async function post(path: string, body: unknown) {
  const r = await fetch(`${GATEWAY}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function describe(c: E.Caps) {
  return `up to ${usd(c.limit)} in total, at most ${usd(c.perPayment)} per payment, payees: ${c.payees ? c.payees.join(", ") : "any"}, purposes: ${c.purposes ? c.purposes.join(", ") : "any"}, expires ${c.notAfter}, ${c.splits > 0 ? `may be split ${c.splits} more time(s)` : "may not be split"}`;
}

switch (cmd) {
  case "keygen": {
    const name = positional[0] ?? need("name");
    console.log((await key(name, true)).publicKey);
    break;
  }
  case "seal": {
    const principal = await key(need("as"), true);
    const to = await key(need("to"), true);
    const chain = await E.seal(principal, { publicKey: to.publicKey, label: args.to! }, { currency: "USD", limit: cents(need("limit")), perPayment: cents(args.per ?? need("limit")), payees: list(args.payees) ?? null, purposes: list(args.purposes) ?? null, notAfter: new Date(Date.now() + Number(args.hours ?? "6") * 3600_000).toISOString(), splits: Number(args.splits ?? "2") });
    const r = await post("/api/envelopes", { chain, principalName: args.as, title: args.title ?? "Envelope" });
    if (r.status !== 200) { console.error(`Gateway refused: ${r.json.error}`); process.exit(1); }
    writeFileSync(envFile(args.to!), JSON.stringify(chain));
    console.log(`Sealed ${chain[0]!.body.id} for ${args.to}: ${describe(chain[0]!.body.caps)}`);
    console.log(`PayPal hold: authorization ${r.json.root.authorizationId} for ${usd(r.json.root.limitMinor)}`);
    console.log(`Watch it: ${GATEWAY}/e/${chain[0]!.body.id}`);
    break;
  }
  case "split": {
    const me = await key(need("as"));
    const to = await key(need("to"), true);
    const mine = envelope(args.as!);
    const parent = mine[mine.length - 1]!.body.caps;
    const limit = cents(need("limit"));
    let chain: E.Envelope;
    try {
      chain = await E.split(mine, me, { publicKey: to.publicKey, label: args.to! }, { currency: parent.currency, limit, perPayment: args.per ? cents(args.per) : Math.min(limit, parent.perPayment), payees: list(args.payees) ?? parent.payees, purposes: list(args.purposes) ?? parent.purposes, notAfter: args.hours ? new Date(Date.now() + Number(args.hours) * 3600_000).toISOString() : parent.notAfter, splits: Number(args.splits ?? "0") });
    } catch (e) { console.error(`Refused locally: ${(e as Error).message}`); process.exit(1); }
    writeFileSync(envFile(args.to!), JSON.stringify(chain));
    const r = await post("/api/gateway/announce", { chain });
    console.log(`${args.as} gave ${args.to} a sub-envelope: ${describe(chain[chain.length - 1]!.body.caps)}`);
    console.log(r.status === 200 ? "Announced to the gateway (the owner can see and revoke it)." : `Not announced (${r.json.error}); it is still valid.`);
    break;
  }
  case "pay": {
    const me = await key(need("as"));
    const signed = await E.signSpend(envelope(args.as!), me, { amount: cents(need("amount")), payee: need("payee"), purpose: need("purpose"), memo: args.memo });
    const r = await post("/api/gateway/spend", { signed, note: args.note });
    if (r.json.status === "DENIED") {
      console.log(`DENIED. Nothing was paid.`);
      for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`);
      process.exit(3);
    }
    if (!r.json.status) { console.error(`Gateway error: ${r.json.error ?? r.status}`); process.exit(1); }
    console.log(`${r.json.status}: ${usd(signed.request.amount)} to ${signed.request.payee}${r.json.duplicate ? " (already done; not paid twice)" : ""}`);
    if (r.json.paypal) console.log(`  PayPal capture ${r.json.paypal.captureId}, payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`);
    console.log(`  Receipt: ${GATEWAY}/r/${r.json.spendId}`);
    break;
  }
  case "show": {
    const chain = envelope(need("as"));
    const leaf = chain[chain.length - 1]!.body;
    console.log(`${args.as} holds ${leaf.id} (${chain.length === 1 ? "root" : `depth ${chain.length - 1}, under ${chain.slice(0, -1).map((b) => b.body.holderLabel).join(" → ")}`}): ${describe(leaf.caps)}`);
    const r = await fetch(`${GATEWAY}/api/envelopes/${chain[0]!.body.id}`).then((x) => x.json()).catch(() => null) as { blocks?: Array<{ id: string; holderLabel: string; caps: E.Caps; spentMinor: number; reservedMinor: number; revokedAt: string | null }>; root?: { status: string } } | null;
    if (r?.blocks) for (const b of chain) { const row = r.blocks.find((x) => x.id === b.body.id); if (row) console.log(`  ${row.holderLabel}: ${usd(row.caps.limit - row.spentMinor - row.reservedMinor)} left of ${usd(row.caps.limit)}${row.revokedAt ? " — REVOKED" : ""}`); }
    if (r?.root && r.root.status !== "ACTIVE") console.log("  The root envelope is CLOSED.");
    break;
  }
  case "revoke":
  case "close": {
    const me = await key(need("as"));
    const target = envelope(need("agent"));
    const block = cmd === "close" ? target[0]!.body.id : target[target.length - 1]!.body.id;
    const r = await post("/api/gateway/revoke", { signed: await E.signRevoke(me, block) });
    if (r.status !== 200) { console.error(`Refused: ${r.json.error}`); process.exit(1); }
    console.log(cmd === "close" ? `Closed. PayPal released ${usd(r.json.root.releasedMinor ?? 0)}; ${usd(r.json.root.capturedMinor)} was charged.` : `Revoked ${args.agent}'s envelope and everything split from it.`);
    break;
  }
  default:
    console.log("Commands: keygen, seal, split, pay, show, revoke, close. See the header of scripts/agent.ts.");
}
