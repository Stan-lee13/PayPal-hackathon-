import type { Invoice } from "../db/schema";
import { formatMoney } from "../money";

export function invoiceView(inv: Invoice) {
  const m = (n: number) => formatMoney(n, inv.currency);
  return {
    id: inv.id,
    status: inv.status,
    repo: inv.repo,
    pr: inv.prNumber,
    prTitle: inv.prTitle,
    prUrl: inv.prUrl,
    commit: inv.headSha,
    amount: m(inv.amountMinor),
    amountMinor: inv.amountMinor,
    currency: inv.currency,
    items: inv.lineItems.map((i) => ({ kind: i.kind, name: i.name, description: i.description, quantity: i.quantity, unit: m(i.unitAmountMinor), total: m(i.totalMinor) })),
    scope: inv.scope,
    previewUrl: inv.previewUrl,
    paypal: inv.paypalInvoiceId ? { invoiceId: inv.paypalInvoiceId, number: inv.paypalInvoiceNumber, payerUrl: inv.payerViewUrl } : null,
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    mergedAt: inv.mergedAt?.toISOString() ?? null,
    mergeCommit: inv.mergeCommitSha,
    blockReason: inv.blockReason,
  };
}

const STATUS_LINE: Record<Invoice["status"], string> = {
  DRAFT: "Draft — not sent. Nothing has gone to PayPal or the client yet.",
  SENT: "Sent via PayPal — waiting for the client to pay.",
  PAID: "Paid via PayPal — merging.",
  MERGED: "Paid via PayPal and merged.",
  MERGE_BLOCKED: "Not merged — see the reason below.",
  CANCELLED: "Cancelled.",
};

/** What an editor agent shows the developer. */
export function invoiceMarkdown(inv: Invoice): string {
  const v = invoiceView(inv);
  const lines = [
    `**${v.paypal?.number ?? "Draft invoice"}** for ${v.repo}#${v.pr} "${v.prTitle}" — commit \`${v.commit.slice(0, 7)}\``,
    STATUS_LINE[inv.status],
    "",
    "| Item | Qty | Unit | Total |",
    "|---|---:|---:|---:|",
    ...v.items.map((i) => `| ${i.name}${i.description ? `<br><sub>${i.description}</sub>` : ""} | ${i.quantity} | ${i.unit} | ${i.total} |`),
    `| **Total** | | | **${v.amount}** |`,
    "",
    `Scope check (${inv.scope.source === "claude" ? "Claude" : "rules"}): ${inv.scope.summary}`,
  ];
  if (inv.scope.outOfScope.length) {
    lines.push("", "**Not covered by the agreed issues (not billed):**", ...inv.scope.outOfScope.map((o) => `- ${o.summary} — ${o.files.map((f) => `\`${f}\``).join(", ")}`));
    lines.push("To bill it, re-draft with an extra (it is labelled as a change request on the invoice), or move it to its own PR.");
  }
  if (inv.scope.warnings.length) lines.push("", "**Check before sending:**", ...inv.scope.warnings.map((w) => `- ${w}`));
  if (v.previewUrl) lines.push("", `Preview the client will check: ${v.previewUrl}`);
  if (v.paypal?.payerUrl) lines.push("", `Client's PayPal payment page: ${v.paypal.payerUrl}`);
  if (v.blockReason) lines.push("", `**Why not merged:** ${v.blockReason}`);
  if (v.mergeCommit) lines.push("", `Merge commit: \`${v.mergeCommit.slice(0, 7)}\``);
  lines.push("", `MergePay id: ${v.id}`);
  return lines.join("\n");
}
