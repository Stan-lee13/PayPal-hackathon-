"use client";

/**
 * Promise analytics in AG Studio: a report over Kept's own promise, order and remedy records.
 * The merchant can switch to Edit and build their own widgets from the same data.
 */
import { useState, useSyncExternalStore } from "react";
import { studioTheme, type AgDataSourcesDefinition, type AgFieldDefinition, type AgFormat, type AgPageState, type AgReportState, type AgStudioMode, type AgWidgetLayoutState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { AnalyticsData } from "@/lib/services/analytics";

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const typo = (fontSize: number, fontWeight: "normal" | "bold" = "normal") => ({ fontFamily: "var(--font-sans)", fontSize, fontWeight, fontStyle: "normal" as const });
const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: { title: { enabled: true, text, typography: typo(13, "bold") }, caption: { enabled: true, text: "", typography: typo(0) }, style: { typography: typo(26) } },
});

function dataSources(d: AnalyticsData): AgDataSourcesDefinition {
  const dates = d.orders.map((o) => o.createdAt).sort();
  const today = d.asOf.slice(0, 10);
  return {
    description: "Kept's promise ledger for one PayPal merchant. A promise is something the merchant, its AI sales assistant or its policies committed to, or a limit a shopper gave their own AI agent. Outcomes are decided by deterministic code against PayPal's records. Money is USD.",
    sources: [
      { id: "promises", description: "One row per promise. 'enforced' excludes unverifiable, waived and unconfirmed promises. 'good' is kept or made good.", data: d.promises,
        fields: fields([["id", "Promise ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["type", "Promise type", "textFormat"], ["outcome", "Outcome", "textFormat"],
          ["source", "Said in", "textFormat"], ["attribution", "Accountable", "textFormat"], ["one", "Promises", "integerFormat"], ["enforced", "Enforced", "integerFormat"], ["resolved", "Resolved (kept or broken)", "integerFormat"], ["kept", "Kept as promised", "integerFormat"],
          ["good", "Kept or made good", "integerFormat"], ["brokenOpen", "Broken, open", "integerFormat"], ["madeGood", "Made good", "integerFormat"], ["outstanding", "Outstanding", "currencyFormat"]]) },
      { id: "orders", description: "PayPal orders. Captured and refunded amounts are PayPal-confirmed.", data: d.orders,
        fields: fields([["id", "Order ID", "textFormat"], ["createdAt", "Order date", "dateFormat"], ["customer", "Customer", "textFormat"], ["paypalStatus", "PayPal status", "textFormat"],
          ["captured", "Captured", "currencyFormat"], ["refunded", "Refunded", "currencyFormat"], ["honoredAtCheckout", "Honoured before payment", "currencyFormat"], ["warnedAtCheckout", "Warned before payment", "integerFormat"]]) },
      { id: "remedies", description: "Fixes Kept proposed. Every one needed the merchant's approval.", data: d.remedies,
        fields: fields([["id", "Remedy ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["kind", "Remedy", "textFormat"], ["state", "Remedy state", "textFormat"],
          ["proposedBy", "Proposed by", "textFormat"], ["amount", "Remedy amount", "currencyFormat"], ["approved", "Approved", "integerFormat"]]) },
    ],
    relationships: [
      { id: "promise-order", source: { tableId: "promises", fieldId: "orderId" }, target: { tableId: "orders", fieldId: "id" }, type: "many-to-one" },
      { id: "remedy-order", source: { tableId: "remedies", fieldId: "orderId" }, target: { tableId: "orders", fieldId: "id" }, type: "many-to-one" },
      { id: "orders-createdAt-calendar", source: { tableId: "orders", fieldId: "createdAt" }, target: { calendarId: "calendar" } },
    ],
    calendars: [{ id: "calendar", label: "Calendar", range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: dates.at(-1) ?? today } }, fragments: ["year", "month", "week", "day"] }],
    expressions: [
      { id: "keptRate", name: "Kept as promised", description: "Of promises already resolved (kept or broken), the share kept as promised. Promises still being watched are excluded.", format: "percentageFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("promises.kept"), sum("promises.resolved")] } },
      { id: "goodRate", name: "Kept or made good", description: "Of promises already resolved, the share kept as promised or broken and then made good with a PayPal-confirmed fix.", format: "percentageFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("promises.good"), sum("promises.resolved")] } },
    ],
  };
}

const health: AgPageState = {
  id: "health",
  widgets: {
    "kpi-promises": kpi("Promises", countd("promises.id")),
    "kpi-rate": kpi("Kept as promised", { id: "keptRate" }),
    "kpi-good": kpi("Kept or made good", { id: "goodRate" }),
    "kpi-open": kpi("Broken, open", sum("promises.brokenOpen")),
    "kpi-refunded": kpi("Refunded ($)", sum("orders.refunded")),
    "kpi-honored": kpi("Honoured ($)", sum("orders.honoredAtCheckout")),
    outcomes: { type: "donut-chart", dataMapping: { categoryKey: [{ id: "promises.outcome" }], valueKey: [sum("promises.one")] },
      format: { ...title("Promises by outcome"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } } },
    bySource: { type: "column-chart-stacked", dataMapping: { categoryKey: [{ id: "promises.source" }], valueKey: [sum("promises.one")], legendKey: [{ id: "promises.outcome" }] },
      format: { ...title("Where promises were made, and how they ended"), style: { theme: { common: { legend: { enabled: true } } } } } },
    byType: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "promises.type" }], valueKey: [sum("promises.kept"), sum("promises.madeGood"), sum("promises.brokenOpen")] },
      format: { ...title("Outcome by promise type"), style: { theme: { common: { legend: { enabled: true } } } } } },
    remedies: { type: "donut-chart", dataMapping: { categoryKey: [{ id: "remedies.state" }], valueKey: [sum("remedies.amount")] },
      format: { ...title("Remedy money by state ($)"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } } },
    ledger: { type: "grid", dataMapping: { cols: [{ id: "orders.id" }, { id: "orders.customer" }, { id: "promises.type" }, { id: "promises.source" }, { id: "promises.outcome" }, { id: "promises.attribution" }, sum("promises.outstanding")] },
      sort: [{ field: sum("promises.outstanding"), direction: "desc" }], format: title("Every promise, largest outstanding first") },
  },
  widgetLayout: {
    "kpi-promises": at(0, 0, 4, 7), "kpi-rate": at(4, 0, 4, 7), "kpi-good": at(8, 0, 4, 7), "kpi-open": at(12, 0, 4, 7), "kpi-refunded": at(16, 0, 4, 7), "kpi-honored": at(20, 0, 4, 7),
    outcomes: at(0, 7, 8, 18), bySource: at(8, 7, 16, 18),
    byType: at(0, 25, 14, 18), remedies: at(14, 25, 10, 18),
    ledger: at(0, 43, 24, 20),
  },
};
const report: AgReportState = { selectedPageId: health.id, pages: [health] };

