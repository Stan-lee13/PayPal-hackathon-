import { z } from "zod";
import { errorResponse, json, sameOrigin } from "@/lib/http";
import { githubMode } from "@/lib/github/client";
import { demoRepo } from "@/lib/services/seed";

export const dynamic = "force-dynamic";

/** Simulated GitHub only: push one more commit after invoicing, to show that payment then doesn't merge it. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Cross-origin request refused." }, 403);
    if (githubMode() !== "simulated") return json({ error: "Only in the simulated repo. On real GitHub, push a commit to the PR branch yourself." }, 409);
    const { pr } = z.object({ pr: z.number().int().min(1) }).parse(await req.json());
    const { simPushCommit } = await import("@/lib/github/emulator");
    const { withSimState } = await import("@/lib/sim/store");
    const sha = await withSimState(() => simPushCommit(demoRepo(), pr));
    return json({ ok: true, headSha: sha });
  } catch (e) { return errorResponse(e); }
}
