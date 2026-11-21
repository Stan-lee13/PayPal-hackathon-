/**
 * Every HTTP route, classified.
 *
 * This is a table, not prose, because a test asserts that it covers every registered handler and every
 * route file under app/api. A new route without a classification fails the suite.
 *
 * `enforcement` is stated honestly:
 *
 *   • `enforced` — the route itself checks authority today (a signature, a provider signature, a bearer secret,
 *     a production refusal, or nothing to protect);
 *   • `documented-gap` — the route is classified, and the session/permission it must gain in the tenant phase is
 *     named, but it does not enforce that yet. These are the addressed-by-id reads and the operator reads that
 *     were written for a single-operator deployment.
 *
 * Since Milestone 4.3 the addressed reads are **scoped** when the request carries a session: the organization is
 * resolved from the server-validated session, the row is read inside a transaction that carries it, and another
 * organization's id is a 404. They are not yet **required** to carry a session, so they stay `documented-gap`: a
 * caller with no cookie still sees what it saw before. That is the next step, and it needs the console to have a
 * production sign-in.
 *
 * The matrix in docs/MILESTONE_4_ROUTE_AUTHORIZATION_MATRIX.md is generated from this file.
 */
import type { Permission } from "../identity/permissions";

export type RouteCategory =
  | "public"
  | "public-read"
  | "signed-principal"
  | "signed-agent"
  | "signed-owner"
  | "session"
  | "webhook"
  | "simulation"
  | "demo"
  | "scheduler"
  | "operator-key";

export type Enforcement = "enforced" | "documented-gap";

export type RoutePolicy = {
  category: RouteCategory;
  /** The permission this route needs, or must gain when it becomes session-authenticated. Null: none. */
  permission: Permission | null;
  enforcement: Enforcement;
  note: string;
};

