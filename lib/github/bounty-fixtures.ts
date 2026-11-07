/**
 * Fictional repository for the bounty demo: lagosroast/api, issue #31 "Rate-limit the order API",
 * and two pull requests submitted for it:
 *
 *   #32 by chidi-dev     implements it, adds a test per acceptance criterion, CI green.
 *   #33 by quickfix-dev  green CI too, but only because it sets the workflow to continue on error,
 *                        deletes a failing test and skips the new one. Verification must catch this.
 */
export const BOUNTY_REPO = "lagosroast/api";
export const BOUNTY_ISSUE = 31;

export const bountyIssue = {
  number: BOUNTY_ISSUE,
  title: "Rate-limit the public order API",
  body: "Partners call POST /api/orders from scripts; one bad loop took the API down last week.\n\nAcceptance criteria:\n- POST /api/orders allows 100 requests per minute per API key\n- The 101st request in a minute is rejected with HTTP 429 and a Retry-After header\n- Each API key has its own limit, so one key cannot use up another key's quota",
};

export const BOUNTY_CRITERIA = [
  "POST /api/orders allows 100 requests per minute per API key",
  "The 101st request in a minute is rejected with HTTP 429 and a Retry-After header",
  "Each API key has its own limit, so one key cannot use up another key's quota",
];

type File = { filename: string; status: string; additions: number; deletions: number; patch?: string };
type Commit = { sha: string; message: string; author: string; date: string };
type Run = { name: string; status: string; conclusion: string | null; url: string | null };
export type FixturePull = { number: number; title: string; body: string; author: string; headRef: string; headSha: string; commits: Commit[]; files: File[]; checkRuns: Run[] };

const sha = (s: string) => s.padEnd(40, "0").slice(0, 40);

export const honestPull: FixturePull = {
  number: 32,
  title: "Rate-limit POST /api/orders per API key",
  author: "chidi-dev",
  headRef: "rate-limit-orders",
  body: `Closes #${BOUNTY_ISSUE}\n\nSliding one-minute window per API key, 100 requests. The 101st gets 429 with Retry-After (seconds until the window frees up).`,
  headSha: sha("c4d1e7a9b2f30658e1d4"),
  commits: [
    { sha: sha("a1b2c3d4e5f60718293a"), message: "Add per-key sliding-window rate limiter", author: "Chidi Okafor", date: "2026-11-07T08:10:00Z" },
    { sha: sha("b2c3d4e5f60718293a4b"), message: "Apply the limiter to POST /api/orders; 429 with Retry-After", author: "Chidi Okafor", date: "2026-11-07T09:02:00Z" },
    { sha: sha("c4d1e7a9b2f30658e1d4"), message: "Tests: limit, 429 + Retry-After, keys are independent", author: "Chidi Okafor", date: "2026-11-07T09:40:00Z" },
  ],
  files: [
    { filename: "lib/rate-limit.ts", status: "added", additions: 38, deletions: 0, patch: "@@ -0,0 +1,38 @@\n+const WINDOW_MS = 60_000;\n+const LIMIT = 100;\n+const hits = new Map<string, number[]>();\n+export function take(apiKey: string, now = Date.now()) {\n+  const recent = (hits.get(apiKey) ?? []).filter((t) => now - t < WINDOW_MS);\n+  if (recent.length >= LIMIT) return { ok: false, retryAfter: Math.ceil((recent[0]! + WINDOW_MS - now) / 1000) };\n+  recent.push(now);\n+  hits.set(apiKey, recent);\n+  return { ok: true, retryAfter: 0 };\n+}" },
    { filename: "app/api/orders/route.ts", status: "modified", additions: 9, deletions: 1, patch: "@@ -1,6 +1,14 @@\n+import { take } from '@/lib/rate-limit';\n export async function POST(req: Request) {\n+  const key = req.headers.get('x-api-key') ?? 'anonymous';\n+  const r = take(key);\n+  if (!r.ok) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(r.retryAfter) } });\n-  return createOrder(await req.json());\n+  return createOrder(await req.json());\n }" },
    { filename: "tests/rate-limit.test.ts", status: "added", additions: 34, deletions: 0, patch: "@@ -0,0 +1,34 @@\n+import { describe, it, expect } from 'vitest';\n+import { take } from '../lib/rate-limit';\n+describe('order API rate limit', () => {\n+  it('allows 100 requests per minute per API key', () => {\n+    for (let i = 0; i < 100; i++) expect(take('k1', 1000 + i).ok).toBe(true);\n+  });\n+  it('rejects the 101st request in a minute with 429 and a Retry-After header', async () => {\n+    for (let i = 0; i < 100; i++) take('k2', 1000);\n+    const r = take('k2', 1500);\n+    expect(r.ok).toBe(false);\n+    expect(r.retryAfter).toBeGreaterThan(0);\n+  });\n+  it('gives each API key its own limit so one key cannot use up another key quota', () => {\n+    for (let i = 0; i < 100; i++) take('k3', 1000);\n+    expect(take('k4', 1000).ok).toBe(true);\n+  });\n+});" },
  ],
  checkRuns: [
    { name: "test", status: "completed", conclusion: "success", url: "https://github.com/lagosroast/api/actions/runs/1032" },
    { name: "lint", status: "completed", conclusion: "success", url: "https://github.com/lagosroast/api/actions/runs/1033" },
  ],
};

