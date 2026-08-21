import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
} from "../../types/replay";
import type { ChartInput, UnifiedOverlay, MarkAreaItem } from "../chart/types";
import { parseTimeToHHMM } from "../ui-helpers";
import { mapCandles, mapTrades } from "./normalizeCommon";
import {
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_52W_HIGH,
  PIVOT_52W_LOW,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
  ORB_AREA,
} from "../../config/colors";

export function normalizeReplay(
  candles: ReplayCandle[],
  trades: ReplayTrade[],
  orLevels: ReplayORLevels[] = [],
  pivotLevels: ReplayPivotLevels[] = [],
  high52wLevels: Replay52WLevel[] = [],
  emaDataMap: Record<string, ReplayEMAData> = {},
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
  const unifiedCandles = mapCandles(candles);

  const symbolTrades = trades.filter((t) => t.symbol === selectedSymbol);
  const unifiedTrades = mapTrades(symbolTrades, (t) => (t as ReplayTrade).id);

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
        color: PIVOT_OR_HIGH,
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
        color: PIVOT_OR_LOW,
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
          color: PIVOT_R1,
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
          color: PIVOT_R1,
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
          color: PIVOT_PP,
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
          color: PIVOT_S1,
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
          color: PIVOT_S1,
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
        color: PIVOT_52W_HIGH,
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
          color: PIVOT_52W_LOW,
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
          color: INDICATOR_BLUE_A,
          data: tfData.ema_fast as (number | null)[],
        },
        {
          label: `EMA ${ema.ema_slow_period}`,
          color: INDICATOR_BLUE_B,
          data: tfData.ema_slow as (number | null)[],
        },
      ];
    }
  }

  const markAreas: MarkAreaItem[] = [];
  if (chartOptions?.show_orb_zones !== false && candles.length > 0) {
    for (const or of orLevels) {
      if (or.symbol !== selectedSymbol) continue;
      const orbEndIdx = Math.min(map1mIndex(or.to_index), candles.length - 1);
      const toTime = candles[orbEndIdx].time;
      const toHHMM = parseTimeToHHMM(toTime);
      markAreas.push({
        from: candles[0].time.includes("T")
          ? parseTimeToHHMM(candles[0].time)
          : candles[0].time.substring(0, 5),
        to: toHHMM,
        fromY: or.or_low,
        toY: or.or_high,
        color: ORB_AREA,
      });
    }
  }

  return {
    candles: unifiedCandles,
    trades: unifiedTrades,
    overlays,
    emaData,
    markAreas,
    showVolume: false,
    showDataZoomSlider: false,
    showLegend: false,
    highlightedTradeId,
    showAllTrades,
    isDark,
  };
}
