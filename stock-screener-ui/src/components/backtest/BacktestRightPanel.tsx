import { memo } from "react";
import { Flex } from "@/ui";
import type { SymbolChartData, Trade } from "../../types/backtest";
import { BacktestChartTabs, TradeHistoryTable } from "./mantine";

interface BacktestRightPanelProps {
  showCharts: boolean;
  hasResults: boolean;
  symbols: string[];
  selectedSymbol: string | null;
  onSymbolSelect: (symbol: string | null) => void;
  zoomValue: string;
  onZoomChange: (value: string) => void;
  chartDataMap: Map<string, SymbolChartData>;
  chartLoading: boolean;
  onTradeClick: (tradeIndex: number) => void;
  tradeHistory: Trade[] | null;
  tradeHistorySymbol: string | null;
  tradeSortColumn: string;
  tradeSortDirection: "asc" | "desc";
  onTradeSort: (column: string) => void;
  onCloseTradeHistory: () => void;
}

export const BacktestRightPanel = memo(function BacktestRightPanel({
  showCharts,
  hasResults,
  symbols,
  selectedSymbol,
  onSymbolSelect,
  zoomValue,
  onZoomChange,
  chartDataMap,
  chartLoading,
  onTradeClick,
  tradeHistory,
  tradeHistorySymbol,
  tradeSortColumn,
  tradeSortDirection,
  onTradeSort,
  onCloseTradeHistory,
}: BacktestRightPanelProps) {
  if (!showCharts || !hasResults) {
    return null;
  }

  const hasTradeHistory = Boolean(tradeHistory && tradeHistorySymbol);

  return (
    <Flex direction="column" gap="sm" h="100%" style={{ minHeight: 0 }}>
      <Flex
        direction="column"
        style={{
          minHeight: 0,
          flex: hasTradeHistory ? "1 1 50%" : "1 1 100%",
        }}
      >
        <BacktestChartTabs
          symbols={symbols}
          selectedSymbol={selectedSymbol}
          onSymbolSelect={onSymbolSelect}
          zoomValue={zoomValue}
          onZoomChange={(value) => onZoomChange(value as string)}
          chartDataMap={chartDataMap}
          chartLoading={chartLoading}
          onTradeClick={onTradeClick}
        />
      </Flex>
      {hasTradeHistory && (
        <Flex
          direction="column"
          style={{
            minHeight: 0,
            flex: "1 1 50%",
            overflow: "hidden",
          }}
        >
          <TradeHistoryTable
            symbol={tradeHistorySymbol!}
            trades={tradeHistory!}
            sortColumn={tradeSortColumn}
            sortDirection={tradeSortDirection}
            onSort={onTradeSort}
            onRowClick={onTradeClick}
            onClose={onCloseTradeHistory}
          />
        </Flex>
      )}
    </Flex>
  );
});
