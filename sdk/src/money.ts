import { refuseLocally } from "./errors";

/**
 * An amount of money. Either dollars as a string ("45", "45.5", "45.00") or minor units stated
 * outright ({ minor: 4500 }). A bare number is refused: 45 could mean dollars or cents, and
 * 0.1 + 0.2 is not 0.3.
 */
export type Amount = string | { minor: number };

const MAX_MINOR = 1_000_000_000;

/** Turn an Amount into a positive whole number of minor units, or refuse. */
export function toMinor(a: Amount, field = "amount"): number {
  if (typeof a === "string") {
    const s = a.trim().replace(/^\$/, "");
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw refuseLocally(`${field}: "${a}" is not an amount. Write dollars with at most two decimals, like "45.00".`, "BAD_AMOUNT");
    const [whole, frac = ""] = s.split(".") as [string, string?];
    const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
    if (minor <= 0 || minor > MAX_MINOR) throw refuseLocally(`${field}: must be more than zero and at most ${formatMinor(MAX_MINOR)}.`, "BAD_AMOUNT");
    return minor;
  }
  if (a && typeof a === "object" && typeof (a as { minor?: unknown }).minor === "number") {
    const m = (a as { minor: number }).minor;
    if (!Number.isSafeInteger(m) || m <= 0 || m > MAX_MINOR) throw refuseLocally(`${field}: minor units must be a positive whole number (cents), at most ${MAX_MINOR}.`, "BAD_AMOUNT");
    return m;
  }
  throw refuseLocally(`${field}: pass dollars as a string ("45.00") or minor units as { minor: 4500 }. A bare number is ambiguous.`, "BAD_AMOUNT");
}

/** 4500 → "$45.00". */
export function formatMinor(minor: number, currency = "USD"): string {
  const s = (Math.abs(minor) / 100).toFixed(2);
  return `${minor < 0 ? "-" : ""}${currency === "USD" ? "$" : ""}${s}${currency === "USD" ? "" : " " + currency}`;
}
