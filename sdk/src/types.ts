/**
 * What the gateway sends back, as the SDK sees it. These are written out here, not imported from the
 * gateway's database code, so the package has no dependency on the server. `tests/sdk.test.ts`
 * checks at compile time that the gateway's own types are assignable to them.
 */
import type { Caps, Envelope, PromiseRequest, SignedCharge, SignedTransfer, SpendRequest } from "../../lib/envelope/core";

/** A reason the gateway gives for a refusal. `code` is stable; `meaning` is a sentence for people. */
export type GatewayReason = { code: string; at?: string | null; detail: string; meaning?: string };

/**
 * Where a payment from an envelope stands.
 * - `PAID`: PayPal captured the money and delivered the payout (or it was credited to an agent's balance).
 * - `PAYOUT_PENDING`: captured; PayPal has accepted the payout and not finished it.
 * - `UNCLAIMED`: captured; PayPal is holding the payout because the address has no PayPal account. NOT delivered.
 * - `CAPTURED` / `RESERVED`: interrupted mid-way; the gateway finishes it when it is next looked at.
 * - `REFUND_DUE`: the payout failed and PayPal has not yet accepted the refund to the owner.
 * - `PROMISED`: set aside, not paid. `LAPSED`: a promise that was released or ran out.
 * - `DENIED`: refused; nothing moved. `FAILED`: PayPal could not do it; nothing was paid.
 */
export type SpendStatus = "DENIED" | "PROMISED" | "LAPSED" | "RESERVED" | "CAPTURED" | "PAID" | "PAYOUT_PENDING" | "UNCLAIMED" | "FAILED" | "REFUND_DUE";
export type TransferStatus = "DENIED" | "BOOKED" | "SENDING" | "PAID" | "PAYOUT_PENDING" | "UNCLAIMED" | "FAILED";

export type Sponsor = { role: "owner" | "agent"; label: string; key: string };

/** Signed by the gateway when PayPal has captured a payment and a payout was asked for (or the money was credited to a balance). */
export type Receipt = {
  v: "envelope-receipt/1";
  spend: string;
  decision: "PAID";
  request: SpendRequest | PromiseRequest;
  requestSig: string;
  paidTo?: { account: string; agent: string; agentLabel: string; settledTo: string; held?: { ledgerEntry: number; balanceAfterMinor: number } };
  releasedBy?: { key: string; work: string; note: string; at: string };
  chain: Array<{ id: string; hash: string; holder: string; holderLabel: string }>;
  principal: string;
  /** `payoutStatus` is PayPal's word at the moment of signing; ask the gateway again for the current one. */
  paypal: { mode: string; authorizationId: string; captureId: string; payoutBatchId: string | null; payoutItemId: string | null; payoutStatus?: string | null };
  issuedAt: string;
  gateway: string;
  sig: string;
};

export type PayPalRefs = { captureId: string | null; payoutBatchId: string | null; payoutItemId: string | null; payoutStatus: string | null };

/** The body of every answer from the money endpoints (spend, promise, keep, accept). */
export type SpendOutcome = {
  status: SpendStatus;
  duplicate: boolean;
  spendId: string | null;
  reasons: GatewayReason[];
  paypal: PayPalRefs | null;
  receipt: Receipt | null;
};

/** What the gateway hands a payee when money has been set aside for it. Earmarked, not escrow: the owner can still revoke. */
export type PromiseNote = {
  v: "envelope-promise-note/1";
  promise: string;
  agent: string; agentLabel: string; account: string;
  sponsors: Sponsor[];
  root: string;
  amount: number; currency: string; payee: string; purpose: string;
  expiresAt: string;
  releaseBy?: string;
  paypal: { mode: string; authorizationId: string; status: string };
  issuedAt: string; gateway: string; sig: string;
};
export type PromiseOutcome = SpendOutcome & { promiseId: string | null; expiresAt: string | null; note: PromiseNote | null };

