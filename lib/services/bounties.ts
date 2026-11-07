/**
 * Bounty lifecycle.
 *
 *   DRAFT ─fund→ AWAITING_FUNDS ─PayPal approve + authorize→ OPEN ─claim→ CLAIMED ─submit→ IN_REVIEW
 *     IN_REVIEW ─approve→ PAYING ─capture + payout→ PAID          (PR merged at the verified commit)
 *     IN_REVIEW ─request changes→ CLAIMED      IN_REVIEW ─reject→ OPEN (developer may dispute → DISPUTED)
 *     OPEN/AWAITING_FUNDS/DRAFT ─cancel→ CANCELLED (authorization voided: the company is never charged)
 *
 * Money rules (all deterministic, never decided by a model):
 *  - funds are reserved (PayPal authorization) before anyone can claim; the authorization must match
 *    the bounty's amount + fee and carry the bounty id;
 *  - money is only captured after the company approves a specific verified commit;
 *  - capture, payout, void and refund carry idempotency keys derived from the bounty;
 *  - every transition is a conditional UPDATE on the current status, so two requests can't both win.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { bounties, companies, developers, ndaSignatures, submissions, type Bounty, type Submission } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { formatMoney, toMinor } from "../money";
import { appBaseUrl } from "../base-url";
import { getPayPal, PayPalApiError } from "../paypal/client";
import { authorizeOrder, captureAuthorization, createBountyOrder, getAuthorization, getPayout, payout, refundCapture, voidAuthorization } from "../paypal/payments";
import { getGitHub, GitHubApiError } from "../github/client";
import { verifySubmission, type VerificationReport } from "../verify/index";
import { audit } from "./audit";

export const MAX_BOUNTY_MINOR = 10_000_00; // demo ceiling: $10,000
export const FEE_RATE_BPS = 500; // 5% platform fee, paid by the company on top

export function feeFor(amountMinor: number): number {
  return Math.max(100, Math.ceil((amountMinor * FEE_RATE_BPS) / 10_000)); // at least $1.00
}

const trail = (b: Pick<Bounty, "companyId" | "id">, actor: Parameters<typeof audit>[1]["actor"], action: string, outcome: Parameters<typeof audit>[1]["outcome"], ref: string | null, detail: Record<string, unknown> = {}) =>
  audit(getDb(), { freelancerId: b.companyId, subjectId: b.id, actor, action, ref, outcome, detail });

async function load(id: string): Promise<Bounty> {
  const b = await getDb().query.bounties.findFirst({ where: eq(bounties.id, id) });
  if (!b) throw new UserFacingError("No such bounty.", 404);
  return b;
}

/** Move status from one of `from` to `to` atomically; returns the row or null if someone else moved it first. */
async function transition(id: string, from: Bounty["status"][], set: Partial<Bounty>): Promise<Bounty | null> {
  const [b] = await getDb().update(bounties).set({ ...set, updatedAt: new Date() }).where(and(eq(bounties.id, id), inArray(bounties.status, from))).returning();
  return b ?? null;
}

function ppError(e: unknown, what: string): never {
  if (e instanceof PayPalApiError) throw new UserFacingError(`PayPal refused to ${what}: ${e.message}${e.debugId ? ` (debug id ${e.debugId})` : ""}`, 502);
  throw e;
}

// ---------------------------------------------------------------------------
// Company: publish, fund, cancel
// ---------------------------------------------------------------------------

export type PublishInput = {
  repo: string; issueNumber: number | null; title: string; summary: string; details: string; criteria: string[]; skills: string[];
  amount: string; currency?: string; deadlineDays: number | null; ndaRequired: boolean; ndaText: string | null; requiresTests: boolean;
  requiredChecks: string[]; scopePaths: string[]; claimHours?: number;
};

