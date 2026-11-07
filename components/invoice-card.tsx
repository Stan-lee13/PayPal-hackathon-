import type { invoiceView } from "@/lib/services/views";

export type InvoiceView = ReturnType<typeof invoiceView>;

const LABEL: Record<string, string> = { DRAFT: "Draft", SENT: "Sent · awaiting payment", PAID: "Paid · merging", MERGED: "Paid · merged", MERGE_BLOCKED: "Paid · not merged", CANCELLED: "Cancelled" };

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip chip-${status}`}>{LABEL[status] ?? status}</span>;
}

/** The invoice as the developer reviews it: numbers from the contract, words from the agent, scope check up front. */
export function InvoiceCard({ inv, compact = false }: { inv: InvoiceView; compact?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{inv.paypal?.number ?? "Draft invoice"} <span className="font-normal text-ink-soft">· {inv.repo}#{inv.pr}</span></p>
          <p className="truncate text-xs text-ink-soft">{inv.prTitle} · commit <span className="mono">{inv.commit.slice(0, 7)}</span></p>
        </div>
        <StatusChip status={inv.status} />
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Invoice line items</caption>
        <tbody>
          {inv.items.map((i, k) => (
            <tr key={k} className="border-b border-rule/70 align-top">
              <td className="px-4 py-2.5">
                <p className="font-medium">{i.name}{i.kind === "HOURS" ? <span className="text-ink-soft"> · {i.quantity} h × {i.unit}</span> : null}</p>
                {!compact && i.description ? <p className="mt-0.5 text-xs text-ink-soft">{i.description}</p> : null}
                {i.kind === "EXTRA" ? <p className="mt-1 text-xs font-medium text-blocked">Change request — outside the original agreement</p> : null}
              </td>
              <td className="money whitespace-nowrap px-4 py-2.5 text-right">{i.total}</td>
            </tr>
          ))}
          <tr>
            <td className="px-4 py-2.5 text-right text-xs uppercase tracking-wider text-ink-soft">Total</td>
            <td className="money whitespace-nowrap px-4 py-2.5 text-right text-base font-semibold">{inv.amount}</td>
          </tr>
        </tbody>
      </table>
      {!compact && (
        <div className="space-y-2 border-t border-rule bg-sunken/60 px-4 py-3 text-sm">
          <p className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">Scope check</span> · {inv.scope.source === "claude" ? "written by Claude, checked against the PR" : "MergePay rules"} · prices from the contract
          </p>
          <p>{inv.scope.summary}</p>
          {inv.scope.outOfScope.length > 0 && (
            <div className="rounded-lg border border-blocked/30 bg-blocked-wash px-3 py-2">
              <p className="text-xs font-semibold text-blocked">Not covered by the agreed issues — not billed</p>
              <ul className="mt-1 space-y-1 text-xs">
                {inv.scope.outOfScope.map((o, k) => <li key={k}>{o.summary} <span className="mono text-ink-soft">{o.files.join(", ")}</span></li>)}
              </ul>
            </div>
          )}
          {inv.scope.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-ink-soft">
              {inv.scope.warnings.map((w, k) => <li key={k}>• {w}</li>)}
            </ul>
          )}
        </div>
      )}
      {inv.blockReason ? <p className="border-t border-rule bg-blocked-wash px-4 py-3 text-sm"><span className="font-semibold text-blocked">Why it didn't merge: </span>{inv.blockReason}</p> : null}
    </div>
  );
}
