import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Text } from "@/ui";
import { DepthChart } from "./DepthChart";
import { ChartErrorBoundary } from "@/components/common/ChartErrorBoundary";
import * as palette from "@/ui/palette";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import type { NiftyReport } from "@/types/niftyReport";
import { formatOiCompact } from "./NiftyDepthMap.format";
import { buildDepthRows, dayStats, findOiPoc } from "./NiftyDepthMap.geometry";
import { buildDepthOption } from "./NiftyDepthMap.option";
import {
  changeText,
  changeTone,
  depthLegendData,
  hiLoText,
  lastText,
  maxPainText,
  netChgText,
  netChgTone,
  pcrText,
  pocText,
} from "./NiftyDepthMap.header";

export {
  DEPTH_WINDOW,
  DEPTH_MAX_ROWS,
  buildDepthRows,
  findOiPoc,
  dayStats,
  candleEpochMs,
  topOiLabelStrikes,
  levelLines,
} from "./NiftyDepthMap.geometry";
export { formatOiCompact, formatIstTimeMs } from "./NiftyDepthMap.format";
export { buildDepthOption } from "./NiftyDepthMap.option";

/**
 * Depth-map view for the Nifty report (futures footprint + GEX layout reference).
 *
 * Honest data mapping — we have NO tick/footprint/GEX feed:
 * - Candles: 15m Nifty from the report (`report.candles`).
 * - Depth bars: per-strike CE OI (red, left) / PE OI (green, right) from
 *   `report.strikes` (the GEX-bar equivalent), diverging from a zero center
 *   so each strike row shows one CE bar + one PE bar.
 * - "OI POC" = strike with the highest total (ce + pe) OI. It is NOT a
 *   volume POC — the label says exactly `OI POC`.
 *
 * Visual rules (screenshot-driven):
 * - Candle y-range comes from candle low/high ±0.15% padding ONLY — never
 *   from bar extents. Bars outside the range clip; that is intended so the
 *   candles keep ~68% of the width readable.
 * - The depth grid is a horizontal-bar chart: xAxis (grid 1) is a value axis
 *   for OI magnitude, yAxis (grid 1) is a category axis of strikes. ECharts
 *   bar series on two VALUE axes render as thin vertical lines spanning the
 *   full height — never do that; the category axis is what makes bars
 *   horizontal at their strike rows (CE negative/left, PE positive/right,
 *   explicit `encode: { x: 0, y: 1 }`).
 * - Level tags dedupe within 25pts (Spot > MP > CW/PW > OI-POC > Hi/Lo) and
 *   render as labeled lines on the candle grid (the only remaining price
 *   value axis — a category axis cannot place arbitrary price levels).
 * - X-axis labels are IST wall-clock HH:MM via explicit Asia/Kolkata
 *   formatting (host TZ independent). Candles without a parseable `time`
 *   are dropped from BOTH the series and the axis data so labels never go
 *   blank/misaligned (index coupling must be preserved).
 */

/** Hoisted ECharts chrome — stable identity so the chart never gets new literals. */

const LegendChip = (props: {
  testId: string;
  color: string;
  label: string;
  value: string;
  valueColor?: string;
}) => {
  return (
    <Box
      data-testid={props.testId}
      className="flex items-center gap-[8px] tabular-nums"
    >
      <Box
        className="w-[8px] h-[8px] rounded-full shrink-0"
        style={{ "background-color": props.color }}
      />
      <Text size="xs" c="dimmed" span>
        {props.label}
      </Text>
      <Text size="xs" fw={700} span className="tabular-nums" style={{ color: props.valueColor ?? palette.TEXT }}>
        {props.value}
      </Text>
    </Box>
  );
};

/** Minimal ECharts instance surface this panel drives. */
interface DepthChartHandle {
  resize: () => void;
  setOption: (option: object, opts?: { notMerge?: boolean; lazyUpdate?: boolean }) => void;
}

interface NiftyDepthMapProps {
  report: NiftyReport;
  /**
   * Visibility gate (default true). When false the component renders only
   * its container: no `setOption`, no `resize`, no other ECharts work.
   * Flipping back to true runs `resize()` + `setOption(latest)` so the
   * chart catches up to anything skipped while hidden.
   */
  active?: boolean;
}

