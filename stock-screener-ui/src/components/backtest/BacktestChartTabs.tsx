import { For } from "solid-js";
import { Tabs, Select, Text, Center } from "@/ui";
import { BacktestChart } from "./BacktestChart";
import type { SymbolChartData } from "../../types/backtest";
import type { MarketHoliday } from "../../types/holidays";
import { Group, Box } from "../paper-trading/primitives";

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

export function BacktestChartTabs({
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
        className="rounded-fin"
        style={{ "background-color": "#0A0A0A", "border-radius": 2 }}
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
      style={{ display: "flex", "flex-direction": "column", "min-height": 0, "min-width": 0, overflow: "hidden" }}
    >
      <Box mb={1} flex="0 0 auto" data-testid="chart-tabs-header" p={1}>
        <Box className="flex items-center justify-between gap-2 p-2">
          <Box className="flex items-center justify-center">
            <Tabs
              value={selectedSymbol}
              onChange={(value) => value && onSymbolSelect(value)}
              data-testid="chart-tabs"
            >
              <Tabs.List className="flex items-center justify-center gap-2">
                <For each={symbols}>{(symbol) => (
                  <Tabs.Tab key={symbol} value={symbol} data-testid={`chart-tab-${symbol}`}>
                    {symbol}
                  </Tabs.Tab>
                )}</For>
              </Tabs.List>
            </Tabs>
          </Box>

          <Group gap={1} align="center" className="flex items-center gap-2">
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
        style={{ "min-height": 0, "min-width": 0, position: "relative", overflow: "hidden" }}
      >
        {selectedSymbol ? (
          <BacktestChart
            symbol={selectedSymbol}
            chartData={currentChartData}
            isLoading={chartLoading && !currentChartData}
            onTradeClick={onTradeClick}
            holidays={holidays}
            zoomValue={zoomValue}
          />
        ) : (
          <Center
            data-testid="chart-placeholder"
            h="100%"
            className="rounded-fin"
            style={{ "background-color": "#0A0A0A", "border-radius": 2 }}
          >
            <Text c="dimmed">Select a symbol</Text>
          </Center>
        )}
      </Box>
    </Box>
  );
}
