import type { ChartCandle, PatternHitDTO, PatternOverlay, Trendline, TrendLine, TrendlinesView } from "@/types/chartPatterns";
import {
  CHART_AVG_ENTRY,
  CHART_MUTED,
  CHART_OVERLAY,
  CHART_SPLIT,
  CHART_TEXT,
  MARKER_SL,
  MARKER_TP,
  NEGATIVE,
  POSITIVE,
  PRIMARY,
  WARNING,
} from "@/ui/palette";
import { mapTimeSegment, mapTrendlines, pointsToSeriesData } from "./trendlineMapping";
import { formatChartTick, formatChartTimestamp } from "./datetime";
import { formatCurrency } from "@/utils/ui-helpers";

export const BOUNDARY_COLORS = [PRIMARY, WARNING];

/**
 * Distinct colours assigned in order to the patterns drawn on one chart: the
 * selected pattern takes the first colour, its siblings the next ones. A
 * pattern's two boundary lines share its colour and legend name, so the legend
 * answers "which pattern is which" instead of showing generic upper/lower edges.
 */
const PATTERN_COLORS = [
  PRIMARY,
  WARNING,
  POSITIVE,
  CHART_TEXT,
  NEGATIVE,
  CHART_AVG_ENTRY,
  CHART_MUTED,
];

interface TooltipParam {
  axisValue?: unknown;
  marker?: string;
  seriesName?: string;
  seriesType?: string;
  value?: unknown;
}

/**
 * Readable tooltip: replaces the raw ISO category header with the IST trading
 * date/time and keeps each series' value visible.
 */
function formatPatternTooltip(params: unknown): string {
  const list = Array.isArray(params) ? (params as TooltipParam[]) : [params as TooltipParam];
  const first = list[0];
  if (!first) return "";
  const header = formatChartTimestamp(String(first.axisValue ?? ""));
  const rows = list
    .map((p) => {
      const marker = p.marker ?? "";
      const name = p.seriesName ?? "";
      if (p.value == null) return "";
      let value: string;
      if (p.seriesType === "candlestick" && Array.isArray(p.value)) {
        const [o, c, l, h] = p.value as number[];
        value = `O ${o}  H ${h}  L ${l}  C ${c}`;
      } else if (p.seriesType === "scatter" && Array.isArray(p.value)) {
        // Pivot markers plot as [categoryIndex, price]; show the price at the
        // marker's readable date (the tooltip header) instead of raw indices.
        value = formatCurrency(Number((p.value as number[])[1]), 2);
      } else if (Array.isArray(p.value)) {
        value = (p.value as unknown[]).join(" / ");
      } else {
        value = String(p.value);
      }
      return `${marker}${name}: ${value}`;
    })
    .filter((row) => row !== "");
  return [header, ...rows].join("<br/>");
}

/** An overlay trendline bundle, optionally carrying instance identity. */
export type SiblingOverlay = PatternOverlay & {
  /** Instance start date — distinguishes two instances of the same pattern. */
  start_date?: string | null;
  /** Opaque instance key, when the backend supplies one. */
  instanceKey?: string | null;
};

export interface PatternChartOptionInput {
  candles: ChartCandle[];
  trendlines?: Trendline[];
  hit?: PatternHitDTO | null;
  /**
   * All detected patterns for the symbol. Every sibling pattern's boundaries are
   * drawn dashed so the full sequence of structures is visible (the selected one
   * stays solid in the highlighted colours).
   */
  overlays?: SiblingOverlay[];
  /** Pattern id of the selected hit, excluded from the dashed siblings. */
  selectedPatternId?: string;
  /**
   * Instance identity of the selected hit. Siblings are skipped only when they
   * match the selected pattern id *and* the selected instance — without this,
   * every other instance of the same pattern was hidden as a "duplicate".
   */
  selectedStartDate?: string | null;
  /** Opaque selected instance key (preferred when the backend supplies one). */
  selectedInstanceKey?: string | null;
  /** Compact = card sparkline (no axes/tooltip/legend/zoom). */
  compact?: boolean;
  /**
   * View-only filter for standalone support/resistance lines: `"both"`
   * (default) draws both kinds, `"support"`/`"resistance"` draws one kind,
   * `"none"` draws none.
   */
  trendlinesView?: TrendlinesView;
  /**
   * Standalone support/resistance lines to draw. Defaults to the hit's own
   * `trend_lines` when omitted.
   */
  standaloneTrendLines?: TrendLine[];
  /** Full = drill-down / fullscreen (axes, tooltip, legend, level guides). */
  showZoom?: boolean;
  /** Larger fonts/margins for the fullscreen view. */
  large?: boolean;
}

