/**
 * Dedicated data-chart palette for sector-history visuals.
 *
 * These hues are intentionally separate from the UI chrome (amber PRIMARY):
 * charts carry data, chrome carries controls. Keeping the scales here means a
 * chart can be retuned without moving the rest of the terminal, and every
 * generated fill is contrast-checked in `paletteFeature.test.tsx`.
 */

/** Single-series line. */
export const CHART_LINE = "#7DD3FC";
/** Top-3 accent shared by ranks, movers and transition nodes. */
export const CHART_TOP3 = "#F2CC60";
/** Current-state accent (dot, selection, "now" side of a transition). */
export const CHART_CURRENT = "#56D4DD";
/** Inactive / previous / axis annotation ink for chart marks. */
export const CHART_MUTED = "#94A3B8";
/** Signed return: negative side (blue, not the UI red). */
export const CHART_NEGATIVE = "#4C9AFF";
/** Signed return: positive side (orange, not the UI green). */
export const CHART_POSITIVE = "#F59E0B";
/** Zero / no-move fill. */
export const CHART_NEUTRAL = "#1F242D";

/** Rank ramp: 1 (strongest) through N (weakest). */
export const RANK_STOPS = [
  "#F2CC60",
  "#C9E265",
  "#67D4D0",
  "#2E9BC6",
  "#1D6FA5",
  "#123B5E",
  "#0B1F33",
] as const;

/** Share-of-total ramp: zero intensity through a full bar. */
export const SHARE_STOPS = ["#0B1F33", "#123B5E", "#1D6FA5", "#2E9BC6", "#56D4DD"] as const;

/**
 * Okabe-Ito-derived categorical hues, lifted where the original ink would sink
 * into the dark panel. Use only when direct labels are impossible — identity
 * should normally come from a label or position, not a colour legend.
 */
export const CATEGORICAL = [
  "#56B4E9", // sky blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#4C9AFF", // blue, lifted from Okabe-Ito #0072B2 for dark surfaces
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#B8C2CC", // grey, lifted from #999999
] as const;

const INK_LIGHT = "#E8E8E8";
const INK_DARK = "#000000";
const MIN_TEXT_CONTRAST = 4.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

type Channels = readonly [number, number, number];

function hexChannels(raw: string): Channels {
  const hex = raw.trim().replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => character + character)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(channels: Channels): string {
  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("")}`;
}

/** Linear RGB interpolation; `t` is clamped to 0..1. */
export function interpolateHex(a: string, b: string, t: number): string {
  const from = hexChannels(a);
  const to = hexChannels(b);
  const mix = clamp01(t);
  return toHex([
    from[0] + (to[0] - from[0]) * mix,
    from[1] + (to[1] - from[1]) * mix,
    from[2] + (to[2] - from[2]) * mix,
  ]);
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
  if (total === 1) return RANK_STOPS[0];
  return sampleStops(RANK_STOPS, (clamped - 1) / (total - 1));
}

function channelLuminance(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(fill: string): number {
  const [r, g, b] = hexChannels(fill);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function textContrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function bestTextContrast(fill: string): number {
  return Math.max(textContrast(fill, INK_LIGHT), textContrast(fill, INK_DARK));
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
  if (!Number.isFinite(value)) return SHARE_STOPS[0];
  const ceiling = Number.isFinite(max) && max > 0 ? max : 1;
  return sampleStops(SHARE_STOPS, clamp01(value / ceiling));
}
