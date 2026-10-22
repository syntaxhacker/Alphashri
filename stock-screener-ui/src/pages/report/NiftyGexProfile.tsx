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
import {
  buildGexProfile,
  gexFlipAtSpot,
  gexRegimeAtSpot,
  type GexProfilePoint,
} from "./niftyGex";

/* The spot-relative regime/flip math lives in the pure `niftyGex` module so
   the desk plan, the tape and the heatmap can read the same numbers without
   importing this component. Re-exported here because the report panel (and
   the tests) import them from this file. */
export {
  buildGexProfile,
  gexCumAtSpot,
  gexFlipAtSpot,
  gexRegimeAtSpot,
  gexSpotRelative,
} from "./niftyGex";
export type { GexProfilePoint } from "./niftyGex";

/**
 * "Price × gamma" panel for the Nifty report.
 *
 * Honest mapping — the report supplies a per-strike net-GEX profile in
 * ₹ Cr per point (`report.gex`):
 *   - positive netGex  → dealers long gamma → that strike pins price (support
 *     when it sits below spot, resistance when it sits above)
 *   - negative netGex  → dealers short gamma → moves become volatility fuel on
 *     that side; it is never a support/resistance level
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

/** Derived headline numbers for the panel's stat row. */
interface GexProfileStats {
  netTotal: number | null;
  zeroCross: number | null;
  regime: string;
  peakStrike: number | null;
  troughStrike: number | null;
}

