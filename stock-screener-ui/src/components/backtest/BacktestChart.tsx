import { createEffect, createMemo, onCleanup, Show } from "solid-js";
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

// Candle time/date lookup maps are O(n) to build; cache them per chartData.
const candleIndexCache = new WeakMap<
  SymbolChartData,
  { candleTimeMap: Map<string, number>; candleDateMap: Map<string, number> }
>();
function getCandleIndexMaps(chartData: SymbolChartData) {
  let cached = candleIndexCache.get(chartData);
  if (!cached) {
    const candleTimeMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]));
    const candleDateMap = new Map<string, number>();
    chartData.candles.forEach((c, i) => {
      if (c.date) candleDateMap.set(c.date, i);
      if (c.date_raw) candleDateMap.set(c.date_raw!, i);
    });
    cached = { candleTimeMap, candleDateMap };
    candleIndexCache.set(chartData, cached);
  }
  return cached;
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

  const candleTimeMap = getCandleIndexMaps(chartData).candleTimeMap;
  const candleDateMap = getCandleIndexMaps(chartData).candleDateMap;

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

/** Map backtest chart_data into lightweight-charts mark lines (levels). */
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
      side: entry.trade.side ?? "LONG",
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

export function BacktestChart(props: BacktestChartProps) {
  let chartRef: TradingViewChartHandle | undefined;

  createEffect(() => {
    if (chartRef) chartHandles.set(props.symbol, chartRef);
    onCleanup(() => {
      chartHandles.delete(props.symbol);
    });
  });

  const input = createMemo(() => {
    const cd = props.chartData;
    if (!cd) return null;
    return normalizeBacktest(cd, true, props.holidays, props.highlightedTradeId ?? null);
  });

  const trades = createMemo(() => {
    const cd = props.chartData;
    return cd ? mapTrades(cd) : [];
  });
  const markLines = createMemo(() => {
    const cd = props.chartData;
    if (!cd) return [];
    // Force solid lines (the shared normalizer emits dashed/dotted).
    const forced = (input()?.markLines ?? []).map((ml) => ({
      ...ml,
      lineStyle: { ...ml.lineStyle, type: "solid" },
    }));
    return [...forced, ...buildLevelLines(cd)];
  });
  const candles = createMemo(() =>
    (input()?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
  );

  // zoom preset (All / 30D / 7D / 1D)
  createEffect(() => {
    const cd = props.chartData;
    const zv = props.zoomValue;
    if (!cd || !zv || cd.candles.length === 0) return;
    const total = cd.candles.length;
    const startIdx = getBacktestZoomStartIndex(cd.candles, zv);
    const timer = setTimeout(() => {
      if (zv === "all") {
        chartRef?.fitContent();
      } else {
        chartRef?.zoomToIndexRange(startIdx, total - 1, total);
      }
    }, 150);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <>
      <Show when={props.isLoading}>
        <Box
          className="backtest-chart-loading flex items-center justify-center h-full rounded-fin"
          data-testid="backtest-chart-loading"
          style={{ height: "100%", "background-color": palette.SURFACE }}
        >
          <Text c="dimmed">Loading {props.symbol}...</Text>
        </Box>
      </Show>
      <Show when={!props.isLoading && (!props.chartData || !input())}>
        <Box
          className="backtest-chart-empty flex items-center justify-center h-full rounded-fin"
          data-testid="backtest-chart-empty"
          style={{ height: "100%", "background-color": palette.SURFACE }}
        >
          <Text c="dimmed">No chart data for {props.symbol}</Text>
        </Box>
      </Show>
      <Show when={!props.isLoading && props.chartData && input()}>
        <Box
          id={`backtest-chart-${props.symbol}`}
          className="backtest-chart w-full h-full min-h-0 min-w-0 flex"
          data-testid="echarts-container"
          data-symbol={props.symbol}
          style={{ width: "100%", height: "100%", "min-height": 0, "min-width": 0, display: "flex", "background-color": palette.NT_BG }}
        >
          <TradingViewChart
            ref={(h) => (chartRef = h)}
            theme="nt"
            entryLabels
            candles={candles()}
            trades={trades()}
            highlightedTradeId={props.highlightedTradeId ?? null}
            showAllTrades={props.showAllTrades ?? true}
            markLines={markLines()}
            emaData={input().emaData}
            rsiData={input().rsiData}
            onTradeClick={props.onTradeClick}
          />
        </Box>
      </Show>
    </>
  );
}