export async function publishBounty(companyId: string, i: PublishInput): Promise<Bounty> {
  const currency = i.currency ?? "USD";
  let amountMinor: number;
  try { amountMinor = toMinor(i.amount, currency); } catch (e) { throw new UserFacingError((e as Error).message, 422); }
  if (amountMinor < 500) throw new UserFacingError("A bounty must be at least 5.00.", 422);
  if (amountMinor > MAX_BOUNTY_MINOR) throw new UserFacingError(`The demo caps bounties at ${formatMoney(MAX_BOUNTY_MINOR, currency)}.`, 422);
  const criteria = i.criteria.map((c) => c.trim()).filter(Boolean);
  if (criteria.length === 0 || criteria.length > 12) throw new UserFacingError("Give between 1 and 12 acceptance criteria: they are what the work is verified against.", 422);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(i.repo)) throw new UserFacingError("Repository must be owner/name.", 422);
  if (i.ndaRequired && (!i.ndaText || i.ndaText.trim().length < 40)) throw new UserFacingError("An NDA bounty needs the NDA text developers will sign.", 422);
  const [b] = await getDb().insert(bounties).values({
    id: newId("bty"), companyId, repo: i.repo, issueNumber: i.issueNumber, title: i.title.trim().slice(0, 140), summary: i.summary.trim().slice(0, 600), details: i.details.trim().slice(0, 8000),
    criteria, skills: i.skills.map((s) => s.trim()).filter(Boolean).slice(0, 8), currency, amountMinor, feeMinor: feeFor(amountMinor),
    deadline: i.deadlineDays ? new Date(Date.now() + i.deadlineDays * 86400_000) : null, ndaRequired: i.ndaRequired, ndaText: i.ndaRequired ? i.ndaText!.trim() : null,
    requiresTests: i.requiresTests, requiredChecks: i.requiredChecks, scopePaths: i.scopePaths, claimHours: i.claimHours ?? 72, status: "DRAFT",
  }).returning();
  await trail(b!, "company", "bounty.published", "OK", null, { title: b!.title, amount: formatMoney(b!.amountMinor, currency), fee: formatMoney(b!.feeMinor, currency), criteria: b!.criteria, nda: b!.ndaRequired });
  return b!;
}

/** Create the PayPal order (intent AUTHORIZE). The company approves it on PayPal. */
export async function startFunding(companyId: string, bountyId: string): Promise<{ approveUrl: string }> {
  const b = await load(bountyId);
  if (b.companyId !== companyId) throw new UserFacingError("Not your bounty.", 403);
  if (b.status !== "DRAFT" && b.status !== "AWAITING_FUNDS") throw new UserFacingError(`This bounty is already ${b.status.toLowerCase().replace("_", " ")}.`, 409);
  const attempt = b.fundingAttempt + 1;
  let r;
  try {
    r = await createBountyOrder(getPayPal(), {
      bountyId: b.id, attempt, title: b.title, currency: b.currency, bountyMinor: b.amountMinor, feeMinor: b.feeMinor,
      returnUrl: `${appBaseUrl()}/bounties/${b.id}/funded`, cancelUrl: `${appBaseUrl()}/bounties/${b.id}?funding=cancelled`,
    });
  } catch (e) { ppError(e, "create the order"); }
  await transition(b.id, ["DRAFT", "AWAITING_FUNDS"], { status: "AWAITING_FUNDS", paypalOrderId: r.orderId, fundingAttempt: attempt });
  await trail(b, "company", "bounty.funding_started", "PENDING", r.orderId, { total: formatMoney(b.amountMinor + b.feeMinor, b.currency) });
  return { approveUrl: r.approveUrl };
}