/** The gateway's signed answer to "is this agent good for the money?". Valid for five minutes. */
export type Standing = {
  v: "envelope-standing/1";
  agent: string; agentLabel: string; account: string;
  sponsors: Sponsor[];
  root: string;
  ask: { amount: number; currency: string; payee: string; purpose: string };
  good: boolean;
  reasons: Array<{ code: string; detail: string }>;
  availableMinor: number;
  /** `honoredUntil` is the end of PayPal's three-day honor period, when the hold is at its strongest; `authorizedUntil` is when the authorization itself ends (29 days). */
  paypal: { mode: string; authorizationId: string | null; status: string | null; unusedMinor: number | null; honoredUntil: string | null; authorizedUntil: string | null };
  issuedAt: string; validUntil: string; gateway: string; sig: string;
};

/** An agent's record, signed by the gateway. A record of what happened here, not a score. */
export type Reference = {
  v: "envelope-reference/1";
  agent: string; label: string; account: string;
  knownSince: string; asOf: string;
  answersForIt: string | null;
  facts: {
    paymentsSettled: number; paidMinor: number;
    promisesKept: number; promisesLapsed: number;
    requestsRefused: number; refusedFor: string[];
    envelopesHeld: number; envelopesRevoked: number;
    timesPaid: number; earnedMinor: number;
  };
  paypalMode: string; gateway: string; sig: string;
};

/** Where to send the payer to approve a hold in PayPal's own checkout, and the PayPal order that will carry it. */
export type ApprovalLink = { orderId: string; approveUrl: string; amountMinor: number; currency: string };
export type RootState = {
  id: string; principal: string; principalName: string; title: string; currency: string;
  limitMinor: number; status: "ACTIVE" | "CLOSED";
  paypalOrderId: string | null; authorizationId: string | null; authorizationExpiresAt: string | null;
  capturedMinor: number; /** Captured and then refunded to the owner. PayPal does not return it to the hold. */ refundedMinor: number; releasedMinor: number | null; closedAt: string | null; closeReason: string | null; createdAt: string;
};
export type BlockState = {
  id: string; rootId: string; parentId: string | null; depth: number; hash: string;
  holder: string; holderLabel: string; caps: Caps;
  spentMinor: number; reservedMinor: number; revokedAt: string | null; revokedBy: string | null; firstSeenAt: string;
};
export type SpendRow = {
  id: string; rootId: string; leafId: string; leafLabel: string; amountMinor: number; currency: string;
  payee: string; purpose: string; memo: string; agentNote: string | null; status: SpendStatus; reasons: GatewayReason[];
  captureId: string | null; payoutBatchId: string | null; payoutItemId: string | null; payoutStatus: string | null;
  promiseExpiresAt: string | null; createdAt: string; settledAt: string | null; hasReceipt: boolean; releaseBy?: string | null;
};
/** GET /api/envelopes/:id — an envelope as the gateway knows it. */
export type EnvelopeState = {
  mode: string; root: RootState; demoAgents: boolean;
  payees: Record<string, { label: string; key: string; owner: string }>;
  blocks: BlockState[]; spends: SpendRow[];
  audit: { ok: boolean; length: number; entries: Array<{ seq: number; at: string; actor: string; action: string; ref: string | null; outcome: string }> };
};

export type LedgerLine = { id: number; kind: string; ref: string; deltaMinor: number; balanceAfterMinor: number; counterparty: string | null; memo: string | null; at: string };
export type Balance = { minor: number; frozen: boolean; perPaymentMinor: number | null; perDayMinor: number | null; ledger: LedgerLine[] };

export type CardState = "ACTIVE" | "ENDED" | "CANCELLED" | "EXPIRED";
export type Card = {
  id: string; number: string; label: string; state: CardState;
  holder: { key: string; label: string; owner: string | null; frozen: boolean };
  merchant: { key: string; label: string; account: string | null };
  perChargeMinor: number; maxCharges: number; everySeconds: number; notAfter: string;
  charges: number; chargedMinor: number; lastChargeAt: string | null;
  nextChargeFrom?: string | null;
  [more: string]: unknown;
};

