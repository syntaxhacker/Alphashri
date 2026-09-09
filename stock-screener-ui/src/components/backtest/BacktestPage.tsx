import { Alert } from "@/ui";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { useBacktestQueryParams } from "../../hooks/useBacktestQueryParams";
import { BacktestConfig } from ".";
import { BacktestLeftPanel, BacktestRightPanel } from "./BacktestPanels";
import { zoomToTrade } from "./BacktestChart";
import {
  getBacktestState,
  subscribe,
  setSelectedChartSymbol,
  setShowCharts,
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
      case "symbol":
        aVal = a.symbol;
        bVal = b.symbol;
        break;
      case "net_pnl":
        aVal = a.net_pnl;
        bVal = b.net_pnl;
        break;
      case "trades":
        aVal = a.trades;
        bVal = b.trades;
        break;
      case "win_rate":
        aVal = a.win_rate;
        bVal = b.win_rate;
        break;
      case "pf":
        aVal = a.pf;
        bVal = b.pf;
        break;
      default:
        return 0;
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
      else {
        setColumn(col);
        setDirection("desc");
      }
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
      else {
        setColumn(col);
        setDirection("desc");
      }
    },
    [column],
  );
  return { column, direction, handleSort };
}

function highlightTradeRow(tradeIndex: number) {
  const row = document.querySelector(`[data-trade-number="${tradeIndex + 1}"]`) as HTMLElement;
  if (!row) {
    return;
  }
  document
    .querySelectorAll(".trade-row-highlighted")
    .forEach((el) => el.classList.remove("trade-row-highlighted"));
  row.classList.add("trade-row-highlighted");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => row.classList.remove("trade-row-highlighted"), 3000);
}

function useBacktestEffects(state: any, setActiveTab: (tab: string | null) => void) {
  useEffect(() => {
    fetchStrategies();
    fetchVariations();
    fetchCosts();
    loadHolidays(2026);
  }, []);

  useEffect(() => {
    if (state.isRunning) setActiveTab("results");
  }, [state.isRunning]);

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

  const handleRunBacktest = useCallback(() => runBacktest(saveToHistory), [saveToHistory]);

  const handleViewChartAndTrades = useCallback((symbol: string) => {
    setShowCharts(true);
    setSelectedChartSymbol(symbol);
    const currentState = getBacktestState();
    const chartData = currentState.chartData.get(symbol);
    if (chartData && chartData.trades && chartData.trades.length > 0) {
      setTradeHistory(chartTradesToTrades(chartData.trades), symbol);
    }
  }, []);

  const handleZoomToTrade = useCallback(
    (tradeIndex: number) => {
      const chartData = state.selectedChartSymbol
        ? state.chartData.get(state.selectedChartSymbol)
        : undefined;
      zoomToTrade(state.selectedChartSymbol || "", tradeIndex, chartData);
      highlightTradeRow(tradeIndex);
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
    saveToHistory,
    setSaveToHistory,
    resultsSort,
    tradeSort,
    sortedResults,
    handleRunBacktest,
    handleViewChartAndTrades,
    handleZoomToTrade,
    selectedTf,
    handleTfChange,
  };
}

function BacktestPageConfig({ state, actions }: { state: any; actions: any }) {
  return (
    <Box sx={{ flex: "0 0 auto", mb: 2, display: "flex", justifyContent: "center" }} id="backtest-config-section">
      <Box sx={{ width: "100%", maxWidth: 1600 }}>
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
          saveToHistory={actions.saveToHistory}
          onSaveToHistoryChange={actions.setSaveToHistory}
        />
      </Box>
    </Box>
  );
}

function BacktestPanels({
  state,
  holidayState,
  actions,
  symbols,
  activeTab,
  setActiveTab,
}: {
  state: any;
  holidayState: any;
  actions: any;
  symbols: string[];
  activeTab: string | null;
  setActiveTab: (tab: string | null) => void;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", flex: 1, minHeight: 0, gap: 2 }} id="backtest-panels">
      <Grid container spacing={2} sx={{ flex: 1, maxWidth: 1600, minHeight: 0, justifyContent: "center", alignItems: "stretch", gap: 2 }}>
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }} id="backtest-left-panel">
            <Card elevation={1} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1, width: "100%" }}>
              <CardContent sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1, "&:last-child": { pb: 1 }, alignItems: "center" }}>
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
              </CardContent>
            </Card>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }} id="backtest-right-panel">
            <Card elevation={1} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1, width: "100%" }}>
              <CardContent sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1, "&:last-child": { pb: 1 }, alignItems: "center" }}>
                <BacktestRightPanel
                  showCharts={state.showCharts}
                  results={state.results}
                  symbols={symbols}
                  selectedChartSymbol={state.selectedChartSymbol}
                  onSymbolSelect={setSelectedChartSymbol}
                  zoomValue={state.chartOptions.date_range}
                  onZoomChange={(value) => setChartOptions({ date_range: value as any })}
                  chartDataMap={state.chartData}
                  chartLoading={state.chartLoading}
                  onTradeClick={actions.handleZoomToTrade}
                  holidays={holidayState.holidays}
                  tradeHistory={state.tradeHistory}
                  tradeHistorySymbol={state.tradeHistorySymbol}
                  tradeSortColumn={actions.tradeSort.column}
                  tradeSortDirection={actions.tradeSort.direction}
                  onTradeSort={actions.tradeSort.handleSort}
                  onTradeRowClick={actions.handleZoomToTrade}
                  onCloseTradeHistory={() => setTradeHistory(null, null)}
                  selectedTf={actions.selectedTf}
                  onTfChange={actions.handleTfChange}
                />
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}

export function BacktestPage() {
  useStoreSubscription(subscribe);
  useStoreSubscription(subscribeToHolidays);
  useBacktestQueryParams();
  const state = getBacktestState();
  const holidayState = getHolidayState();
  const [activeTab, setActiveTab] = useState<string | null>("results");
  const actions = useBacktestActions(state);
  useBacktestEffects(state, setActiveTab);
  const symbols = state.results?.map((r) => r.symbol) ?? [];

  return (
    <Container maxWidth="xl" sx={{ py: 2, display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }} data-testid="backtest-view" id="backtest-main">
      {state.error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="error"
          variant="filled"
          mb="md"
          data-testid="backtest-error"
          withCloseButton
          onClose={setError}
        >
          {state.error}
        </Alert>
      )}
      <BacktestPageConfig state={state} actions={actions} />
      <BacktestPanels
        state={state}
        holidayState={holidayState}
        actions={actions}
        symbols={symbols}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </Container>
  );
}
