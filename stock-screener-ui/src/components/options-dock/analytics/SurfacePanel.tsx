import { createMemo } from "solid-js";
import { Box, Text, typeSize } from "@/ui";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import { SURFACE_MAX_STRIKES } from "@/config/optionsAnalytics";
import { formatVp, surfaceGrid } from "@/utils/optionsAnalyticsMath";
import { AnalyticsChartCore } from "./AnalyticsChartCore";
import { AnalyticsFooter } from "./AnalyticsFooter";
import { useChartInk } from "./chartInk";
import {
  buildSurfaceOption,
  frontHasQuotes,
  NO_FRONT_QUOTES,
  selectedRowIndex,
  SURFACE_METRIC_LABELS,
} from "./surfaceChart";
import type { AnalyticsMetricVM } from "./types";

/**
 * Strike × expiry IV heatmap. ECharts' 2D `heatmap` is used in place of
 * `echarts-gl`: the dock is 390px wide. Missing intersections are a second,
 * hatched series on the raised surface token — never a misleading zero.
 */
export function SurfacePanel(props: { data: OptionsAnalytics; selectedExpiry: string | null }) {
  const ink = useChartInk();
  const grid = createMemo(() => surfaceGrid(props.data, SURFACE_MAX_STRIKES));
  const empty = createMemo(() => grid().cells.length === 0);
  const atmStrike = createMemo(() => {
    const strikes = grid().strikes;
    const spot = props.data.spot;
    if (strikes.length === 0 || spot == null || !Number.isFinite(spot)) return null;
    return strikes.reduce((best, strike) =>
      Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
    );
  });
  const selectedRow = createMemo(() => selectedRowIndex(grid(), props.selectedExpiry));
  const atmRidge = createMemo(() => {
    const strike = atmStrike();
    const front = grid().expiries[0];
    if (strike == null || !front) return null;
    const cell = grid().cells.find((item) => item.expiry === front && item.strike === strike);
    return cell?.iv ?? null;
  });

  const option = createMemo(() =>
    buildSurfaceOption({
      grid: grid(),
      atmStrike: atmStrike(),
      selectedRow: selectedRow(),
      ink: ink(),
    }),
  );

  const optionKey = createMemo(() => {
    const g = grid();
    return [
      g.strikes.join(","),
      g.expiries.join(","),
      g.cells.map((cell) => `${cell.expiry}|${cell.strike}|${cell.iv.toFixed(1)}`).join(";"),
      `sel${props.selectedExpiry ?? "x"}`,
    ].join("|");
  });

  const metrics = (): AnalyticsMetricVM[] => {
    const g = grid();
    const coverage = g.total > 0 ? Math.round((g.coverage / g.total) * 100) : 0;
    const noFront = !frontHasQuotes(g);
    const frontRr25 = props.data.expiries[0]?.rr25 ?? null;
    return [
      {
        label: SURFACE_METRIC_LABELS.grid,
        value: `${g.strikes.length}×${g.expiries.length}`,
        testId: "surface-metric-grid",
      },
      {
        label: SURFACE_METRIC_LABELS.coverage,
        value: `${coverage}%`,
        testId: "surface-metric-coverage",
      },
      {
        label: SURFACE_METRIC_LABELS.frontAtm,
        value: noFront ? NO_FRONT_QUOTES : (atmRidge() != null ? atmRidge()!.toFixed(1) : "—"),
        testId: "surface-metric-ridge",
      },
      {
        label: SURFACE_METRIC_LABELS.skew,
        value: noFront ? NO_FRONT_QUOTES : formatVp(frontRr25),
        testId: "surface-metric-skew",
      },
    ];
  };

  return (
    <Box className="flex min-h-0 flex-1 flex-col" data-testid="analytics-surface">
      <AnalyticsChartCore
        option={option()}
        optionKey={optionKey()}
        empty={empty()}
        emptyText="No surface grid"
        testId="surface-chart"
      />
      <Text
        size="xs"
        c="dimmed"
        className="shrink-0 truncate px-1.5 py-0.5 font-mono"
        style={{ "font-size": `${typeSize("micro")}px` }}
        data-testid="surface-caption"
      >
        Strikes × expiries · blank/hatched = no valid IV quote (not zero)
      </Text>
      <AnalyticsFooter metrics={metrics()} testId="surface-footer" />
    </Box>
  );
}