/** PayPal sent the company back: authorize the approved order and open the bounty if the reservation checks out. */
export async function completeFunding(bountyId: string, orderId: string): Promise<Bounty> {
  const b = await load(bountyId);
  if (b.status === "OPEN" && b.paypalOrderId === orderId) return b; // reload of the return page
  if (b.status !== "AWAITING_FUNDS" || b.paypalOrderId !== orderId) throw new UserFacingError("This PayPal approval doesn't match the bounty's current funding request.", 409);
  let auth;
  try { auth = await authorizeOrder(getPayPal(), orderId, b.id); } catch (e) { ppError(e, "authorize the payment"); }
  const expected = b.amountMinor + b.feeMinor;
  if (auth.status === "PENDING") {
    await trail(b, "paypal", "bounty.funding_under_review", "PENDING", auth.id, {});
    throw new UserFacingError("PayPal is still reviewing this payment (status PENDING). The bounty opens once PayPal confirms the authorization.", 409);
  }
  if (auth.status !== "CREATED" || auth.amountMinor !== expected || auth.currency !== b.currency || (auth.customId && auth.customId !== b.id)) {
    await trail(b, "paypal", "bounty.funding_mismatch", "REJECTED", auth.id, { status: auth.status, amount: auth.amountMinor, expected, customId: auth.customId });
    try { await voidAuthorization(getPayPal(), auth.id, b.id); } catch { /* best effort */ }
    throw new UserFacingError("PayPal's authorization didn't match this bounty, so it was voided and nothing was reserved.", 409);
  }
  const opened = await transition(b.id, ["AWAITING_FUNDS"], { status: "OPEN", authorizationId: auth.id, authorizationExpiresAt: auth.expiresAt ? new Date(auth.expiresAt) : null, fundedAt: new Date() });
  if (!opened) return load(b.id);
  await trail(opened, "paypal", "bounty.funds_reserved", "OK", auth.id, { amount: formatMoney(auth.amountMinor, auth.currency), expiresAt: auth.expiresAt });
  return opened;
}

export async function cancelBounty(companyId: string, bountyId: string, reason: string): Promise<Bounty> {
  const b = await load(bountyId);
  if (b.companyId !== companyId) throw new UserFacingError("Not your bounty.", 403);
  if (b.status === "CLAIMED" && b.claimExpiresAt && b.claimExpiresAt > new Date()) {
    throw new UserFacingError(`A developer is working on this until ${b.claimExpiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC. You can cancel after that if they haven't submitted.`, 409);
  }
  if (!["DRAFT", "AWAITING_FUNDS", "OPEN", "CLAIMED"].includes(b.status)) throw new UserFacingError(`A ${b.status.toLowerCase()} bounty can't be cancelled.`, 409);
  const done = await transition(b.id, ["DRAFT", "AWAITING_FUNDS", "OPEN", "CLAIMED"], { status: "CANCELLED", closedAt: new Date(), claimedBy: null, claimExpiresAt: null });
  if (!done) throw new UserFacingError("The bounty changed while cancelling; refresh and try again.", 409);
  if (b.authorizationId) {
    try { await voidAuthorization(getPayPal(), b.authorizationId, b.id); } catch (e) {
      await trail(b, "paypal", "bounty.void_failed", "FAILED", b.authorizationId, { error: String(e).slice(0, 200) });
      throw new UserFacingError("Cancelled, but PayPal didn't release the reservation yet; it will lapse on its own. This was logged.", 502);
    }
  }
  await trail(b, "company", "bounty.cancelled", "OK", b.authorizationId, { reason: reason.slice(0, 300), released: Boolean(b.authorizationId) });
  return done;
}

// ---------------------------------------------------------------------------
// Developer: NDA, claim, submit, dispute
// ---------------------------------------------------------------------------

export const ndaHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export async function signNda(developerId: string, bountyId: string, signedName: string, ip: string) {
  const b = await load(bountyId);
  if (!b.ndaRequired || !b.ndaText) throw new UserFacingError("This bounty has no NDA.", 409);
  const dev = (await getDb().query.developers.findFirst({ where: eq(developers.id, developerId) }))!;
  if (signedName.trim().toLowerCase() !== dev.name.toLowerCase()) throw new UserFacingError(`Type your full name exactly as on your profile (${dev.name}) to sign.`, 422);
  await getDb().insert(ndaSignatures).values({ id: newId("nda"), bountyId, developerId, ndaSha256: ndaHash(b.ndaText), signedName: signedName.trim(), ip: ip.slice(0, 64) }).onConflictDoNothing();
  await trail(b, "developer", "nda.signed", "OK", developerId, { developer: dev.name, ndaSha256: ndaHash(b.ndaText) });
}

