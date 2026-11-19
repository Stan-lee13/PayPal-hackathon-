/**
 * What the provider-call journal may never record, and a check that an envelope's published call trail can
 * never contain it.
 *
 * The journal keeps facts, never bodies — so the card number on a sandbox hold request never enters it. But
 * ids are long opaque strings, and a hex id can happen to be 13 or more digits in a row, which is exactly the
 * shape of a payment-card number. The record masks that shape rather than hoping it does not occur.
 */
import { describe, expect, it } from "vitest";
import { redactIdentifiers } from "../lib/paypal/journal";

describe("provider call trail privacy", () => {
  it("masks any run of 13 to 19 digits, wherever it appears in an identifier", () => {
    // A hex id that happens to be all digits must not be publishable as-is.
    expect(redactIdentifiers("SIMBATCH1234567890123456")).toBe("SIMBATCH‹16 digits›");
    expect(redactIdentifiers("SIMREF9999999999999AA9")).toBe("SIMREF‹13 digits›AA9");
    // A real provider id keeps its shape: only a card-length digit run is masked.
    expect(redactIdentifiers("5TY12345AB678901C")).toBe("5TY12345AB678901C");
    expect(redactIdentifiers("123456789012")).toBe("123456789012"); // 12 digits: shorter than a PAN
    expect(redactIdentifiers(null)).toBeNull();
  });

  it("leaves no 13-19 digit run behind, however the digits are arranged", () => {
    const dirty = ["4024007198765432", "a4024007198765432b", "12345678901234567890123", "x-4111-1111-1111-1111-y"];
    for (const value of dirty) {
      const out = redactIdentifiers(value)!;
      expect(out).not.toMatch(/\d{13,19}/);
      expect(out).toContain("digits›");
    }
  });
});
