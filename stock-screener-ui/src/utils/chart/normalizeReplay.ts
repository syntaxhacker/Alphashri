import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
} from "../../types/replay";
import type {
  ChartInput,
  UnifiedCandle,
  UnifiedTrade,
  UnifiedOverlay,
  MarkAreaItem,
} from "../chart/types";

function parseTimeToHHMM(isoTime: string): string {
  if (isoTime.includes("T")) return isoTime.split("T")[1].substring(0, 5);
  if (isoTime.includes(" ")) return isoTime.split(" ")[1].substring(0, 5);
  return isoTime.substring(0, 5);
}

export function normalizeReplay(
  candles: ReplayCandle[],
  trades: ReplayTrade[],
  orLevels: ReplayORLevels[],
  pivotLevels: ReplayPivotLevels[],
  high52wLevels: Replay52WLevel[],
  emaDataMap: Record<string, ReplayEMAData>,
  selectedSymbol: string,
  isDark: boolean,
  highlightedTradeId?: number | null,
  showAllTrades?: boolean,
  rawCandles?: ReplayCandle[],
  activeTF?: number,
  chartOptions?: {
    show_orb_zones?: boolean;
    show_pivot_levels?: boolean;
    show_52w_high?: boolean;
    show_ema?: boolean;
  },
): ChartInput {
  const unifiedCandles: UnifiedCandle[] = candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  const unifiedTrades: UnifiedTrade[] = trades
    .filter((t) => t.symbol === selectedSymbol)
    .map((t) => ({
      id: t.id,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      exit_reason: t.exit_reason,
      quantity: t.quantity,
      side: t.side as "BUY" | "SELL",
      pnl: t.net_pnl,
      costs: t.costs,
    }));

  const overlays: UnifiedOverlay[] = [];
  const rc = rawCandles || candles;

  function map1mIndex(index1m: number): number {
    if (!rawCandles || !rawCandles.length || !activeTF || activeTF <= 1) return index1m;
    const clamped = Math.max(0, Math.min(index1m, rawCandles.length - 1));
    const timeStr = rawCandles[clamped].time;
    const hhmm = parseTimeToHHMM(timeStr);
    let best = -1;
    for (let i = 0; i < candles.length; i++) {
      const candleHHMM = parseTimeToHHMM(candles[i].time);
      if (candleHHMM <= hhmm) best = i;
      else break;
    }
    return best >= 0 ? best : 0;
  }

  if (chartOptions?.show_orb_zones !== false) {
    for (const or of orLevels) {
      if (or.symbol !== selectedSymbol) continue;
      const fromTime = rc[map1mIndex(or.from_index)]?.time || "";
      const toTime = rc[map1mIndex(or.to_index)]?.time || "";
      const fromDate = fromTime.split("T")[0] || "";
      const toDate = toTime.split("T")[0] || "";
      overlays.push({
        id: `or-high-${or.strategy}`,
        label: `OR High (${or.strategy})`,
        type: "line",
        color: "#2196F3",
        dash: [6, 3],
        levels: [
          { date: fromDate, value: or.or_high },
          { date: toDate, value: or.or_high },
        ],
      });
      overlays.push({
        id: `or-low-${or.strategy}`,
        label: `OR Low (${or.strategy})`,
        type: "line",
        color: "#2196F3",
        dash: [6, 3],
        levels: [
          { date: fromDate, value: or.or_low },
          { date: toDate, value: or.or_low },
        ],
      });
    }
  }

  if (chartOptions?.show_pivot_levels !== false) {
    for (const piv of pivotLevels) {
      if (piv.symbol !== selectedSymbol) continue;
      const fromTime = rc[map1mIndex(piv.from_index)]?.time || "";
      const toTime = rc[map1mIndex(piv.to_index)]?.time || "";
      const fromDate = fromTime.split("T")[0] || "";
      const toDate = toTime.split("T")[0] || "";
      overlays.push(
        {
          id: `r2-${piv.strategy}`,
          label: `R2 (${piv.strategy})`,
          type: "line",
          color: "#EF5350",
          dash: [2, 2],
          levels: [
            { date: fromDate, value: piv.r2 },
            { date: toDate, value: piv.r2 },
          ],
        },
        {
          id: `r1-${piv.strategy}`,
          label: `R1 (${piv.strategy})`,
          type: "line",
          color: "#EF5350",
          dash: [6, 3],
          levels: [
            { date: fromDate, value: piv.r1 },
            { date: toDate, value: piv.r1 },
          ],
        },
        {
          id: `pp-${piv.strategy}`,
          label: `PP (${piv.strategy})`,
          type: "line",
          color: "#AB47BC",
          dash: [2, 2],
          levels: [
            { date: fromDate, value: piv.pp },
            { date: toDate, value: piv.pp },
          ],
        },
        {
          id: `s1-${piv.strategy}`,
          label: `S1 (${piv.strategy})`,
          type: "line",
          color: "#26A69A",
          dash: [6, 3],
          levels: [
            { date: fromDate, value: piv.s1 },
            { date: toDate, value: piv.s1 },
          ],
        },
        {
          id: `s2-${piv.strategy}`,
          label: `S2 (${piv.strategy})`,
          type: "line",
          color: "#26A69A",
          dash: [2, 2],
          levels: [
            { date: fromDate, value: piv.s2 },
            { date: toDate, value: piv.s2 },
          ],
        },
      );
    }
  }

  if (chartOptions?.show_52w_high !== false) {
    for (const h52 of high52wLevels) {
      if (h52.symbol !== selectedSymbol) continue;
      const fromTime = rc[map1mIndex(h52.from_index)]?.time || "";
      const toTime = rc[map1mIndex(h52.to_index)]?.time || "";
      const fromDate = fromTime.split("T")[0] || "";
      const toDate = toTime.split("T")[0] || "";
      overlays.push({
        id: `52w-high-${h52.strategy}`,
        label: `52W High (${h52.strategy})`,
        type: "line",
        color: "#E91E63",
        dash: [6, 3],
        levels: [
          { date: fromDate, value: h52.high_52w },
          { date: toDate, value: h52.high_52w },
        ],
      });
      if (h52.low_52w > 0) {
        overlays.push({
          id: `52w-low-${h52.strategy}`,
          label: `52W Low (${h52.strategy})`,
          type: "line",
          color: "#9C27B0",
          dash: [2, 2],
          levels: [
            { date: fromDate, value: h52.low_52w },
            { date: toDate, value: h52.low_52w },
          ],
        });
      }
    }
  }

  let emaData: ChartInput["emaData"];
  if (chartOptions?.show_ema !== false && emaDataMap[selectedSymbol]) {
    const ema = emaDataMap[selectedSymbol];
    const tf = activeTF ? `${activeTF}min` : "5min";
    const tfData = ema.timeframes[tf] || Object.values(ema.timeframes)[0];
    if (tfData) {
      emaData = [
        {
          label: `EMA ${ema.ema_fast_period}`,
          color: "#10ac84",
          data: tfData.ema_fast as (number | null)[],
        },
        {
          label: `EMA ${ema.ema_slow_period}`,
          color: "#ee5253",
          data: tfData.ema_slow as (number | null)[],
        },
      ];
    }
  }

  const markAreas: MarkAreaItem[] = [];
  if (chartOptions?.show_orb_zones !== false && candles.length > 0) {
    const lastOrbIdx = Math.min(8, candles.length - 1);
    const toTime = candles[lastOrbIdx].time;
    const toHHMM = parseTimeToHHMM(toTime);
    for (const or of orLevels) {
      if (or.symbol !== selectedSymbol) continue;
      markAreas.push({
        from: candles[0].time.includes("T")
          ? parseTimeToHHMM(candles[0].time)
          : candles[0].time.substring(0, 5),
        to: toHHMM,
        fromY: or.or_low,
        toY: or.or_high,
        color: "rgba(33,150,243,0.15)",
      });
    }
  }

  return {
    candles: unifiedCandles,
    trades: unifiedTrades,
    overlays,
    emaData,
    markAreas,
    showVolume: true,
    showDataZoomSlider: false,
    showLegend: false,
    highlightedTradeId,
    showAllTrades,
    isDark,
  };
}
