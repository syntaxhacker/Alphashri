import type { PaperChartData } from "../../types/paperTrading";
import type {
  ChartInput,
  UnifiedOverlay,
  UnifiedLivePosition,
  MarkLineData,
  MarkAreaItem,
} from "../chart/types";
import { mapCandles, mapTrades, type MappableTrade } from "./normalizeCommon";
import {
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  ORB_AREA,
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_52W_HIGH,
  PIVOT_52W_LOW,
  MARKER_SL,
  MARKER_TP,
} from "../../config/colors";

/**
 * `normalizePaper` only reads the candle/trade stream plus the overlay fields a
 * given chart shows. Typing that subset (rather than `PaperChartData`) keeps
 * fixtures honest without forcing them to fabricate unused envelope fields, and
 * makes it explicit that a partial overlay object is tolerated.
 */
export type PaperNormalizeInput = {
  candles: PaperChartData["candles"];
  trades: (MappableTrade & { trade_id: string })[];
  orb_levels?: { or_high: number; or_low: number; or_minutes?: number; or_candle_count?: number } | null;
  pivot_levels?: { r2?: number; r1?: number; pp: number; s1?: number; s2?: number } | null;
  week52_levels?: { high_52w: number; low_52w?: number } | null;
  ema_series?: {
    ema_fast: { label: string; color: string; data: number[] };
    ema_slow: { label: string; color: string; data: number[] };
  } | null;
  current_position?: {
    entry_price: number;
    entry_time?: string;
    side: "BUY" | "SELL";
    stop_loss: number;
    take_profit: number;
    current_price?: number;
    pnl?: number;
    pnl_pct?: number;
    quantity?: number;
  } | null;
};

