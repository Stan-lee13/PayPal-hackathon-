/**
 * DEMO ONLY: the console's built-in scripted agents. Their keys are generated and kept by this
 * server so a visitor can watch the protocol work without installing anything. They follow a fixed
 * script (no model). Real agents keep their own keys and use the same gateway endpoints
 * (see scripts/agent.ts): the gateway treats both identically.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { demoKeys } from "../db/schema";
import { UserFacingError } from "../errors";
import * as E from "../envelope/core";
import * as G from "../gateway/service";

export const DEMO_LABELS = ["ops-agent", "localization-agent", "creative-agent", "helper"] as const;
type Label = (typeof DEMO_LABELS)[number];

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

export const DEMO_ACTIONS = ["split-localization", "split-creative", "pay-translator", "pay-designer", "attack-payee", "attack-overspend", "attack-forge"] as const;
export type DemoAction = (typeof DEMO_ACTIONS)[number];

/** One scripted step. Amounts scale with the root so any envelope size works. */
export async function act(rootId: string, action: DemoAction): Promise<{ action: DemoAction; narration: string; result?: G.SpendResult }> {
  const ops = await agent(rootId, "ops-agent");
  if (!ops.chain) throw new UserFacingError("The ops agent has no envelope yet.", 409);
  const rootCaps = ops.chain[0]!.body.caps;
  const payees = rootCaps.payees ?? [];
  // caps lists are stored sorted, so pick by meaning where possible and by position otherwise
  const pick = (list: string[], hint: RegExp, fallback: number) => list.find((x) => hint.test(x)) ?? list[Math.min(fallback, list.length - 1)];
  const translator = pick(payees, /transl|locali/i, 0) ?? "translator@example.com";
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
      return { action, narration: `ops-agent split off an envelope for ${to.row.label}: up to $${(caps.limit / 100).toFixed(2)}, only to ${caps.payees![0]}, only for ${caps.purposes![0]}. No server was asked.` };
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
