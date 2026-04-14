import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import { theme } from "../../config/theme";
import { formatPercentage, normalizeTime } from "../../utils/ui-helpers";
import {
  getChartThemeColors,
  CANDLESTICK_ITEM_STYLE,
  buildHolidayMap,
  insertHolidayGaps,
  getMarkerConfigs,
  type HolidayMap,
} from "../../utils/chartUtils";
import { buildPivotSeries, buildWeek52Series, buildEmaSeries } from "../../utils/chartLineBuilders";
import type { MarketHoliday } from "../../types/holidays";

function buildTradeTooltip(p: any) {
  const t = p.data.trade;
  const pnlColor = t.net_pnl >= 0 ? "#00E676" : "#FF1744";
  return `
    <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
      <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
        Trade #${p.data.trade_id} | ${t.exit_reason}
      </div>
      <div style="display: flex; gap: 12px; margin-bottom: 2px;">
        <span>Entry: <b>₹${t.entry_price.toFixed(0)}</b></span>
        <span>Exit: <b>₹${t.exit_price.toFixed(0)}</b></span>
        <span>Qty: ${t.quantity}</span>
      </div>
      <div style="display: flex; gap: 12px;">
        <span>Gross: ₹${t.gross_pnl.toFixed(0)}</span>
        <span>Cost: ₹${t.trading_costs.toFixed(0)}</span>
        <span style="color: ${pnlColor}; font-weight: bold;">
          Net: ₹${t.net_pnl.toFixed(0)} (${formatPercentage(t.net_pnl_pct, 1, true)})
        </span>
      </div>
    </div>`;
}

function buildHolidayTooltip(
  label: string,
  holidayMap: HolidayMap,
  fontSizes: Record<string, number>,
) {
  const parts = label.match(/(\S+)\s+\[(\w+)\]/);
  const hDate = parts ? parts[1] : label;
  const hType = parts ? parts[2] : "?";
  const desc = holidayMap.descriptions.get(hDate)?.desc ?? "";
  const typeLabel =
    hType === "H" ? "Trading Holiday" : hType === "C" ? "Clearing Holiday" : "Weekend";
  return `<div style="padding: 6px 8px; font-size: ${fontSizes.sm}px;">
    <div style="font-weight: bold; color: ${hType === "H" ? "#FF5252" : "#FFB74D"};">${hDate} — ${typeLabel}</div>
    ${desc ? `<div style="color: #888;">${desc}</div>` : ""}
  </div>`;
}

function buildCandleTooltip(c: any) {
  const change = (((c.close - c.open) / c.open) * 100).toFixed(2);
  const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";
  return `
    <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
      <div style="font-weight: bold; margin-bottom: 4px;">${c.date} ${c.time_str}</div>
      <div style="display: flex; gap: 12px;">
        <span>O: ₹${c.open.toFixed(0)}</span>
        <span>H: ₹${c.high.toFixed(0)}</span>
        <span>L: ₹${c.low.toFixed(0)}</span>
        <span>C: ₹${c.close.toFixed(0)}</span>
      </div>
      <div style="display: flex; gap: 12px; color: #888;">
        <span style="color: ${changeColor}; font-weight: bold;">${c.close >= c.open ? "+" : ""}${change}%</span>
        <span>Vol: ${(c.volume / 1000).toFixed(0)}K</span>
      </div>
    </div>`;
}

function buildTooltipFormatter(
  candles: any[],
  holidayMap: HolidayMap,
  extendedTimeData: string[],
  hasGaps: boolean,
  fontSizes: Record<string, number>,
) {
  return function (params: any) {
    for (const p of params) {
      if (p.data?.trade) return buildTradeTooltip(p);
    }
    const candle = params.find((p: any) => p.seriesType === "candlestick");
    if (!candle) return "";
    const idx = candle.dataIndex;
    if (hasGaps && extendedTimeData[idx]?.includes("[")) {
      return buildHolidayTooltip(extendedTimeData[idx], holidayMap, fontSizes);
    }
    return buildCandleTooltip(candles[idx]);
  };
}

