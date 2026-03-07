import { Box, Stack, Alert, Grid, Flex } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BacktestConfig,
  BacktestResultsTable,
  BacktestSummary,
  BacktestProgress,
  BacktestChartTabs,
  TradeHistoryTable,
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
  setParam,
  setDays,
  setIncludeCosts,
  addSymbol,
  removeSymbol,
  resetBacktestState,
} from "../../state/backtest";
import { runBacktest, fetchStrategies, fetchCosts } from "../../api/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";
import type { BacktestState } from "../../state/backtest";

export function BacktestPage() {
  const [state, setState] = useState<BacktestState>(getBacktestState);
  const [resultsSortColumn, setResultsSortColumn] = useState("net_pnl");
  const [resultsSortDirection, setResultsSortDirection] = useState<"asc" | "desc">("desc");
  const [tradeSortColumn, setTradeSortColumn] = useState("entry_time");
  const [tradeSortDirection, setTradeSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setState(getBacktestState());
    });
    fetchStrategies();
    fetchCosts();
    return () => {
      unsubscribe();
    };
  }, []);

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
    runBacktest();
  }, []);

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

  const symbols = state.results?.map((r) => r.symbol) ?? [];

  const renderLeftPanel = () => {
    if (state.isRunning) {
      return (
        <BacktestProgress
          progress={{
            current: state.progress.current,
            total: state.progress.total,
            message: state.progress.message,
          }}
        />
      );
    }

    if (!state.results || state.results.length === 0) {
      return (
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
      );
    }

    return (
      <Stack gap="xs" style={{ flex: 1, minHeight: 0, height: "100%" }}>
        <BacktestSummary totals={state.totals} />
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
      </Stack>
    );
  };

  const renderRightPanel = () => {
    if (!state.showCharts || !state.results || state.results.length === 0) {
      return null;
    }

    return (
      <Stack gap="xs" style={{ flex: 1, minHeight: 0, height: "100%" }}>
        <Flex direction="column" style={{ minHeight: 0, flex: "1 1 55%" }}>
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
        </Flex>
        {state.tradeHistory && state.tradeHistorySymbol && (
          <Box style={{ minHeight: 0, flex: "1 1 45%" }}>
            <TradeHistoryTable
              symbol={state.tradeHistorySymbol}
              trades={state.tradeHistory}
              sortColumn={tradeSortColumn}
              sortDirection={tradeSortDirection}
              onSort={handleTradeSort}
              onRowClick={handleZoomToTrade}
              onClose={handleCloseTradeHistory}
            />
          </Box>
        )}
      </Stack>
    );
  };

  return (
    <Box
      style={{
        height: "calc(100vh - var(--app-shell-header-height, 40px) - var(--mantine-spacing-md) * 2)",
        display: "flex",
        flexDirection: "column",
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

      <Box flex="0 0 auto" mb="md">
        <BacktestConfig
          strategies={state.strategies}
          selectedStrategy={state.selectedStrategy}
          params={state.params}
          selectedSymbols={state.selectedSymbols}
          days={state.days}
          includeCosts={state.includeCosts}
          isRunning={state.isRunning}
          onStrategyChange={setSelectedStrategy}
          onParamChange={setParam}
          onDaysChange={setDays}
          onIncludeCostsChange={setIncludeCosts}
          onSymbolAdd={addSymbol}
          onSymbolRemove={removeSymbol}
          onReset={resetBacktestState}
          onRun={handleRunBacktest}
        />
      </Box>

      <Box flex={1} style={{ minHeight: 0 }}>
        <Grid h="100%" gutter="md">
          <Grid.Col span={4} style={{ display: "flex", flexDirection: "column" }}>
            <Box style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {renderLeftPanel()}
            </Box>
          </Grid.Col>
          <Grid.Col span={8} style={{ display: "flex", flexDirection: "column" }}>
            <Box style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {renderRightPanel()}
            </Box>
          </Grid.Col>
        </Grid>
      </Box>
    </Box>
  );
}
