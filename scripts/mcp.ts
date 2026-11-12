/**
 * Envelope as MCP tools for one agent (stdio, JSON-RPC 2.0), built on the SDK in ../sdk.
 *
 * The server acts as a single agent: it holds that agent's private key and envelope in ./.envelope/
 * (the same files the CLI uses) and can only do what that envelope allows. It has no tool to seal a
 * root envelope or close one: authority comes from a person, never from the agent. It never holds
 * PayPal credentials; only the gateway talks to PayPal.
 *
 *   ENVELOPE_AGENT=ops-agent GATEWAY=http://localhost:3000 npx tsx scripts/mcp.ts
 *
 * Claude Code:  claude mcp add envelope -e ENVELOPE_AGENT=ops-agent -- npx tsx scripts/mcp.ts
 *
 * Tools come in two groups. READ tools look and check; they move nothing. ACT tools sign a request
 * with the agent's key; the gateway decides whether it is allowed. Set ENVELOPE_MCP_READ_ONLY=1 to
 * serve the read tools only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Agent, EnvelopeError, Gateway, checkIntroduction, getReceipt, protocol as E, type Card, type GatewayReason, type SpendOutcome, type TransferOutcome } from "../sdk/src";

const GATEWAY = (process.env.GATEWAY ?? "http://localhost:3000").replace(/\/$/, "");
const DIR = process.env.ENVELOPE_DIR ?? ".envelope";
const AGENT = process.env.ENVELOPE_AGENT ?? "";
const READ_ONLY = process.env.ENVELOPE_MCP_READ_ONLY === "1";
if (!/^[a-z0-9][a-z0-9-]{0,40}$/i.test(AGENT)) { console.error("Set ENVELOPE_AGENT to this agent's name (letters, digits, hyphens)."); process.exit(2); }
mkdirSync(DIR, { recursive: true });
const gateway = new Gateway(GATEWAY);

class ToolError extends Error {}
/** The gateway said no on the merits. The text is for the model; the call is marked as an error. */
class Refused extends Error {}
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
const safeName = (s: unknown) => { if (typeof s !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/i.test(s)) throw new ToolError("Agent names use letters, digits and hyphens."); return s; };
const cents = (v: unknown, field: string) => { if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || Math.round(v * 100) !== Number((v * 100).toFixed(6))) throw new ToolError(`${field} must be a positive dollar amount with at most two decimals.`); return { minor: Math.round(v * 100) }; };
const strings = (v: unknown, field: string) => { if (v === undefined) return undefined; if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolError(`${field} must be a list of strings.`); return v as string[]; };
const text = (v: unknown, field: string, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new ToolError(`${field} is required (up to ${max} characters).`); return v.trim(); };
const reasonLines = (reasons: GatewayReason[] | undefined) => (reasons ?? []).map((x) => `  ${x.code}: ${x.meaning} (${x.detail})`);
const paypalLine = (p: NonNullable<SpendOutcome["paypal"]>) => `PayPal capture ${p.captureId}, ${p.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${p.payoutBatchId} (${p.payoutStatus ?? "pending"})`}`;

const keyFile = (name: string) => `${DIR}/${name}.key.json`;
const envFile = (name: string) => `${DIR}/${name}.envelope.json`;
/** This agent, read from disk for each call: another process may have split a new envelope for it since the last one. */
async function me(needEnvelope = false): Promise<Agent> {
  if (!existsSync(keyFile(AGENT))) throw new ToolError(`No key for "${AGENT}" on this machine.`);
  const envelope = existsSync(envFile(AGENT)) ? (JSON.parse(readFileSync(envFile(AGENT), "utf8")) as E.Envelope) : null;
  if (needEnvelope && !envelope) throw new ToolError(`${AGENT} holds no envelope yet. Someone has to seal one for it, or split one off for it.`);
  return Agent.fromJSON({ label: AGENT, key: JSON.parse(readFileSync(keyFile(AGENT), "utf8")), envelope }, { gateway });
}
/** The public key of another agent on this machine, creating its key if it has none. Only the public half is used here. */
async function publicKeyFor(name: string): Promise<string> {
  if (existsSync(keyFile(name))) return (await E.importPrivateJwk(JSON.parse(readFileSync(keyFile(name), "utf8")))).publicKey;
  const kp = await E.generateKeyPair();
  writeFileSync(keyFile(name), JSON.stringify(await E.exportPrivateJwk(kp.privateKey)), { mode: 0o600 });
  return kp.publicKey;
}
const describe = (c: E.Caps) =>
  `up to ${usd(c.limit)} in total, at most ${usd(c.perPayment)} per payment, payees: ${c.payees ? c.payees.join(", ") : "any"}, purposes: ${c.purposes ? c.purposes.join(", ") : "any"}, expires ${c.notAfter}, ${c.splits > 0 ? `may be split ${c.splits} more time(s)` : "may not be split"}`;

/**
 * Run an SDK call that the gateway answers with a verdict. A verdict that means "this did not
 * happen" comes back as `refused` with the gateway's own answer; anything else unexpected is a ToolError.
 */
async function attempt<T>(call: () => Promise<T>, prefix = "Gateway error"): Promise<{ ok: T; refused?: undefined } | { ok?: undefined; refused: { outcome: string; reasons: GatewayReason[]; body: Record<string, unknown> } }> {
  try { return { ok: await call() }; } catch (e) {
    if (!(e instanceof EnvelopeError)) throw e;
    if (e.kind === "local") throw new ToolError(e.message);
    if (e.outcome) return { refused: { outcome: e.outcome, reasons: e.reasons, body: (e.body ?? {}) as Record<string, unknown> } };
    throw new ToolError(`${prefix}: ${e.kind === "network" ? e.message : e.detail}`);
  }
}
/** The lines every paid-or-not answer shares. */
function settled(head: string, o: { paypal: SpendOutcome["paypal"]; spendId: string | null }): string {
  const lines = [head];
  if (o.paypal) lines.push(paypalLine(o.paypal));
  lines.push(`Receipt: ${GATEWAY}/r/${o.spendId}`);
  return lines.join("\n");
}

type Args = Record<string, unknown>;
type Tool = { name: string; description: string; inputSchema: object; run: (a: Args) => Promise<string> };
const NONE = { type: "object", properties: {}, additionalProperties: false };

// ─────────────────────────────────────────── READ: look and check; nothing moves ───────────────────────────────────────────
const READ_TOOLS: Tool[] = [
  {
    name: "envelope_show",
    description: "Show the spending envelope this agent holds: its limits, allowed payees and purposes, expiry, how much is left at every level above it, and whether it has been revoked. Call this before paying or splitting.",
    inputSchema: NONE,
    async run() {
      const agent = await me(true);
      const a = await agent.authority();
      const chain = agent.envelope!;
      const lines = [`${AGENT} holds ${a.envelope} (${chain.length === 1 ? "root" : `under ${chain.slice(0, -1).map((b) => b.body.holderLabel).join(" → ")}`}): ${describe(a.caps)}`];
      if (a.rootStatus === null) lines.push("The gateway could not be reached, so remaining budgets are unknown.");
      else for (const p of a.path) if (p.known) lines.push(`  ${p.label}: ${usd(p.leftMinor ?? 0)} left of ${usd(p.limitMinor)}${p.revoked ? " (REVOKED)" : ""}`);
      if (a.rootStatus === "CLOSED") lines.push("The root envelope is CLOSED: nothing more can be spent.");
      return lines.join("\n");
    },
  },
  {
    name: "envelope_balance",
    description: "Show the balance of THIS agent's own account (money it has earned and kept), whether its owner has frozen it, the most it may pay at once, and its recent ledger. Call this before sending money from the balance.",
    inputSchema: NONE,
    async run() {
      const p = await (await me()).profile();
      if (!p?.balance) return `${AGENT} has no account that keeps a balance. Its owner opens one with: agent.ts open-account --hold.`;
      const b = p.balance;
      return [`Balance ${usd(b.minor)}${b.frozen ? " (FROZEN by the owner: nothing can leave)" : ""}${b.perPaymentMinor ? `; at most ${usd(b.perPaymentMinor)} per payment` : ""}. You are paid as ${p.receives!.payee}.`, ...b.ledger.slice(0, 12).map((l) => `${l.deltaMinor < 0 ? "-" : "+"}${usd(Math.abs(l.deltaMinor))} ${l.kind} ${l.counterparty ?? ""} → ${usd(l.balanceAfterMinor)}`)].join("\n");
    },
  },
  {
    name: "envelope_card_list",
    description: "List the cards THIS agent has issued: which merchant each is locked to, its limits, how many charges have been used, and whether it is active, ended, cancelled or expired. Use it to decide whether a subscription should be cancelled before the next charge.",
    inputSchema: NONE,
    async run() {
      const list = await (await me()).cards();
      if (!list.length) return `${AGENT} has issued no cards.`;
      return list.map((c: Card) => `${c.id} · ${c.number} · ${c.state} · ${c.label} → ${c.merchant.label}: ${usd(c.perChargeMinor)} a charge, ${c.charges} of ${c.maxCharges} used (${usd(c.chargedMinor)})${c.nextChargeFrom ? `, next charge allowed from ${c.nextChargeFrom}` : ""}, valid until ${c.notAfter}`).join("\n");
    },
  },
  {
    name: "envelope_introduce",
    description: "Introduce this agent to a payee before any work is done. Returns a token the payee (or its agent) can check to learn who stands behind this agent and whether a payment of this size to them would go through. Moves no money and cannot be reused as a payment.",
    inputSchema: {
      type: "object",
      properties: {
        payee: { type: "string", description: "The payee's PayPal email" },
        amount: { type: "number", description: "The amount you expect to pay, in dollars" },
        purpose: { type: "string", description: "One of the envelope's allowed purposes" },
      },
      required: ["payee", "amount", "purpose"],
      additionalProperties: false,
    },
    async run(a) {
      return (await (await me(true)).introduce({ amount: cents(a.amount, "amount"), payee: text(a.payee, "payee", 254), purpose: text(a.purpose, "purpose", 60) })).token;
    },
  },
  {
    name: "envelope_check_agent",
    description: "Check an introduction token another agent gave you before you do work for it. The gateway confirms the agent controls its key, names who stands behind it back to a person, asks PayPal whether the hold is still there, and says whether the payment it proposed would be accepted right now. The answer is signed and expires after five minutes.",
    inputSchema: { type: "object", properties: { token: { type: "string", description: "The introduction token" } }, required: ["token"], additionalProperties: false },
    async run(a) {
      const token = text(a.token, "token", 20000);
      let hello: E.SignedHello;
      try { hello = JSON.parse(new TextDecoder().decode(E.unb64u(token))); } catch { throw new ToolError("That is not an introduction token."); }
      let c: Awaited<ReturnType<typeof checkIntroduction>>;
      try { c = await checkIntroduction(gateway, hello); } catch (e) { throw new ToolError(`Gateway: ${e instanceof EnvelopeError ? (e.kind === "network" ? e.message : e.detail) : (e as Error).message}`); }
      const s = c.standing;
      return [
        `${s.agentLabel}, account ${s.account}`,
        `Stands behind it: ${s.sponsors.map((x) => `${x.label} (${x.role})`).join(" → ")}`,
        `PayPal hold ${s.paypal.authorizationId ?? "none"}: ${s.paypal.status ?? "not confirmed"}${s.paypal.unusedMinor !== null ? `, ${usd(s.paypal.unusedMinor)} unused` : ""} (${s.paypal.mode})`,
        `Asked: ${usd(s.ask.amount)} to ${s.ask.payee} for ${s.ask.purpose}`,
        s.good ? `GOOD: it can pay up to ${usd(s.availableMinor)} in one payment right now.` : `NOT GOOD: this payment would be refused. ${s.reasons.map((x) => `${x.code} (${x.detail})`).join("; ")}`,
        `Gateway signature: ${c.signature.ok ? "valid" : "INVALID, do not rely on this"}. Valid until ${s.validUntil}.`,
      ].join("\n");
    },
  },
  {
    name: "envelope_receipt",
    description: "Look up a payment by its id: where it stands with PayPal right now, and whether its receipt holds up. The gateway compares the receipt with PayPal's own records, and every signature on it (the owner's, each agent's, the gateway's) is checked again on this machine. UNCLAIMED or PAYOUT_PENDING means the payee has NOT received the money yet.",
    inputSchema: { type: "object", properties: { spend: { type: "string", description: "The payment id (sp_… or pr_…), as printed after a payment" } }, required: ["spend"], additionalProperties: false },
    async run(a) {
      let r: Awaited<ReturnType<typeof getReceipt>>;
      try { r = await getReceipt(gateway, text(a.spend, "spend", 60)); } catch (e) { throw new ToolError(`Gateway: ${e instanceof EnvelopeError ? (e.kind === "network" ? e.message : e.detail) : (e as Error).message}`); }
      const local = await r.verify();
      const req = r.receipt.request;
      return [
        `${r.spend.status}: ${usd(req.amount)} to ${req.payee} for ${req.purpose}${r.spend.status === "PAID" ? "" : " (not delivered to the payee yet)"}`,
        `PayPal hold ${r.receipt.paypal.authorizationId}, capture ${r.receipt.paypal.captureId}${r.receipt.paypal.payoutBatchId ? `, payout ${r.receipt.paypal.payoutBatchId} (${r.spend.payoutStatus ?? "pending"})` : ", no payout: credited to the payee agent's balance"} (${r.receipt.paypal.mode})`,
        `Checked against PayPal just now: ${r.paypal.ok ? "all checks pass" : `MISMATCH: ${r.paypal.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`}`,
        `Signatures checked on this machine: ${local.ok ? "all valid" : `INVALID: ${local.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`}`,
        `Authorized by: ${r.receipt.chain.map((c) => c.holderLabel).join(" → ")}, under the owner key ${E.fingerprint(r.receipt.principal)}`,
        `${GATEWAY}/r/${r.spend.id}`,
      ].join("\n");
    },
  },
];

// ─────────────────────────────────────────── ACT: sign a request; the gateway decides ───────────────────────────────────────────
const ACT_TOOLS: Tool[] = [
  {
    name: "envelope_split",
    description: "Give another agent a smaller envelope cut from this agent's own. It can only narrow: a lower total, a lower per-payment cap, a subset of the payees and purposes, an earlier expiry. Give the least the other agent needs. The other agent's key is created on this machine if it has none.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Name of the agent receiving the sub-envelope" },
        limit: { type: "number", description: "Total it may spend, in dollars" },
        per_payment: { type: "number", description: "Most it may spend in one payment, in dollars (default: the total)" },
        payees: { type: "array", items: { type: "string" }, description: "PayPal emails it may pay (default: the same as this envelope)" },
        purposes: { type: "array", items: { type: "string" }, description: "Purposes it may pay for (default: the same as this envelope)" },
        hours: { type: "number", description: "Hours until it expires (default: when this envelope expires)" },
        splits: { type: "integer", description: "How many further levels it may split (default 0)" },
      },
      required: ["to", "limit"],
      additionalProperties: false,
    },
    async run(a) {
      const toName = safeName(a.to);
      if (toName === AGENT) throw new ToolError("An agent cannot split an envelope for itself.");
      const agent = await me(true);
      const limit = cents(a.limit, "limit");
      const perPayment = a.per_payment === undefined ? undefined : cents(a.per_payment, "per_payment");
      const payees = strings(a.payees, "payees"), purposes = strings(a.purposes, "purposes");
      const to = { publicKey: await publicKeyFor(toName), label: toName };
      let s: Awaited<ReturnType<Agent["split"]>>;
      try {
        s = await agent.split({ to, limit, perPayment, payees, purposes, hours: a.hours === undefined ? undefined : Number(a.hours), splits: a.splits === undefined ? 0 : Number(a.splits) });
      } catch (e) { throw new ToolError(`Refused: ${(e as Error).message}`); }
      writeFileSync(envFile(toName), JSON.stringify(s.chain));
      return `${AGENT} gave ${toName} a sub-envelope: ${describe(s.chain[s.chain.length - 1]!.body.caps)}\n${s.announced ? "Announced to the gateway, so the owner can see and revoke it." : `Not announced (${s.announceError}); it is still valid.`}`;
    },
  },
  {
    name: "envelope_pay",
    description: "Pay a payee from this agent's envelope. The gateway checks the request against the envelope and every envelope above it; if it is allowed, PayPal captures the amount from the owner's hold and pays the payee. A denial moves no money and says why. Sending the same request again never pays twice.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in dollars" },
        payee: { type: "string", description: "The payee: a PayPal email, or an agent's account written as acct:xxxx-xxxx-xxxx" },
        purpose: { type: "string", description: "One of the envelope's allowed purposes" },
        memo: { type: "string", description: "What the payment is for (shown to the payee)" },
        note: { type: "string", description: "Why you are making this payment (shown to the owner; never used to decide)" },
      },
      required: ["amount", "payee", "purpose"],
      additionalProperties: false,
    },
    async run(a) {
      const amount = cents(a.amount, "amount"), payee = text(a.payee, "payee", 254);
      const agent = await me(true);
      const r = await attempt(() => agent.pay({ amount, payee, purpose: text(a.purpose, "purpose", 60), memo: typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined, note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined }));
      if (r.refused?.outcome === "DENIED") throw new Refused(["DENIED. Nothing was paid.", ...reasonLines(r.refused.reasons)].join("\n"));
      const o = r.refused ? (r.refused.body as unknown as SpendOutcome) : r.ok;
      const out = settled(`${o.status}: ${usd(amount.minor)} to ${payee.toLowerCase()}${o.duplicate ? " (already done; not paid twice)" : ""}`, o);
      if (r.refused) throw new Refused(out);
      return out;
    },
  },
  {
    name: "envelope_promise",
    description: "Set money aside for a payee BEFORE any work is done, so the payee knows it is there. The amount is reserved in this envelope and every envelope above it, PayPal confirms the hold, and nothing else can spend it until you pay it (envelope_keep) or it runs out. Returns a promise id and a signed note to hand to the payee. Moves no money.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in dollars" },
        payee: { type: "string", description: "The payee: a PayPal email, or an agent's account written as acct:xxxx-xxxx-xxxx" },
        purpose: { type: "string", description: "One of the envelope's allowed purposes" },
        minutes: { type: "number", description: "How long to hold it (1 to 60 minutes, default 15)" },
        release_by: { type: "string", description: "Optional public key of an agent whose signed acceptance of the work pays this promise without asking you again (the payee for paid-on-delivery, or a checker you both accept)" },
        memo: { type: "string", description: "What the payment will be for" },
        note: { type: "string", description: "Why you are setting this aside (shown to the owner; never used to decide)" },
      },
      required: ["amount", "payee", "purpose"],
      additionalProperties: false,
    },
    async run(a) {
      const minutes = typeof a.minutes === "number" && a.minutes >= 1 && a.minutes <= 60 ? a.minutes : 15;
      const amount = cents(a.amount, "amount"), payee = text(a.payee, "payee", 254);
      const agent = await me(true);
      const r = await attempt(() => agent.setAside({ amount, payee, purpose: text(a.purpose, "purpose", 60), memo: typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined, minutes, releaseBy: typeof a.release_by === "string" && /^[A-Za-z0-9_-]{43}$/.test(a.release_by) ? a.release_by : undefined, note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined }));
      if (r.refused) throw new Refused([`${r.refused.outcome}. Nothing was set aside.`, ...reasonLines(r.refused.reasons)].join("\n"));
      return [`SET ASIDE: ${usd(amount.minor)} for ${payee.toLowerCase()} until ${r.ok.expiresAt}.`, `Promise id: ${r.ok.promiseId}`, `Note for the payee: ${r.ok.token}`].join("\n");
    },
  },
  {
    name: "envelope_keep",
    description: "Pay a promise this agent made earlier (PayPal captures from the hold and pays the payee), or release it so the money returns to the envelope. Paying twice pays once.",
    inputSchema: {
      type: "object",
      properties: {
        promise: { type: "string", description: "The promise id returned by envelope_promise" },
        action: { type: "string", enum: ["pay", "release"], description: "pay (default) or release" },
        note: { type: "string", description: "Why (shown to the owner; never used to decide)" },
      },
      required: ["promise"],
      additionalProperties: false,
    },
    async run(a) {
      const promise = text(a.promise, "promise", 60), note = typeof a.note === "string" ? a.note.slice(0, 500) : undefined;
      const agent = await me();
      if (a.action === "release") {
        const r = await attempt(() => agent.release(promise, { note }));
        if (r.refused) throw new Refused(`Not released: the promise is ${r.refused.outcome}.`);
        return r.ok.released ? "Released. The money is back in the envelope." : `Not released: the promise is ${r.ok.status}.`;
      }
      const r = await attempt(() => agent.keep(promise, { note }));
      if (r.refused) throw new Refused([`${r.refused.outcome}. Nothing was paid.`, ...reasonLines(r.refused.reasons)].join("\n"));
      return settled(`${r.ok.status}: the promise was paid${r.ok.duplicate ? " (already done; not paid twice)" : ""}`, r.ok);
    },
  },
  {
    name: "envelope_accept",
    description: "Sign that work has been delivered and accepted, for a promise that named THIS agent's key as the one that can release it. Your signature pays the promise: PayPal captures from the hold and pays the payee. Include a fingerprint of the work so it is recorded on the receipt.",
    inputSchema: {
      type: "object",
      properties: {
        promise: { type: "string", description: "The promise id" },
        work: { type: "string", description: "SHA-256 fingerprint (64 hex characters) of what was delivered, if you have one" },
        note: { type: "string", description: "What you checked (recorded on the receipt)" },
      },
      required: ["promise"],
      additionalProperties: false,
    },
    async run(a) {
      const work = typeof a.work === "string" && /^[0-9a-f]{64}$/.test(a.work) ? a.work : undefined;
      const agent = await me();
      const r = await attempt(() => agent.accept(text(a.promise, "promise", 60), { work, note: typeof a.note === "string" ? a.note.slice(0, 200) : undefined }), "Gateway");
      if (r.refused) throw new Refused([`${r.refused.outcome}. Nothing was paid.`, ...reasonLines(r.refused.reasons)].join("\n"));
      return settled(`${r.ok.status}: your acceptance released the money${r.ok.duplicate ? " (already done; not paid twice)" : ""}`, r.ok);
    },
  },
  {
    name: "envelope_transfer",
    description: "Send money out of THIS agent's own balance. To another agent's account (payee \"acct:xxxx-xxxx-xxxx\") it moves at once on the ledger. To a PayPal address it leaves as a PayPal payout. With withdraw: true it goes to the owner's PayPal address and no payee is needed. The gateway refuses it if the balance is too low, the account is frozen, or the amount is over what the owner allows at once. You cannot spend more than the balance.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Dollars, e.g. 12 or 12.50" },
        payee: { type: "string", description: "acct:xxxx-xxxx-xxxx or a PayPal email address. Leave out when withdraw is true." },
        withdraw: { type: "boolean", description: "Send it home to the owner instead of paying someone" },
        purpose: { type: "string", description: "One or two words, e.g. proofreading" },
        memo: { type: "string", description: "What this is for" },
      },
      required: ["amount"],
      additionalProperties: false,
    },
    async run(a) {
      const agent = await me();
      const amount = cents(a.amount, "amount");
      const memo = typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined;
      const payee = a.withdraw === true ? "" : text(a.payee, "payee", 127);
      const r = await attempt(() => (a.withdraw === true ? agent.withdraw({ amount, memo }) : agent.transfer({ amount, payee, purpose: typeof a.purpose === "string" ? a.purpose.slice(0, 60) : undefined, memo })));
      if (r.refused?.outcome === "DENIED") throw new Refused(`DENIED. Nothing moved. ${r.refused.reasons.map((x) => `${x.code}: ${x.meaning} (${x.detail})`).join("; ")}`);
      const o = r.refused ? (r.refused.body as unknown as TransferOutcome) : r.ok;
      const out = `${o.status}: ${usd(amount.minor)} ${a.withdraw === true ? "to the owner" : `to ${payee.toLowerCase()}`}${o.duplicate ? " (already done; not moved twice)" : ""}. Balance now ${usd(o.balanceMinor ?? 0)}.${o.paypal ? ` PayPal payout ${o.paypal.payoutBatchId} (${o.paypal.payoutStatus ?? "pending"}).` : o.status === "BOOKED" ? " Moved on the ledger; no PayPal call." : ""} Transfer ${o.transferId}.`;
      if (r.refused) throw new Refused(out);
      return out;
    },
  },
  {
    name: "envelope_refund",
    description: "Give back, in full, one payment THIS agent received and kept in its balance (for example when it will not do the work after all). The balance is debited and PayPal refunds the capture to the person who paid. Only possible while the money is still in the balance. It cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        payment: { type: "string", description: "The payment's id, e.g. sp_… or pr_… (see envelope_balance for income entries)" },
        memo: { type: "string", description: "Why it is being returned" },
      },
      required: ["payment"],
      additionalProperties: false,
    },
    async run(a) {
      const agent = await me();
      const r = await attempt(() => agent.refund(text(a.payment, "payment", 60), { memo: typeof a.memo === "string" ? a.memo.slice(0, 140) : undefined }));
      if (r.refused) throw new Refused(`${r.refused.outcome ?? "REFUSED"}. ${r.refused.outcome === "DENIED" ? "Nothing moved." : "The money is back in the balance."} ${r.refused.reasons.map((x) => `${x.code}: ${x.meaning ?? ""} (${x.detail})`).join("; ")}`);
      const o = r.ok!;
      return o.status === "REFUNDED" ? `REFUNDED: PayPal refunded the capture to the payer (refund ${o.refundId}). Balance now ${usd(o.balanceMinor ?? 0)}.` : `PENDING: the balance is debited (now ${usd(o.balanceMinor ?? 0)}); PayPal has not confirmed the refund yet and will be asked again.`;
    },
  },
  {
    name: "envelope_card_issue",
    description: "Issue a card on THIS agent's own balance so that ONE merchant can charge it: for a subscription or a metered service. You set the most it may take per charge, how many charges it allows in total, the least time between charges (the billing period) and how long the card lives. When the charges are used up or the date passes, the card ends by itself: to subscribe for two months, allow two charges. Only the merchant's own key can charge it, so the card's details are not a secret. No one's bank card is involved. The merchant must have an account (acct:xxxx-xxxx-xxxx).",
    inputSchema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "The merchant's account, acct:xxxx-xxxx-xxxx" },
        label: { type: "string", description: "What it is for, e.g. the service's name" },
        per_charge: { type: "number", description: "Most it may take per charge, in dollars" },
        charges: { type: "number", description: "How many charges it allows in total, e.g. 2 for two months" },
        every_days: { type: "number", description: "Least days between charges, e.g. 30. Default 30." },
        valid_days: { type: "number", description: "Days until the card expires. Default: enough for all charges plus a week." },
      },
      required: ["merchant", "label", "per_charge", "charges"],
      additionalProperties: false,
    },
    async run(a) {
      const agent = await me();
      const charges = typeof a.charges === "number" && Number.isInteger(a.charges) && a.charges >= 1 ? a.charges : 1;
      const everyDays = typeof a.every_days === "number" && a.every_days >= 0 ? a.every_days : 30;
      const validDays = typeof a.valid_days === "number" && a.valid_days > 0 ? a.valid_days : everyDays * charges + 7;
      const merchant = text(a.merchant, "merchant", 40), label = text(a.label, "label", 60), perCharge = cents(a.per_charge, "per_charge");
      let c: Card;
      try { c = await agent.issueCard({ merchant, label, perCharge, maxCharges: charges, everySeconds: Math.round(everyDays * 86400), lifeSeconds: Math.round(validDays * 86400) }); }
      catch (e) { throw new ToolError(`Refused: ${e instanceof EnvelopeError ? (e.kind === "gateway" ? e.detail : e.message) : (e as Error).message}`); }
      return `Card ${c.number} (id ${c.id}) issued for ${c.merchant.label}: at most ${usd(c.perChargeMinor)} a charge, ${c.maxCharges} charge(s), one per ${everyDays} day(s), valid until ${c.notAfter}. Give the merchant the card id. It will end by itself; cancel it earlier with envelope_card_cancel.`;
    },
  },
  {
    name: "envelope_card_cancel",
    description: "Cancel a card THIS agent issued, for example to end a subscription before the next charge. The merchant can never charge it again. It cannot be undone; issue a new card to resubscribe.",
    inputSchema: { type: "object", properties: { card: { type: "string", description: "The card id (card_…)" } }, required: ["card"], additionalProperties: false },
    async run(a) {
      const agent = await me();
      let c: Card;
      try { c = await agent.cancelCard(text(a.card, "card", 60)); }
      catch (e) { if (e instanceof ToolError) throw e; throw new ToolError(`Refused: ${e instanceof EnvelopeError ? (e.kind === "gateway" ? e.detail : e.message) : (e as Error).message}`); }
      return `Card ${c.number} is cancelled. ${c.merchant.label} cannot charge it again. It was charged ${c.charges} time(s), ${usd(c.chargedMinor)} in all.`;
    },
  },
];

/** What a client may assume about a tool without calling it (MCP tool annotations). */
const READ = new Set(READ_TOOLS.map((t) => t.name));
const IRREVERSIBLE = new Set(["envelope_pay", "envelope_keep", "envelope_accept", "envelope_transfer", "envelope_refund", "envelope_card_cancel"]);
const annotations = (name: string) => (READ.has(name)
  ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  : { readOnlyHint: false, destructiveHint: IRREVERSIBLE.has(name), idempotentHint: false, openWorldHint: true });
const TOOLS: Tool[] = READ_ONLY ? READ_TOOLS : [...READ_TOOLS, ...ACT_TOOLS];

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");
async function handle(m: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }) {
  const reply = (result: object) => { if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result }); };
  const fail = (code: number, message: string) => { if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code, message } }); };
  switch (m.method) {
    case "initialize":
      return reply({ protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "envelope", version: "1.1.0" }, instructions: `You are acting as "${AGENT}". You can spend only what your envelope allows; call envelope_show first.${READ_ONLY ? " This server is read-only: it can look and check, not pay." : ""}` });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: annotations(name) })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(m.params?.name)}`);
      try {
        return reply({ content: [{ type: "text", text: await tool.run((m.params?.arguments ?? {}) as Args) }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e instanceof ToolError || e instanceof Refused ? e.message : `Unexpected error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (m.id !== undefined) fail(-32601, `Method not found: ${m.method}`);
  }
}

// One request at a time, in arrival order: a pay must not overtake the split before it.
let queue: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let m: Parameters<typeof handle>[0];
  try { m = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  queue = queue.then(() => handle(m)).catch((e) => { console.error(e); });
});