export function buildChartOption(
  data: SymbolChartData,
  isDark: boolean,
  holidays?: MarketHoliday[],
): any {
  const { candles, pivot_levels, week52_levels, trades, visuals } = data;
  const fontSizes = theme.fontSizes;

  if (!candles || !trades) return {};

  const { bgColor, textColor, mutedColor, borderColor, gridLineColor } = getChartThemeColors(
    isDark,
    theme,
  );
  const tooltipBg = isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";

  const holidayMap = buildHolidayMap(holidays);
  const { extendedTimeData, hasGaps } = insertHolidayGaps(candles, holidayMap);

  const candleData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const timeData = hasGaps ? extendedTimeData : candles.map((c) => c.time);

  const candleTimeMap = new Map(candles.map((c, i) => [normalizeTime(c.time), i]));
  const candleDateMap = new Map(candles.map((c, i) => [c.date, i]));

  const extendedIndexMap = hasGaps
    ? (() => {
        const map = new Map<number, number>();
        let origIdx = 0;
        for (let extIdx = 0; extIdx < extendedTimeData.length; extIdx++) {
          const t = extendedTimeData[extIdx];
          if (!t.includes("[") && origIdx < candles.length) {
            map.set(origIdx, extIdx);
            origIdx++;
          }
        }
        return map;
      })()
    : null;

  const toExtIdx = (origIdx: number): number =>
    extendedIndexMap ? (extendedIndexMap.get(origIdx) ?? origIdx) : origIdx;

  const extCandleData: any[] = hasGaps
    ? (() => {
        const d: any[] = [];
        let origIdx = 0;
        for (let i = 0; i < extendedTimeData.length; i++) {
          if (extendedTimeData[i].includes("[")) {
            d.push(["-", "-", "-", "-"]);
          } else if (origIdx < candleData.length) {
            d.push(candleData[origIdx]);
            origIdx++;
          }
        }
        return d;
      })()
    : candleData;

  const extendSeriesData = (origData: any[]): any[] => {
    if (!hasGaps) return origData;
    const d: any[] = [];
    let origIdx = 0;
    for (let i = 0; i < extendedTimeData.length; i++) {
      if (extendedTimeData[i].includes("[")) {
        d.push("-");
      } else if (origIdx < origData.length) {
        d.push(origData[origIdx]);
        origIdx++;
      } else {
        d.push(null);
      }
    }
    return d;
  };

  const getCandleIdx = (trade: ChartTrade): number | undefined => {
    if (trade.candle_idx !== undefined) return trade.candle_idx;
    const normalized = normalizeTime(trade.time);
    let idx = candleTimeMap.get(normalized);
    if (idx === undefined && trade.date) {
      idx = candleDateMap.get(trade.date);
    }
    return idx;
  };

  const buildMarkers = (
    trades: ChartTrade[],
    config: {
      filter: (t: ChartTrade) => boolean;
      color: string;
      symbol: string;
      symbolSize: number;
      symbolRotate?: number;
    },
  ) =>
    trades
      .filter(config.filter)
      .map((t) => ({ ...t, computedIdx: getCandleIdx(t) }))
      .filter((t) => t.computedIdx !== undefined)
      .map((t) => ({
        value: [toExtIdx(t.computedIdx!), t.price],
        itemStyle: { color: config.color, borderColor: "#FFFFFF", borderWidth: 2 },
        symbol: config.symbol,
        ...(config.symbolRotate !== undefined ? { symbolRotate: config.symbolRotate } : {}),
        symbolSize: config.symbolSize,
        trade: t.trade,
        trade_id: t.trade_id,
      }));

  const allMarkers = getMarkerConfigs().map((cfg) => buildMarkers(trades, cfg));

  const series: any[] = [
    { name: "Price", type: "candlestick", data: extCandleData, itemStyle: CANDLESTICK_ITEM_STYLE },
    { name: "Entry", type: "scatter", data: allMarkers[0], symbolSize: 16, z: 10 },
    { name: "TP", type: "scatter", data: allMarkers[1], symbolSize: 14, z: 10 },
    { name: "SL", type: "scatter", data: allMarkers[2], symbolSize: 14, z: 10 },
    { name: "EOD", type: "scatter", data: allMarkers[3], symbolSize: 14, z: 10 },
    { name: "Trailing", type: "scatter", data: allMarkers[4], symbolSize: 14, z: 10 },
    { name: "MaxHold", type: "scatter", data: allMarkers[5], symbolSize: 14, z: 10 },
    { name: "52W", type: "scatter", data: allMarkers[6], symbolSize: 14, z: 10 },
  ];

  const legendData = ["Price", "Entry", "TP", "SL", "EOD", "Trailing", "MaxHold", "52W"];

  if (visuals?.overlays) {
    visuals.overlays.forEach((overlay: any) => {
      if (overlay.type === "line") {
        const lineData = extendSeriesData(
          candles.map((c) => (overlay.date && c.date === overlay.date ? overlay.value : null)),
        );
        series.push({
          id: overlay.id,
          name: overlay.label,
          type: "line",
          data: lineData,
          showSymbol: false,
          connectNulls: false,
          silent: true,
          z: 5,
          lineStyle: { color: overlay.color, width: 1, type: overlay.dash ? "dashed" : "solid" },
          tooltip: { show: true },
        });
        if (!legendData.includes(overlay.label)) legendData.push(overlay.label);
      } else if (overlay.type === "box") {
        const topData = extendSeriesData(
          candles.map((c) => (overlay.date && c.date === overlay.date ? overlay.levels.top : null)),
        );
        series.push({
          id: `${overlay.id}_top`,
          name: overlay.label,
          type: "line",
          data: topData,
          showSymbol: false,
          connectNulls: false,
          silent: true,
          z: 4,
          lineStyle: { color: overlay.color, width: 0.5, opacity: 0.5, type: "dashed" },
        });
        if (!legendData.includes(overlay.label)) legendData.push(overlay.label);
      }
    });
  }

  if (visuals?.ema_series?.length) {
    series.push(...buildEmaSeries(visuals.ema_series, extendSeriesData, legendData));
  }

  if (!visuals?.overlays) {
    const pivotSeries = buildPivotSeries(candles, pivot_levels || []);
    if (pivotSeries.length > 0) {
      series.push(...pivotSeries);
      legendData.push("R1", "PP", "S1");
    }
    series.push(...buildWeek52Series(candles, week52_levels || [], extendSeriesData));
    legendData.push("52W High");
  }

  return {
    backgroundColor: bgColor,
    title: {
      text: `${data.symbol} - Backtest Results`,
      left: "center",
      textStyle: { fontSize: fontSizes.lg, color: textColor },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: "#666" } },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: fontSizes.sm },
      formatter: buildTooltipFormatter(candles, holidayMap, extendedTimeData, hasGaps, fontSizes),
    },
    legend: {
      data: legendData,
      bottom: 6,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: mutedColor, fontSize: fontSizes.sm },
      type: "scroll",
    },
    grid: { left: "8%", right: "8%", bottom: 82, top: 44 },
    xAxis: {
      type: "category",
      data: timeData,
      scale: true,
      splitLine: { show: false },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: { color: mutedColor, rotate: 45 },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitArea: { show: true },
      splitLine: { lineStyle: { color: gridLineColor } },
      axisLine: { lineStyle: { color: borderColor } },
      axisLabel: { color: mutedColor, formatter: (value: number) => "₹" + value.toFixed(0) },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", show: true, start: 0, end: 100, bottom: 30 },
    ],
    series,
  };
}
