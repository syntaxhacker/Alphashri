import { Box, Flex, Alert, Tabs } from "@mantine/core";
import { IconAlertCircle, IconTable, IconHistory } from "@tabler/icons-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  BacktestConfig,
  BacktestResultsTable,
  BacktestSummary,
  BacktestProgress,
  BacktestChartTabs,
  TradeHistoryTable,
  BacktestHistory,
} from "./mantine";
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
import { runBacktest, fetchStrategies, fetchCosts, fetchVariations } from "../../api/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";


export function BacktestPage() {
  useStoreSubscription(subscribe);
  const state = getBacktestState();
  const [resultsSortColumn, setResultsSortColumn] = useState("net_pnl");
  const [resultsSortDirection, setResultsSortDirection] = useState<"asc" | "desc">("desc");
  const [tradeSortColumn, setTradeSortColumn] = useState("entry_time");
  const [tradeSortDirection, setTradeSortDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<string | null>("results");
  const [saveToHistory, setSaveToHistory] = useState(true);

  useStoreSubscription(subscribe);

  useEffect(() => {
    fetchStrategies();
    fetchVariations();
    fetchCosts();
  }, []);

  // Switch to results tab when a backtest starts running
  useEffect(() => {
    if (state.isRunning) {
      setActiveTab("results");
    }
  }, [state.isRunning]);

  // Auto-select first symbol when results load
  useEffect(() => {
    if (state.results && state.results.length > 0 && !state.selectedChartSymbol) {
      const firstSymbol = state.results[0].symbol;
      setSelectedChartSymbol(firstSymbol);

      // Also update trade history for the first symbol
      const chartData = state.chartData.get(firstSymbol);
      if (chartData && chartData.trades && chartData.trades.length > 0) {
        const trades = chartTradesToTrades(chartData.trades);
        setTradeHistory(trades, firstSymbol);
      }
    }
  }, [state.results, state.selectedChartSymbol, state.chartData]);

  const sortedResults = useMemo(() => {
    if (!state.results) return [];
    return [...state.results].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (resultsSortColumn) {
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
        return resultsSortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return resultsSortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [state.results, resultsSortColumn, resultsSortDirection]);

  const handleRunBacktest = useCallback(() => {
    runBacktest(saveToHistory);
  }, [saveToHistory]);

  const handleResultsSort = useCallback(
    (column: string) => {
      if (resultsSortColumn === column) {
        setResultsSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setResultsSortColumn(column);
        setResultsSortDirection("desc");
      }
    },
    [resultsSortColumn],
  );

  const handleTradeSort = useCallback(
    (column: string) => {
      if (tradeSortColumn === column) {
        setTradeSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setTradeSortColumn(column);
        setTradeSortDirection("desc");
      }
    },
    [tradeSortColumn],
  );

  const handleViewChartAndTrades = useCallback((symbol: string) => {
    setShowCharts(true);
    setSelectedChartSymbol(symbol);

    // Update trade history for the selected symbol using latest state
    const currentState = getBacktestState();
    const chartData = currentState.chartData.get(symbol);
    if (chartData && chartData.trades && chartData.trades.length > 0) {
      const trades = chartTradesToTrades(chartData.trades);
      setTradeHistory(trades, symbol);
    }
  }, []);

  const handleZoomToTrade = useCallback(
    (tradeIndex: number) => {
      console.log("handleZoomToTrade called with tradeIndex:", tradeIndex);

      // Zoom the chart
      const chartData = state.selectedChartSymbol
        ? state.chartData.get(state.selectedChartSymbol)
        : undefined;
      zoomToTrade(state.selectedChartSymbol || "", tradeIndex, chartData);

      // Scroll to and highlight the trade row in the table
      const row = document.querySelector(`[data-trade-number="${tradeIndex + 1}"]`) as HTMLElement;

      if (row) {
        console.log("Found trade row:", row);

        // Remove previous highlight
        document.querySelectorAll(".trade-row-highlighted").forEach((el) => {
          el.classList.remove("trade-row-highlighted");
        });

        // Add highlight class
        row.classList.add("trade-row-highlighted");

        // Scroll into view
        row.scrollIntoView({ behavior: "smooth", block: "center" });

        // Remove highlight after 3 seconds
        setTimeout(() => {
          row.classList.remove("trade-row-highlighted");
        }, 3000);
      } else {
        console.log("Trade row not found for trade number:", tradeIndex + 1);
      }
    },
    [state.selectedChartSymbol, state.chartData],
  );

  const handleCloseTradeHistory = useCallback(() => {
    setTradeHistory(null, null);
  }, []);

  const handleClearError = useCallback(() => {
    setError(null);
  }, []);

  const handleVariationChange = useCallback((variationId: string | null) => {
    setSelectedVariation(variationId);
  }, []);

  const symbols = state.results?.map((r) => r.symbol) ?? [];

  const renderLeftPanel = () => {
    return (
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        h="100%"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <Tabs.List flex="0 0 auto">
          <Tabs.Tab value="results" leftSection={<IconTable size={14} />}>
            Results
          </Tabs.Tab>
          <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
            History
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel
          value="results"
          className="backtest-results-panel"
          flex={1}
          style={{ minHeight: 0, overflow: "hidden" }}
        >
          {state.isRunning ? (
            <BacktestProgress
              progress={{
                current: state.progress.current,
                total: state.progress.total,
                message: state.progress.message,
              }}
            />
          ) : !state.results || state.results.length === 0 ? (
            <Box
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--mantine-color-dimmed)",
              }}
              data-testid="results-empty"
            >
              No results yet. Run a backtest.
            </Box>
          ) : (
            <Flex
              direction="column"
              gap="xs"
              h="100%"
              className="backtest-results-content"
              style={{ minHeight: 0 }}
            >
              <Box style={{ flex: "0 0 auto" }}>
                <BacktestSummary totals={state.totals} />
              </Box>
              <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
                <BacktestResultsTable
                  results={sortedResults}
                  selectedSymbol={state.selectedChartSymbol}
                  sortColumn={resultsSortColumn}
                  sortDirection={resultsSortDirection}
                  onRowClick={handleViewChartAndTrades}
                  onSort={handleResultsSort}
                />
              </Box>
            </Flex>
          )}
        </Tabs.Panel>

        <Tabs.Panel
          value="history"
          className="backtest-history-panel"
          flex={1}
          style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          <BacktestHistory
            active={activeTab === "history"}
            onLoad={() => setActiveTab("results")}
          />
        </Tabs.Panel>
      </Tabs>
    );
  };

  const renderRightPanel = () => {
    if (!state.showCharts || !state.results || state.results.length === 0) {
      return null;
    }

    const hasTradeHistory = Boolean(state.tradeHistory && state.tradeHistorySymbol);

    return (
      <Flex direction="column" gap="sm" h="100%" style={{ minHeight: 0 }}>
        <Box
          style={{
            minHeight: 0,
            flex: hasTradeHistory ? "1 1 50%" : "1 1 100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <BacktestChartTabs
            symbols={symbols}
            selectedSymbol={state.selectedChartSymbol}
            onSymbolSelect={setSelectedChartSymbol}
            zoomValue={state.chartOptions.date_range}
            onZoomChange={(value) => setChartOptions({ date_range: value as any })}
            chartDataMap={state.chartData}
            chartLoading={state.chartLoading}
            onTradeClick={handleZoomToTrade}
          />
        </Box>
        {hasTradeHistory && (
          <Box
            style={{
              minHeight: 0,
              flex: "1 1 50%",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <TradeHistoryTable
              symbol={state.tradeHistorySymbol!}
              trades={state.tradeHistory!}
              sortColumn={tradeSortColumn}
              sortDirection={tradeSortDirection}
              onSort={handleTradeSort}
              onRowClick={handleZoomToTrade}
              onClose={handleCloseTradeHistory}
            />
          </Box>
        )}
      </Flex>
    );
  };

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
      {state.error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="filled"
          mb="md"
          data-testid="backtest-error"
          withCloseButton
          onClose={handleClearError}
        >
          {state.error}
        </Alert>
      )}

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
          {renderLeftPanel()}
        </Box>
        <Box
          id="backtest-right-panel"
          className="backtest-right-panel"
          style={{ flex: "1 1 66.666%", minHeight: 0 }}
        >
          {renderRightPanel()}
        </Box>
      </Flex>
    </Box>
  );
}