export type Holding = {
  blockId: string; rootId: string; rootTitle: string; depth: number; label: string;
  openedBy: Sponsor; sponsors: Sponsor[]; caps: Caps;
  spentMinor: number; reservedMinor: number; availableMinor: number; state: "LIVE" | "REVOKED" | "EXPIRED" | "CLOSED";
  issued: Array<{ blockId: string; label: string; key: string; limitMinor: number; revoked: boolean }>; openedAt: string;
};
/** GET /api/agents/:key — what anyone can see about an agent. */
export type AgentProfile = {
  key: string; account: string; label: string; firstSeenAt: string;
  accounts: Holding[];
  receives: { payee: string; owner: { label: string; key: string }; settlesTo: string; openedAt: string; holds: boolean } | null;
  balance: Balance | null;
  record: {
    payments: number; paidMinor: number; refused: number; refusedCodes: string[]; revoked: number; availableMinor: number;
    promisesKept: number; promisesLapsed: number; received: number; receivedMinor: number; setAsideForItMinor: number;
  };
  statement: SpendRow[]; incoming: SpendRow[];
  mode: string; demo: boolean; bankDemo: boolean; cards: Card[];
};

export type AccountOpened = { account: string; payee: string; agent: string; label: string; owner: string; settlesTo: string; holds: boolean; perPaymentMinor: number | null; balanceMinor: number };
export type FreezeResult = { account: string; agent: string; label: string; frozen: boolean; balanceMinor: number };

export type TransferReceipt = {
  v: "envelope-transfer-receipt/1";
  transfer: string;
  request: SignedTransfer["request"] | SignedCharge["request"];
  requestSig: string;
  card?: { id: string; number: string; label: string; charge: number; of: number };
  from: { account: string; agent: string; agentLabel: string };
  to: { kind: "account"; account: string; agent: string; agentLabel: string } | { kind: "paypal"; address: string; payoutBatchId: string; mode: string };
  balanceAfterMinor: number;
  issuedAt: string; gateway: string; sig: string;
};
export type TransferOutcome = {
  status: TransferStatus; duplicate: boolean; transferId: string | null; reasons: GatewayReason[];
  balanceMinor: number | null; paypal: { payoutBatchId: string; payoutStatus: string | null } | null; receipt: TransferReceipt | null;
};
/** What became of a refund an agent asked for. REFUNDED: PayPal refunded the capture to the owner. PENDING: the balance is debited and PayPal will be asked again. */
export type RefundOutcome = { status: "REFUNDED" | "PENDING" | "DENIED" | "FAILED"; spendId: string | null; refundId: string | null; reasons: GatewayReason[]; balanceMinor: number | null };
/** What the gateway owes against what PayPal says it holds. `covered` is null when PayPal could not be asked. */
export type Reserves = {
  mode: string; currency: string;
  owed: { balancesMinor: number; accountsWithMoney: number; refundsDueMinor: number; totalMinor: number; /** What was owed at the moment PayPal dates its balance: the figure `covered` compares with. */ atPayPalsTimeMinor: number };
  paypal: { availableMinor: number; totalMinor: number; withheldMinor: number; asOf: string | null } | null;
  covered: boolean | null; surplusMinor: number | null;
};
/** The gateway's records against PayPal's own statement of its account. PayPal's statement can lag by hours. */
export type StatementCheck = {
  mode: string; from: string; to: string; paypalLines: number; ours: number; listed: number; differs: number; notListedYet: number; otherActivity: number; ok: boolean;
  /** For the records PayPal lists: what came in, went out and was refunded, the fees PayPal charged, and what that leaves at PayPal. */
  position: { inMinor: number; outMinor: number; refundedMinor: number; feesMinor: number; netMinor: number };
  /** `spend` is the payment's id or, for a payout from an agent's balance, the transfer's. `feeMinor` is PayPal's fee on the line, once listed. A payout PayPal `returned` is not counted in `position`. */
  matches: Array<{ paypalId: string; what: "capture" | "payout" | "refund"; spend: string; amountMinor: number; listedMinor: number | null; feeMinor: number | null; returned: boolean; verdict: "listed" | "amount differs" | "not listed yet" }>;
};
/** What the gateway sends PayPal if a payer disputes a payment: the signed chain of authority, in words and in full. */
export type Evidence = {
  spend: string; amountMinor: number; currency: string; payee: string; purpose: string; summary: string; chainVerifies: boolean; payerKey: string;
  paypal: { mode: string; authorizationId: string | null; captureId: string; payoutBatchId: string | null };
  dispute: { id: string; status: string | null } | null; links: { proof: string; receipt: string }; whatItProves: string; [more: string]: unknown;
};
export type ChargeOutcome = {
  status: TransferStatus; duplicate: boolean; chargeId: string | null; reasons: GatewayReason[];
  card: { id: string; state: CardState; charges: number; maxCharges: number } | null;
  paypal: { payoutBatchId: string; payoutStatus: string | null } | null; receipt: TransferReceipt | null;
};

