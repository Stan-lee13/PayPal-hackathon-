/**
 * Deterministic verification gates for a bounty submission. Pure functions over evidence fetched
 * from GitHub for ONE commit (the PR head SHA). No model output is used here, and nothing here
 * executes the submitted code: tests run in the company's own CI (e.g. GitHub Actions) and we read
 * the results for that exact commit.
 *
 * A FAIL on any gate blocks an approval recommendation, whatever the AI says.
 */
import type { PrFile, PullRequest } from "../github/client";

export type CheckRun = { name: string; status: "queued" | "in_progress" | "completed" | string; conclusion: string | null; url: string | null };

export type GateStatus = "PASS" | "FAIL" | "WARN" | "UNKNOWN";
export type Gate = { id: string; label: string; status: GateStatus; detail: string; evidence: string[] };

export type GateInput = {
  pr: PullRequest;
  files: PrFile[];
  checkRuns: CheckRun[];
  /** The bounty's issue number, if it is tied to one. */
  issueNumber: number | null;
  /** GitHub login of the developer who claimed the bounty. */
  developerLogin: string;
  /** Check names that must succeed (empty: every check that ran must succeed). */
  requiredChecks: string[];
  requiresTests: boolean;
  /** Path prefixes the work should stay within (empty: no restriction). */
  scopePaths: string[];
};

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Test\.java$/i;
const CI_CONFIG = /^\.github\/workflows\/|^\.gitlab-ci\.ya?ml$|^\.circleci\/|^azure-pipelines\.ya?ml$|^Jenkinsfile$|^\.buildkite\//;
const TEST_CONFIG = /(^|\/)(vitest|jest|playwright|karma|mocha|cypress)\.config\.[cm]?[jt]s$|(^|\/)\.mocharc|(^|\/)(pytest\.ini|tox\.ini|conftest\.py|setup\.cfg|phpunit\.xml(\.dist)?)$/;
const MANIFEST = /(^|\/)(package\.json|requirements(-\w+)?\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;
const SKIP = /\b(it|test|describe)\.(skip|todo)\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|\bt\.Skip(Now|f)?\(|@Disabled\b|@Ignore\b|\bpytest\.skip\(|\.only\s*\(/;
const TEST_CASE = /^\s*(?:it|test)\s*\(\s*(['"`])(.+?)\1|^\s*def\s+(test_\w+)\s*\(|^\s*func\s+(Test\w+)\s*\(/;
const SECRETS: Array<[string, RegExp]> = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/],
  ["API secret key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];

/** Added (+) and removed (-) lines of a unified diff, without the +/- markers. */
export function diffLines(patch: string | undefined): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const l of (patch ?? "").split("\n")) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) added.push(l.slice(1));
    else if (l.startsWith("-")) removed.push(l.slice(1));
  }
  return { added, removed };
}

/** Names of test cases on the given lines ("it('rejects the 101st request')" → "rejects the 101st request"). */
export function testNames(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const m = l.match(TEST_CASE);
    if (m) out.push((m[2] ?? m[3] ?? m[4])!);
  }
  return out;
}

export function isTestFile(path: string) { return TEST_FILE.test(path); }

export function runGates(i: GateInput): Gate[] {
  const gates: Gate[] = [];
  const g = (id: string, label: string, status: GateStatus, detail: string, evidence: string[] = []) => gates.push({ id, label, status, detail, evidence });

  // 1. The PR is the claimed developer's, open, and for this bounty
  if (i.pr.author.toLowerCase() !== i.developerLogin.toLowerCase()) g("author", "Submitted by the developer who claimed the bounty", "FAIL", `The pull request was opened by @${i.pr.author}, but the bounty was claimed by @${i.developerLogin}.`);
  else g("author", "Submitted by the developer who claimed the bounty", "PASS", `Opened by @${i.pr.author}.`);
  if (i.pr.merged || i.pr.state !== "open") g("pr_state", "Pull request is open", "FAIL", i.pr.merged ? "Already merged." : "The pull request is closed.");
  else if (i.pr.draft) g("pr_state", "Pull request is open", "FAIL", "Still a draft.");
  else g("pr_state", "Pull request is open", "PASS", `Head commit ${i.pr.headSha.slice(0, 7)}.`);
  if (i.issueNumber) {
    const re = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${i.issueNumber}\\b`, "i");
    g("issue_link", `Closes issue #${i.issueNumber}`, re.test(i.pr.body) ? "PASS" : "FAIL", re.test(i.pr.body) ? "The description closes the bounty's issue." : `The description doesn't say "Closes #${i.issueNumber}".`);
  }

  // 2. CI on this exact commit
  const runs = i.checkRuns;
  const bad = runs.filter((r) => r.status === "completed" && !["success", "neutral", "skipped"].includes(r.conclusion ?? ""));
  const pending = runs.filter((r) => r.status !== "completed");
  const missing = i.requiredChecks.filter((n) => !runs.some((r) => r.name === n && r.status === "completed" && r.conclusion === "success"));
  if (runs.length === 0) g("ci", "CI passed on the submitted commit", "UNKNOWN", "No CI ran on this commit, so nothing objective proves it works. A reviewer must check it by hand.");
  else if (bad.length) g("ci", "CI passed on the submitted commit", "FAIL", `${bad.map((r) => `${r.name}: ${r.conclusion}`).join(", ")}.`, bad.map((r) => r.url ?? r.name));
  else if (pending.length) g("ci", "CI passed on the submitted commit", "UNKNOWN", `Still running: ${pending.map((r) => r.name).join(", ")}.`);
  else if (missing.length) g("ci", "CI passed on the submitted commit", "FAIL", `Required check${missing.length > 1 ? "s" : ""} didn't pass: ${missing.join(", ")}.`);
  else g("ci", "CI passed on the submitted commit", "PASS", `${runs.length} check${runs.length > 1 ? "s" : ""} passed on ${i.pr.headSha.slice(0, 7)}: ${runs.map((r) => r.name).join(", ")}.`, runs.map((r) => r.url ?? r.name));

  // 3. The tests themselves weren't weakened
  const ci = i.files.filter((f) => CI_CONFIG.test(f.filename) || TEST_CONFIG.test(f.filename));
  const testScript = i.files.filter((f) => /(^|\/)package\.json$/.test(f.filename) && diffLines(f.patch).added.some((l) => /"(test|pretest|posttest)"\s*:/.test(l)));
  if (ci.length || testScript.length) g("ci_tamper", "Doesn't change how the tests run", "FAIL", "The submission edits CI or test configuration, which could make failing work look green. The company must review those changes first.", [...ci, ...testScript].map((f) => f.filename));
  else g("ci_tamper", "Doesn't change how the tests run", "PASS", "No CI, test-runner or test-script changes.");

  const deletedTests = i.files.filter((f) => f.status === "removed" && isTestFile(f.filename));
  let removedCases: string[] = [];
  let addedCases: string[] = [];
  const skipped: string[] = [];
  for (const f of i.files) {
    if (!isTestFile(f.filename)) continue;
    const d = diffLines(f.patch);
    const rem = testNames(d.removed);
    const add = testNames(d.added);
    removedCases = removedCases.concat(rem.filter((n) => !add.includes(n)).map((n) => `${f.filename}: "${n}"`));
    addedCases = addedCases.concat(add.filter((n) => !rem.includes(n)).map((n) => `${f.filename}: "${n}"`));
    if (d.added.some((l) => SKIP.test(l))) skipped.push(f.filename);
  }
  if (deletedTests.length || removedCases.length) g("tests_removed", "Doesn't delete existing tests", "FAIL", `${deletedTests.length ? `Deletes test file${deletedTests.length > 1 ? "s" : ""}` : "Removes test cases"}: a classic way to turn red CI green.`, [...deletedTests.map((f) => f.filename), ...removedCases]);
  else g("tests_removed", "Doesn't delete existing tests", "PASS", "No existing test was removed.");
  if (skipped.length) g("tests_skipped", "Doesn't skip or focus tests", "FAIL", "Adds .skip / .only / xit-style markers that stop tests from running.", skipped);
  else g("tests_skipped", "Doesn't skip or focus tests", "PASS", "No skip or focus markers added.");
  if (i.requiresTests) {
    g("tests_added", "Adds tests for the new behaviour", addedCases.length ? "PASS" : "FAIL", addedCases.length ? `${addedCases.length} new test case${addedCases.length > 1 ? "s" : ""}.` : "The bounty requires tests, and none were added.", addedCases);
  }

  // 4. Hygiene
  const leaks: string[] = [];
  for (const f of i.files) for (const l of diffLines(f.patch).added) for (const [name, re] of SECRETS) if (re.test(l)) leaks.push(`${f.filename}: ${name}`);
  if (leaks.length) g("secrets", "No credentials in the code", "FAIL", "The diff adds something that looks like a credential.", [...new Set(leaks)]);
  else g("secrets", "No credentials in the code", "PASS", "No credential patterns in added lines.");
  const deps = i.files.filter((f) => MANIFEST.test(f.filename) && diffLines(f.patch).added.some((l) => /["']?[@\w./-]+["']?\s*[:=]\s*["']?[~^<>=]*\d/.test(l) || /^[\w.-]+[=<>~!]=/.test(l.trim())));
  if (deps.length) g("dependencies", "Dependency changes reviewed", "WARN", "Adds or changes dependencies: check them before merging (supply-chain risk).", deps.map((f) => f.filename));
  if (i.scopePaths.length) {
    const outside = i.files.filter((f) => !i.scopePaths.some((p) => f.filename.startsWith(p)) && !isTestFile(f.filename));
    g("scope", "Stays inside the task's paths", outside.length ? "WARN" : "PASS", outside.length ? `Touches files outside ${i.scopePaths.join(", ")}.` : `Only touches ${i.scopePaths.join(", ")} (and tests).`, outside.map((f) => f.filename));
  }
  const unread = i.files.filter((f) => f.patch === undefined && f.status !== "removed" && (f.additions + f.deletions) > 0);
  if (unread.length) g("diff_size", "Whole diff could be analysed", "WARN", "GitHub didn't return a diff for some files (too large or binary); they weren't checked line by line.", unread.map((f) => f.filename));
  return gates;
}

/** Added test cases across the PR, with their files: what criteria can be proven by. */
export function addedTests(files: PrFile[]): Array<{ file: string; name: string }> {
  const out: Array<{ file: string; name: string }> = [];
  for (const f of files) {
    if (!isTestFile(f.filename)) continue;
    const d = diffLines(f.patch);
    const removed = new Set(testNames(d.removed));
    for (const n of testNames(d.added)) if (!removed.has(n)) out.push({ file: f.filename, name: n });
  }
  return out;
}
