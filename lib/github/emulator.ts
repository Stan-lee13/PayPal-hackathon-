/**
 * Simulated GitHub (GITHUB_MODE=simulated). Implements only the REST routes lib/github/client.ts
 * calls, over one plain JSON state object (lib/sim/store.ts), seeded with a fictional client repo:
 *
 *   lagosroast/storefront
 *     #12 issue  Add PayPal checkout to the cart page        (agreed price in the demo contract)
 *     #14 issue  Menu overflows on small phones              (agreed price in the demo contract)
 *     #18 PR     Add PayPal checkout and fix mobile nav      closes #12 and #14, and also rewrites
 *                analytics tracking, which neither issue asked for (the scope check should notice)
 *
 * Everything it produces is labelled simulated in the UI.
 */
import { createHash } from "node:crypto";
import { appBaseUrl } from "../base-url";
import { simState, withSimState } from "../sim/store";
import { BOUNTY_REPO, bountyIssue, cheatingPull, honestPull, type FixturePull } from "./bounty-fixtures";

type SimIssue = { number: number; title: string; body: string; state: "open" | "closed" };
type SimPull = {
  number: number; title: string; body: string; state: "open" | "closed"; merged: boolean; draft: boolean;
  headSha: string; headRef: string; baseRef: string; author: string;
  commits: Array<{ sha: string; message: string; author: string; date: string }>;
  files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
  comments: Array<{ id: number; body: string; at: string }>;
  mergeCommitSha?: string;
  checkRuns?: Array<{ name: string; status: string; conclusion: string | null; url: string | null }>;
};
type SimRepo = { nextNumber: number; issues: Record<string, SimIssue>; pulls: Record<string, SimPull>; deployments: Record<string, string> };
type GitHubSim = { repos: Record<string, SimRepo>; commentSeq: number; shaSeq: number };

export const DEMO_REPO = "lagosroast/storefront";

const fakeSha = (seed: string) => createHash("sha1").update(seed).digest("hex");

function seedRepo(): SimRepo {
  const issues: Record<string, SimIssue> = {
    "12": { number: 12, state: "open", title: "Add PayPal checkout to the cart page",
      body: "Customers should be able to pay with PayPal from /cart.\n\nAcceptance criteria:\n- PayPal button on the cart page\n- The amount charged matches the cart total\n- After paying, the customer sees an order confirmation with the order number" },
    "14": { number: 14, state: "open", title: "Menu overflows on small phones",
      body: "On phones narrower than 375px the top menu runs off the screen and the cart icon can't be tapped.\n\nAcceptance criteria:\n- Menu fits on a 320px screen\n- Cart icon always visible" },
    "16": { number: 16, state: "open", title: "Loyalty points", body: "Later: give customers a point per cup bought. Not scheduled yet." },
  };
  const pr = demoPull(18, 12, 14, "seed");
  return { nextNumber: 19, issues, pulls: { "18": pr }, deployments: { [pr.headSha]: `${appBaseUrl()}/sim/preview/${DEMO_REPO}/18` } };
}

function demoPull(number: number, checkoutIssue: number, navIssue: number, seed: string): SimPull {
  const day = "2026-11-05";
  const c = (n: number, message: string, hour: string) => ({ sha: fakeSha(`${seed}-${number}-c${n}`), message, author: "Tobi Adeyemi", date: `${day}T${hour}:00Z` });
  const commits = [
    c(1, "Add PayPal Smart Button to the cart page", "09:12"),
    c(2, "Show order confirmation after PayPal approval", "11:40"),
    c(3, "Fix menu overflow under 375px; keep cart icon visible", "14:05"),
    c(4, "Rewrite analytics events to the new tracking schema", "16:22"),
  ];
  return {
    number, state: "open", merged: false, draft: false, author: "tobi-dev", baseRef: "main", headRef: `paypal-checkout-${number}`,
    title: "Add PayPal checkout and fix mobile nav",
    body: `Closes #${checkoutIssue}\nCloses #${navIssue}\n\n- PayPal button on /cart, charged amount taken from the cart total\n- Order confirmation page after approval\n- Menu no longer overflows on small phones\n- Also tidied up analytics events while I was in there`,
    headSha: commits[commits.length - 1]!.sha,
    commits,
    files: [
      { filename: "app/cart/page.tsx", status: "modified", additions: 64, deletions: 3, patch: "+import { PayPalButton } from '@/components/paypal-button'\n+  <PayPalButton amount={cart.total} currency=\"USD\" />" },
      { filename: "components/paypal-button.tsx", status: "added", additions: 88, deletions: 0, patch: "+export function PayPalButton({ amount, currency }) {\n+  // createOrder uses the cart total; onApprove captures and redirects to /checkout/success" },
      { filename: "app/checkout/success/page.tsx", status: "added", additions: 41, deletions: 0, patch: "+export default function Success({ searchParams }) {\n+  return <h1>Thanks! Order {searchParams.order} is confirmed.</h1>" },
      { filename: "components/site-nav.tsx", status: "modified", additions: 12, deletions: 9, patch: "-  <nav className=\"flex gap-8\">\n+  <nav className=\"flex flex-wrap gap-4 max-[375px]:gap-2\">" },
      { filename: "styles/nav.css", status: "modified", additions: 18, deletions: 2 },
      { filename: "lib/analytics.ts", status: "modified", additions: 57, deletions: 4, patch: "-track('add_to_cart', item)\n+trackEvent({ name: 'cart.item_added', schema: 'v2', item })" },
      { filename: "package.json", status: "modified", additions: 1, deletions: 0, patch: "+    \"@paypal/react-paypal-js\": \"^8.8.0\"," },
    ],
    comments: [],
  };
}

