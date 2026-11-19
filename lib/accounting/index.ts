/**
 * Multi-rail accounting: provider-scoped positions, and the rules for moving value between providers.
 * See docs/MULTI_RAIL_ACCOUNTING.md. Nothing here moves money; it records and checks where money is.
 */
export {
  ensureRailAccount, fundedByFor, internalLiabilities, lastReconciliations, liquidityAt, movementsFor,
  positionOf, positionsFor, postCapture, postCaptureSettled, postFee, postPayout, postPayoutReturn, postRefund, railAccountIdentity,
  assertProviderAccountAttribution, recordExternalMovement, recordReconciliation, requireProviderLiquidity,
} from "./positions";
export type { Custody, Movement, Position } from "./positions";
export { treasuryMeaning, treasuryMode } from "./policy";
export type { TreasuryMode } from "./policy";
export { assertInterRailTransfer, interRailRefusal, planInterRailTransfer, refuseInterRailTransfer } from "./inter-rail";
export type { InterRailDecision, InterRailRequest, RailSide } from "./inter-rail";
