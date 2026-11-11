/**
 * Envelope as MCP tools for one agent (stdio, JSON-RPC 2.0, no dependencies).
 *
 * The server acts as a single agent: it holds that agent's private key and envelope in ./.envelope/
 * (the same files the CLI uses) and can only do what that envelope allows. It has no tool to seal a
 * root envelope or close one: authority comes from a person, never from the agent.
 *
 *   ENVELOPE_AGENT=ops-agent GATEWAY=http://localhost:3000 npx tsx scripts/mcp.ts
 *
 * Claude Code:  claude mcp add envelope -e ENVELOPE_AGENT=ops-agent -- npx tsx scripts/mcp.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import * as E from "../lib/envelope/core";

const GATEWAY = (process.env.GATEWAY ?? "http://localhost:3000").replace(/\/$/, "");
const DIR = process.env.ENVELOPE_DIR ?? ".envelope";
const AGENT = process.env.ENVELOPE_AGENT ?? "";
if (!/^[a-z0-9][a-z0-9-]{0,40}$/i.test(AGENT)) { console.error("Set ENVELOPE_AGENT to this agent's name (letters, digits, hyphens)."); process.exit(2); }
mkdirSync(DIR, { recursive: true });

class ToolError extends Error {}
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
const safeName = (s: unknown) => { if (typeof s !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/i.test(s)) throw new ToolError("Agent names use letters, digits and hyphens."); return s; };
const cents = (v: unknown, field: string) => { if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || Math.round(v * 100) !== Number((v * 100).toFixed(6))) throw new ToolError(`${field} must be a positive dollar amount with at most two decimals.`); return Math.round(v * 100); };
const strings = (v: unknown, field: string) => { if (v === undefined) return undefined; if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolError(`${field} must be a list of strings.`); return v as string[]; };
const text = (v: unknown, field: string, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new ToolError(`${field} is required (up to ${max} characters).`); return v.trim(); };

async function key(name: string, create: boolean): Promise<E.KeyPair> {
  const f = `${DIR}/${name}.key.json`;
  if (existsSync(f)) return E.importPrivateJwk(JSON.parse(readFileSync(f, "utf8")));
  if (!create) throw new ToolError(`No key for "${name}" on this machine.`);
  const kp = await E.generateKeyPair();
  writeFileSync(f, JSON.stringify(await E.exportPrivateJwk(kp.privateKey)), { mode: 0o600 });
  return kp;
}
const envFile = (name: string) => `${DIR}/${name}.envelope.json`;
function envelope(): E.Envelope {
  if (!existsSync(envFile(AGENT))) throw new ToolError(`${AGENT} holds no envelope yet. Someone has to seal one for it, or split one off for it.`);
  return JSON.parse(readFileSync(envFile(AGENT), "utf8"));
}
async function post(path: string, body: unknown) {
  const r = await fetch(`${GATEWAY}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const describe = (c: E.Caps) =>
  `up to ${usd(c.limit)} in total, at most ${usd(c.perPayment)} per payment, payees: ${c.payees ? c.payees.join(", ") : "any"}, purposes: ${c.purposes ? c.purposes.join(", ") : "any"}, expires ${c.notAfter}, ${c.splits > 0 ? `may be split ${c.splits} more time(s)` : "may not be split"}`;

type Args = Record<string, unknown>;
const TOOLS: Array<{ name: string; description: string; inputSchema: object; run: (a: Args) => Promise<string> }> = [
  {
    name: "envelope_show",
    description: "Show the spending envelope this agent holds: its limits, allowed payees and purposes, expiry, how much is left at every level above it, and whether it has been revoked. Call this before paying or splitting.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const chain = envelope();
      const leaf = chain[chain.length - 1]!.body;
      const lines = [`${AGENT} holds ${leaf.id} (${chain.length === 1 ? "root" : `under ${chain.slice(0, -1).map((b) => b.body.holderLabel).join(" → ")}`}): ${describe(leaf.caps)}`];
      const r = (await fetch(`${GATEWAY}/api/envelopes/${chain[0]!.body.id}`).then((x) => x.json()).catch(() => null)) as { blocks?: Array<{ id: string; holderLabel: string; caps: E.Caps; spentMinor: number; reservedMinor: number; revokedAt: string | null }>; root?: { status: string } } | null;
      if (!r?.blocks) lines.push("The gateway could not be reached, so remaining budgets are unknown.");
      else for (const b of chain) { const row = r.blocks.find((x) => x.id === b.body.id); if (row) lines.push(`  ${row.holderLabel}: ${usd(row.caps.limit - row.spentMinor - row.reservedMinor)} left of ${usd(row.caps.limit)}${row.revokedAt ? " (REVOKED)" : ""}`); }
      if (r?.root && r.root.status !== "ACTIVE") lines.push("The root envelope is CLOSED: nothing more can be spent.");
      return lines.join("\n");
    },
  },
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
      const me = await key(AGENT, false);
      const to = await key(toName, true);
      const mine = envelope();
      const parent = mine[mine.length - 1]!.body.caps;
      const limit = cents(a.limit, "limit");
      let chain: E.Envelope;
      try {
        chain = await E.split(mine, me, { publicKey: to.publicKey, label: toName }, {
          currency: parent.currency, limit,
          perPayment: a.per_payment === undefined ? Math.min(limit, parent.perPayment) : cents(a.per_payment, "per_payment"),
          payees: strings(a.payees, "payees") ?? parent.payees,
          purposes: strings(a.purposes, "purposes") ?? parent.purposes,
          notAfter: a.hours === undefined ? parent.notAfter : new Date(Date.now() + Number(a.hours) * 3600_000).toISOString(),
          splits: a.splits === undefined ? 0 : Number(a.splits),
        });
      } catch (e) { throw new ToolError(`Refused: ${(e as Error).message}`); }
      writeFileSync(envFile(toName), JSON.stringify(chain));
      const r = await post("/api/gateway/announce", { chain });
      return `${AGENT} gave ${toName} a sub-envelope: ${describe(chain[chain.length - 1]!.body.caps)}\n${r.status === 200 ? "Announced to the gateway, so the owner can see and revoke it." : `Not announced (${r.json.error ?? r.status}); it is still valid.`}`;
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
      const me = await key(AGENT, false);
      const signed = await E.signSpend(envelope(), me, { amount: cents(a.amount, "amount"), payee: text(a.payee, "payee", 254), purpose: text(a.purpose, "purpose", 60), memo: typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined });
      const r = await post("/api/gateway/spend", { signed, note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined });
      if (r.json.status === "DENIED") return ["DENIED. Nothing was paid.", ...(r.json.reasons ?? []).map((x: { code: string; meaning: string; detail: string }) => `  ${x.code}: ${x.meaning} (${x.detail})`)].join("\n");
      if (!r.json.status) throw new ToolError(`Gateway error: ${r.json.error ?? r.status}`);
      const lines = [`${r.json.status}: ${usd(signed.request.amount)} to ${signed.request.payee}${r.json.duplicate ? " (already done; not paid twice)" : ""}`];
      if (r.json.paypal) lines.push(`PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
      lines.push(`Receipt: ${GATEWAY}/r/${r.json.spendId}`);
      return lines.join("\n");
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
      const signed = await E.signPromise(envelope(), await key(AGENT, false), { amount: cents(a.amount, "amount"), payee: text(a.payee, "payee", 254), purpose: text(a.purpose, "purpose", 60), memo: typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined, ttl: Math.round(minutes * 60), releaseBy: typeof a.release_by === "string" && /^[A-Za-z0-9_-]{43}$/.test(a.release_by) ? a.release_by : undefined });
      const r = await post("/api/gateway/promise", { signed, note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined });
      if (r.json.status !== "PROMISED") {
        if (!r.json.status) throw new ToolError(`Gateway error: ${r.json.error ?? r.status}`);
        return [`${r.json.status}. Nothing was set aside.`, ...(r.json.reasons ?? []).map((x: { code: string; meaning: string; detail: string }) => `  ${x.code}: ${x.meaning} (${x.detail})`)].join("\n");
      }
      return [`SET ASIDE: ${usd(signed.request.amount)} for ${signed.request.payee} until ${r.json.expiresAt}.`, `Promise id: ${r.json.promiseId}`, `Note for the payee: ${E.b64u(new TextEncoder().encode(JSON.stringify(r.json.note)))}`].join("\n");
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
      const action = a.action === "release" ? "release" : "pay";
      const r = await post("/api/gateway/keep", { signed: await E.signKeep(await key(AGENT, false), text(a.promise, "promise", 60), action), note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined });
      if (!r.json.status) throw new ToolError(`Gateway error: ${r.json.error ?? r.status}`);
      if (action === "release") return r.json.status === "LAPSED" ? "Released. The money is back in the envelope." : `Not released: the promise is ${r.json.status}.`;
      if (["LAPSED", "DENIED", "FAILED"].includes(r.json.status)) return [`${r.json.status}. Nothing was paid.`, ...(r.json.reasons ?? []).map((x: { code: string; meaning: string; detail: string }) => `  ${x.code}: ${x.meaning} (${x.detail})`)].join("\n");
      const lines = [`${r.json.status}: the promise was paid${r.json.duplicate ? " (already done; not paid twice)" : ""}`];
      if (r.json.paypal) lines.push(`PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
      lines.push(`Receipt: ${GATEWAY}/r/${r.json.spendId}`);
      return lines.join("\n");
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
      const work = typeof a.work === "string" && /^[0-9a-f]{64}$/.test(a.work) ? a.work : "";
      const r = await post("/api/gateway/accept", { signed: await E.signAccept(await key(AGENT, false), text(a.promise, "promise", 60), { work, note: typeof a.note === "string" ? a.note.slice(0, 200) : undefined }) });
      if (!r.json.status) throw new ToolError(`Gateway: ${r.json.error ?? r.status}`);
      if (["LAPSED", "DENIED", "FAILED"].includes(r.json.status)) return [`${r.json.status}. Nothing was paid.`, ...(r.json.reasons ?? []).map((x: { code: string; meaning: string; detail: string }) => `  ${x.code}: ${x.meaning} (${x.detail})`)].join("\n");
      const lines = [`${r.json.status}: your acceptance released the money${r.json.duplicate ? " (already done; not paid twice)" : ""}`];
      if (r.json.paypal) lines.push(`PayPal capture ${r.json.paypal.captureId}, ${r.json.paypal.payoutStatus === "HELD_IN_ACCOUNT" ? "credited to the payee agent's balance (no payout)" : `payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"})`}`);
      lines.push(`Receipt: ${GATEWAY}/r/${r.json.spendId}`);
      return lines.join("\n");
    },
  },
  {
    name: "envelope_balance",
    description: "Show the balance of THIS agent's own account (money it has earned and kept), whether its owner has frozen it, the most it may pay at once, and its recent ledger. Call this before sending money from the balance.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const me = await key(AGENT, false);
      const r = await fetch(`${GATEWAY}/api/agents/${me.publicKey}`).then(async (x) => ({ status: x.status, json: (await x.json().catch(() => ({}))) as Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (r.status !== 200 || !r.json.balance) return `${AGENT} has no account that keeps a balance. Its owner opens one with: agent.ts open-account --hold.`;
      const b = r.json.balance;
      return [`Balance ${usd(b.minor)}${b.frozen ? " (FROZEN by the owner: nothing can leave)" : ""}${b.perPaymentMinor ? `; at most ${usd(b.perPaymentMinor)} per payment` : ""}. You are paid as ${r.json.receives.payee}.`, ...b.ledger.slice(0, 12).map((l: { deltaMinor: number; kind: string; counterparty: string | null; balanceAfterMinor: number }) => `${l.deltaMinor < 0 ? "-" : "+"}${usd(Math.abs(l.deltaMinor))} ${l.kind} ${l.counterparty ?? ""} → ${usd(l.balanceAfterMinor)}`)].join("\n");
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
      const me = await key(AGENT, false);
      const amount = cents(a.amount, "amount");
      const memo = typeof a.memo === "string" ? a.memo.slice(0, 200) : undefined;
      const signed = a.withdraw === true ? await E.signTransfer(me, { kind: "withdraw", amount, memo }) : await E.signTransfer(me, { amount, payee: text(a.payee, "payee", 127), purpose: typeof a.purpose === "string" ? a.purpose.slice(0, 60) : undefined, memo });
      const r = await post("/api/bank/transfer", { signed });
      if (r.json.status === "DENIED") return `DENIED. Nothing moved. ${(r.json.reasons ?? []).map((x: { code: string; meaning: string; detail: string }) => `${x.code}: ${x.meaning} (${x.detail})`).join("; ")}`;
      if (!r.json.status) throw new ToolError(`Gateway error: ${r.json.error ?? r.status}`);
      return `${r.json.status}: ${usd(amount)} ${a.withdraw === true ? "to the owner" : `to ${signed.request.payee}`}${r.json.duplicate ? " (already done; not moved twice)" : ""}. Balance now ${usd(r.json.balanceMinor)}.${r.json.paypal ? ` PayPal payout ${r.json.paypal.payoutBatchId} (${r.json.paypal.payoutStatus ?? "pending"}).` : r.json.status === "BOOKED" ? " Moved on the ledger; no PayPal call." : ""} Transfer ${r.json.transferId}.`;
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
      const me = await key(AGENT, false);
      const charges = typeof a.charges === "number" && Number.isInteger(a.charges) && a.charges >= 1 ? a.charges : 1;
      const everyDays = typeof a.every_days === "number" && a.every_days >= 0 ? a.every_days : 30;
      const validDays = typeof a.valid_days === "number" && a.valid_days > 0 ? a.valid_days : everyDays * charges + 7;
      const signed = await E.signCard(me, { merchant: text(a.merchant, "merchant", 40), label: text(a.label, "label", 60), perCharge: cents(a.per_charge, "per_charge"), maxCharges: charges, every: Math.round(everyDays * 86400), life: Math.round(validDays * 86400) });
      const r = await post("/api/cards", { signed });
      if (r.status !== 200) throw new ToolError(`Refused: ${r.json.error ?? r.status}`);
      return `Card ${r.json.number} (id ${r.json.id}) issued for ${r.json.merchant.label}: at most ${usd(r.json.perChargeMinor)} a charge, ${r.json.maxCharges} charge(s), one per ${everyDays} day(s), valid until ${r.json.notAfter}. Give the merchant the card id. It will end by itself; cancel it earlier with envelope_card_cancel.`;
    },
  },
  {
    name: "envelope_card_list",
    description: "List the cards THIS agent has issued: which merchant each is locked to, its limits, how many charges have been used, and whether it is active, ended, cancelled or expired. Use it to decide whether a subscription should be cancelled before the next charge.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const me = await key(AGENT, false);
      const r = await fetch(`${GATEWAY}/api/agents/${me.publicKey}`).then(async (x) => ({ status: x.status, json: (await x.json().catch(() => ({}))) as Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
      const list = (r.json.cards ?? []) as Array<{ id: string; number: string; state: string; label: string; merchant: { label: string }; perChargeMinor: number; charges: number; maxCharges: number; chargedMinor: number; nextChargeFrom: string | null; notAfter: string }>;
      if (!list.length) return `${AGENT} has issued no cards.`;
      return list.map((c) => `${c.id} · ${c.number} · ${c.state} · ${c.label} → ${c.merchant.label}: ${usd(c.perChargeMinor)} a charge, ${c.charges} of ${c.maxCharges} used (${usd(c.chargedMinor)})${c.nextChargeFrom ? `, next charge allowed from ${c.nextChargeFrom}` : ""}, valid until ${c.notAfter}`).join("\n");
    },
  },
  {
    name: "envelope_card_cancel",
    description: "Cancel a card THIS agent issued, for example to end a subscription before the next charge. The merchant can never charge it again. It cannot be undone; issue a new card to resubscribe.",
    inputSchema: { type: "object", properties: { card: { type: "string", description: "The card id (card_…)" } }, required: ["card"], additionalProperties: false },
    async run(a) {
      const r = await post("/api/cards/cancel", { signed: await E.signCardCancel(await key(AGENT, false), text(a.card, "card", 60)) });
      if (r.status !== 200) throw new ToolError(`Refused: ${r.json.error ?? r.status}`);
      return `Card ${r.json.number} is cancelled. ${r.json.merchant.label} cannot charge it again. It was charged ${r.json.charges} time(s), ${usd(r.json.chargedMinor)} in all.`;
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
      const hello = await E.signHello(envelope(), await key(AGENT, false), { amount: cents(a.amount, "amount"), payee: text(a.payee, "payee", 254), purpose: text(a.purpose, "purpose", 60) });
      return E.b64u(new TextEncoder().encode(JSON.stringify(hello)));
    },
  },
  {
    name: "envelope_check_agent",
    description: "Check an introduction token another agent gave you before you do work for it. The gateway confirms the agent controls its key, names who stands behind it back to a person, asks PayPal whether the hold is still there, and says whether the payment it proposed would be accepted right now. The answer is signed and expires after five minutes.",
    inputSchema: { type: "object", properties: { token: { type: "string", description: "The introduction token" } }, required: ["token"], additionalProperties: false },
    async run(a) {
      let hello: unknown;
      try { hello = JSON.parse(new TextDecoder().decode(E.unb64u(text(a.token, "token", 20000)))); } catch { throw new ToolError("That is not an introduction token."); }
      const r = await post("/api/gateway/standing", { hello });
      const s = r.json.standing;
      if (!s) throw new ToolError(`Gateway: ${r.json.error ?? r.status}`);
      const { sig, ...body } = s;
      const pinned = (await fetch(`${GATEWAY}/api/gateway/key`).then((x) => x.json()).catch(() => null)) as { publicKey?: string } | null;
      const signed = (await E.verifyDetached(s.gateway, "envelope-standing/1", body, sig)) && pinned?.publicKey === s.gateway;
      return [
        `${s.agentLabel}, account ${s.account}`,
        `Stands behind it: ${s.sponsors.map((x: { role: string; label: string }) => `${x.label} (${x.role})`).join(" → ")}`,
        `PayPal hold ${s.paypal.authorizationId ?? "none"}: ${s.paypal.status ?? "not confirmed"}${s.paypal.unusedMinor !== null ? `, ${usd(s.paypal.unusedMinor)} unused` : ""} (${s.paypal.mode})`,
        `Asked: ${usd(s.ask.amount)} to ${s.ask.payee} for ${s.ask.purpose}`,
        s.good ? `GOOD: it can pay up to ${usd(s.availableMinor)} in one payment right now.` : `NOT GOOD: this payment would be refused. ${s.reasons.map((x: { code: string; detail: string }) => `${x.code} (${x.detail})`).join("; ")}`,
        `Gateway signature: ${signed ? "valid" : "INVALID, do not rely on this"}. Valid until ${s.validUntil}.`,
      ].join("\n");
    },
  },
];

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");
async function handle(m: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }) {
  const reply = (result: object) => { if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result }); };
  const fail = (code: number, message: string) => { if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code, message } }); };
  switch (m.method) {
    case "initialize":
      return reply({ protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "envelope", version: "1.0.0" }, instructions: `You are acting as "${AGENT}". You can spend only what your envelope allows; call envelope_show first.` });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(m.params?.name)}`);
      try {
        return reply({ content: [{ type: "text", text: await tool.run((m.params?.arguments ?? {}) as Args) }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e instanceof ToolError ? e.message : `Unexpected error: ${(e as Error).message}` }], isError: true });
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
