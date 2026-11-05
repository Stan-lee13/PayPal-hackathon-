/**
 * PayPal webhook signature verification.
 *
 * Primary path ("local" verification, as documented by PayPal):
 *   expected = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`
 *   verify SHA256withRSA(expected, base64(transmissionSig)) with the public key of the
 *   certificate at PAYPAL-CERT-URL — but only after confirming that URL is a
 *   PayPal-owned HTTPS host.
 * Verifying against the RAW body avoids the re-serialisation pitfalls of the
 * postback API. If the certificate cannot be fetched we fall back to PayPal's
 * POST /v1/notifications/verify-webhook-signature.
 */
import { createVerify, X509Certificate } from "node:crypto";
import type { PayPalClient } from "./client";

export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

export function readWebhookHeaders(h: Headers): WebhookHeaders | null {
  const get = (k: string) => h.get(k) ?? h.get(k.toLowerCase());
  const transmissionId = get("PAYPAL-TRANSMISSION-ID");
  const transmissionTime = get("PAYPAL-TRANSMISSION-TIME");
  const transmissionSig = get("PAYPAL-TRANSMISSION-SIG");
  const certUrl = get("PAYPAL-CERT-URL");
  const authAlgo = get("PAYPAL-AUTH-ALGO");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return null;
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of the raw bytes, as an unsigned decimal integer. */
export function crc32(data: Buffer | string): number {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function signedMessage(h: WebhookHeaders, webhookId: string, rawBody: string): string {
  return `${h.transmissionId}|${h.transmissionTime}|${webhookId}|${crc32(rawBody)}`;
}

/** Only certificates served from PayPal's own HTTPS hosts are trusted. */
export function isTrustedCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "paypal.com" || u.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, { pem: string; at: number }>();

export const defaultCertFetcher: CertFetcher = async (url) => {
  const hit = certCache.get(url);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.pem;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const pem = await res.text();
  certCache.set(url, { pem, at: Date.now() });
  return pem;
};

export type VerifyResult = { ok: true; method: "local" | "api" } | { ok: false; reason: string };

export async function verifyWebhookSignature(args: {
  headers: WebhookHeaders | null;
  rawBody: string;
  webhookId: string | undefined;
  certFetcher?: CertFetcher;
  /** Used only if local verification cannot complete (e.g. cert host unreachable). */
  paypal?: PayPalClient;
  /** Reject transmissions older than this (replay protection). Default 7 days, PayPal retries for 3. */
  maxAgeMs?: number;
  now?: Date;
}): Promise<VerifyResult> {
  const { headers, rawBody, webhookId } = args;
  if (!webhookId) return { ok: false, reason: "PAYPAL_WEBHOOK_ID is not configured" };
  if (!headers) return { ok: false, reason: "missing PayPal transmission headers" };
  if (!/^SHA256withRSA$/i.test(headers.authAlgo)) return { ok: false, reason: `unsupported auth algo ${headers.authAlgo}` };
  if (!isTrustedCertUrl(headers.certUrl)) return { ok: false, reason: "cert url is not a PayPal host" };
  const sentAt = Date.parse(headers.transmissionTime);
  const now = (args.now ?? new Date()).getTime();
  if (Number.isNaN(sentAt) || now - sentAt > (args.maxAgeMs ?? 7 * 24 * 3600_000) || sentAt - now > 10 * 60_000) {
    return { ok: false, reason: "transmission time outside acceptance window" };
  }

  let pem: string | null = null;
  try {
    pem = await (args.certFetcher ?? defaultCertFetcher)(headers.certUrl);
  } catch (e) {
    if (args.paypal) return verifyViaApi(args.paypal, headers, rawBody, webhookId);
    return { ok: false, reason: `could not fetch PayPal certificate: ${String(e)}` };
  }
  try {
    const cert = new X509Certificate(pem);
    const validTo = Date.parse(cert.validTo);
    const validFrom = Date.parse(cert.validFrom);
    if (now > validTo || now < validFrom) return { ok: false, reason: "PayPal certificate not currently valid" };
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signedMessage(headers, webhookId, rawBody));
    verifier.end();
    const ok = verifier.verify(cert.publicKey, Buffer.from(headers.transmissionSig, "base64"));
    return ok ? { ok: true, method: "local" } : { ok: false, reason: "signature mismatch" };
  } catch (e) {
    return { ok: false, reason: `signature verification error: ${String(e)}` };
  }
}

async function verifyViaApi(pp: PayPalClient, h: WebhookHeaders, rawBody: string, webhookId: string): Promise<VerifyResult> {
  try {
    const res = await pp.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: h.authAlgo,
        cert_url: h.certUrl,
        transmission_id: h.transmissionId,
        transmission_sig: h.transmissionSig,
        transmission_time: h.transmissionTime,
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      },
    });
    return res.verification_status === "SUCCESS" ? { ok: true, method: "api" } : { ok: false, reason: `PayPal verification: ${res.verification_status}` };
  } catch (e) {
    return { ok: false, reason: `verification API error: ${String(e)}` };
  }
}