export async function hasSignedNda(developerId: string, b: Bounty): Promise<boolean> {
  if (!b.ndaRequired || !b.ndaText) return true;
  const s = await getDb().query.ndaSignatures.findFirst({ where: and(eq(ndaSignatures.bountyId, b.id), eq(ndaSignatures.developerId, developerId)) });
  return Boolean(s && s.ndaSha256 === ndaHash(b.ndaText));
}

export async function claimBounty(developerId: string, bountyId: string): Promise<Bounty> {
  const b = await load(bountyId);
  const dev = await getDb().query.developers.findFirst({ where: eq(developers.id, developerId) });
  if (!dev) throw new UserFacingError("Create your developer profile first.", 403);
  const company = (await getDb().query.companies.findFirst({ where: eq(companies.id, b.companyId) }))!;
  if (dev.paypalEmail.toLowerCase() === company.email.toLowerCase()) throw new UserFacingError("The payout account is the company's own; a company can't pay a bounty to itself.", 403);
  if (!(await hasSignedNda(developerId, b))) throw new UserFacingError("Sign the NDA before claiming this bounty.", 412);
  const banned = await getDb().query.submissions.findFirst({ where: and(eq(submissions.bountyId, b.id), eq(submissions.developerId, developerId), eq(submissions.status, "REJECTED")) });
  if (banned?.report?.recommendation === "REJECT") throw new UserFacingError("Your earlier submission for this bounty failed integrity checks, so you can't claim it again.", 403);
  if (b.deadline && b.deadline < new Date()) throw new UserFacingError("This bounty's deadline has passed.", 409);
  const now = new Date();
  const expires = new Date(now.getTime() + b.claimHours * 3600_000);
  const [claimed] = await getDb().update(bounties).set({ status: "CLAIMED", claimedBy: developerId, claimedAt: now, claimExpiresAt: expires, updatedAt: now })
    .where(and(eq(bounties.id, b.id), or(eq(bounties.status, "OPEN"), and(eq(bounties.status, "CLAIMED"), lt(bounties.claimExpiresAt, now))))).returning();
  if (!claimed) throw new UserFacingError(b.status === "CLAIMED" ? "Someone else is working on this bounty right now." : `This bounty isn't open (it's ${b.status.toLowerCase().replace("_", " ")}).`, 409);
  await trail(claimed, "developer", "bounty.claimed", "OK", dev.githubLogin, { developer: dev.name, until: expires.toISOString() });
  return claimed;
}

async function gatherEvidence(repo: string, prNumber: number) {
  const gh = getGitHub();
  try {
    const pr = await gh.getPull(repo, prNumber);
    const [commits, files, checkRuns] = await Promise.all([gh.listPullCommits(repo, prNumber), gh.listPullFiles(repo, prNumber), gh.listCheckRuns(repo, pr.headSha)]);
    return { pr, commits, files, checkRuns };
  } catch (e) {
    if (e instanceof GitHubApiError) throw new UserFacingError(`Couldn't read ${repo}#${prNumber} on GitHub: ${e.status === 404 ? "not found" : e.message}`, e.status === 404 ? 404 : 502);
    throw e;
  }
}

async function runVerification(b: Bounty, devLogin: string, prNumber: number): Promise<{ report: VerificationReport; prUrl: string }> {
  const ev = await gatherEvidence(b.repo, prNumber);
  const report = await verifySubmission({
    title: b.title, description: b.details, criteria: b.criteria, issueNumber: b.issueNumber, developerLogin: devLogin,
    requiredChecks: b.requiredChecks, requiresTests: b.requiresTests, scopePaths: b.scopePaths, ...ev,
  });
  return { report, prUrl: ev.pr.url };
}

