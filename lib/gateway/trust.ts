/**
 * The gateway key an organization trusts.
 *
 * A receipt carries the public key that signed it and its signature verifies against that key. That proves
 * arithmetic and record-keeping: this key signed this body. It does **not** prove the key belongs to the
 * organization a receipt names — anyone can generate a key and sign a receipt-shaped object.
 *
 * Trust is therefore a separate, persisted fact: a fingerprint recorded for one organization
 * (`gateway_key_trust`). Verification reports the two things separately, and nothing in this file may report a
 * mathematically valid receipt as a trusted one.
 *
 * Rotation: a new key becomes `ACTIVE`, the old one `RETIRED`. Retired keys keep verifying historical receipts
 * and cannot be used to issue new ones. Nothing is re-signed, and the signed bodies of v1/v2 receipts are
 * untouched.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { gatewayKeyTrust, organizations, type Receipt } from "../db/schema";
import * as E from "../envelope/core";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { verifyReceiptSignature } from "./receipts";

/** A stable fingerprint of a gateway public key. Public keys are not secret; the fingerprint is what is trusted. */
export function gatewayKeyFingerprint(publicKey: string): Promise<string> {
  return E.sha256(`envelope-gateway-key/1|${publicKey}`);
}

export type GatewayTrust = { id: string; orgId: string; fingerprint: string; state: "ACTIVE" | "RETIRED"; publicKey: string };

/**
 * Record that one organization trusts one gateway key. Idempotent for the same pair; refused when the same key
 * is already trusted by a different organization (a key that speaks for two tenants is a mistake, not a
 * feature, until a deliberate multi-tenant key design exists).
 */
export async function trustGatewayKey(a: {
  orgId: string;
  publicKey: string;
  gatewayKeyId?: string | null;
  note?: string;
}): Promise<GatewayTrust> {
  if (!a.publicKey) throw new UserFacingError("Trusting a gateway key needs its public key.", 400);
  const db = getDb();
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, a.orgId) });
  if (!org) throw new UserFacingError(`No organization ${a.orgId} to trust a key for.`, 404);
  const fingerprint = await gatewayKeyFingerprint(a.publicKey);
  const existing = await db.query.gatewayKeyTrust.findFirst({ where: eq(gatewayKeyTrust.fingerprint, fingerprint) });
  if (existing) {
    if (existing.orgId !== a.orgId) {
      throw new UserFacingError("That gateway key is already trusted by another organization; one key cannot speak for two tenants.", 409);
    }
    return existing;
  }
  const [row] = await db.insert(gatewayKeyTrust).values({
    id: newId("gkt"), orgId: a.orgId, fingerprint, publicKey: a.publicKey,
    state: "ACTIVE", gatewayKeyId: a.gatewayKeyId ?? null, note: (a.note ?? "").slice(0, 200),
  }).returning();
  return row!;
}

/** Retire a key for new receipts. Historical verification is unchanged. */
export async function retireGatewayKey(a: { orgId: string; fingerprint?: string; publicKey?: string }): Promise<GatewayTrust | null> {
  const fingerprint = a.fingerprint ?? (a.publicKey ? await gatewayKeyFingerprint(a.publicKey) : null);
  if (!fingerprint) throw new UserFacingError("Name the key to retire by fingerprint or public key.", 400);
  const [row] = await getDb().update(gatewayKeyTrust)
    .set({ state: "RETIRED", retiredAt: new Date() })
    .where(and(eq(gatewayKeyTrust.orgId, a.orgId), eq(gatewayKeyTrust.fingerprint, fingerprint))).returning();
  return row ?? null;
}

export type TrustedReceiptVerdict = {
  /** The receipt's own signature verifies against the key embedded in it. */
  signatureValid: boolean;
  /** That key is in this organization's trust registry (active or retired). */
  trusted: boolean;
  /** The organization whose registry contains the key, when one does. */
  trustedOrgId: string | null;
  /** Fingerprint of the embedded key, so an operator can compare it with the registry. */
  fingerprint: string;
  /** The registry row's state, when there is one. */
  state: "ACTIVE" | "RETIRED" | null;
  /** A sentence for an operator or a page. It never upgrades "signed" to "trusted". */
  meaning: string;
};

/**
 * Verify a receipt both ways: the signature, and whether the signing key is trusted by the organization in
 * question. Pass `orgId` to ask "did *this* organization's gateway sign it?".
 */
export async function verifyTrustedReceipt(r: Receipt, a: { orgId?: string } = {}): Promise<TrustedReceiptVerdict> {
  const signatureValid = await verifyReceiptSignature(r).catch(() => false);
  const publicKey = typeof r?.gateway === "string" ? r.gateway : "";
  const fingerprint = publicKey ? await gatewayKeyFingerprint(publicKey) : "";
  const row = fingerprint ? await getDb().query.gatewayKeyTrust.findFirst({ where: eq(gatewayKeyTrust.fingerprint, fingerprint) }) : undefined;
  const matchesOrg = Boolean(row && (!a.orgId || row!.orgId === a.orgId));
  // A key trusted by a different organization is mathematically valid and not this organization's receipt.
  const trusted = signatureValid && matchesOrg;
  return {
    signatureValid, trusted, trustedOrgId: row?.orgId ?? null, fingerprint, state: (row?.state as "ACTIVE" | "RETIRED" | undefined) ?? null,
    meaning: !signatureValid
      ? "The receipt's signature does not verify, so nothing about it can be relied on."
      : trusted
        ? row!.state === "ACTIVE"
          ? "Signed by a gateway key this organization trusts."
          : "Signed by a gateway key this organization trusted; the key is retired, and the receipt is still good."
        : row
          ? "Signed by a gateway key this organization does not trust (another organization does)."
          : "Mathematically valid, but the signing key is not in any organization's trust registry.",
  };
}

/** Every organization whose registry trusts the key embedded in this receipt. Empty when none does. */
export async function organizationsTrustingReceipt(r: Receipt): Promise<string[]> {
  if (typeof r?.gateway !== "string" || !r.gateway) return [];
  const fingerprint = await gatewayKeyFingerprint(r.gateway);
  const rows = await getDb().select({ orgId: gatewayKeyTrust.orgId }).from(gatewayKeyTrust).where(eq(gatewayKeyTrust.fingerprint, fingerprint));
  return [...new Set(rows.map((x) => x.orgId))];
}
