import { Alert, Text, Box } from "@/ui";
import * as palette from "@/ui/palette";
import { IconAlertCircle } from "@/components/common/Icons";
import { createMemo, createSignal, createEffect, Show } from "solid-js";
import { useStoreSnapshot } from "../paper-trading/storeSnapshot";
import { useBacktestQueryParams } from "./useBacktestQueryParams";
import { BacktestConfig, BacktestProgress, TradeHistoryTable } from ".";
import { BacktestLeftPanel } from "./BacktestPanels";
import { BacktestToolbar } from "./BacktestToolbar";
import { BacktestRightRail } from "./BacktestRightRail";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { BacktestTradeCharts } from "./BacktestTradeCharts";
import { ChartErrorBoundary } from "./ChartErrorBoundary";
import { BacktestEdgePanel } from "./BacktestEdgePanel";
import { DEFAULT_TRADE_FILTERS, type TradeFilters } from "./tradeFilters";
import { useBacktestLayout } from "./useBacktestLayout";
import { zoomToTrade } from "./BacktestChart";
import { BacktestChartTabs } from "./BacktestChartTabs";
import {
  getBacktestState,
  subscribe,
  setSelectedChartSymbol,
  setChartOptions,
  setTradeHistory,
  setError,
  setSelectedStrategy,
  setSelectedVariation,
  setParam,
  setDays,
  setIncludeCosts,
  setSelectedSymbols,
  resetBacktestState,
} from "../../state/backtest";
import {
  runBacktest,
  fetchStrategies,
  fetchCosts,
  fetchVariations,
  fetchChartData,
} from "../../api/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";
import { getHolidayState, subscribeToHolidays, loadHolidays } from "../../state/holidays";
function sortResults(results: any[] | null, column: string, direction: "asc" | "desc") {
  if (!results) return [];
  return [...results].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;
    switch (column) {
      case "symbol": aVal = a.symbol; bVal = b.symbol; break;
      case "net_pnl": aVal = a.net_pnl; bVal = b.net_pnl; break;
      case "trades": aVal = a.trades; bVal = b.trades; break;
      case "win_rate": aVal = a.win_rate; bVal = b.win_rate; break;
      case "pf": aVal = a.pf; bVal = b.pf; break;
      default: return 0;
    }
    if (typeof aVal === "string" && typeof bVal === "string") {
      return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return direction === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });
}

function useSortHandlers() {
  const [column, setColumn] = createSignal("net_pnl");
  const [direction, setDirection] = createSignal<"asc" | "desc">("desc");
  const handleSort = (col: string) => {
    if (column() === col) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setColumn(col); setDirection("desc"); }
  };
  return { column, direction, handleSort };
}

function useTradeSortHandlers() {
  const [column, setColumn] = createSignal("entry_time");
  const [direction, setDirection] = createSignal<"asc" | "desc">("desc");
  const handleSort = (col: string) => {
    if (column() === col) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setColumn(col); setDirection("desc"); }
  };
  return { column, direction, handleSort };
}

function highlightTradeRow(tradeNumber: number, scope?: ParentNode | null, doScroll = true) {
  const root: ParentNode = scope ?? document;
  const row = root.querySelector(`[data-trade-number="${tradeNumber}"]`) as HTMLElement;
  if (!row) return;
  document.querySelectorAll(".trade-row-highlighted").forEach((el) => el.classList.remove("trade-row-highlighted"));
  row.classList.add("trade-row-highlighted");
  if (doScroll) row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => row.classList.remove("trade-row-highlighted"), 3000);
}

function useBacktestEffects(state: () => ReturnType<typeof getBacktestState>) {
  createEffect(() => {
    fetchStrategies();
    fetchVariations();
    fetchCosts();
    loadHolidays(2026);
  });

  createEffect(() => {
    const s = state();
    if (s.results && s.results.length > 0 && !s.selectedChartSymbol) {
      const firstSymbol = s.results[0].symbol;
      setSelectedChartSymbol(firstSymbol);
      const chartData = s.chartData.get(firstSymbol);
      setTradeHistory(chartData?.trades?.length ? chartTradesToTrades(chartData.trades) : [], firstSymbol);
    }
  });
}

