import type { PaperChartData } from "../../types/paperTrading";
import type {
  ChartInput,
  UnifiedOverlay,
  UnifiedLivePosition,
  MarkLineData,
  MarkAreaItem,
} from "../chart/types";
import { mapCandles, mapTrades } from "./normalizeCommon";

export function normalizePaper(
  data: PaperChartData,
  isDark: boolean,
  selectedTradeId?: string | null,
  showAllTrades?: boolean,
  showOrbLines?: boolean,
  showPivotLines?: boolean,
  show52wLines?: boolean,
  showEmaLines?: boolean,
): ChartInput {
  const candles = mapCandles(data.candles);

  const trades = mapTrades(
    data.trades,
    (t, idx) => {
      const id = (t as PaperChartData["trades"][number]).trade_id;
      const num = parseInt(id, 10);
      return isNaN(num) ? id : num;
    },
  );

  const overlays: UnifiedOverlay[] = [];
  const markLines: MarkLineData[] = [];
  const markAreas: MarkAreaItem[] = [];

  if (showOrbLines && data.orb_levels) {
    const orb = data.orb_levels;
    const orbLabel = orb.or_minutes ? ` (${orb.or_minutes}m)` : "";
    markLines.push(
      {
        yAxis: orb.or_high,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `OR-H${orbLabel} ${orb.or_high}` },
      },
      {
        yAxis: orb.or_low,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `OR-L${orbLabel} ${orb.or_low}` },
      },
    );
    if (candles.length > 0) {
      markAreas.push({
        from: candles[0].time.split(/[T ]/).pop()?.substring(0, 5) || "09:15",
        to:
          candles[Math.min(8, candles.length - 1)].time.split(/[T ]/).pop()?.substring(0, 5) ||
          "09:25",
        fromY: orb.or_low,
        toY: orb.or_high,
        color: "rgba(33,150,243,0.15)",
      });
    }
  }

  if (showPivotLines && data.pivot_levels) {
    const piv = data.pivot_levels;
    markLines.push(
      {
        yAxis: piv.r2,
        lineStyle: { color: "#EF5350", type: "dotted", width: 1 },
        label: { position: "insideEndTop", formatter: `R2 ${piv.r2}` },
      },
      {
        yAxis: piv.r1,
        lineStyle: { color: "#EF5350", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `R1 ${piv.r1}` },
      },
      {
        yAxis: piv.pp,
        lineStyle: { color: "#AB47BC", type: "dotted", width: 1 },
        label: { position: "insideEndTop", formatter: `PP ${piv.pp}` },
      },
      {
        yAxis: piv.s1,
        lineStyle: { color: "#26A69A", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `S1 ${piv.s1}` },
      },
      {
        yAxis: piv.s2,
        lineStyle: { color: "#26A69A", type: "dotted", width: 1 },
        label: { position: "insideEndTop", formatter: `S2 ${piv.s2}` },
      },
    );
  }

  if (show52wLines && data.week52_levels) {
    const w52 = data.week52_levels;
    markLines.push({
      yAxis: w52.high_52w,
      lineStyle: { color: "#E91E63", type: "dashed", width: 2 },
      label: { position: "insideEndTop", formatter: `52W-H ${w52.high_52w}` },
    });
    if (w52.low_52w > 0) {
      markLines.push({
        yAxis: w52.low_52w,
        lineStyle: { color: "#9C27B0", type: "dashed", width: 1 },
        label: { position: "insideEndTop", formatter: `52W-L ${w52.low_52w}` },
      });
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

  const highlightedTradeId = selectedTradeId ? selectedTradeId : null;
  return {
    candles,
    trades,
    overlays,
    emaData,
    livePosition,
    markLines,
    markAreas,
    showVolume: true,
    showDataZoomSlider: true,
    showLegend: false, // disabled in favor of custom ChartLegend in PaperChart2.tsx
    highlightedTradeId,
    showAllTrades,
    isDark,
  };
}
