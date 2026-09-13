import { Alert, Box, FloatingWindow, Text } from "@/ui";
import { IconAlertCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { useBacktestQueryParams } from "../../hooks/useBacktestQueryParams";
import { BacktestConfig, BacktestProgress, TradeHistoryTable } from ".";
import { BacktestLeftPanel } from "./BacktestPanels";
import { BacktestToolbar } from "./BacktestToolbar";
import { BacktestWindowTaskbar } from "./BacktestWindowTaskbar";
import { useBacktestWindows, WINDOW_MIN_SIZES } from "./useBacktestWindows";
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
  const [column, setColumn] = useState("net_pnl");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const handleSort = useCallback(
    (col: string) => {
      if (column === col) setDirection((d) => (d === "asc" ? "desc" : "asc"));
      else { setColumn(col); setDirection("desc"); }
    },
    [column],
  );
  return { column, direction, handleSort };
}

function useTradeSortHandlers() {
  const [column, setColumn] = useState("entry_time");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const handleSort = useCallback(
    (col: string) => {
      if (column === col) setDirection((d) => (d === "asc" ? "desc" : "asc"));
      else { setColumn(col); setDirection("desc"); }
    },
    [column],
  );
  return { column, direction, handleSort };
}

function highlightTradeRow(tradeNumber: number) {
  const row = document.querySelector(`[data-trade-number="${tradeNumber}"]`) as HTMLElement;
  if (!row) return;
  document.querySelectorAll(".trade-row-highlighted").forEach((el) => el.classList.remove("trade-row-highlighted"));
  row.classList.add("trade-row-highlighted");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => row.classList.remove("trade-row-highlighted"), 3000);
}

function useBacktestEffects(state: any) {
  useEffect(() => {
    fetchStrategies();
    fetchVariations();
    fetchCosts();
    loadHolidays(2026);
  }, []);

  useEffect(() => {
    if (state.results && state.results.length > 0 && !state.selectedChartSymbol) {
      const firstSymbol = state.results[0].symbol;
      setSelectedChartSymbol(firstSymbol);
      const chartData = state.chartData.get(firstSymbol);
      if (chartData && chartData.trades && chartData.trades.length > 0) {
        setTradeHistory(chartTradesToTrades(chartData.trades), firstSymbol);
      }
    }
  }, [state.results, state.selectedChartSymbol, state.chartData]);
}

function useBacktestActions(state: any) {
  const [saveToHistory, setSaveToHistory] = useState(true);
  const [selectedTf, setSelectedTf] = useState<string>("");
  const resultsSort = useSortHandlers();
  const tradeSort = useTradeSortHandlers();

  const sortedResults = useMemo(
    () => sortResults(state.results, resultsSort.column, resultsSort.direction),
    [state.results, resultsSort.column, resultsSort.direction],
  );

  const handleRunBacktest = useCallback(() => runBacktest(false), []);
  const handleRunAndSave = useCallback(() => runBacktest(true), []);

  const handleViewChartAndTrades = useCallback((symbol: string) => {
    setSelectedChartSymbol(symbol);
    const currentState = getBacktestState();
    const chartData = currentState.chartData.get(symbol);
    if (chartData && chartData.trades && chartData.trades.length > 0) {
      setTradeHistory(chartTradesToTrades(chartData.trades), symbol);
    }
  }, []);

  const handleZoomToTrade = useCallback(
    (tradeNumber: number) => {
      const chartData = state.selectedChartSymbol
        ? state.chartData.get(state.selectedChartSymbol)
        : undefined;
      zoomToTrade(state.selectedChartSymbol || "", tradeNumber, chartData);
      highlightTradeRow(tradeNumber);
    },
    [state.selectedChartSymbol, state.chartData],
  );

  const handleTfChange = useCallback(
    async (tf: string | null) => {
      const val = tf ?? "";
      setSelectedTf(val);
      if (!state.selectedChartSymbol) return;
      const tfNum = val ? parseInt(val, 10) : undefined;
      await fetchChartData(state.selectedChartSymbol, tfNum);
    },
    [state.selectedChartSymbol],
  );

  return {
    saveToHistory, setSaveToHistory, resultsSort, tradeSort, sortedResults,
    handleRunBacktest, handleRunAndSave, handleViewChartAndTrades, handleZoomToTrade,
    selectedTf, handleTfChange,
  };
}