function useBacktestActions(state: () => ReturnType<typeof getBacktestState>, chartMode: () => "all" | "trades") {
  const [saveToHistory, setSaveToHistory] = createSignal(true);
  const [selectedTf, setSelectedTf] = createSignal<string>("");
  const resultsSort = useSortHandlers();
  const tradeSort = useTradeSortHandlers();

  const sortedResults = createMemo(() =>
    sortResults(state().results, resultsSort.column(), resultsSort.direction()),
  );

  const handleRunBacktest = () => runBacktest(false);
  const handleRunAndSave = () => runBacktest(true);

  const handleViewChartAndTrades = (symbol: string) => {
    setSelectedChartSymbol(symbol);
    const currentState = getBacktestState();
    const chartData = currentState.chartData.get(symbol);
    // Always update the history (even empty) so panels never show another symbol's trades.
    setTradeHistory(chartData?.trades?.length ? chartTradesToTrades(chartData.trades) : [], symbol);
    // Keep the timeframe selection consistent with the newly selected symbol.
    const tf = selectedTf();
    if (tf) {
      const tfNum = parseInt(tf, 10);
      if (!Number.isNaN(tfNum)) fetchChartData(symbol, tfNum);
    }
  };

  const handleZoomToTrade = (tradeNumber: number) => {
    if (chartMode() === "trades") {
      // Per-trade view: scroll the matching trade row into view (instant + exact,
      // so distant rows don't appear to "not scroll").
      const scroller = document.querySelector('[data-testid="trade-charts"]') as HTMLElement | null;
      const el = scroller?.querySelector(`[data-trade-number="${tradeNumber}"]`) as HTMLElement | null;
      if (scroller && el) {
        const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += delta - 8;
      }
      highlightTradeRow(tradeNumber, scroller, false);
      return;
    }
    const chartData = state().selectedChartSymbol
      ? state().chartData.get(state().selectedChartSymbol)
      : undefined;
    zoomToTrade(state().selectedChartSymbol || "", tradeNumber, chartData);
    highlightTradeRow(tradeNumber, document.querySelector('[data-testid="trade-history-table"]'), false);
  };

  const handleTfChange = async (tf: string | null) => {
    const val = tf ?? "";
    setSelectedTf(val);
    const symbol = state().selectedChartSymbol;
    if (!symbol) return;
    const tfNum = val ? parseInt(val, 10) : undefined;
    await fetchChartData(symbol, tfNum);
  };

  return {
    saveToHistory, setSaveToHistory, resultsSort, tradeSort, sortedResults,
    handleRunBacktest, handleRunAndSave, handleViewChartAndTrades, handleZoomToTrade,
    selectedTf, handleTfChange,
  };
}

function EmptyPanel(props: { children?: string; testId?: string }) {
  return (
    <Box className="p-1.5" data-testid={props.testId} style={{ padding: "12px" }}>
      <Text size="xs" c="dimmed">{props.children}</Text>
    </Box>
  );
}

