/**
 * Envelope CLI for agents (and for a principal without a browser), built on the SDK in ../sdk.
 * Keys and envelopes are kept in ./.envelope/ on the machine that runs it: the gateway never sees a private key.
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
 *   npx tsx scripts/agent.ts refund   --as <agent> <payment id> --memo "why"       (give back a payment it kept: PayPal refunds the capture to the payer)
 *   npx tsx scripts/agent.ts books
 *
 * A card (the agent lets ONE merchant charge its balance, within limits, and it ends by itself):
 *   npx tsx scripts/agent.ts card        --as <agent> --merchant acct:xxxx-xxxx-xxxx --label "Lexica Pro" --per-charge 9 --charges 2 --every-days 30 --valid-days 70
 *   npx tsx scripts/agent.ts cards       --as <agent>
 *   npx tsx scripts/agent.ts cancel-card --as <agent or its owner> <card id>
 *   npx tsx scripts/agent.ts charge      --as <merchant> --card <card id> --amount 9 --memo "November"   (run by the merchant)
 *
 * A payment, looked up again:
 *   npx tsx scripts/agent.ts receipt <payment id>      (asks PayPal through the gateway, and re-checks every signature here)
 *
 * GATEWAY=http://localhost:3000 by default.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Agent, EnvelopeError, Gateway, Owner, checkIntroduction, checkPromiseNote, getReceipt, protocol as E, type GatewayReason, type Payment, type PromiseNote, type SpendOutcome, type TransferOutcome, type ChargeOutcome } from "../sdk/src";

const GATEWAY = (process.env.GATEWAY ?? "http://localhost:3000").replace(/\/$/, "");
const DIR = process.env.ENVELOPE_DIR ?? ".envelope";
const [cmd, ...rest] = process.argv.slice(2);
const args: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) { const a = rest[i]!; if (!a.startsWith("--")) { positional.push(a); continue; } const next = rest[i + 1]; if (next === undefined || next.startsWith("--")) args[a.slice(2)] = ""; else { args[a.slice(2)] = next; i++; } }
const need = (k: string) => { if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); } return args[k]!; };
const cents = (s: string) => { if (!/^\d+(\.\d{1,2})?$/.test(s)) { console.error(`Not an amount: ${s}`); process.exit(2); } return { minor: Math.round(Number(s) * 100) }; };
const list = (s: string | undefined) => (s === undefined ? undefined : s.split(",").map((x) => x.trim()).filter(Boolean));
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
mkdirSync(DIR, { recursive: true });
const gateway = new Gateway(GATEWAY);

const keyFile = (name: string) => `${DIR}/${name}.key.json`;
const envFile = (name: string) => `${DIR}/${name}.envelope.json`;
/** The private key file of a local name, creating it when asked. It is read here and never sent anywhere. */
async function jwk(name: string, create = false): Promise<JsonWebKey> {
  if (existsSync(keyFile(name))) return JSON.parse(readFileSync(keyFile(name), "utf8"));
  if (!create) { console.error(`No key for "${name}". Run: keygen ${name}`); process.exit(2); }
  const k = await E.exportPrivateJwk((await E.generateKeyPair()).privateKey);
  writeFileSync(keyFile(name), JSON.stringify(k), { mode: 0o600 });
  return k;
}
const publicKeyOf = async (name: string, create = false) => (await E.importPrivateJwk(await jwk(name, create))).publicKey;
function envelope(name: string): E.Envelope {
  if (!existsSync(envFile(name))) { console.error(`"${name}" holds no envelope.`); process.exit(2); }
  return JSON.parse(readFileSync(envFile(name), "utf8"));
}
/** A local name as an agent, with the envelope it holds if it holds one. */
const agentNamed = async (name: string, withEnvelope = false, create = false) => Agent.fromJSON({ label: name, key: await jwk(name, create), envelope: withEnvelope ? envelope(name) : null }, { gateway });
const ownerNamed = async (name: string, create = false) => Owner.fromJSON({ label: name, key: await jwk(name, create) }, { gateway });

