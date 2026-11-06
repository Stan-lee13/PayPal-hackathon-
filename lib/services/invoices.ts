/**
 * The invoice lifecycle:  draft → send (PayPal) → paid (PayPal says so) → merged (GitHub).
 *
 * Guarantees:
 *  - amounts come only from the contract (lib/agent/pricing.ts);
 *  - nothing is sent without an explicit confirmation, and never before the client has accepted
 *    the merge-on-payment terms;
 *  - "paid" is decided by GETting the invoice from PayPal (status PAID, nothing due, not marked paid
 *    by hand) — never by a webhook body;
 *  - the merge uses the exact commit that was invoiced; if the PR moved, nothing merges;
 *  - every step is appended to the invoice's hash-chained audit trail.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { clients, contracts, freelancers, invoices, type Contract, type Invoice } from "../db/schema";
import { UserFacingError } from "../errors";
import { newId } from "../ids";
import { formatMoney } from "../money";
import { getGitHub, GitHubApiError, linkedIssueNumbers, type Issue } from "../github/client";
import { getPayPal, PayPalApiError } from "../paypal/client";
import { cancelInvoice as ppCancel, createDraftInvoice, getInvoice, nextInvoiceNumber, remindInvoice as ppRemind, sendInvoice as ppSend, type InvoiceFacts } from "../paypal/invoicing";
import { priceInvoice, PricingError, type Extra } from "../agent/pricing";
import { describeInvoice } from "../agent/describe";
import { audit } from "./audit";

export type DraftArgs = { freelancerId: string; repo: string; pr: number; hours?: string; extras?: Extra[] };

const short = (sha: string) => sha.slice(0, 7);

async function contractFor(freelancerId: string, repo: string): Promise<Contract> {
  const c = await getDb().query.contracts.findFirst({ where: and(eq(contracts.freelancerId, freelancerId), sql`lower(${contracts.repo}) = lower(${repo})`, eq(contracts.status, "ACTIVE")) });
  if (!c) throw new UserFacingError(`There's no active contract for ${repo}. Create one in the MergePay dashboard first, so the client has agreed prices.`, 404);
  return c;
}

async function loadOwned(freelancerId: string, invoiceId: string): Promise<Invoice> {
  const inv = await getDb().query.invoices.findFirst({ where: and(eq(invoices.id, invoiceId), eq(invoices.freelancerId, freelancerId)) });
  if (!inv) throw new UserFacingError(`No invoice ${invoiceId}.`, 404);
  return inv;
}

function wrapGitHub(e: unknown, what: string): never {
  if (e instanceof GitHubApiError) throw new UserFacingError(`${what}: GitHub said ${e.status === 404 ? "not found (check the repository and PR number, and that the token can see it)" : e.message}`, e.status === 404 ? 404 : 502);
  throw e;
}

/** Read the PR, price it from the contract, describe it, and save (or refresh) a local draft. Nothing is sent. */
export async function draftInvoice(a: DraftArgs): Promise<Invoice> {
  const db = getDb();
  const contract = await contractFor(a.freelancerId, a.repo);
  const gh = getGitHub();
  const pr = await gh.getPull(contract.repo, a.pr).catch((e) => wrapGitHub(e, `Couldn't read PR #${a.pr}`));
  if (pr.merged) throw new UserFacingError(`PR #${a.pr} is already merged; MergePay bills work before it merges.`, 409);
  if (pr.state !== "open") throw new UserFacingError(`PR #${a.pr} is closed.`, 409);
  if (pr.draft) throw new UserFacingError(`PR #${a.pr} is still a draft. Mark it ready for review first.`, 409);

  const existing = await db.query.invoices.findFirst({ where: and(eq(invoices.repo, contract.repo), eq(invoices.prNumber, a.pr), ne(invoices.status, "CANCELLED")) });
  if (existing && existing.status !== "DRAFT") {
    throw new UserFacingError(`PR #${a.pr} already has invoice ${existing.paypalInvoiceNumber ?? existing.id} (${existing.status}). Cancel it first to bill again.`, 409);
  }

  const [commits, files] = await Promise.all([
    gh.listPullCommits(contract.repo, a.pr).catch((e) => wrapGitHub(e, "Couldn't read the commits")),
    gh.listPullFiles(contract.repo, a.pr).catch((e) => wrapGitHub(e, "Couldn't read the changed files")),
  ]);
  const issues: Issue[] = [];
  for (const n of linkedIssueNumbers(pr.body)) {
    try {
      const i = await gh.getIssue(contract.repo, n);
      if (!i.isPullRequest) issues.push(i);
    } catch { /* an issue we can't read simply isn't billed; pricing warns */ }
  }

  // issues already billed on another live invoice of this contract
  const others = await db.select({ number: invoices.paypalInvoiceNumber, id: invoices.id, items: invoices.lineItems, pr: invoices.prNumber })
    .from(invoices).where(and(eq(invoices.contractId, contract.id), ne(invoices.status, "CANCELLED")));
  const alreadyBilled: Record<string, string> = {};
  for (const o of others) {
    if (o.pr === a.pr) continue;
    for (const it of o.items) if (it.kind === "ISSUE" && it.ref) alreadyBilled[it.ref] = o.number ?? o.id;
  }

  let priced;
  try {
    priced = priceInvoice({ contract, issues: issues.map((i) => ({ number: i.number, title: i.title })), alreadyBilled, hours: a.hours, extras: a.extras });
  } catch (e) {
    if (e instanceof PricingError) throw new UserFacingError(e.message, 422);
    throw e;
  }
  const described = await describeInvoice({ repo: contract.repo, pr, commits, files, issues, items: priced.items });
  const previewUrl = await gh.previewUrlFor(contract.repo, pr.headSha).catch(() => null);
  const scope = { ...described.scope, warnings: [...priced.warnings, ...described.scope.warnings] };
  const values = {
    contractId: contract.id, freelancerId: a.freelancerId, repo: contract.repo, prNumber: pr.number, prTitle: pr.title, prUrl: pr.url,
    headSha: pr.headSha, status: "DRAFT" as const, currency: contract.currency, amountMinor: priced.totalMinor,
    lineItems: described.items, scope, note: described.note, previewUrl, updatedAt: new Date(),
  };
  let inv: Invoice;
  if (existing) {
    [inv] = await db.update(invoices).set(values).where(and(eq(invoices.id, existing.id), eq(invoices.status, "DRAFT"))).returning() as [Invoice];
    if (!inv) throw new UserFacingError("That draft changed while it was being refreshed. Try again.", 409);
  } else {
    [inv] = await db.insert(invoices).values({ id: newId("inv"), ...values }).returning() as [Invoice];
  }
  await audit(db, {
    freelancerId: a.freelancerId, invoiceId: inv.id, actor: "ai", action: existing ? "invoice.redrafted" : "invoice.drafted", ref: `${contract.repo}#${pr.number}@${short(pr.headSha)}`, outcome: "OK",
    detail: { amount: formatMoney(inv.amountMinor, inv.currency), items: inv.lineItems.map((i) => ({ name: i.name, total: i.totalMinor })), scopeSource: scope.source, outOfScope: scope.outOfScope.length, warnings: scope.warnings, aiNote: described.aiNote },
  });
  return inv;
}

