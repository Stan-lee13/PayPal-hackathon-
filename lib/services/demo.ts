/**
 * Demo helpers: a fresh pull request (and the issues it closes, with agreed prices) so the whole
 * flow can be replayed by anyone, and simulated payer / "late commit" actions.
 *
 * In simulated GitHub mode this uses the built-in simulator. In live mode it creates real issues, a
 * branch, a commit and a PR in the demo repository through the GitHub API (lib/github/demo-pr.ts).
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { contracts } from "../db/schema";
import { githubMode } from "../github/client";
import { DEMO_CONTRACT_ID } from "./seed";
import { audit } from "./audit";
import { DEMO_FREELANCER_ID } from "../security/session";

export async function createDemoPullRequest(): Promise<{ repo: string; pr: number; issues: number[] }> {
  const db = getDb();
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, DEMO_CONTRACT_ID) });
  if (!contract) throw new Error("Demo contract missing; run the seed.");
  let made: { pr: number; issues: number[] };
  if (githubMode() === "simulated") {
    const { simCreateDemoPullRequest } = await import("../github/emulator");
    const { withSimState } = await import("../sim/store");
    const r = await withSimState(() => simCreateDemoPullRequest(contract.repo));
    made = { pr: r.pr, issues: [...r.issues] };
  } else {
    const { createLiveDemoPullRequest } = await import("../github/demo-pr");
    made = await createLiveDemoPullRequest(contract.repo);
  }
  // the new issues get the same agreed prices as the originals (#12 checkout, #14 menu)
  const [checkout, nav] = made.issues;
  await db.update(contracts).set({
    issuePrices: sql`${contracts.issuePrices} || ${JSON.stringify({ [String(checkout)]: contract.issuePrices["12"] ?? 45000, [String(nav)]: contract.issuePrices["14"] ?? 8000 })}::jsonb`,
  }).where(eq(contracts.id, contract.id));
  await audit(db, { freelancerId: DEMO_FREELANCER_ID, actor: "system", action: "demo.pull_request_created", ref: `${contract.repo}#${made.pr}`, outcome: "INFO", detail: { issues: made.issues, githubMode: githubMode() } });
  return { repo: contract.repo, ...made };
}
