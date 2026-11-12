/**
 * A connection to one Envelope gateway. Everything here is plain HTTP and JSON: there is no secret
 * to configure, because the gateway takes its orders from signatures, not from who is calling.
 * The gateway is the only thing that talks to PayPal; nothing in this file can reach PayPal.
 */
import type { SignedRefund } from "../../lib/envelope/core";
import type { Envelope, SignedAccept, SignedAccount, SignedCard, SignedCardCancel, SignedCharge, SignedFreeze, SignedHello, SignedKeep, SignedPromise, SignedRead, SignedRevoke, SignedSpend, SignedTransfer } from "../../lib/envelope/core";
import { EnvelopeError } from "./errors";
import type { AccountOpened, AgentProfile, Books, Card, ChargeOutcome, EnvelopeState, FreezeResult, GatewayKey, GatewayReason, PayPalTrail, Evidence, PaymentStatus, PromiseOutcome, Recalled, ReceiptResponse, RefundOutcome, StatementCheck, Reference, RevokeResult, RootState, SpendOutcome, Standing, TransferOutcome } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type GatewayOptions = {
  /** Use this instead of the global fetch (tests, proxies, logging). */
  fetch?: FetchLike;
  /** How many times to resend the identical request when the gateway is unreachable, busy or rate limiting. Default 2. */
  retries?: number;
  /** Give up on one attempt after this long. Default 60 s: a payment waits for PayPal twice. */
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const REFUSED = new Set(["DENIED", "FAILED", "LAPSED"]);

export class Gateway {
  readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private pinned: Promise<GatewayKey> | null = null;

  constructor(url: string, opts: GatewayOptions = {}) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new EnvelopeError(`Not a gateway URL: ${String(url)}`, { kind: "local" });
    this.url = url.replace(/\/+$/, "");
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new EnvelopeError("No fetch available: pass one in the options.", { kind: "local" });
    this.fetchImpl = opts.fetch ?? ((input, init) => f(input, init));
    this.retries = Math.max(0, opts.retries ?? 2);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /**
   * One call. The body is serialized once and the same bytes are resent on a retry, so a signed
   * request that did arrive the first time is recognised and never carried out twice.
   */
  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let last: EnvelopeError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.url}${path}`, { method, headers: payload === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" }, body: payload, signal: ctl.signal });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.status === 429 || res.status === 503) { last = new EnvelopeError(typeof json.error === "string" ? json.error : `The gateway answered ${res.status}.`, { kind: "gateway", status: res.status, body: json }); continue; }
        return { status: res.status, json };
      } catch (e) {
        last = new EnvelopeError(`The gateway at ${this.url} could not be reached: ${(e as Error)?.message ?? String(e)}`, { kind: "network" });
      } finally { clearTimeout(timer); }
    }
    throw last!;
  }

  /** A read, or a write that has no verdict of its own: anything but 2xx is an error. */
  private async ok<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const r = await this.request(method, path, body);
    if (r.status < 200 || r.status >= 300) throw new EnvelopeError(typeof r.json.error === "string" ? r.json.error : `The gateway answered ${r.status}.`, { kind: "gateway", status: r.status, body: r.json });
    return r.json as T;
  }

  /**
   * A money request. The gateway answers with a verdict in `status`; DENIED, FAILED and LAPSED mean
   * the thing asked for did not happen and are thrown, with the reasons attached.
   */
  private async verdict<T extends { status: string; reasons?: GatewayReason[] }>(path: string, body: unknown, fine: (o: T) => boolean = () => false): Promise<T> {
    const r = await this.request("POST", path, body);
    const o = r.json as unknown as T;
    if (typeof o.status !== "string") throw new EnvelopeError(typeof r.json.error === "string" ? r.json.error : `The gateway answered ${r.status}.`, { kind: "gateway", status: r.status, body: r.json });
    if (REFUSED.has(o.status) && !fine(o)) {
      const why = (o.reasons ?? []).map((x) => `${x.code}: ${x.detail}`).join("; ");
      throw new EnvelopeError(`${o.status}${why ? ` (${why})` : ""}. ${o.status === "DENIED" ? "Nothing moved." : "Nothing was paid."}`, { kind: "gateway", status: r.status, outcome: o.status, reasons: o.reasons ?? [], body: r.json });
    }
    return o;
  }

  // ───────────────────────────── reads: no signature needed, no money moves ─────────────────────────────

  /** The gateway's public key. Fetched once and remembered, so later answers can be checked against it. */
  key(): Promise<GatewayKey> {
    this.pinned ??= this.ok<GatewayKey>("GET", "/api/gateway/key").catch((e) => { this.pinned = null; throw e; });
    return this.pinned;
  }
  /** An envelope as the gateway knows it: every block, what is spent and reserved at each, every request made under it. */
  envelope(rootId: string): Promise<EnvelopeState> { return this.ok("GET", `/api/envelopes/${encodeURIComponent(rootId)}`); }
  /** An agent's public profile, by key or by account number (acct:xxxx-xxxx-xxxx). */
  agent(keyOrAccount: string): Promise<AgentProfile> { return this.ok("GET", `/api/agents/${encodeURIComponent(keyOrAccount)}`); }
  /** An agent's record, signed by the gateway. */
  async reference(key: string): Promise<Reference> { return (await this.ok<{ reference: Reference }>("GET", `/api/agents/${encodeURIComponent(key)}/reference`)).reference; }
  /** A receipt with its full chain, and the gateway's comparison of it with PayPal's own records, made now. */
  receipt(spendId: string): Promise<ReceiptResponse> { return this.ok("GET", `/api/spends/${encodeURIComponent(spendId)}`); }
  /** The proof graph of an envelope, or of one payment in it. */
  proof(rootId: string, spendId?: string): Promise<Record<string, unknown>> { return this.ok("GET", `/api/proof/${encodeURIComponent(rootId)}${spendId ? `/${encodeURIComponent(spendId)}` : ""}`); }
  card(cardId: string): Promise<Card> { return this.ok("GET", `/api/cards/${encodeURIComponent(cardId)}`); }
  /** A transfer out of a balance. Looking at it asks PayPal how its payout is doing. */
  transfer(transferId: string): Promise<Record<string, unknown>> { return this.ok("GET", `/api/bank/transfers/${encodeURIComponent(transferId)}`); }
  /** Every call the gateway made to PayPal for one envelope: what was asked, PayPal's ids and what PayPal answered. */
  paypalTrail(rootId: string): Promise<PayPalTrail> { return this.ok("GET", `/api/envelopes/${encodeURIComponent(rootId)}/paypal`); }
  /** The gateway's captures and payouts against PayPal's own statement of its account. */
  statement(): Promise<StatementCheck> { return this.ok("GET", "/api/bank/statement"); }
  /** What the gateway would send PayPal if the payer disputed this payment. */
  evidence(spendId: string): Promise<Evidence> { return this.ok("GET", `/api/spends/${encodeURIComponent(spendId)}/evidence`); }
  /** Every balance, whether the books add up, and whether PayPal's reported balance covers what agents are owed. */
  books(): Promise<Books> { return this.ok("GET", "/api/bank"); }

  // ───────────────────────────── signed requests: the signature is the authority ─────────────────────────────

  /** Ask whether an introduction would be honoured. Read-only; the answer is signed by the gateway. */
  async standing(hello: SignedHello): Promise<Standing> { return (await this.ok<{ standing: Standing }>("POST", "/api/gateway/standing", { hello })).standing; }
  /** Tell the gateway about a split so the owner can see and revoke it. A split is valid without this. */
  announce(chain: Envelope): Promise<{ ids: string[] }> { return this.ok("POST", "/api/gateway/announce", { chain }); }
  spend(signed: SignedSpend, note?: string): Promise<SpendOutcome> { return this.verdict("/api/gateway/spend", { signed, note }); }
  promise(signed: SignedPromise, note?: string): Promise<PromiseOutcome> { return this.verdict("/api/gateway/promise", { signed, note }); }
  /** Pay or release a promise. Releasing answers LAPSED, which is what was asked for. */
  keep(signed: SignedKeep, note?: string): Promise<SpendOutcome> { return this.verdict("/api/gateway/keep", { signed, note }, (o: SpendOutcome) => signed.request.action === "release" && o.status === "LAPSED"); }
  /** The named key accepts (pays) or declines (releases) a promise. Declining answers LAPSED, which is what was asked for. */
  accept(signed: SignedAccept): Promise<SpendOutcome> { return this.verdict("/api/gateway/accept", { signed }, (o: SpendOutcome) => signed.request.decline === true && o.status === "LAPSED"); }
  revoke(signed: SignedRevoke): Promise<RevokeResult> { return this.ok("POST", "/api/gateway/revoke", { signed }); }
  /** Seal a root envelope: the gateway asks PayPal to hold the money. */
  async seal(chain: Envelope, p: { ownerName?: string; title?: string } = {}): Promise<RootState> {
    return (await this.ok<{ root: RootState }>("POST", "/api/envelopes", { chain, principalName: p.ownerName, title: p.title })).root;
  }
  openAccount(signed: SignedAccount): Promise<AccountOpened> { return this.ok("POST", "/api/accounts", { signed }); }
  sendTransfer(signed: SignedTransfer): Promise<TransferOutcome> { return this.verdict("/api/bank/transfer", { signed }); }
  /** A payee's refund of one payment it kept. PayPal refunds the capture to the owner. */
  refund(signed: SignedRefund): Promise<RefundOutcome> { return this.verdict("/api/bank/refund", { signed }); }
  freeze(signed: SignedFreeze): Promise<FreezeResult> { return this.ok("POST", "/api/bank/freeze", { signed }); }
  issueCard(signed: SignedCard): Promise<Card> { return this.ok("POST", "/api/cards", { signed }); }
  charge(signed: SignedCharge): Promise<ChargeOutcome> { return this.verdict("/api/cards/charge", { signed }); }
  cancelCard(signed: SignedCardCancel): Promise<Card> { return this.ok("POST", "/api/cards/cancel", { signed }); }
  /** An owner's books. Shown only to the owner: the read itself is signed. */
  treasury(signed: SignedRead): Promise<Record<string, unknown>> { return this.ok("POST", `/api/treasury/${encodeURIComponent(signed.by)}`, { signed }); }
  reconcileTreasury(signed: SignedRead): Promise<Record<string, unknown>> { return this.ok("POST", `/api/treasury/${encodeURIComponent(signed.by)}/reconcile`, { signed }); }
  async envelopesOf(signed: SignedRead): Promise<RootState[]> { return (await this.ok<{ roots: RootState[] }>("POST", "/api/envelopes/mine", { signed })).roots; }
  /** The owner calls back a payout PayPal is holding unclaimed: PayPal cancels it and the capture is refunded to the owner. */
  recall(spendId: string, signed: SignedRead): Promise<Recalled> { return this.ok("POST", `/api/spends/${encodeURIComponent(spendId)}/recall`, { signed }); }
  /** Where one payment stands, whatever its state. Asking makes the gateway ask PayPal. */
  status(spendId: string): Promise<PaymentStatus> { return this.ok("GET", `/api/spends/${encodeURIComponent(spendId)}/status`); }

  // ───────────────────────────── addresses a person can open ─────────────────────────────
  receiptUrl(spendId: string): string { return `${this.url}/r/${spendId}`; }
  envelopeUrl(rootId: string): string { return `${this.url}/e/${rootId}`; }
  proofUrl(rootId: string, spendId?: string): string { return `${this.url}/proof/${rootId}${spendId ? `/${spendId}` : ""}`; }
  agentUrl(key: string): string { return `${this.url}/a/${key}`; }
}
