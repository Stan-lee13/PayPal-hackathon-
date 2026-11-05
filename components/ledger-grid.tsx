"use client";

/**
 * AG Grid (Community, MIT) for the merchant console's ledgers: promises, orders and the
 * audit trail. Rows arrive from server components as plain JSON; all formatting and
 * renderers live here. Themed with Kept's own tokens, so light/dark mode follows the app.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ClientSideRowModelModule, ColumnAutoSizeModule, DateFilterModule, NumberFilterModule, QuickFilterModule,
  TextFilterModule, CellStyleModule, TooltipModule, RowStyleModule, themeQuartz,
  type ColDef, type ICellRendererParams, type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { StateSeal } from "./seal";
import type { CommitmentState } from "@/lib/db/schema";

const modules = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, DateFilterModule, QuickFilterModule, ColumnAutoSizeModule, CellStyleModule, TooltipModule, RowStyleModule];

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  backgroundColor: "var(--paper-raised)",
  foregroundColor: "var(--ink)",
  headerBackgroundColor: "var(--paper)",
  headerTextColor: "var(--ink-soft)",
  headerFontWeight: 600,
  borderColor: "var(--rule)",
  rowHoverColor: "var(--paper)",
  accentColor: "var(--accent)",
  selectedRowBackgroundColor: "var(--paper)",
  oddRowBackgroundColor: "var(--paper-raised)",
  wrapperBorderRadius: 8,
  fontSize: 14,
});

const STATE_PRIORITY: Record<string, number> = { BROKEN: 0, AT_RISK: 1, NEEDS_CONFIRMATION: 2, PENDING: 3, KEPT: 4, UNVERIFIABLE: 5, WAIVED: 6 };
const money = (minor: unknown, currency: unknown) =>
  typeof minor === "number" && typeof currency === "string" ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100) : "—";
const when = (v: unknown) => (typeof v === "string" ? v.slice(0, 16).replace("T", " ") : "—");

export type PromiseRow = {
  id: string; orderId: string; state: CommitmentState; madeGood: boolean; type: string; typeLabel: string; quote: string; reason: string;
  source: string; customer: string; amountMinor: number | null; gapMinor: number | null; currency: string; dueAt: string | null; remedy: string | null; createdAt: string;
};
export type OrderRow = {
  id: string; createdAt: string; customer: string; email: string; status: string; capturedMinor: number | null; refundedMinor: number; currency: string;
  promises: number; broken: number; madeGood: number;
};
export type ActivityRow = { id: number; at: string; actor: string; action: string; outcome: string; orderId: string | null; detail: string };

type Kind =
  | { kind: "promises"; rows: PromiseRow[] }
  | { kind: "orders"; rows: OrderRow[] }
  | { kind: "activity"; rows: ActivityRow[] };

const OrderLink = ({ id }: { id: string | null }) => (id ? <Link className="mono text-xs underline" href={`/merchant/orders/${id}`} onClick={(e) => e.stopPropagation()}>{id}</Link> : <>—</>);

function promiseColumns(): ColDef<PromiseRow>[] {
  return [
    { field: "state", headerName: "Seal", width: 185, sort: "asc", filter: "agTextColumnFilter",
      comparator: (a, b) => (STATE_PRIORITY[a] ?? 9) - (STATE_PRIORITY[b] ?? 9),
      cellRenderer: (p: ICellRendererParams<PromiseRow>) => p.data ? <StateSeal state={p.data.state} size="sm" madeGood={p.data.madeGood} /> : null },
    { field: "quote", headerName: "Promise", flex: 2, minWidth: 300,
      cellRenderer: (p: ICellRendererParams<PromiseRow>) => p.data ? (
        <div className="flex h-full flex-col justify-center leading-snug" title={`${p.data.quote} — ${p.data.reason}`}>
          <span className="eyebrow block truncate">{p.data.typeLabel} · {p.data.source}</span>
          <span className="quote block truncate text-base">&ldquo;{p.data.quote}&rdquo;</span>
          <span className="block truncate text-xs text-ink-soft">{p.data.reason}</span>
        </div>) : null },
    { field: "source", headerName: "Said in", hide: true },
    { field: "customer", headerName: "Order", width: 170,
      cellRenderer: (p: ICellRendererParams<PromiseRow>) => p.data ? <div className="flex h-full flex-col justify-center leading-tight"><span className="block">{p.data.customer}</span><OrderLink id={p.data.orderId} /></div> : null },
    { field: "amountMinor", headerName: "Charged", width: 110, hide: true, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "money",
      valueFormatter: (p: ValueFormatterParams<PromiseRow>) => money(p.value, p.data?.currency) },
    { field: "gapMinor", headerName: "Outstanding", width: 125, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "money",
      cellClassRules: { "text-broken font-semibold": (p) => typeof p.value === "number" && p.value > 0 },
      valueFormatter: (p: ValueFormatterParams<PromiseRow>) => (p.value ? money(p.value, p.data?.currency) : "—") },
    { field: "remedy", headerName: "Remedy", width: 150,
      cellRenderer: (p: ICellRendererParams<PromiseRow>) => p.value ? <span className={`flex h-full items-center whitespace-normal text-xs font-semibold leading-tight ${p.value === "Remedy awaiting approval" ? "text-accent" : ""}`}>{p.value}</span> : <span className="text-ink-soft">—</span> },
    { field: "dueAt", headerName: "Due (UTC)", width: 140, cellClass: "mono text-xs", valueFormatter: (p) => when(p.value), hide: false },
  ];
}

function orderColumns(): ColDef<OrderRow>[] {
  return [
    { field: "id", headerName: "Order", width: 200, cellRenderer: (p: ICellRendererParams<OrderRow>) => <OrderLink id={p.value} /> },
    { field: "createdAt", headerName: "Created (UTC)", width: 150, sort: "desc", cellClass: "mono", valueFormatter: (p) => when(p.value) },
    { field: "customer", headerName: "Customer", flex: 1, minWidth: 140,
      cellRenderer: (p: ICellRendererParams<OrderRow>) => p.data ? <div className="flex h-full flex-col justify-center leading-tight"><span className="block">{p.data.customer}</span><span className="block text-xs text-ink-soft">{p.data.email}</span></div> : null },
    { field: "status", headerName: "PayPal status", width: 170 },
    { field: "capturedMinor", headerName: "Captured", width: 120, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "money", valueFormatter: (p) => money(p.value, p.data?.currency) },
    { field: "refundedMinor", headerName: "Refunded", width: 120, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "money", valueFormatter: (p) => (p.value ? money(p.value, p.data?.currency) : "—") },
    { field: "promises", headerName: "Promises", width: 110, type: "rightAligned", filter: "agNumberColumnFilter" },
    { field: "broken", headerName: "Broken", width: 100, type: "rightAligned", filter: "agNumberColumnFilter",
      cellClassRules: { "text-broken font-semibold": (p) => (p.value ?? 0) > 0 } },
    { field: "madeGood", headerName: "Made good", width: 115, type: "rightAligned", filter: "agNumberColumnFilter",
      cellClassRules: { "text-kept font-semibold": (p) => (p.value ?? 0) > 0 } },
  ];
}

function activityColumns(): ColDef<ActivityRow>[] {
  return [
    { field: "at", headerName: "Time (UTC)", width: 170, sort: "desc", cellClass: "mono", valueFormatter: (p) => (typeof p.value === "string" ? p.value.slice(0, 19).replace("T", " ") : "") },
    { field: "actor", headerName: "Who", width: 160 },
    { field: "action", headerName: "Action", width: 230, cellClass: "mono" },
    { field: "outcome", headerName: "Outcome", width: 110,
      cellClassRules: { "text-broken font-semibold": (p) => p.value === "FAILED" || p.value === "REJECTED", "text-kept": (p) => p.value === "OK" } },
    { field: "orderId", headerName: "Order", width: 190, cellRenderer: (p: ICellRendererParams<ActivityRow>) => <OrderLink id={p.value ?? null} /> },
    { field: "detail", headerName: "Detail", flex: 1, minWidth: 320, cellClass: "mono text-xs", tooltipValueGetter: (p) => p.value },
  ];
}

export function LedgerGrid(props: Kind & { searchLabel?: string; pageSize?: number }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const columnDefs = useMemo(() => (props.kind === "promises" ? promiseColumns() : props.kind === "orders" ? orderColumns() : activityColumns()), [props.kind]);
  const onRowClicked = (orderId: string | null | undefined) => { if (orderId) router.push(`/merchant/orders/${orderId}`); };

  return (
    <div className="mt-4 space-y-2">
      <input type="search" className="field max-w-sm" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={props.searchLabel ?? "Search every column…"} aria-label={props.searchLabel ?? "Search every column"} />
      <AgGridProvider modules={modules}>
        {/* Generic over three row shapes; each column set is typed above. */}
        <AgGridReact<Record<string, unknown>>
          theme={theme}
          rowData={props.rows as unknown as Record<string, unknown>[]}
          columnDefs={columnDefs as unknown as ColDef<Record<string, unknown>>[]}
          defaultColDef={{ filter: true, sortable: true, resizable: true }}
          quickFilterText={search}
          domLayout="autoHeight"
          rowHeight={props.kind === "promises" ? 78 : props.kind === "orders" ? 56 : 44}
          enableCellTextSelection
          suppressCellFocus={false}
          getRowId={(p) => String(p.data.id)}
          rowClass="cursor-pointer"
          onRowClicked={(e) => onRowClicked(props.kind === "orders" ? (e.data?.id as string) : (e.data?.orderId as string | null))}
          overlayNoRowsTemplate="<span>Nothing here yet.</span>"
        />
      </AgGridProvider>
    </div>
  );
}
