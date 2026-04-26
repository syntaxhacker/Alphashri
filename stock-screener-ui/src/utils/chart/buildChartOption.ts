import type { ChartInput } from "./types";
import { buildGrid } from "./buildGrid";
import { buildSeries } from "./buildSeries";
import { buildTradeMarkers } from "./buildMarkers";
import { buildOverlays } from "./buildOverlays";
import { buildTooltip } from "./buildTooltip";
import { buildLegend } from "./buildLegend";
import { buildLivePositionMarker, buildLivePositionMarkLines } from "./buildLivePosition";
import { getChartThemeColors, buildHolidayMap, insertHolidayGaps } from "../chartUtils";
import { parseTimeToHHMM } from "../ui-helpers";
import { theme } from "../../config/theme";

export function buildChartOption(input: ChartInput): Record<string, unknown> {
  const colors = getChartThemeColors(input.isDark, theme);
  const tooltipBg = input.isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)";

  const hasMultipleDays =
    input.candles.length > 1 &&
    input.candles[0].date &&
    input.candles[input.candles.length - 1].date &&
    input.candles[0].date !== input.candles[input.candles.length - 1].date;

  let times: string[];
  if (hasMultipleDays) {
    times = input.candles.map((c) => {
      const d = c.date || "";
      const t = c.time_str || c.time.split(/[T ]/).pop()?.substring(0, 5) || "";
      return `${d} ${t}`;
    });
  } else {
    times = input.candles.map((c) => {
      if (c.time_str) return c.time_str;
      const parts = c.time.split(/[T ]/);
      return parts.length > 1 ? parts[parts.length - 1].substring(0, 5) : c.time.substring(0, 5);
    });
  }

  let extCandles = input.candles;
  let extendSeriesData = (data: (number | null)[]) => data;
  let hasGaps = false;
  let holidayMap: ReturnType<typeof buildHolidayMap> | undefined;
  let extendedIndexMap: Map<number, number> | undefined;

  if (input.holidays) {
    holidayMap = buildHolidayMap(input.holidays);
    const hasDateCandles = input.candles.some((c) => c.date);
    if (hasDateCandles) {
      const candlesWithDates = input.candles.map((c) => ({
        time: c.time,
        date: c.date || "",
      }));
      const { extendedTimeData } = insertHolidayGaps(candlesWithDates, holidayMap);
      if (extendedTimeData.length !== times.length) {
        hasGaps = true;
        times = extendedTimeData;

        extendedIndexMap = new Map<number, number>();
        let origIdx = 0;
        for (let extIdx = 0; extIdx < extendedTimeData.length; extIdx++) {
          if (!extendedTimeData[extIdx].includes("[") && origIdx < input.candles.length) {
            extendedIndexMap.set(origIdx, extIdx);
            origIdx++;
          }
        }

        const candleData = input.candles.map((c) => [c.open, c.close, c.low, c.high]);
        const extCandleData: any[] = [];
        let ci = 0;
        for (let i = 0; i < extendedTimeData.length; i++) {
          if (extendedTimeData[i].includes("[")) {
            extCandleData.push(["-", "-", "-", "-"]);
          } else if (ci < candleData.length) {
            extCandleData.push(candleData[ci]);
            ci++;
          }
        }
        extCandles = extCandleData as any;

        const idxMap = extendedIndexMap;

        extendSeriesData = (data) => {
          const ext: (number | null)[] = Array.from(
            { length: extendedTimeData.length },
            () => null,
          );
          for (const [origIdx2, val] of data.entries()) {
            const extIdx = idxMap!.get(origIdx2);
            if (extIdx !== undefined) ext[extIdx] = val;
          }
          return ext;
        };
      }
    }
  }

  const grid = buildGrid(colors, input.showVolume, input.showDataZoomSlider);

  if (input.showVolume) {
    grid.xAxes[0].data = times;
    grid.xAxes[1].data = times;
  } else {
    grid.xAxes[0].data = times;
  }

  const series = buildSeries(
    extCandles,
    colors,
    input.showVolume,
    input.markLines,
    input.markAreas,
    times,
  );
  const markers = buildTradeMarkers(
    input.trades,
    input.candles,
    input.highlightedTradeId,
    input.showAllTrades,
    hasGaps ? extendedIndexMap : undefined,
  );
  const overlays = buildOverlays(
    input.overlays,
    extCandles,
    times,
    extendSeriesData,
    input.emaData,
    input.candles,
  );

  let liveSeries: any[] = [];
  let liveMarkLines: any[] = [];
  if (input.livePosition && times.length > 0) {
    let liveCandleIdx = -1;
    const liveTime = input.livePosition.entry_time
      ? parseTimeToHHMM(input.livePosition.entry_time)
      : "";
    if (liveTime) {
      for (let i = 0; i < times.length; i++) {
        if (times[i] >= liveTime) {
          liveCandleIdx = i;
          break;
        }
      }
      if (liveCandleIdx < 0 && times.length > 0) liveCandleIdx = times.length - 1;
    }
    if (liveCandleIdx >= 0) {
      liveSeries = buildLivePositionMarker(input.livePosition, liveCandleIdx);
      liveMarkLines = buildLivePositionMarkLines(input.livePosition);
    }
  }

  const allSeriesNames = [
    ...series.series.map((s: any) => s.name),
    ...liveSeries.map((s: any) => s.name),
    ...markers.map((s: any) => s.name),
    ...overlays.map((s: any) => s.name),
  ];

  const tooltip = buildTooltip(input.candles, input.holidays, times, hasGaps, holidayMap);

  const legend = buildLegend(allSeriesNames, input.showLegend, colors.mutedColor);

  if (liveMarkLines.length > 0 && series.series.length > 0) {
    const candleSeries = series.series[0];
    if (!candleSeries.markLine) {
      candleSeries.markLine = {
        symbol: ["none", "none"],
        data: liveMarkLines,
        label: { color: "inherit", fontSize: 11, formatter: "{b}" },
      };
    } else {
      candleSeries.markLine.data.push(...liveMarkLines);
    }
  }

  return {
    backgroundColor: colors.bgColor,
    animation: false,
    title: input.title
      ? {
          text: input.title,
          left: "center",
          textStyle: { color: colors.textColor, fontSize: 14 },
        }
      : undefined,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: "#666" } },
      backgroundColor: tooltipBg,
      borderColor: colors.borderColor,
      borderWidth: 1,
      textStyle: { color: colors.textColor, fontSize: theme.fontSizes?.sm ?? 12 },
      formatter: tooltip,
    },
    legend,
    grid: grid.grids,
    xAxis: grid.xAxes,
    yAxis: grid.yAxes,
    dataZoom: grid.dataZoom,
    axisPointer: input.showVolume ? { link: [{ xAxisIndex: "all" }] } : undefined,
    series: [...series.series, ...liveSeries, ...markers, ...overlays],
  };
}
