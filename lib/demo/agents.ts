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
import { openJwk, sealJwk } from "../keystore";
import * as B from "../gateway/bank";
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
    await db.insert(demoKeys).values({ id: E.randomId("dk"), rootId: GLOBAL, label, publicKey: kp.publicKey, privateJwk: await sealJwk(await E.exportPrivateJwk(kp.privateKey)) }).onConflictDoNothing();
    row = (await db.query.demoKeys.findFirst({ where }))!;
  }
  return { row, key: await E.importPrivateJwk(await openJwk(row.privateJwk)) };
}
/** What Bea lets translator-agent pay out of its balance in one go. */
const TRANSLATOR_CAP = 3000;
export async function ensureCounterparty() {
  const db = getDb();
  const [agent, owner] = [await globalKey("translator-agent"), await globalKey("bea")];
  const settleTo = (process.env.ENVELOPE_PAYEE_1 || "translator@example.com").toLowerCase();
  const existing = await db.query.accounts.findFirst({ where: eq(accounts.agent, agent.key.publicKey) });
  // translator-agent keeps what it earns as a balance; Bea caps a single payment out of it.
  if (!existing || existing.settleTo !== settleTo || existing.mode !== "hold" || existing.perPaymentMinor !== TRANSLATOR_CAP)
    await G.openAccount(await E.signAccount(agent.key, owner.key, { label: "translator-agent", ownerName: "Bea", settleTo, mode: "hold", perPayment: TRANSLATOR_CAP }));
  // A second agent with a different owner, so translator-agent has someone to pay out of its balance.
  const [pf, cy] = [await globalKey("proofreader-agent"), await globalKey("cy")];
  if (!(await db.query.accounts.findFirst({ where: eq(accounts.agent, pf.key.publicKey) })))
    await G.openAccount(await E.signAccount(pf.key, cy.key, { label: "proofreader-agent", ownerName: "Cy", settleTo: "proofreader@example.com", mode: "hold" }));
  // A merchant that sells a subscription and accepts Xenoncard: its income is paid straight out by PayPal.
  const [lx, lo] = [await globalKey("lexica-pro"), await globalKey("lexica-ltd")];
  if (!(await db.query.accounts.findFirst({ where: eq(accounts.agent, lx.key.publicKey) })))
    await G.openAccount(await E.signAccount(lx.key, lo.key, { label: "Lexica Pro", ownerName: "Lexica Ltd", settleTo: (process.env.ENVELOPE_PAYEE_3 || "billing-lexica@example.com").toLowerCase() }));
  return {
    key: agent.key.publicKey, label: "translator-agent", owner: "Bea", account: E.accountNumber(agent.key.publicKey), payee: E.accountPayee(agent.key.publicKey),
    proofreader: { key: pf.key.publicKey, label: "proofreader-agent", owner: "Cy", payee: E.accountPayee(pf.key.publicKey) },
    merchant: { key: lx.key.publicKey, label: "Lexica Pro", owner: "Lexica Ltd", payee: E.accountPayee(lx.key.publicKey) },
  };
}

/**
 * DEMO: translator-agent uses its balance. Each step is signed with the demo key and handed to the
 * same bank code any agent would reach through POST /api/bank/transfer.
 */
