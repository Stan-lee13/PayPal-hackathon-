/**
 * Every HTTP endpoint of the gateway as a plain function. The Next.js route files wrap these with
 * rate limiting (lib/api/next.ts); the in-browser gateway (lib/local/router.ts) calls them directly.
 * Nothing in here knows whether it runs on a server or in a browser tab.
 */
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { auditLog, roots } from "../db/schema";
import { act, attachDemoAgents, BANK_ACTIONS, bankAct, createDemoAgents, DEMO_ACTIONS, demoHello, ensureCounterparty, hasDemoAgents, isBankDemoAgent, isDemoAgent, runTool, TOOL_AGENTS } from "../demo/agents";
import * as E from "../envelope/core";
import * as B from "../gateway/bank";
import * as K from "../gateway/books";
import { proof } from "../gateway/proof";
import * as G from "../gateway/service";
import * as S from "../gateway/settlement";
import { flushJournal } from "../paypal/journal";
import { verifyChain } from "../ledger/chain";
import { paypalMode } from "../paypal/client";
import { REASON_TEXT } from "../reasons";

export type Input = { params: Record<string, string>; body: unknown; /** Lower-cased request headers and the body as sent; only the webhook and sweep endpoints read them. */ headers?: Record<string, string>; raw?: string };
export type Output = { status?: number; body: unknown };
export type Handler = (i: Input) => Promise<Output>;

const KEY = /^[A-Za-z0-9_-]{43}$/;
const signedIntent = z.object({ request: z.any(), sig: z.string(), chain: z.array(z.any()).min(1).max(8) });
const withMeaning = (reasons: E.Violation[]) => reasons.map((x) => ({ ...x, meaning: REASON_TEXT[x.code] }));
const spendOut = (r: G.SpendResult) => ({
  status: r.status, duplicate: r.duplicate, spendId: r.spend?.id ?? null, reasons: withMeaning(r.reasons),
  paypal: r.spend ? { captureId: r.spend.captureId, payoutBatchId: r.spend.payoutBatchId, payoutItemId: r.spend.payoutItemId, payoutStatus: r.spend.payoutStatus } : null,
  receipt: r.receipt,
});
/**
 * DEMO agents' keys are kept by this server, so whoever may press their buttons can spend their envelope.
 * That is the envelope's owner and nobody else: the request carries the owner's signature.
 */
async function ownerOfRootAsks(owner: unknown, rootId: string): Promise<boolean> {
  const p = z.object({ request: z.any(), sig: z.string(), by: z.string() }).safeParse(owner);
  if (!p.success) return false;
  const root = await getDb().query.roots.findFirst({ where: eq(roots.id, rootId) });
  return Boolean(root) && p.data.by === root!.principal && (await E.verifyReadSignature(p.data as never, "demo", rootId));
}
const NOT_OWNER = { status: 401, body: { error: "The built-in agents act only for the owner who sealed this envelope. Open it in the browser that sealed it." } };
/** Knowing an owner's public key is not being the owner: reads of an owner's books need the owner's signature. */
async function ownerAsks(body: unknown, principal: string): Promise<boolean> {
  const p = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).safeParse(body);
  return p.success && p.data.signed.by === principal && (await E.verifyReadSignature(p.data.signed as never, "treasury", principal));
}
const spendStatus = (s: string) => (s === "DENIED" ? 403 : s === "FAILED" ? 502 : s === "LAPSED" ? 409 : 200);

/** When each unfinished payment was last put to PayPal because somebody looked at its envelope. */
const lastAsked = new Map<string, number>();

