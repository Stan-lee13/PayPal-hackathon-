import { randomBytes, randomUUID } from "node:crypto";

/** Prefixed random identifiers (96 bits of entropy) for internal records. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** 256-bit unguessable token for customer receipt URLs. */
export function newReceiptToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Idempotency key for PayPal-Request-Id headers. */
export function newRequestId(): string {
  return randomUUID();
}
