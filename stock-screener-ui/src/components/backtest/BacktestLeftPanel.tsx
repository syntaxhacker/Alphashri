import { Box, Flex, Tabs, Center } from "@/ui";
import { IconTable, IconHistory } from "@tabler/icons-react";
import type { BacktestResult } from "../../types/backtest";
import {
  BacktestResultsTable,
  BacktestSummary,
  BacktestProgress,
  BacktestHistory,
} from "./mantine";

interface BacktestLeftPanelProps {
  activeTab: string | null;
  onTabChange: (tab: string | null) => void;
  isRunning: boolean;
  progress: { current: number; total: number; message: string };
  results: BacktestResult[] | null;
  totals: {
    gross_pnl: number;
    total_costs: number;
    net_pnl: number;
    trades: number;
    win_rate: number;
  } | null;
  selectedChartSymbol: string | null;
  sortedResults: BacktestResult[];
  resultsSortColumn: string;
  resultsSortDirection: "asc" | "desc";
  onResultsSort: (column: string) => void;
  onRowClick: (symbol: string) => void;
}

export function BacktestLeftPanel({
  activeTab,
  onTabChange,
  isRunning,
  progress,
  results,
  totals,
  selectedChartSymbol,
  sortedResults,
  resultsSortColumn,
  resultsSortDirection,
  onResultsSort,
  onRowClick,
}: BacktestLeftPanelProps) {
  return (
    <Tabs
      value={activeTab}
      onChange={onTabChange}
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Tabs.List flex="0 0 auto">
        <Tabs.Tab
          value="results"
          leftSection={<IconTable size={14} />}
          data-testid="backtest-tab-results"
        >
          Results
        </Tabs.Tab>
        <Tabs.Tab
          value="history"
          leftSection={<IconHistory size={14} />}
          data-testid="backtest-tab-history"
        >
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
          <Center h="100%" c="dimmed" data-testid="results-empty">
            No results yet. Run a backtest.
          </Center>
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
                onSort={onResultsSort}
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
        <BacktestHistory active={activeTab === "history"} onLoad={() => onTabChange("results")} />
      </Tabs.Panel>
    </Tabs>
  );
}