export type Check = { name: string; ok: boolean; detail?: string };
/** GET /api/spends/:id — a receipt, its full chain, and the gateway's live comparison of it with PayPal. */
export type ReceiptResponse = {
  ok: boolean; checks: Check[]; receipt: Receipt; chain: Envelope;
  spend: { id: string; status: SpendStatus; payoutStatus: string | null; payoutTransactionId: string | null; agentNote: string | null };
};

export type Books = {
  mode: string;
  accounts: Array<{ agent: string; account: string; label: string; owner: string; mode: "settle" | "hold"; balanceMinor: number; frozen: boolean; perPaymentMinor: number | null }>;
  totals: { accounts: number; holding: number; balancesMinor: number; capturedInMinor: number; paidOutMinor: number; refundedMinor: number; bookTransfers: number; bookTransferredMinor: number };
  checks: Check[];
  reserves: Reserves;
};

/**
 * GET /api/envelopes/:id/paypal — the gateway's record of its calls to PayPal for one envelope.
 * Kept loose on purpose: the gateway decides the fields of each entry.
 */
export type PayPalCall = { id: number; at: string; op: string; text: string; moves: boolean; repeat: boolean; method: string; path: string; httpStatus: number; paypalStatus: string | null; resourceId: string | null; amountMinor: number | null; currency: string | null; debugId: string | null; ms: number; error: string | null; requestId: string | null };
export type PayPalTrail = {
  mode: string; currency: string; calls: PayPalCall[];
  summary: { total: number; changed: number; asked: number; repeats: number; refused: number; holds: number; captures: number; payouts: number; refunds: number; cancels: number; voids: number };
  events: Array<{ id: string; type: string; source: "webhook" | "feed"; subject: string | null; outcome: string; at: string }>;
};
export type PaymentStatus = { id: string; status: SpendStatus; delivered: boolean; amountMinor: number; currency: string; payee: string; purpose: string; payoutStatus: string | null; captureId: string | null; refundId: string | null; hasReceipt: boolean; reasons: Array<{ code: string; detail: string; meaning?: string }> };
export type Recalled = { status: SpendStatus; spendId: string; refundId: string | null; payoutStatus: string | null; reasons: Array<{ code: string; detail: string; meaning?: string }> };

export type RevokeResult ={ block: { id: string; revokedAt: string | null }; root: { status: "ACTIVE" | "CLOSED"; capturedMinor: number; refundedMinor: number; releasedMinor: number | null } };
export type GatewayKey = { publicKey: string; signs: string[] };