function NiftyDepthMapInner(props: NiftyDepthMapProps) {
  const report = () => props.report;
  const active = () => props.active ?? true;
  const rows = createMemo(() => buildDepthRows(report()));
  const stats = createMemo(() => dayStats(report()));
  const poc = createMemo(() => findOiPoc(report()));
  const option = createMemo(() => buildDepthOption(report()));

  /**
   * Keep the ECharts *engine* mounted once it has drawn a row.
   *
   * A poll that momentarily returns no strikes (pre-open, a chain refresh, a
   * replay boundary) used to unmount `ReactECharts`: that disposes the
   * instance, and the next poll re-`init`s it (~380 ms + a fresh zrender
   * canvas). Worse, `echarts-for-react` initialises asynchronously (it waits
   * for the `finished` event, then disposes + re-inits): unmounting inside that
   * window leaves an instance created after `componentWillUnmount`, with no one
   * left to dispose it. Keeping it mounted removes the whole class.
   */
  const [hasEverHadRows, setHasEverHadRows] = createSignal(false);
  createEffect(() => {
    if (rows().length > 0 && !hasEverHadRows()) setHasEverHadRows(true);
  });

  const [chartInstance, setChartInstance] = createSignal<DepthChartHandle | null>(null);

  const handleChartReady = (instance: DepthChartHandle) => {
    setChartInstance(() => instance);
  };

  /** Drop the instance on unmount so nothing drives a disposed chart. */
  onCleanup(() => {
    setChartInstance(null);
  });

  const resolveInstance = (): DepthChartHandle | null => chartInstance();

  // Resize only when the view becomes visible. The hidden container is
  // zero-size, so one resize on activation is required — but resizing on every
  // report push (every poll) forced a full ECharts/zrender re-layout for no
  // geometry change.
  createEffect(() => {
    if (!active()) return;
    resolveInstance()?.resize();
  });

  // Single option driver. The library's automatic setOption is disabled via
  // `shouldSetOption` below, so while `active` is false this effect provably
  // skips all ECharts work; on (re)activation it pushes the latest option.
  //
  // `notMerge: true` is deliberate: the option is rebuilt in full from the
  // report, and a merge-mode setOption re-uses/patches ECharts' internal model
  // in place every poll — the accumulation pattern that grows a long-lived
  // chart tab. Full replacement also guarantees a series removed upstream
  // cannot survive as a stale ghost series.
  createEffect(() => {
    if (!active()) return;
    const instance = resolveInstance();
    if (!instance) return;
    instance.setOption(option(), { notMerge: true, lazyUpdate: false });
  });

  const legend = createMemo(() => depthLegendData(rows(), report()));

  return (
    <Box
      data-testid="nifty-depthmap"
      className="flex flex-col gap-[16px] w-full min-w-0"
    >
      <Box data-testid="nifty-depth-stats" className="flex w-full min-w-0">
        <CompactStatGrid>
          <CompactStat
            data-testid="nifty-depth-stat-last"
            label="Last"
            value={lastText(report())}
          />
          <CompactStat
            data-testid="nifty-depth-stat-hilo"
            label="Hi / Lo"
            valueSize="md"
            value={hiLoText(stats())}
          />
          <CompactStat
            data-testid="nifty-depth-stat-chg"
            label="Change"
            tone={changeTone(stats())}
            value={changeText(stats())}
          />
          <CompactStat
            data-testid="nifty-depth-stat-pcr"
            label="PCR-OI"
            value={pcrText(report())}
          />
          <CompactStat
            data-testid="nifty-depth-stat-maxpain"
            label="Max Pain"
            value={maxPainText(report())}
          />
        </CompactStatGrid>
      </Box>

      <Box
        data-testid="nifty-depth-legend"
        className="flex items-center flex-wrap gap-[16px] px-2"
      >
        <LegendChip testId="nifty-depth-legend-ce-dom" color={palette.NEGATIVE} label="CE over PE" value={String(legend().ceDom)} />
        <LegendChip testId="nifty-depth-legend-pe-dom" color={palette.POSITIVE} label="PE over CE" value={String(legend().peDom)} />
        <LegendChip testId="nifty-depth-legend-total" color={palette.TEXT} label="Total OI" value={formatOiCompact(legend().totalOi)} />
        <LegendChip testId="nifty-depth-legend-poc" color={palette.WARNING} label="OI POC" value={pocText(poc())} />
        <LegendChip testId="nifty-depth-legend-chg" color={palette.TEXT_MUTED} label="OI Chg" value={netChgText(legend())} valueColor={netChgTone(legend())} />
      </Box>

      <Box
        data-testid="nifty-depth-chart"
        className="relative w-full min-w-0 min-h-[380px]"
        style={{ height: "min(62vh, 600px)" }}
      >
        {rows().length === 0 ? (
          <EmptyCompact
            data-testid="nifty-depth-empty"
            title="No strikes in window"
            description="No option-chain strikes near spot for this expiry."
          />
        ) : null}
        {rows().length > 0 || hasEverHadRows() ? (
          <Box
            className="absolute inset-0"
            style={{ display: rows().length > 0 ? "block" : "none" }}
          >
            <ChartErrorBoundary label="Depth map">
              <DepthChart option={option()} onChartReady={handleChartReady} data-testid="nifty-depth-echarts" data-series={Array.isArray(option()?.series) ? (option() as { series?: unknown[] }).series?.length ?? 0 : 0} />
            </ChartErrorBoundary>
          </Box>
        ) : null}
      </Box>

      <Text data-testid="nifty-depth-note" size="xs" c="dimmed">
        Strike OI from the chain snapshot — no tick footprint or GEX feed.
      </Text>
    </Box>
  );
}

/** Leaf panel. Solid needs no memo: updates are fine-grained, not whole-tree. */
export const NiftyDepthMap = NiftyDepthMapInner;