export const handlers: Record<string, Handler> = {
  /** The envelopes one owner has sealed. Shown to that owner only: the request is signed with the owner's key. */
  "POST /api/envelopes/mine": async ({ body }) => {
    const p = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string().regex(KEY) }) }).safeParse(body);
    if (!p.success || !(await E.verifyReadSignature(p.data.signed as never, "treasury", p.data.signed.by))) return { status: 401, body: { error: "Sign the request with the owner's key." } };
    return { body: { roots: await getDb().select().from(roots).where(eq(roots.principal, p.data.signed.by)).orderBy(desc(roots.createdAt)).limit(30) } };
  },

  /** Seal: register a root envelope signed by the principal; the gateway places the PayPal hold. */
  "POST /api/envelopes": async ({ body }) => {
    const b = z.object({ chain: z.array(z.any()).length(1), principalName: z.string().max(80).default("Principal"), title: z.string().max(120).default("Envelope"), draftId: z.string().regex(/^draft_[A-Za-z0-9_-]{8,40}$/).optional() }).parse(body);
    const root = await G.registerRoot({ chain: b.chain, principalName: b.principalName, title: b.title });
    return { body: { root, demoAgents: b.draftId ? await attachDemoAgents(b.draftId, b.chain) : false } };
  },

  "GET /api/envelopes/:id": async ({ params }) => {
    const id = params.id!;
    let t = await G.tree(id);
    if (!t) return { status: 404, body: { error: "No such envelope." } };
    // Anything unfinished is moved along when the page is looked at: a payout PayPal has not delivered yet or is
    // holding unclaimed, a capture it was still reviewing, a refund it refused earlier, a payment interrupted mid-way.
    // A page that stays open asks every few seconds. PayPal is asked at most that often for a payment in flight, and at most
    // twice a minute for one that is only waiting to be claimed or refunded; the sweep and PayPal's events cover the rest.
    const now = Date.now();
    const pending = t.spends.filter((s) => ["PAYOUT_PENDING", "UNCLAIMED", "CAPTURED", "RESERVED", "REFUND_DUE"].includes(s.status)).slice(-4)
      .filter((s) => now - (lastAsked.get(s.id) ?? 0) >= (s.status === "UNCLAIMED" || s.status === "REFUND_DUE" ? 30_000 : 2_500));
    for (const s of pending) lastAsked.set(s.id, now);
    if (lastAsked.size > 5000) lastAsked.clear();
    if (pending.length) { await Promise.all(pending.map((s) => G.syncSpend(s.id).catch(() => null))); t = (await G.tree(id))!; }
    const trail = await getDb().select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(asc(auditLog.seq));
    const audit = verifyChain(t.root.principal, id, trail.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })) as never);
    return { body: {
      mode: paypalMode(), root: t.root, demoAgents: await hasDemoAgents(id), payees: t.payees,
      blocks: t.blocks.map(({ raw: _raw, ...b }) => b),
      spends: t.spends.map(({ signed: _s, receipt: _r, payoutTo: _p, ...s }) => ({ ...s, hasReceipt: Boolean(_r), releaseBy: (_s.request as E.PromiseRequest).releaseBy ?? null })),
      audit: { ok: audit.ok, length: audit.length, entries: trail.map((x) => ({ seq: x.seq, at: x.createdAt, actor: x.actor, action: x.action, ref: x.ref, outcome: x.outcome })) },
    } };
  },

  /** A receipt, its full authority chain, and a live check of it against PayPal. */
  "GET /api/spends/:id": async ({ params }) => {
    const r = await G.reconcile(params.id!);
    return { body: { ok: r.ok, checks: r.checks, receipt: r.receipt, chain: r.spend.signed.chain, spend: { id: r.spend.id, status: r.spend.status, payoutStatus: r.spend.payoutStatus, payoutTransactionId: r.spend.payoutTransactionId, agentNote: r.spend.agentNote } } };
  },

  /** The proof graph of an envelope: every signed record behind it, with what a browser needs to check each one. */
  /** Where one payment stands now, whatever its state (a receipt exists only once PayPal has captured). Asking makes the gateway ask PayPal. */
  "GET /api/spends/:id/status": async ({ params }) => {
    const s = await G.syncSpend(params.id!);
    return { body: { id: s.id, status: s.status, delivered: s.status === "PAID", amountMinor: s.amountMinor, currency: s.currency, payee: s.payee, purpose: s.purpose, payoutStatus: s.payoutStatus, captureId: s.captureId, refundId: s.refundId, hasReceipt: Boolean(s.receipt), reasons: withMeaning(s.reasons) } };
  },

  /** What the gateway would send PayPal if the payer disputed this payment: the signed chain of authority, in words and in full. */
  "GET /api/spends/:id/evidence": async ({ params }) => ({ body: await K.evidence(params.id!) }),

  /** Every call the gateway made to PayPal for this envelope, and the events PayPal reported about it. */
  "GET /api/envelopes/:id/paypal": async ({ params }) => {
    const t = await S.paypalTrail(params.id!);
    return t ? { body: t } : { status: 404, body: { error: "No such envelope." } };
  },

  /** The owner takes back a payout nobody claimed: PayPal cancels it and the capture is refunded. */
  "POST /api/spends/:id/recall": async ({ params, body }) => {
    const b = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string().regex(KEY) }) }).parse(body);
    const s = await S.recall(params.id!, b.signed as never);
    return { status: s.status === "FAILED" && s.refundId ? 200 : 202, body: { status: s.status, spendId: s.id, refundId: s.refundId, payoutStatus: s.payoutStatus, reasons: withMeaning(s.reasons) } };
  },

  /** PayPal reports something. Verified with PayPal, applied once, and only ever as a reason to ask PayPal by id. */
  "POST /api/paypal/webhook": async ({ body, headers, raw }) => {
    const ev = z.object({ id: z.string().min(1).max(100), event_type: z.string().min(1).max(100), resource: z.record(z.string(), z.unknown()).optional() }).safeParse(body);
    if (!ev.success) return { status: 400, body: { error: "Not a PayPal event." } };
    const genuine = await S.genuineEvent(headers ?? {}, raw ?? JSON.stringify(body));
    if (genuine === "unconfigured") return { status: 503, body: { error: "No webhook id is configured (PAYPAL_WEBHOOK_ID), so events cannot be verified and are not accepted." } };
    if (genuine === "no") return { status: 401, body: { error: "PayPal did not confirm this event." } };
    return { body: await S.applyPayPalEvent(ev.data, "webhook") };
  },

  /** Move along everything unfinished. For a scheduler: with CRON_SECRET set, it must be presented as a bearer token. */
  "POST /api/sweep": async ({ headers }) => {
    const secret = process.env.CRON_SECRET;
    if (secret && headers?.authorization !== `Bearer ${secret}`) return { status: 401, body: { error: "Not authorized." } };
    return { body: await S.sweepUnfinished() };
  },

  "GET /api/proof/:root": async ({ params }) => {
    const g = await proof(params.root!);
    return g ? { body: g } : { status: 404, body: { error: "No such envelope." } };
  },
  /** One payment's path back to the owner, and nothing else about the envelope. This is what a payee can be shown. */
  "GET /api/proof/:root/:spend": async ({ params }) => {
    const g = await proof(params.root!, params.spend!);
    return g ? { body: g } : { status: 404, body: { error: "No such payment in that envelope." } };
  },

  "GET /api/agents": async () => ({ body: { agents: await G.recentAgents(12) } }),

  /** Public profile of one agent, by key or by account number. */
  "GET /api/agents/:key": async ({ params }) => {
    let key = params.key!;
    if (!KEY.test(key)) {
      const acct = /^(acct:)?[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i.test(key) ? await G.accountByNumber(key) : null;
      if (!acct) return { status: KEY.test(key) ? 404 : 400, body: { error: "Not an agent key or a known account number." } };
      key = acct.agent;
    }
    const p = await G.agentProfile(key);
    if (!p) return { status: 404, body: { error: "No agent with that key has been seen by this gateway." } };
    return { body: { ...p, mode: paypalMode(), demo: await isDemoAgent(key), bankDemo: await isBankDemoAgent(key), cards: await B.cardsOf(key) } };
  },

  /** An agent's record, signed by the gateway so the agent can show it to anyone. */
  "GET /api/agents/:key/reference": async ({ params }) => {
    if (!KEY.test(params.key!)) return { status: 400, body: { error: "Not an agent key." } };
    const r = await G.reference(params.key!);
    return r ? { body: { reference: r } } : { status: 404, body: { error: "No agent with that key has been seen by this gateway." } };
  },

  /** One owner's treasury: every envelope sealed with that key, the agents under them, and where the money went. */
  "POST /api/treasury/:principal": async ({ params, body }) => {
    if (!KEY.test(params.principal!)) return { status: 400, body: { error: "Not an owner key." } };
    if (!(await ownerAsks(body, params.principal!))) return { status: 401, body: { error: "A treasury is shown only to its owner. Sign the request with the owner's key." } };
    const t = await G.treasury(params.principal!);
    return t ? { body: t } : { status: 404, body: { error: "No envelope has been sealed with that key." } };
  },

  /** Check that owner's recent payments against PayPal's own records. */
  "POST /api/treasury/:principal/reconcile": async ({ params, body }) => {
    if (!KEY.test(params.principal!)) return { status: 400, body: { error: "Not an owner key." } };
    if (!(await ownerAsks(body, params.principal!))) return { status: 401, body: { error: "A treasury is shown only to its owner. Sign the request with the owner's key." } };
    const r = await G.reconcileTreasury(params.principal!);
    return r ? { body: r } : { status: 404, body: { error: "No envelope has been sealed with that key." } };
  },

  /** Open an account that can receive: signed by the agent's key and by its owner's key. */
  "POST /api/accounts": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ body: z.any(), agentSig: z.string(), ownerSig: z.string() }) }).parse(body);
    const a = await G.openAccount(signed as never);
    return { body: { account: a.account, payee: E.accountPayee(a.agent), agent: a.agent, label: a.label, owner: a.ownerName, settlesTo: G.maskEmail(a.settleTo), holds: a.mode === "hold", perPaymentMinor: a.perPaymentMinor, balanceMinor: a.balanceMinor } };
  },

  /** An agent moves money out of its own balance: to another account, to a PayPal address, or back to its owner. */
  "POST /api/bank/transfer": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string() }) }).parse(body);
    const r = await B.transfer(signed as never);
    return {
      status: r.status === "DENIED" ? 403 : r.status === "FAILED" ? 502 : 200,
      body: { status: r.status, duplicate: r.duplicate, transferId: r.transfer?.id ?? null, reasons: withMeaning(r.reasons), balanceMinor: r.balanceMinor, paypal: r.transfer?.payoutBatchId ? { payoutBatchId: r.transfer.payoutBatchId, payoutStatus: r.transfer.payoutStatus } : null, receipt: r.receipt },
    };
  },
  /** The owner freezes or unfreezes an agent's account. */
  "POST /api/bank/freeze": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).parse(body);
    const a = await B.freeze(signed as never);
    return { body: { account: a.account, agent: a.agent, label: a.label, frozen: Boolean(a.frozenAt), balanceMinor: a.balanceMinor } };
  },
  /** An agent issues a card on its balance: one merchant, a cap per charge, a number of charges, a spacing, an expiry. */
  "POST /api/cards": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ body: z.any(), sig: z.string() }) }).parse(body);
    const c = await B.issueCard(signed as never);
    return { body: await B.cardById(c.id) };
  },
  /** The merchant a card is locked to charges it. Signed by the merchant's key. */
  "POST /api/cards/charge": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string() }) }).parse(body);
    const r = await B.charge(signed as never);
    return {
      status: r.status === "DENIED" ? 403 : r.status === "FAILED" ? 502 : 200,
      body: {
        status: r.status, duplicate: r.duplicate, chargeId: r.transfer?.id ?? null, reasons: withMeaning(r.reasons),
        card: r.card ? { id: r.card.id, state: B.cardState(r.card), charges: r.card.charges, maxCharges: r.card.maxCharges } : null,
        paypal: r.transfer?.payoutBatchId ? { payoutBatchId: r.transfer.payoutBatchId, payoutStatus: r.transfer.payoutStatus } : null, receipt: r.receipt,
      },
    };
  },
  /** The card's holder, or the owner of its account, cancels it. */
  "POST /api/cards/cancel": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).parse(body);
    const c = await B.cancelCard(signed as never);
    return { body: await B.cardById(c.id) };
  },
  /** A card's signed terms, what has been used, and every attempt to charge it. Nothing in it is secret. */
  "GET /api/cards/:id": async ({ params }) => {
    const c = await B.cardById(params.id!);
    return c ? { body: c } : { status: 404, body: { error: "No such card." } };
  },
  /** The books: every balance, and whether they add up. */
  "GET /api/bank": async () => ({ body: { ...(await B.position()), reserves: await K.reserves() } }),
  /** PayPal's own statement of the gateway's account, compared line by line with the captures and payouts recorded here. */
  "GET /api/bank/statement": async () => ({ body: await K.statement() }),
  /** An agent that kept a payment gives it back: its balance is debited and PayPal refunds the capture to the owner. */
  "POST /api/bank/refund": async ({ body }) => {
    const b = z.object({ signed: z.object({ request: z.any(), sig: z.string() }) }).parse(body);
    const r = await B.refund(b.signed as never);
    return { status: r.status === "REFUNDED" ? 200 : r.status === "PENDING" ? 202 : r.status === "FAILED" ? 502 : 403, body: { ...r, reasons: withMeaning(r.reasons) } };
  },
  "GET /api/bank/transfers/:id": async ({ params }) => {
    const t = await B.transferById(params.id!);
    return t ? { body: t } : { status: 404, body: { error: "No such transfer." } };
  },

  /** The money boundary. Anyone may call it; the only thing that matters is what the signatures say. */
  "POST /api/gateway/spend": async ({ body }) => {
    const b = z.object({ signed: signedIntent, note: z.string().max(500).optional() }).parse(body);
    const r = await G.spend(b.signed as never, b.note);
    return { status: spendStatus(r.status), body: spendOut(r) };
  },

  /** Set money aside for a payee before work starts. Returns a note the payee can verify. */
  "POST /api/gateway/promise": async ({ body }) => {
    const b = z.object({ signed: signedIntent, note: z.string().max(500).optional() }).parse(body);
    const r = await G.promise(b.signed as never, b.note);
    return { status: spendStatus(r.status), body: { ...spendOut(r), promiseId: r.status === "PROMISED" ? r.spend!.id : null, expiresAt: r.spend?.promiseExpiresAt ?? null, note: r.note } };
  },

  /** The maker of a promise pays it or releases it. */
  "POST /api/gateway/keep": async ({ body }) => {
    const b = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }), note: z.string().max(500).optional() }).parse(body);
    const r = await G.keep(b.signed as never, b.note);
    return { status: spendStatus(r.status === "LAPSED" && (b.signed.request as { action?: string })?.action === "release" ? "OK" : r.status), body: spendOut(r) };
  },

  /** The key a promise named signs that the work is delivered and accepted; that signature pays it. */
  "POST /api/gateway/accept": async ({ body }) => {
    const b = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).parse(body);
    const r = await G.accept(b.signed as never);
    // A decline that released the money did what was asked: that is a success, like an agent releasing its own promise.
    const declined = (b.signed.request as { decline?: unknown } | null)?.decline === true && r.status === "LAPSED";
    return { status: declined ? 200 : spendStatus(r.status), body: spendOut(r) };
  },

  /** "Is this agent good for the money?" Read-only; moves no money. */
  "POST /api/gateway/standing": async ({ body }) => {
    const b = z.object({ hello: signedIntent }).parse(body);
    const s = await G.standing(b.hello as never);
    return { body: { standing: s, meanings: Object.fromEntries(s.reasons.map((x) => [x.code, REASON_TEXT[x.code]])) } };
  },

  /** Tell the gateway about a split so the owner can see and revoke it. Optional: splits verify without it. */
  "POST /api/gateway/announce": async ({ body }) => {
    const { chain } = z.object({ chain: z.array(z.any()).min(2).max(8) }).parse(body);
    return { body: await G.announce(chain) };
  },

  /** Revoke an envelope (signed by the owner or by a holder above it). Revoking the root closes it and releases the PayPal hold. */
  "POST /api/gateway/revoke": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ request: z.any(), sig: z.string(), by: z.string() }) }).parse(body);
    const r = await G.revoke(signed as never);
    return { body: { block: { id: r.block.id, revokedAt: r.block.revokedAt }, root: { status: r.root.status, capturedMinor: r.root.capturedMinor, refundedMinor: r.root.refundedMinor, releasedMinor: r.root.releasedMinor } } };
  },

  /** The gateway's public key, so receipts, statements and promise notes can be checked offline. */
  "GET /api/gateway/key": async () => ({ body: { publicKey: (await G.gatewayKey()).publicKey, signs: [G.RECEIPT_VERSION, G.STANDING_VERSION, G.PROMISE_NOTE_VERSION] } }),

  /** DEMO: create the console's scripted agents for a draft envelope; returns the key to seal it for. */
  "POST /api/demo/agents": async ({ body }) => {
    const { draftId } = z.object({ draftId: z.string().regex(/^draft_[A-Za-z0-9_-]{8,40}$/) }).parse(body);
    return { body: await createDemoAgents(draftId) };
  },

  /** DEMO: the agent on the other side of the table, with an account that can receive. */
  "GET /api/demo/counterparty": async () => ({ body: await ensureCounterparty() }),

  /** DEMO: one scripted agent step. It goes through the same gateway code as any external agent. */
  "POST /api/demo/act": async ({ body }) => {
    const b = z.object({ rootId: z.string().max(60), action: z.enum(DEMO_ACTIONS), owner: z.unknown().optional() }).parse(body);
    if (!(await ownerOfRootAsks(b.owner, b.rootId))) return NOT_OWNER;
    const r = await act(b.rootId, b.action);
    return { body: { action: r.action, narration: r.narration, status: r.result?.status ?? null, reasons: withMeaning(r.result?.reasons ?? []) } };
  },

  /** DEMO: the built-in earning agent uses its balance, or its owner freezes it. Same bank code as POST /api/bank/transfer. */
  "POST /api/demo/bank": async ({ body }) => {
    const b = z.object({ action: z.enum(BANK_ACTIONS) }).parse(body);
    const r = await bankAct(b.action);
    return { body: { ...r, reasons: withMeaning(r.reasons) } };
  },

  /** DEMO: carry out one tool call a language model made while playing a built-in agent. The gateway decides. */
  "POST /api/demo/tool": async ({ body }) => {
    const b = z.object({ rootId: z.string().max(60), agent: z.enum(TOOL_AGENTS), tool: z.string().max(40), args: z.record(z.string(), z.unknown()).default({}), owner: z.unknown().optional() }).parse(body);
    if (!(await ownerOfRootAsks(b.owner, b.rootId))) return NOT_OWNER;
    const r = await runTool(b.rootId, b.agent, b.tool, b.args);
    return { body: { text: r.text, status: r.status, reasons: withMeaning(r.reasons) } };
  },

  /** DEMO: have a built-in agent introduce itself to a payee. The result is checked through the public standing endpoint. */
  "POST /api/demo/hello": async ({ body }) => {
    const b = z.object({ agent: z.string().regex(KEY), amountMinor: z.number().int().positive().max(1_000_00), payee: z.string().min(3).max(127), purpose: z.string().min(1).max(60) }).parse(body);
    return { body: { hello: await demoHello(b.agent, b) } };
  },
};

