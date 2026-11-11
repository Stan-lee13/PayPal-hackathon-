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
 * Identity ("know your agent"):
 *   npx tsx scripts/agent.ts hello  --as <agent> --payee a@x --amount 45 --purpose translation   → prints an introduction token
 *   npx tsx scripts/agent.ts check  <token>      (run by the payee: is this agent good for the money? signed by the gateway)
 *   npx tsx scripts/agent.ts whois  <agent name or public key>
 *
 * An account that keeps a balance:
 *   npx tsx scripts/agent.ts open-account --as <agent> --owner <owner> --settle-to owner@x --hold --per-payment 30
 *   npx tsx scripts/agent.ts balance  --as <agent>
 *   npx tsx scripts/agent.ts transfer --as <agent> --payee acct:xxxx-xxxx-xxxx --amount 12 --purpose proofreading   (or a PayPal address)
 *   npx tsx scripts/agent.ts withdraw --as <agent> --amount 20                      (to the owner's PayPal address)
 *   npx tsx scripts/agent.ts freeze   --as <owner> --agent <agent>                  (and: unfreeze)
 *   npx tsx scripts/agent.ts books
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
for (let i = 0; i < rest.length; i++) { const a = rest[i]!; if (!a.startsWith("--")) { positional.push(a); continue; } const next = rest[i + 1]; if (next === undefined || next.startsWith("--")) args[a.slice(2)] = ""; else { args[a.slice(2)] = next; i++; } }
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
    if (r.json.paypal) console.log(`  PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
    console.log(`  Receipt: ${GATEWAY}/r/${r.json.spendId}`);
    break;
  }
  case "open-account": {
    // An account that can RECEIVE: signed by the agent's own key and by the owner who answers for it.
    const me = await key(need("as"));
    const owner = await key(need("owner"), true);
    const hold = "hold" in args;
    const signed = await E.signAccount(me, owner, { label: args.as!, ownerName: args["owner-name"] ?? args.owner!, settleTo: need("settle-to"), ...(hold ? { mode: "hold" as const } : {}), ...(args["per-payment"] ? { perPayment: cents(args["per-payment"]) } : {}) });
    const r = await post("/api/accounts", { signed });
    if (r.status !== 200) { console.error(`Refused: ${r.json.error}`); process.exit(1); }
    console.log(`${args.as} can now be paid as ${r.json.payee} (account ${r.json.account}). ${r.json.holds ? `Income stays in its balance${r.json.perPaymentMinor ? `; it may pay at most ${usd(r.json.perPaymentMinor)} at once` : ""}. Withdrawals go to ${r.json.settlesTo}.` : `Income settles to ${r.json.settlesTo}.`}`);
    break;
  }
  case "transfer":
  case "withdraw": {
    // Money out of the agent's own balance: to another account, to a PayPal address, or home to its owner.
    const me = await key(need("as"));
    const signed = await E.signTransfer(me, cmd === "withdraw" ? { kind: "withdraw", amount: cents(need("amount")), memo: args.memo } : { amount: cents(need("amount")), payee: need("payee"), purpose: args.purpose, memo: args.memo });
    const r = await post("/api/bank/transfer", { signed });
    if (r.json.status === "DENIED") {
      console.log("DENIED. Nothing moved.");
      for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`);
      process.exit(3);
    }
    if (!r.json.status) { console.error(`Gateway error: ${r.json.error ?? r.status}`); process.exit(1); }
    console.log(`${r.json.status}: ${usd(signed.request.amount)} ${cmd === "withdraw" ? "to the owner" : `to ${signed.request.payee}`}${r.json.duplicate ? " (already done; not moved twice)" : ""}. Balance now ${usd(r.json.balanceMinor)}.`);
    if (r.json.paypal) console.log(`  PayPal payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`);
    else if (r.json.status === "BOOKED") console.log("  Moved between accounts on the ledger; no PayPal call was needed.");
    for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.detail}`);
    console.log(`  Transfer ${r.json.transferId}: ${GATEWAY}/api/bank/transfers/${r.json.transferId}`);
    break;
  }
  case "freeze":
  case "unfreeze": {
    const owner = await key(need("as"));
    const agent = await key(need("agent"));
    const r = await post("/api/bank/freeze", { signed: await E.signFreeze(owner, agent.publicKey, cmd === "freeze") });
    if (r.status !== 200) { console.error(`Refused: ${r.json.error}`); process.exit(1); }
    console.log(`${r.json.label}'s account is ${r.json.frozen ? "frozen: nothing can leave its balance" : "open again"}. Balance ${usd(r.json.balanceMinor)}.`);
    break;
  }
  case "balance": {
    const me = await key(need("as"));
    const r = await fetch(`${GATEWAY}/api/agents/${me.publicKey}`).then(async (x) => ({ status: x.status, json: (await x.json()) as Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (r.status !== 200 || !r.json.balance) { console.error(r.json.error ?? `${args.as} has no account that keeps a balance.`); process.exit(1); }
    const b = r.json.balance;
    console.log(`${args.as}: ${usd(b.minor)}${b.frozen ? " · FROZEN by its owner" : ""}${b.perPaymentMinor ? ` · may pay at most ${usd(b.perPaymentMinor)} at once` : ""}`);
    for (const l of b.ledger) console.log(`  ${l.at.slice(0, 19)}Z  ${(l.deltaMinor < 0 ? "-" : "+") + usd(Math.abs(l.deltaMinor))}`.padEnd(36) + `${l.kind} ${l.counterparty ?? ""}  → ${usd(l.balanceAfterMinor)}`);
    break;
  }
  case "books": {
    const r = (await fetch(`${GATEWAY}/api/bank`).then((x) => x.json())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log(`${usd(r.totals.capturedInMinor)} paid in − ${usd(r.totals.paidOutMinor)} paid out = ${usd(r.totals.balancesMinor)} held for ${r.totals.holding} account(s); ${r.totals.bookTransfers} transfer(s) between accounts.`);
    for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}`);
    for (const a of r.accounts) console.log(`  ${a.label.padEnd(24)} ${usd(a.balanceMinor).padStart(10)}  ${a.mode}${a.frozen ? " · frozen" : ""}  (${a.owner})`);
    break;
  }
  case "promise": {
    // Set money aside for a payee before work starts. Prints a note the payee can verify.
    const me = await key(need("as"));
    const signed = await E.signPromise(envelope(args.as!), me, { amount: cents(need("amount")), payee: need("payee"), purpose: need("purpose"), memo: args.memo, ttl: args.minutes ? Math.round(Number(args.minutes) * 60) : 900,
      // --release-by <public key | local key name>: that key's signed acceptance pays the promise
      releaseBy: args["release-by"] ? (/^[A-Za-z0-9_-]{43}$/.test(args["release-by"]) ? args["release-by"] : (await key(args["release-by"])).publicKey) : undefined });
    const r = await post("/api/gateway/promise", { signed, note: args.note });
    if (r.json.status !== "PROMISED") {
      console.log(`${r.json.status ?? "ERROR"}. Nothing was set aside.${r.json.error ? " " + r.json.error : ""}`);
      for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`);
      process.exit(3);
    }
    console.log(`SET ASIDE: ${usd(signed.request.amount)} for ${signed.request.payee} until ${r.json.expiresAt}. Promise ${r.json.promiseId}`);
    console.log(`  Give the payee this note: ${E.b64u(new TextEncoder().encode(JSON.stringify(r.json.note)))}`);
    console.log(`  Pay it:     agent.ts keep ${r.json.promiseId} --as ${args.as}`);
    console.log(`  Release it: agent.ts release ${r.json.promiseId} --as ${args.as}`);
    break;
  }
  case "keep":
  case "release": {
    const me = await key(need("as"));
    const r = await post("/api/gateway/keep", { signed: await E.signKeep(me, positional[0] ?? need("promise"), cmd === "keep" ? "pay" : "release"), note: args.note });
    if (!r.json.status) { console.error(`Gateway: ${r.json.error ?? r.status}`); process.exit(1); }
    if (cmd === "release") { console.log(r.json.status === "LAPSED" ? "Released. The money is back in the envelope." : `Not released: the promise is ${r.json.status}.`); break; }
    if (r.json.status === "LAPSED" || r.json.status === "DENIED" || r.json.status === "FAILED") {
      console.log(`${r.json.status}. Nothing was paid.`);
      for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`);
      process.exit(3);
    }
    console.log(`${r.json.status}: the promise was paid${r.json.duplicate ? " (already done; not paid twice)" : ""}`);
    if (r.json.paypal) console.log(`  PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
    console.log(`  Receipt: ${GATEWAY}/r/${r.json.spendId}`);
    break;
  }
  case "accept": {
    // Run by the key a promise named with --release-by: "the work is delivered and accepted". Pays the promise.
    const me = await key(need("as"));
    const work = args["work-file"] ? await E.sha256(readFileSync(args["work-file"], "utf8")) : args.work ?? "";
    const r = await post("/api/gateway/accept", { signed: await E.signAccept(me, positional[0] ?? need("promise"), { work, note: args.note }) });
    if (!r.json.status) { console.error(`Gateway: ${r.json.error ?? r.status}`); process.exit(1); }
    if (["LAPSED", "DENIED", "FAILED"].includes(r.json.status)) { console.log(`${r.json.status}. Nothing was paid.`); for (const x of r.json.reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`); process.exit(3); }
    console.log(`${r.json.status}: your acceptance released the money${r.json.duplicate ? " (already done; not paid twice)" : ""}${work ? `. Work fingerprint ${work.slice(0, 16)}… is on the receipt` : ""}`);
    if (r.json.paypal) console.log(`  PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
    console.log(`  Receipt: ${GATEWAY}/r/${r.json.spendId}`);
    break;
  }
  case "reference": {
    // An agent's record, signed by the gateway. Prints a token the agent can hand to anyone.
    const who = positional[0] ?? need("agent");
    const pk = /^[A-Za-z0-9_-]{43}$/.test(who) ? who : (await key(who)).publicKey;
    const r = await fetch(`${GATEWAY}/api/agents/${pk}/reference`).then(async (x) => ({ status: x.status, json: await x.json() as Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (r.status !== 200) { console.error(r.json.error ?? r.status); process.exit(1); }
    const f = r.json.reference.facts;
    console.log(`${r.json.reference.label} · account ${r.json.reference.account} · known since ${r.json.reference.knownSince}`);
    console.log(`  ${f.paymentsSettled} payment(s) settled (${usd(f.paidMinor)}), promises kept ${f.promisesKept} of ${f.promisesKept + f.promisesLapsed}, ${f.requestsRefused} request(s) refused, paid ${f.timesPaid} time(s) (${usd(f.earnedMinor)})`);
    console.log(E.b64u(new TextEncoder().encode(JSON.stringify(r.json.reference))));
    break;
  }
  case "verify-promise": {
    // Run by the payee: is this note really from the gateway, and is the money still set aside?
    let n: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { n = JSON.parse(new TextDecoder().decode(E.unb64u(positional[0] ?? need("note")))); } catch { console.error("That is not a promise note."); process.exit(2); }
    const { sig, ...body } = n;
    const pinned = await fetch(`${GATEWAY}/api/gateway/key`).then((x) => x.json()).catch(() => null) as { publicKey?: string } | null;
    const signed = (await E.verifyDetached(n.gateway, "envelope-promise-note/1", body, sig)) && pinned?.publicKey === n.gateway;
    const live = Date.parse(n.expiresAt) > Date.now();
    console.log(`${n.agentLabel} (account ${n.account}) has ${usd(n.amount)} set aside for ${n.payee}, for ${n.purpose}`);
    console.log(`  Stands behind it: ${n.sponsors.map((x: { label: string; role: string }) => `${x.label} (${x.role})`).join(" → ")}`);
    console.log(`  PayPal hold ${n.paypal.authorizationId}: ${n.paypal.status} (${n.paypal.mode})`);
    console.log(`  Held until ${n.expiresAt}${live ? "" : " — EXPIRED"}. Signed by the gateway (${E.fingerprint(n.gateway)}): ${signed ? "signature valid" : "SIGNATURE INVALID"}.`);
    if (!signed || !live) process.exit(3);
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
  case "hello": {
    const me = await key(need("as"));
    const hello = await E.signHello(envelope(args.as!), me, { amount: cents(need("amount")), payee: need("payee"), purpose: need("purpose") });
    console.log(E.b64u(new TextEncoder().encode(JSON.stringify(hello))));
    break;
  }
  case "check": {
    let hello: unknown;
    try { hello = JSON.parse(new TextDecoder().decode(E.unb64u(positional[0] ?? need("token")))); } catch { console.error("That is not an introduction token."); process.exit(2); }
    const r = await post("/api/gateway/standing", { hello });
    const s = r.json.standing;
    if (!s) { console.error(`Gateway: ${r.json.error ?? r.status}`); process.exit(1); }
    const { sig, ...body } = s;
    const pinned = await fetch(`${GATEWAY}/api/gateway/key`).then((x) => x.json()).catch(() => null) as { publicKey?: string } | null;
    const signed = (await E.verifyDetached(s.gateway, "envelope-standing/1", body, sig)) && pinned?.publicKey === s.gateway;
    console.log(`${s.agentLabel} · account ${s.account}`);
    console.log(`  Stands behind it: ${s.sponsors.map((x: { role: string; label: string; key: string }) => `${x.label} (${x.role}, ${E.fingerprint(x.key)})`).join(" → ")}`);
    console.log(`  PayPal hold ${s.paypal.authorizationId ?? "none"}: ${s.paypal.status ?? "not confirmed"}${s.paypal.unusedMinor !== null ? `, ${usd(s.paypal.unusedMinor)} unused` : ""} (${s.paypal.mode})`);
    console.log(`  Asked: ${usd(s.ask.amount)} to ${s.ask.payee} for ${s.ask.purpose}`);
    console.log(s.good ? `  GOOD. It can pay you up to ${usd(s.availableMinor)} in one payment right now.` : `  NOT GOOD. This payment would be refused:`);
    for (const x of s.reasons) console.log(`    ${x.code}: ${x.detail}`);
    console.log(`  Statement signed by the gateway (${E.fingerprint(s.gateway)}): ${signed ? "signature valid" : "SIGNATURE INVALID"}. Valid until ${s.validUntil}.`);
    if (!s.good || !signed) process.exit(3);
    break;
  }
  case "whois": {
    const who = positional[0] ?? need("agent");
    const pk = /^[A-Za-z0-9_-]{43}$/.test(who) ? who : (await key(who)).publicKey;
    const r = await fetch(`${GATEWAY}/api/agents/${pk}`).then(async (x) => ({ status: x.status, json: await x.json() as Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (r.status !== 200) { console.error(r.json.error ?? r.status); process.exit(1); }
    const p = r.json;
    console.log(`${p.label} · account ${p.account} · first seen ${p.firstSeenAt}`);
    console.log(`  Record: ${p.record.payments} payment(s), ${usd(p.record.paidMinor)} paid, ${p.record.refused} refused, ${usd(p.record.availableMinor)} available now`);
    if (p.receives) console.log(`  Can be paid as ${p.receives.payee} (answers for it: ${p.receives.owner.label}; settles to ${p.receives.settlesTo}). Earned ${usd(p.record.receivedMinor)} in ${p.record.received} payment(s).`);
    for (const a of p.accounts) console.log(`  ${a.state} · "${a.rootTitle}" · ${usd(a.availableMinor)} available of ${usd(a.caps.limit)} · behind it: ${a.sponsors.map((x: { label: string }) => x.label).join(" → ")}`);
    console.log(`  ${GATEWAY}/a/${pk}`);
    break;
  }
  default:
    console.log("Commands: keygen, seal, split, pay, promise, keep, release, accept, verify-promise, reference, open-account, balance, transfer, withdraw, freeze, unfreeze, books, show, revoke, close, hello, check, whois. See the header of scripts/agent.ts.");
}
