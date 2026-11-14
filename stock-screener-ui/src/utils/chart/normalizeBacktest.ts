import dayjs from "dayjs";
import type {
  ChartInput,
  UnifiedCandle,
  UnifiedTrade,
  UnifiedOverlay,
  MarkLineData,
} from "../chart/types";
import { PIVOT_OR_HIGH, PIVOT_OR_LOW, PIVOT_R1, PIVOT_S1, PIVOT_PP } from "../../config/colors";

export function getBacktestZoomStartIndex(
  candles: Array<{ date?: string | null; time: string }>,
  zoomValue?: string | null,
): number {
  if (!zoomValue || zoomValue === "all" || candles.length === 0) return 0;
  const days = zoomValue === "1d" ? 1 : zoomValue === "7d" ? 7 : 30;
  const last = candles[candles.length - 1];
  const lastDate = last.date || last.time.split("T")[0];
  if (!lastDate) return 0;
  const cutoff = dayjs(lastDate).subtract(days, "day");
  const idx = candles.findIndex((candle) => {
    const date = candle.date || candle.time.split("T")[0];
    return date ? !dayjs(date).isBefore(cutoff) : false;
  });
  return idx >= 0 ? idx : 0;
}

/**
 * `normalizeBacktest` reads only the candle/trade stream plus optional overlay
 * series, and it is deliberately defensive: candle OHLC and the trade payload's
 * secondary fields can be absent on legacy/degenerate payloads. Typing that
 * subset keeps fixtures honest without fabricating the unused envelope.
 */