/** Create the PayPal invoice and email it to the client. Requires confirm=true and accepted terms. */
export async function sendInvoice(a: { freelancerId: string; invoiceId: string; confirm: boolean }): Promise<Invoice> {
  const db = getDb();
  const inv = await loadOwned(a.freelancerId, a.invoiceId);
  if (inv.status !== "DRAFT") throw new UserFacingError(`Invoice is already ${inv.status}.`, 409);
  if (a.confirm !== true) throw new UserFacingError("Not sent. Show the draft to the developer and only send once they say so (confirm: true).", 412);
  const contract = (await db.query.contracts.findFirst({ where: eq(contracts.id, inv.contractId) }))!;
  const client = (await db.query.clients.findFirst({ where: eq(clients.id, contract.clientId) }))!;
  const fl = (await db.query.freelancers.findFirst({ where: eq(freelancers.id, inv.freelancerId) }))!;
  if (contract.mergeOnPayment && !contract.clientAcceptedAt) {
    throw new UserFacingError(`${client.name} hasn't accepted the merge-on-payment terms yet. Send them the contract link from the dashboard; MergePay won't invoice under terms the client hasn't agreed to.`, 412);
  }
  const pr = await getGitHub().getPull(inv.repo, inv.prNumber).catch((e) => wrapGitHub(e, "Couldn't re-check the PR"));
  if (pr.headSha !== inv.headSha) {
    throw new UserFacingError(`PR #${inv.prNumber} has new commits since this draft (${short(inv.headSha)} → ${short(pr.headSha)}). Draft it again so the client pays for what they'll get.`, 409);
  }

  const pp = getPayPal();
  const terms = contract.mergeOnPayment
    ? `Pull request #${inv.prNumber} (commit ${short(inv.headSha)}) in ${inv.repo} merges automatically once this invoice is paid in full, as agreed on ${contract.clientAcceptedAt!.toISOString().slice(0, 10)}. Changes pushed after this invoice are not included and won't be merged by this payment.`
    : `Payment for pull request #${inv.prNumber} in ${inv.repo}.`;
  const previewLine = inv.previewUrl ? `\nPreview before paying: ${inv.previewUrl}` : "";
  const note = `${inv.scope.summary}${previewLine}\nPull request: ${inv.prUrl}`;
  let facts: InvoiceFacts;
  try {
    const number = await nextInvoiceNumber(pp);
    facts = await createDraftInvoice(pp, {
      invoiceNumber: number, reference: inv.id, currency: inv.currency, businessName: fl.businessName ?? fl.name,
      recipient: { name: client.name, email: client.email }, note, terms, memo: `MergePay ${inv.id} · ${inv.repo}#${inv.prNumber}@${short(inv.headSha)}`, items: inv.lineItems,
    }, `create-${inv.id}`);
    if (facts.totalMinor !== inv.amountMinor) {
      throw new UserFacingError(`PayPal computed ${formatMoney(facts.totalMinor, inv.currency)} but the contract says ${formatMoney(inv.amountMinor, inv.currency)}. Not sent; please report this.`, 500);
    }
    await ppSend(pp, facts.id, { subject: `Invoice ${number}: ${inv.prTitle}`, note: `Payment for ${inv.repo} pull request #${inv.prNumber}.` }, `send-${inv.id}`);
    facts = await getInvoice(pp, facts.id);
  } catch (e) {
    if (e instanceof PayPalApiError) {
      await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "paypal", action: "invoice.send_failed", ref: e.debugId ?? null, outcome: "FAILED", detail: { status: e.status, name: e.paypalName, issue: e.issue ?? null } });
      throw new UserFacingError(`PayPal refused the invoice: ${e.message}${e.debugId ? ` (debug id ${e.debugId})` : ""}`, 502);
    }
    throw e;
  }
  const [sent] = await db.update(invoices).set({
    status: "SENT", paypalInvoiceId: facts.id, paypalInvoiceNumber: facts.number, payerViewUrl: facts.recipientViewUrl, sentAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(invoices.id, inv.id), eq(invoices.status, "DRAFT"))).returning();
  if (!sent) return loadOwned(a.freelancerId, inv.id); // a concurrent send won; PayPal deduplicated on the request id
  await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "freelancer", action: "invoice.sent", ref: facts.id, outcome: "OK",
    detail: { number: facts.number, paypalStatus: facts.status, amount: formatMoney(facts.totalMinor, facts.currency), to: client.email, headSha: inv.headSha } });
  await prComment(sent, `💳 **Invoice ${facts.number} sent via PayPal** — ${formatMoney(sent.amountMinor, sent.currency)} to ${client.name}.\n\n${contract.mergeOnPayment ? `As agreed, this PR merges automatically once the invoice is paid in full. The payment covers commit \`${short(sent.headSha)}\`; anything pushed after it is not included.` : "Merge is manual for this contract."}\n\n<sub>MergePay · ${sent.id}</sub>`);
  return sent;
}

/** Re-read the invoice from PayPal; if it is now paid, run the paid → merge step (covers a missed webhook). */
export async function refreshInvoice(a: { freelancerId: string; invoiceId: string }): Promise<{ invoice: Invoice; paypal: InvoiceFacts | null }> {
  const inv = await loadOwned(a.freelancerId, a.invoiceId);
  if (!inv.paypalInvoiceId) return { invoice: inv, paypal: null };
  const facts = await getInvoice(getPayPal(), inv.paypalInvoiceId);
  if (inv.status === "SENT" || inv.status === "PAID") await onInvoicePaid(inv.paypalInvoiceId, "status check", facts);
  return { invoice: await loadOwned(a.freelancerId, a.invoiceId), paypal: facts };
}

export async function remindClient(a: { freelancerId: string; invoiceId: string }): Promise<Invoice> {
  const inv = await loadOwned(a.freelancerId, a.invoiceId);
  if (inv.status !== "SENT" || !inv.paypalInvoiceId) throw new UserFacingError(`Only a sent, unpaid invoice can be reminded (this one is ${inv.status}).`, 409);
  try {
    await ppRemind(getPayPal(), inv.paypalInvoiceId, `A friendly reminder about ${inv.repo} pull request #${inv.prNumber}.`, `remind-${inv.id}-${new Date().toISOString().slice(0, 10)}`);
  } catch (e) {
    if (e instanceof PayPalApiError) throw new UserFacingError(`PayPal refused the reminder: ${e.message}`, 502);
    throw e;
  }
  await audit(getDb(), { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "freelancer", action: "invoice.reminded", ref: inv.paypalInvoiceId, outcome: "OK", detail: {} });
  return inv;
}

