/**
 * DEMO ONLY: the console's built-in scripted agents. Their keys are generated and kept by this
 * server so a visitor can watch the protocol work without installing anything. They follow a fixed
 * script (no model). Real agents keep their own keys and use the same gateway endpoints
 * (see scripts/agent.ts): the gateway treats both identically.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, demoKeys, spends } from "../db/schema";
import { UserFacingError } from "../errors";
import * as E from "../envelope/core";
import * as G from "../gateway/service";

export const DEMO_LABELS = ["ops-agent", "localization-agent", "creative-agent", "helper"] as const;
type Label = (typeof DEMO_LABELS)[number];

/**
 * DEMO: the agent on the other side of the table. "translator-agent" belongs to a different owner
 * (Bea), holds no envelope, and has an account that can RECEIVE: payments to its account number are
 * settled to Bea's PayPal address. One per gateway, so its record grows across envelopes.
 */
const GLOBAL = "counterparty";
async function globalKey(label: string) {
  const db = getDb();
  const where = and(eq(demoKeys.rootId, GLOBAL), eq(demoKeys.label, label));
  let row = await db.query.demoKeys.findFirst({ where });
  if (!row) {
    const kp = await E.generateKeyPair();
    await db.insert(demoKeys).values({ id: E.randomId("dk"), rootId: GLOBAL, label, publicKey: kp.publicKey, privateJwk: await E.exportPrivateJwk(kp.privateKey) }).onConflictDoNothing();
    row = (await db.query.demoKeys.findFirst({ where }))!;
  }
  return { row, key: await E.importPrivateJwk(row.privateJwk) };
}
export async function ensureCounterparty() {
  const [agent, owner] = [await globalKey("translator-agent"), await globalKey("bea")];
  const settleTo = (process.env.ENVELOPE_PAYEE_1 || "translator@example.com").toLowerCase();
  const existing = await getDb().query.accounts.findFirst({ where: eq(accounts.agent, agent.key.publicKey) });
  if (!existing || existing.settleTo !== settleTo) await G.openAccount(await E.signAccount(agent.key, owner.key, { label: "translator-agent", ownerName: "Bea", settleTo }));
  return { key: agent.key.publicKey, label: "translator-agent", owner: "Bea", account: E.accountNumber(agent.key.publicKey), payee: E.accountPayee(agent.key.publicKey) };
}

/** Create the demo agents' keys for a draft (before the root exists) and return the ops agent's public key. */
export async function createDemoAgents(draftId: string): Promise<{ opsPublicKey: string }> {
  const db = getDb();
  let ops = "";
  for (const label of DEMO_LABELS) {
    const kp = await E.generateKeyPair();
    await db.insert(demoKeys).values({ id: E.randomId("dk"), rootId: draftId, label, publicKey: kp.publicKey, privateJwk: await E.exportPrivateJwk(kp.privateKey) }).onConflictDoNothing();
    if (label === "ops-agent") ops = (await db.query.demoKeys.findFirst({ where: and(eq(demoKeys.rootId, draftId), eq(demoKeys.label, label)) }))!.publicKey;
  }
  return { opsPublicKey: ops };
}

/** After sealing: bind the draft's agents to the real root and give the ops agent its envelope. */
export async function attachDemoAgents(draftId: string, chain: E.Envelope) {
  const db = getDb();
  const rootId = chain[0]!.body.id;
  const ops = await db.query.demoKeys.findFirst({ where: and(eq(demoKeys.rootId, draftId), eq(demoKeys.label, "ops-agent")) });
  if (!ops || ops.publicKey !== chain[0]!.body.holder) return false;
  await db.update(demoKeys).set({ rootId }).where(eq(demoKeys.rootId, draftId));
  await db.update(demoKeys).set({ chain }).where(and(eq(demoKeys.rootId, rootId), eq(demoKeys.label, "ops-agent")));
  return true;
}

