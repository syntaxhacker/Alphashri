import { useEffect, useMemo, useRef } from "react";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import type { MarketHoliday } from "../../types/holidays";
import { normalizeTime } from "../../utils/ui-helpers";
import { normalizeBacktest, getBacktestZoomStartIndex } from "../../utils/chart/normalizeBacktest";
import type { MarkLineData } from "../../utils/chart/types";
import { TradingViewChart } from "../chart/TradingViewChart";
import type { TradingViewChartHandle } from "../chart/TradingViewChart";
import type { ReplayTrade } from "../../types/replay";
import {
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  PIVOT_52W_HIGH,
  PIVOT_PP,
  PIVOT_R1,
  PIVOT_S1,
} from "../../config/colors";

const chartHandles = new Map<string, TradingViewChartHandle>();

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  holidays?: MarketHoliday[];
  /** "all" | "30d" | "7d" | "1d" — visible time-range preset. */
  zoomValue?: string;
  highlightedTradeId?: number | null;
  showAllTrades?: boolean;
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
  tradeNumber: number,
  chartData: SymbolChartData | undefined,
) {
  if (!chartData) return;

  const handle = chartHandles.get(symbol);
  if (!handle) return;

  const entryMarker = chartData.trades.find((t) => t.type === "entry" && t.trade_id === tradeNumber);
  const exitMarker = chartData.trades.find((t) => t.type === "exit" && t.trade_id === tradeNumber);
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

  setTimeout(() => {
    handle.zoomToIndexRange(startIdx, endIdx, totalCandles);
  }, 120);
}

/** Map backtest chart_data into lightweight-charts mark lines (levels).
 *  Only the levels relevant to the strategy are shown: 52W strategies get the
 *  52W-high line, S/R breakout gets pivots, ORB gets the opening range — never
 *  ORB lines on a 52W chart. All lines are solid. */
function buildLevelLines(chartData: SymbolChartData): MarkLineData[] {
  const lines: MarkLineData[] = [];
  const seen = new Set<string>();
  const push = (value: number | null | undefined, color: string, label: string) => {
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    const key = `${label}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({
      yAxis: value,
      lineStyle: { color, type: "solid", width: 1 },
      label: { position: "insideEndTop", formatter: `${label} ${value}` },
    });
  };

  const week52 = chartData.week52_levels ?? [];
  const pivots = chartData.pivot_levels ?? [];
  const orbs = chartData.orb_zones ?? [];

  if (week52.length > 0) {
    for (const w of week52) {
      push((w as unknown as Record<string, number>)["52w_high"], PIVOT_52W_HIGH, "52W");
    }
  } else if (pivots.length > 0) {
    const p = pivots.slice(-1)[0];
    push(p.pp, PIVOT_PP, "PP");
    push(p.r1, PIVOT_R1, "R1");
    push(p.s1, PIVOT_S1, "S1");
    push(p.r2, PIVOT_R1, "R2");
    push(p.s2, PIVOT_S1, "S2");
  } else if (orbs.length > 0) {
    const o = orbs.slice(-1)[0];
    push(o.or_high, PIVOT_OR_HIGH, "OR-H");
    push(o.or_low, PIVOT_OR_LOW, "OR-L");
  }

  return lines;
}

export function mapTrades(chartData: SymbolChartData): ReplayTrade[] {
  const entries = new Map<number, ChartTrade>();
  const exits = new Map<number, ChartTrade>();
  for (const t of chartData.trades) {
    if (t.type === "entry") entries.set(t.trade_id, t);
    else if (t.type === "exit") exits.set(t.trade_id, t);
  }
  const out: ReplayTrade[] = [];
  for (const [id, entry] of entries) {
    const exit = exits.get(id);
    out.push({
      id,
      strategy: "",
      symbol: chartData.symbol,
      side: "BUY",
      entry_price: entry.trade.entry_price,
      exit_price: exit?.trade.exit_price ?? entry.trade.exit_price,
      entry_time: entry.trade.entry_time || entry.time,
      exit_time: exit?.trade.exit_time || exit?.time || "",
      pnl: entry.trade.net_pnl,
      net_pnl: entry.trade.net_pnl,
      costs: entry.trade.trading_costs,
      exit_reason: exit?.trade.exit_reason ?? entry.trade.exit_reason,
      quantity: entry.trade.quantity,
    });
  }
  return out.sort((a, b) => (a.entry_time || "").localeCompare(b.entry_time || ""));
}

export function BacktestChart({
  symbol,
  chartData,
  isLoading,
  onTradeClick,
  holidays,
  zoomValue,
  highlightedTradeId = null,
  showAllTrades = true,
}: BacktestChartProps) {
  const chartRef = useRef<TradingViewChartHandle | null>(null);

  useEffect(() => {
    if (chartRef.current) chartHandles.set(symbol, chartRef.current);
    return () => {
      chartHandles.delete(symbol);
    };
  }, [symbol]);

  const input = useMemo(() => {
    if (!chartData) return null;
    return normalizeBacktest(chartData, true, holidays, highlightedTradeId);
  }, [chartData, holidays, highlightedTradeId]);

  const trades = useMemo(() => (chartData ? mapTrades(chartData) : []), [chartData]);
  const markLines = useMemo(() => {
    if (!chartData) return [];
    // Force solid lines (the shared normalizer emits dashed/dotted).
    const forced = (input?.markLines ?? []).map((ml) => ({
      ...ml,
      lineStyle: { ...ml.lineStyle, type: "solid" },
    }));
    return [...forced, ...buildLevelLines(chartData)];
  }, [chartData, input]);
  const candles = useMemo(
    () => (input?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    [input],
  );

  // zoom preset (All / 30D / 7D / 1D)
  useEffect(() => {
    if (!chartData || !zoomValue || chartData.candles.length === 0) return;
    const total = chartData.candles.length;
    const startIdx = getBacktestZoomStartIndex(chartData.candles, zoomValue);
    const timer = setTimeout(() => {
      if (zoomValue === "all") {
        chartRef.current?.fitContent();
      } else {
        chartRef.current?.zoomToIndexRange(startIdx, total - 1, total);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [zoomValue, chartData]);

  if (isLoading) {
    return (
      <Box
        className="backtest-chart-loading"
        data-testid="backtest-chart-loading"
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", bgcolor: "background.paper", borderRadius: 1 }}
      >
        <Text c="dimmed">Loading {symbol}...</Text>
      </Box>
    );
  }

  if (!chartData || !input) {
    return (
      <Box
        className="backtest-chart-empty"
        data-testid="backtest-chart-empty"
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", bgcolor: "background.paper", borderRadius: 1 }}
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
      sx={{ width: "100%", height: "100%", minHeight: 0, minWidth: 0, display: "flex", bgcolor: palette.NT_BG }}
    >
      <TradingViewChart
        ref={chartRef}
        theme="nt"
        entryLabels
        candles={candles}
        trades={trades}
        highlightedTradeId={highlightedTradeId}
        showAllTrades={showAllTrades}
        markLines={markLines}
        emaData={input.emaData}
        onTradeClick={onTradeClick}
      />
    </Box>
  );
}