export async function cancelInvoice(a: { freelancerId: string; invoiceId: string; confirm: boolean }): Promise<Invoice> {
  const db = getDb();
  const inv = await loadOwned(a.freelancerId, a.invoiceId);
  if (a.confirm !== true) throw new UserFacingError("Not cancelled. Confirm with the developer first (confirm: true).", 412);
  if (inv.status !== "DRAFT" && inv.status !== "SENT") throw new UserFacingError(`A ${inv.status} invoice can't be cancelled.`, 409);
  if (inv.status === "SENT" && inv.paypalInvoiceId) {
    try { await ppCancel(getPayPal(), inv.paypalInvoiceId, "This invoice was withdrawn.", `cancel-${inv.id}`); } catch (e) {
      if (e instanceof PayPalApiError) throw new UserFacingError(`PayPal refused to cancel: ${e.message}`, 502);
      throw e;
    }
  }
  const [c] = await db.update(invoices).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(invoices.id, inv.id), eq(invoices.status, inv.status))).returning();
  await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "freelancer", action: "invoice.cancelled", ref: inv.paypalInvoiceId, outcome: "OK", detail: { from: inv.status } });
  if (inv.status === "SENT") await prComment(inv, `Invoice ${inv.paypalInvoiceNumber} was cancelled. This PR will not merge from it.\n\n<sub>MergePay · ${inv.id}</sub>`);
  return c ?? inv;
}

