import { Box, Flex, Tabs } from "@/ui";
import { IconTable, IconHistory } from "@tabler/icons-react";
import {
  BacktestSummary,
  BacktestResultsTable,
  BacktestProgress,
  BacktestHistory,
} from ".";

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
      sx={{ display: "flex", flexDirection: "column" }}
    >
      <Box sx={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Tabs.List>
          <Tabs.Tab value="results" leftSection={<IconTable size={14} />}>
            Results
          </Tabs.Tab>
          <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
            History
          </Tabs.Tab>
        </Tabs.List>
      </Box>

      <Tabs.Panel
        value="results"
        className="backtest-results-panel"
        flex={1}
        sx={{ minHeight: 0, overflow: "hidden" }}
      >
        {isRunning ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
            <BacktestProgress
              progress={{
                current: progress.current,
                total: progress.total,
                message: progress.message,
              }}
            />
          </Box>
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
            sx={{ minHeight: 0, gap: 1 }}
          >
            <Box sx={{ flex: "0 0 auto", display: "flex", alignItems: "center" }}>
              <BacktestSummary totals={totals} />
            </Box>
            <Box flex={1} sx={{ minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
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
        sx={{ minHeight: 0, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}
      >
        <BacktestHistory active={activeTab === "history"} onLoad={() => setActiveTab("results")} />
      </Tabs.Panel>
    </Tabs>
  );
}