function fromFixture(f: FixturePull): SimPull {
  return { number: f.number, title: f.title, body: f.body, state: "open", merged: false, draft: false, headSha: f.headSha, headRef: f.headRef, baseRef: "main", author: f.author,
    commits: structuredClone(f.commits), files: structuredClone(f.files), comments: [], checkRuns: structuredClone(f.checkRuns) };
}

function seedBountyRepo(): SimRepo {
  return { nextNumber: 34, issues: { [String(bountyIssue.number)]: { ...bountyIssue, state: "open" } }, pulls: { "32": fromFixture(honestPull), "33": fromFixture(cheatingPull) }, deployments: {} };
}

/** Replay the bounty demo: a fresh issue and fresh copies of both submissions, closing it. */
export function simCreateBountyScenario(): { issue: number; honest: number; cheating: number } {
  const r = repoOf(BOUNTY_REPO)!;
  const issue = r.nextNumber++;
  const honest = r.nextNumber++;
  const cheating = r.nextNumber++;
  const salt = state().shaSeq++;
  r.issues[String(issue)] = { ...bountyIssue, number: issue, state: "open" };
  for (const [n, f] of [[honest, honestPull], [cheating, cheatingPull]] as const) {
    const pr = fromFixture(f);
    pr.number = n;
    pr.body = pr.body.replace(`#${bountyIssue.number}`, `#${issue}`);
    pr.headSha = fakeSha(`${f.headSha}-${salt}`);
    pr.commits[pr.commits.length - 1]!.sha = pr.headSha;
    r.pulls[String(n)] = pr;
  }
  return { issue, honest, cheating };
}

function state(): GitHubSim {
  return simState<GitHubSim>("github", () => ({ repos: { [DEMO_REPO]: seedRepo(), [BOUNTY_REPO]: seedBountyRepo() }, commentSeq: 1000, shaSeq: 0 }));
}

function repoOf(full: string): SimRepo | null {
  return state().repos[full] ?? null;
}

// ---------------------------------------------------------------------------
// Demo helpers (simulated mode only; called from the playground)
// ---------------------------------------------------------------------------

/** A fresh pair of issues and a PR closing them, so the demo can be replayed. Returns the numbers. */
export function simCreateDemoPullRequest(repo = DEMO_REPO): { pr: number; issues: [number, number] } {
  const r = repoOf(repo);
  if (!r) throw new Error(`No simulated repo ${repo}`);
  const checkout = r.nextNumber++;
  const nav = r.nextNumber++;
  const prNo = r.nextNumber++;
  r.issues[String(checkout)] = { ...r.issues["12"]!, number: checkout, state: "open" };
  r.issues[String(nav)] = { ...r.issues["14"]!, number: nav, state: "open" };
  const pr = demoPull(prNo, checkout, nav, `gen-${state().shaSeq++}`);
  r.pulls[String(prNo)] = pr;
  r.deployments[pr.headSha] = `${appBaseUrl()}/sim/preview/${repo}/${prNo}`;
  return { pr: prNo, issues: [checkout, nav] };
}

/** The freelancer pushes one more commit after invoicing (to demonstrate that merge is then refused). */
export function simPushCommit(repo: string, n: number, message = "Late change after the invoice was sent"): string {
  const pr = repoOf(repo)?.pulls[String(n)];
  if (!pr) throw new Error(`No simulated PR ${repo}#${n}`);
  const sha = fakeSha(`${repo}-${n}-late-${state().shaSeq++}`);
  pr.commits.push({ sha, message, author: "Tobi Adeyemi", date: new Date().toISOString() });
  pr.headSha = sha;
  return sha;
}

