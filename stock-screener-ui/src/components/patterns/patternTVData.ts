import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
  TrendlinesView,
  Trendline,
} from "@/types/chartPatterns";
import { PATTERN_SERIES_COLORS } from "@/config/patterns";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { mapTimeSegment, mapTrendlines } from "./trendlineMapping";
import { toEpochSeconds as toTVTime } from "@/utils/chart/time";

/**
 * Colours assigned in order to the patterns drawn on one chart: the selected
 * pattern takes the first colour, its siblings the next ones. Backward-compatible
 * alias of the shared `PATTERN_SERIES_COLORS` in `@/config/patterns` so the
 * TradingView adapter draws each pattern in the same colour as the ECharts
 * fullscreen view.
 */
export const PATTERN_TV_COLORS: string[] = PATTERN_SERIES_COLORS;

/** @deprecated Use `@/utils/chart/time.toEpochSeconds` directly for new code. */
export { toTVTime };

export interface TVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TVVolume {
  time: number;
  value: number;
  color: string;
}

export interface TVLevel {
  price: number;
  color: string;
  title: string;
  lineStyle: "solid" | "dashed";
  width: number;
}

export interface TVLinePoint {
  time: number;
  value: number;
}

export interface TVLine {
  points: TVLinePoint[];
  color: string;
  dashed: boolean;
  width: number;
  name: string;
  /** Inline end-label text (e.g. `"TLS · 4 touches"`); falls back to `name`. */
  label?: string;
  /**
   * Whether this line draws an inline end label. Only a pattern group's first
   * boundary line is eligible (mirrors the ECharts fullscreen), so a pattern's
   * two boundaries never print the same name twice.
   */
  labelEligible?: boolean;
  /** Anchor the inline label at the line's first point (history) or last (selected). */
  labelAt?: "start" | "end";
}

export interface TVMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar" | "atPriceMiddle";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text: string;
  price?: number;
  size?: number;
  group?: "pivots" | "keypoints";
}

/** An overlay bundle, optionally carrying instance identity (mirrors `SiblingOverlay`). */
export type TVSiblingOverlay = PatternOverlay & {
  start_date?: string | null;
  instanceKey?: string | null;
};

export interface BuildPatternTVDataInput {
  candles: ChartCandle[];
  hit?: PatternHitDTO | null;
  overlays?: TVSiblingOverlay[];
  /**
   * Standalone support/resistance lines. Defaults to the hit's own
   * `trend_lines` when omitted (same fallback as the ECharts builder).
   */
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  /** Last N hits (newest first) to draw as historical patterns. */
  historyHits?: PatternHitDTO[];
}

export interface BuildPatternTVDataResult {
  candles: TVCandle[];
  volume: TVVolume[];
  levels: TVLevel[];
  lines: TVLine[];
  markers: TVMarker[];
}

function byTimeAsc(a: { time: number }, b: { time: number }): number {
  return a.time - b.time;
}

/**
 * Keep the last point per epoch and sort ascending. lightweight-charts throws
 * "data must be asc ordered by time" on duplicate times, which happens when a
 * trendline's two endpoints clamp onto the same candle (e.g. a pattern whose
 * start/end fall outside the visible window).
 */
function dedupeByTime(points: TVLinePoint[]): TVLinePoint[] {
  const byTime = new Map<number, TVLinePoint>();
  for (const p of points) byTime.set(p.time, p);
  return [...byTime.values()].sort(byTimeAsc);
}

/**
 * Pure mapper turning the same inputs the ECharts builder gets into
 * lightweight-charts data: sorted/unique candles + volume, horizontal
 * breakout/target/stop levels, pattern boundary trendlines + standalone
 * TLS/TLR 2-point segments, and pivot markers.
 */
