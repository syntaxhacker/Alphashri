import { hhmmToMinutes } from "./tapeRange";
import type { buildOiHeatmap } from "./niftyOiHeatmap";

type Bucket = ReturnType<typeof buildOiHeatmap>["buckets"][number];

/** Bottom margin holds the 30-min ticks + the `time` axis caption. */
export const HEATMAP_PAD_B = 30;

export function clockMinutes(label: string): number | null {
  // Only bare HH:MM: the shared parser is start-anchored and would read "09:15:30".
  if (!/^(\d{1,2}):(\d{2})$/.test(label)) return null;
  return hhmmToMinutes(label);
}

export interface HeatmapScaleInput {
  vbW: number;
  vbH: number;
  padL: number;
  strikes: number[];
  cols: number;
}

export interface HeatmapScale {
  gridW: number;
  gridH: number;
  cellW: number;
  cellH: number;
  lo: number;
  hi: number;
  span: number;
  xOf(bucket: number): number;
  yOf(value: number): number;
  rowOf(strike: number): number;
}

/**
 * Single source for the plot's coordinate mapping. The canvas paint and every
 * SVG mark read the same scale, so they stay aligned at both 1000-unit and
 * measured-pixel viewBox widths.
 */
export function createHeatmapScale(input: HeatmapScaleInput): HeatmapScale {
  const { vbW, vbH, padL, strikes, cols } = input;
  const gridW = vbW - padL;
  const gridH = vbH - HEATMAP_PAD_B;
  const cellW = gridW / Math.max(1, cols);
  const cellH = gridH / Math.max(1, strikes.length);
  // Empty models never paint, so the fallback bounds only keep the geometry
  // finite for the derived helpers below.
  const lo = strikes.length > 0 ? strikes[0] : 0;
  const hi = strikes.length > 0 ? strikes[strikes.length - 1] : 1;
  const span = Math.max(1, hi - lo);
  return {
    gridW,
    gridH,
    cellW,
    cellH,
    lo,
    hi,
    span,
    xOf(bucket) {
      return padL + bucket * cellW + cellW / 2;
    },
    yOf(value) {
      const clamped = Math.min(hi, Math.max(lo, value));
      return gridH - ((clamped - lo) / span) * gridH;
    },
    rowOf(strike) {
      return strikes.length - 1 - strikes.indexOf(strike);
    },
  };
}

export interface TimeTick {
  i: number;
  label: string;
}

/**
 * Ticks on the 30-min wall-clock marks. With 1-min buckets a bucket starts on
 * :00/:30; with 5m/15m aggregation the buckets are offset from the tape's
 * first minute (09:32), so we place the tick on the bucket CONTAINING each
 * half-hour and label it with the wall-clock time, not the bucket start.
 */
export function computeTimeTicks(buckets: Bucket[]): TimeTick[] {
  const out: TimeTick[] = [];
  const starts = buckets.map((b) => clockMinutes(b.startLabel));
  const first = starts.find((m): m is number => m !== null);
  const lastIdx = [...starts].reverse().find((m): m is number => m !== null);
  if (first === undefined || lastIdx === undefined) return out;
  for (let t = Math.ceil(first / 30) * 30; t <= lastIdx; t += 30) {
    // Nearest bucket to the wall-clock mark (buckets can be offset from :00
    // by the tape's first minute, especially at 5m/15m aggregation).
    let best = -1;
    let bestDistance = Infinity;
    starts.forEach((m, i) => {
      if (m === null) return;
      const d = Math.abs(m - t);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    if (best >= 0 && !out.some((x) => x.i === best)) {
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      out.push({ i: best, label: `${hh}:${mm}` });
    }
  }
  if (out.length === 0 && buckets.length > 0) {
    out.push({ i: 0, label: buckets[0].startLabel });
    if (buckets.length > 1) {
      out.push({ i: buckets.length - 1, label: buckets[buckets.length - 1].startLabel });
    }
  }
  return out;
}

export interface FlipGuide {
  x: number;
  label: string;
}

/** Flow-flip guide: map the flip's HH:MM into the bucket coordinate system.
 *  Null when the stamp predates the plotted window. */
export function computeFlipX(
  flipAt: string | null | undefined,
  buckets: Bucket[],
  bucketMin: number,
  xOf: (bucket: number) => number,
): FlipGuide | null {
  if (!flipAt || buckets.length === 0) return null;
  const time = flipAt.includes("T") ? flipAt.split("T")[1] ?? "" : flipAt;
  const flipMin = clockMinutes(time.slice(0, 5));
  const first = clockMinutes(buckets[0].startLabel);
  if (flipMin === null || first === null || flipMin < first) return null;
  const idx = Math.max(
    0,
    Math.min(buckets.length - 1, Math.floor((flipMin - first) / Math.max(1, bucketMin))),
  );
  return { x: xOf(idx), label: time.slice(0, 5) };
}

export interface StrikeLabels {
  every: number[];
  showAll: boolean;
}

export function strikeLabels(strikes: number[]): StrikeLabels {
  const every = strikes.filter((s) => Math.round(s) % 100 === 0);
  return { every, showAll: every.length === 0 };
}
