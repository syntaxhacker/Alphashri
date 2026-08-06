import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Group, Loader, Select, Text, useColorScheme } from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  fetchRunChart,
  getExperimentState,
  subscribe,
} from "../../state/experiments";
import { isLoading } from "../../utils/loading";
import type { ExperimentChartData } from "../../types/experiments";
import { normalizeTime } from "../../utils/ui-helpers";
import { normalizeBacktest } from "../../utils/chart/normalizeBacktest";
import { TradingChart } from "../chart/TradingChart";
import type { TradingChartHandle } from "../chart/TradingChart";

const chartHandles = new Map<string, TradingChartHandle>();
const highlightCallbacks = new Map<string, (id: number | null) => void>();

export function zoomToTrade(
  symbol: string,
  tradeIndex: number,
  chartData: ExperimentChartData | null | undefined,
) {
  if (!chartData) return;

  const handle = chartHandles.get(symbol);
  if (!handle) return;

  const tradeId = tradeIndex + 1;
  const entryMarker = chartData.trades.find(
    (t) => t.type === "entry" && t.trade_id === tradeId,
  );
  const exitMarker = chartData.trades.find(
    (t) => t.type === "exit" && t.trade_id === tradeId,
  );
  if (!entryMarker) return;

  const timeMap = new Map(
    chartData.candles.map((c, i) => [normalizeTime(c.time), i]),
  );
  const dateMap = new Map<string, number>();
  chartData.candles.forEach((c, i) => {
    if (c.date) dateMap.set(c.date, i);
    if (c.date_raw) dateMap.set(c.date_raw, i);
  });

  let entryIdx = entryMarker.candle_idx;
  if (entryIdx === undefined) {
    entryIdx = timeMap.get(normalizeTime(entryMarker.time));
    if (entryIdx === undefined && entryMarker.date)
      entryIdx = dateMap.get(entryMarker.date);
  }
  if (entryIdx === undefined) return;

  let exitIdx = exitMarker?.candle_idx;
  if (exitIdx === undefined && exitMarker) {
    exitIdx = timeMap.get(normalizeTime(exitMarker.time));
    if (exitIdx === undefined && exitMarker.date)
      exitIdx = dateMap.get(exitMarker.date);
  }
  const resolvedExit = exitIdx ?? entryIdx;

  const totalCandles = chartData.candles.length;
  const startIdx = Math.max(0, entryIdx - 5);
  const endIdx = Math.min(totalCandles - 1, resolvedExit + 5);

  const cb = highlightCallbacks.get(symbol);
  if (cb) cb(tradeId);

  setTimeout(() => {
    handle.zoomToTradeByIndex(startIdx, endIdx, totalCandles);
  }, 200);
}

export function ExperimentsChart() {
  useStoreSubscription(subscribe);
  const { selectedRun, chartData, activeSession, loading } =
    getExperimentState();

  const chartRef = useRef<TradingChartHandle | null>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [symbol, setSymbol] = useState<string | null>(
    selectedRun?.symbols[0] ?? null,
  );
  const [highlightedTradeId, setHighlightedTradeId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setSymbol(selectedRun?.symbols[0] ?? null);
    setHighlightedTradeId(null);
  }, [selectedRun?.run]);

  useEffect(() => {
    if (symbol && chartRef.current) {
      chartHandles.set(symbol, chartRef.current);
    }
    highlightCallbacks.set(symbol ?? "", setHighlightedTradeId);
    return () => {
      if (symbol) chartHandles.delete(symbol);
      highlightCallbacks.delete(symbol ?? "");
    };
  }, [symbol]);

  const chartInput = useMemo(() => {
    if (!chartData) return null;
    return normalizeBacktest(chartData, isDark, undefined, highlightedTradeId);
  }, [chartData, isDark, highlightedTradeId]);

  const handleSymbolChange = (value: string | null) => {
    setSymbol(value);
    setHighlightedTradeId(null);
    if (value && selectedRun && activeSession) {
      void fetchRunChart(selectedRun.run, value);
    }
  };

  const handleTradeClick = (tradeIndex: number) => {
    if (symbol) zoomToTrade(symbol, tradeIndex, chartData);
  };

  if (!selectedRun) {
    return (
      <Flex
        data-testid="experiments-chart"
        align="center"
        justify="center"
        h="100%"
        bg="var(--mantine-color-body)"
        style={{ borderRadius: "var(--mantine-radius-md)" }}
      >
        <Text c="dimmed" size="sm">
          Select a run to view its chart
        </Text>
      </Flex>
    );
  }

  const symbols = selectedRun.symbols || [];
  const showChartLoading = isLoading(loading, "chart") && !chartData;

  return (
    <Box
      data-testid="experiments-chart"
      h="100%"
      bg="var(--mantine-color-body)"
      p="sm"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRadius: "var(--mantine-radius-md)",
      }}
    >
      <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <Text fw={600} size="sm">
            Run {selectedRun.run}
          </Text>
          <Text size="sm" c="dimmed">
            ·
          </Text>
          <Text size="sm" c="dimmed">
            {selectedRun.strategy}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {selectedRun.tf}m
          </Text>
          <Select
            data-testid="experiments-chart-symbol-select"
            data={symbols.map((s) => ({ value: s, label: s }))}
            value={symbol}
            onChange={handleSymbolChange}
            size="sm"
            searchable
            style={{ width: 130 }}
          />
        </Group>
      </Group>

      <Box flex={1} style={{ minHeight: 0, position: "relative" }}>
        {showChartLoading ? (
          <Flex
            align="center"
            justify="center"
            h="100%"
            data-testid="experiments-chart-loading"
          >
            <Loader size="sm" />
          </Flex>
        ) : !chartData || !chartInput ? (
          <Flex
            align="center"
            justify="center"
            h="100%"
            data-testid="experiments-chart-empty"
          >
            <Text c="dimmed" size="sm">
              No chart data for {symbol ?? selectedRun.run}
            </Text>
          </Flex>
        ) : (
          <Box
            data-testid="experiments-chart-body"
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "flex",
            }}
          >
            <TradingChart
              ref={chartRef}
              input={chartInput}
              onTradeClick={handleTradeClick}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
