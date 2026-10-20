import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat } from "@/components/common/compact";
import { Text } from "@/ui";
import { spotVsFlip } from "./NiftyGammaTime";
import { MiniLineChart } from "@/components/common/charts/MiniLineChart";
import type {
  MiniMarker,
  MiniSeries,
} from "@/components/common/charts/MiniLineChart";
import type { NiftyGex } from "@/types/niftyReport";

/**
 * "Price × gamma" panel for the Nifty report.
 *
 * Honest mapping — the report supplies a per-strike net-GEX profile in
 * ₹ Cr per point (`report.gex`):
 *   - positive netGex  → dealers long gamma → price is a support magnet
 *   - negative netGex  → dealers short gamma → moves become volatility fuel
 *
 * Rendered with the dependency-free inline-SVG `MiniLineChart` (not ECharts):
 * these are static monitoring visuals, so a full canvas charting instance per
 * panel is not worth the bundle/heap cost.
 *
 * Reading it: only the strike band that actually carries gamma is plotted
 * (`trimGexProfile`). Upstox returns greeks for a subset of strikes — mostly
 * near the money — and every other strike comes back as a hard `0.0`, so
 * plotting all ~100 listed strikes drew ~85 dead points and stretched the
 * x-axis across the far-OTM wings: the profile collapsed into a flat line with
 * one spike in the middle. Inside the plotted band the line is the netGex
 * profile in strike order, a horizontal dashed line marks netGex = 0, and
 * vertical dashed markers point at the strike nearest SPOT and at the
 * ZERO-gamma flip. Absent/empty data degrades to a friendly empty state.
 */

/** A single point of the per-strike net-GEX profile (sorted ascending). */
export interface GexProfilePoint {
  strike: number;
  netGex: number;
}

/** Derived headline numbers for the panel's stat row. */
export interface GexProfileStats {
  netTotal: number | null;
  zeroCross: number | null;
  regime: string;
  peakStrike: number | null;
  troughStrike: number | null;
}

/** MiniLineChart-ready props for the profile chart. */
export interface GexChartProps {
  labels: string[];
  series: MiniSeries[];
  markers: MiniMarker[];
  zeroLine: boolean;
  /** Strike window actually plotted (drives the coverage caption). */
  band: GexProfilePoint[];
  /** Strikes at/above the significance cut in the whole profile. */
  significant: number;
}

/** Rendered for any absent numeric field so a cell never shows blank. */
export const GEX_DASH = "—";