export async function submitWork(developerId: string, bountyId: string, prNumber: number, note: string): Promise<Submission> {
  const b = await load(bountyId);
  if (b.status !== "CLAIMED" || b.claimedBy !== developerId) throw new UserFacingError("Claim the bounty before submitting.", 409);
  const dev = (await getDb().query.developers.findFirst({ where: eq(developers.id, developerId) }))!;
  const { report, prUrl } = await runVerification(b, dev.githubLogin, prNumber);
  const moved = await transition(b.id, ["CLAIMED"], { status: "IN_REVIEW" });
  if (!moved) throw new UserFacingError("The bounty changed while verifying; refresh and try again.", 409);
  const [s] = await getDb().insert(submissions).values({
    id: newId("sub"), bountyId: b.id, developerId, prNumber, prUrl, headSha: report.commit, status: report.gates.find((g) => g.id === "ci")?.status === "UNKNOWN" ? "VERIFYING" : "VERIFIED",
    report, developerNote: note.trim().slice(0, 1000) || null,
  }).returning();
  await trail(b, "ai", "submission.verified", report.recommendation === "APPROVE" ? "OK" : report.recommendation === "REJECT" ? "REJECTED" : "INFO", `${b.repo}#${prNumber}@${report.commit.slice(0, 7)}`, {
    developer: dev.name, recommendation: report.recommendation, reasons: report.reasons,
    gates: Object.fromEntries(report.gates.map((g) => [g.id, g.status])), criteria: report.criteria.results.map((r) => r.status), judge: report.criteria.source,
  });
  return s!;
}

/** Run verification again on the same PR (e.g. CI finished, or the developer pushed fixes after a change request). */
export async function reverify(actor: { companyId?: string; developerId?: string }, submissionId: string): Promise<Submission> {
  const s = await getDb().query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!s) throw new UserFacingError("No such submission.", 404);
  const b = await load(s.bountyId);
  if (actor.companyId !== b.companyId && actor.developerId !== s.developerId) throw new UserFacingError("Not yours.", 403);
  if (!["VERIFYING", "VERIFIED"].includes(s.status)) throw new UserFacingError(`This submission is ${s.status.toLowerCase()}.`, 409);
  const dev = (await getDb().query.developers.findFirst({ where: eq(developers.id, s.developerId) }))!;
  const { report } = await runVerification(b, dev.githubLogin, s.prNumber);
  const [u] = await getDb().update(submissions).set({ report, headSha: report.commit, status: report.gates.find((g) => g.id === "ci")?.status === "UNKNOWN" ? "VERIFYING" : "VERIFIED" }).where(eq(submissions.id, s.id)).returning();
  await trail(b, "ai", "submission.reverified", "INFO", `${b.repo}#${s.prNumber}@${report.commit.slice(0, 7)}`, { recommendation: report.recommendation });
  return u!;
}

// ---------------------------------------------------------------------------
// Company decision → money
// ---------------------------------------------------------------------------

export type Decision = "APPROVE" | "REQUEST_CHANGES" | "REJECT";