// ---------------------------------------------------------------------------
// Paid → merge
// ---------------------------------------------------------------------------

/**
 * Called for INVOICING.INVOICE.PAID webhooks and status checks. Re-reads the invoice from PayPal
 * (unless the caller just did), and only a full PayPal payment moves it to PAID and on to merge.
 */
export async function onInvoicePaid(paypalInvoiceId: string, source: string, known?: InvoiceFacts): Promise<Invoice | null> {
  const db = getDb();
  const facts = known ?? (await getInvoice(getPayPal(), paypalInvoiceId));
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.paypalInvoiceId, paypalInvoiceId) });
  if (!inv) return null;
  if (inv.status === "SENT") {
    if (!facts.paidThroughPayPal) {
      if (facts.status === "MARKED_AS_PAID" || facts.status === "PAID_EXTERNAL") {
        const [b] = await db.update(invoices).set({ status: "MERGE_BLOCKED", blockReason: "Marked as paid outside PayPal. MergePay only auto-merges on a payment PayPal itself received; merge it yourself if you were paid.", updatedAt: new Date() })
          .where(and(eq(invoices.id, inv.id), eq(invoices.status, "SENT"))).returning();
        if (b) await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "paypal", action: "invoice.marked_paid_externally", ref: facts.id, outcome: "INFO", detail: { paypalStatus: facts.status, source } });
      } else if (facts.status === "CANCELLED" || facts.status === "AUTO_CANCELLED") {
        await db.update(invoices).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(invoices.id, inv.id), eq(invoices.status, "SENT")));
        await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "paypal", action: "invoice.cancelled_at_paypal", ref: facts.id, outcome: "INFO", detail: { source } });
      } else if (facts.status === "PARTIALLY_PAID" || facts.status === "PAYMENT_PENDING") {
        await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "paypal", action: "invoice.payment_incomplete", ref: facts.id, outcome: "PENDING", detail: { paypalStatus: facts.status, paid: facts.paidMinor, due: facts.dueMinor, source } });
      }
      return db.query.invoices.findFirst({ where: eq(invoices.id, inv.id) }) as Promise<Invoice>;
    }
    if (facts.paidMinor !== inv.amountMinor || facts.currency !== inv.currency) {
      await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "system", action: "invoice.amount_mismatch", ref: facts.id, outcome: "REJECTED", detail: { expected: inv.amountMinor, paid: facts.paidMinor, currency: facts.currency } });
      await db.update(invoices).set({ status: "MERGE_BLOCKED", blockReason: `PayPal reports ${formatMoney(facts.paidMinor, facts.currency)} paid, but the invoice was for ${formatMoney(inv.amountMinor, inv.currency)}.`, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
      return db.query.invoices.findFirst({ where: eq(invoices.id, inv.id) }) as Promise<Invoice>;
    }
    const [paid] = await db.update(invoices).set({ status: "PAID", paidAt: new Date(), paidAmountMinor: facts.paidMinor, updatedAt: new Date() })
      .where(and(eq(invoices.id, inv.id), eq(invoices.status, "SENT"))).returning();
    if (paid) await audit(db, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "paypal", action: "invoice.paid", ref: facts.lastPaymentId ?? facts.id, outcome: "OK", detail: { amount: formatMoney(facts.paidMinor, facts.currency), paypalStatus: facts.status, source } });
  }
  return mergeIfPaid(inv.id);
}

