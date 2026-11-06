/**
 * The contract sets the numbers. This module is the only place an invoice amount is decided, and it
 * is plain deterministic code: no model output reaches it.
 *
 *  FIXED_PER_ISSUE  each issue the PR closes that has an agreed price is one line item at that price.
 *                   An issue without an agreed price, or one already billed on another invoice, is
 *                   not billed and the freelancer is told why.
 *  HOURLY           the freelancer states the hours (we never infer hours from commits); the line is
 *                   hours × the agreed rate, refused above the contract's per-invoice limit.
 *  Extras           work outside the agreement is billed only if the freelancer adds it explicitly,
 *                   and is labelled on the invoice as not part of the original agreement.
 */
import type { Contract, LineItem } from "../db/schema";
import { currencyExponent, formatMoney, toMinor } from "../money";

export class PricingError extends Error {}

export type Extra = { summary: string; amount: string };

export type PricingInput = {
  contract: Pick<Contract, "pricing" | "issuePrices" | "hourlyRateMinor" | "maxHoursPerInvoice" | "currency">;
  /** Issues the PR closes, with titles (from GitHub). */
  issues: Array<{ number: number; title: string }>;
  /** Issue numbers already billed on another live invoice → invoice number. */
  alreadyBilled: Record<string, string>;
  hours?: string;
  extras?: Extra[];
};

export type PricingResult = { items: LineItem[]; totalMinor: number; warnings: string[] };

const MAX_TOTAL_MINOR = 10_000_000_00; // PayPal invoices cap well below this; sanity guard

/** Hours as an exact decimal with at most 2 places → hundredths of an hour. */
export function parseHours(h: string): number {
  const s = h.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) throw new PricingError(`Hours must be a number like 6 or 6.5 (got "${h}").`);
  const [w, f = ""] = s.split(".");
  const hundredths = Number(w) * 100 + Number((f + "00").slice(0, 2));
  if (hundredths <= 0) throw new PricingError("Hours must be more than zero.");
  return hundredths;
}

export function priceInvoice(input: PricingInput): PricingResult {
  const { contract: c } = input;
  const items: LineItem[] = [];
  const warnings: string[] = [];

  if (c.pricing === "FIXED_PER_ISSUE") {
    if (input.hours) warnings.push("Hours were given but this contract is priced per issue, so they were ignored.");
    if (input.issues.length === 0) warnings.push("This pull request doesn't close any issue (add \"Closes #12\" to its description), so nothing in it has an agreed price.");
    for (const issue of input.issues) {
      const key = String(issue.number);
      const price = c.issuePrices[key];
      if (input.alreadyBilled[key]) { warnings.push(`Issue #${key} was already billed on invoice ${input.alreadyBilled[key]}; not billed again.`); continue; }
      if (price === undefined) { warnings.push(`Issue #${key} ("${issue.title}") has no agreed price in the contract, so it isn't billed. Agree a price with the client first.`); continue; }
      items.push({ kind: "ISSUE", ref: key, name: `#${key} ${issue.title}`.slice(0, 200), description: "", quantity: "1", unitAmountMinor: price, totalMinor: price });
    }
  } else {
    const rate = c.hourlyRateMinor;
    if (!rate) throw new PricingError("This hourly contract has no rate set.");
    if (!input.hours) throw new PricingError(`This contract is hourly: say how many hours this PR took (e.g. hours: "6.5"). MergePay never guesses hours from commits.`);
    const hundredths = parseHours(input.hours);
    if (c.maxHoursPerInvoice && hundredths > c.maxHoursPerInvoice * 100) {
      throw new PricingError(`${input.hours} hours is over the ${c.maxHoursPerInvoice}-hour limit per invoice in this contract. Ask the client to raise it first.`);
    }
    const total = Math.round((rate * hundredths) / 100);
    const label = input.issues.length ? input.issues.map((i) => `#${i.number}`).join(", ") : "this pull request";
    items.push({ kind: "HOURS", ref: null, name: `Development time for ${label}`.slice(0, 200), description: "", quantity: trimHours(input.hours), unitAmountMinor: rate, totalMinor: total });
  }

  for (const x of input.extras ?? []) {
    const summary = x.summary.trim();
    if (summary.length < 3) throw new PricingError("Each extra needs a short description of the work.");
    let amount: number;
    try { amount = toMinor(x.amount, c.currency); } catch (e) { throw new PricingError(`Extra "${summary}": ${(e as Error).message}`); }
    if (amount <= 0) throw new PricingError(`Extra "${summary}" must cost more than zero.`);
    items.push({ kind: "EXTRA", ref: null, name: `Change request: ${summary}`.slice(0, 200), description: "Not part of the original agreement; added by the freelancer for the client's approval.", quantity: "1", unitAmountMinor: amount, totalMinor: amount });
    warnings.push(`"${summary}" (${formatMoney(amount, c.currency)}) is billed as a change request outside the agreed scope. The client sees it labelled that way.`);
  }

  const totalMinor = items.reduce((s, i) => s + i.totalMinor, 0);
  if (items.length === 0) throw new PricingError(`Nothing in this pull request is billable under the contract.${warnings.length ? " " + warnings.join(" ") : ""}`);
  if (totalMinor > MAX_TOTAL_MINOR) throw new PricingError("That total is too large for one invoice.");
  currencyExponent(c.currency); // throws for unsupported currencies
  return { items, totalMinor, warnings };
}

function trimHours(h: string): string {
  const s = h.trim();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