/** MiniLineChart-ready props for the profile chart. */
interface GexChartProps {
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
const GEX_DASH = "—";

function num(v: unknown): number {
  // `Number(null)` and `Number("")` are 0 — treat those as absent so a null
  // leg is dropped instead of being plotted as a genuine zero exposure.
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
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
const GEX_SIGNIFICANCE_SHARE = 0.01;

/** Result of picking the strike window worth plotting. */
interface GexBand {
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
 * Headline stats. `netTotal` is the book total (null when absent / non-finite);
 * `zeroCross` is the payload's flip, dropped when it disagrees with the
 * cumulative sign at spot. `regime` is re-derived from that cumulative sign
 * (`gexRegimeAtSpot`), falling back to the payload's own value.
 * `peakStrike` / `troughStrike` are the strikes holding the max / min netGex;
 * ties break toward the strike nearest `spot`, which keeps the marker
 * deterministic on flat profiles.
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
  const zeroCross = gexFlipAtSpot(gex, spot);
  const backendRegime = gex?.regime ? String(gex.regime).trim() : "";
  const regime = gex
    ? gexRegimeAtSpot(gex, spot, backendRegime).toUpperCase()
    : "";

  return {
    netTotal: Number.isFinite(netTotal) ? netTotal : null,
    zeroCross,
    regime,
    peakStrike: peak ? peak.strike : null,
    troughStrike: trough ? trough.strike : null,
  };
}

/**
 * Signed ₹ Cr **per point** label with 2 dp, e.g. `+12.34 Cr/pt` /
 * `-8.00 Cr/pt` / `—`. The unit belongs to the value: a stat row that also
 * carries a "Cr / pt" hint used to read "Cr Cr/pt".
 */
export function formatGexCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return GEX_DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} Cr/pt`;
}

/** One side-relative level for the stat row. */
export interface GexSideLevel {
  strike: number;
  netGex: number;
  kind: "support" | "resistance" | "fuel";
  side: "below" | "above";
}

/** Support/fuel below spot and resistance/fuel above spot. */
interface GexSideLevels {
  below: GexSideLevel | null;
  above: GexSideLevel | null;
}

/** A level must carry at least this share of the profile's peak |netGex|. */
export const GEX_LEVEL_MIN_SHARE = 0.1;

/** A level farther than this share of spot is a wing, not an actionable level. */
export const GEX_LEVEL_MAX_DIST_PCT = 0.05;

/**
 * Largest positive (pin) if any, else most negative (fuel), on one side.
 * Entries below `minAbs` are noise: a +0.07 Cr wing is not a pin magnet just
 * because it is the only positive strike on that side.
 */
function sideLevel(
  points: GexProfilePoint[],
  side: "below" | "above",
  minAbs: number,
): GexSideLevel | null {
  const positive = points.filter((p) => p.netGex > 0 && p.netGex >= minAbs);
  if (positive.length > 0) {
    const best = positive.reduce((a, b) => (b.netGex > a.netGex ? b : a));
    return {
      ...best,
      kind: side === "below" ? "support" : "resistance",
      side,
    };
  }
  const negative = points.filter((p) => p.netGex < 0 && -p.netGex >= minAbs);
  if (negative.length > 0) {
    const worst = negative.reduce((a, b) => (b.netGex < a.netGex ? b : a));
    return { ...worst, kind: "fuel", side };
  }
  return null;
}

/**
 * Spot-relative support / resistance for the stat row.
 *
 * A positive-gamma strike is a pin magnet, but which level it is depends on
 * where it sits: above spot it caps rallies (resistance), below spot it is
 * bought (support). A negative-gamma strike accelerates moves on its side and
 * is **fuel, never support/resistance** — the old code called the global
 * minimum "resistance" even when it sat below spot (22,700 under a 22,952
 * spot on 2026-10-21).
 *
 * Uses the backend `levels` block when it passes the gates below, otherwise
 * derives the levels from the strike profile. Older snapshots (recorded before
 * `levels` existed, or by a build without the gates) therefore replay with the
 * corrected labels too. A strike must carry ≥10% of the profile's peak
 * |netGex| and sit within 5% of spot, otherwise the side is null (rendered as
 * `—`) rather than promoting a near-zero wing.
 */
export function gexSideLevels(
  gex: NiftyGex | undefined,
  spot: number,
): GexSideLevels {
  const spotF = Number(spot);
  const finiteSpot = Number.isFinite(spotF);
  const profile = buildGexProfile(gex);
  const peakAbs = profile.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0);
  const minAbs = peakAbs * GEX_LEVEL_MIN_SHARE;
  const maxDist = finiteSpot ? Math.abs(spotF) * GEX_LEVEL_MAX_DIST_PCT : Infinity;

  /** Same gates as the backend: right side, near enough, big enough. */
  const qualifies = (
    raw: { strike: number; netGex: number } | null | undefined,
    side: "below" | "above",
  ): { strike: number; netGex: number } | null => {
    if (!raw) return null;
    if (finiteSpot) {
      if (side === "below" ? raw.strike > spotF : raw.strike < spotF) return null;
      if (Math.abs(raw.strike - spotF) > maxDist) return null;
    }
    if (peakAbs > 0 && Math.abs(raw.netGex) < minAbs) return null;
    return raw;
  };

  const asLevel = (
    raw: { strike: number; netGex: number } | null,
    positiveKind: "support" | "resistance",
    side: "below" | "above",
  ): GexSideLevel | null =>
    raw
      ? {
          strike: raw.strike,
          netGex: raw.netGex,
          kind: raw.netGex > 0 ? positiveKind : "fuel",
          side,
        }
      : null;

  const near = finiteSpot
    ? profile.filter((p) => Math.abs(p.strike - spotF) <= maxDist)
    : profile;
  const derive = (side: "below" | "above"): GexSideLevel | null =>
    finiteSpot
      ? sideLevel(
          near.filter((p) =>
            side === "below" ? p.strike <= spotF : p.strike >= spotF,
          ),
          side,
          minAbs,
        )
      : null;

  // Stored payloads may carry a `levels` block written by an older build that
  // lacked the significance/distance gates (e.g. the +0.07 support). Re-check
  // every backend level here and fall back to the gated derivation when it
  // fails, so replaying those frames cannot resurrect the degenerate label.
  const levels = gex?.levels;
  if (levels) {
    return {
      below:
        asLevel(qualifies(levels.support, "below"), "support", "below") ??
        asLevel(qualifies(levels.fuelDown, "below"), "support", "below") ??
        derive("below"),
      above:
        asLevel(qualifies(levels.resistance, "above"), "resistance", "above") ??
        asLevel(qualifies(levels.fuelUp, "above"), "resistance", "above") ??
        derive("above"),
    };
  }

  return { below: derive("below"), above: derive("above") };
}

/** Label / hint for one side cell: a pin magnet or move fuel. */
export function gexSideCopy(
  level: GexSideLevel | null,
  side: "below" | "above",
): { label: string; hint: string } {
  if (level?.kind === "fuel") {
    return side === "below"
      ? { label: "γ fuel ↓", hint: "breakdown fuel · below" }
      : { label: "γ fuel ↑", hint: "squeeze fuel · above" };
  }
  return side === "below"
    ? { label: "γ support", hint: "pin magnet · below" }
    : { label: "γ resistance", hint: "pin magnet · above" };
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

interface NiftyGexProfileProps {
  gex?: NiftyGex;
  spot: number;
}

/**
 * Stat value for one γ level: the strike plus the net gamma it carries, e.g.
 * `22,600 (+142.30 Cr/pt)`. The magnitude is what separates a real wall from
 * a +0.07 Cr wing that only looked like one.
 */
function GexLevelValue(level: GexSideLevel | null) {
  if (!level) return GEX_DASH;
  return (
    <>
      {formatGexStrike(level.strike)}
      <Box
        component="span"
        sx={{
          fontSize: 9,
          fontWeight: 400,
          ml: 0.5,
          color: "text.secondary",
          whiteSpace: "nowrap",
        }}
      >
        ({formatGexCr(level.netGex)})
      </Box>
    </>
  );
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
  const sides = useMemo(() => gexSideLevels(gex, spot), [gex, spot]);
  const below = sides.below;
  const above = sides.above;
  const belowCopy = gexSideCopy(below, "below");
  const aboveCopy = gexSideCopy(above, "above");
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
            label="Net γ (book)"
            tone={gexTone(stats.netTotal)}
            valueSize="md"
            value={formatGexCr(stats.netTotal)}
            hint="Σ all strikes"
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
            label={belowCopy.label}
            tone={gexTone(below?.netGex ?? null)}
            valueSize="md"
            value={GexLevelValue(below)}
            hint={belowCopy.hint}
          />
          <CompactStat
            data-testid="nifty-gex-profile-resist"
            label={aboveCopy.label}
            tone={gexTone(above?.netGex ?? null)}
            valueSize="md"
            value={GexLevelValue(above)}
            hint={aboveCopy.hint}
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
            title="Regime = cumulative γ up to spot (the side of the flip spot trades on)"
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
            )} · ${chart.significant} of ${profile.length} strikes carry ≥${
              GEX_SIGNIFICANCE_SHARE * 100
            }% of peak γ`}
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
            title="x: strike · y: net dealer gamma in ₹ Cr/pt on a sqrt scale (so the big walls don't flatten every other strike). Above the 0 line dealers dampen moves at that strike (magnet); below it they amplify them (fuel). SPOT / ZERO mark today's spot and the gamma flip. Support/resistance are positive-gamma pin magnets below/above spot; a negative-gamma strike is fuel on its own side, never support or resistance."
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
