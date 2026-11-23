import { createMemo } from "solid-js";
import { MiniLineChart } from "@/components/common/charts/MiniLineChart";
import * as palette from "@/ui/palette";
import type { NiftyGex } from "@/types/niftyReport";
import { LocalCompactPanel } from "./reportBits";
import { REPORT_RADIUS } from "./reportTokens";
import { buildGexProfile } from "./niftyGex";
import { formatGexCr } from "./NiftyGexProfile.format";
import { buildGexChart } from "./NiftyGexProfile.geometry";
import { gexProfileStats, gexSideLevels } from "./NiftyGexProfile.levels";
import { GexStatRow } from "./NiftyGexProfile.rows";
import {
  GexCaption,
  GexCoverage,
  GexLevelsLegend,
  GexRegimeRow,
} from "./NiftyGexProfile.legend";

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
export { GEX_LEVEL_MAX_DIST_PCT, GEX_LEVEL_MIN_SHARE } from "@/config/reportAnalytics";
export {
  GEX_SIGNIFICANCE_SHARE,
  buildGexChart,
  nearestStrikeIndex,
  selectGexBand,
  trimGexProfile,
} from "./NiftyGexProfile.geometry";
export type { GexBand, GexChartProps } from "./NiftyGexProfile.geometry";
export { gexProfileStats, gexSideLevels } from "./NiftyGexProfile.levels";
export type { GexProfileStats, GexSideLevel } from "./NiftyGexProfile.levels";
export {
  GEX_DASH,
  formatGexCr,
  formatGexStrike,
  gexLevelTone,
  gexSideCopy,
  gexTone,
} from "./NiftyGexProfile.format";

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

interface NiftyGexProfileProps {
  gex?: NiftyGex;
  spot: number;
}

export function NiftyGexProfile(props: NiftyGexProfileProps) {
  const gex = () => props.gex;
  const spot = () => props.spot;
  const profile = createMemo(() => buildGexProfile(gex()));
  const stats = createMemo(() => gexProfileStats(gex(), spot()));
  const chart = createMemo(
    () => buildGexChart(profile(), stats(), spot()),
  );
  const band = () => chart().band;

  const sides = createMemo(() => gexSideLevels(gex(), spot()));
  const below = () => sides().below;
  const above = () => sides().above;

  return (
    <LocalCompactPanel
      title="GEX profile"
      testId="nifty-gex-profile-panel"
      style={{
        "background-color": palette.TERM_BG,
        "border": `1px solid ${palette.TERM_BORDER}`,
        "border-color": palette.TERM_BORDER,
        "border-radius": `${REPORT_RADIUS.md}px`,
      }}
    >
      <div class="flex flex-col gap-[4px] w-full min-w-0">
        <GexStatRow stats={stats()} below={below()} above={above()} />
        <GexRegimeRow stats={stats()} spot={spot()} />
        <GexCoverage
          band={band()}
          significant={chart().significant}
          total={profile().length}
        />

        {/* Explicit px height (never vh): ECharts/SVG need a non-zero fixed
            box, and vh balloons on tall monitors. 120px still resolves the
            single gamma-profile curve; the line spans the full inner box. */}
        <div class="w-full min-w-0">
          <MiniLineChart
            series={chart().series}
            labels={chart().labels}
            markers={chart().markers}
            zeroLine={chart().zeroLine}
            scale="sqrt"
            height={120}
            formatValue={formatGexCr}
            testId="nifty-gex-profile-chart"
            emptyMessage="No per-strike GEX profile"
          />
        </div>
        <GexLevelsLegend below={below()} above={above()} />
        <GexCaption show={profile().length > 0} />
      </div>
    </LocalCompactPanel>
  );
}