/** Overlays are always materialized (empty array, not undefined) on this path. */
export type PaperChartInput = ChartInput & {
  markLines: MarkLineData[];
  markAreas: MarkAreaItem[];
};
export function normalizePaper(
  data: PaperNormalizeInput,
  isDark: boolean,
  selectedTradeId?: string | null,
  showAllTrades?: boolean,
  showOrbLines?: boolean,
  showPivotLines?: boolean,
  show52wLines?: boolean,
  showEmaLines?: boolean,
): PaperChartInput {
  const candles = mapCandles(data.candles);

  const trades = mapTrades(
    data.trades,
    (t, idx) => {
      const id = (t as PaperChartData["trades"][number]).trade_id;
      const num = parseInt(id, 10);
      return isNaN(num) ? idx : num;
    },
  );

  const overlays: UnifiedOverlay[] = [];
  const markLines: MarkLineData[] = [];
  const markAreas: MarkAreaItem[] = [];

  // Levels arrive from partially-populated payloads (a pivot object may carry
  // only `pp`), so a missing level is skipped here rather than pushed with an
  // undefined `yAxis` and filtered out later.
  const pushLine = (
    value: number | undefined | null,
    color: string,
    style: string,
    formatter: string,
    width = 1,
  ) => {
    if (value == null || !isFinite(value)) return;
    markLines.push({
      yAxis: value,
      lineStyle: { color, type: style, width },
      label: { position: "insideEndTop", formatter },
    });
  };

  if (showOrbLines && data.orb_levels) {
    const orb = data.orb_levels;
    const orbLabel = orb.or_minutes ? ` (${orb.or_minutes}m)` : "";
    markLines.push(
      {
        yAxis: orb.or_high,
        lineStyle: { color: PIVOT_OR_HIGH, type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `OR-H${orbLabel} ${orb.or_high}` },
      },
      {
        yAxis: orb.or_low,
        lineStyle: { color: PIVOT_OR_LOW, type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `OR-L${orbLabel} ${orb.or_low}` },
      },
    );
    if (candles.length > 0) {
      const orbEndIdx = orb.or_candle_count != null
        ? Math.min(orb.or_candle_count - 1, candles.length - 1)
        : Math.min(8, candles.length - 1);
      const firstTime = candles[0].time_str || candles[0].time.split(/[T ]/).pop()?.substring(0, 5) || "09:15";
      const lastTime = candles[orbEndIdx].time_str || candles[orbEndIdx].time.split(/[T ]/).pop()?.substring(0, 5) || firstTime;
      markAreas.push({
        from: firstTime,
        to: lastTime,
        fromY: orb.or_low,
        toY: orb.or_high,
        color: ORB_AREA,
      });
    }
  }

  if (showPivotLines && data.pivot_levels) {
    const piv = data.pivot_levels;
    pushLine(piv.r2, PIVOT_R1, "dotted", `R2 ${piv.r2}`);
    pushLine(piv.r1, PIVOT_R1, "dashed", `R1 ${piv.r1}`);
    pushLine(piv.pp, PIVOT_PP, "dotted", `PP ${piv.pp}`);
    pushLine(piv.s1, PIVOT_S1, "dashed", `S1 ${piv.s1}`);
    pushLine(piv.s2, PIVOT_S1, "dotted", `S2 ${piv.s2}`);
  }

  if (show52wLines && data.week52_levels) {
    const w52 = data.week52_levels;
    pushLine(w52.high_52w, PIVOT_52W_HIGH, "dashed", `52W-H ${w52.high_52w}`, 2);
    if (w52.low_52w != null && w52.low_52w > 0) {
      pushLine(w52.low_52w, PIVOT_52W_LOW, "dashed", `52W-L ${w52.low_52w}`);
    }
  }

  let emaData: ChartInput["emaData"];
  if (showEmaLines && data.ema_series) {
    emaData = [
      {
        label: data.ema_series.ema_fast.label,
        color: data.ema_series.ema_fast.color,
        data: data.ema_series.ema_fast.data as (number | null)[],
      },
      {
        label: data.ema_series.ema_slow.label,
        color: data.ema_series.ema_slow.color,
        data: data.ema_series.ema_slow.data as (number | null)[],
      },
    ];
  }

  let livePosition: UnifiedLivePosition | undefined;
  if (data.current_position) {
    const pos = data.current_position;
    livePosition = {
      entry_price: pos.entry_price,
      entry_time: pos.entry_time,
      side: pos.side,
      stop_loss: pos.stop_loss,
      take_profit: pos.take_profit,
      current_price: pos.current_price,
      pnl: pos.pnl,
      pnl_pct: pos.pnl_pct,
      quantity: pos.quantity,
    };
  }

  const highlightedTradeId = selectedTradeId && data.trades
    ? (() => {
        const trade = data.trades.find(t => t.trade_id === selectedTradeId);
        if (!trade) return null;
        const idx = data.trades.indexOf(trade);
        // Use index as ID to avoid fraction collision (e.g., "1.5" vs "1")
        const mappedTrade = trades[idx];
        return mappedTrade ? mappedTrade.id : idx;
      })()
    : null;

  if (highlightedTradeId != null) {
    const trade = trades.find(t => t.id === highlightedTradeId);
    if (trade) {
      if (trade.stop_loss && trade.stop_loss > 0) {
        markLines.push({
          yAxis: trade.stop_loss,
          lineStyle: { color: MARKER_SL, type: "dashed", width: 1 },
          label: { position: "insideEndTop", formatter: `SL ${trade.stop_loss}` },
        });
      }
      if (trade.take_profit && trade.take_profit > 0) {
        markLines.push({
          yAxis: trade.take_profit,
          lineStyle: { color: MARKER_TP, type: "dashed", width: 1 },
          label: { position: "insideEndTop", formatter: `TP ${trade.take_profit}` },
        });
      }
    }
  }

  return {
    candles,
    trades,
    overlays,
    emaData,
    livePosition,
    markLines: markLines.filter(m => m.yAxis != null && isFinite(m.yAxis)),
    markAreas,
    showVolume: false,
    showDataZoomSlider: false,
    showLegend: false, // disabled in favor of custom ChartLegend in PaperChart2.tsx
    highlightedTradeId,
    showAllTrades,
    isDark,
  };
}
