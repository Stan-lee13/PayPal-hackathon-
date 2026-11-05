/**
 * Money helpers. All arithmetic is done on integer minor units.
 * Never pass floats around for money; parse strings straight to minor units.
 */

/** ISO-4217 minor-unit exponents for currencies Kept supports. */
const EXPONENT: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NGN: 2, JPY: 0 };

export function currencyExponent(currency: string): number {
  const e = EXPONENT[currency.toUpperCase()];
  if (e === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return e;
}

export function isSupportedCurrency(currency: string): boolean {
  return EXPONENT[currency.toUpperCase()] !== undefined;
}

/**
 * Parse a decimal string such as "93.33" or "84" into minor units (9333, 8400).
 * Rejects anything that is not a plain non-negative decimal with at most the
 * currency's number of fractional digits. No float conversion happens.
 */
export function toMinor(value: string, currency: string): number {
  const exp = currencyExponent(currency);
  const s = value.trim().replace(/,/g, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Not a valid amount: "${value}"`);
  const whole = m[1]!;
  const frac = m[2] ?? "";
  if (frac.length > exp) throw new Error(`Too many decimal places for ${currency}: "${value}"`);
  const minor = BigInt(whole) * 10n ** BigInt(exp) + BigInt((frac + "0".repeat(exp)).slice(0, exp) || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount too large");
  return Number(minor);
}

/** Format minor units as a PayPal API decimal string ("93.33"). */
export function toDecimalString(minor: number, currency: string): string {
  assertMinor(minor);
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = String(abs).padStart(exp + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** Human display, e.g. "$93.33". */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currencyExponent(currency),
    maximumFractionDigits: currencyExponent(currency),
  }).format(Number(toDecimalString(minor, currency)));
}

/** Screen-reader friendly, e.g. "93 dollars and 33 cents". */
export function spokenMoney(minor: number, currency: string): string {
  if (currency !== "USD") return `${toDecimalString(minor, currency)} ${currency}`;
  const d = Math.trunc(minor / 100);
  const c = Math.abs(minor % 100);
  return `${d} dollar${d === 1 ? "" : "s"}${c ? ` and ${c} cent${c === 1 ? "" : "s"}` : ""}`;
}

export function assertMinor(n: number): void {
  if (!Number.isSafeInteger(n)) throw new Error(`Money must be an integer number of minor units, got ${n}`);
}
