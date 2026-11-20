/**
 * One authoritative validation of a provider payout item against a persisted spend.
 *
 * Before this module two paths validated different things: the manual reconciliation
 * (`resolvePayoutDoubt`) checked the item id, amount, currency, receiver and status, while initial settlement
 * and `syncSpend()` only picked the item that matched the sender reference and then read its status. A provider
 * answer that was incomplete — or that carried another payment's amount — could therefore mark a recipient
 * paid on the ordinary path, even though the recovery path would have refused it.
 *
 * Every path that reads payout state now asks this function, and only a result it accepts can move money:
 *
 *   • initial settlement after the payout was submitted (`settleOnce`);
 *   • `syncSpend()`, including the sweep and the page that is open on an envelope;
 *   • `resolvePayoutDoubt()`, the manual recovery path;
 *   • any future webhook recovery that reads payout state.
 *
 * It never guesses. A value the provider did not report is not a match; a caller-supplied item id is not
 * evidence; a batch status is never a recipient's status; and a batch that reports more items than it lists is
 * not attributable. Those cases are `unresolved`: the payout stays submitted and nothing is refunded.
 */
import { formatMoney } from "../money";
import { classifyPayoutItem, payoutItemFor, type PayoutFacts, type PayoutItemFacts, type PayoutItemOutcome } from "../rails/types";

/** The spend (or balance movement) a provider payout item is being attributed to. */
export type PayoutTarget = {
  /** The domain idempotency reference sent as the provider's sender item / sender batch id. */
  id: string;
  amountMinor: number;
  currency: string;
  /** The address the provider must report paying, case-insensitively. */
  receiver: string;
};

export type PayoutAttributionProblemCode =
  /** The batch the provider answered is not the batch that was asked about. */
  | "batch_mismatch"
  /** The provider's echo of the sender batch reference belongs to another payment. */
  | "sender_batch_mismatch"
  /** The batch is paginated/counted incompletely: what was read is not the whole batch. */
  | "incomplete_batch"
  /** No item in the batch carries this payment's sender reference. */
  | "no_item"
  /** More than one item carries this payment's sender reference: which one is ours is unknown. */
  | "ambiguous_item"
  | "no_item_id"
  | "no_amount"
  | "amount_mismatch"
  | "no_receiver"
  | "receiver_mismatch"
  | "no_status"
  /** A status this adapter does not understand. Not paid, and never refunded on a guess. */
  | "unknown_status";

export type PayoutUnresolved = {
  ok: false;
  code: PayoutAttributionProblemCode;
  /** A sentence for the audit trail and the operator. */
  problem: string;
  /** Always true: the provider's answer is incomplete or not this payment's. Nothing is undone. */
  unresolved: true;
};

export type PayoutAttribution = {
  ok: true;
  item: PayoutItemFacts;
  /** The provider's own item id. Never a value the caller supplied. */
  itemId: string;
  /** The provider's own status word, unmodified. */
  status: string;
  outcome: PayoutItemOutcome;
};

const unresolved = (code: PayoutAttributionProblemCode, problem: string): PayoutUnresolved => ({ ok: false, code, problem, unresolved: true });

/** The same address, ignoring case and surrounding space. A missing value is never equal to anything. */
const sameReceiver = (a: string | null, b: string) => a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Validate one provider payout item against a persisted spend.
 *
 * `batchRef`/`itemId` are *expectations*, not evidence: when supplied they are compared with what the provider
 * reported, and the provider's values win. Nothing here reads a batch status as a recipient status.
 */
export function attributePayoutItem(a: {
  target: PayoutTarget;
  facts: PayoutFacts;
  /** The batch id the caller already has on record, if any. */
  batchRef?: string | null;
  /** An item id the caller believes is ours. Compared, never trusted. */
  itemId?: string | null;
}): PayoutAttribution | PayoutUnresolved {
  const { target, facts } = a;

  // 1. Provider batch identity. If we already recorded a batch, the answer must be that same batch.
  if (!facts.batchRef?.id) return unresolved("batch_mismatch", "the provider did not report a batch id");
  if (a.batchRef && facts.batchRef.id !== a.batchRef) {
    return unresolved("batch_mismatch", `the provider returned batch ${facts.batchRef.id} for ${a.batchRef}`);
  }

  // 2. Sender batch reference, where the adapter reports it. A batch that names another payment is not ours.
  if (facts.senderBatchId !== null && facts.senderBatchId !== target.id) {
    return unresolved(
      "sender_batch_mismatch",
      `the provider's batch belongs to the sender reference ${facts.senderBatchId}, not to this payment`,
    );
  }

  // 3 & 9. Exactly one matching sender item reference, and the whole batch: `payoutItemFor` refuses a batch
  // that reports fewer items than it says it holds, no item, or several items with this reference.
  const match = payoutItemFor(facts, target.id);
  if (!match.ok) {
    const code: PayoutAttributionProblemCode = /holds? \d+ item/.test(match.problem)
      ? "incomplete_batch"
      : /^no item carries/.test(match.problem)
        ? "no_item"
        : /items? carr(y|ies) the sender reference/.test(match.problem)
          ? "ambiguous_item"
          : "no_item";
    return unresolved(code, match.problem);
  }
  const item = match.item;

  // 4. The provider's own item id. An id typed by a person cannot stand in for it.
  if (!item.itemRef?.id) {
    return unresolved("no_item_id", "the provider reported no item id, and an id given by hand is not provider evidence");
  }
  const itemId = item.itemRef.id;
  if (a.itemId && a.itemId !== itemId) {
    return unresolved("no_item_id", `item ${a.itemId} is not the provider's item ${itemId}`);
  }

  // 5 & 6. The item's own amount and currency, not the batch's and not the request's.
  if (!item.amount) {
    return unresolved("no_amount", `the provider reported no amount for item ${itemId}; it cannot be matched to this payment`);
  }
  if (item.amount.minor !== target.amountMinor || item.amount.currency !== target.currency) {
    return unresolved(
      "amount_mismatch",
      `item ${itemId} is ${formatMoney(item.amount.minor, item.amount.currency)}, not the ${formatMoney(target.amountMinor, target.currency)} this payment owes`,
    );
  }

  // 7. Receiver: a missing receiver is not a match.
  if (!item.receiver) {
    return unresolved("no_receiver", `the provider reported no receiver for item ${itemId}; a missing receiver is not a match`);
  }
  if (!sameReceiver(item.receiver, target.receiver)) {
    return unresolved("receiver_mismatch", `item ${itemId} pays a different recipient than this payment's payee`);
  }

  // 8. Status: the provider's own word, and only a word this adapter understands.
  if (!item.status) {
    return unresolved("no_status", `the provider reported no status for item ${itemId}, so there is no evidence about this recipient`);
  }
  const outcome = classifyPayoutItem(item.status);
  if (outcome === "unknown") {
    return unresolved("unknown_status", `the provider's item status "${item.status}" is not one this gateway recognises`);
  }

  return { ok: true, item, itemId, status: item.status, outcome };
}
