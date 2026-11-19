import { formatNumberIN } from "@/utils/ui-helpers";
import type { MarkLineData } from "@/utils/chart/types";
import * as palette from "@/ui/palette";

/**
 * Draw a detected chart pattern on the Nifty chart — pure, no React.
 *
 * The detector already returns the geometry (`trendlines` as 3-point polylines)
 * plus the three actionable levels (breakout / target / stop). The chart
 * component needs none of that: diagonal lines are just index-aligned line
 * series (`emaData`), horizontal levels are `markLines`. So the overlay is a
 * data transform, not a chart change.
 */

export interface PatternTrendPoint {
  t: string;
  price: number;
}

export interface PatternHitLike {
  pattern_id: string;
  pattern_name: string;
  direction: "bullish" | "bearish" | "neutral";
  status: "forming" | "confirmed" | "failed" | "marginal";
  breakout_level?: number | null;
  target?: number | null;
  stop?: number | null;
  trendlines?: PatternTrendPoint[][];
}

export interface PatternOverlayLine {
  label: string;
  color: string;
  data: (number | null)[];
}

export interface PatternOverlay {
  lines: PatternOverlayLine[];
  markLines: MarkLineData[];
}

/** Candle/trendline timestamps are absolute instants; a missing offset is IST. */
export function epochSeconds(t: string): number | null {
  if (!t) return null;
  const s = t.includes("T") ? t : t.replace(" ", "T");
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const ms = Date.parse(hasOffset ? s : `${s}+05:30`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Nearest bar index within `tolSec` (a trendline point must land on a bar). */
function nearestIndex(times: number[], sec: number, tolSec = 120): number | null {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - sec);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best >= 0 && bestDistance <= tolSec ? best : null;
}

function level(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function fmt(v: number): string {
  return formatNumberIN(Math.round(v));
}

export function buildPatternOverlay(
  hit: PatternHitLike,
  candles: Array<{ time: string }>,
): PatternOverlay {
  const empty: PatternOverlay = { lines: [], markLines: [] };
  if (!hit || !Array.isArray(candles) || candles.length === 0) return empty;

  const times = candles.map((c) => epochSeconds(c.time));
  const color = hit.direction === "bullish" ? palette.POSITIVE : palette.NEGATIVE;

  const lines: PatternOverlayLine[] = [];
  for (const [k, trend] of (hit.trendlines ?? []).entries()) {
    if (!Array.isArray(trend) || trend.length < 2) continue;
    const pts = trend
      .map((p) => {
        const sec = epochSeconds(String(p?.t ?? ""));
        const idx = sec == null ? null : nearestIndex(times as number[], sec);
        return idx == null ? null : { idx, price: Number(p.price) };
      })
      .filter((p): p is { idx: number; price: number } => p != null && Number.isFinite(p.price))
      .sort((a, b) => a.idx - b.idx);
    if (pts.length < 2) continue;

    const data: (number | null)[] = Array.from({ length: candles.length }, () => null);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let j = a.idx; j <= b.idx; j++) {
        const f = b.idx === a.idx ? 0 : (j - a.idx) / (b.idx - a.idx);
        data[j] = a.price + (b.price - a.price) * f;
      }
    }
    lines.push({ label: `PATTERN ${hit.pattern_id} ${k + 1}`, color, data });
  }

  const markLines: MarkLineData[] = [];
  const push = (
    v: number | null,
    label: string,
    lineColor: string,
    type: "solid" | "dashed",
    includeInScale = true,
  ) => {
    if (v == null) return;
    markLines.push({
      yAxis: v,
      includeInScale,
      lineStyle: { color: lineColor, type, width: 1 },
      label: { position: "insideEndTop", formatter: `${label} ${fmt(v)}` },
    });
  };

  push(level(hit.breakout_level), "P▸BRK", color, "solid");
  // A failed pattern's target/stop are void by definition — trendlines only.
  if (hit.status !== "failed") {
    const opposite = hit.direction === "bullish" ? palette.NEGATIVE : palette.POSITIVE;
    // The target is often hundreds of points away; drawing it is useful,
    // widening the price scale to fit it is not (the candles squash).
    push(level(hit.target), "P▸TGT", color, "dashed", false);
    push(level(hit.stop), "P▸SL", opposite, "dashed");
  }

  return { lines, markLines };
}

/** Honest empty-result copy: the requested lookback, not a guess at a hit. */
export function patternNoHitLabel(tf: string, lookbackBars: number): string {
  return `up to ${lookbackBars} × ${tf} bars · no pattern`;
}

export interface PatternScanAnnotation {
  /** Short label for the in-chart badge. */
  label: string;
  /** A dot on the last displayed bar marking the scan event — never a hit. */
  marker: {
    time: string;
    value: number;
    shape: "circle";
    color: string;
    position: "aboveBar";
    size: number;
    text: string;
  };
  /** Displayed bars inside the requested window (the detector owns its own feed). */
  windowBars: number;
}

/**
 * A completed scan with no hit still has something true to show: the window it
 * covered and the fact that it ran. The marker is pinned to the last displayed
 * bar so it reads as an annotation of the scan, not as a detected pivot or a
 * breakout — no price level is invented when the detector found nothing.
 */
export function buildPatternScanAnnotation(params: {
  candles: Array<{ time: string; close: number }>;
  timeframe: string;
  lookbackBars: number;
  hitCount: number;
  markerColor: string;
}): PatternScanAnnotation | null {
  const { candles, timeframe, lookbackBars, hitCount, markerColor } = params;
  if (hitCount > 0 || !Array.isArray(candles)) return null;
  const last = candles[candles.length - 1];
  if (!last || typeof last.close !== "number" || !Number.isFinite(last.close)) return null;
  return {
    label: patternNoHitLabel(timeframe, lookbackBars),
    windowBars: Math.min(Math.max(0, lookbackBars), candles.length),
    marker: {
      time: last.time,
      value: last.close,
      shape: "circle",
      color: markerColor,
      position: "aboveBar",
      size: 2,
      text: "",
    },
  };
}
