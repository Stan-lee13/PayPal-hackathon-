/**
 * @envelope/sdk — give an AI agent bounded spending authority of its own, on PayPal.
 *
 *   import { Gateway, Agent } from "@envelope/sdk";
 *   const agent = await Agent.fromJSON(saved, { gateway: "https://your-gateway" });
 *   await agent.hold(chain);                         // an envelope a person sealed for it
 *   const p = await agent.pay({ amount: "45.00", payee: "translator@example.com", purpose: "translation" });
 *
 * The SDK signs with the agent's own key and talks only to an Envelope gateway. It never sees PayPal
 * credentials and has no way around the gateway: a request the envelope does not allow is refused
 * there, by signatures and arithmetic, whatever the code or the model calling this library wants.
 */
export { Gateway, type FetchLike, type GatewayOptions } from "./gateway";
export { Agent, Owner, Party, checkIntroduction, checkPromiseNote, checkReference, getReceipt, getStatus, fingerprint, type Authority, type Payment, type PartyInit, type SavedParty, type SplitTerms } from "./agent";
export { EnvelopeError } from "./errors";
export { toMinor, formatMinor, type Amount } from "./money";
export { verifyReceipt, verifyStanding, verifyPromiseNote, verifyReference, verifyTransferReceipt, encodeToken, decodeToken, type Verification } from "./verify";
export type * from "./types";

/** The protocol itself: every signing and verifying function, with no network and no dependencies. */
export * as protocol from "../../lib/envelope/core";
export { verifyChain, accountPayee, accountNumber, isAccountPayee, fingerprint as keyFingerprint, generateKeyPair, importPrivateJwk, exportPrivateJwk } from "../../lib/envelope/core";
export type { Caps, Block, BlockBody, Envelope, KeyPair, Violation, Reason, ChainVerdict, SignedSpend, SignedPromise, SignedHello, SignedAccept, SignedKeep, SignedTransfer, SignedCard, SignedCharge, SignedAccount, SignedRevoke, SignedRead, SignedFreeze, SignedCardCancel } from "../../lib/envelope/core";

export const VERSION = "0.1.0";
