import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Flex, Loader, Select, Text, useColorScheme } from "@/ui";
import {
  fetchRunChart,
  getExperimentState,
} from "../../state/experiments";
import { useExperimentState } from "./useExperimentState";
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
  const state = useExperimentState();
  const selectedRun = () => state().selectedRun;
  const chartData = () => state().chartData;
  const activeSession = () => state().activeSession;
  const loading = () => state().loading;

  let chartHandle: TradingChartHandle | undefined;
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";
  const [symbol, setSymbol] = createSignal<string | null>(
    getExperimentState().selectedRun?.symbols[0] ?? null,
  );
  const [highlightedTradeId, setHighlightedTradeId] = createSignal<number | null>(
    null,
  );

  // Re-seed the symbol/highlight when a different run is selected.
  let prevRunId: number | null = null;
  createEffect(() => {
    const runId = selectedRun()?.run ?? null;
    if (runId !== prevRunId) {
      prevRunId = runId;
      setSymbol(selectedRun()?.symbols[0] ?? null);
      setHighlightedTradeId(null);
    }
  });

  createEffect(() => {
    const s = symbol();
    if (s && chartHandle) {
      chartHandles.set(s, chartHandle);
    }
    highlightCallbacks.set(s ?? "", setHighlightedTradeId);
    onCleanup(() => {
      if (s) chartHandles.delete(s);
      highlightCallbacks.delete(s ?? "");
    });
  });

  const chartInput = createMemo(() => {
    const data = chartData();
    if (!data) return null;
    return normalizeBacktest(data, isDark(), undefined, highlightedTradeId());
  });

  const handleSymbolChange = (value: string | null) => {
    setSymbol(value);
    setHighlightedTradeId(null);
    if (value && selectedRun() && activeSession()) {
      void fetchRunChart(selectedRun()!.run, value);
    }
  };

  const handleTradeClick = (tradeIndex: number) => {
    const s = symbol();
    if (s) zoomToTrade(s, tradeIndex, chartData());
  };

  const mainView = (
    <Box
      data-testid="experiments-chart"
      className="flex items-center justify-center h-full bg-fin-surface rounded-sm p-2"
    >
      <Text c="dimmed" size="sm">
        Select a run to view its chart
      </Text>
    </Box>
  );

  return (
    <Show
      when={selectedRun()}
      fallback={mainView}
      keyed
    >
      {(run) => {
        const symbols = () => run.symbols || [];
        const showChartLoading = () => isLoading(loading(), "chart") && !chartData();
        return (
          <Box
            data-testid="experiments-chart"
            className="flex flex-col min-h-0 h-full bg-fin-surface rounded-sm p-2 gap-2 items-stretch"
          >
            <Box className="flex items-center justify-between gap-2 w-full">
              <Box className="flex items-center gap-2 min-w-0">
                <Text fw={600} size="sm">
                  Run {run.run}
                </Text>
                <Text size="sm" c="dimmed">
                  ·
                </Text>
                <Text size="sm" c="dimmed">
                  {run.strategy}
                </Text>
              </Box>
              <Box className="flex items-center gap-2">
                <Text size="sm" c="dimmed">
                  {run.tf}m
                </Text>
                <Select
                  data-testid="experiments-chart-symbol-select"
                  data={symbols().map((s) => ({ value: s, label: s }))}
                  value={symbol()}
                  onChange={handleSymbolChange}
                  size="sm"
                  searchable
                  w={130}
                />
              </Box>
            </Box>

            <Box className="flex-1 min-h-0 relative w-full">
              <Show
                when={showChartLoading()}
                fallback={
                  <Show
                    when={chartData() && chartInput()}
                    fallback={
                      <Flex
                        align="center"
                        justify="center"
                        h="100%"
                        data-testid="experiments-chart-empty"
                      >
                        <Text c="dimmed" size="sm">
                          No chart data for {symbol() ?? run.run}
                        </Text>
                      </Flex>
                    }
                  >
                    {() => (
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
                        ref={(h: TradingChartHandle | undefined) => (chartHandle = h)}
                        input={chartInput()!}
                        onTradeClick={handleTradeClick}
                      />
                    </Box>
                    )}
                  </Show>
                }
              >
                <Flex
                  align="center"
                  justify="center"
                  h="100%"
                  data-testid="experiments-chart-loading"
                >
                  <Loader size="sm" />
                </Flex>
              </Show>
            </Box>
          </Box>
        );
      }}
    </Show>
  );
}