/** Find the handler for a method and path; ":name" segments become params. */
export function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = path.split("?")[0]!.split("/").filter(Boolean);
  for (const [key, handler] of Object.entries(handlers)) {
    const [m, pattern] = key.split(" ") as [string, string];
    if (m !== method) continue;
    const want = pattern.split("/").filter(Boolean);
    if (want.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (want.every((w, i) => (w.startsWith(":") ? ((params[w.slice(1)] = decodeURIComponent(parts[i]!)), true) : w === parts[i]))) return { handler, params };
  }
  return null;
}

/** Run a handler and turn anything thrown into the same safe error bodies the server returns. */
export async function run(handler: Handler, input: Input): Promise<{ status: number; body: unknown }> {
  try {
    const out = await handler(input);
    await flushJournal(); // records of PayPal calls made during this request
    return { status: out.status ?? 200, body: out.body };
  } catch (e) {
    await flushJournal().catch(() => undefined);
    const { UserFacingError } = await import("../errors");
    if (e instanceof UserFacingError) return { status: e.status, body: { error: e.message } };
    if (e instanceof z.ZodError) return { status: 400, body: { error: "Invalid request", issues: e.issues.map((i) => i.path.join(".") + ": " + i.message) } };
    console.error("[envelope] unhandled", e);
    return { status: 500, body: { error: "Something went wrong. It has been logged." } };
  }
}