export async function decide(companyId: string, submissionId: string, decision: Decision, note: string, opts: { overrideFailedChecks?: boolean } = {}): Promise<{ bounty: Bounty; submission: Submission }> {
  const db = getDb();
  const s = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!s) throw new UserFacingError("No such submission.", 404);
  const b = await load(s.bountyId);
  if (b.companyId !== companyId) throw new UserFacingError("Not your bounty.", 403);
  if (b.status !== "IN_REVIEW" || !["VERIFIED", "VERIFYING"].includes(s.status)) throw new UserFacingError(`Nothing to decide: the bounty is ${b.status.toLowerCase().replace("_", " ")} and the submission is ${s.status.toLowerCase()}.`, 409);
  const report = s.report!;
  const dev = (await db.query.developers.findFirst({ where: eq(developers.id, s.developerId) }))!;

  if (decision === "REQUEST_CHANGES") {
    if (note.trim().length < 10) throw new UserFacingError("Say what needs to change (at least a sentence).", 422);
    const back = await transition(b.id, ["IN_REVIEW"], { status: "CLAIMED", claimExpiresAt: new Date(Date.now() + b.claimHours * 3600_000) });
    const [u] = await db.update(submissions).set({ status: "CHANGES_REQUESTED", companyNote: note.trim().slice(0, 2000), decidedAt: new Date() }).where(eq(submissions.id, s.id)).returning();
    await trail(b, "company", "submission.changes_requested", "INFO", s.id, { note: note.trim().slice(0, 500) });
    return { bounty: back!, submission: u! };
  }
  if (decision === "REJECT") {
    if (report.recommendation === "APPROVE" && note.trim().length < 40) throw new UserFacingError("Verification recommended paying this submission. To reject it anyway, explain why in at least a few sentences: the developer sees it and can dispute.", 422);
    const reopened = await transition(b.id, ["IN_REVIEW"], { status: "OPEN", claimedBy: null, claimedAt: null, claimExpiresAt: null });
    const [u] = await db.update(submissions).set({ status: "REJECTED", companyNote: note.trim().slice(0, 2000), decidedAt: new Date() }).where(eq(submissions.id, s.id)).returning();
    await trail(b, "company", "submission.rejected", report.recommendation === "APPROVE" ? "INFO" : "OK", s.id, { against: report.recommendation, note: note.trim().slice(0, 500) });
    return { bounty: reopened!, submission: u! };
  }

  // APPROVE → pay
  const failed = report.gates.filter((g) => g.status === "FAIL");
  if (failed.length && !opts.overrideFailedChecks) throw new UserFacingError(`Verification failed (${failed.map((g) => g.label).join("; ")}). Request changes, or approve with an explicit override.`, 412);
  const pr = await getGitHub().getPull(b.repo, s.prNumber).catch(() => null);
  if (!pr || pr.headSha !== s.headSha) throw new UserFacingError(`The pull request changed after it was verified (verified ${s.headSha.slice(0, 7)}, now ${pr?.headSha.slice(0, 7) ?? "unknown"}). Re-run verification first.`, 409);
  const paying = await transition(b.id, ["IN_REVIEW"], { status: "PAYING", paidTo: dev.id });
  if (!paying) throw new UserFacingError("Someone else is already deciding this bounty.", 409);
  const [approved] = await db.update(submissions).set({ status: "APPROVED", companyNote: note.trim().slice(0, 2000) || null, decidedAt: new Date() }).where(eq(submissions.id, s.id)).returning();
  await trail(b, "company", "submission.approved", "OK", s.id, { commit: s.headSha, override: failed.length ? failed.map((g) => g.id) : undefined, recommendation: report.recommendation });
  const after = await releaseFunds(paying, dev, approved!);
  return { bounty: after, submission: approved! };
}