export function BacktestPage() {
  const state = useStoreSnapshot(subscribe, getBacktestState);
  const holidaySnap = useStoreSnapshot(subscribeToHolidays, getHolidayState);
  useBacktestQueryParams();
  const [activeTab, setActiveTab] = createSignal<string>("results");
  const [tradeFilters, setTradeFilters] = createSignal<TradeFilters>(DEFAULT_TRADE_FILTERS);
  const layout = useBacktestLayout();
  const actions = useBacktestActions(state, () => layout.chartMode());
  useBacktestEffects(state);
  const { panels, togglePanel, openPanel } = layout;
  const symbols = createMemo(() => state().results?.map((r: any) => r.symbol) ?? []);
  const hasResults = () => Boolean(state().results && state().results!.length > 0);
  const hasTrades = () => Boolean(state().tradeHistory && state().tradeHistorySymbol);

  createEffect(() => { if (hasResults()) openPanel("results"); });
  createEffect(() => { if (hasTrades()) openPanel("trades"); });

  const strategyLabel = createMemo(() => {
    const v = state().variations.find((x: any) => x.id === state().selectedVariation);
    return v ? `${v.name} (${v.strategy_type})` : state().selectedStrategy;
  });

  const strategyType = createMemo(() => {
    const v = state().variations.find((x: any) => x.id === state().selectedVariation);
    return v?.strategy_type ?? state().selectedStrategy;
  });

  const activeChartData = createMemo(() => {
    const sym = state().selectedChartSymbol ?? symbols()[0];
    return sym ? state().chartData.get(sym) : undefined;
  });

  return (
    <Box
      className="relative h-full min-h-0 flex flex-col overflow-hidden"
      style={{ position: "relative", height: "100%", "min-height": 0, display: "flex", "flex-direction": "column", overflow: "hidden", margin: 0, padding: 0 }}
      data-testid="backtest-view"
      id="backtest-main"
    >
      <BacktestToolbar
        strategyLabel={strategyLabel()}
        symbolCount={state().selectedSymbols.length}
        days={state().days}
        isRunning={state().isRunning}
        canRun={state().selectedSymbols.length > 0}
        chartMode={layout.chartMode()}
        onChartModeChange={layout.setChartMode}
        onRun={actions.handleRunBacktest}
        onReset={layout.reset}
      />

      <Box className="relative flex-1 min-h-0 min-w-0 flex" style={{ position: "relative", flex: 1, "min-height": 0, "min-width": 0, display: "flex" }}>
        {/* Full-bleed chart */}
        <Box className="relative flex-1 min-w-0 min-h-0" style={{ position: "relative", flex: 1, "min-width": 0, "min-height": 0 }}>
          <Show
            when={hasResults()}
            fallback={
              <Box className="h-full flex items-center justify-center" style={{ height: "100%", display: "flex", "align-items": "center", "justify-content": "center", "background-color": palette.BG }}>
                <Text c="dimmed" size="sm">
                  {state().isRunning ? "Running backtest…" : "Open Config, pick symbols and press Run to see the chart."}
                </Text>
              </Box>
            }
          >
            <ChartErrorBoundary resetKey={`${layout.chartMode()}:${state().selectedChartSymbol}`}>
              <Show
                when={layout.chartMode() === "trades"}
                fallback={
                  <BacktestChartTabs
                    symbols={symbols()}
                    selectedSymbol={state().selectedChartSymbol}
                    onSymbolSelect={actions.handleViewChartAndTrades}
                    zoomValue={state().chartOptions.date_range}
                    onZoomChange={(value) => setChartOptions({ date_range: value as any })}
                    chartDataMap={state().chartData}
                    chartLoading={state().chartLoading}
                    onTradeClick={actions.handleZoomToTrade}
                    holidays={holidaySnap().holidays}
                    selectedTf={actions.selectedTf()}
                    onTfChange={actions.handleTfChange}
                  />
                }
              >
                <BacktestTradeCharts
                  chartData={activeChartData()}
                  params={state().params}
                  strategyType={strategyType()}
                  filters={tradeFilters()}
                  symbols={symbols()}
                  selectedSymbol={state().selectedChartSymbol ?? symbols()[0]}
                  onSymbolSelect={actions.handleViewChartAndTrades}
                />
              </Show>
            </ChartErrorBoundary>
          </Show>

          <Show when={state().isRunning}>
            <Box style={{ position: "absolute", top: "8px", left: "50%", transform: "translateX(-50%)", "z-index": 5 }}>
              <BacktestProgress progress={{ current: state().progress.current, total: state().progress.total, message: state().progress.message }} />
            </Box>
          </Show>

          <Show when={state().error}>
            {(message) => (
              <Box style={{ position: "absolute", top: "8px", left: "50%", transform: "translateX(-50%)", "z-index": 6, "max-width": "560px" }}>
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  title="Error"
                  color="error"
                  variant="filled"
                  data-testid="backtest-error"
                  withCloseButton
                  onClose={() => setError(null)}
                >
                  {message()}
                </Alert>
              </Box>
            )}
          </Show>
        </Box>

        {/* Right rail — collapsible panels */}
        <BacktestRightRail width={layout.railWidth()} onWidthChange={layout.setRailWidth}>
          <CollapsiblePanel id="config" title="Config" open={panels().config} onToggle={() => togglePanel("config")}>
            <BacktestConfig
              strategies={state().strategies}
              variations={state().variations}
              selectedStrategy={state().selectedStrategy}
              selectedVariation={state().selectedVariation}
              params={state().params}
              selectedSymbols={state().selectedSymbols}
              days={state().days}
              includeCosts={state().includeCosts}
              isRunning={state().isRunning}
              onStrategyChange={setSelectedStrategy}
              onVariationChange={setSelectedVariation}
              onParamChange={setParam}
              onDaysChange={setDays}
              onIncludeCostsChange={setIncludeCosts}
              onSymbolsChange={setSelectedSymbols}
              onReset={resetBacktestState}
              onRun={actions.handleRunBacktest}
              onRunAndSave={actions.handleRunAndSave}
              saveToHistory={actions.saveToHistory()}
              onSaveToHistoryChange={actions.setSaveToHistory}
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            id="results"
            title="Results"
            open={panels().results}
            onToggle={() => togglePanel("results")}
            badge={hasResults() ? state().results!.length : undefined}
          >
            <Show
              when={hasResults()}
              fallback={<EmptyPanel testId="results-empty">Run a backtest to see results.</EmptyPanel>}
            >
              <BacktestLeftPanel
                activeTab={activeTab()}
                setActiveTab={setActiveTab}
                isRunning={state().isRunning}
                progress={state().progress}
                results={state().results}
                totals={state().totals}
                selectedChartSymbol={state().selectedChartSymbol}
                sortedResults={actions.sortedResults()}
                resultsSortColumn={actions.resultsSort.column()}
                resultsSortDirection={actions.resultsSort.direction()}
                onRowClick={actions.handleViewChartAndTrades}
                onSort={actions.resultsSort.handleSort}
              />
            </Show>
          </CollapsiblePanel>

          <CollapsiblePanel
            id="trades"
            title={state().tradeHistorySymbol ? `Trades — ${state().tradeHistorySymbol}` : "Trades"}
            open={panels().trades}
            onToggle={() => togglePanel("trades")}
            badge={hasTrades() ? state().tradeHistory!.length : undefined}
          >
            <Show
              when={hasTrades() && state().tradeHistory!.length > 0}
              fallback={
                <EmptyPanel>
                  {state().tradeHistorySymbol ? `No trades for ${state().tradeHistorySymbol}.` : "Select a symbol to see its trades."}
                </EmptyPanel>
              }
            >
              <TradeHistoryTable
                symbol={state().tradeHistorySymbol!}
                trades={state().tradeHistory!}
                sortColumn={actions.tradeSort.column()}
                sortDirection={actions.tradeSort.direction()}
                onSort={actions.tradeSort.handleSort}
                onRowClick={actions.handleZoomToTrade}
                onClose={() => setTradeHistory(null, null)}
                filters={tradeFilters()}
                onFiltersChange={setTradeFilters}
              />
            </Show>
          </CollapsiblePanel>

          <CollapsiblePanel
            id="edge"
            title={state().tradeHistorySymbol ? `Edge AI — ${state().tradeHistorySymbol}` : "Edge AI"}
            open={panels().edge}
            onToggle={() => togglePanel("edge")}
            badge={hasTrades() ? state().tradeHistory!.length : undefined}
          >
            <BacktestEdgePanel
              symbol={state().tradeHistorySymbol ?? undefined}
              trades={state().tradeHistory ?? []}
              filters={tradeFilters()}
            />
          </CollapsiblePanel>
        </BacktestRightRail>
      </Box>
    </Box>
  );
}
