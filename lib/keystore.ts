/**
 * Private keys the gateway has to keep (its own signing key, and the demo agents' keys) are sealed
 * before they are written to the database, when ENVELOPE_KEY_SECRET is set. A copy of the database
 * alone is then not enough to sign as the gateway. Without the secret they are stored as plain JWK,
 * which is what the try-it copy and local development do; /api/health says which.
 *
 * This is encryption at rest with a secret from the environment, not a hardware key store: whoever
 * has both the database and the environment has the keys.
 */
import { b64u, unb64u } from "./envelope/core";

type Sealed = { sealed: "A256GCM"; iv: string; ct: string };
const enc = new TextEncoder();
export const keysSealed = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.ENVELOPE_KEY_SECRET);

/**
 * Production may not store gateway private keys unencrypted. Development may, and says so.
 *
 * This is encryption at rest with a secret from the environment, not a managed KMS: whoever holds both the
 * database and the environment holds the keys. `keyProtectionSummary()` says exactly that, so a health page or
 * a report cannot describe it as more.
 */
export function assertKeyProtection(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !keysSealed(env)) {
    throw new Error("ENVELOPE_KEY_SECRET is not set: gateway private keys would be stored as plain JWK in production. Refusing to run.");
  }
}

export const keyProtectionSummary = (): string => keysSealed()
  ? "Sealed at rest with AES-256-GCM under ENVELOPE_KEY_SECRET. This is encryption at rest, not a managed KMS: whoever holds both the database and the environment holds the keys."
  : "Plain JWK. Development only: without ENVELOPE_KEY_SECRET the private keys are readable by anyone who can read the database.";

async function wrappingKey(): Promise<CryptoKey | null> {
  const secret = process.env.ENVELOPE_KEY_SECRET;
  if (!secret) return null;
  if (secret.length < 24) throw new Error("ENVELOPE_KEY_SECRET must be at least 24 characters.");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("envelope-key-seal/1"), info: enc.encode("private-jwk") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** What to write to the database for a private key. */
export async function sealJwk(jwk: JsonWebKey): Promise<JsonWebKey> {
  const k = await wrappingKey();
  if (!k) {
    // A write path must not silently store plain key material in production.
    assertKeyProtection();
    return jwk;
  }
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(jwk))));
  // The public half stays readable so rows can still be matched by key without the secret.
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, sealed: "A256GCM", iv: b64u(iv), ct: b64u(ct) } as JsonWebKey & Sealed;
}

/** The private key from what the database holds. Rows written before a secret was set are still read. */
export async function openJwk(stored: JsonWebKey): Promise<JsonWebKey> {
  const s = stored as JsonWebKey & Partial<Sealed>;
  if (s.sealed !== "A256GCM" || !s.iv || !s.ct) return stored;
  const k = await wrappingKey();
  if (!k) throw new Error("This database holds sealed keys, and ENVELOPE_KEY_SECRET is not set.");
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(s.iv) }, k, unb64u(s.ct)))); }
  catch { throw new Error("ENVELOPE_KEY_SECRET does not open the keys in this database."); }
}