/**
 * Single source of truth for drawing a detected pattern: real OHLCV candles,
 * the detector's boundary trendlines, and breakout/target/stop guides. Used by
 * the card sparkline, the detail chart, and the fullscreen view so the geometry
 * is identical everywhere.
 */
export function buildPatternChartOption({
  candles,
  trendlines,
  hit,
  overlays,
  selectedPatternId,
  selectedStartDate,
  selectedInstanceKey,
  compact = false,
  showZoom = false,
  large = false,
  trendlinesView = "both",
  standaloneTrendLines,
}: PatternChartOptionInput): Record<string, unknown> {
  const times = candles.map((c) => c.t);

  const markData: Array<Record<string, unknown>> = [];
  if (!compact && hit) {
    if (hit.breakout_level) {
      markData.push({
        yAxis: hit.breakout_level,
        label: { formatter: "Breakout", position: "insideEndTop", color: PRIMARY, fontSize: large ? 12 : 10 },
        lineStyle: { color: PRIMARY, type: "dashed", width: 1 },
      });
    }
    if (hit.target) {
      markData.push({
        yAxis: hit.target,
        label: { formatter: "Target", position: "insideEndTop", color: MARKER_TP, fontSize: large ? 12 : 10 },
        lineStyle: { color: MARKER_TP, type: "dashed", width: 1 },
      });
    }
    if (hit.stop) {
      markData.push({
        yAxis: hit.stop,
        label: { formatter: "Stop", position: "insideEndBottom", color: MARKER_SL, fontSize: large ? 12 : 10 },
        lineStyle: { color: MARKER_SL, type: "dashed", width: 1 },
      });
    }
  }

  const series: Array<Record<string, unknown>> = [
    {
      type: "candlestick",
      name: hit?.symbol ?? "Price",
      data: candles.map((c) => [c.o, c.c, c.l, c.h]),
      itemStyle: { color: POSITIVE, color0: NEGATIVE, borderColor: POSITIVE, borderColor0: NEGATIVE },
      barMaxWidth: compact ? 5 : 12,
      silent: compact,
      z: 1,
      markLine:
        markData.length > 0
          ? { symbol: "none", silent: true, data: markData as never }
          : undefined,
    },
  ];

  // Every pattern on the chart is a single legend group: both boundary lines
  // share the pattern's name and colour, so the legend reads
  // "Double Bottom / Ascending Channel / Rising Wedge …" and toggling a group
  // hides that whole pattern. The selected pattern is solid + thicker; the
  // symbol's other patterns are dashed.
  const selectedId = selectedPatternId ?? hit?.pattern_id;
  // Instance identity of the selected hit: only the overlay that matches both
  // the pattern id and this instance is treated as "the selected one". Siblings
  // that share the pattern id but are a different instance stay visible.
  const selectedStart = selectedStartDate ?? hit?.start_date ?? null;
  const selectedKey = selectedInstanceKey ?? null;
  const isSelectedOverlay = (overlay: SiblingOverlay): boolean => {
    if (!selectedId || overlay.pattern_id !== selectedId) return false;
    if (selectedKey != null) return overlay.instanceKey === selectedKey;
    const overlayStart = overlay.start_date ?? null;
    // Both sides carry a start date → skip only the matching instance.
    if (selectedStart != null && overlayStart != null) return overlayStart === selectedStart;
    // Selected side has identity but the overlay doesn't (legacy payload):
    // keep the sibling visible rather than hiding a possibly different instance.
    if (selectedStart != null && overlayStart == null) return false;
    return true;
  };
  const groups: Array<{ id?: string; name: string; lines: Trendline[]; selected: boolean }> = [];
  if ((trendlines?.length ?? 0) > 0) {
    groups.push({
      id: hit?.pattern_id,
      name: hit?.pattern_name || "Pattern",
      lines: trendlines as Trendline[],
      selected: true,
    });
  }
  if (!compact && overlays?.length) {
    overlays.forEach((overlay) => {
      if (!overlay?.trendlines?.length) return;
      if (isSelectedOverlay(overlay)) return;
      groups.push({
        id: overlay.pattern_id,
        name: overlay.pattern_name || overlay.pattern_id || "Pattern",
        lines: overlay.trendlines,
        selected: false,
      });
    });
  }

  const legendData: string[] = [];
  // Two sibling instances can share a display name ("Rising Wedge" twice). ECharts
  // merges same-named series in the legend/tooltip, so disambiguate repeats with
  // a suffix while the first instance keeps the clean readable name.
  const nameCounts = new Map<string, number>();
  groups.forEach((group, index) => {
    const mapped = mapTrendlines(group.lines, times);
    if (mapped.length === 0) return;
    const color = PATTERN_COLORS[index % PATTERN_COLORS.length];
    const seen = nameCounts.get(group.name) ?? 0;
    nameCounts.set(group.name, seen + 1);
    const seriesName = seen === 0 ? group.name : `${group.name} (${seen + 1})`;
    mapped.forEach((points, lineIndex) => {
      // A degenerate single-point trendline draws nothing as a line — dot-mark
      // it so the structure is still visible instead of silently vanishing.
      const singlePoint = points.length <= 1;
      series.push({
        type: "line",
        name: seriesName,
        showSymbol: singlePoint ? true : false,
        symbol: singlePoint ? "circle" : undefined,
        symbolSize: singlePoint ? 6 : undefined,
        connectNulls: true,
        silent: true,
        data: pointsToSeriesData(points, times.length),
        lineStyle: {
          width: group.selected ? (large ? 3 : 2.5) : large ? 2 : 1.5,
          color,
          type: group.selected ? "solid" : "dashed",
          opacity: singlePoint ? 0 : group.selected ? 1 : 0.8,
        },
        // Inline pattern name at the end of the first boundary line, so each
        // dashed/solid line is labelled on the chart itself (not just the legend).
        endLabel:
          !compact && lineIndex === 0
            ? {
                show: true,
                formatter: seriesName,
                color,
                fontSize: large ? 12 : 10,
                fontWeight: group.selected ? 600 : 400,
                distance: 6,
                padding: [2, 4],
                borderRadius: 3,
                backgroundColor: CHART_OVERLAY,
              }
            : undefined,
        // Overlapping end labels (sibling instances close together) hide
        // instead of painting over each other.
        labelLayout: !compact && lineIndex === 0 ? { hideOverlap: true } : undefined,
        z: group.selected ? 3 : 2,
      });
    });
    if (!legendData.includes(seriesName)) legendData.push(seriesName);
  });

  // Auto-computed standalone support/resistance lines (`trend_lines`): one
  // straight start→end segment per line, drawn above the candles. View-only —
  // `trendlinesView` only controls which kinds are painted, never which
  // symbols/patterns match.
  const standalone = standaloneTrendLines ?? hit?.trend_lines ?? [];
  const visibleStandalone =
    trendlinesView === "none"
      ? []
      : standalone.filter((line) =>
          trendlinesView === "both" ? true : line?.kind === trendlinesView,
        );
  visibleStandalone.forEach((line) => {
    if (!line) return;
    const name = line.kind === "support" ? "TLS" : "TLR";
    const color = line.kind === "support" ? POSITIVE : NEGATIVE;
    const points = mapTimeSegment(line.start_date, line.start_price, line.end_date, line.end_price, times);
    if (!points || points.length === 0) return;
    // A degenerate single-point line draws nothing as a line — dot-mark it.
    const singlePoint = points.length <= 1;
    series.push({
      type: "line",
      name,
      showSymbol: singlePoint ? true : false,
      symbol: singlePoint ? "circle" : undefined,
      symbolSize: singlePoint ? 6 : undefined,
      connectNulls: true,
      silent: true,
      data: pointsToSeriesData(points, times.length),
      lineStyle: {
        width: large ? 2 : 1.5,
        color,
        type: "solid",
        opacity: singlePoint ? 0 : 1,
      },
      // Inline touch count at the end of the line, matching the boundary
      // end-label style (suppressed on compact sparklines like all labels).
      endLabel: !compact
        ? {
            show: true,
            formatter: `${name} · ${line.touches} touches`,
            color,
            fontSize: large ? 12 : 10,
            fontWeight: 600,
            distance: 6,
            padding: [2, 4],
            borderRadius: 3,
            backgroundColor: CHART_OVERLAY,
          }
        : undefined,
      labelLayout: !compact ? { hideOverlap: true } : undefined,
      z: 4,
    });
    if (!compact && !legendData.includes(name)) legendData.push(name);
  });

  // Swing pivots that define the pattern: up/down triangles at their real
  // timestamp mapped onto the category axis (full charts only — card sparklines
  // stay clean). Highs are red pointing down; lows green pointing up.
  const pivotMarkers: Array<{ index: number; price: number; kind: "high" | "low" }> = [];
  if (!compact && hit?.pivots?.length && times.length > 0) {
    hit.pivots.forEach((pivot) => {
      if (!pivot || !pivot.t) return;
      const [point] = mapTrendlines([[{ t: pivot.t, price: pivot.price }]], times);
      const mappedPoint = point?.[0];
      if (!mappedPoint || mappedPoint.index < 0) return;
      pivotMarkers.push({
        index: mappedPoint.index,
        price: mappedPoint.price,
        kind: pivot.kind === "low" ? "low" : "high",
      });
    });
  }

  if (pivotMarkers.length > 0) {
    const markerSize = large ? 12 : 9;
    const highs = pivotMarkers.filter((p) => p.kind === "high");
    const lows = pivotMarkers.filter((p) => p.kind === "low");
    if (highs.length > 0) {
      legendData.push("Pivot High");
      series.push({
        type: "scatter",
        name: "Pivot High",
        symbol: "triangle",
        symbolRotate: 180,
        symbolSize: markerSize,
        itemStyle: { color: NEGATIVE },
        z: 4,
        data: highs.map((p) => [p.index, p.price]),
      });
    }
    if (lows.length > 0) {
      legendData.push("Pivot Low");
      series.push({
        type: "scatter",
        name: "Pivot Low",
        symbol: "triangle",
        symbolRotate: 0,
        symbolSize: markerSize,
        itemStyle: { color: POSITIVE },
        z: 4,
        data: lows.map((p) => [p.index, p.price]),
      });
    }
  }

  const fontSize = large ? 12 : 10;

  return {
    animation: false,
    grid: compact
      ? { left: 2, right: 2, top: 6, bottom: 2 }
      : { left: large ? 64 : 54, right: large ? 96 : 64, top: large ? 48 : 32, bottom: showZoom ? (large ? 64 : 52) : 42 },
    tooltip: compact
      ? { show: false }
      : {
          trigger: "axis",
          axisPointer: {
            type: "cross",
            label: { formatter: (p: { value?: unknown }) => formatChartTimestamp(String(p.value ?? "")) },
          },
          formatter: formatPatternTooltip,
        },
    legend: compact
      ? undefined
      : {
          show: legendData.length > 0,
          top: 0,
          left: "center",
          itemWidth: 14,
          itemHeight: 8,
          textStyle: { color: CHART_MUTED, fontSize },
          data: legendData,
        },
    dataZoom: showZoom
      ? [
          { type: "inside", throttle: 50 },
          { type: "slider", height: large ? 22 : 18, bottom: large ? 12 : 6, borderColor: CHART_SPLIT, textStyle: { color: CHART_MUTED, fontSize } },
        ]
      : undefined,
    xAxis: {
      type: "category",
      data: times,
      show: !compact,
      boundaryGap: true,
      axisLabel: { fontSize, color: CHART_MUTED, formatter: (value: string) => formatChartTick(value) },
      axisLine: { lineStyle: { color: CHART_SPLIT } },
    },
    yAxis: {
      type: "value",
      scale: true,
      show: !compact,
      axisLabel: { fontSize, color: CHART_MUTED },
      splitLine: { lineStyle: { color: CHART_SPLIT } },
    },
    series: series as never,
  };
}
