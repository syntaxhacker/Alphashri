/**
 * Data ramps for the sector-history visuals.
 *
 * Every anchor lives in `src/ui/palette.ts` as the single source of colour; this
 * module only samples and maps values into those ramps. Neutral, muted and ink
 * reuse the global surface/text tokens instead of near-miss copies, and the
 * WCAG maths comes from `src/utils/contrast.ts`.
 */

import {
  CHART_INK_DARK,
  CHART_INK_LIGHT,
  CHART_MUTED,
  CHART_NEUTRAL,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_RANK_STOPS,
  CHART_SHARE_STOPS,
} from "@/ui/palette";
import { interpolateHex } from "@/utils/color";
import { contrastRatio } from "@/utils/contrast";

export {
  CHART_CURRENT,
  CHART_LINE,
  CHART_MUTED,
  CHART_NEGATIVE,
  CHART_NEUTRAL,
  CHART_POSITIVE,
  CHART_TOP3,
  CHART_RANK_STOPS as RANK_STOPS,
  CHART_SHARE_STOPS as SHARE_STOPS,
} from "@/ui/palette";

const MIN_TEXT_CONTRAST = 4.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Sample a multi-stop ramp by normalised position. */
export function sampleStops(stops: readonly string[], t: number): string {
  if (stops.length === 0) return CHART_MUTED;
  if (stops.length === 1) return stops[0];
  const position = clamp01(t) * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  return interpolateHex(stops[lower], stops[upper], position - lower);
}

/** Rank fill, 1 = RANK_STOPS[0]. Invalid ranks fall back to muted. */
export function rankColor(rank: number, count: number): string {
  if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 0) {
    return CHART_MUTED;
  }
  const total = Math.max(1, Math.round(count));
  const clamped = Math.max(1, Math.min(total, Math.round(rank)));
  if (total === 1) return CHART_RANK_STOPS[0];
  return sampleStops(CHART_RANK_STOPS, (clamped - 1) / (total - 1));
}

function bestTextContrast(fill: string): number {
  return Math.max(contrastRatio(fill, CHART_INK_LIGHT), contrastRatio(fill, CHART_INK_DARK));
}

/**
 * The hue path from neutral to a bright sign colour crosses a narrow luminance
 * band where neither off-white nor black reaches 4.5:1. Lift only those fills
 * toward the sign colour; endpoints and dark low-magnitude values stay put.
 */
function liftForText(fill: string, anchor: string): string {
  if (bestTextContrast(fill) >= MIN_TEXT_CONTRAST) return fill;
  for (let step = 1; step <= 20; step++) {
    const candidate = interpolateHex(fill, anchor, step / 20);
    if (bestTextContrast(candidate) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return anchor;
}

/**
 * Signed-return fill: blue for negative, orange for positive, neutral at zero.
 * Magnitude controls the distance from neutral, capped at `maxAbs`.
 */
export function returnColor(value: number, maxAbs: number): string {
  if (!Number.isFinite(value) || value === 0) return CHART_NEUTRAL;
  const magnitude = Math.abs(value);
  const span = Number.isFinite(maxAbs) && maxAbs > 0 ? Math.abs(maxAbs) : magnitude;
  const t = clamp01(magnitude / span);
  const anchor = value < 0 ? CHART_NEGATIVE : CHART_POSITIVE;
  return liftForText(interpolateHex(CHART_NEUTRAL, anchor, t), anchor);
}

/** Share fill: dark at zero, cyan at `max`. */
export function shareColor(value: number, max: number): string {
  if (!Number.isFinite(value)) return CHART_SHARE_STOPS[0];
  const ceiling = Number.isFinite(max) && max > 0 ? max : 1;
  return sampleStops(CHART_SHARE_STOPS, clamp01(value / ceiling));
}
