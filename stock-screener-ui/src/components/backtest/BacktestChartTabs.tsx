import { memo } from "react";
import { Tabs, Select, Group, Text, Box, Center } from "@/ui";
import { BacktestChart } from "./BacktestChart";
import type { SymbolChartData } from "../../types/backtest";
import type { MarketHoliday } from "../../types/holidays";

export interface BacktestChartTabsProps {
  symbols: string[];
  selectedSymbol: string | null;
  onSymbolSelect: (symbol: string) => void;
  zoomValue: string;
  onZoomChange: (value: string) => void;
  chartDataMap: Map<string, SymbolChartData>;
  chartLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  holidays?: MarketHoliday[];
  selectedTf: string | null;
  onTfChange: (tf: string | null) => void;
}

const ZOOM_OPTIONS = [
  { value: "all", label: "All" },
  { value: "30d", label: "30D" },
  { value: "7d", label: "7D" },
  { value: "1d", label: "1D" },
];

const TF_OPTIONS = [
  { value: "", label: "Native" },
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "240", label: "4H" },
  { value: "1440", label: "1D" },
  { value: "10080", label: "1W" },
  { value: "43200", label: "1M" },
];

export const BacktestChartTabs = memo(function BacktestChartTabs({
  symbols,
  selectedSymbol,
  onSymbolSelect,
  zoomValue,
  onZoomChange,
  chartDataMap,
  chartLoading,
  onTradeClick,
  holidays,
  selectedTf,
  onTfChange,
}: BacktestChartTabsProps) {
  if (symbols.length === 0) {
    return (
      <Center
        id="chart-container"
        data-testid="chart-container"
        h={400}
        sx={(theme) => ({ bgcolor: theme.palette.background.paper, borderRadius: 2 })}
      >
        <Text c="dimmed">Select a symbol to view chart</Text>
      </Center>
    );
  }

  const currentChartData = selectedSymbol ? chartDataMap.get(selectedSymbol) : null;

  return (
    <Box
      id="chart-container"
      data-testid="chart-container"
      h="100%"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Box mb="xs" flex="0 0 auto" data-testid="chart-tabs-header" sx={{ p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Tabs
              value={selectedSymbol}
              onChange={(value) => value && onSymbolSelect(value)}
              data-testid="chart-tabs"
            >
              <Tabs.List sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                {symbols.map((symbol) => (
                  <Tabs.Tab key={symbol} value={symbol} data-testid={`chart-tab-${symbol}`}>
                    {symbol}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          </Box>

          <Group gap={1} align="center" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Select
              data-testid="chart-tf-select"
              value={selectedTf}
              onChange={(value) => onTfChange(value)}
              data={TF_OPTIONS}
              w={80}
              size="sm"
              clearable
            />
            <Select
              id="chart-zoom-select"
              value={zoomValue}
              onChange={(value) => value && onZoomChange(value)}
              data={ZOOM_OPTIONS}
              data-testid="chart-zoom-select"
              w={80}
              size="sm"
            />
          </Group>
        </Box>
      </Box>

      <Box
        flex={1}
        data-testid="chart-tabs-content"
        style={{ minHeight: 0, position: "relative", overflow: "hidden" }}
      >
        {selectedSymbol ? (
          <BacktestChart
            symbol={selectedSymbol}
            chartData={currentChartData}
            isLoading={chartLoading && !currentChartData}
            onTradeClick={onTradeClick}
            holidays={holidays}
          />
        ) : (
          <Center
            data-testid="chart-placeholder"
            h="100%"
            sx={(theme) => ({ bgcolor: theme.palette.background.paper, borderRadius: 2 })}
          >
            <Text c="dimmed">Select a symbol</Text>
          </Center>
        )}
      </Box>
    </Box>
  );
});
