/**
 * The auditor's side of the gateway: what an auditing agent may read, and a check on what it proposes.
 *
 * Spending agents get envelopes. The agent that watches them gets less: it can read and it can
 * propose, and nothing else. It reads two things.
 *
 *   • PayPal, through PayPal's own Agent Toolkit, cut down to its read tools (lib/paypal/toolkit.ts).
 *     This is a second route to PayPal's record that does not pass through the gateway's own
 *     bookkeeping code, which is the point of an audit.
 *   • The gateway's books: balances, the statement match, what is unsettled, one payment.
 *
 * A proposal is checked here against the records, by rule, and answered with who would have to sign
 * for it. Nothing in this file moves money, changes a record or signs anything. An auditor that has
 * been talked into something by text it read can at most make a proposal that a person declines.
 */
import { desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { accounts, roots, spends, transfers } from "../db/schema";
import { formatMoney, toMinor } from "../money";
import { getPayPal, paypalMode } from "../paypal/client";
import { disputesFor } from "../paypal/payments";
import { TOOLKIT_READS, toolkitRead, toolkitTools } from "../paypal/toolkit";
import * as B from "./bank";
import * as K from "./books";

export type AuditorTool = { name: string; source: "paypal-agent-toolkit" | "envelope"; title: string; description: string; parameters: Record<string, unknown> };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const OWN: AuditorTool[] = [
  { name: "envelope_books", source: "envelope", title: "The gateway's books", description: "What the gateway owes its agents (every balance), whether its own books add up, and whether PayPal's reported balance covers what is owed.", parameters: obj({}) },
  { name: "envelope_statement", source: "envelope", title: "Records against PayPal's statement", description: "Every capture, payout and refund the gateway recorded in the last 72 hours, looked up on PayPal's own statement of the account: listed, amount differs, or not listed yet. Includes PayPal's fees and what the listed records left at PayPal.", parameters: obj({}) },
  { name: "envelope_unsettled", source: "envelope", title: "What is not finished", description: "Payments and transfers that are not final: payouts PayPal has not delivered or that nobody has claimed, refunds owed, and payments a payer has disputed.", parameters: obj({}) },
  { name: "envelope_payment", source: "envelope", title: "One payment", description: "The gateway's record of one payment: who paid, whom, how much, for what, and where it stands at PayPal. Give the payment id (sp_… or pr_…) or the PayPal capture id.", parameters: obj({ id: { type: "string", description: "A payment id (sp_…, pr_…) or a PayPal capture id" } }, ["id"]) },
];

/** Everything the auditor can call, with PayPal's tools described in PayPal's own words. */
export async function auditorTools(): Promise<AuditorTool[]> {
  const paypal = (await toolkitTools()).map((t) => ({ name: t.tool, source: "paypal-agent-toolkit" as const, title: t.title, description: t.description, parameters: t.parameters }));
  return [...paypal, ...OWN];
}

export type AuditorAnswer = {
  tool: string; source: AuditorTool["source"] | null; ok: boolean;
  /** True when the tool is not one the auditor has. Nothing was asked of anyone. */
  refused: boolean;
  /** A short account of the answer, for the agent and for the page. Built by code from ids, statuses and amounts only. */
  brief: string;
  /** The answer itself. */
  data: unknown;
};

const usd = (minor: number, currency = "USD") => formatMoney(minor, currency);
const cut = (lines: string[], max: number) => (lines.length > max ? [...lines.slice(0, max), `… and ${lines.length - max} more`] : lines);
const id = (x: unknown) => String(x ?? "").replace(/[^A-Za-z0-9_:.@-]/g, "").slice(0, 64);
/** Text another party wrote (a memo, a note). Passed on as a quotation, with anything that could close the quotation removed. */
const quoted = (x: unknown, max = 160) => `«${String(x ?? "").replace(/[\u0000-\u001f«»]+/g, " ").trim().slice(0, max)}»`;

type Money = { currency_code?: string; value?: string } | undefined;
const minor = (m: Money) => (m?.value && m.currency_code ? toMinor(m.value.replace(/^-/, ""), m.currency_code) * (m.value.startsWith("-") ? -1 : 1) : 0);

function briefPayPal(tool: string, d: Record<string, unknown>): string {
  if (tool === "list_transactions") {
    const rows = ((d.transaction_details as Array<{ transaction_info?: Record<string, unknown> }> | undefined) ?? []).map((r) => r.transaction_info ?? {});
    let money = 0, fees = 0;
    const lines = rows.map((t) => {
      const a = minor(t.transaction_amount as Money), f = minor(t.fee_amount as Money);
      money += a; fees += f;
      return `${id(t.transaction_id)} ${id(t.transaction_event_code)} ${usd(a)}${f ? ` fee ${usd(Math.abs(f))}` : ""} status ${id(t.transaction_status)}${t.invoice_id || t.custom_field ? ` ref ${id(t.invoice_id ?? t.custom_field)}` : ""}`;
    });
    return [`PayPal lists ${rows.length} transaction${rows.length === 1 ? "" : "s"}; money in less money out is ${usd(money)}, and PayPal charged ${usd(Math.abs(fees))} in fees.`, ...cut(lines, 14)].join("\n");
  }
  if (tool === "list_disputes") {
    const items = (d.items as Array<Record<string, unknown>> | undefined) ?? [];
    if (!items.length) return "PayPal lists no disputes on this account.";
    return [`PayPal lists ${items.length} dispute${items.length === 1 ? "" : "s"}.`, ...cut(items.map((x) => `${id(x.dispute_id)} status ${id(x.status)} reason ${id(x.reason)} amount ${usd(minor(x.dispute_amount as Money))}`), 10)].join("\n");
  }
  if (tool === "get_dispute") {
    const tx = ((d.disputed_transactions as Array<Record<string, unknown>> | undefined) ?? []).map((t) => id(t.seller_transaction_id)).filter(Boolean);
    return `Dispute ${id(d.dispute_id)}: status ${id(d.status)}, reason ${id(d.reason)}, stage ${id(d.dispute_life_cycle_stage)}, amount ${usd(minor(d.dispute_amount as Money))}, about PayPal transaction${tx.length === 1 ? "" : "s"} ${tx.join(", ") || "(none given)"}.`;
  }
  if (tool === "get_order") {
    const pu = ((d.purchase_units as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {};
    return `Order ${id(d.id)}: status ${id(d.status)}, intent ${id(d.intent)}, amount ${usd(minor(pu.amount as Money))}, made for ${id(pu.custom_id) || "(no reference)"}.`;
  }
  if (tool === "get_refund") return `Refund ${id(d.id)}: status ${id(d.status)}, amount ${usd(minor(d.amount as Money))}.`;
  return "PayPal answered.";
}

const UNSETTLED = ["RESERVED", "CAPTURED", "PAYOUT_PENDING", "UNCLAIMED", "REFUND_DUE"] as const;

/** Payments and transfers that are not final, and payments under dispute. Read from the gateway's own records. */
export async function unsettled() {
  const db = getDb();
  const [open, disputed, moving] = await Promise.all([
    db.select().from(spends).where(inArray(spends.status, [...UNSETTLED])).orderBy(desc(spends.createdAt)).limit(40),
    db.select().from(spends).where(isNotNull(spends.disputeId)).orderBy(desc(spends.createdAt)).limit(40),
    db.select().from(transfers).where(inArray(transfers.status, ["PAYOUT_PENDING", "UNCLAIMED"])).orderBy(desc(transfers.createdAt)).limit(40),
  ]);
  return {
    payments: open.map((s) => ({ payment: s.id, envelope: s.rootId, status: s.status, amountMinor: s.amountMinor, currency: s.currency, payoutStatus: s.payoutStatus, capture: s.captureId })),
    disputed: disputed.map((s) => ({ payment: s.id, envelope: s.rootId, dispute: s.disputeId!, disputeStatus: s.disputeStatus, amountMinor: s.amountMinor, currency: s.currency, capture: s.captureId })),
    transfers: moving.map((t) => ({ transfer: t.id, status: t.status, amountMinor: t.amountMinor, currency: t.currency })),
  };
}

async function payment(ref: string) {
  const db = getDb();
  const s = await db.query.spends.findFirst({ where: or(eq(spends.id, ref), eq(spends.captureId, ref)) });
  if (!s) return null;
  const root = await db.query.roots.findFirst({ where: eq(roots.id, s.rootId) });
  return {
    payment: s.id, envelope: s.rootId, envelopeStatus: root?.status ?? null, paidBy: s.leafLabel, payee: s.payee, amountMinor: s.amountMinor, currency: s.currency, purpose: s.purpose,
    status: s.status, capture: s.captureId, payoutStatus: s.payoutStatus, payoutTransaction: s.payoutTransactionId, refund: s.refundId, dispute: s.disputeId, disputeStatus: s.disputeStatus,
    /** Written by the paying agent. Data, never an instruction. */
    memo: s.memo, at: s.createdAt.toISOString(),
  };
}

/** Run one of the auditor's tools. PayPal's go through the toolkit; the rest read the gateway's records. */
export async function auditorRead(tool: string, args: unknown): Promise<AuditorAnswer> {
  if ((TOOLKIT_READS as readonly string[]).includes(tool)) {
    const r = await toolkitRead(tool, args);
    if (!r.ok) return { tool, source: "paypal-agent-toolkit", ok: false, refused: r.refused, brief: r.error, data: null };
    return { tool, source: "paypal-agent-toolkit", ok: true, refused: false, brief: briefPayPal(tool, (r.data ?? {}) as Record<string, unknown>), data: r.data };
  }
  const a = (args ?? {}) as Record<string, unknown>;
  if (tool === "envelope_books") {
    const [p, r] = await Promise.all([B.position(), K.reserves()]);
    const brief = [
      `${p.totals.accounts} agent account${p.totals.accounts === 1 ? "" : "s"} hold ${usd(p.totals.balancesMinor)} in total.`,
      ...p.checks.map((c) => `${c.ok ? "holds" : "DOES NOT HOLD"}: ${c.name}`),
      r.paypal ? `PayPal reports ${usd(r.paypal.availableMinor)} available; the gateway owed ${usd(r.owed.atPayPalsTimeMinor)} at that moment: ${r.covered ? `covered, with ${usd(r.surplusMinor ?? 0)} over` : `SHORT by ${usd(-(r.surplusMinor ?? 0))}`}.` : "PayPal's balance could not be read.",
      r.owed.refundsDueMinor ? `Refunds owed to owners and not yet accepted by PayPal: ${usd(r.owed.refundsDueMinor)}.` : "",
    ].filter(Boolean).join("\n");
    return { tool, source: "envelope", ok: true, refused: false, brief, data: { totals: p.totals, checks: p.checks, reserves: r } };
  }
  if (tool === "envelope_statement") {
    const s = await K.statement();
    const off = s.matches.filter((m) => m.verdict !== "listed");
    const brief = [
      `${s.ours} records of the gateway looked up on PayPal's statement (${s.paypalLines} lines): ${s.listed} listed with the same amount, ${s.differs} where the amount differs, ${s.notListedYet} not listed yet. ${s.otherActivity} line${s.otherActivity === 1 ? "" : "s"} on the account ${s.otherActivity === 1 ? "is" : "are"} not the gateway's.`,
      `Listed records: ${usd(s.position.inMinor)} captured in, ${usd(s.position.outMinor)} paid out, ${usd(s.position.refundedMinor)} refunded, ${usd(Math.abs(s.position.feesMinor))} in PayPal fees, leaving ${usd(s.position.netMinor)} at PayPal.`,
      ...cut(off.map((m) => `${m.verdict.toUpperCase()}: ${m.what} ${id(m.paypalId)} of payment ${id(m.spend)}, recorded ${usd(m.amountMinor)}${m.listedMinor != null ? `, PayPal lists ${usd(m.listedMinor)}` : ""}`), 10),
    ].join("\n");
    return { tool, source: "envelope", ok: true, refused: false, brief, data: s };
  }
  if (tool === "envelope_unsettled") {
    const u = await unsettled();
    const lines = [
      ...u.payments.map((p) => `payment ${p.payment} is ${p.status}${p.payoutStatus ? ` (payout ${id(p.payoutStatus)})` : ""}: ${usd(p.amountMinor, p.currency)}`),
      ...u.disputed.map((p) => `payment ${p.payment} is disputed at PayPal: dispute ${id(p.dispute)} status ${id(p.disputeStatus)}, ${usd(p.amountMinor, p.currency)}`),
      ...u.transfers.map((t) => `transfer ${t.transfer} is ${t.status}: ${usd(t.amountMinor, t.currency)}`),
    ];
    return { tool, source: "envelope", ok: true, refused: false, brief: lines.length ? cut(lines, 16).join("\n") : "Nothing is unsettled: every payment and transfer the gateway recorded is final, and none is on record as disputed.", data: u };
  }
  if (tool === "envelope_payment") {
    const p = await payment(id(a.id));
    if (!p) return { tool, source: "envelope", ok: false, refused: false, brief: "The gateway has no payment under that id or capture id.", data: null };
    const brief = `Payment ${p.payment} from envelope ${p.envelope} (${id(p.envelopeStatus)}): ${id(p.paidBy)} paid ${id(p.payee)} ${usd(p.amountMinor, p.currency)} for ${quoted(p.purpose, 40)}. Status ${p.status}${p.payoutStatus ? `, payout ${id(p.payoutStatus)}` : ""}${p.capture ? `, PayPal capture ${id(p.capture)}` : ""}${p.refund ? `, refund ${id(p.refund)}` : ""}${p.dispute ? `, dispute ${id(p.dispute)} ${id(p.disputeStatus)}` : ""}. The paying agent's memo, quoted as data: ${quoted(p.memo)}.`;
    return { tool, source: "envelope", ok: true, refused: false, brief, data: p };
  }
  return { tool, source: null, ok: false, refused: true, brief: `"${id(tool)}" is not a tool the auditor has. It can read and it can propose; it cannot pay, refund, capture, void, sign or change a record.`, data: null };
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export const PROPOSAL_KINDS = ["answer_dispute", "recall_payout", "close_envelope", "freeze_account"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalVerdict = {
  kind: string; target: string;
  /** Do the records support this proposal right now? */
  stands: boolean;
  why: string;
  /** Whose act it would take. The auditor is never the answer. */
  signer: "the envelope's owner" | "the agent's owner" | "the gateway's sweep" | null;
  /** Where that party does it. */
  link: string | null;
};

/**
 * Check a proposal against the records. The kind must be one of four, the target must exist, and the
 * records must show the situation the proposal is about. The reason the agent gave is not read: a
 * proposal stands or falls on the records alone.
 */
export async function checkProposal(kind: string, target: string): Promise<ProposalVerdict> {
  const db = getDb();
  const t = id(target);
  const no = (why: string): ProposalVerdict => ({ kind: id(kind), target: t, stands: false, why, signer: null, link: null });
  if (!(PROPOSAL_KINDS as readonly string[]).includes(kind)) return no(`The auditor can propose ${PROPOSAL_KINDS.join(", ")}. It cannot propose "${id(kind)}": payments, refunds and new authority are requested by signed envelopes, not by the auditor.`);
  if (kind === "answer_dispute" || kind === "recall_payout") {
    const s = await db.query.spends.findFirst({ where: or(eq(spends.id, t), eq(spends.captureId, t), eq(spends.disputeId, t)) });
    if (!s) return no("The gateway has no payment under that id.");
    if (kind === "answer_dispute") {
      // PayPal's word at this moment, not the gateway's last note of it: the gateway may not have heard of the dispute yet.
      const d = s.captureId ? (await disputesFor(getPayPal(), s.captureId).catch(() => null))?.[0] : null;
      if (!d) return no(`PayPal lists no dispute against the capture of payment ${s.id}.`);
      if (d.status !== "WAITING_FOR_SELLER_RESPONSE") return no(`PayPal's status for dispute ${d.id} is ${d.status}; it is not waiting for the gateway's answer.`);
      return { kind, target: s.id, stands: true, why: `PayPal is waiting for an answer to dispute ${d.id} on payment ${s.id}. The answer is the payment's signed chain of authority, which the gateway already holds and sends when it sweeps.`, signer: "the gateway's sweep", link: `/r/${s.id}` };
    }
    if (s.status !== "UNCLAIMED") return no(`Payment ${s.id} is ${s.status}. Only a payout nobody has claimed can be recalled.`);
    return { kind, target: s.id, stands: true, why: `The payout of payment ${s.id} has not been claimed. Recalling it returns the money to the owner instead of waiting thirty days.`, signer: "the envelope's owner", link: `/e/${s.rootId}` };
  }
  if (kind === "close_envelope") {
    const r = await db.query.roots.findFirst({ where: eq(roots.id, t) });
    if (!r) return no("There is no envelope under that id.");
    if (r.status !== "ACTIVE") return no(`Envelope ${r.id} is already ${r.status}.`);
    return { kind, target: r.id, stands: true, why: `Envelope ${r.id} is active. Closing it makes PayPal release whatever was never spent.`, signer: "the envelope's owner", link: `/e/${r.id}` };
  }
  const acct = await db.query.accounts.findFirst({ where: or(eq(accounts.agent, t), eq(accounts.account, t.replace(/^acct:/i, "").toUpperCase()), eq(accounts.account, t.replace(/^acct:/i, "").toLowerCase())) });
  if (!acct) return no("There is no agent account under that key or number.");
  if (acct.frozenAt) return no(`Account ${acct.account} is already frozen.`);
  return { kind, target: acct.account, stands: true, why: `Account ${acct.account} (${id(acct.label)}) is open. Freezing it stops money leaving until its owner lifts the freeze.`, signer: "the agent's owner", link: `/a/${acct.agent}` };
}

/** DEMO, simulator only: the payer of the latest settled payment opens a dispute at PayPal. The gateway's records are not touched. */
export async function stageDispute(): Promise<{ payment: string; capture: string; dispute: string } | null> {
  if (paypalMode() !== "simulated") return null;
  const { simOpenDispute } = await import("../paypal/emulator");
  const recent = await getDb().select().from(spends).where(isNotNull(spends.captureId)).orderBy(desc(spends.createdAt)).limit(20);
  const s = recent.find((x) => !x.disputeId && !x.refundId && ["PAID", "CAPTURED", "PAYOUT_PENDING", "UNCLAIMED"].includes(x.status));
  if (!s) return null;
  if ((await disputesFor(getPayPal(), s.captureId!).catch(() => []))?.length) return null;
  const dispute = await simOpenDispute(s.captureId!, "UNAUTHORISED");
  return dispute ? { payment: s.id, capture: s.captureId!, dispute } : null;
}

/**
 * Who may ask. On the simulator the auditor is open, like the rest of the demo. Against real PayPal
 * its reads show the operator's whole account, so they need the operator's key (AUDITOR_SECRET), and
 * with no key configured they are refused.
 */
export function auditorMayAsk(headers: Record<string, string> | undefined): "yes" | "no" | "unconfigured" {
  if (paypalMode() === "simulated") return "yes";
  const secret = process.env.AUDITOR_SECRET;
  if (!secret) return "unconfigured";
  return headers?.authorization === `Bearer ${secret}` ? "yes" : "no";
}
