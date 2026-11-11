/**
 * Every HTTP endpoint of the gateway as a plain function. The Next.js route files wrap these with
 * rate limiting (lib/api/next.ts); the in-browser gateway (lib/local/router.ts) calls them directly.
 * Nothing in here knows whether it runs on a server or in a browser tab.
 */
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { auditLog, roots } from "../db/schema";
import { act, attachDemoAgents, createDemoAgents, DEMO_ACTIONS, demoHello, ensureCounterparty, hasDemoAgents, isDemoAgent, runTool, TOOL_AGENTS } from "../demo/agents";
import * as E from "../envelope/core";
import * as G from "../gateway/service";
import { verifyChain } from "../ledger/chain";
import { paypalMode } from "../paypal/client";
import { REASON_TEXT } from "../reasons";

export type Input = { params: Record<string, string>; body: unknown };
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
const spendStatus = (s: string) => (s === "DENIED" ? 403 : s === "FAILED" ? 502 : s === "LAPSED" ? 409 : 200);

export const handlers: Record<string, Handler> = {
  "GET /api/envelopes": async () => ({ body: { roots: await getDb().select().from(roots).orderBy(desc(roots.createdAt)).limit(30) } }),

  /** Seal: register a root envelope signed by the principal; the gateway places the PayPal hold. */
  "POST /api/envelopes": async ({ body }) => {
    const b = z.object({ chain: z.array(z.any()).length(1), principalName: z.string().max(80).default("Principal"), title: z.string().max(120).default("Envelope"), draftId: z.string().max(60).optional() }).parse(body);
    const root = await G.registerRoot({ chain: b.chain, principalName: b.principalName, title: b.title });
    return { body: { root, demoAgents: b.draftId ? await attachDemoAgents(b.draftId, b.chain) : false } };
  },

  "GET /api/envelopes/:id": async ({ params }) => {
    const id = params.id!;
    let t = await G.tree(id);
    if (!t) return { status: 404, body: { error: "No such envelope." } };
    // pending payouts: ask PayPal (cheap GET) so the page settles by itself
    const pending = t.spends.filter((s) => s.status === "PAYOUT_PENDING").slice(0, 3);
    if (pending.length) { await Promise.all(pending.map((s) => G.syncSpend(s.id).catch(() => null))); t = (await G.tree(id))!; }
    const trail = await getDb().select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(asc(auditLog.seq));
    const audit = verifyChain(t.root.principal, id, trail.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })) as never);
    return { body: {
      mode: paypalMode(), root: t.root, demoAgents: await hasDemoAgents(id), payees: t.payees,
      blocks: t.blocks.map(({ raw: _raw, ...b }) => b),
      spends: t.spends.map(({ signed: _s, receipt: _r, payoutTo: _p, ...s }) => ({ ...s, hasReceipt: Boolean(_r) })),
      audit: { ok: audit.ok, length: audit.length, entries: trail.map((x) => ({ seq: x.seq, at: x.createdAt, actor: x.actor, action: x.action, ref: x.ref, outcome: x.outcome })) },
    } };
  },

  /** A receipt, its full authority chain, and a live check of it against PayPal. */
  "GET /api/spends/:id": async ({ params }) => {
    const r = await G.reconcile(params.id!);
    return { body: { ok: r.ok, checks: r.checks, receipt: r.receipt, chain: r.spend.signed.chain, spend: { id: r.spend.id, status: r.spend.status, payoutStatus: r.spend.payoutStatus, payoutTransactionId: r.spend.payoutTransactionId, agentNote: r.spend.agentNote } } };
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
    return { body: { ...p, mode: paypalMode(), demo: await isDemoAgent(key) } };
  },

  /** An agent's record, signed by the gateway so the agent can show it to anyone. */
  "GET /api/agents/:key/reference": async ({ params }) => {
    if (!KEY.test(params.key!)) return { status: 400, body: { error: "Not an agent key." } };
    const r = await G.reference(params.key!);
    return r ? { body: { reference: r } } : { status: 404, body: { error: "No agent with that key has been seen by this gateway." } };
  },

  /** One owner's treasury: every envelope sealed with that key, the agents under them, and where the money went. */
  "GET /api/treasury/:principal": async ({ params }) => {
    if (!KEY.test(params.principal!)) return { status: 400, body: { error: "Not an owner key." } };
    const t = await G.treasury(params.principal!);
    return t ? { body: t } : { status: 404, body: { error: "No envelope has been sealed with that key." } };
  },

  /** Check that owner's recent payments against PayPal's own records. */
  "POST /api/treasury/:principal/reconcile": async ({ params }) => {
    if (!KEY.test(params.principal!)) return { status: 400, body: { error: "Not an owner key." } };
    const r = await G.reconcileTreasury(params.principal!);
    return r ? { body: r } : { status: 404, body: { error: "No envelope has been sealed with that key." } };
  },

  /** Open an account that can receive: signed by the agent's key and by its owner's key. */
  "POST /api/accounts": async ({ body }) => {
    const { signed } = z.object({ signed: z.object({ body: z.any(), agentSig: z.string(), ownerSig: z.string() }) }).parse(body);
    const a = await G.openAccount(signed as never);
    return { body: { account: a.account, payee: E.accountPayee(a.agent), agent: a.agent, label: a.label, owner: a.ownerName, settlesTo: G.maskEmail(a.settleTo) } };
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
    return { status: spendStatus(r.status), body: spendOut(r) };
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
    return { body: { block: { id: r.block.id, revokedAt: r.block.revokedAt }, root: { status: r.root.status, capturedMinor: r.root.capturedMinor, releasedMinor: r.root.releasedMinor } } };
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
    const b = z.object({ rootId: z.string().max(60), action: z.enum(DEMO_ACTIONS) }).parse(body);
    const r = await act(b.rootId, b.action);
    return { body: { action: r.action, narration: r.narration, status: r.result?.status ?? null, reasons: withMeaning(r.result?.reasons ?? []) } };
  },

  /** DEMO: carry out one tool call a language model made while playing a built-in agent. The gateway decides. */
  "POST /api/demo/tool": async ({ body }) => {
    const b = z.object({ rootId: z.string().max(60), agent: z.enum(TOOL_AGENTS), tool: z.string().max(40), args: z.record(z.string(), z.unknown()).default({}) }).parse(body);
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
    return { status: out.status ?? 200, body: out.body };
  } catch (e) {
    const { UserFacingError } = await import("../errors");
    if (e instanceof UserFacingError) return { status: e.status, body: { error: e.message } };
    if (e instanceof z.ZodError) return { status: 400, body: { error: "Invalid request", issues: e.issues.map((i) => i.path.join(".") + ": " + i.message) } };
    console.error("[envelope] unhandled", e);
    return { status: 500, body: { error: "Something went wrong. It has been logged." } };
  }
}