export const ROUTE_POLICY: Readonly<Record<string, RoutePolicy>> = {
  // ---- Envelopes: sealing is the principal's own signed chain ----
  "POST /api/envelopes/mine": { category: "signed-owner", permission: "envelope.read", enforcement: "enforced", note: "Owner read signature over the request. A session is required as well once org context lands (4.4)." },
  "POST /api/envelopes/approval": { category: "signed-principal", permission: "envelope.seal", enforcement: "enforced", note: "The root block is verified before the rail is asked; nothing is held or recorded." },
  "POST /api/envelopes": { category: "signed-principal", permission: "envelope.seal", enforcement: "enforced", note: "Chain verified, budget checked, hold placed on the principal's instrument." },
  "GET /api/envelopes/:id": { category: "public-read", permission: "envelope.read", enforcement: "documented-gap", note: "Addressed by envelope id. Scoped to the caller's organization when a session is present (another organization's envelope, or an unattributed one, is 404). It is still readable without a session, which is the gap: it needs one." },
  "GET /api/envelopes/:id/paypal": { category: "public-read", permission: "audit.read", enforcement: "documented-gap", note: "Provider call trail for an envelope by id, scoped to the caller's organization when a session is present. Same remaining gap as the envelope read." },

  // ---- Payments ----
  "POST /api/gateway/spend": { category: "signed-agent", permission: null, enforcement: "enforced", note: "The agent's signed request and chain are the authority; a human session is never required." },
  "POST /api/gateway/promise": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Same signed-agent protocol." },
  "POST /api/gateway/keep": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the promise's maker." },
  "POST /api/gateway/accept": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the key the promise named." },
  "POST /api/gateway/standing": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Read-only: would this payment be accepted? Moves no money." },
  "POST /api/gateway/announce": { category: "signed-agent", permission: "envelope.read", enforcement: "enforced", note: "Chain verified; a split is optional to announce." },
  "POST /api/gateway/revoke": { category: "signed-agent", permission: "envelope.revoke", enforcement: "enforced", note: "Signed by the principal or an ancestor holder." },
  "GET /api/spends/:id": { category: "public-read", permission: "payment.read", enforcement: "documented-gap", note: "Receipt and live check by spend id, scoped to the caller's organization when a session is present; another organization's payment is 404 before the rail is asked. It still needs a session, which is the next step." },
  "GET /api/spends/:id/status": { category: "public-read", permission: "payment.read", enforcement: "documented-gap", note: "Status by spend id. The organization check runs first, so another organization's payment is 404 without asking the provider. It still needs a session, which is the next step." },
  "GET /api/spends/:id/evidence": { category: "public-read", permission: "audit.read", enforcement: "documented-gap", note: "Dispute evidence by spend id, scoped to the caller's organization when a session is present. It still needs a session, which is the next step." },
  "POST /api/spends/:id/recall": { category: "signed-owner", permission: "refund.issue", enforcement: "enforced", note: "Owner read signature; the cancel and refund run under the settlement lease." },

  // ---- Treasury and statements ----
  "POST /api/treasury/:principal": { category: "signed-owner", permission: "payment.read", enforcement: "enforced", note: "Owner read signature. A session in the same organization is required in 4.4." },
  "POST /api/treasury/:principal/reconcile": { category: "signed-owner", permission: "statement.read", enforcement: "enforced", note: "Owner read signature; compares recorded payments with the provider." },
  "GET /api/bank": { category: "public-read", permission: "statement.read", enforcement: "documented-gap", note: "Balances and ledger scoped to the caller's organization when a session is present. The reserve figures stay provider-level until provider accounts are partitioned. It still needs a session, which is the next step." },
  "GET /api/bank/statement": { category: "public-read", permission: "statement.read", enforcement: "documented-gap", note: "The provider's statement for the deployment's account: it belongs to a provider account, not an organization, so it is operator-level until provider accounts are partitioned. Needs a session and statement.read." },
  "GET /api/bank/transfers/:id": { category: "public-read", permission: "payment.read", enforcement: "documented-gap", note: "Balance movement by id, scoped to the caller's organization when a session is present; another organization's movement is 404 before the rail is asked. It still needs a session, which is the next step." },

  // ---- Accounts, balances, cards ----
  "POST /api/accounts": { category: "signed-principal", permission: null, enforcement: "enforced", note: "Signed by the agent's key and its owner's key." },
  "POST /api/bank/transfer": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the account's agent; internal debit plus optional payout." },
  "POST /api/bank/freeze": { category: "signed-owner", permission: "budget.manage", enforcement: "enforced", note: "Signed by the account's owner." },
  "POST /api/bank/refund": { category: "signed-agent", permission: "refund.issue", enforcement: "enforced", note: "Signed by the agent whose balance is debited." },
  "GET /api/cards": { category: "public-read", permission: "provider.read", enforcement: "documented-gap", note: "Cards and the accounts that could issue one, scoped to the caller's organization when a session is present. It still needs a session, which is the next step." },
  "GET /api/cards/:id": { category: "public-read", permission: "payment.read", enforcement: "documented-gap", note: "A card's signed terms and charges, by id, scoped to the caller's organization when a session is present. It still needs a session, which is the next step." },
  "POST /api/cards": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the issuing agent." },
  "POST /api/cards/charge": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the merchant the card is locked to." },
  "POST /api/cards/cancel": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the holder or the account's owner." },

  // ---- Proofs and public profiles ----
  "GET /api/proof/:root": { category: "public", permission: null, enforcement: "enforced", note: "Signed records only; nothing private is added." },
  "GET /api/proof/:root/:spend": { category: "public", permission: null, enforcement: "enforced", note: "One payment's path back to the owner." },
  "GET /api/agents": { category: "public", permission: null, enforcement: "enforced", note: "Recently seen agents, as already published." },
  "GET /api/agents/:key": { category: "public", permission: null, enforcement: "enforced", note: "Public agent profile by key or account number." },
  "GET /api/agents/:key/reference": { category: "public", permission: null, enforcement: "enforced", note: "Gateway-signed reference." },
  "GET /api/gateway/key": { category: "public", permission: null, enforcement: "enforced", note: "The gateway's public signing key. Public by design; private material is never returned." },

  // ---- Provider ingress and background work ----
  "POST /api/rails/webhook": { category: "webhook", permission: null, enforcement: "enforced", note: "Provider signature first; the event only points at a record that is then read by id." },
  "POST /api/paypal/webhook": { category: "webhook", permission: null, enforcement: "enforced", note: "The same handler under PayPal's existing path." },
  "POST /api/sweep": { category: "scheduler", permission: null, enforcement: "enforced", note: "Bearer CRON_SECRET; in production a missing secret refuses (503) instead of allowing anonymous calls." },
  "GET /api/sweep": { category: "scheduler", permission: null, enforcement: "enforced", note: "The same, for schedulers that can only GET." },

  // ---- Demo and simulation ----
  "POST /api/sim/paypal/approve": { category: "simulation", permission: null, enforcement: "enforced", note: "Simulator only; refused in production and 404 unless the rail is the simulator." },
  "POST /api/demo/agents": { category: "demo", permission: null, enforcement: "enforced", note: "Creates demo keys server-side. Refused in production." },
  "GET /api/demo/counterparty": { category: "demo", permission: null, enforcement: "enforced", note: "Refused in production." },
  "POST /api/demo/act": { category: "demo", permission: null, enforcement: "enforced", note: "Owner-signed; still refused in production." },
  "POST /api/demo/bank": { category: "demo", permission: null, enforcement: "enforced", note: "Refused in production." },
  "POST /api/demo/tool": { category: "demo", permission: null, enforcement: "enforced", note: "Owner-signed; refused in production." },
  "POST /api/demo/dispute": { category: "demo", permission: null, enforcement: "enforced", note: "Refused in production and on a real rail." },
  "POST /api/demo/hello": { category: "demo", permission: null, enforcement: "enforced", note: "Refused in production." },

  // ---- Operator tools ----
  "GET /api/auditor": { category: "operator-key", permission: null, enforcement: "enforced", note: "Requires AUDITOR_SECRET as a bearer token; 503 when unconfigured." },
  "POST /api/auditor/read": { category: "operator-key", permission: null, enforcement: "enforced", note: "Read tools only; refused without the operator key." },
  "POST /api/auditor/check": { category: "operator-key", permission: null, enforcement: "enforced", note: "Checks a proposal against the records; moves nothing." },
};