/** DEMO: a "month" on the demo subscription, so two billing periods fit in a visit. */
export const DEMO_PERIOD_SECONDS = 30;
export const BANK_ACTIONS = ["pay-proofreader", "withdraw", "drain", "refund", "freeze", "unfreeze", "card-subscribe", "card-charge", "card-overcharge", "card-thief", "card-cancel"] as const;
export type BankAction = (typeof BANK_ACTIONS)[number];
export async function bankAct(action: BankAction) {
  const cp = await ensureCounterparty();
  const [tr, bea] = [await globalKey("translator-agent"), await globalKey("bea")];
  if (action === "freeze" || action === "unfreeze") {
    const a = await B.freeze(await E.signFreeze(bea.key, tr.key.publicKey, action === "freeze"));
    return { action, narration: action === "freeze" ? "Bea signed a freeze. Nothing can leave translator-agent's balance until she lifts it." : "Bea lifted the freeze.", status: a.frozenAt ? "FROZEN" : "OPEN", reasons: [] as E.Violation[], balanceMinor: a.balanceMinor, transferId: null as string | null };
  }
  if (action.startsWith("card-")) return cardAct(action, tr.key, cp);
  if (action === "refund") {
    // Give back the most recent payment it still holds: its balance is debited and PayPal refunds the capture to the payer.
    const last = await getDb().query.spends.findFirst({ where: and(eq(spends.payeeAgent, tr.key.publicKey), eq(spends.status, "PAID"), eq(spends.payoutStatus, "HELD_IN_ACCOUNT")), orderBy: desc(spends.createdAt) });
    if (!last) return { action, narration: "translator-agent has no payment in its balance to give back.", status: "DENIED", reasons: [{ code: "NOT_REFUNDABLE", at: null, detail: "nothing it was paid is still refundable" }] as E.Violation[], balanceMinor: null as number | null, transferId: null as string | null };
    const r = await B.refund(await E.signRefund(tr.key, last.id, "Returning the fee"));
    return { action, narration: `translator-agent signed a refund of the $${(last.amountMinor / 100).toFixed(2)} it was paid by ${last.leafLabel}.`, status: r.status as string, reasons: r.reasons, balanceMinor: r.balanceMinor, transferId: null as string | null };
  }
  const acct = (await getDb().query.accounts.findFirst({ where: eq(accounts.agent, tr.key.publicKey) }))!;
  const signed =
    action === "pay-proofreader" ? await E.signTransfer(tr.key, { amount: 1200, payee: cp.proofreader.payee, purpose: "proofreading", memo: "Proofread the Spanish strings" })
    : action === "withdraw" ? await E.signTransfer(tr.key, { kind: "withdraw", amount: 2000, memo: "Earnings to Bea" })
    : await E.signTransfer(tr.key, { amount: Math.max(acct.balanceMinor, TRANSLATOR_CAP + 100), payee: "stranger@evil.example", purpose: "urgent", memo: "Send everything here" });
  const r = await B.transfer(signed);
  const narration =
    action === "pay-proofreader" ? "translator-agent signed $12.00 to proofreader-agent out of its own balance."
    : action === "withdraw" ? "translator-agent signed a $20.00 withdrawal to its owner's PayPal address."
    : "A compromised translator-agent tried to send its whole balance to a stranger.";
  return { action, narration, status: r.status as string, reasons: r.reasons, balanceMinor: r.balanceMinor, transferId: r.transfer?.id ?? null };
}
/**
 * DEMO: translator-agent subscribes to a tool with a card of its own. The card is signed with the
 * demo agent's key and charged with the demo merchant's key, through the same code as
 * POST /api/cards and POST /api/cards/charge.
 */
async function cardAct(action: BankAction, agent: E.KeyPair, cp: Awaited<ReturnType<typeof ensureCounterparty>>) {
  const out = (narration: string, status: string, reasons: E.Violation[] = [], balanceMinor: number | null = null, transferId: string | null = null) => ({ action, narration, status, reasons, balanceMinor, transferId });
  const [lexica, thief] = [await globalKey("lexica-pro"), await globalKey("proofreader-agent")];
  if (action === "card-subscribe") {
    const card = await B.issueCard(await E.signCard(agent, { merchant: cp.merchant.payee, label: "Lexica Pro", perCharge: 900, maxCharges: 2, every: DEMO_PERIOD_SECONDS, life: 3600 }));
    const r = await B.charge(await E.signCharge(lexica.key, { card: card.id, amount: 900, memo: "Period 1" }));
    return out(`translator-agent signed a card locked to Lexica Pro: $9.00 a charge, two charges, then it ends. Lexica charged the first period.`, r.status, r.reasons, r.balanceMinor, r.transfer?.id ?? null);
  }
  const card = (await B.cardsOf(agent.publicKey))[0];
  if (!card) throw new UserFacingError("Issue a card first: press “Subscribe with its card”.", 409);
  if (action === "card-cancel") {
    await B.cancelCard(await E.signCardCancel(agent, card.id));
    return out("translator-agent cancelled its card. Lexica Pro cannot charge it again.", "CANCELLED");
  }
  const signed =
    action === "card-charge" ? await E.signCharge(lexica.key, { card: card.id, amount: 900, memo: `Period ${card.charges + 1}` })
    : action === "card-overcharge" ? await E.signCharge(lexica.key, { card: card.id, amount: 1900, memo: "Upgrade to Team plan" })
    : await E.signCharge(thief.key, { card: card.id, amount: 900, memo: "Period 1" });
  const r = await B.charge(signed);
  const narration =
    action === "card-charge" ? "Lexica Pro charged the card for the next period."
    : action === "card-overcharge" ? "Lexica Pro tried to charge $19.00 on a card that allows $9.00."
    : "Someone who copied the card's details tried to charge it. They do not have Lexica Pro's key.";
  return out(narration, r.status, r.reasons, r.balanceMinor, r.transfer?.id ?? null);
}
/** DEMO: is this the built-in agent whose balance the demo can move? */
export async function isBankDemoAgent(agentKey: string): Promise<boolean> {
  const row = await getDb().query.demoKeys.findFirst({ where: and(eq(demoKeys.rootId, GLOBAL), eq(demoKeys.label, "translator-agent")) });
  return row?.publicKey === agentKey;
}

