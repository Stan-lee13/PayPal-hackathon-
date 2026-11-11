/**
 * Tamper-evident audit chains. Every audit entry for an invoice (and, separately, every
 * freelancer-level entry) is linked to the previous one by SHA-256, so editing, deleting
 * or reordering any past entry breaks every hash after it.
 *
 * Pure and dependency-free (node:crypto only), so an evidence pack can be re-verified
 * offline by anyone: `npx tsx scripts/verify-trail.ts trail.json`.
 *
 * What this proves: the record has not been altered since each entry was written, and
 * nothing was removed from or inserted into the middle. What it does not prove on its own:
 * that the newest entries were not truncated — compare the head hash with one shown to
 * the customer earlier (the invoice page shows it) to detect that.
 */
import { createHash } from "node:crypto";

export const CHAIN_VERSION = "envelope-audit-chain/1";

export type ChainEntry = {
  seq: number;
  scopeId: string;
  subjectId: string | null;
  actor: string;
  action: string;
  ref: string | null;
  outcome: string;
  detail: unknown;
  createdAt: string; // ISO 8601, millisecond precision
  prevHash: string;
  hash: string;
};

/** JSON with object keys sorted at every level (jsonb does not preserve key order). */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v ?? null))));
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function genesisHash(scopeId: string, subjectId: string | null): string {
  return sha256(`${CHAIN_VERSION}|genesis|${scopeId}|${subjectId ?? "-"}`);
}

export function entryHash(e: Omit<ChainEntry, "hash">): string {
  return sha256([CHAIN_VERSION, e.prevHash, String(e.seq), e.scopeId, e.subjectId ?? "-", e.actor, e.action, e.ref ?? "-", e.outcome, canonicalJson(e.detail), e.createdAt].join("|"));
}

export type ChainVerdict =
  | { ok: true; length: number; head: string }
  | { ok: false; length: number; brokenAtSeq: number; reason: string };

/** Verify a whole chain from genesis. `entries` may arrive in any order. */
export function verifyChain(scopeId: string, subjectId: string | null, entries: ChainEntry[]): ChainVerdict {
  const rows = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = genesisHash(scopeId, subjectId);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.seq !== i + 1) return { ok: false, length: rows.length, brokenAtSeq: r.seq, reason: i + 1 < r.seq ? `entry ${i + 1} is missing` : `entry ${r.seq} appears twice` };
    if (r.scopeId !== scopeId || (r.subjectId ?? null) !== subjectId) return { ok: false, length: rows.length, brokenAtSeq: r.seq, reason: "entry belongs to a different chain" };
    if (r.prevHash !== prev) return { ok: false, length: rows.length, brokenAtSeq: r.seq, reason: "link to the previous entry does not match (an earlier entry was changed or removed)" };
    const { hash: _ignored, ...rest } = r;
    if (entryHash(rest) !== r.hash) return { ok: false, length: rows.length, brokenAtSeq: r.seq, reason: "entry content does not match its hash (it was edited after it was written)" };
    prev = r.hash;
  }
  return { ok: true, length: rows.length, head: prev };
}