function describe(c: E.Caps) {
  return `up to ${usd(c.limit)} in total, at most ${usd(c.perPayment)} per payment, payees: ${c.payees ? c.payees.join(", ") : "any"}, purposes: ${c.purposes ? c.purposes.join(", ") : "any"}, expires ${c.notAfter}, ${c.splits > 0 ? `may be split ${c.splits} more time(s)` : "may not be split"}`;
}
const printReasons = (reasons: GatewayReason[] | undefined) => { for (const x of reasons ?? []) console.log(`  ${x.code}: ${x.meaning} (${x.detail})`); };
const paypalLine = (p: NonNullable<SpendOutcome["paypal"]>) => `  PayPal capture ${p.captureId}, ${p.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${p.payoutBatchId} (${p.payoutStatus ?? "pending"})`}`;
/** What the gateway said when it said something other than a verdict, or the HTTP status. */
const said = (e: EnvelopeError) => (e.kind === "gateway" ? e.detail : e.message);
/**
 * Run an SDK call. A verdict that means "this did not happen" (DENIED, FAILED, LAPSED) comes back as
 * `refused` for the command to print in its own words. Anything else that goes wrong ends the program.
 */
async function attempt<T>(call: () => Promise<T>, prefix: string, code = 1): Promise<{ ok: T; refused?: undefined } | { ok?: undefined; refused: EnvelopeError }> {
  try { return { ok: await call() }; } catch (e) {
    if (!(e instanceof EnvelopeError)) throw e;
    if (e.kind === "local") { console.error(e.message); process.exit(2); }
    if (e.outcome) return { refused: e };
    console.error(`${prefix}: ${said(e)}`); process.exit(code);
  }
}
const body = <T>(e: EnvelopeError) => e.body as T;

switch (cmd) {
  case "keygen": {
    const name = positional[0] ?? need("name");
    console.log(await publicKeyOf(name, true));
    break;
  }
  case "seal": {
    const principal = await ownerNamed(need("as"), true);
    const to = { publicKey: await publicKeyOf(need("to"), true), label: args.to! };
    const limit = cents(need("limit"));
    const r = await attempt(() => principal.seal({ to, limit, perPayment: cents(args.per ?? args.limit!), payees: list(args.payees) ?? null, purposes: list(args.purposes) ?? null, hours: Number(args.hours ?? "6"), splits: Number(args.splits ?? "2"), title: args.title ?? "Envelope" }), "Gateway refused");
    const { chain, root } = r.ok!;
    writeFileSync(envFile(args.to!), JSON.stringify(chain));
    console.log(`Sealed ${chain[0]!.body.id} for ${args.to}: ${describe(chain[0]!.body.caps)}`);
    console.log(`PayPal hold: authorization ${root.authorizationId} for ${usd(root.limitMinor)}`);
    console.log(`Watch it: ${GATEWAY}/e/${chain[0]!.body.id}`);
    break;
  }
  case "split": {
    const me = await agentNamed(need("as"), true);
    const to = { publicKey: await publicKeyOf(need("to"), true), label: args.to! };
    let s: Awaited<ReturnType<Agent["split"]>>;
    try {
      s = await me.split({ to, limit: cents(need("limit")), perPayment: args.per ? cents(args.per) : undefined, payees: list(args.payees), purposes: list(args.purposes), hours: args.hours ? Number(args.hours) : undefined, splits: Number(args.splits ?? "0") });
    } catch (e) { console.error(`Refused locally: ${(e as Error).message}`); process.exit(1); }
    writeFileSync(envFile(args.to!), JSON.stringify(s.chain));
    console.log(`${args.as} gave ${args.to} a sub-envelope: ${describe(s.chain[s.chain.length - 1]!.body.caps)}`);
    console.log(s.announced ? "Announced to the gateway (the owner can see and revoke it)." : `Not announced (${s.announceError}); it is still valid.`);
    break;
  }
  case "pay": {
    const me = await agentNamed(need("as"), true);
    const amount = cents(need("amount")), payee = need("payee").trim().toLowerCase();
    const r = await attempt(() => me.pay({ amount, payee, purpose: need("purpose"), memo: args.memo, note: args.note }), "Gateway error");
    if (r.refused?.outcome === "DENIED") {
      console.log(`DENIED. Nothing was paid.`);
      printReasons(r.refused.reasons);
      process.exit(3);
    }
    const o: Pick<Payment, "status" | "duplicate" | "paypal" | "spendId"> = r.refused ? (body<SpendOutcome>(r.refused) as never) : r.ok!;
    console.log(`${o.status}: ${usd(amount.minor)} to ${payee}${o.duplicate ? " (already done; not paid twice)" : ""}`);
    if (o.paypal) console.log(paypalLine(o.paypal));
    console.log(`  Receipt: ${GATEWAY}/r/${o.spendId}`);
    break;
  }
  case "open-account": {
    // An account that can RECEIVE: signed by the agent's own key and by the owner who answers for it.
    const me = await agentNamed(need("as"));
    const owner = await ownerNamed(need("owner"), true);
    const hold = "hold" in args;
    const r = await attempt(() => me.openAccount({ owner, ownerName: args["owner-name"] ?? args.owner!, settleTo: need("settle-to"), hold, ...(args["per-payment"] ? { perPayment: cents(args["per-payment"]) } : {}) }), "Refused");
    const a = r.ok!;
    console.log(`${args.as} can now be paid as ${a.payee} (account ${a.account}). ${a.holds ? `Income stays in its balance${a.perPaymentMinor ? `; it may pay at most ${usd(a.perPaymentMinor)} at once` : ""}. Withdrawals go to ${a.settlesTo}.` : `Income settles to ${a.settlesTo}.`}`);
    break;
  }
  case "refund": {
    // The agent that was paid gives one payment back. Its balance is debited and PayPal refunds the capture to the owner who paid.
    const me = await agentNamed(need("as"));
    const id = rest[0] ?? need("payment");
    const r = await attempt(() => me.refund(id, { memo: args.memo }), "Gateway error");
    if (r.refused) {
      console.log(`${r.refused.outcome ?? "REFUSED"}. ${r.refused.outcome === "DENIED" ? "Nothing moved." : "The money is back in the balance."}`);
      printReasons(r.refused.reasons);
      process.exit(3);
    }
    const o = r.ok!;
    console.log(o.status === "REFUNDED" ? `REFUNDED: PayPal refunded the capture to the payer (refund ${o.refundId}). Balance now ${usd(o.balanceMinor ?? 0)}.` : `PENDING: the balance is debited (now ${usd(o.balanceMinor ?? 0)}); PayPal has not confirmed the refund yet and will be asked again.`);
    break;
  }
  case "transfer":
  case "withdraw": {
    // Money out of the agent's own balance: to another account, to a PayPal address, or home to its owner.
    const me = await agentNamed(need("as"));
    const amount = cents(need("amount"));
    const payee = cmd === "withdraw" ? "owner" : need("payee").trim().toLowerCase();
    const r = await attempt(() => (cmd === "withdraw" ? me.withdraw({ amount, memo: args.memo }) : me.transfer({ amount, payee, purpose: args.purpose, memo: args.memo })), "Gateway error");
    if (r.refused?.outcome === "DENIED") {
      console.log("DENIED. Nothing moved.");
      printReasons(r.refused.reasons);
      process.exit(3);
    }
    const o = r.refused ? body<TransferOutcome>(r.refused) : r.ok!;
    console.log(`${o.status}: ${usd(amount.minor)} ${cmd === "withdraw" ? "to the owner" : `to ${payee}`}${o.duplicate ? " (already done; not moved twice)" : ""}. Balance now ${usd(o.balanceMinor ?? 0)}.`);
    if (o.paypal) console.log(`  PayPal payout ${o.paypal.payoutBatchId} (${o.paypal.payoutStatus ?? "pending"})`);
    else if (o.status === "BOOKED") console.log("  Moved between accounts on the ledger; no PayPal call was needed.");
    for (const x of o.reasons ?? []) console.log(`  ${x.code}: ${x.detail}`);
    console.log(`  Transfer ${o.transferId}: ${GATEWAY}/api/bank/transfers/${o.transferId}`);
    break;
  }
  case "freeze":
  case "unfreeze": {
    const owner = await ownerNamed(need("as"));
    const agentKey = await publicKeyOf(need("agent"));
    const f = (await attempt(() => owner.freeze(agentKey, cmd === "freeze"), "Refused")).ok!;
    console.log(`${f.label}'s account is ${f.frozen ? "frozen: nothing can leave its balance" : "open again"}. Balance ${usd(f.balanceMinor)}.`);
    break;
  }
  case "card": {
    // Issue a card on this agent's balance. Nothing secret is created: only the merchant's key can charge it.
    const me = await agentNamed(need("as"));
    const every = args["every-seconds"] ? Number(args["every-seconds"]) : Math.round(Number(args["every-days"] ?? "30") * 86400);
    const c = (await attempt(() => me.issueCard({ merchant: need("merchant"), label: args.label ?? "Card", perCharge: cents(need("per-charge")), maxCharges: Number(args.charges ?? "1"), everySeconds: every, lifeSeconds: Math.round(Number(args["valid-days"] ?? "35") * 86400) }), "Refused")).ok!;
    console.log(`Card ${c.number} (${c.id}) for ${c.merchant.label}: at most ${usd(c.perChargeMinor)} a charge, ${c.maxCharges} charge(s), one per ${every} s, until ${c.notAfter}.`);
    console.log(`  Give the merchant the card id. Only ${c.merchant.label}'s key can charge it. ${GATEWAY}/api/cards/${c.id}`);
    break;
  }
  case "cards": {
    const pk = await publicKeyOf(need("as"));
    const p = await gateway.agent(pk).catch((e) => { console.error(e instanceof EnvelopeError ? said(e) : String(e)); process.exit(1); });
    if (!p.cards?.length) console.log(`${args.as} has issued no cards.`);
    for (const c of p.cards ?? []) console.log(`${c.number}  ${c.state.padEnd(9)} ${c.label} → ${c.merchant.label}: ${usd(c.perChargeMinor)} a charge, ${c.charges} of ${c.maxCharges} used, ${usd(c.chargedMinor)} charged  (${c.id})`);
    break;
  }
  case "cancel-card": {
    const who = await agentNamed(need("as"));
    const c = (await attempt(() => who.cancelCard(positional[0] ?? need("card")), "Refused")).ok!;
    console.log(`Card ${c.number} is cancelled. ${c.merchant.label} cannot charge it again. It was charged ${c.charges} time(s), ${usd(c.chargedMinor)} in all.`);
    break;
  }
  case "charge": {
    // Run by the merchant the card is locked to.
    const merchant = await agentNamed(need("as"));
    const amount = cents(need("amount"));
    const r = await attempt(() => merchant.charge({ card: need("card"), amount, memo: args.memo }), "Gateway error");
    if (r.refused?.outcome === "DENIED") {
      console.log("DECLINED. Nothing moved.");
      printReasons(r.refused.reasons);
      process.exit(3);
    }
    const o = r.refused ? body<ChargeOutcome>(r.refused) : r.ok!;
    console.log(`${o.status}: charged ${usd(amount.minor)}${o.duplicate ? " (already done; not charged twice)" : ""}. Charge ${o.card?.charges} of ${o.card?.maxCharges}.`);
    if (o.paypal) console.log(`  PayPal payout ${o.paypal.payoutBatchId} (${o.paypal.payoutStatus ?? "pending"})`);
    break;
  }
  case "balance": {
    const pk = await publicKeyOf(need("as"));
    const p = await gateway.agent(pk).catch((e) => { if (e instanceof EnvelopeError && e.kind === "gateway") return null; console.error(e instanceof EnvelopeError ? e.message : String(e)); process.exit(1); });
    if (!p?.balance) { console.error(`${args.as} has no account that keeps a balance.`); process.exit(1); }
    const b = p.balance;
    console.log(`${args.as}: ${usd(b.minor)}${b.frozen ? " · FROZEN by its owner" : ""}${b.perPaymentMinor ? ` · may pay at most ${usd(b.perPaymentMinor)} at once` : ""}`);
    for (const l of b.ledger) console.log(`  ${l.at.slice(0, 19)}Z  ${(l.deltaMinor < 0 ? "-" : "+") + usd(Math.abs(l.deltaMinor))}`.padEnd(36) + `${l.kind} ${l.counterparty ?? ""}  → ${usd(l.balanceAfterMinor)}`);
    break;
  }
  case "books": {
    const r = await gateway.books();
    console.log(`${usd(r.totals.capturedInMinor)} paid in − ${usd(r.totals.paidOutMinor)} paid out = ${usd(r.totals.balancesMinor)} held for ${r.totals.holding} account(s); ${r.totals.bookTransfers} transfer(s) between accounts.`);
    for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}`);
    for (const a of r.accounts) console.log(`  ${a.label.padEnd(24)} ${usd(a.balanceMinor).padStart(10)}  ${a.mode}${a.frozen ? " · frozen" : ""}  (${a.owner})`);
    break;
  }
  case "promise": {
    // Set money aside for a payee before work starts. Prints a note the payee can verify.
    const me = await agentNamed(need("as"), true);
    const amount = cents(need("amount")), payee = need("payee").trim().toLowerCase();
    // --release-by <public key | local key name>: that key's signed acceptance pays the promise
    const releaseBy = args["release-by"] ? (/^[A-Za-z0-9_-]{43}$/.test(args["release-by"]) ? args["release-by"] : await publicKeyOf(args["release-by"])) : undefined;
    let p: Awaited<ReturnType<Agent["setAside"]>>;
    try {
      p = await me.setAside({ amount, payee, purpose: need("purpose"), memo: args.memo, minutes: args.minutes ? Number(args.minutes) : 15, releaseBy, note: args.note });
    } catch (e) {
      if (!(e instanceof EnvelopeError)) throw e;
      const err = (e.body as { error?: string } | undefined)?.error;
      console.log(`${e.outcome ?? "ERROR"}. Nothing was set aside.${e.kind !== "gateway" ? " " + e.message : err ? " " + err : ""}`);
      printReasons(e.reasons.filter((x) => x.meaning !== undefined || e.kind === "gateway"));
      process.exit(3);
    }
    console.log(`SET ASIDE: ${usd(amount.minor)} for ${payee} until ${p.expiresAt}. Promise ${p.promiseId}`);
    console.log(`  Give the payee this note: ${p.token}`);
    console.log(`  Pay it:     agent.ts keep ${p.promiseId} --as ${args.as}`);
    console.log(`  Release it: agent.ts release ${p.promiseId} --as ${args.as}`);
    break;
  }
  case "keep":
  case "release": {
    const me = await agentNamed(need("as"));
    const id = positional[0] ?? need("promise");
    if (cmd === "release") {
      const r = await attempt(() => me.release(id, { note: args.note }), "Gateway");
      const status = r.refused ? r.refused.outcome : r.ok!.status;
      console.log(status === "LAPSED" ? "Released. The money is back in the envelope." : `Not released: the promise is ${status}.`);
      break;
    }
    const r = await attempt(() => me.keep(id, { note: args.note }), "Gateway");
    if (r.refused) {
      console.log(`${r.refused.outcome}. Nothing was paid.`);
      printReasons(r.refused.reasons);
      process.exit(3);
    }
    console.log(`${r.ok!.status}: the promise was paid${r.ok!.duplicate ? " (already done; not paid twice)" : ""}`);
    if (r.ok!.paypal) console.log(paypalLine(r.ok!.paypal));
    console.log(`  Receipt: ${GATEWAY}/r/${r.ok!.spendId}`);
    break;
  }
  case "accept": {
    // Run by the key a promise named with --release-by: "the work is delivered and accepted". Pays the promise.
    const me = await agentNamed(need("as"));
    const work = args["work-file"] ? await E.sha256(readFileSync(args["work-file"], "utf8")) : args.work ?? "";
    const r = await attempt(() => me.accept(positional[0] ?? need("promise"), { work, note: args.note }), "Gateway");
    if (r.refused) { console.log(`${r.refused.outcome}. Nothing was paid.`); printReasons(r.refused.reasons); process.exit(3); }
    console.log(`${r.ok!.status}: your acceptance released the money${r.ok!.duplicate ? " (already done; not paid twice)" : ""}${work ? `. Work fingerprint ${work.slice(0, 16)}… is on the receipt` : ""}`);
    if (r.ok!.paypal) console.log(paypalLine(r.ok!.paypal));
    console.log(`  Receipt: ${GATEWAY}/r/${r.ok!.spendId}`);
    break;
  }
  case "reference": {
    // An agent's record, signed by the gateway. Prints a token the agent can hand to anyone.
    const who = positional[0] ?? need("agent");
    const pk = /^[A-Za-z0-9_-]{43}$/.test(who) ? who : await publicKeyOf(who);
    const ref = await gateway.reference(pk).catch((e) => { console.error(e instanceof EnvelopeError ? said(e) : String(e)); process.exit(1); });
    const f = ref.facts;
    console.log(`${ref.label} · account ${ref.account} · known since ${ref.knownSince}`);
    console.log(`  ${f.paymentsSettled} payment(s) settled (${usd(f.paidMinor)}), promises kept ${f.promisesKept} of ${f.promisesKept + f.promisesLapsed}, ${f.requestsRefused} request(s) refused, paid ${f.timesPaid} time(s) (${usd(f.earnedMinor)})`);
    console.log(E.b64u(new TextEncoder().encode(JSON.stringify(ref))));
    break;
  }
  case "verify-promise": {
    // Run by the payee: is this note really from the gateway, and is the money still set aside?
    let n: PromiseNote;
    try { n = JSON.parse(new TextDecoder().decode(E.unb64u(positional[0] ?? need("note")))); } catch { console.error("That is not a promise note."); process.exit(2); }
    const c = await checkPromiseNote(gateway, n).catch(() => null);
    const signed = Boolean(c && c.signature.checks.filter((x) => !/still set aside/.test(x.name)).every((x) => x.ok));
    const live = Date.parse(n.expiresAt) > Date.now();
    console.log(`${n.agentLabel} (account ${n.account}) has ${usd(n.amount)} set aside for ${n.payee}, for ${n.purpose}`);
    console.log(`  Stands behind it: ${n.sponsors.map((x) => `${x.label} (${x.role})`).join(" → ")}`);
    console.log(`  PayPal hold ${n.paypal.authorizationId}: ${n.paypal.status} (${n.paypal.mode})`);
    console.log(`  Held until ${n.expiresAt}${live ? "" : " — EXPIRED"}. Signed by the gateway (${E.fingerprint(n.gateway)}): ${signed ? "signature valid" : "SIGNATURE INVALID"}.`);
    if (!signed || !live) process.exit(3);
    break;
  }
  case "show": {
    const me = await agentNamed(need("as"), true);
    const chain = me.envelope!;
    const leaf = chain[chain.length - 1]!.body;
    console.log(`${args.as} holds ${leaf.id} (${chain.length === 1 ? "root" : `depth ${chain.length - 1}, under ${chain.slice(0, -1).map((b) => b.body.holderLabel).join(" → ")}`}): ${describe(leaf.caps)}`);
    const a = await me.authority().catch(() => null);
    if (a && a.rootStatus !== null) for (const p of a.path) if (p.known) console.log(`  ${p.label}: ${usd(p.leftMinor ?? 0)} left of ${usd(p.limitMinor)}${p.revoked ? " — REVOKED" : ""}`);
    if (a?.rootStatus === "CLOSED") console.log("  The root envelope is CLOSED.");
    break;
  }
  case "revoke":
  case "close": {
    const me = await ownerNamed(need("as"));
    const target = envelope(need("agent"));
    const block = cmd === "close" ? target[0]!.body.id : target[target.length - 1]!.body.id;
    const r = (await attempt(() => me.revoke(block), "Refused")).ok!;
    console.log(cmd === "close" ? `Closed. PayPal released ${usd(r.root.releasedMinor ?? 0)}; ${usd(r.root.capturedMinor)} was charged.` : `Revoked ${args.agent}'s envelope and everything split from it.`);
    break;
  }
  case "hello": {
    const me = await agentNamed(need("as"), true);
    console.log((await me.introduce({ amount: cents(need("amount")), payee: need("payee"), purpose: need("purpose") })).token);
    break;
  }
  case "check": {
    let hello: E.SignedHello;
    try { hello = JSON.parse(new TextDecoder().decode(E.unb64u(positional[0] ?? need("token")))); } catch { console.error("That is not an introduction token."); process.exit(2); }
    const c = await checkIntroduction(gateway, hello).catch((e) => { console.error(`Gateway: ${e instanceof EnvelopeError ? said(e) : String(e)}`); process.exit(1); });
    const s = c.standing, signed = c.signature.ok;
    console.log(`${s.agentLabel} · account ${s.account}`);
    console.log(`  Stands behind it: ${s.sponsors.map((x) => `${x.label} (${x.role}, ${E.fingerprint(x.key)})`).join(" → ")}`);
    console.log(`  PayPal hold ${s.paypal.authorizationId ?? "none"}: ${s.paypal.status ?? "not confirmed"}${s.paypal.unusedMinor !== null ? `, ${usd(s.paypal.unusedMinor)} unused` : ""}${s.paypal.honoredUntil ? `, in PayPal's honor period until ${s.paypal.honoredUntil.slice(0, 16).replace("T", " ")} UTC` : ""} (${s.paypal.mode})`);
    console.log(`  Asked: ${usd(s.ask.amount)} to ${s.ask.payee} for ${s.ask.purpose}`);
    console.log(s.good ? `  GOOD. It can pay you up to ${usd(s.availableMinor)} in one payment right now.` : `  NOT GOOD. This payment would be refused:`);
    for (const x of s.reasons) console.log(`    ${x.code}: ${x.detail}`);
    console.log(`  Statement signed by the gateway (${E.fingerprint(s.gateway)}): ${signed ? "signature valid" : "SIGNATURE INVALID"}. Valid until ${s.validUntil}.`);
    if (!s.good || !signed) process.exit(3);
    break;
  }
  case "whois": {
    const who = positional[0] ?? need("agent");
    const pk = /^[A-Za-z0-9_-]{43}$/.test(who) ? who : await publicKeyOf(who);
    const p = await gateway.agent(pk).catch((e) => { console.error(e instanceof EnvelopeError ? said(e) : String(e)); process.exit(1); });
    console.log(`${p.label} · account ${p.account} · first seen ${p.firstSeenAt}`);
    console.log(`  Record: ${p.record.payments} payment(s), ${usd(p.record.paidMinor)} paid, ${p.record.refused} refused, ${usd(p.record.availableMinor)} available now`);
    if (p.receives) console.log(`  Can be paid as ${p.receives.payee} (answers for it: ${p.receives.owner.label}; settles to ${p.receives.settlesTo}). Earned ${usd(p.record.receivedMinor)} in ${p.record.received} payment(s).`);
    for (const a of p.accounts) console.log(`  ${a.state} · "${a.rootTitle}" · ${usd(a.availableMinor)} available of ${usd(a.caps.limit)} · behind it: ${a.sponsors.map((x) => x.label).join(" → ")}`);
    console.log(`  ${GATEWAY}/a/${pk}`);
    break;
  }
  case "receipt": {
    // A payment, looked up again: PayPal's word through the gateway, and every signature re-checked on this machine.
    const r = await getReceipt(gateway, positional[0] ?? need("spend")).catch((e) => { console.error(e instanceof EnvelopeError ? said(e) : String(e)); process.exit(1); });
    const local = await r.verify();
    const q = r.receipt.request;
    console.log(`${r.spend.status}: ${usd(q.amount)} to ${q.payee} for ${q.purpose}${r.spend.status === "PAID" ? "" : " (not delivered to the payee yet)"}`);
    console.log(`  PayPal hold ${r.receipt.paypal.authorizationId}, capture ${r.receipt.paypal.captureId}${r.receipt.paypal.payoutBatchId ? `, payout ${r.receipt.paypal.payoutBatchId} (${r.spend.payoutStatus ?? "pending"})` : ", no payout: credited to the payee agent's balance"} (${r.receipt.paypal.mode})`);
    console.log("  Checked against PayPal just now:");
    for (const c of r.paypal.checks) console.log(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}`);
    console.log("  Checked on this machine:");
    for (const c of local.checks) console.log(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}`);
    console.log(`  ${GATEWAY}/r/${r.spend.id}`);
    if (!r.paypal.ok || !local.ok) process.exit(3);
    break;
  }
  default:
    console.log("Commands: keygen, seal, split, pay, promise, keep, release, accept, verify-promise, reference, receipt, open-account, balance, transfer, withdraw, freeze, unfreeze, books, card, cards, cancel-card, charge, show, revoke, close, hello, check, whois. See the header of scripts/agent.ts.");
}
