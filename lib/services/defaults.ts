import type { MerchantPolicy } from "../db/schema";

export const DEFAULT_POLICY: MerchantPolicy = {
  allowedRemedies: ["PARTIAL_REFUND", "FULL_REFUND", "ADD_TRACKING_REMINDER", "MESSAGE_ONLY", "DISPUTE_OFFER"],
  maxRefundMinor: 5000,
  reviewThresholdMinor: 2500,
  minConfidence: 0.7,
  shipAtRiskHours: 12,
  refundAtRiskDays: 1,
  supportEmail: "hello@adaeze.studio.example",
  checkoutGuard: "BLOCK",
};
