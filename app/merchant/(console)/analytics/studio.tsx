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
  const rel = (id: string, table: string) => ({ id, source: { tableId: table, fieldId: "orderId" }, target: { tableId: "orders", fieldId: "id" }, type: "many-to-one" as const });
  return {
    description: "Kept Intelligence: one PayPal merchant's promise ledger. A promise is something the merchant, its AI sales assistant or its policies committed to, or a limit a shopper gave their own AI agent. Outcomes are decided by deterministic code against PayPal's records. Preflights are Kept's checks of the PayPal order before capture. Money is never summed across currencies: filter by currency first.",
    sources: [
      { id: "orders", description: "PayPal orders. Captured and refunded amounts are PayPal-confirmed. channel says whether Kept's protected checkout handled capture.", data: d.orders,
        fields: fields([["id", "Order ID", "textFormat"], ["createdAt", "Order date", "dateFormat"], ["customer", "Customer", "textFormat"], ["currency", "Currency", "textFormat"], ["channel", "Checkout", "textFormat"],
          ["paypalStatus", "PayPal status", "textFormat"], ["captured", "Captured", "currencyFormat"], ["refunded", "Refunded", "currencyFormat"], ["honoredAtCheckout", "Honoured before payment", "currencyFormat"],
          ["warnedAtCheckout", "Warned before payment", "integerFormat"], ["extractionFailed", "Extraction failed", "integerFormat"]]) },
      { id: "promises", description: "One row per promise. 'resolved' = kept or broken. 'good' = kept or made good.", data: d.promises,
        fields: fields([["id", "Promise ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["type", "Promise type", "textFormat"], ["outcome", "Outcome", "textFormat"],
          ["source", "Said in", "textFormat"], ["attribution", "Accountable", "textFormat"], ["extractor", "Extracted by", "textFormat"], ["currency", "Promise currency", "textFormat", true],
          ["one", "Promises", "integerFormat"], ["enforced", "Enforced", "integerFormat"], ["resolved", "Resolved", "integerFormat"], ["kept", "Kept as promised", "integerFormat"],
          ["good", "Kept or made good", "integerFormat"], ["brokenOpen", "Broken, open", "integerFormat"], ["madeGood", "Made good", "integerFormat"], ["atRisk", "At risk", "integerFormat"],
          ["unverifiable", "Unverifiable", "integerFormat"], ["needsConfirmation", "Needs confirmation", "integerFormat"], ["outstanding", "Outstanding", "currencyFormat"]]) },
      { id: "preflights", description: "Kept's pre-capture checks of the authoritative PayPal order. 'stoppedBeforeCapture' is the over-charge Kept refused to capture in its protected checkout.", data: d.preflights,
        fields: fields([["id", "Check ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["verdict", "Verdict", "textFormat"], ["outcome", "Check outcome", "textFormat"], ["currency", "Check currency", "textFormat", true],
          ["one", "Checks", "integerFormat"], ["enforced", "In protected checkout", "integerFormat"], ["ready", "Verified", "integerFormat"], ["blocked", "Blocked (protected checkout)", "integerFormat"], ["recordedMismatch", "Mismatch recorded (external capture)", "integerFormat"], ["held", "Held", "integerFormat"], ["failed", "Check failed", "integerFormat"],
          ["mismatch", "Mismatch found", "currencyFormat"], ["stoppedBeforeCapture", "Stopped before capture", "currencyFormat"]]) },
      { id: "remedies", description: "Fixes Kept proposed. Every one needed the merchant's approval.", data: d.remedies,
        fields: fields([["id", "Remedy ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["kind", "Remedy", "textFormat"], ["state", "Remedy state", "textFormat"],
          ["proposedBy", "Proposed by", "textFormat"], ["currency", "Remedy currency", "textFormat", true], ["amount", "Remedy amount", "currencyFormat"], ["one", "Remedies", "integerFormat"], ["approved", "Approved", "integerFormat"]]) },
      { id: "refunds", description: "Refunds as PayPal reports them (confirmed by GET).", data: d.refunds,
        fields: fields([["id", "PayPal refund ID", "textFormat"], ["orderId", "Order ID", "textFormat", true], ["status", "Refund status", "textFormat"], ["currency", "Refund currency", "textFormat", true],
          ["amount", "Refund amount", "currencyFormat"], ["one", "Refunds", "integerFormat"], ["completed", "Refunded (completed)", "currencyFormat"], ["pending", "Refunds pending", "integerFormat"], ["failed", "Refunds failed", "integerFormat"]]) },
      { id: "events", description: "PayPal webhook events received (deduplicated, re-fetched by GET).", data: d.events,
        fields: fields([["id", "Event ID", "textFormat", true], ["orderId", "Order ID", "textFormat", true], ["type", "Event type", "textFormat"], ["verification", "Verification", "textFormat"],
          ["processing", "Processing", "textFormat"], ["receivedAt", "Received", "dateFormat"], ["one", "Events", "integerFormat"], ["failed", "Processing failures", "integerFormat"]]) },
      { id: "aiEval", description: "The last AI-vs-rules extraction evaluation (npm run eval:ai): promises found out of expected, and false promises on traps.", data: d.aiEval,
        fields: fields([["id", "Metric ID", "textFormat", true], ["metric", "Evaluation metric", "textFormat"], ["value", "Found", "integerFormat", true], ["of", "Out of", "integerFormat", true], ["result", "Result", "textFormat"], ["ranAt", "Evaluated on", "dateFormat"]]) },
    ],
    relationships: [
      rel("promise-order", "promises"), rel("remedy-order", "remedies"), rel("preflight-order", "preflights"), rel("refund-order", "refunds"), rel("event-order", "events"),
      { id: "orders-createdAt-calendar", source: { tableId: "orders", fieldId: "createdAt" }, target: { calendarId: "calendar" } },
    ],
    calendars: [{ id: "calendar", label: "Calendar", range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: dates.at(-1) ?? today } }, fragments: ["year", "month", "week", "day"] }],
    expressions: [
      { id: "keptRate", name: "Kept as promised", description: "Of promises already resolved (kept or broken), the share kept as promised. Promises still being watched are excluded.", format: "percentageFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("promises.kept"), sum("promises.resolved")] } },
      { id: "goodRate", name: "Kept or made good", description: "Of promises already resolved, the share kept as promised or broken and then made good with a PayPal-confirmed fix.", format: "percentageFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("promises.good"), sum("promises.resolved")] } },
    ],
  };
}

const donut = (text: string, cat: string, val: string) => ({ type: "donut-chart" as const, dataMapping: { categoryKey: [{ id: cat }], valueKey: [sum(val)] },
  format: { ...title(text), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } } });

const health: AgPageState = {
  id: "intelligence",
  widgets: {
    currency: { type: "button-filter", dataMapping: { value: [{ id: "orders.currency" }] }, format: { ...title("Currency"), style: { selection: { type: "single" }, dimensions: { height: 28, minWidth: 48 } } } },
    // Promise health
    "kpi-promises": kpi("Promises", countd("promises.id")),
    "kpi-rate": kpi("Kept as promised", { id: "keptRate" }),
    "kpi-good": kpi("Kept or made good", { id: "goodRate" }),
    "kpi-atrisk": kpi("At risk", sum("promises.atRisk")),
    "kpi-open": kpi("Broken, open", sum("promises.brokenOpen")),
    // Pre-payment protection
    "kpi-checks": kpi("Pre-capture checks", sum("preflights.one")),
    "kpi-verified": kpi("Verified", sum("preflights.ready")),
    "kpi-blocked": kpi("Blocked before capture", sum("preflights.blocked")),
    "kpi-stopped": kpi("Stopped before capture ($)", sum("preflights.stoppedBeforeCapture")),
    "kpi-heldfailed": kpi("Held or check failed", sum("preflights.held")),
    // Post-payment recovery
    "kpi-remedies": kpi("Remedies proposed", sum("remedies.one")),
    "kpi-approved": kpi("Merchant-approved", sum("remedies.approved")),
    "kpi-refunded": kpi("Refunded, confirmed ($)", sum("refunds.completed")),
    "kpi-pending": kpi("Refunds pending", sum("refunds.pending")),
    "kpi-failed": kpi("Refunds failed", sum("refunds.failed")),
    "kpi-honored": kpi("Honoured pre-pay ($)", sum("orders.honoredAtCheckout")),
    outcomes: donut("Promises by outcome", "promises.outcome", "promises.one"),
    bySource: { type: "column-chart-stacked", dataMapping: { categoryKey: [{ id: "promises.source" }], valueKey: [sum("promises.one")], legendKey: [{ id: "promises.outcome" }] },
      format: { ...title("Where promises were made, and how they ended"), style: { theme: { common: { legend: { enabled: true } } } } } },
    preflightOutcomes: donut("Pre-capture checks by outcome", "preflights.outcome", "preflights.one"),
    events: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "events.type" }], valueKey: [sum("events.one"), sum("events.failed")] },
      format: { ...title("PayPal events received, and processing failures"), style: { theme: { common: { legend: { enabled: true } } } } } },
    byType: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "promises.type" }], valueKey: [sum("promises.kept"), sum("promises.madeGood"), sum("promises.brokenOpen")] },
      format: { ...title("Outcome by promise type"), style: { theme: { common: { legend: { enabled: true } } } } } },
    remedies: donut("Remedy money by state ($)", "remedies.state", "remedies.amount"),
    // AI quality
    "kpi-extracted": kpi("Promises extracted", sum("promises.one")),
    "kpi-confirm": kpi("Need confirmation", sum("promises.needsConfirmation")),
    "kpi-unverifiable": kpi("Unverifiable (never enforced)", sum("promises.unverifiable")),
    "kpi-extractfail": kpi("Extraction failures", sum("orders.extractionFailed")),
    aiEval: { type: "grid", dataMapping: { cols: [{ id: "aiEval.metric" }, { id: "aiEval.result" }, { id: "aiEval.ranAt" }] }, format: title("Extraction evaluation (last run of npm run eval:ai)") },
    byExtractor: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "promises.extractor" }], valueKey: [sum("promises.enforced"), sum("promises.needsConfirmation"), sum("promises.unverifiable")] },
      format: { ...title("Extracted by, and how the validator judged it"), style: { theme: { common: { legend: { enabled: true } } } } } },
    ledger: { type: "grid", dataMapping: { cols: [{ id: "orders.id" }, { id: "orders.channel" }, { id: "promises.type" }, { id: "promises.source" }, { id: "promises.outcome" }, { id: "promises.attribution" }, sum("promises.outstanding")] },
      sort: [{ field: sum("promises.outstanding"), direction: "desc" }], format: title("Every promise, largest outstanding first") },
  },
  widgetLayout: {
    "kpi-promises": at(0, 0, 4, 7), "kpi-rate": at(4, 0, 4, 7), "kpi-good": at(8, 0, 4, 7), "kpi-atrisk": at(12, 0, 4, 7), "kpi-open": at(16, 0, 4, 7), currency: at(20, 0, 4, 7),
    "kpi-checks": at(0, 7, 4, 7), "kpi-verified": at(4, 7, 4, 7), "kpi-blocked": at(8, 7, 4, 7), "kpi-stopped": at(12, 7, 4, 7), "kpi-heldfailed": at(16, 7, 4, 7), "kpi-honored": at(20, 7, 4, 7),
    "kpi-remedies": at(0, 14, 4, 7), "kpi-approved": at(4, 14, 4, 7), "kpi-refunded": at(8, 14, 4, 7), "kpi-pending": at(12, 14, 4, 7), "kpi-failed": at(16, 14, 4, 7), "kpi-extractfail": at(20, 14, 4, 7),
    outcomes: at(0, 21, 8, 18), bySource: at(8, 21, 16, 18),
    preflightOutcomes: at(0, 39, 8, 18), events: at(8, 39, 16, 18),
    byType: at(0, 57, 12, 18), remedies: at(12, 57, 12, 18),
    "kpi-extracted": at(0, 75, 6, 7), "kpi-confirm": at(6, 75, 6, 7), "kpi-unverifiable": at(12, 75, 6, 7),
    aiEval: at(0, 82, 12, 16), byExtractor: at(12, 82, 12, 16),
    ledger: at(0, 98, 24, 20),
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
        <p className="text-ink-soft">As of <span className="mono">{data.asOf.slice(0, 16).replace("T", " ")} UTC</span> · {data.promises.length} promises · {data.orders.length} orders · {data.preflights.length} pre-capture checks · currencies: {[...new Set(data.orders.map((o) => o.currency))].join(", ") || "—"}. Row 1: promise health · row 2: prevention before payment · row 3: recovery after payment.</p>
        <button className="btn min-h-9 px-3 py-1" onClick={() => setMode(mode === "view" ? "edit" : "view")}>{mode === "view" ? "Edit this report" : "Done editing"}</button>
      </div>
      <div style={{ height: mode === "edit" ? "60rem" : "142rem" }}>
        <AgStudioProvider licenseKey={licenseKey}>
          <AgStudio style={{ height: "100%", width: "100%" }} theme={theme} layout={{ widgetBorderEnabled: true }} data={dataSources(data)} initialState={report} mode={mode} />
        </AgStudioProvider>
      </div>
    </div>
  );
}
