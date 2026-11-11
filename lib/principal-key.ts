"use client";

/**
 * The human principal's signing key lives in THIS browser (localStorage, demo-grade storage):
 * the gateway never sees it, so it cannot mint authority on the owner's behalf.
 */
import { exportPrivateJwk, generateKeyPair, importPrivateJwk, type KeyPair } from "./envelope/core";

const KEY = "envelope.principal.jwk";

export async function principalKey(create = true): Promise<KeyPair | null> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return await importPrivateJwk(JSON.parse(raw));
    if (!create) return null;
    const kp = await generateKeyPair();
    localStorage.setItem(KEY, JSON.stringify(await exportPrivateJwk(kp.privateKey)));
    return kp;
  } catch {
    return create ? generateKeyPair() : null; // storage blocked: a key for this page view only
  }
}
