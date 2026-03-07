import { Tabs, Select, Group, Text, Box, Flex } from "@mantine/core";
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

const LEGEND_ITEMS = [
  { id: "entry", label: "Entry", color: "#00FFFF" },
  { id: "tp", label: "TP", color: "#FFFF00" },
  { id: "sl", label: "SL", color: "#FF00FF" },
  { id: "eod", label: "EOD", color: "#FFA500" },
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
    <Flex
      data-testid="chart-container"
      h="100%"
      direction="column"
      style={{ overflow: "hidden" }}
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

      <Box flex={1} style={{ minHeight: 0, position: "relative" }}>
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

      <Box
        data-testid="chart-legend"
        mt="xs"
        flex="0 0 auto"
        style={{
          display: "flex",
          gap: "var(--mantine-spacing-md)",
          justifyContent: "center",
        }}
      >
        {LEGEND_ITEMS.map((item) => (
          <Group key={item.id} gap={4} data-testid={`legend-${item.id}`}>
            <Box
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: item.color,
              }}
            />
            <Text size="xs" c="dimmed">
              {item.label}
            </Text>
          </Group>
        ))}
      </Box>
    </Flex>
  );
}
