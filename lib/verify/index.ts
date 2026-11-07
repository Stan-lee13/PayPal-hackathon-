/**
 * Verification report for a bounty submission = deterministic gates + criteria → evidence, and a
 * recommendation derived ONLY by the rules below. The company always makes the final call; the
 * report never moves money by itself.
 */
import type { CheckRun, Gate } from "./gates";
import { runGates } from "./gates";
import { judgeCriteria, type CriteriaReport } from "./criteria";
import type { PrCommit, PrFile, PullRequest } from "../github/client";

export type Recommendation = "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "NEEDS_REVIEW";

export type VerificationReport = {
  version: 1;
  commit: string;
  checkedAt: string;
  gates: Gate[];
  criteria: CriteriaReport;
  recommendation: Recommendation;
  reasons: string[];
};

/** Gates whose failure suggests gaming the verification, not just unfinished work. */
const INTEGRITY = new Set(["ci_tamper", "tests_removed", "tests_skipped", "secrets", "author"]);

export function recommend(gates: Gate[], criteria: CriteriaReport): { recommendation: Recommendation; reasons: string[] } {
  const failed = gates.filter((g) => g.status === "FAIL");
  const integrity = failed.filter((g) => INTEGRITY.has(g.id));
  if (integrity.length) return { recommendation: "REJECT", reasons: integrity.map((g) => `${g.label}: ${g.detail}`) };
  if (failed.length) return { recommendation: "REQUEST_CHANGES", reasons: failed.map((g) => `${g.label}: ${g.detail}`) };
  const notMet = criteria.results.filter((r) => r.status === "NOT_MET");
  if (notMet.length) return { recommendation: "REQUEST_CHANGES", reasons: notMet.map((r) => `Not met: ${r.criterion}`) };
  const ci = gates.find((g) => g.id === "ci");
  if (ci?.status !== "PASS") return { recommendation: "NEEDS_REVIEW", reasons: [`CI: ${ci?.detail ?? "unknown"}`] };
  const open = criteria.results.filter((r) => r.status !== "PROVEN");
  if (open.length) return { recommendation: "NEEDS_REVIEW", reasons: open.map((r) => `${r.status === "LIKELY" ? "Probably met, not proven by a test" : "Unclear"}: ${r.criterion}`) };
  return { recommendation: "APPROVE", reasons: ["Every gate passed and every acceptance criterion is covered by a new test that passed in CI on this commit."] };
}

export async function verifySubmission(args: {
  title: string; description: string; criteria: string[]; issueNumber: number | null; developerLogin: string;
  requiredChecks: string[]; requiresTests: boolean; scopePaths: string[];
  pr: PullRequest; commits: PrCommit[]; files: PrFile[]; checkRuns: CheckRun[];
}): Promise<VerificationReport> {
  const gates = runGates({ pr: args.pr, files: args.files, checkRuns: args.checkRuns, issueNumber: args.issueNumber, developerLogin: args.developerLogin, requiredChecks: args.requiredChecks, requiresTests: args.requiresTests, scopePaths: args.scopePaths });
  const ciPassed = gates.find((g) => g.id === "ci")?.status === "PASS";
  const criteria = await judgeCriteria({ title: args.title, description: args.description, criteria: args.criteria, pr: args.pr, commits: args.commits, files: args.files, ciPassed });
  const { recommendation, reasons } = recommend(gates, criteria);
  return { version: 1, commit: args.pr.headSha, checkedAt: new Date().toISOString(), gates, criteria, recommendation, reasons };
}
