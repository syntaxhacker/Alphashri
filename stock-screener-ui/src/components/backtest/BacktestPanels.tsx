import { Box, Flex, Tabs } from "@/ui";
import { IconTable, IconHistory } from "@tabler/icons-react";
import {
  BacktestSummary,
  BacktestResultsTable,
  BacktestProgress,
  BacktestHistory,
  BacktestChartTabs,
  TradeHistoryTable,
} from "./mantine";

interface BacktestLeftPanelProps {
  activeTab: string | null;
  setActiveTab: (tab: string | null) => void;
  isRunning: boolean;
  progress: { current: number; total: number; message: string };
  results: any[] | null;
  totals: any;
  selectedChartSymbol: string | null;
  sortedResults: any[];
  resultsSortColumn: string;
  resultsSortDirection: "asc" | "desc";
  onRowClick: (symbol: string) => void;
  onSort: (column: string) => void;
}

export function BacktestLeftPanel({
  activeTab,
  setActiveTab,
  isRunning,
  progress,
  results,
  totals,
  selectedChartSymbol,
  sortedResults,
  resultsSortColumn,
  resultsSortDirection,
  onRowClick,
  onSort,
}: BacktestLeftPanelProps) {
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
        {isRunning ? (
          <BacktestProgress
            progress={{
              current: progress.current,
              total: progress.total,
              message: progress.message,
            }}
          />
        ) : !results || results.length === 0 ? (
          <Box
            sx={(theme) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.palette.text.secondary,
            })}
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
              <BacktestSummary totals={totals} />
            </Box>
            <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
              <BacktestResultsTable
                results={sortedResults}
                selectedSymbol={selectedChartSymbol}
                sortColumn={resultsSortColumn}
                sortDirection={resultsSortDirection}
                onRowClick={onRowClick}
                onSort={onSort}
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
        <BacktestHistory active={activeTab === "history"} onLoad={() => setActiveTab("results")} />
      </Tabs.Panel>
    </Tabs>
  );
}

interface BacktestRightPanelProps {
  showCharts: boolean;
  results: any[] | null;
  symbols: string[];
  selectedChartSymbol: string | null;
  onSymbolSelect: (symbol: string | null) => void;
  zoomValue: any;
  onZoomChange: (value: any) => void;
  chartDataMap: Map<string, any>;
  chartLoading: string | null;
  onTradeClick: (tradeIndex: number) => void;
  holidays: any[];
  tradeHistory: any[] | null;
  tradeHistorySymbol: string | null;
  tradeSortColumn: string;
  tradeSortDirection: "asc" | "desc";
  onTradeSort: (column: string) => void;
  onTradeRowClick: (tradeIndex: number) => void;
  onCloseTradeHistory: () => void;
  selectedTf: string | null;
  onTfChange: (tf: string | null) => void;
}

export function BacktestRightPanel({
  showCharts,
  results,
  symbols,
  selectedChartSymbol,
  onSymbolSelect,
  zoomValue,
  onZoomChange,
  chartDataMap,
  chartLoading,
  onTradeClick,
  holidays,
  tradeHistory,
  tradeHistorySymbol,
  tradeSortColumn,
  tradeSortDirection,
  onTradeSort,
  onTradeRowClick,
  onCloseTradeHistory,
  selectedTf,
  onTfChange,
}: BacktestRightPanelProps) {
  if (!showCharts || !results || results.length === 0) {
    return null;
  }

  const hasTradeHistory = Boolean(tradeHistory && tradeHistorySymbol);

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
          selectedSymbol={selectedChartSymbol}
          onSymbolSelect={onSymbolSelect}
          zoomValue={zoomValue}
          onZoomChange={onZoomChange}
          chartDataMap={chartDataMap}
          chartLoading={!!chartLoading}
          onTradeClick={onTradeClick}
          holidays={holidays}
          selectedTf={selectedTf}
          onTfChange={onTfChange}
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
            symbol={tradeHistorySymbol!}
            trades={tradeHistory!}
            sortColumn={tradeSortColumn}
            sortDirection={tradeSortDirection}
            onSort={onTradeSort}
            onRowClick={onTradeRowClick}
            onClose={onCloseTradeHistory}
          />
        </Box>
      )}
    </Flex>
  );
}