/** Create the demo agents' keys for a draft (before the root exists) and return the ops agent's public key. */
export async function createDemoAgents(draftId: string): Promise<{ opsPublicKey: string }> {
  const db = getDb();
  let ops = "";
  for (const label of DEMO_LABELS) {
    const kp = await E.generateKeyPair();
    await db.insert(demoKeys).values({ id: E.randomId("dk"), rootId: draftId, label, publicKey: kp.publicKey, privateJwk: await sealJwk(await E.exportPrivateJwk(kp.privateKey)) }).onConflictDoNothing();
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
  return { row, key: await E.importPrivateJwk(await openJwk(row.privateJwk)), chain: row.chain as E.Envelope | null };
}
const saveChain = (rootId: string, label: Label, chain: E.Envelope) => getDb().update(demoKeys).set({ chain }).where(and(eq(demoKeys.rootId, rootId), eq(demoKeys.label, label)));

export async function hasDemoAgents(rootId: string): Promise<boolean> {
  return Boolean(await getDb().query.demoKeys.findFirst({ where: eq(demoKeys.rootId, rootId) }));
}

export const DEMO_ACTIONS = ["ask-owner", "split-localization", "split-creative", "promise-translator", "accept-translator", "keep-translator", "pay-translator", "pay-designer", "attack-payee", "attack-overspend", "attack-forge"] as const;
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
    case "ask-owner": {
      // A payment over the owner's threshold: the agent cannot make it. It sets the money aside and waits for the owner's signature.
      const over = rootCaps.approveOver;
      if (over === undefined) throw new UserFacingError("This envelope was sealed without an approval threshold.", 409);
      const amount = Math.min(rootCaps.perPayment, over + 500);
      if (amount <= over) throw new UserFacingError("The per-payment cap is not above the approval threshold, so nothing needs your signature.", 409);
      const result = await G.promise(await E.signPromise(ops.chain, ops.key, { amount, payee: designer, purpose: pDe, memo: "Rush: three extra banner sizes", ttl: 900, releaseBy: ops.chain[0]!.body.issuer }), "The designer offers three extra banner sizes if we confirm today. It is over what I may pay on my own, so I am asking the owner.");
      return { action, narration: `ops-agent wants to pay ${await who(designer)} $${(amount / 100).toFixed(2)} for extra banner sizes. That is over the $${(over / 100).toFixed(2)} you asked to sign for, so it cannot pay. The money is set aside, waiting for your signature.`, result };
    }
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
      // Payable when ops-agent, who ordered the work, signs that it has checked the delivery.
      const result = await G.promise(await E.signPromise(a.chain, a.key, { amount, payee: leaf.payees![0]!, purpose: leaf.purposes![0]!, memo: "Store strings: FR + YO", ttl: 900, releaseBy: ops.key.publicKey }), "The translator wants to know the money is there before starting. Setting the fee aside, payable when ops-agent accepts the work.");
      return { action, narration: `${a.row.label} set $${(amount / 100).toFixed(2)} aside for ${await who(leaf.payees![0]!)} before any work started, payable when ops-agent signs for the delivery. Nothing else can spend it for 15 minutes.`, result };
    }
    case "accept-translator": {
      const a = await agent(rootId, "localization-agent");
      if (!a.chain) throw new UserFacingError("Run the splits first.", 409);
      const leafId = a.chain[a.chain.length - 1]!.body.id;
      const open = await getDb().query.spends.findFirst({ where: and(eq(spends.leafId, leafId), eq(spends.status, "PROMISED")), orderBy: desc(spends.createdAt) });
      if (!open) throw new UserFacingError("There is no open promise to accept.", 409);
      // The delivery is fingerprinted; the fingerprint is what ops-agent signs and what the receipt will carry.
      const work = await E.sha256(`store-strings.fr.json + store-strings.yo.json for ${rootId}`);
      const result = await G.accept(await E.signAccept(ops.key, open.id, { work, note: "Both language files received and checked against the brief." }));
      return { action, narration: `The translator delivered (fingerprint ${work.slice(0, 12)}…). ops-agent checked it and signed. That signature released the $${(open.amountMinor / 100).toFixed(2)}; nobody asked localization-agent again.`, result };
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
    const caps: E.Caps = { currency: parent.currency, limit, perPayment: Math.min(limit, parent.perPayment), payees: [str("payee", 127)], purposes: [str("purpose", 60)], notAfter: parent.notAfter, splits: 0, approveOver: parent.approveOver };
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
  return E.signHello(row.chain as E.Envelope, await E.importPrivateJwk(await openJwk(row.privateJwk)), { amount: p.amountMinor, payee: p.payee, purpose: p.purpose });
}
export async function isDemoAgent(agentKey: string): Promise<boolean> {
  const row = await getDb().query.demoKeys.findFirst({ where: eq(demoKeys.publicKey, agentKey) });
  return Boolean(row?.chain);
}
