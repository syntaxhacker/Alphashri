import { Box, Flex, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { BacktestConfig } from "./mantine";
import { BacktestLeftPanel } from "./BacktestLeftPanel";
import { BacktestRightPanel } from "./BacktestRightPanel";
import { zoomToTrade } from "./BacktestChart";
import type { BacktestResult } from "../../types/backtest";
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
import { runBacktest, fetchStrategies, fetchCosts, fetchVariations } from "../../api/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";

function useSortedResults(
  results: BacktestResult[] | null,
  sortColumn: string,
  sortDirection: "asc" | "desc",
) {
  return useMemo(() => {
    if (!results) return [];
    return [...results].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortColumn) {
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
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [results, sortColumn, sortDirection]);
}

function useSortHandler(
  columnState: [string, React.Dispatch<React.SetStateAction<string>>],
  directionState: ["asc" | "desc", React.Dispatch<React.SetStateAction<"asc" | "desc">>],
) {
  const [column, setColumn] = columnState;
  const [direction, setDirection] = directionState;
  return useCallback(
    (col: string) => {
      if (column === col) {
        setDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setColumn(col);
        setDirection("desc");
      }
    },
    [column, setColumn, setDirection],
  );
}

function useBacktestEffects(state: ReturnType<typeof getBacktestState>) {
  const [activeTab, setActiveTab] = useState<string | null>("results");

  useEffect(() => {
    fetchStrategies();
    fetchVariations();
    fetchCosts();
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

  return { activeTab, setActiveTab };
}

function useBacktestPageState() {
  const state = getBacktestState();
  const [resultsSortColumn, setResultsSortColumn] = useState("net_pnl");
  const [resultsSortDirection, setResultsSortDirection] = useState<"asc" | "desc">("desc");
  const [tradeSortColumn, setTradeSortColumn] = useState("entry_time");
  const [tradeSortDirection, setTradeSortDirection] = useState<"asc" | "desc">("desc");
  const [saveToHistory, setSaveToHistory] = useState(true);

  const { activeTab, setActiveTab } = useBacktestEffects(state);
  const sortedResults = useSortedResults(state.results, resultsSortColumn, resultsSortDirection);
  const handleResultsSort = useSortHandler(
    [resultsSortColumn, setResultsSortColumn],
    [resultsSortDirection, setResultsSortDirection],
  );
  const handleTradeSort = useSortHandler(
    [tradeSortColumn, setTradeSortColumn],
    [tradeSortDirection, setTradeSortDirection],
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
      const row = document.querySelector(`[data-trade-number="${tradeIndex + 1}"]`) as HTMLElement;
      if (row) {
        document
          .querySelectorAll(".trade-row-highlighted")
          .forEach((el) => el.classList.remove("trade-row-highlighted"));
        row.classList.add("trade-row-highlighted");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => row.classList.remove("trade-row-highlighted"), 3000);
      }
    },
    [state.selectedChartSymbol, state.chartData],
  );

  const handleCloseTradeHistory = useCallback(() => setTradeHistory(null, null), []);
  const handleClearError = useCallback(() => setError(null), []);
  const handleVariationChange = useCallback(
    (variationId: string | null) => setSelectedVariation(variationId),
    [],
  );
  const symbols = state.results?.map((r) => r.symbol) ?? [];

  return {
    state,
    activeTab,
    setActiveTab,
    saveToHistory,
    setSaveToHistory,
    sortedResults,
    symbols,
    handleRunBacktest,
    handleResultsSort,
    handleTradeSort,
    handleViewChartAndTrades,
    handleZoomToTrade,
    handleCloseTradeHistory,
    handleClearError,
    handleVariationChange,
  };
}

function BacktestConfigSection({
  state,
  saveToHistory,
  setSaveToHistory,
  handleRunBacktest,
  handleVariationChange,
}: ReturnType<typeof useBacktestPageState>) {
  return (
    <Box id="backtest-config-section" className="backtest-config-section" flex="0 0 auto" mb="md">
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
        onVariationChange={handleVariationChange}
        onParamChange={setParam}
        onDaysChange={setDays}
        onIncludeCostsChange={setIncludeCosts}
        onSymbolsChange={setSelectedSymbols}
        onReset={resetBacktestState}
        onRun={handleRunBacktest}
        saveToHistory={saveToHistory}
        onSaveToHistoryChange={setSaveToHistory}
      />
    </Box>
  );
}

function BacktestPanels(state: ReturnType<typeof useBacktestPageState>) {
  return (
    <Flex
      id="backtest-panels"
      className="backtest-panels"
      flex={1}
      gap="md"
      style={{ minHeight: 0 }}
    >
      <Box
        id="backtest-left-panel"
        className="backtest-left-panel"
        style={{ flex: "0 0 33.333%", minHeight: 0 }}
      >
        <BacktestLeftPanel
          activeTab={state.activeTab}
          onTabChange={state.setActiveTab}
          isRunning={state.state.isRunning}
          progress={state.state.progress}
          results={state.state.results}
          totals={state.state.totals}
          selectedChartSymbol={state.state.selectedChartSymbol}
          sortedResults={state.sortedResults}
          resultsSortColumn=""
          resultsSortDirection="desc"
          onResultsSort={state.handleResultsSort}
          onRowClick={state.handleViewChartAndTrades}
        />
      </Box>
      <Box
        id="backtest-right-panel"
        className="backtest-right-panel"
        style={{ flex: "1 1 66.666%", minHeight: 0 }}
      >
        <BacktestRightPanel
          showCharts={state.state.showCharts}
          hasResults={Boolean(state.state.results && state.state.results.length > 0)}
          symbols={state.symbols}
          selectedSymbol={state.state.selectedChartSymbol}
          onSymbolSelect={setSelectedChartSymbol}
          zoomValue={state.state.chartOptions.date_range}
          onZoomChange={(value) => setChartOptions({ date_range: value as any })}
          chartDataMap={state.state.chartData}
          chartLoading={state.state.chartLoading}
          onTradeClick={state.handleZoomToTrade}
          tradeHistory={state.state.tradeHistory}
          tradeHistorySymbol={state.state.tradeHistorySymbol}
          tradeSortColumn=""
          tradeSortDirection="desc"
          onTradeSort={state.handleTradeSort}
          onCloseTradeHistory={state.handleCloseTradeHistory}
        />
      </Box>
    </Flex>
  );
}

export function BacktestPage() {
  useStoreSubscription(subscribe);
  const pageState = useBacktestPageState();

  return (
    <Box
      id="backtest-main"
      className="backtest-page"
      h="100%"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "var(--mantine-spacing-md)",
        minHeight: 0,
        overflow: "hidden",
      }}
      data-testid="backtest-view"
    >
      {pageState.state.error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="filled"
          mb="md"
          data-testid="backtest-error"
          withCloseButton
          onClose={pageState.handleClearError}
        >
          {pageState.state.error}
        </Alert>
      )}

      <BacktestConfigSection {...pageState} />
      <BacktestPanels {...pageState} />
    </Box>
  );
}
