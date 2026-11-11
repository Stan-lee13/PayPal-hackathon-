/** Prefixed random identifiers (96 bits of entropy) for internal records. Works in Node and in a browser. */
export function newId(prefix: string): string {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(12))) s += String.fromCharCode(b);
  return `${prefix}_${btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** Idempotency key for PayPal-Request-Id headers. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