function num(v: unknown): number {
  // `Number(null)` and `Number("")` are 0 — treat those as absent so a null
  // leg is dropped instead of being plotted as a genuine zero exposure.
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Per-strike profile, always ascending by strike. Drops rows whose strike or
 * netGex is missing / non-finite so a malformed payload can never crash the
 * chart or shift a label. Undefined / empty input yields `[]`.
 */
export function buildGexProfile(gex?: NiftyGex): GexProfilePoint[] {
  const strikes = Array.isArray(gex?.strikes) ? gex.strikes : [];
  return strikes
    .map((s) => ({ strike: num(s?.strike), netGex: num(s?.netGex) }))
    .filter((p) => Number.isFinite(p.strike) && Number.isFinite(p.netGex))
    .sort((a, b) => a.strike - b.strike);
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

/** Result of picking the strike window worth plotting. */
export interface GexBand {
  /** Contiguous slice of the profile (the plotted band). */
  points: GexProfilePoint[];
  /** Significance cut in Cr/pt (`peak * share`). */
  threshold: number;
  /** Strikes at/above the cut across the whole profile. */
  significant: number;
}

/**
 * Pick the strike band that actually carries dealer gamma.
 *
 * Upstox quotes greeks for a subset of strikes (mostly near the money); the
 * rest come back as a hard `0.0`, not as "no exposure". On top of that the
 * quoted far wings are near-zero noise. Plotting every listed strike drew a
 * flat line with a single spike — the chart looked broken because most of it
 * *was* dead space.
 *
 * The window is the first..last strike whose |netGex| reaches
 * `peak * minShare`; everything in between is kept (real flat spots included).
 * `include` forces context strikes — the gamma flip, the strike nearest spot —
 * into the window so their markers never fall off the plot.
 */
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

/** The plotted band only (`selectGexBand(...).points`). */
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
 * Headline stats. `netTotal` and `zeroCross` are straightforward passthroughs
 * (null when absent / non-finite). `peakStrike` / `troughStrike` are the
 * strikes holding the max / min netGex; ties break toward the strike nearest
 * `spot`, which keeps the marker deterministic on flat profiles.
 */
export function gexProfileStats(gex: NiftyGex | undefined, spot: number): GexProfileStats {
  const profile = buildGexProfile(gex);

  const distToSpot = (strike: number): number =>
    Number.isFinite(spot) ? Math.abs(strike - spot) : 0;

  let peak: GexProfilePoint | null = null;
  let trough: GexProfilePoint | null = null;
  for (const p of profile) {
    if (
      peak === null ||
      p.netGex > peak.netGex ||
      (p.netGex === peak.netGex && distToSpot(p.strike) < distToSpot(peak.strike))
    ) {
      peak = p;
    }
    if (
      trough === null ||
      p.netGex < trough.netGex ||
      (p.netGex === trough.netGex && distToSpot(p.strike) < distToSpot(trough.strike))
    ) {
      trough = p;
    }
  }

  const netTotal = num(gex?.netTotal);
  const rawZero = gex?.zeroCross;
  const zeroCross = rawZero != null && Number.isFinite(Number(rawZero)) ? Number(rawZero) : null;
  const regime = gex?.regime ? String(gex.regime).trim().toUpperCase() : "";

  return {
    netTotal: Number.isFinite(netTotal) ? netTotal : null,
    zeroCross,
    regime,
    peakStrike: peak ? peak.strike : null,
    troughStrike: trough ? trough.strike : null,
  };
}

/** Signed ₹ Cr label with 2 dp, e.g. `+12.34 Cr` / `-8.00 Cr` / `—`. */
export function formatGexCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return GEX_DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} Cr`;
}

/** Integer Indian-grouped strike, e.g. `22,600` / `—`. */
export function formatGexStrike(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return GEX_DASH;
  return v.toLocaleString("en-IN");
}

/** Colour the netGex / regime value by sign (support vs volatility fuel). */
export function gexTone(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return palette.TEXT_MUTED;
  return v > 0 ? palette.TERM_GAMMA : palette.TERM_GAMMA_NEG;
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

export interface NiftyGexProfileProps {
  gex?: NiftyGex;
  spot: number;
}

function NiftyGexProfileInner({ gex, spot }: NiftyGexProfileProps) {
  const profile = useMemo(() => buildGexProfile(gex), [gex]);
  const stats = useMemo(() => gexProfileStats(gex, spot), [gex, spot]);
  const chart = useMemo(
    () => buildGexChart(profile, stats, spot),
    [profile, stats, spot],
  );
  const band = chart.band;

  const regimeText = stats.regime ? `${stats.regime} GAMMA` : GEX_DASH;
  const regimeTone = gexTone(
    stats.regime === "LONG" ? 1 : stats.regime === "SHORT" ? -1 : null,
  );
  const flipDistance = useMemo(
    () => spotVsFlip(spot, stats.zeroCross),
    [spot, stats.zeroCross],
  );
  const regimeSentence =
    stats.regime === "LONG"
      ? "Dealers hold long gamma — the big peak is a magnet: dips there get bought, rallies get sold into."
      : stats.regime === "SHORT"
        ? "Dealers are short gamma — the deep trough is fuel: a move through it accelerates instead of stalling."
        : "";

  return (
    <CompactPanel
      title="Gamma by strike (price × γ)"
      testId="nifty-gex-profile-panel"
      sx={{
        background: palette.TERM_BG,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderColor: palette.TERM_BORDER,
        borderRadius: 1,
      }}
    >
      {/* Tight stat row: plain grid instead of CompactStatGrid (whose
          wrapper padding costs ~12px). All three stats, labels, values and
          unit hints are unchanged — only the chrome shrinks. */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, width: "100%", minWidth: 0 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 0.5,
            width: "100%",
            minWidth: 0,
          }}
        >
          <CompactStat
            data-testid="nifty-gex-profile-net"
            label="Net γ @ spot"
            tone={gexTone(stats.netTotal)}
            valueSize="md"
            value={formatGexCr(stats.netTotal)}
            hint="Cr / pt · + = long γ"
          />
          <CompactStat
            data-testid="nifty-gex-profile-zero"
            label="Flip level"
            valueSize="md"
            value={formatGexStrike(stats.zeroCross)}
            hint="zero γ"
          />
          <CompactStat
            data-testid="nifty-gex-profile-support"
            label="γ support"
            valueSize="md"
            value={formatGexStrike(stats.peakStrike)}
            hint="pin magnet"
          />
          <CompactStat
            data-testid="nifty-gex-profile-resist"
            label="γ resistance"
            valueSize="md"
            value={formatGexStrike(stats.troughStrike)}
            hint="breakout fuel"
          />
        </Box>

        {/* What the profile means for the next move — the panel's whole point.
            The regime chip keeps `nifty-gex-profile-regime` for callers/tests. */}
        <Box
          data-testid="nifty-gex-profile-regime"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <Text
            size="xs"
            span
            fw={700}
            sx={{
              color: regimeTone,
              border: `1px solid ${regimeTone}`,
              borderRadius: 0.75,
              px: 0.5,
              py: 0.1,
              whiteSpace: "nowrap",
            }}
          >
            {regimeText}
          </Text>
          {regimeSentence && (
            <Text
              size="xs"
              span
              title={regimeSentence}
              sx={{
                color: "text.secondary",
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {regimeSentence}
            </Text>
          )}
          {flipDistance && (
            <Text size="xs" span c="dimmed" sx={{ whiteSpace: "nowrap" }}>
              Spot {formatGexStrike(Number.isFinite(spot) ? spot : null)} · {flipDistance}
            </Text>
          )}
        </Box>

        {/* Why the chart only spans a slice of the strike list: Upstox quotes
            greeks for the near-money strikes only, so the far wings are dead
            zero points. Stating the coverage up front is what makes the plot
            readable — otherwise it looks like the profile is "missing". */}
        {profile.length > 0 && band.length > 0 && (
          <Text data-testid="nifty-gex-profile-coverage" size="xs" span c="dimmed">
            {`band ${formatGexStrike(band[0].strike)}–${formatGexStrike(
              band[band.length - 1].strike,
            )} · ${chart.significant} of ${profile.length} strikes carry ≥1% of peak γ`}
          </Text>
        )}

        {/* Explicit px height (never vh): ECharts/SVG need a non-zero fixed
            box, and vh balloons on tall monitors. 120px still resolves the
            single gamma-profile curve; the line spans the full inner box. */}
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <MiniLineChart
            series={chart.series}
            labels={chart.labels}
            markers={chart.markers}
            zeroLine={chart.zeroLine}
            scale="sqrt"
            height={120}
            formatValue={formatGexCr}
            testId="nifty-gex-profile-chart"
            emptyMessage="No per-strike GEX profile"
          />
        </Box>
        {profile.length > 0 && (
          <Text
            data-testid="nifty-gex-profile-caption"
            size="xs"
            span
            c="dimmed"
            title="x: strike · y: net dealer gamma in ₹ Cr/pt on a sqrt scale (so the big walls don't flatten every other strike). Above the 0 line dealers dampen moves at that strike (magnet); below it they amplify them (fuel). SPOT / ZERO mark today's spot and the gamma flip. The tallest peak is the gamma-support strike, the deepest trough the gamma-resistance strike."
            sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            x: strike · y: net γ (₹ Cr/pt, √ scale) · above 0 = dampening, below 0 = amplifying
          </Text>
        )}
      </Box>
    </CompactPanel>
  );
}

/** Memoised leaf panel — `gex` keeps identity between unrelated parent renders. */
export const NiftyGexProfile = memo(NiftyGexProfileInner);
NiftyGexProfile.displayName = "NiftyGexProfile";
