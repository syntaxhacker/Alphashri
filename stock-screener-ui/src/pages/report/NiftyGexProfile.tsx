import { useMemo } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat } from "@/components/common/compact";
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
 * panel is not worth the bundle/heap cost. The line/area is the netGex
 * profile in strike order, a horizontal dashed line marks netGex = 0, and
 * vertical dashed markers point at the SPOT strike and the ZERO-gamma strike
 * (each omitted when off-profile). Absent/empty data degrades to a friendly
 * empty state.
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
}

/** Rendered for any absent numeric field so a cell never shows blank. */
export const GEX_DASH = "—";

function num(v: unknown): number {
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
 * Pure MiniLineChart prop builder (unit-testable). Labels are the strikes in
 * ascending profile order; the single series carries netGex in the same order.
 * Markers:
 *   - vertical `SPOT` line at the spot strike (omitted when off-profile)
 *   - vertical `ZERO` line at the zero-gamma strike (omitted when null or
 *     off-profile)
 * The zero reference line is always on (`zeroLine: true`).
 */
export function buildGexChart(
  profile: GexProfilePoint[],
  stats: GexProfileStats,
  spot: number,
): GexChartProps {
  const labels = profile.map((p) => formatGexStrike(p.strike));
  const series: MiniSeries[] = [
    {
      name: "Net GEX",
      points: profile.map((p) => p.netGex),
      color: palette.TERM_GAMMA,
      area: true,
      axis: 0,
    },
  ];

  const markers: MiniMarker[] = [];
  const strikes = profile.map((p) => p.strike);
  const spotIdx = Number.isFinite(spot) ? strikes.indexOf(spot) : -1;
  if (spotIdx >= 0) {
    markers.push({ index: spotIdx, label: "SPOT", color: palette.TERM_SPOT });
  }
  if (stats.zeroCross != null) {
    const zeroIdx = strikes.indexOf(stats.zeroCross);
    if (zeroIdx >= 0) {
      markers.push({ index: zeroIdx, label: "ZERO", color: palette.TERM_FLIP });
    }
  }

  return { labels, series, markers, zeroLine: true };
}

export interface NiftyGexProfileProps {
  gex?: NiftyGex;
  spot: number;
}

export function NiftyGexProfile({ gex, spot }: NiftyGexProfileProps) {
  const profile = useMemo(() => buildGexProfile(gex), [gex]);
  const stats = useMemo(() => gexProfileStats(gex, spot), [gex, spot]);
  const chart = useMemo(
    () => buildGexChart(profile, stats, spot),
    [profile, stats, spot],
  );

  const regimeText = stats.regime ? `${stats.regime} GAMMA` : GEX_DASH;
  const regimeTone = gexTone(
    stats.regime === "LONG" ? 1 : stats.regime === "SHORT" ? -1 : null,
  );

  return (
    <CompactPanel
      title="Price × gamma"
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
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 0.5,
            width: "100%",
            minWidth: 0,
          }}
        >
          <CompactStat
            data-testid="nifty-gex-profile-net"
            label="Net GEX @ spot"
            tone={gexTone(stats.netTotal)}
            valueSize="md"
            value={formatGexCr(stats.netTotal)}
            hint="Cr / pt · + = long γ"
          />
          <CompactStat
            data-testid="nifty-gex-profile-zero"
            label="Zero gamma"
            valueSize="md"
            value={formatGexStrike(stats.zeroCross)}
            hint="flip level"
          />
          <CompactStat
            data-testid="nifty-gex-profile-regime"
            label="Regime"
            tone={regimeTone}
            valueSize="md"
            value={regimeText}
          />
        </Box>

        {/* Explicit px height (never vh): ECharts/SVG need a non-zero fixed
            box, and vh balloons on tall monitors. 120px still resolves the
            single gamma-profile curve; the line spans the full inner box. */}
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <MiniLineChart
            series={chart.series}
            labels={chart.labels}
            markers={chart.markers}
            zeroLine={chart.zeroLine}
            height={120}
            formatValue={formatGexCr}
            testId="nifty-gex-profile-chart"
            emptyMessage="No per-strike GEX profile"
          />
        </Box>
      </Box>
    </CompactPanel>
  );
}