/** Route files that are not thin wrappers over lib/api/handlers.ts. Each is classified here too. */
export const SPECIAL_ROUTE_FILES: Readonly<Record<string, RoutePolicy>> = {
  "app/api/auth/[...auth]/route.ts": { category: "session", permission: null, enforcement: "enforced", note: "The OIDC sign-in/callback/sign-out endpoint. Validates code, PKCE, state, nonce and issuer; creates a server-side session." },
  "app/api/health/route.ts": { category: "public", permission: null, enforcement: "enforced", note: "Deployment and rail capabilities. No tenant data; says whether keys are sealed and not their contents." },
  "app/api/ai/status/route.ts": { category: "public", permission: null, enforcement: "enforced", note: "Whether a model is connected. Moves no money and reads no tenant data." },
  "app/api/ai/turn/route.ts": { category: "demo", permission: null, enforcement: "enforced", note: "A model's proposal for a demo agent; the browser turns it into signed requests and the gateway decides." },
  "app/api/ai/audit/route.ts": { category: "demo", permission: null, enforcement: "enforced", note: "A model playing the auditor: read tools and proposals only; it cannot move money." },
  "app/api/dev/session/route.ts": { category: "demo", permission: null, enforcement: "enforced", note: "Development sign-in for the console: refused (404) in production and when the gateway runs in the browser. It creates a real user, organization, membership and server-side session, which every later check validates." },
};

export function policyFor(key: string): RoutePolicy | null {
  return ROUTE_POLICY[key] ?? null;
}

/** Handlers registered without a classification. Must be empty. */
export function unclassifiedHandlers(keys: readonly string[]): string[] {
  return keys.filter((k) => !ROUTE_POLICY[k]);
}

/** Classifications for handlers that no longer exist. Must be empty, so the table cannot rot. */
export function staleRoutePolicies(keys: readonly string[]): string[] {
  const live = new Set(keys);
  return Object.keys(ROUTE_POLICY).filter((k) => !live.has(k));
}

/** Demo and simulation routes are development tools. Production refuses them outright. */
export const demoEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.NODE_ENV !== "production";