/** Merge exactly the invoiced commit, once. Serialised per invoice with a transaction-scoped lock. */
export async function mergeIfPaid(invoiceId: string): Promise<Invoice> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mergepay-merge|${invoiceId}`}, 0))`);
    const inv = (await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) }))!;
    if (inv.status !== "PAID") return;
    const contract = (await tx.query.contracts.findFirst({ where: eq(contracts.id, inv.contractId) }))!;
    const block = async (reason: string, detail: Record<string, unknown>) => {
      await tx.update(invoices).set({ status: "MERGE_BLOCKED", blockReason: reason, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
      await audit(tx, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "system", action: "merge.blocked", ref: `${inv.repo}#${inv.prNumber}`, outcome: "REJECTED", detail: { reason, ...detail } });
      return reason;
    };
    if (!contract.mergeOnPayment) {
      await audit(tx, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "system", action: "merge.skipped", ref: null, outcome: "INFO", detail: { reason: "contract says merge manually" } });
      return;
    }
    const gh = getGitHub();
    let reason: string | null = null;
    try {
      const pr = await gh.getPull(inv.repo, inv.prNumber);
      if (pr.merged) {
        reason = await block("The PR was already merged by someone else before the payment arrived.", {});
      } else if (pr.state !== "open") {
        reason = await block("The PR was closed before the payment arrived; nothing was merged.", {});
      } else if (pr.headSha !== inv.headSha) {
        reason = await block(`The PR changed after invoicing (paid for ${short(inv.headSha)}, head is now ${short(pr.headSha)}). Nothing was merged: the client only paid for the invoiced commit.`, { paidFor: inv.headSha, headNow: pr.headSha });
      } else {
        const m = await gh.mergePull(inv.repo, inv.prNumber, inv.headSha, contract.mergeMethod, `${inv.prTitle} (#${inv.prNumber}) — paid via PayPal invoice ${inv.paypalInvoiceNumber}`);
        await tx.update(invoices).set({ status: "MERGED", mergedAt: new Date(), mergeCommitSha: m.sha, updatedAt: new Date() }).where(eq(invoices.id, inv.id));
        await audit(tx, { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "github", action: "pr.merged", ref: m.sha, outcome: "OK", detail: { method: contract.mergeMethod, mergedCommit: inv.headSha } });
      }
    } catch (e) {
      if (e instanceof GitHubApiError) {
        reason = await block(e.status === 409 ? "GitHub refused: the PR head moved during the merge. Nothing was merged." : `GitHub refused the merge (${e.status}): ${e.message}`, { status: e.status });
      } else {
        throw e;
      }
    }
    void reason;
  });
  const after = (await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) }))!;
  if (after.status === "MERGED") {
    await prComment(after, `✅ **Paid via PayPal** (invoice ${after.paypalInvoiceNumber}, ${formatMoney(after.paidAmountMinor ?? after.amountMinor, after.currency)}). Merged commit \`${short(after.headSha)}\` as agreed.\n\n<sub>MergePay · ${after.id}</sub>`);
  } else if (after.status === "MERGE_BLOCKED") {
    await prComment(after, `⚠️ **Paid via PayPal, but not merged.** ${after.blockReason}\n\n<sub>MergePay · ${after.id}</sub>`);
  }
  return after;
}

async function prComment(inv: Pick<Invoice, "repo" | "prNumber" | "id" | "freelancerId">, body: string) {
  try {
    await getGitHub().comment(inv.repo, inv.prNumber, body);
  } catch (e) {
    await audit(getDb(), { freelancerId: inv.freelancerId, invoiceId: inv.id, actor: "github", action: "pr.comment_failed", ref: null, outcome: "FAILED", detail: { error: String(e).slice(0, 200) } });
  }
}
