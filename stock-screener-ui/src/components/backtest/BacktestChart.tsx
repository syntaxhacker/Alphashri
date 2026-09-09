import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useColorScheme } from "@/ui";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import type { MarketHoliday } from "../../types/holidays";
import { normalizeTime } from "../../utils/ui-helpers";
import { normalizeBacktest } from "../../utils/chart/normalizeBacktest";
import { TradingChart } from "../chart/TradingChart";
import type { TradingChartHandle } from "../chart/TradingChart";

const chartHandles = new Map<string, TradingChartHandle>();
const highlightCallbacks = new Map<string, (id: number | null) => void>();

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  holidays?: MarketHoliday[];
}

function findCandleIdx(
  marker: ChartTrade,
  candleTimeMap: Map<string, number>,
  candleDateMap: Map<string, number>,
): number | undefined {
  if (marker.candle_idx !== undefined) return marker.candle_idx;
  const entryTime = normalizeTime(marker.time);
  let idx = candleTimeMap.get(entryTime);
  if (idx === undefined && marker.date) {
    idx = candleDateMap.get(marker.date);
  }
  return idx;
}

function computeZoomRange(
  chartData: SymbolChartData,
  entryMarker: ChartTrade,
  exitMarker: ChartTrade | undefined,
  entryIdx: number,
  exitIdx: number | undefined,
) {
  const totalCandles = chartData.candles.length;
  const entryDate = entryMarker.date || normalizeTime(entryMarker.time).split("T")[0];
  const exitDate =
    exitMarker?.date || (exitMarker ? normalizeTime(exitMarker.time).split("T")[0] : entryDate);
  const isSameDay = entryDate === exitDate;
  const resolvedExitIdx = exitIdx ?? entryIdx;

  let startIdx: number;
  let endIdx: number;

  if (isSameDay) {
    const dayIndices = chartData.candles
      .map((c, idx) => ({ date: c.date, idx }))
      .filter((item) => item.date === entryDate)
      .map((item) => item.idx);

    if (dayIndices.length > 0) {
      startIdx = dayIndices[0];
      endIdx = dayIndices[dayIndices.length - 1];
    } else {
      const padding = 5;
      startIdx = Math.max(0, entryIdx - padding);
      endIdx = Math.min(totalCandles - 1, resolvedExitIdx + padding);
    }
  } else {
    const padding = 3;
    startIdx = Math.max(0, entryIdx - padding);
    endIdx = Math.min(totalCandles - 1, resolvedExitIdx + padding);
  }

  return { startIdx, endIdx, totalCandles };
}

export function zoomToTrade(
  symbol: string,
  tradeIndex: number,
  chartData: SymbolChartData | undefined,
) {
  if (!chartData) return;

  const handle = chartHandles.get(symbol);
  if (!handle) return;

  const tradeId = tradeIndex + 1;
  const entryMarker = chartData.trades.find((t) => t.type === "entry" && t.trade_id === tradeId);
  const exitMarker = chartData.trades.find((t) => t.type === "exit" && t.trade_id === tradeId);
  if (!entryMarker) return;

  const candleTimeMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]));
  const candleDateMap = new Map<string, number>();
  chartData.candles.forEach((c, i) => {
    if (c.date) candleDateMap.set(c.date, i);
    if (c.date_raw) candleDateMap.set(c.date_raw!, i);
  });

  const entryIdx = findCandleIdx(entryMarker, candleTimeMap, candleDateMap);
  const exitIdx = exitMarker ? findCandleIdx(exitMarker, candleTimeMap, candleDateMap) : undefined;
  if (entryIdx === undefined) return;

  const { startIdx, endIdx, totalCandles } = computeZoomRange(
    chartData,
    entryMarker,
    exitMarker,
    entryIdx,
    exitIdx,
  );

  const cb = highlightCallbacks.get(symbol);
  if (cb) {
    cb(tradeId);
  }

  setTimeout(() => {
    handle.zoomToTradeByIndex(startIdx, endIdx, totalCandles);
  }, 200);
}

export function BacktestChart({
  symbol,
  chartData,
  isLoading,
  onTradeClick,
  holidays,
}: BacktestChartProps) {
  const chartRef = useRef<TradingChartHandle | null>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [highlightedTradeId, setHighlightedTradeId] = useState<number | null>(null);

  useEffect(() => {
    if (chartRef.current) {
      chartHandles.set(symbol, chartRef.current);
    }
    highlightCallbacks.set(symbol, setHighlightedTradeId);
    return () => {
      chartHandles.delete(symbol);
      highlightCallbacks.delete(symbol);
    };
  }, [symbol]);

  const chartInput = useMemo(() => {
    if (!chartData) return null;
    return normalizeBacktest(chartData, isDark, holidays, highlightedTradeId);
  }, [chartData, isDark, holidays, highlightedTradeId]);

  if (isLoading) {
    return (
      <Box
        className="backtest-chart-loading"
        data-testid="backtest-chart-loading"
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: theme.palette.background.paper,
          borderRadius: 2,
        })}
      >
        <Text c="dimmed">Loading {symbol}...</Text>
      </Box>
    );
  }

  if (!chartData || !chartInput) {
    return (
      <Box
        className="backtest-chart-empty"
        data-testid="backtest-chart-empty"
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: theme.palette.background.paper,
          borderRadius: 2,
        })}
      >
        <Text c="dimmed">No chart data for {symbol}</Text>
      </Box>
    );
  }

  return (
    <Box
      id={`backtest-chart-${symbol}`}
      className="backtest-chart"
      data-testid="echarts-container"
      data-symbol={symbol}
      style={{ width: "100%", height: "100%", minHeight: 0, display: "flex" }}
    >
      <TradingChart ref={chartRef} input={chartInput} onTradeClick={onTradeClick} />
    </Box>
  );
}