export function simPullSnapshot(repo: string, n: number): SimPull | null {
  return repoOf(repo)?.pulls[String(n)] ?? null;
}

export function simListPulls(repo = DEMO_REPO): SimPull[] {
  return Object.values(repoOf(repo)?.pulls ?? {}).sort((a, b) => b.number - a.number);
}

// ---------------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------------

const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => reply(404, { message: "Not Found" });

export function githubEmulatorFetch(input: string, init: RequestInit): Promise<Response> {
  return withSimState(() => route(input, init));
}

function route(input: string, init: RequestInit): Response {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
  const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/(.+)$/);
  if (!m) return notFound();
  const full = decodeURIComponent(m[1]!);
  const rest = m[2]!;
  const r = repoOf(full);
  if (!r) return notFound();
  const html = (kind: "pull" | "issues", n: number) => `https://github.com/${full}/${kind}/${n}`;

  let mm: RegExpMatchArray | null;
  if ((mm = rest.match(/^pulls\/(\d+)$/)) && method === "GET") {
    const p = r.pulls[mm[1]!];
    if (!p) return notFound();
    return reply(200, { number: p.number, title: p.title, body: p.body, html_url: html("pull", p.number), state: p.state, merged: p.merged, draft: p.draft,
      head: { sha: p.headSha, ref: p.headRef }, base: { ref: p.baseRef }, user: { login: p.author }, mergeable: p.state === "open" ? true : null });
  }
  if ((mm = rest.match(/^pulls\/(\d+)\/commits$/)) && method === "GET") {
    const p = r.pulls[mm[1]!];
    if (!p) return notFound();
    return reply(200, p.commits.map((c) => ({ sha: c.sha, commit: { message: c.message, author: { name: c.author, date: c.date } } })));
  }
  if ((mm = rest.match(/^pulls\/(\d+)\/files$/)) && method === "GET") {
    const p = r.pulls[mm[1]!];
    if (!p) return notFound();
    return reply(200, p.files);
  }
  if ((mm = rest.match(/^pulls\/(\d+)\/merge$/)) && method === "PUT") {
    const p = r.pulls[mm[1]!];
    if (!p) return notFound();
    if (p.state !== "open" || p.merged) return reply(405, { message: "Pull Request is not mergeable" });
    if (body.sha && body.sha !== p.headSha) return reply(409, { message: "Head branch was modified. Review and try the merge again." });
    p.state = "closed";
    p.merged = true;
    p.mergeCommitSha = fakeSha(`${full}-${p.number}-merge-${p.headSha}`);
    for (const n of [...p.body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)].map((x) => x[1]!)) {
      if (r.issues[n]) r.issues[n]!.state = "closed";
    }
    return reply(200, { sha: p.mergeCommitSha, merged: true, message: "Pull Request successfully merged" });
  }
  if ((mm = rest.match(/^issues\/(\d+)$/)) && method === "GET") {
    const n = mm[1]!;
    const i = r.issues[n];
    if (i) return reply(200, { number: i.number, title: i.title, body: i.body, state: i.state, html_url: html("issues", i.number) });
    const p = r.pulls[n];
    if (p) return reply(200, { number: p.number, title: p.title, body: p.body, state: p.state, html_url: html("pull", p.number), pull_request: {} });
    return notFound();
  }
  if ((mm = rest.match(/^issues\/(\d+)\/comments$/)) && method === "POST") {
    const p = r.pulls[mm[1]!];
    if (!p) return notFound();
    const id = state().commentSeq++;
    p.comments.push({ id, body: String(body.body ?? ""), at: new Date().toISOString() });
    return reply(201, { id, html_url: `${html("pull", p.number)}#issuecomment-${id}` });
  }
  if ((mm = rest.match(/^commits\/([0-9a-f]{7,40})\/check-runs$/)) && method === "GET") {
    const pr = Object.values(r.pulls).find((p) => p.headSha === mm![1]);
    const runs = pr?.checkRuns ?? [];
    return reply(200, { total_count: runs.length, check_runs: runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, html_url: c.url })) });
  }
  if (rest === "deployments" && method === "GET") {
    const sha = url.searchParams.get("sha") ?? "";
    const id = Object.keys(r.deployments).indexOf(sha) + 1;
    return reply(200, id > 0 ? [{ id, statuses_url: "", sha }] : []);
  }
  if ((mm = rest.match(/^deployments\/(\d+)\/statuses$/)) && method === "GET") {
    const sha = Object.keys(r.deployments)[Number(mm[1]) - 1];
    return reply(200, sha ? [{ state: "success", environment_url: r.deployments[sha] }] : []);
  }
  return notFound();
}

