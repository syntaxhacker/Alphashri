import { Tabs, Select, Group, Text, Box } from "@mantine/core";
import { BacktestChart } from "./BacktestChart";
import type { SymbolChartData } from "../../types/backtest";

export interface BacktestChartTabsProps {
  symbols: string[];
  selectedSymbol: string | null;
  onSymbolSelect: (symbol: string) => void;
  zoomValue: string;
  onZoomChange: (value: string) => void;
  chartDataMap: Map<string, SymbolChartData>;
  chartLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
}

const ZOOM_OPTIONS = [
  { value: "all", label: "All" },
  { value: "30d", label: "30D" },
  { value: "7d", label: "7D" },
  { value: "1d", label: "1D" },
];

export function BacktestChartTabs({
  symbols,
  selectedSymbol,
  onSymbolSelect,
  zoomValue,
  onZoomChange,
  chartDataMap,
  chartLoading,
  onTradeClick,
}: BacktestChartTabsProps) {
  if (symbols.length === 0) {
    return (
      <Box
        data-testid="chart-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 400,
          backgroundColor: "var(--mantine-color-dark-6)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">Select a symbol to view chart</Text>
      </Box>
    );
  }

  const currentChartData = selectedSymbol ? chartDataMap.get(selectedSymbol) : null;

  return (
    <Box
      data-testid="chart-container"
      h="100%"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Box mb="xs" flex="0 0 auto">
        <Group justify="space-between" align="center">
          <Tabs
            value={selectedSymbol}
            onChange={(value) => value && onSymbolSelect(value)}
            data-testid="chart-tabs"
          >
            <Tabs.List>
              {symbols.map((symbol) => (
                <Tabs.Tab key={symbol} value={symbol} data-testid={`chart-tab-${symbol}`}>
                  {symbol}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          <Select
            value={zoomValue}
            onChange={(value) => value && onZoomChange(value)}
            data={ZOOM_OPTIONS}
            data-testid="chart-zoom-select"
            w={100}
            size="xs"
          />
        </Group>
      </Box>

      <Box flex={1} style={{ minHeight: 0, position: "relative", overflow: "hidden" }}>
        {selectedSymbol ? (
          <BacktestChart
            symbol={selectedSymbol}
            chartData={currentChartData}
            isLoading={chartLoading && !currentChartData}
            onTradeClick={onTradeClick}
          />
        ) : (
          <Box
            data-testid="chart-placeholder"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              backgroundColor: "var(--mantine-color-dark-6)",
              borderRadius: "var(--mantine-radius-md)",
            }}
          >
            <Text c="dimmed">Select a symbol</Text>
          </Box>
        )}
      </Box>

    </Box>
  );
}
