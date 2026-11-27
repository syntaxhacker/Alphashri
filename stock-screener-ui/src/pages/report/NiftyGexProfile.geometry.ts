import type {
  MiniMarker,
  MiniSeries,
} from "@/components/common/charts/MiniLineChart";
import * as palette from "@/ui/palette";
import type { GexProfilePoint } from "./niftyGex";
import { formatGexStrike } from "./NiftyGexProfile.format";
import type { GexProfileStats } from "./NiftyGexProfile.levels";

export interface GexChartProps {
  labels: string[];
  series: MiniSeries[];
  markers: MiniMarker[];
  zeroLine: boolean;
  band: GexProfilePoint[];
  significant: number;
}

export interface GexBand {
  points: GexProfilePoint[];
  threshold: number;
  significant: number;
}

/**
 * Share of the peak |netGex| below which a strike is treated as noise.
 *
 * The raw profile is long-tailed: on a real 19-Oct tape the peak strike held
 * ~6,500 Cr while the median strike held ~74 Cr, and far-OTM strikes reported
 * tiny non-zero gammas out to the wings. Plotting those wings stretched the
 * x-axis over 4,200 points and squashed the actionable band into a sliver.
 * 1% of the peak keeps every wall that can actually move the tape while
 * dropping the off-strike dust.
 */
export const GEX_SIGNIFICANCE_SHARE = 0.01;

export function selectGexBand(
  profile: GexProfilePoint[],
  opts: { minShare?: number; include?: (number | null | undefined)[] } = {},
): GexBand {
  if (profile.length === 0) return { points: [], threshold: 0, significant: 0 };

  const peak = profile.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0);
  const threshold = peak * (opts.minShare ?? GEX_SIGNIFICANCE_SHARE);
  const significant = profile.filter((p) => Math.abs(p.netGex) > threshold).length;
  if (peak === 0) return { points: [], threshold: 0, significant: 0 };

  let first = -1;
  let last = -1;
  profile.forEach((p, i) => {
    if (Math.abs(p.netGex) > threshold) {
      if (first === -1) first = i;
      last = i;
    }
  });
  if (first === -1) return { points: [], threshold, significant };

  for (const v of opts.include ?? []) {
    if (v == null || !Number.isFinite(v)) continue;
    const i = profile.findIndex((p) => p.strike === v);
    if (i === -1) continue;
    if (i < first) first = i;
    if (i > last) last = i;
  }

  return { points: profile.slice(first, last + 1), threshold, significant };
}

export function trimGexProfile(
  profile: GexProfilePoint[],
  opts: { minShare?: number; include?: (number | null | undefined)[] } = {},
): GexProfilePoint[] {
  return selectGexBand(profile, opts).points;
}

/**
 * Index of the band strike closest to `value`, or -1 when `value` sits outside
 * the band. Spot is a continuous price (e.g. 22,873.55) that essentially never
 * lands exactly on the 50-point strike grid, so exact matching would mean the
 * SPOT marker never drew at all. Snapping to the nearest strike keeps it
 * visible; refusing to snap outside the band avoids implying spot is at an
 * edge strike when it is not.
 */
export function nearestStrikeIndex(profile: GexProfilePoint[], value: number): number {
  if (!Number.isFinite(value) || profile.length === 0) return -1;
  const lo = profile[0].strike;
  const hi = profile[profile.length - 1].strike;
  if (value < lo || value > hi) return -1;
  let best = -1;
  let bestDist = Infinity;
  profile.forEach((p, i) => {
    const d = Math.abs(p.strike - value);
    if (d < bestDist || (d === bestDist && i < best)) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/**
 * Pure MiniLineChart prop builder (unit-testable). The plotted window is the
 * significance band from `selectGexBand`, widened to keep the flip level and
 * the strike nearest spot inside it. Markers:
 *   - vertical `SPOT` line at the strike nearest spot
 *   - vertical `ZERO` line at the zero-gamma strike, unless it collides with
 *     the SPOT line
 * The zero reference line is always on (`zeroLine: true`).
 */
export function buildGexChart(
  profile: GexProfilePoint[],
  stats: GexProfileStats,
  spot: number,
): GexChartProps {
  const spotIdxFull = nearestStrikeIndex(profile, spot);
  const spotStrike = spotIdxFull >= 0 ? profile[spotIdxFull].strike : null;
  const { points: band, significant } = selectGexBand(profile, {
    include: [stats.zeroCross, spotStrike],
  });

  const labels = band.map((p) => formatGexStrike(p.strike));
  const series: MiniSeries[] = [
    {
      name: "Net GEX",
      points: band.map((p) => p.netGex),
      color: palette.TERM_GAMMA,
      area: true,
      axis: 0,
    },
  ];

  const markers: MiniMarker[] = [];
  const strikes = band.map((p) => p.strike);
  const spotIdx = nearestStrikeIndex(band, spot);
  if (spotIdx >= 0) {
    markers.push({ index: spotIdx, label: "SPOT", color: palette.TERM_SPOT });
  }
  if (stats.zeroCross != null) {
    const zeroIdx = strikes.indexOf(stats.zeroCross);
    // SPOT is pushed first and wins the strike when both land on it, so two
    // dashed lines are never stacked on one x position.
    if (zeroIdx >= 0 && zeroIdx !== spotIdx) {
      markers.push({ index: zeroIdx, label: "ZERO", color: palette.TERM_FLIP });
    }
  }

  return { labels, series, markers, zeroLine: true, band, significant };
}
