/**
 * The bounty loop against the PayPal and GitHub simulators:
 * publish → reserve (PayPal authorization) → claim → submit → verify → decide → capture → payout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTestEnv } from "./helpers";

const enabled = useTestEnv();
const d = enabled ? describe : describe.skip;

d("bounties end to end (simulated PayPal + GitHub)", async () => {
  const { getDb } = await import("../lib/db");
  const schema = await import("../lib/db/schema");
  const { eq, asc } = await import("drizzle-orm");
  const { resetDemo, DEMO_COMPANY_ID, DEMO_DEVELOPERS } = await import("../lib/services/seed");
  const B = await import("../lib/services/bounties");
  const { simApproveOrder, simExpireAuthorization } = await import("../lib/paypal/emulator-payments");
  const { resetSimMemory, withSimState } = await import("../lib/sim/store");
  const gh = await import("../lib/github/emulator");
  const { BOUNTY_CRITERIA, BOUNTY_ISSUE, BOUNTY_REPO } = await import("../lib/github/bounty-fixtures");
  const { verifyChain } = await import("../lib/ledger/chain");
  const CO = DEMO_COMPANY_ID;
  const { honest: CHIDI, cheat: QUICK } = DEMO_DEVELOPERS;

  const publish = (over: Partial<Parameters<typeof B.publishBounty>[1]> = {}) => B.publishBounty(CO, {
    repo: BOUNTY_REPO, issueNumber: BOUNTY_ISSUE, title: "Rate-limit the public order API", summary: "Stop one partner's loop from taking the API down.",
    details: "POST /api/orders needs a per-key limit.", criteria: BOUNTY_CRITERIA, skills: ["TypeScript", "Node"], amount: "300.00", deadlineDays: 7,
    ndaRequired: false, ndaText: null, requiresTests: true, requiredChecks: ["test"], scopePaths: [], ...over,
  });
  const fund = async (id: string) => {
    const { approveUrl } = await B.startFunding(CO, id);
    const orderId = approveUrl.split("/").pop()!;
    expect((await simApproveOrder(orderId)).ok).toBe(true); // the company approves on (simulated) PayPal
    return B.completeFunding(id, orderId);
  };
  const bounty = (id: string) => getDb().query.bounties.findFirst({ where: eq(schema.bounties.id, id) }).then((b) => b!);

  beforeEach(async () => {
    resetSimMemory();
    await resetDemo(getDb());
  });

  it("reserve → cheater rejected → honest developer verified → approved → captured, paid out, merged", async () => {
    const b0 = await publish();
    expect(b0.feeMinor).toBe(1500); // 5% on top
    await expect(B.claimBounty(CHIDI, b0.id)).rejects.toThrow(/isn't open/); // nothing reserved yet
    const open = await fund(b0.id);
    expect(open.status).toBe("OPEN");
    expect(open.authorizationId).toMatch(/^SIMAUTH/);

    // the cheater claims first; green CI, but the gates catch the tampering
    await B.claimBounty(QUICK, b0.id);
    await expect(B.claimBounty(CHIDI, b0.id)).rejects.toThrow(/Someone else is working/);
    const bad = await B.submitWork(QUICK, b0.id, 33, "all green");
    expect(bad.report!.recommendation).toBe("REJECT");
    expect(bad.report!.gates.filter((g) => g.status === "FAIL").map((g) => g.id).sort()).toEqual(["ci_tamper", "tests_added", "tests_removed", "tests_skipped"]); // a skipped test is not a test
    await expect(B.decide(CO, bad.id, "APPROVE", "")).rejects.toThrow(/Verification failed/); // can't pay it by accident
    await B.decide(CO, bad.id, "REJECT", "Tampered with CI and deleted tests.");
    expect((await bounty(b0.id)).status).toBe("OPEN");
    await expect(B.claimBounty(QUICK, b0.id)).rejects.toThrow(/failed integrity checks/);
    await expect(B.disputeRejection(QUICK, bad.id, "x".repeat(40))).rejects.toThrow(/can't be disputed/);

    // the honest developer
    await B.claimBounty(CHIDI, b0.id);
    const good = await B.submitWork(CHIDI, b0.id, 32, "");
    expect(good.report!.recommendation).toBe("APPROVE");
    expect(good.report!.criteria.results.map((r) => r.status)).toEqual(["PROVEN", "PROVEN", "PROVEN"]);
    const { bounty: paid } = await B.decide(CO, good.id, "APPROVE", "Thanks!");
    expect(paid.status).toBe("PAID");
    expect(paid.captureId).toMatch(/^SIMCAP/);
    expect(paid.payoutBatchId).toMatch(/^SIMBATCH/);
    expect(paid.paidTo).toBe(CHIDI);
    const pr = await withSimState(() => gh.simPullSnapshot(BOUNTY_REPO, 32));
    expect(pr!.merged).toBe(true);
    expect(pr!.comments.at(-1)!.body).toMatch(/Bounty paid via PayPal/);

    // re-running the release can't pay twice
    await B.releaseFunds(paid, { id: CHIDI, name: "Chidi Okafor", paypalEmail: "chidi@example.com", githubLogin: "chidi-dev" }, good);
    const payouts = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "bounty.payout_sent"));
    expect(payouts).toHaveLength(1);

    const trail = await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.subjectId, b0.id)).orderBy(asc(schema.auditLog.seq));
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["bounty.published", "bounty.funds_reserved", "submission.verified", "submission.rejected", "submission.approved", "bounty.captured", "bounty.payout_sent", "bounty.paid", "pr.merged"]));
    expect(verifyChain(CO, b0.id, trail.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) as never).ok).toBe(true);
  });

  it("withholds payout and merge while a capture is pending, then resumes on confirmed completion", async () => {
    const b0 = await publish();
    const open = await fund(b0.id);
    await B.claimBounty(CHIDI, b0.id);
    const submission = await B.submitWork(CHIDI, b0.id, 32, "");
    const { PayPalClient, setPayPalForTesting } = await import("../lib/paypal/client");
    const { emulatorFetch } = await import("../lib/paypal/emulator");
    const pendingResponse = new PayPalClient({
      clientId: "SIMULATED", clientSecret: "SIMULATED", env: "sandbox",
      fetchImpl: async (input, init) => {
        const response = await emulatorFetch(input, init);
        const url = new URL(input);
        if (init.method === "POST" && url.pathname === `/v2/payments/authorizations/${open.authorizationId}/capture`) {
          const body = await response.json() as Record<string, unknown>;
          return new Response(JSON.stringify({ ...body, status: "PENDING" }), { status: response.status, headers: { "content-type": "application/json" } });
        }
        return response;
      },
    });
    setPayPalForTesting(pendingResponse);
    try {
      await expect(B.decide(CO, submission.id, "APPROVE", "Thanks!")).rejects.toThrow(/PayPal capture is PENDING.*no payout or PR merge/i);
      const pending = await bounty(b0.id);
      expect(pending.status).toBe("PAYING");
      expect(pending.captureId).toBeTruthy();
      expect(pending.payoutBatchId).toBeNull();
      expect((await withSimState(() => gh.simPullSnapshot(BOUNTY_REPO, 32)))!.merged).toBe(false);

      const { deliverSimulatedEvents } = await import("../lib/services/webhooks");
      expect(await deliverSimulatedEvents()).toBeGreaterThan(0);
      const completed = await bounty(b0.id);
      expect(completed.status).toBe("PAID");
      expect(completed.payoutBatchId).toMatch(/^SIMBATCH/);
      expect((await withSimState(() => gh.simPullSnapshot(BOUNTY_REPO, 32)))!.merged).toBe(true);
    } finally {
      setPayPalForTesting(null);
    }
  });

  it("cancelling releases the reservation; the company is never charged", async () => {
    const b = await fund((await publish()).id);
    const c = await B.cancelBounty(CO, b.id, "Changed plans");
    expect(c.status).toBe("CANCELLED");
    const { getAuthorization } = await import("../lib/paypal/payments");
    const { getPayPal } = await import("../lib/paypal/client");
    expect((await getAuthorization(getPayPal(), b.authorizationId!)).status).toBe("VOIDED");
  });

  it("can't cancel while a developer is working, and can't approve a commit that changed after verification", async () => {
    const b = await fund((await publish()).id);
    await B.claimBounty(CHIDI, b.id);
    await expect(B.cancelBounty(CO, b.id, "nah")).rejects.toThrow(/A developer is working on this/);
    const s = await B.submitWork(CHIDI, b.id, 32, "");
    await withSimState(() => gh.simPushCommit(BOUNTY_REPO, 32, "one more thing"));
    await expect(B.decide(CO, s.id, "APPROVE", "")).rejects.toThrow(/changed after it was verified/);
  });

  it("rejecting a passing submission needs a real reason, and the developer can dispute (funds stay reserved)", async () => {
    const b = await fund((await publish()).id);
    await B.claimBounty(CHIDI, b.id);
    const s = await B.submitWork(CHIDI, b.id, 32, "");
    await expect(B.decide(CO, s.id, "REJECT", "no")).rejects.toThrow(/explain why/);
    await B.decide(CO, s.id, "REJECT", "We decided to build it ourselves after all, so we don't want this change now.");
    const disp = await B.disputeRejection(CHIDI, s.id, "Every criterion is proven by a passing test; the rejection gives no technical reason.");
    expect(disp.status).toBe("DISPUTED");
    expect((await bounty(b.id)).status).toBe("DISPUTED");
    expect((await B.companyStats(CO)).rejectedPassing).toBe(1);
  });

  it("a lapsed reservation can't be captured", async () => {
    const b = await fund((await publish()).id);
    await B.claimBounty(CHIDI, b.id);
    const s = await B.submitWork(CHIDI, b.id, 32, "");
    await simExpireAuthorization(b.authorizationId!);
    await expect(B.decide(CO, s.id, "APPROVE", "")).rejects.toThrow(/reservation lapsed/);
    expect((await bounty(b.id)).status).toBe("EXPIRED");
  });

  it("NDA bounties: details are signed for before claiming, against a hash of the exact text", async () => {
    const b = await fund((await publish({ ndaRequired: true, ndaText: "The developer will keep Lagos Roast's order API internals confidential for two years." })).id);
    await expect(B.claimBounty(CHIDI, b.id)).rejects.toThrow(/Sign the NDA/);
    await expect(B.signNda(CHIDI, b.id, "Someone Else", "test")).rejects.toThrow(/exactly as on your profile/);
    await B.signNda(CHIDI, b.id, "Chidi Okafor", "test");
    expect((await B.claimBounty(CHIDI, b.id)).status).toBe("CLAIMED");
  });

  it("an undeliverable payout is refunded to the company in full", async () => {
    await getDb().update(schema.developers).set({ paypalEmail: "nobody-unclaimed@example.com" }).where(eq(schema.developers.id, CHIDI));
    const b = await fund((await publish()).id);
    await B.claimBounty(CHIDI, b.id);
    const s = await B.submitWork(CHIDI, b.id, 32, "");
    const { bounty: after } = await B.decide(CO, s.id, "APPROVE", "");
    expect(after.status).toBe("PAYOUT_FAILED");
    const refunded = await B.refundFailedPayout(CO, b.id);
    expect(refunded.status).toBe("CANCELLED");
    expect(refunded.refundId).toBeTruthy();
  });
});