/** Capture the reservation, pay the developer, merge the approved commit. Safe to re-run. */
export async function releaseFunds(b: Bounty, dev: { id: string; name: string; paypalEmail: string; githubLogin: string }, s: Submission): Promise<Bounty> {
  const db = getDb();
  const pp = getPayPal();
  let captureId = b.captureId;
  if (!captureId) {
    const auth = await getAuthorization(pp, b.authorizationId!).catch((e) => ppError(e, "read the reservation"));
    // PayPal reports an expired authorization as VOIDED (and fires PAYMENT.AUTHORIZATION.VOIDED)
    if (auth.status === "EXPIRED" || auth.status === "VOIDED" || auth.status === "DENIED") {
      await transition(b.id, ["PAYING"], { status: "EXPIRED" });
      await trail(b, "paypal", "bounty.reservation_lapsed", "FAILED", auth.id, { status: auth.status });
      throw new UserFacingError("PayPal's reservation lapsed before approval, so nothing could be captured. The company must fund the bounty again.", 409);
    }
    const cap = await captureAuthorization(pp, b.authorizationId!, b.id, `Bounty "${b.title}" approved`).catch((e) => ppError(e, "capture the reserved funds"));
    captureId = cap.id;
    await db.update(bounties).set({ captureId, updatedAt: new Date() }).where(eq(bounties.id, b.id));
    await trail(b, "paypal", "bounty.captured", cap.status === "COMPLETED" ? "OK" : "PENDING", cap.id, { amount: formatMoney(cap.amountMinor, cap.currency), paypalFee: cap.feeMinor === null ? null : formatMoney(cap.feeMinor, cap.currency), status: cap.status });
  }
  let batchId = b.payoutBatchId;
  if (!batchId) {
    const po = await payout(pp, { bountyId: b.id, receiverEmail: dev.paypalEmail, amountMinor: b.amountMinor, currency: b.currency, note: `Payment for "${b.title}" (${b.repo}#${s.prNumber}), verified at commit ${s.headSha.slice(0, 7)}.` })
      .catch((e) => ppError(e, "pay the developer"));
    batchId = po.batchId;
    await db.update(bounties).set({ payoutBatchId: po.batchId, payoutItemId: po.itemId, payoutStatus: po.itemStatus ?? po.batchStatus, updatedAt: new Date() }).where(eq(bounties.id, b.id));
    await trail(b, "paypal", "bounty.payout_sent", "PENDING", po.batchId, { to: dev.paypalEmail, amount: formatMoney(b.amountMinor, b.currency), status: po.itemStatus ?? po.batchStatus });
  }
  const after = await syncPayout(b.id);
  // merge exactly the approved commit (best effort: the company approved the code; payment never depends on the merge)
  try {
    const m = await getGitHub().mergePull(b.repo, s.prNumber, s.headSha, "squash", `${b.title} (#${s.prNumber}) — bounty paid via PayPal`);
    await trail(b, "github", "pr.merged", "OK", m.sha, { commit: s.headSha });
  } catch (e) {
    await trail(b, "github", "pr.merge_skipped", "INFO", null, { reason: e instanceof GitHubApiError ? e.message : String(e).slice(0, 200) });
  }
  try { await getGitHub().comment(b.repo, s.prNumber, `✅ **Bounty paid via PayPal**: ${formatMoney(b.amountMinor, b.currency)} to @${dev.githubLogin}, for commit \`${s.headSha.slice(0, 7)}\` after verification and the company's approval.\n\n<sub>MergePay · ${b.id}</sub>`); } catch { /* not essential */ }
  return after;
}

/** Ask PayPal where the payout is; settle the bounty's state from the answer. */
export async function syncPayout(bountyId: string): Promise<Bounty> {
  const b = await load(bountyId);
  if (!b.payoutBatchId) return b;
  const po = await getPayout(getPayPal(), b.payoutBatchId).catch(() => null);
  if (!po) return b;
  const st = po.itemStatus ?? po.batchStatus;
  if (st === "SUCCESS") {
    const paid = await transition(b.id, ["PAYING", "PAYOUT_FAILED"], { status: "PAID", payoutStatus: st, payoutItemId: po.itemId, paidAt: new Date(), closedAt: new Date() });
    if (paid) await trail(paid, "paypal", "bounty.paid", "OK", po.itemId, { to: po.receiver, amount: formatMoney(b.amountMinor, b.currency) });
    return paid ?? load(b.id);
  }
  if (["UNCLAIMED", "FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED"].includes(st)) {
    const f = await transition(b.id, ["PAYING"], { status: "PAYOUT_FAILED", payoutStatus: st, payoutItemId: po.itemId });
    if (f) await trail(f, "paypal", "bounty.payout_failed", "FAILED", po.itemId, { status: st, error: po.error, note: st === "UNCLAIMED" ? "No PayPal account for that email yet; PayPal holds it for 30 days." : null });
    return f ?? load(b.id);
  }
  await db().update(bounties).set({ payoutStatus: st, updatedAt: new Date() }).where(eq(bounties.id, b.id));
  return load(b.id);
}
const db = () => getDb();