export function buildPatternTVData({
  candles,
  hit,
  overlays,
  trendLines,
  trendlinesView = "both",
  historyHits = [],
}: BuildPatternTVDataInput): BuildPatternTVDataResult {
  const empty: BuildPatternTVDataResult = { candles: [], volume: [], levels: [], lines: [], markers: [] };
  const times = candles.map((c) => c.t);
  if (times.length === 0) return empty;

  /** Epoch per candle index; non-finite when the timestamp is unparseable. */
  const epochAt = (index: number): number =>
    index >= 0 && index < times.length ? toTVTime(times[index] as string) : NaN;

  // Candles: dedupe by epoch (last bar wins), sorted ascending.
  const byEpoch = new Map<number, ChartCandle>();
  for (const c of candles) {
    const t = toTVTime(c.t);
    if (!Number.isFinite(t)) continue;
    byEpoch.set(t, c);
  }
  const sortedEpochs = [...byEpoch.keys()].sort((a, b) => a - b);
  const tvCandles: TVCandle[] = sortedEpochs.map((t) => {
    const c = byEpoch.get(t) as ChartCandle;
    return { time: t, open: c.o, high: c.h, low: c.l, close: c.c };
  });
  const volume: TVVolume[] = sortedEpochs.map((t) => {
    const c = byEpoch.get(t) as ChartCandle;
    return {
      time: t,
      value: c.v,
      color: c.c >= c.o ? withAlpha(POSITIVE, 0.9) : withAlpha(NEGATIVE, 0.9),
    };
  });

  // Breakout/target/stop levels intentionally omitted: risk sizing is the
  // trader's job, not the pattern engine's.
  const levels: TVLevel[] = [];

  // Pattern boundary groups: the selected pattern solid, siblings dashed.
  const selectedId = hit?.pattern_id;
  const selectedStart = hit?.start_date ?? null;
  const isSelectedOverlay = (overlay: TVSiblingOverlay): boolean => {
    if (!selectedId || overlay.pattern_id !== selectedId) return false;
    if (overlay.instanceKey != null || (hit as { instanceKey?: string | null } | null)?.instanceKey != null) {
      return overlay.instanceKey === (hit as { instanceKey?: string | null } | null)?.instanceKey;
    }
    const overlayStart = overlay.start_date ?? null;
    if (selectedStart != null && overlayStart != null) return overlayStart === selectedStart;
    if (selectedStart != null && overlayStart == null) return false;
    return true;
  };
  const groups: Array<{ name: string; lines: Trendline[]; selected: boolean; labelAt?: "start" | "end" }> = [];
  if ((hit?.trendlines?.length ?? 0) > 0) {
    groups.push({
      name: hit?.pattern_name || "Pattern",
      lines: hit?.trendlines as Trendline[],
      selected: true,
    });
  }
  (overlays ?? []).forEach((overlay) => {
    if (!overlay?.trendlines?.length) return;
    if (isSelectedOverlay(overlay)) return;
    groups.push({
      name: overlay.pattern_name || overlay.pattern_id || "Pattern",
      lines: overlay.trendlines,
      selected: false,
      labelAt: "start",
    });
  });

  // Historical patterns from the chart's History selector. The selected hit is
  // already group 0, so the others are labelled P2, P3, ... in the legend.
  const selectedKey = hit ? `${hit.pattern_id}|${hit.start_date}` : null;
  let historyNo = 1;
  historyHits.forEach((h) => {
    if (!h?.trendlines?.length) return;
    if (selectedKey && `${h.pattern_id}|${h.start_date}` === selectedKey) return;
    historyNo += 1;
    groups.push({
      name: `P${historyNo} · ${h.pattern_name || h.pattern_id}`,
      lines: h.trendlines as Trendline[],
      selected: false,
      labelAt: "start",
    });
  });

  // Two sibling instances can share a display name; disambiguate repeats while
  // the first instance keeps the clean readable name (same as ECharts).
  const nameCounts = new Map<string, number>();
  const lines: TVLine[] = [];
  groups.forEach((group, index) => {
    const mapped = mapTrendlines(group.lines, times);
    if (mapped.length === 0) return;
    const color = PATTERN_TV_COLORS[index % PATTERN_TV_COLORS.length] as string;
    const seen = nameCounts.get(group.name) ?? 0;
    nameCounts.set(group.name, seen + 1);
    const name = seen === 0 ? group.name : `${group.name} (${seen + 1})`;
    mapped.forEach((points, lineIndex) => {
      const tvPoints = dedupeByTime(
        points
          .map((p) => ({ time: epochAt(p.index), value: p.price }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)),
      );
      if (tvPoints.length === 0) return;
      // Only the group's first boundary line is labelled (ECharts fullscreen's
      // `lineIndex === 0` rule), so a pattern prints its name once.
      const labelEligible = lineIndex === 0;
      lines.push({
        points: tvPoints,
        color,
        dashed: !group.selected,
        width: group.selected ? 2 : 1,
        name,
        label: labelEligible ? name : undefined,
        labelEligible,
        labelAt: group.labelAt ?? "end",
      });
    });
  });

  // Standalone support/resistance 2-point segments, gated by the view filter.
  const standalone = trendLines ?? hit?.trend_lines ?? [];
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
    const tvPoints = dedupeByTime(
      points
        .map((p) => ({ time: epochAt(p.index), value: p.price }))
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value)),
    );
    if (tvPoints.length === 0) return;
    lines.push({
      points: tvPoints,
      color,
      dashed: false,
      width: 1,
      name,
      label: `${name} · ${line.touches} touches`,
      labelEligible: true,
    });
  });
  lines.sort((a, b) => (a.points[0]?.time ?? 0) - (b.points[0]?.time ?? 0));

  // Pivot/key-point dot markers removed: the chart draws lines only.
  const markers: TVMarker[] = [];

  return { candles: tvCandles, volume, levels, lines, markers };
}