const v = (n: string) => `var(--${n})`;
const theme = studioTheme.withParams({
  fontFamily: v("font-sans"), fontSize: 14, textColor: v("ink"), foregroundColor: v("ink"), subtleTextColor: v("ink-soft"),
  backgroundColor: v("paper-raised"), borderColor: v("rule"), accentColor: v("accent"), rowHoverColor: v("paper"),
  studioWrapperBorder: false, studioWrapperBackgroundColor: v("paper"), studioCanvasBackgroundColor: v("paper"), studioCanvasBorder: false, studioCanvasShadow: false,
  studioCanvasRowHeight: 18, studioCanvasPadding: 0,
  studioWidgetBackgroundColor: v("paper-raised"), studioWidgetBorder: { width: 1, color: v("rule") }, studioWidgetBorderRadius: 8,
  studioWidgetTitleFontFamily: v("font-sans"), studioWidgetTitleFontWeight: 600, studioWidgetTitleTextColor: v("ink"),
  // Categorical, non-semantic: AG Studio assigns colours by category order, so red/green would mislabel outcomes.
  chartPaletteFills1Color: v("accent"), chartPaletteStrokes1Color: v("accent"),
  chartPaletteFills2Color: "#7A7FD1", chartPaletteStrokes2Color: "#7A7FD1",
  chartPaletteFills3Color: v("unverifiable"), chartPaletteStrokes3Color: v("unverifiable"),
  chartPaletteFills4Color: "#B9BCEB", chartPaletteStrokes4Color: "#B9BCEB",
  chartPaletteFills5Color: v("ink-soft"), chartPaletteStrokes5Color: v("ink-soft"),
  chartPaletteFills6Color: "#9AA1AB", chartPaletteStrokes6Color: "#9AA1AB",
});

const noSub = () => () => {};

export function PromiseStudio({ data, licenseKey }: { data: AnalyticsData; licenseKey?: string }) {
  const inBrowser = useSyncExternalStore(noSub, () => true, () => false);
  const [mode, setMode] = useState<AgStudioMode>("view");
  if (!inBrowser) return <div className="paper mt-4 h-[52rem] animate-pulse" aria-busy="true" />;
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-ink-soft">As of <span className="mono">{data.asOf.slice(0, 16).replace("T", " ")} UTC</span> · {data.promises.length} promises across {data.orders.length} orders.</p>
        <button className="btn min-h-9 px-3 py-1" onClick={() => setMode(mode === "view" ? "edit" : "view")}>{mode === "view" ? "Edit this report" : "Done editing"}</button>
      </div>
      <div style={{ height: mode === "edit" ? "56rem" : "64rem" }}>
        <AgStudioProvider licenseKey={licenseKey}>
          <AgStudio style={{ height: "100%", width: "100%" }} theme={theme} layout={{ widgetBorderEnabled: true }} data={dataSources(data)} initialState={report} mode={mode} />
        </AgStudioProvider>
      </div>
    </div>
  );
}
