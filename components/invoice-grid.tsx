"use client";

/**
 * AG Grid (Community, MIT): the freelancer's invoices. Rows arrive from a server component as plain
 * JSON; themed with MergePay's tokens so light and dark mode follow the app.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ClientSideRowModelModule, ColumnAutoSizeModule, DateFilterModule, NumberFilterModule, QuickFilterModule, TextFilterModule,
  CellStyleModule, TooltipModule, RowStyleModule, PaginationModule, ColumnApiModule, themeQuartz,
  type ColDef, type ICellRendererParams,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { StatusChip } from "./invoice-card";

const modules = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, DateFilterModule, QuickFilterModule, ColumnAutoSizeModule, CellStyleModule, TooltipModule, RowStyleModule, PaginationModule, ColumnApiModule];

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)", backgroundColor: "var(--raised)", foregroundColor: "var(--ink)", headerBackgroundColor: "var(--sunken)",
  headerTextColor: "var(--ink-soft)", headerFontWeight: 600, borderColor: "var(--rule)", rowHoverColor: "var(--sunken)", accentColor: "var(--accent)",
  selectedRowBackgroundColor: "var(--sunken)", oddRowBackgroundColor: "var(--raised)", wrapperBorderRadius: 10, fontSize: 14,
});

export type InvoiceRow = { id: string; number: string | null; repo: string; pr: number; title: string; status: string; amountMinor: number; amount: string; currency: string; createdAt: string; paidAt: string | null; mergedAt: string | null; outOfScope: number };

const ORDER: Record<string, number> = { MERGE_BLOCKED: 0, SENT: 1, DRAFT: 2, PAID: 3, MERGED: 4, CANCELLED: 5 };
const when = (v: unknown) => (typeof v === "string" ? v.slice(0, 16).replace("T", " ") : "—");

export function InvoiceGrid({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const cols = useMemo<ColDef<InvoiceRow>[]>(() => [
    { field: "status", headerName: "Status", width: 190, cellRenderer: (p: ICellRendererParams<InvoiceRow>) => <StatusChip status={String(p.value)} />, comparator: (a, b) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9), sort: "asc" },
    { field: "number", headerName: "Invoice", width: 110, valueFormatter: (p) => p.value ?? "draft", cellClass: "mono" },
    { headerName: "Pull request", flex: 2, minWidth: 260, valueGetter: (p) => `${p.data!.repo}#${p.data!.pr} ${p.data!.title}`, tooltipValueGetter: (p) => String(p.value) },
    { field: "amountMinor", headerName: "Amount", width: 120, type: "rightAligned", valueFormatter: (p) => p.data!.amount, filter: "agNumberColumnFilter", cellClass: "money" },
    { field: "outOfScope", headerName: "Unbilled extras", width: 140, type: "rightAligned", valueFormatter: (p) => (p.value ? `${p.value} flagged` : "—") },
    { field: "createdAt", headerName: "Created", width: 150, valueFormatter: (p) => when(p.value), filter: "agDateColumnFilter" },
    { field: "mergedAt", headerName: "Merged", width: 150, valueFormatter: (p) => when(p.value) },
  ], []);
  return (
    <div className="space-y-2">
      <input className="field max-w-xs" placeholder="Search invoices" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ height: Math.min(560, 96 + rows.length * 42) }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<InvoiceRow>
            theme={theme} rowData={rows} columnDefs={cols} quickFilterText={q} getRowId={(p) => p.data.id}
            defaultColDef={{ sortable: true, resizable: true, filter: true }} rowStyle={{ cursor: "pointer" }}
            pagination={rows.length > 25} paginationPageSize={25} onRowClicked={(e) => e.data && router.push(`/app/invoices/${e.data.id}`)}
            overlayNoRowsTemplate="No invoices yet. Bill a PR from your editor or the demo."
          />
        </AgGridProvider>
      </div>
    </div>
  );
}
