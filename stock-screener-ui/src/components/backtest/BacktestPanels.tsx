import { Tabs, Box, Flex } from "@/ui";
import * as palette from "@/ui/palette";
import { IconTable, IconHistory } from "@/components/common/Icons";
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

export function BacktestLeftPanel(props: BacktestLeftPanelProps) {
  return (
    <Tabs
      value={props.activeTab}
      onChange={props.setActiveTab}
      h="100%"
      className="flex flex-col"
    >
      <Box className="shrink-0 flex items-center justify-center p-2" style={{ flex: "0 0 auto", display: "flex", "align-items": "center", "justify-content": "center", padding: "8px" }}>
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
        className="backtest-results-panel min-h-0 overflow-hidden"
        flex={1}
        style={{ "min-height": 0, overflow: "hidden" }}
      >
        {props.isRunning ? (
          <Box className="flex items-center justify-center p-2" style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: "16px" }}>
            <BacktestProgress
              progress={{
                current: props.progress.current,
                total: props.progress.total,
                message: props.progress.message,
              }}
            />
          </Box>
        ) : !props.results || props.results.length === 0 ? (
          <Box
            className="flex items-center justify-center h-full"
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              height: "100%",
              color: palette.TEXT_MUTED,
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
            className="backtest-results-content min-h-0 gap-2"
            style={{ "min-height": 0, gap: "8px" }}
          >
            <Box className="shrink-0 flex items-center" style={{ flex: "0 0 auto", display: "flex", "align-items": "center" }}>
              <BacktestSummary totals={props.totals} />
            </Box>
            <Box flex={1} className="min-h-0 overflow-auto flex flex-col" style={{ "min-height": 0, overflow: "auto", display: "flex", "flex-direction": "column" }}>
              <BacktestResultsTable
                results={props.sortedResults}
                selectedSymbol={props.selectedChartSymbol}
                sortColumn={props.resultsSortColumn}
                sortDirection={props.resultsSortDirection}
                onRowClick={props.onRowClick}
                onSort={props.onSort}
              />
            </Box>
          </Flex>
        )}
      </Tabs.Panel>

      <Tabs.Panel
        value="history"
        className="backtest-history-panel min-h-0 min-w-0 overflow-auto flex flex-col"
        flex={1}
        style={{ "min-height": 0, "min-width": 0, overflow: "auto", display: "flex", "flex-direction": "column" }}
      >
        <BacktestHistory active={props.activeTab === "history"} onLoad={() => props.setActiveTab("results")} />
      </Tabs.Panel>
    </Tabs>
  );
}