export interface BacktestNormalizeCandle {
  time: string;
  date?: string;
  date_raw?: string;
  time_str?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface BacktestNormalizeTrade {
  type: "entry" | "exit";
  trade_id: number;
  candle_idx?: number;
  time?: string;
  trade: {
    entry_price?: number;
    exit_price?: number;
    entry_time?: string;
    exit_time?: string;
    quantity?: number;
    net_pnl?: number;
    trading_costs?: number;
    exit_reason?: string;
    or_high?: number;
    or_low?: number;
    pp?: number;
    r1?: number;
    s1?: number;
    r2?: number;
    s2?: number;
  };
}

export interface BacktestNormalizeInput {
  candles: BacktestNormalizeCandle[];
  trades: BacktestNormalizeTrade[];
  symbol?: string;
  visuals?: {
    overlays?: Array<{
      id: string;
      label: string;
      type: "line" | "box";
      color: string;
      dash?: number[];
      levels?: Array<{ date?: string; value: number }>;
      value?: number;
    }>;
    ema_series?: Array<{ label: string; color: string; data: number[] }>;
  };
  rsi?: { period: number; data: (number | null)[] };
}

/** Overlays are always materialized (empty array, not undefined) on this path. */
export type BacktestChartInput = ChartInput & { markLines: MarkLineData[] };

export function normalizeBacktest(
  data: BacktestNormalizeInput,
  isDark: boolean,
  holidays?: { date: string; type: string; description: string }[],
  highlightedTradeId?: number | null,
): BacktestChartInput {
  const rawCandles = data.candles || [];
  const candles: UnifiedCandle[] = rawCandles.map((c: any) => ({
    time: c.time,
    date: c.date,
    time_str: c.time_str,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  const trades: UnifiedTrade[] = [];
  const entryMap = new Map<number, BacktestNormalizeTrade>();
  const exitMap = new Map<number, BacktestNormalizeTrade>();

  for (const t of data.trades) {
    if (t.type === "entry") entryMap.set(t.trade_id, t);
    else if (t.type === "exit") exitMap.set(t.trade_id, t);
  }

  for (const [tradeId, entry] of entryMap) {
    const exit = exitMap.get(tradeId);
    // A marker payload can be structurally incomplete (missing price/qty on
    // legacy rows). Skip it rather than emitting NaN geometry downstream.
    if (entry.trade.entry_price == null || entry.trade.quantity == null) continue;
    trades.push({
      id: tradeId,
      entry_price: entry.trade.entry_price,
      exit_price: exit?.trade.exit_price,
      entry_time: entry.trade.entry_time || entry.time || "",
      exit_time: exit ? exit.trade.exit_time || exit.time : undefined,
      exit_reason: exit?.trade.exit_reason,
      quantity: entry.trade.quantity,
      side: "BUY",
      pnl: exit?.trade.net_pnl,
      costs: exit?.trade.trading_costs,
      candle_idx: entry.candle_idx,
      exit_candle_idx: exit?.candle_idx,
    });
  }

  const overlays: UnifiedOverlay[] = [];
  if (data.visuals?.overlays) {
    for (const overlay of data.visuals.overlays) {
      const levels = overlay.levels ?? (overlay.value != null ? [{ value: overlay.value }] : []);
      overlays.push({
        id: overlay.id,
        label: overlay.label,
        type: overlay.type,
        color: overlay.color,
        dash: overlay.dash,
        levels,
        showLabel: false,
      });
    }
  }

  const emaData = data.visuals?.ema_series?.map((e) => ({
    label: e.label,
    color: e.color,
    data: e.data as (number | null)[],
  }));

  if (emaData && emaData.length > 0) {
    const emaLen = emaData[0].data.length;
    if (emaLen !== rawCandles.length) {
      emaData.length = 0;
    }
  }

  const markLines: MarkLineData[] = [];

  if (highlightedTradeId != null) {
    const entry = entryMap.get(highlightedTradeId);
    if (entry) {
      const t = entry.trade;
      if (t.or_high != null && t.or_low != null) {
        markLines.push(
          {
            yAxis: t.or_high,
            lineStyle: { color: PIVOT_OR_HIGH, type: "dashed", width: 1 },
            label: { position: "insideEndTop", formatter: `OR-H ${t.or_high}` },
          },
          {
            yAxis: t.or_low,
            lineStyle: { color: PIVOT_OR_LOW, type: "dashed", width: 1 },
            label: { position: "insideEndTop", formatter: `OR-L ${t.or_low}` },
          },
        );
      }
      if (t.r1 != null) {
        markLines.push({
          yAxis: t.r1,
          lineStyle: { color: PIVOT_R1, type: "dashed", width: 1 },
          label: { position: "insideEndTop", formatter: `R1 ${t.r1}` },
        });
      }
      if (t.s1 != null) {
        markLines.push({
          yAxis: t.s1,
          lineStyle: { color: PIVOT_S1, type: "dashed", width: 1 },
          label: { position: "insideEndTop", formatter: `S1 ${t.s1}` },
        });
      }
      if (t.pp != null) {
        markLines.push({
          yAxis: t.pp,
          lineStyle: { color: PIVOT_PP, type: "dotted", width: 1 },
          label: { position: "insideEndTop", formatter: `PP ${t.pp}` },
        });
      }
      if (t.r2 != null) {
        markLines.push({
          yAxis: t.r2,
          lineStyle: { color: PIVOT_R1, type: "dotted", width: 1 },
          label: { position: "insideEndTop", formatter: `R2 ${t.r2}` },
        });
      }
      if (t.s2 != null) {
        markLines.push({
          yAxis: t.s2,
          lineStyle: { color: PIVOT_S1, type: "dotted", width: 1 },
          label: { position: "insideEndTop", formatter: `S2 ${t.s2}` },
        });
      }
    }
  }

  return {
    candles,
    trades,
    overlays,
    emaData,
    rsiData: data.rsi && Array.isArray(data.rsi.data) ? data.rsi : undefined,
    markLines,
    highlightedTradeId,
    showVolume: false,
    showDataZoomSlider: true,
    showLegend: true,
    title: `${data.symbol} - Backtest Results`,
    holidays,
    isDark,
  };
}