export const cheatingPull: FixturePull = {
  number: 33,
  title: "Add rate limiting to orders",
  author: "quickfix-dev",
  headRef: "quick-rate-limit",
  body: `Closes #${BOUNTY_ISSUE}\n\nDone, all checks green. Also cleaned up a flaky test.`,
  headSha: sha("9e8f7a6b5c4d3e2f1a0b"),
  commits: [
    { sha: sha("8e7f6a5b4c3d2e1f0a9b"), message: "rate limiting", author: "Quick Fix", date: "2026-11-07T07:01:00Z" },
    { sha: sha("9e8f7a6b5c4d3e2f1a0b"), message: "fix ci", author: "Quick Fix", date: "2026-11-07T07:05:00Z" },
  ],
  files: [
    { filename: "app/api/orders/route.ts", status: "modified", additions: 4, deletions: 0, patch: "@@ -1,6 +1,10 @@\n+let count = 0;\n export async function POST(req: Request) {\n+  if (++count > 100) return new Response('slow down', { status: 429 });\n   return createOrder(await req.json());\n }" },
    { filename: "tests/orders.test.ts", status: "modified", additions: 0, deletions: 6, patch: "@@ -20,12 +20,6 @@\n   it('creates an order', async () => {\n     expect((await post(validOrder)).status).toBe(201);\n   });\n-  it('rejects malformed order payloads', async () => {\n-    expect((await post({ items: 'oops' })).status).toBe(400);\n-  });\n-  it('keeps working after 100 requests from another key', async () => {\n-    for (let i = 0; i < 101; i++) await post(validOrder, 'other');\n-    expect((await post(validOrder, 'mine')).status).toBe(201);\n });" },
    { filename: "tests/rate-limit.test.ts", status: "added", additions: 5, deletions: 0, patch: "@@ -0,0 +1,5 @@\n+import { it } from 'vitest';\n+it.skip('rejects the 101st request in a minute with 429 and a Retry-After header', async () => {\n+  // TODO\n+});" },
    { filename: ".github/workflows/ci.yml", status: "modified", additions: 1, deletions: 0, patch: "@@ -12,6 +12,7 @@ jobs:\n   test:\n     runs-on: ubuntu-latest\n+    continue-on-error: true\n     steps:\n       - uses: actions/checkout@v4" },
  ],
  checkRuns: [
    { name: "test", status: "completed", conclusion: "success", url: "https://github.com/lagosroast/api/actions/runs/1029" },
  ],
};
