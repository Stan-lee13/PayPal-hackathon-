/**
 * Minimal GitHub REST client (server-side only), for the few calls MergePay makes:
 *
 *   GET  /repos/{repo}/pulls/{n}             title, body, head SHA, state, mergeable
 *   GET  /repos/{repo}/pulls/{n}/commits     commit messages (for the invoice description)
 *   GET  /repos/{repo}/pulls/{n}/files       changed files (for the scope check)
 *   GET  /repos/{repo}/issues/{n}            the issues the PR closes
 *   PUT  /repos/{repo}/pulls/{n}/merge       with `sha` = the invoiced commit, so a moved head is refused
 *   POST /repos/{repo}/issues/{n}/comments   status notes on the PR
 *   GET  /repos/{repo}/deployments?sha=      the preview the client checks before paying
 *
 * GITHUB_MODE=live uses api.github.com with GITHUB_TOKEN (a fine-grained token scoped to the
 * demo repository). GITHUB_MODE=simulated uses lib/github/emulator.ts. Unset: live when a token exists.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class GitHubApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body: unknown) {
    super(message);
  }
}

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  headSha: string;
  headRef: string;
  baseRef: string;
  author: string;
  mergeable: boolean | null;
};

export type PrCommit = { sha: string; message: string; author: string; date: string };
export type PrFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };
export type Issue = { number: number; title: string; body: string; state: "open" | "closed"; url: string; isPullRequest: boolean };

export type GitHubMode = "live" | "simulated";

export function githubMode(): GitHubMode {
  const m = process.env.GITHUB_MODE;
  if (m === "live" || m === "simulated") return m;
  return process.env.GITHUB_TOKEN ? "live" : "simulated";
}

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export function assertRepo(repo: string): string {
  if (!REPO_RE.test(repo)) throw new GitHubApiError(400, `Not a repository name: "${repo}" (expected owner/name)`, null);
  return repo;
}

export class GitHubClient {
  private readonly fetchImpl: FetchLike;
  constructor(private readonly token: string, fetchImpl?: FetchLike, private readonly baseUrl = "https://api.github.com") {
    this.fetchImpl = fetchImpl ?? ((i, init) => fetch(i, init));
  }

  async request<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mergepay",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = (json as { message?: string }).message ?? `HTTP ${res.status}`;
      throw new GitHubApiError(res.status, `GitHub ${method} ${path.split("?")[0]} failed (${res.status}): ${msg}`, json);
    }
    return json as T;
  }

  async getPull(repo: string, n: number): Promise<PullRequest> {
    const p = await this.request<{
      number: number; title: string; body: string | null; html_url: string; state: "open" | "closed"; merged: boolean; draft?: boolean;
      head: { sha: string; ref: string }; base: { ref: string }; user: { login: string } | null; mergeable: boolean | null;
    }>("GET", `/repos/${assertRepo(repo)}/pulls/${n}`);
    return {
      number: p.number, title: p.title, body: p.body ?? "", url: p.html_url, state: p.state, merged: p.merged, draft: Boolean(p.draft),
      headSha: p.head.sha, headRef: p.head.ref, baseRef: p.base.ref, author: p.user?.login ?? "unknown", mergeable: p.mergeable,
    };
  }

  async listPullCommits(repo: string, n: number): Promise<PrCommit[]> {
    const rows = await this.request<Array<{ sha: string; commit: { message: string; author: { name?: string; date?: string } | null } }>>(
      "GET", `/repos/${assertRepo(repo)}/pulls/${n}/commits?per_page=100`);
    return rows.map((c) => ({ sha: c.sha, message: c.commit.message, author: c.commit.author?.name ?? "", date: c.commit.author?.date ?? "" }));
  }

  async listPullFiles(repo: string, n: number): Promise<PrFile[]> {
    const rows = await this.request<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>>(
      "GET", `/repos/${assertRepo(repo)}/pulls/${n}/files?per_page=100`);
    return rows.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch }));
  }

  async getIssue(repo: string, n: number): Promise<Issue> {
    const i = await this.request<{ number: number; title: string; body: string | null; state: "open" | "closed"; html_url: string; pull_request?: unknown }>(
      "GET", `/repos/${assertRepo(repo)}/issues/${n}`);
    return { number: i.number, title: i.title, body: i.body ?? "", state: i.state, url: i.html_url, isPullRequest: Boolean(i.pull_request) };
  }

  /** Merge exactly `sha`. GitHub answers 409 if the PR head has moved since. */
  async mergePull(repo: string, n: number, sha: string, method: "squash" | "merge" | "rebase", title: string): Promise<{ sha: string; merged: boolean; message: string }> {
    return this.request("PUT", `/repos/${assertRepo(repo)}/pulls/${n}/merge`, { sha, merge_method: method, commit_title: title.slice(0, 250) });
  }

  async comment(repo: string, n: number, body: string): Promise<{ id: number; html_url: string }> {
    return this.request("POST", `/repos/${assertRepo(repo)}/issues/${n}/comments`, { body });
  }

  /** The newest successful deployment URL for a commit (e.g. a Vercel preview), if any. */
  async previewUrlFor(repo: string, sha: string): Promise<string | null> {
    const deps = await this.request<Array<{ id: number; statuses_url: string }>>("GET", `/repos/${assertRepo(repo)}/deployments?sha=${encodeURIComponent(sha)}&per_page=5`);
    for (const d of deps) {
      const statuses = await this.request<Array<{ state: string; environment_url?: string; target_url?: string }>>("GET", `/repos/${assertRepo(repo)}/deployments/${d.id}/statuses?per_page=5`);
      const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
      if (ok) return ok.environment_url || ok.target_url || null;
    }
    return null;
  }
}

/** Issue numbers a PR closes in its own repository ("Closes #12", "fixes #3", "Resolves #7"). */
export function linkedIssueNumbers(prBody: string): number[] {
  const out = new Set<number>();
  for (const m of prBody.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d{1,7})\b/gi)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

let shared: GitHubClient | null = null;

export function getGitHub(): GitHubClient {
  if (!shared) {
    if (githubMode() === "simulated") {
      shared = new GitHubClient("SIMULATED", (i, init) => import("./emulator").then((m) => m.githubEmulatorFetch(i, init)), "https://github.sim");
    } else {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GitHub is not configured: set GITHUB_TOKEN (or GITHUB_MODE=simulated).");
      shared = new GitHubClient(token);
    }
  }
  return shared;
}

export function setGitHubForTesting(c: GitHubClient | null) {
  shared = c;
}