export function BacktestPage() {
  useStoreSubscription(subscribe);
  useStoreSubscription(subscribeToHolidays);
  useBacktestQueryParams();
  const state = getBacktestState();
  const holidayState = getHolidayState();
  const [activeTab, setActiveTab] = useState<string | null>("results");
  const actions = useBacktestActions(state);
  useBacktestEffects(state);
  const win = useBacktestWindows();
  const { open: openWindow, focus: focusWindow, close: closeWindow, minimize: minimizeWindow, toggle: toggleWindow, setGeometry, reset: resetLayout } = win;

  const symbols = state.results?.map((r: any) => r.symbol) ?? [];
  const hasResults = Boolean(state.results && state.results.length > 0);
  const hasTrades = Boolean(state.tradeHistory && state.tradeHistorySymbol);

  // auto-open windows as data arrives
  useEffect(() => {
    if (hasResults) openWindow("results");
  }, [hasResults, openWindow]);
  useEffect(() => {
    if (hasTrades) openWindow("trades");
  }, [hasTrades, openWindow]);

  const strategyLabel = useMemo(() => {
    const v = state.variations.find((x: any) => x.id === state.selectedVariation);
    return v ? `${v.name} (${v.strategy_type})` : state.selectedStrategy;
  }, [state.variations, state.selectedVariation, state.selectedStrategy]);

  return (
    <Box
      sx={{ position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", m: 0, p: 0 }}
      data-testid="backtest-view"
      id="backtest-main"
    >
      <BacktestToolbar
        strategyLabel={strategyLabel}
        symbolCount={state.selectedSymbols.length}
        days={state.days}
        isRunning={state.isRunning}
        canRun={state.selectedSymbols.length > 0}
        windowState={{
          config: { open: win.windows.config.open, minimized: win.windows.config.minimized },
          results: { open: win.windows.results.open, minimized: win.windows.results.minimized },
          trades: { open: win.windows.trades.open, minimized: win.windows.trades.minimized },
        }}
        onToggleWindow={toggleWindow}
        onRun={actions.handleRunBacktest}
        onReset={resetLayout}
      />

      {/* Full-bleed chart layer — never resizes when windows move */}
      <Box sx={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}>
        {hasResults ? (
          <BacktestChartTabs
            symbols={symbols}
            selectedSymbol={state.selectedChartSymbol}
            onSymbolSelect={setSelectedChartSymbol}
            zoomValue={state.chartOptions.date_range}
            onZoomChange={(value) => setChartOptions({ date_range: value as any })}
            chartDataMap={state.chartData}
            chartLoading={state.chartLoading}
            onTradeClick={actions.handleZoomToTrade}
            holidays={holidayState.holidays}
            selectedTf={actions.selectedTf}
            onTfChange={actions.handleTfChange}
          />
        ) : (
          <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
            <Text c="dimmed" size="sm">
              {state.isRunning ? "Running backtest…" : "Open Config, pick symbols and press Run to see the chart."}
            </Text>
          </Box>
        )}

        {state.isRunning && (
          <Box sx={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 5 }}>
            <BacktestProgress progress={{ current: state.progress.current, total: state.progress.total, message: state.progress.message }} />
          </Box>
        )}

        {state.error && (
          <Box sx={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 6, maxWidth: 560 }}>
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Error"
              color="error"
              variant="filled"
              data-testid="backtest-error"
              withCloseButton
              onClose={() => setError(null)}
            >
              {state.error}
            </Alert>
          </Box>
        )}
      </Box>

      {/* Floating windows */}
      <FloatingWindow
        title="Config"
        testid="window-config"
        geometry={win.windows.config.geometry}
        zIndex={1000 + win.windows.config.z}
        minimized={win.windows.config.minimized}
        minWidth={WINDOW_MIN_SIZES.config.w}
        minHeight={WINDOW_MIN_SIZES.config.h}
        onFocus={() => focusWindow("config")}
        onClose={() => closeWindow("config")}
        onMinimize={() => minimizeWindow("config")}
        onGeometryChange={(g) => setGeometry("config", g)}
      >
        <BacktestConfig
          strategies={state.strategies}
          variations={state.variations}
          selectedStrategy={state.selectedStrategy}
          selectedVariation={state.selectedVariation}
          params={state.params}
          selectedSymbols={state.selectedSymbols}
          days={state.days}
          includeCosts={state.includeCosts}
          isRunning={state.isRunning}
          onStrategyChange={setSelectedStrategy}
          onVariationChange={setSelectedVariation}
          onParamChange={setParam}
          onDaysChange={setDays}
          onIncludeCostsChange={setIncludeCosts}
          onSymbolsChange={setSelectedSymbols}
          onReset={resetBacktestState}
          onRun={actions.handleRunBacktest}
          onRunAndSave={actions.handleRunAndSave}
          saveToHistory={actions.saveToHistory}
          onSaveToHistoryChange={actions.setSaveToHistory}
        />
      </FloatingWindow>

      {hasResults && (
        <FloatingWindow
          title="Results"
          testid="window-results"
          geometry={win.windows.results.geometry}
          zIndex={1000 + win.windows.results.z}
          minimized={win.windows.results.minimized}
          minWidth={WINDOW_MIN_SIZES.results.w}
          minHeight={WINDOW_MIN_SIZES.results.h}
          onFocus={() => focusWindow("results")}
          onClose={() => closeWindow("results")}
          onMinimize={() => minimizeWindow("results")}
          onGeometryChange={(g) => setGeometry("results", g)}
        >
          <BacktestLeftPanel
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isRunning={state.isRunning}
            progress={state.progress}
            results={state.results}
            totals={state.totals}
            selectedChartSymbol={state.selectedChartSymbol}
            sortedResults={actions.sortedResults}
            resultsSortColumn={actions.resultsSort.column}
            resultsSortDirection={actions.resultsSort.direction}
            onRowClick={actions.handleViewChartAndTrades}
            onSort={actions.resultsSort.handleSort}
          />
        </FloatingWindow>
      )}

      {hasTrades && (
        <FloatingWindow
          title={`Trades — ${state.tradeHistorySymbol}`}
          testid="window-trades"
          geometry={win.windows.trades.geometry}
          zIndex={1000 + win.windows.trades.z}
          minimized={win.windows.trades.minimized}
          minWidth={WINDOW_MIN_SIZES.trades.w}
          minHeight={WINDOW_MIN_SIZES.trades.h}
          onFocus={() => focusWindow("trades")}
          onClose={() => closeWindow("trades")}
          onMinimize={() => minimizeWindow("trades")}
          onGeometryChange={(g) => setGeometry("trades", g)}
        >
          <TradeHistoryTable
            symbol={state.tradeHistorySymbol!}
            trades={state.tradeHistory!}
            sortColumn={actions.tradeSort.column}
            sortDirection={actions.tradeSort.direction}
            onSort={actions.tradeSort.handleSort}
            onRowClick={actions.handleZoomToTrade}
            onClose={() => setTradeHistory(null, null)}
          />
        </FloatingWindow>
      )}

      <BacktestWindowTaskbar
        items={(["config", "results", "trades"] as const)
          .filter((id) => win.windows[id].open && win.windows[id].minimized)
          .map((id) => ({
            id,
            title: id === "config" ? "Config" : id === "results" ? "Results" : `Trades${state.tradeHistorySymbol ? ` — ${state.tradeHistorySymbol}` : ""}`,
          }))}
        onRestore={openWindow}
        onClose={closeWindow}
      />
    </Box>
  );
}
