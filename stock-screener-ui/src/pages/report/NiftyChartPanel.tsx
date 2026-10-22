import { memo, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { SegmentedControl, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { CompactPanel } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import { NiftyDepthMap } from "./NiftyDepthMap";
import { gexSideLevels } from "./NiftyGexProfile";
import { maxPainTouches, MAX_PAIN_TOUCH_TOL } from "./maxPainTouches";
import { hexToRgba } from "@/utils/color";
import {
  buildMarkLines,
  candlePriceRange,
  emaSeries,
  labelGapPctFor,
  levelBelongsToScale,
  levelsWithinScale,
  mergeCollidingLabels,
  resampleCandles,
} from "./niftyChartMath";
import type {
  NiftyGex,
  NiftyReport,
  NiftyReportMode,
} from "@/types/niftyReport";

/**
 * The panel's public surface. The pure chart maths lives in
 * `./niftyChartMath`; it is re-exported here so the report panel (and the
 * test) have one import path.
 */
export {
  buildMarkLines,
  candlePriceRange,
  emaSeries,
  labelGapPctFor,
  levelBelongsToScale,
  levelsWithinScale,
  mergeCollidingLabels,
  resampleCandles,
} from "./niftyChartMath";

/** Chart height presets (px) for the "Nifty chart" panel size control. */
export const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
/** `fill` (default) grows with the report row; S/M/L/XL pin a fixed height. */
export type ChartSize = keyof typeof CHART_HEIGHTS | "fill";
/** DESK fill cap: the chart body stops at 300px (min 260px on short screens). */
export const FILL_MAX_HEIGHT = 300;
const FILL_MIN_HEIGHT = 260;
/** Panel chrome above the chart body (22px header + card padding/border). A
 *  DESK row sizes itself to `chart body + CHART_ROW_CHROME` so the card never
 *  leaves a black void under a capped fill chart. */
export const CHART_ROW_CHROME = 48;
/** Collision estimate used by the fill layout (no fixed pixel height). */
const FILL_LABEL_HEIGHT = 480;

/** Chart timeframe presets and their bar size in minutes. The `intraday`
    feed is 1-minute; 5m/15m are resampled client-side (see `resampleCandles`). */
export type ChartTimeframe = "1m" | "5m" | "15m";
export const CHART_TF_MINUTES: Record<ChartTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
};

/** Module-level toggle data so memoized parents never see a new array. */
const CHART_TF_OPTIONS: { value: string; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
];

const CHART_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

/** What the chart level tags mean. GEX tags exist in live mode only. */
interface LevelLegendProps {
  live: boolean;
  /** Live GEX block. When supplied, only levels the chart can actually draw
   *  keep a legend row — a null/side-gated level is hidden instead of being
   *  advertised over a line that does not exist. */
  gex?: NiftyGex;
  spot?: number;
}

export function LevelLegend({ live, gex, spot }: LevelLegendProps) {
  const sides = gex ? gexSideLevels(gex, spot ?? NaN) : null;
  // A present block filters to drawable levels; callers that only pass `live`
  // keep the legacy "show every code" behaviour.
  const show = {
    flip: !gex || gex.zeroCross != null,
    support: !gex || sides?.below?.kind === "support",
    resistance: !gex || sides?.above?.kind === "resistance",
    fuel:
      !gex ||
      sides?.below?.kind === "fuel" ||
      sides?.above?.kind === "fuel",
  };
  const items: { code: string; color: string; meaning: string; zone?: boolean }[] = [
    { code: "CW", color: palette.NEGATIVE, meaning: "top call-OI wall · resistance", zone: true },
    { code: "PW", color: palette.POSITIVE, meaning: "top put-OI wall · support", zone: true },
    { code: "MP", color: palette.PRIMARY, meaning: "max pain · expiry magnet", zone: true },
  ];
  if (live) {
    if (show.flip) {
      items.push(
        { code: "FLIP", color: palette.WARNING, meaning: "gamma flip · dealers switch sides here" },
      );
    }
    if (show.support) {
      items.push(
        { code: "GSUP", color: palette.POSITIVE, meaning: "gamma support · pin magnet below spot" },
      );
    }
    if (show.resistance) {
      items.push(
        { code: "GRES", color: palette.NEGATIVE, meaning: "gamma resistance · pin magnet above spot" },
      );
    }
    if (show.fuel) {
      items.push(
        { code: "GFUEL", color: palette.WARNING, meaning: "gamma fuel · moves accelerate on that side" },
      );
    }
  }
  return (
    // Single dense wrapped row: tight gaps + minimal top pad so the legend
    // costs one ~16px row instead of two. Fonts/symbols untouched.
    <Box
      data-testid="nifty-level-legend"
      sx={{ display: "flex", flexWrap: "wrap", columnGap: 1, rowGap: 0.5, pt: 0.5 }}
    >
      {items.map((it) => (
        <Box
          key={it.code}
          sx={{ display: "flex", alignItems: "center", gap: 1, whiteSpace: "nowrap" }}
        >
          <Box
            sx={{
              width: it.zone ? 12 : 8,
              height: it.zone ? 8 : 8,
              borderRadius: it.zone ? 1 : "50%",
              backgroundColor: it.zone ? hexToRgba(it.color, 0.18) : it.color,
              border: it.zone ? `1px solid ${it.color}` : "none",
              flexShrink: 0,
            }}
          />
          <Text size="xs" fw={700} span>
            {it.code}
          </Text>
          <Text size="xs" c="dimmed" span>
            {it.meaning}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

interface NiftyChartPanelProps {
  report: NiftyReport;
  mode: NiftyReportMode;
  view: "chart" | "depth";
  /** Desk-mode fullscreen: renders a ⤢ button in the header action row. */
  onExpand?: () => void;
  /** Controlled bar timeframe (uncontrolled 1m default when absent). */
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
  /** Initial panel size (uncontrolled, defaults to fill). */
  initialSize?: ChartSize;
  /** Notifies the parent when S/M/L/XL changes, so a DESK row can size to it. */
  onSizeChange?: (size: ChartSize) => void;
}

/**
 * Chart/depth body isolated behind `React.memo` with its own size + timeframe
 * state. Clicking S/M/L/XL or 1m/5m/15m re-renders only this panel: the props
 * (`report`, `mode`, `view`) are all stable across those toggles and nothing
 * tick-driven is passed in.
 */
export const NiftyChartPanel = memo(function NiftyChartPanel({
  report,
  mode,
  view,
  onExpand,
  timeframe,
  onTimeframeChange,
  initialSize = "fill",
  onSizeChange,
}: NiftyChartPanelProps) {
  const [chartSize, setChartSize] = useState<ChartSize>(initialSize);
  /** `null` = fill the panel (autoSize); a number = fixed preset. */
  const chartHeight =
    chartSize === "fill" ? null : CHART_HEIGHTS[chartSize];
  /** DESK fill cap: the chart body never takes more than 300px of the row,
   *  so the FLOW band below (heatmap + strip) gets the remaining height.
   *  Explicit presets (S/M/L/XL) keep their requested height. */
  const fillCap = chartHeight == null ? { maxHeight: FILL_MAX_HEIGHT, minHeight: FILL_MIN_HEIGHT } : {};
  const handleSizeChange = (v: string) => {
    const next = v as ChartSize;
    setChartSize(next);
    onSizeChange?.(next);
  };
  /** Chart bar timeframe: 1m native; 5m/15m resampled client-side. */
  const [internalTf, setInternalTf] = useState<ChartTimeframe>("1m");
  const chartTf = timeframe ?? internalTf;
  const handleTfChange = (v: string) => {
    const next = v as ChartTimeframe;
    if (onTimeframeChange) onTimeframeChange(next);
    else setInternalTf(next);
  };

  // Lazy depth mount: switching views used to cold-mount ECharts (~380ms),
  // so the depth subtree is not created until first selected. Afterwards
  // both views stay mounted and visibility toggles via `display: none`,
  // making Chart<->Depth switches instant. (Render-time adjust — the
  // React-endorsed pattern for syncing state to a prop change.)
  const [depthEverShown, setDepthEverShown] = useState(false);
  if (view === "depth" && !depthEverShown) {
    setDepthEverShown(true);
  }

  const markLines = useMemo(
    () =>
      buildMarkLines(
        report,
        mode === "live" && !!report.gex,
        labelGapPctFor(report, chartHeight ?? FILL_LABEL_HEIGHT),
      ),
    [report, mode, chartSize],
  );

  /** 1-minute intraday candles when present, else the 15-min EOD candles —
   *  each resampled to the selected timeframe (1m passes through). */
  const chartCandles = useMemo(
    () =>
      resampleCandles(
        report?.intraday && report.intraday.length > 0
          ? report.intraday
          : (report?.candles ?? []),
        CHART_TF_MINUTES[chartTf],
      ),
    [report, chartTf],
  );

  /** EMA9 (warning) + EMA20 (primary), recomputed on the displayed candles so
   *  the overlays always match the selected timeframe. The backend `emas`
   *  block is intentionally ignored here (it is fixed to the 1-minute grid). */
  const emaData = useMemo(() => {
    const closes = chartCandles.map((c) => c.close);
    return [
      { label: "EMA9", color: palette.WARNING, data: emaSeries(closes, 9) },
      { label: "EMA20", color: palette.PRIMARY, data: emaSeries(closes, 20) },
    ];
  }, [chartCandles]);

  /** Bars whose close sits on the report's max pain (within 10 pts). */
  const mpTouches = useMemo(
    () =>
      maxPainTouches(
        chartCandles.map((c) => ({ value: c.close, maxPain: report.maxPain, time: c.time })),
        MAX_PAIN_TOUCH_TOL,
      ),
    [chartCandles, report.maxPain],
  );
  const touchMarkers = useMemo(
    () => mpTouches.map((t) => ({ time: t.point.time, value: t.value })),
    [mpTouches],
  );

  return (
    <CompactPanel
      title={view === "depth" ? "Nifty depth map" : "Nifty chart"}
      testId="nifty-chart-panel"
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        // Let the chart body (not the card padding) own the remaining height.
        "& .MuiCardContent-root": {
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        },
      }}
      action={
        view === "chart" ? (
          <Box
            sx={{
              display: "flex",
              gap: 0.5,
              alignItems: "center",
              "& .MuiToggleButton-root": {
                px: 0.75,
                py: 0,
                minWidth: 0,
                minHeight: 20,
                height: 20,
                boxSizing: "border-box",
                fontSize: 10,
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: "0.04em",
              },
            }}
          >
            <SegmentedControl
              data-testid="nifty-tf-toggle"
              value={chartTf}
              onChange={handleTfChange}
              data={CHART_TF_OPTIONS}
              size="xs"
            />
            <SegmentedControl
              data-testid="nifty-chart-size"
              value={chartSize}
              onChange={handleSizeChange}
              data={CHART_SIZE_OPTIONS}
              size="xs"
            />
            {onExpand ? (
              <IconButton
                data-testid="nifty-chart-expand"
                aria-label="Expand chart fullscreen"
                title="Fullscreen (F)"
                size="small"
                onClick={onExpand}
                sx={{ p: "1px", height: 20, color: palette.TEXT_MUTED, "&:hover": { color: palette.TEXT } }}
              >
                <Text span size="xs" fw={700} style={{ fontSize: 13, lineHeight: 1 }}>
                  ⤢
                </Text>
              </IconButton>
            ) : null}
          </Box>
        ) : undefined
      }
    >
      {/*
        * Both views stay mounted after first use; the inactive wrapper is
        * `display: none` (zero layout space) so switching never remounts
        * either chart engine. The depth subtree mounts lazily on first
        * selection via `depthEverShown` above.
        */}
      <Box
        data-testid="nifty-chart-view"
        style={{ display: view === "chart" ? "flex" : "none" }}
        sx={{
          flexDirection: "column",
          flex: view === "chart" ? 1 : undefined,
          minHeight: 0,
        }}
      >
        {chartCandles && chartCandles.length > 0 ? (
          <Box
            data-testid="nifty-chart-wrap"
            data-fill={chartHeight == null ? "1" : undefined}
            data-mp-touches={mpTouches.length}
            style={chartHeight == null ? undefined : { height: chartHeight }}
            sx={{
              display: "flex",
              flex: chartHeight == null ? 1 : undefined,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              minHeight: 0,
              flexShrink: 0,
              overflow: "hidden",
              ...fillCap,
            }}
          >
            <TradingViewChart
              candles={chartCandles}
              markLines={markLines}
              emaData={emaData}
              touchMarkers={touchMarkers}
              {...(chartHeight != null ? { height: chartHeight } : {})}
              fitMarkLines
            />
          </Box>
        ) : (
          <EmptyCompact
            data-testid="nifty-chart-empty"
            title="No intraday candles"
            description="Showing option-chain levels only."
          />
        )}
      </Box>
      {depthEverShown ? (
        <Box
          data-testid="nifty-depth-view"
          style={{ display: view === "depth" ? "block" : "none" }}
        >
          <NiftyDepthMap report={report} active={view === "depth"} />
        </Box>
      ) : null}
      {/* The level legend lives on the chart gutter now (dense layout):
          rendering it here cost a full row above the fold. `LevelLegend`
          stays exported for callers/tests that need the decoded key. */}
    </CompactPanel>
  );
});