/** A payout that can't be delivered is refunded to the company in full (bounty + fee). */
export async function refundFailedPayout(companyId: string, bountyId: string): Promise<Bounty> {
  const b = await load(bountyId);
  if (b.companyId !== companyId) throw new UserFacingError("Not your bounty.", 403);
  if (b.status !== "PAYOUT_FAILED" || !b.captureId) throw new UserFacingError("Only a bounty whose payout failed can be refunded.", 409);
  const r = await refundCapture(getPayPal(), b.captureId, b.id, `Refund: payout for "${b.title}" could not be delivered`).catch((e) => ppError(e, "refund"));
  const done = await transition(b.id, ["PAYOUT_FAILED"], { status: "CANCELLED", refundId: r.id, closedAt: new Date() });
  await trail(b, "paypal", "bounty.refunded", "OK", r.id, { status: r.status });
  return done ?? load(b.id);
}

export async function disputeRejection(developerId: string, submissionId: string, reason: string): Promise<Submission> {
  const s = await getDb().query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!s || s.developerId !== developerId) throw new UserFacingError("No such submission.", 404);
  if (s.status !== "REJECTED") throw new UserFacingError("Only a rejected submission can be disputed.", 409);
  if (s.report?.recommendation === "REJECT") throw new UserFacingError("This submission failed integrity checks; it can't be disputed.", 409);
  if (!s.decidedAt || Date.now() - s.decidedAt.getTime() > 7 * 86400_000) throw new UserFacingError("Disputes must be raised within 7 days of the rejection.", 409);
  if (reason.trim().length < 30) throw new UserFacingError("Explain why the rejection is wrong (a few sentences).", 422);
  const b = await load(s.bountyId);
  // freeze the bounty: nobody else can claim it, and the reservation stays in place while it's reviewed
  await transition(b.id, ["OPEN", "CLAIMED"], { status: "DISPUTED" });
  const [u] = await getDb().update(submissions).set({ status: "DISPUTED", developerNote: reason.trim().slice(0, 2000) }).where(eq(submissions.id, s.id)).returning();
  await trail(b, "developer", "submission.disputed", "PENDING", s.id, { reason: reason.trim().slice(0, 500), recommendation: s.report?.recommendation });
  return u!;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listOpenBounties() {
  return getDb().select({ b: bounties, company: companies }).from(bounties).innerJoin(companies, eq(companies.id, bounties.companyId))
    .where(inArray(bounties.status, ["OPEN", "CLAIMED", "IN_REVIEW", "PAYING", "PAID", "DISPUTED"])).orderBy(desc(bounties.fundedAt)).limit(100);
}

export async function companyStats(companyId: string) {
  const rows = await getDb().select({ status: submissions.status, rec: sql<string>`${submissions.report}->>'recommendation'` }).from(submissions)
    .innerJoin(bounties, eq(bounties.id, submissions.bountyId)).where(eq(bounties.companyId, companyId));
  const decided = rows.filter((r) => ["APPROVED", "REJECTED", "DISPUTED"].includes(r.status));
  // a rejection the verification disagreed with stays on the company's record, disputed or not
  const rejectedPassing = rows.filter((r) => (r.status === "REJECTED" || r.status === "DISPUTED") && r.rec === "APPROVE").length;
  const paid = await getDb().select({ n: sql<number>`count(*)::int` }).from(bounties).where(and(eq(bounties.companyId, companyId), eq(bounties.status, "PAID")));
  return { decided: decided.length, rejectedPassing, paid: paid[0]?.n ?? 0 };
}