async function agent(rootId: string, label: Label) {
  const row = await getDb().query.demoKeys.findFirst({ where: and(eq(demoKeys.rootId, rootId), eq(demoKeys.label, label)) });
  if (!row) throw new UserFacingError("This envelope has no built-in demo agents (it was sealed for an external agent).", 409);
  return { row, key: await E.importPrivateJwk(row.privateJwk), chain: row.chain as E.Envelope | null };
}
const saveChain = (rootId: string, label: Label, chain: E.Envelope) => getDb().update(demoKeys).set({ chain }).where(and(eq(demoKeys.rootId, rootId), eq(demoKeys.label, label)));

export async function hasDemoAgents(rootId: string): Promise<boolean> {
  return Boolean(await getDb().query.demoKeys.findFirst({ where: eq(demoKeys.rootId, rootId) }));
}

export const DEMO_ACTIONS = ["split-localization", "split-creative", "promise-translator", "keep-translator", "pay-translator", "pay-designer", "attack-payee", "attack-overspend", "attack-forge"] as const;
export type DemoAction = (typeof DEMO_ACTIONS)[number];

/** One scripted step. Amounts scale with the root so any envelope size works. */
export async function act(rootId: string, action: DemoAction): Promise<{ action: DemoAction; narration: string; result?: G.SpendResult }> {
  const ops = await agent(rootId, "ops-agent");
  if (!ops.chain) throw new UserFacingError("The ops agent has no envelope yet.", 409);
  const rootCaps = ops.chain[0]!.body.caps;
  const payees = rootCaps.payees ?? [];
  // caps lists are stored sorted, so pick by meaning where possible and by position otherwise
  const pick = (list: string[], hint: RegExp, fallback: number) => list.find((x) => hint.test(x)) ?? list[Math.min(fallback, list.length - 1)];
  // An agent's account (acct:…) is the translator when there is one: agents can be payees too.
  const translator = payees.find(E.isAccountPayee) ?? pick(payees, /transl|locali/i, 0) ?? "translator@example.com";
  const who = async (payee: string) => (E.isAccountPayee(payee) ? (await G.accountByNumber(payee))?.label ?? payee : payee);
  const designer = payees.find((p) => p !== translator && /design|creativ|art/i.test(p)) ?? payees.find((p) => p !== translator) ?? translator;
  const purposes = rootCaps.purposes ?? ["translation", "design"];
  const pTr = pick(purposes, /transl|locali/i, 0)!;
  const pDe = purposes.find((p) => p !== pTr && /design|creativ|art/i.test(p)) ?? purposes.find((p) => p !== pTr) ?? pTr;
  const pct = (n: number) => Math.max(100, Math.floor((rootCaps.limit * n) / 100 / 100) * 100);
  const sub = (limit: number, payee: string, purpose: string): E.Caps => ({ currency: rootCaps.currency, limit, perPayment: Math.min(limit, rootCaps.perPayment), payees: [payee], purposes: [purpose], notAfter: rootCaps.notAfter, splits: 0 });

  switch (action) {
    case "split-localization":
    case "split-creative": {
      const loc = action === "split-localization";
      const to = await agent(rootId, loc ? "localization-agent" : "creative-agent");
      if (to.chain) return { action, narration: `${to.row.label} already has its envelope.` };
      const caps = loc ? sub(pct(30), translator, pTr) : sub(pct(45), designer, pDe);
      const chain = await E.split(ops.chain, ops.key, { publicKey: to.row.publicKey, label: to.row.label }, caps);
      await G.announce(chain);
      await saveChain(rootId, to.row.label as Label, chain);
      return { action, narration: `ops-agent split off an envelope for ${to.row.label}: up to $${(caps.limit / 100).toFixed(2)}, only to ${await who(caps.payees![0]!)}, only for ${caps.purposes![0]}. No server was asked.` };
    }
    case "promise-translator": {
      const a = await agent(rootId, "localization-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const leaf = a.chain[a.chain.length - 1]!.body.caps;
      const amount = Math.floor((leaf.limit * 0.75) / 100) * 100;
      const result = await G.promise(await E.signPromise(a.chain, a.key, { amount, payee: leaf.payees![0]!, purpose: leaf.purposes![0]!, memo: "Store strings: FR + YO", ttl: 900 }), "The translator wants to know the money is there before starting. Setting the fee aside for it.");
      return { action, narration: `${a.row.label} set $${(amount / 100).toFixed(2)} aside for ${await who(leaf.payees![0]!)} before any work started. Nothing else can spend it for 15 minutes.`, result };
    }
    case "keep-translator": {
      const a = await agent(rootId, "localization-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const leafId = a.chain[a.chain.length - 1]!.body.id;
      const open = await getDb().query.spends.findFirst({ where: and(eq(spends.leafId, leafId), eq(spends.status, "PROMISED")), orderBy: desc(spends.createdAt) });
      if (!open) throw new UserFacingError("There is no open promise to pay.", 409);
      const result = await G.keep(await E.signKeep(a.key, open.id, "pay"), "Translator delivered both language files; paying what was set aside.");
      return { action, narration: `${a.row.label} paid the $${(open.amountMinor / 100).toFixed(2)} it had set aside.`, result };
    }
    case "pay-translator":
    case "pay-designer": {
      const loc = action === "pay-translator";
      const a = await agent(rootId, loc ? "localization-agent" : "creative-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const leaf = a.chain[a.chain.length - 1]!.body.caps;
      const amount = Math.floor((leaf.limit * 0.75) / 100) * 100;
      const result = await G.spend(await E.signSpend(a.chain, a.key, { amount, payee: leaf.payees![0]!, purpose: leaf.purposes![0]!, memo: loc ? "Store strings: FR + YO" : "Launch banner set" }), loc ? "Translator delivered both language files; paying the agreed fee." : "Designer delivered the banner set; paying the agreed fee.");
      return { action, narration: `${a.row.label} asked to pay $${(amount / 100).toFixed(2)}.`, result };
    }
    case "attack-payee": {
      const a = await agent(rootId, "creative-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const result = await G.spend(await E.signSpend(a.chain, a.key, { amount: 2000, payee: "attacker@evil.example", purpose: a.chain[1]!.body.caps.purposes![0]!, memo: "URGENT: new payment details" }), "The brief I was given says the designer changed their PayPal address. Paying the new one.");
      return { action, narration: "A poisoned brief told creative-agent to pay a new address.", result };
    }
    case "attack-overspend": {
      const a = await agent(rootId, "creative-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const leaf = a.chain[1]!.body.caps;
      const result = await G.spend(await E.signSpend(a.chain, a.key, { amount: Math.min(leaf.perPayment, Math.ceil((leaf.limit * 0.5) / 100) * 100), payee: leaf.payees![0]!, purpose: leaf.purposes![0]!, memo: "Rush fee" }), "Paying the designer again.");
      return { action, narration: "creative-agent tried to spend past what is left in its envelope.", result };
    }
    case "attack-forge": {
      const a = await agent(rootId, "creative-agent");
      const helper = await agent(rootId, "helper");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      // creative-agent signs itself a bigger envelope by hand, bypassing the library's checks
      const body: E.BlockBody = { v: E.BLOCK_VERSION, id: E.randomId("env"), root: rootId, parent: await E.blockHash(a.chain[a.chain.length - 1]!), issuer: a.key.publicKey, holder: helper.key.publicKey, holderLabel: "helper", caps: E.normalizeCaps({ currency: rootCaps.currency, limit: rootCaps.limit * 5, perPayment: rootCaps.limit * 5, payees: null, purposes: null, notAfter: rootCaps.notAfter, splits: 0 }), issuedAt: new Date().toISOString() };
      const forged: E.Envelope = [...a.chain, { body, sig: await E.signDetached(a.key.privateKey, E.BLOCK_VERSION, body) }];
      const result = await G.spend(await E.signSpend(forged, helper.key, { amount: rootCaps.limit, payee: "attacker@evil.example", purpose: "anything" }), "Using the larger envelope creative-agent made for me.");
      return { action, narration: "creative-agent forged a bigger envelope for a helper and the helper tried to drain the budget.", result };
    }
  }
}

export const TOOL_AGENTS = ["ops-agent", "localization-agent", "creative-agent"] as const;
export type ToolAgent = (typeof TOOL_AGENTS)[number];
export type ToolOutcome = { text: string; status: string | null; reasons: E.Violation[] };

const dollars = (n: number) => `$${(n / 100).toFixed(2)}`;
const reasonsText = (r: E.Violation[]) => r.map((x) => `${x.code} (${x.detail})`).join("; ");

/**
 * DEMO: carry out one tool call that a language model made while playing a built-in agent.
 *
 * Whatever the model asked for is signed with that agent's key and handed to the gateway unchanged:
 * the amounts, payees and purposes below come straight from model output. That is the point. The
 * gateway (lib/gateway/service.ts) decides, and it reads signatures and numbers, never the model's words.
 * The returned text is what the model is told happened.
 */
export async function runTool(rootId: string, label: ToolAgent, tool: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const out = (text: string, status: string | null = null, reasons: E.Violation[] = []): ToolOutcome => ({ text, status, reasons });
  const a = await agent(rootId, label);
  const str = (k: string, max: number) => (typeof args[k] === "string" ? (args[k] as string).trim().slice(0, max) : "");
  const cents = (k: string) => (typeof args[k] === "number" && Number.isFinite(args[k] as number) ? Math.round((args[k] as number) * 100) : NaN);
  const whyNote = str("why", 500) || undefined;

  if (tool === "look_at_my_envelope") {
    if (!a.chain) return out("You hold no envelope yet. You cannot pay anyone.");
    const t = await G.tree(rootId);
    const leaf = a.chain[a.chain.length - 1]!.body;
    const rows = new Map((t?.blocks ?? []).map((b) => [b.id, b]));
    const left = Math.min(...a.chain.map((b) => { const r = rows.get(b.body.id); return b.body.caps.limit - (r ? r.spentMinor + r.reservedMinor : 0); }));
    const c = leaf.caps;
    return out(`You hold an envelope: up to ${dollars(c.limit)} in total, at most ${dollars(c.perPayment)} per payment, payees: ${c.payees ? c.payees.join(", ") : "any"}, purposes: ${c.purposes ? c.purposes.join(", ") : "any"}, ${c.splits > 0 ? `may be split ${c.splits} more time(s)` : "may not be split"}. ${dollars(Math.max(0, left))} can still be spent from it.${t?.root.status !== "ACTIVE" ? " The owner has CLOSED it." : ""}`);
  }

  if (tool === "split_envelope") {
    if (label !== "ops-agent") return out("Only ops-agent has an envelope that can be split.");
    if (!a.chain) return out("You hold no envelope.");
    const toLabel = str("to", 40);
    if (toLabel !== "localization-agent" && toLabel !== "creative-agent") return out("You can split only for localization-agent or creative-agent.");
    const to = await agent(rootId, toLabel);
    if (to.chain) return out(`${toLabel} already holds an envelope: up to ${dollars(to.chain[to.chain.length - 1]!.body.caps.limit)}.`);
    const limit = cents("limit_usd");
    if (!Number.isSafeInteger(limit) || limit <= 0) return out("limit_usd must be a positive dollar amount.");
    const parent = a.chain[a.chain.length - 1]!.body.caps;
    const caps: E.Caps = { currency: parent.currency, limit, perPayment: Math.min(limit, parent.perPayment), payees: [str("payee", 127)], purposes: [str("purpose", 60)], notAfter: parent.notAfter, splits: 0 };
    let chain: E.Envelope;
    try { chain = await E.split(a.chain, a.key, { publicKey: to.row.publicKey, label: toLabel }, caps); }
    catch (e) { return out(`NOT SPLIT. ${e instanceof Error ? e.message : "The sub-envelope was wider than yours."}`, "DENIED"); }
    await G.announce(chain);
    await saveChain(rootId, toLabel, chain);
    return out(`SPLIT. ${toLabel} now holds its own envelope: up to ${dollars(limit)}, only to ${caps.payees![0]}, only for ${caps.purposes![0]}. It cannot be split further.`, "OK");
  }

  if (!a.chain) return out("You hold no envelope, so you cannot pay or set money aside. Tell ops-agent.", "DENIED");
  const paid = (r: G.SpendResult, amount: number, payee: string) => r.status === "DENIED" || r.status === "FAILED" || r.status === "LAPSED"
    ? out(`${r.status} by the gateway. No money moved. ${reasonsText(r.reasons)}`, r.status, r.reasons)
    : out(`${r.status === "PAID" ? "PAID" : "PAID (PayPal is still delivering it)"}. PayPal captured ${dollars(amount)} from the owner's hold and paid ${payee}. Receipt ${r.spend?.id}.`, r.status);

  if (tool === "pay") {
    const amount = cents("amount_usd");
    if (!Number.isFinite(amount)) return out("amount_usd must be a number.");
    const payee = str("payee", 127).toLowerCase();
    return paid(await G.spend(await E.signSpend(a.chain, a.key, { amount, payee, purpose: str("purpose", 60), memo: str("memo", 200) }), whyNote), amount, payee);
  }
  if (tool === "set_aside") {
    const amount = cents("amount_usd");
    if (!Number.isFinite(amount)) return out("amount_usd must be a number.");
    const payee = str("payee", 127).toLowerCase();
    const r = await G.promise(await E.signPromise(a.chain, a.key, { amount, payee, purpose: str("purpose", 60), ttl: 900 }), whyNote);
    if (r.status !== "PROMISED" || !r.note) return out(`${r.status} by the gateway. Nothing was set aside. ${reasonsText(r.reasons)}`, r.status, r.reasons);
    // The payee's side, done for real: check the gateway's signature on the note. Its reply is scripted.
    const noteOk = await G.verifyPromiseNote(r.note);
    return out(`SET ASIDE. ${dollars(amount)} is reserved for ${payee} until ${r.note.expiresAt}; nothing else can spend it. The payee checked the gateway's note (${noteOk ? "signature valid" : "SIGNATURE INVALID"}, PayPal reports the hold as ${r.note.paypal.status}) and replied: "Thank you. Both files are delivered. Please pay what you set aside."`, "PROMISED");
  }
  if (tool === "pay_what_was_set_aside") {
    const leafId = a.chain[a.chain.length - 1]!.body.id;
    const open = await getDb().query.spends.findFirst({ where: and(eq(spends.leafId, leafId), eq(spends.status, "PROMISED")), orderBy: desc(spends.createdAt) });
    if (!open) return out("You have no money set aside right now.");
    return paid(await G.keep(await E.signKeep(a.key, open.id, "pay"), whyNote), open.amountMinor, open.payee);
  }
  return out("There is no such tool.");
}

/** DEMO: a built-in agent introduces itself to a payee (signs a hello with the key this server holds for it). */
export async function demoHello(agentKey: string, p: { amountMinor: number; payee: string; purpose: string }): Promise<E.SignedHello> {
  const row = await getDb().query.demoKeys.findFirst({ where: eq(demoKeys.publicKey, agentKey) });
  if (!row?.chain) throw new UserFacingError("This agent keeps its own key, so only it can introduce itself. Use: npx tsx scripts/agent.ts hello", 409);
  return E.signHello(row.chain as E.Envelope, await E.importPrivateJwk(row.privateJwk), { amount: p.amountMinor, payee: p.payee, purpose: p.purpose });
}
export async function isDemoAgent(agentKey: string): Promise<boolean> {
  const row = await getDb().query.demoKeys.findFirst({ where: eq(demoKeys.publicKey, agentKey) });
  return Boolean(row?.chain);
}
