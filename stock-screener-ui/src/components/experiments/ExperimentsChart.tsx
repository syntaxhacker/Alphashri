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
      <Box
        data-testid="experiments-chart"
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", bgcolor: "background.paper", borderRadius: 1, p: 1 }}
      >
        <Text c="dimmed" size="sm">
          Select a run to view its chart
        </Text>
      </Box>
    );
  }

  const symbols = selectedRun.symbols || [];
  const showChartLoading = isLoading(loading, "chart") && !chartData;

  return (
    <Box
      data-testid="experiments-chart"
      sx={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", bgcolor: "background.paper", borderRadius: 1, p: 1, gap: 1, alignItems: "center" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, width: "100%", p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          <Text fw={600} size="sm">
            Run {selectedRun.run}
          </Text>
          <Text size="sm" c="dimmed">
            ·
          </Text>
          <Text size="sm" c="dimmed">
            {selectedRun.strategy}
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
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
            sx={{ width: 130 }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: "relative", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
