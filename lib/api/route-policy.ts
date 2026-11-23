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
 * Since Milestone 4.4 every route that reads one organization's records says so here (`session: "required"`), and
 * `lib/api/next.ts` enforces it: no session is a 401, the permission named here is checked against the caller's
 * membership role, and the read itself runs inside a transaction carrying the caller's organization, so another
 * organization's id (or an unattributed row) is a 404. The public surface is the signed-only proof graph, whose
 * records anyone may re-verify; a receipt with live provider checks and the organization's books are not public.
 *
 * `enforcement` therefore means what it says across the whole table: nothing is classified and left unchecked.
 *
 * The matrix in docs/MILESTONE_4_ROUTE_AUTHORIZATION_MATRIX.md is generated from this file.
 */
import type { Permission } from "../identity/permissions";

export type RouteCategory =
  | "public"
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
  /** `"required"`: the HTTP wrapper refuses a request with no valid session, and enforces `permission`. */
  session?: "required";
  note: string;
};

export const ROUTE_POLICY: Readonly<Record<string, RoutePolicy>> = {
  // ---- Envelopes: sealing is the principal's own signed chain ----
  "POST /api/envelopes/mine": { category: "signed-owner", permission: "envelope.read", enforcement: "enforced", note: "Owner read signature over the request. A session is required as well once org context lands (4.4)." },
  "POST /api/envelopes/approval": { category: "signed-principal", permission: "envelope.seal", enforcement: "enforced", note: "The root block is verified before the rail is asked; nothing is held or recorded." },
  "POST /api/envelopes": { category: "signed-principal", permission: "envelope.seal", enforcement: "enforced", note: "Chain verified, budget checked, hold placed on the principal's instrument." },
  "GET /api/envelopes/:id": { category: "session", permission: "envelope.read", enforcement: "enforced", session: "required", note: "Sign-in required. Read inside the caller's organization: another organization's envelope, or an unattributed one, is 404." },
  "GET /api/envelopes/:id/paypal": { category: "session", permission: "audit.read", enforcement: "enforced", session: "required", note: "Sign-in required; audit.read. The provider trail of a payment is not public, even to someone holding the id." },

  // ---- Payments ----
  "POST /api/gateway/spend": { category: "signed-agent", permission: null, enforcement: "enforced", note: "The agent's signed request and chain are the authority; a human session is never required." },
  "POST /api/gateway/promise": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Same signed-agent protocol." },
  "POST /api/gateway/keep": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the promise's maker." },
  "POST /api/gateway/accept": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the key the promise named." },
  "POST /api/gateway/standing": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Read-only: would this payment be accepted? Moves no money." },
  "POST /api/gateway/announce": { category: "signed-agent", permission: "envelope.read", enforcement: "enforced", note: "Chain verified; a split is optional to announce." },
  "POST /api/gateway/revoke": { category: "signed-agent", permission: "envelope.revoke", enforcement: "enforced", note: "Signed by the principal or an ancestor holder." },
  "GET /api/spends/:id": { category: "session", permission: "payment.read", enforcement: "enforced", session: "required", note: "Sign-in required. Receipt and live provider check, scoped to the caller's organization; another organization's payment is 404 before the rail is asked. The shareable view of one payment is the signed-only proof page." },
  "GET /api/spends/:id/status": { category: "session", permission: "payment.read", enforcement: "enforced", session: "required", note: "Sign-in required. The organization check runs before the provider is asked, so another organization's payment is 404 without disclosing that it exists." },
  "GET /api/spends/:id/evidence": { category: "session", permission: "audit.read", enforcement: "enforced", session: "required", note: "Sign-in required; audit.read. Dispute evidence names the payer, the limits and the whole chain, so it is never public." },
  "POST /api/spends/:id/recall": { category: "signed-owner", permission: "refund.issue", enforcement: "enforced", note: "Owner read signature; the cancel and refund run under the settlement lease." },

  // ---- Treasury and statements ----
  "POST /api/treasury/:principal": { category: "signed-owner", permission: "payment.read", enforcement: "enforced", note: "Owner read signature. A session in the same organization is required in 4.4." },
  "POST /api/treasury/:principal/reconcile": { category: "signed-owner", permission: "statement.read", enforcement: "enforced", note: "Owner read signature; compares recorded payments with the provider." },
  "GET /api/bank": { category: "session", permission: "statement.read", enforcement: "enforced", session: "required", note: "Sign-in required; statement.read. Balances and ledger are the caller's organization's. The PayPal reserve figures stay provider-level until provider accounts are partitioned, and the response says so." },
  "GET /api/bank/statement": { category: "session", permission: "statement.read", enforcement: "enforced", session: "required", note: "Sign-in required; statement.read. The comparison itself is the deployment's provider account, which is why it needs a permission rather than being public." },
  "GET /api/bank/transfers/:id": { category: "session", permission: "payment.read", enforcement: "enforced", session: "required", note: "Sign-in required. A balance movement by id, scoped to the caller's organization; another organization's movement is 404 before the rail is asked." },

  // ---- People in the organization (Milestone 4.6) ----
  "GET /api/organizations/members": { category: "session", permission: "member.read", enforcement: "enforced", session: "required", note: "Sign-in required; member.read. The roster and the outstanding invitations of the caller's own organization, which comes from the session and never from the request." },
  "POST /api/organizations/invitations": { category: "session", permission: "member.manage", enforcement: "enforced", session: "required", note: "Sign-in required; member.manage. The role invited may not carry a permission the caller lacks, so an admin cannot mint an owner. The one-time link is returned once; the row keeps a hash." },
  "POST /api/organizations/invitations/:id/revoke": { category: "session", permission: "member.manage", enforcement: "enforced", session: "required", note: "Sign-in required; member.manage. Withdraws a pending invitation of the caller's organization; one that does not exist there is a 404." },
  "POST /api/organizations/members/:userId/role": { category: "session", permission: "member.manage", enforcement: "enforced", session: "required", note: "Sign-in required; member.manage. A role may be granted only if the caller holds all of it, and changed only if they hold all of the role being taken away, so an admin can neither make nor demote an owner. Nobody changes their own role, and the only owner cannot be demoted." },
  "POST /api/organizations/members/:userId/remove": { category: "session", permission: "member.manage", enforcement: "enforced", session: "required", note: "Sign-in required; member.manage. Revokes a membership of the caller's organization (the row is kept as REVOKED with who and when); the same both-sides authority rule as a role change, no self-removal, and never the only owner." },

  // ---- Accounts, balances, cards ----
  "POST /api/accounts": { category: "signed-principal", permission: null, enforcement: "enforced", note: "Signed by the agent's key and its owner's key." },
  "POST /api/bank/transfer": { category: "signed-agent", permission: null, enforcement: "enforced", note: "Signed by the account's agent; internal debit plus optional payout." },
  "POST /api/bank/freeze": { category: "signed-owner", permission: "budget.manage", enforcement: "enforced", note: "Signed by the account's owner." },
  "POST /api/bank/refund": { category: "signed-agent", permission: "refund.issue", enforcement: "enforced", note: "Signed by the agent whose balance is debited." },
  "GET /api/cards": { category: "session", permission: "provider.read", enforcement: "enforced", session: "required", note: "Sign-in required; provider.read. Cards and the accounts that could issue one, for the caller's organization only." },
  "GET /api/cards/:id": { category: "session", permission: "payment.read", enforcement: "enforced", session: "required", note: "Sign-in required. A card's signed terms and charges, by id, scoped to the caller's organization." },
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

  "app/api/session/organization/route.ts": { category: "session", permission: null, enforcement: "enforced", note: "Sign-in required, enforced by the route itself because it reads the session cookie rather than a signed body. Lists the organizations this person may choose between and switches the session row's active one, after an active-membership check." },

  "app/api/invitations/accept/route.ts": { category: "session", permission: null, enforcement: "enforced", note: "Sign-in required, enforced by the route itself: the caller is signed in and has no membership in the inviting organization yet, which is the one case requestScope refuses. The token is single use, the address must match a verified email, and a GET of the link consumes nothing." },
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
