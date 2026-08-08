import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import type {
  ChartInput,
  UnifiedCandle,
  UnifiedTrade,
  UnifiedOverlay,
  MarkLineData,
} from "../chart/types";
import { PIVOT_OR_HIGH, PIVOT_OR_LOW, PIVOT_R1, PIVOT_S1, PIVOT_PP } from "../../config/colors";

export function normalizeBacktest(
  data: SymbolChartData,
  isDark: boolean,
  holidays?: { date: string; type: string; description: string }[],
  highlightedTradeId?: number | null,
): ChartInput {
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
  const entryMap = new Map<number, ChartTrade>();
  const exitMap = new Map<number, ChartTrade>();

  for (const t of data.trades) {
    if (t.type === "entry") entryMap.set(t.trade_id, t);
    else if (t.type === "exit") exitMap.set(t.trade_id, t);
  }

  for (const [tradeId, entry] of entryMap) {
    const exit = exitMap.get(tradeId);
    trades.push({
      id: tradeId,
      entry_price: entry.trade.entry_price,
      exit_price: exit ? exit.trade.exit_price : undefined,
      entry_time: entry.trade.entry_time || entry.time,
      exit_time: exit ? exit.trade.exit_time || exit.time : undefined,
      exit_reason: exit ? exit.trade.exit_reason : undefined,
      quantity: entry.trade.quantity,
      side: "BUY",
      pnl: exit ? exit.trade.net_pnl : undefined,
      costs: exit ? exit.trade.trading_costs : undefined,
      candle_idx: entry.candle_idx,
      exit_candle_idx: exit?.candle_idx,
    });
  }

  const overlays: UnifiedOverlay[] = [];
  if (data.visuals?.overlays) {
    for (const overlay of data.visuals.overlays) {
      overlays.push({
        id: overlay.id,
        label: overlay.label,
        type: overlay.type,
        color: overlay.color,
        dash: overlay.dash,
        levels: overlay.levels || [{ value: overlay.value }],
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
