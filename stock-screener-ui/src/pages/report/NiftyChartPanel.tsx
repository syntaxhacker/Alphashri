import { formatNumberIN } from "@/utils/ui-helpers";
import { memo, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { Button, SegmentedControl, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { CompactPanel } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import { NiftyDepthMap } from "./NiftyDepthMap";
import { useNiftyPatternScan } from "./useNiftyPatternScan";
import { buildPatternOverlay } from "./niftyPatternOverlay";
import { wallEventOverlay, type WallBurstLike } from "./niftyWallEventOverlay";
import { fillCandleGaps } from "./niftyCandles";
import {
  candlesFromSpotPoints,
  candlesFromTape,
  clipToAsOf,
  isOnSession,
  pickFreshestCandles,
  sessionDateOf,
  type SpotPoint,
} from "./niftyChartData";
import { gexSideLevels } from "./NiftyGexProfile";
import { maxPainTouches } from "./maxPainTouches";
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
  NiftyTape,
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
export {
  candlesFromSpotPoints,
  candlesFromTape,
  clipToAsOf,
  isOnSession,
  pickFreshestCandles,
  sessionDateOf,
  type SpotPoint,
  type TapeSpotPoint,
} from "./niftyChartData";

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
    { code: "CW", color: palette.NEGATIVE, meaning: "max-OI call wall above spot · resistance", zone: true },
    { code: "CW↓", color: palette.NEGATIVE, meaning: "call wall below spot · broken resistance / support", zone: true },
    { code: "CW (BELOW)", color: palette.NEGATIVE, meaning: "call wall below spot (no call above) · broken resistance", zone: true },
    { code: "PW", color: palette.POSITIVE, meaning: "max-OI put wall below spot · support", zone: true },
    { code: "PW↑", color: palette.POSITIVE, meaning: "put wall above spot · broken support / resistance", zone: true },
    { code: "PW (ABOVE)", color: palette.POSITIVE, meaning: "put wall above spot (no put below) · broken support", zone: true },
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
  /** Underlying shown in the panel chrome (NIFTY, SENSEX, RELIANCE). */
  symbol?: string;
  /** Replay/EOD cutoff: never draw candles after the playhead. */
  asOf?: string;
  /** Desk-mode fullscreen: renders a ⤢ button in the header action row. */
  onExpand?: () => void;
  /** Controlled bar timeframe (uncontrolled 1m default when absent). */
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
  /** Initial panel size (uncontrolled, defaults to fill). */
  initialSize?: ChartSize;
  /** Notifies the parent when S/M/L/XL changes, so a DESK row can size to it. */
  onSizeChange?: (size: ChartSize) => void;
  /**
   * Fill mode without the 300px desk cap. The inline desk uses the cap so the
   * band below keeps its height; a pane that owns the whole viewport (the
   * fullscreen modal, or a desk row with nothing under it) passes this so the
   * chart stretches instead of leaving a black band.
   */
  fillContainer?: boolean;
  /** Wall test/rejection/break alerts from the bursts feed, drawn as chart lines/markers. */
  bursts?: WallBurstLike[] | null;
  /** Per-minute tape. Its `spot` fills minutes the candle feed dropped, so a
   *  hole does not become a jump on the chart. */
  tape?: Pick<NiftyTape, "rows"> | null;
  /** 10-second chain snapshots (same feed as the OI strip). When present,
   *  true 1-minute OHLC is built from them — wicks included — for underlyings
   *  whose endpoint carries no candles (SENSEX/RELIANCE). Needs ≥2 valid
   *  minutes; otherwise the tape path is used. */
  spotPoints?: readonly SpotPoint[] | null;
  /** Persisted last 5m flow sign flip (ISO). Draws a no-text marker on the
   *  candle close at that time — the chart engine has no vertical line, and a
   *  point marker is the least invasive way to mark the flip bar. */
  flipAt?: string | null;
  /** Max-OI walls from the same payload the walls card renders. Keeps the
   *  chart's CW/PW lines and the card from naming different strikes. */
  maxWalls?: { calls: { strike: number; oi: number }[]; puts: { strike: number; oi: number }[] } | null;
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
  symbol = "NIFTY",
  asOf,
  onExpand,
  timeframe,
  onTimeframeChange,
  initialSize = "fill",
  onSizeChange,
  fillContainer = false,
  bursts,
  tape,
  spotPoints = null,
  flipAt = null,
  maxWalls = null,
}: NiftyChartPanelProps) {
  const [chartSize, setChartSize] = useState<ChartSize>(initialSize);
  /** `null` = fill the panel (autoSize); a number = fixed preset. */
  const chartHeight =
    chartSize === "fill" ? null : CHART_HEIGHTS[chartSize];
  /** DESK fill cap: the chart body never takes more than 300px of the row,
   *  so the FLOW band below (heatmap + strip) gets the remaining height.
   *  Explicit presets (S/M/L/XL) keep their requested height. */
  const fillCap = chartHeight == null && !fillContainer ? { maxHeight: FILL_MAX_HEIGHT, minHeight: FILL_MIN_HEIGHT } : {};
  const handleSizeChange = (v: string) => {
    const next = v as ChartSize;
    setChartSize(next);
    onSizeChange?.(next);
  };
  /** Chart bar timeframe: 1m native; 5m/15m resampled client-side. */
  const [internalTf, setInternalTf] = useState<ChartTimeframe>("1m");
  const chartTf = timeframe ?? internalTf;
  const { state: patternScan, scan: scanPatterns } = useNiftyPatternScan();
  // Default ON: a scan that returns a pattern should draw it. The chip toggles.
  const [drawPattern, setDrawPattern] = useState(true);
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

  /**
   * Keep the lightweight-charts engine mounted once it has plotted a bar.
   * A poll that briefly returns no intraday candles (pre-open, a feed hiccup,
   * a replay boundary) used to unmount `TradingViewChart` — destroying and
   * rebuilding every canvas, series and price line on the next poll. The empty
   * state is still shown; the chart is just hidden instead of torn down.
   */
  const [candlesEverShown, setCandlesEverShown] = useState(false);

  const linesReport = useMemo(
    () => (maxWalls ? { ...report, walls: maxWalls } : report),
    [report, maxWalls],
  );
  const markLines = useMemo(
    () =>
      buildMarkLines(
        linesReport,
        mode === "live" && !!report.gex,
        labelGapPctFor(linesReport, chartHeight ?? FILL_LABEL_HEIGHT),
      ),
    [linesReport, report.gex, mode, chartSize],
  );

  /** The chart's session date. A live generic report can carry a candle
   *  series from the previous completed session (the first cold fetch) while
   *  the tape already belongs to today; mixing them drew two days with an
   *  overnight jump. Everything below is scoped to this date. */
  const sessionDate = sessionDateOf(report);

  // Generic underlyings (SENSEX/RELIANCE) have no candle endpoint today: the
  // fast options-live payload and `?candles=1` both return an empty intraday
  // series. The 10-second chain feed does carry a spot, so prefer that: six
  // snapshots a minute give true OHLC (open = first spot, close = last,
  // high/low the extremes) with real wicks. The 1-minute tape is the
  // last-resort fallback — its bars span open→close only (no wicks).
  const spotCandles = useMemo(
    () => candlesFromSpotPoints(spotPoints ?? [], sessionDate),
    [spotPoints, sessionDate],
  );
  const tapeCandles = useMemo(
    () => candlesFromTape(tape?.rows ?? [], sessionDate),
    [tape, sessionDate],
  );

  /** 1-minute intraday candles when present, else the 15-min EOD candles —
   *  each resampled to the selected timeframe (1m passes through). */
  const chartCandles = useMemo(() => {
    const base = pickFreshestCandles(report, spotCandles, tapeCandles, sessionDate);
    // The REST snapshot carries the whole day. On replay, stop at the
    // playhead so the chart cannot show candles from the future.
    const clipped = clipToAsOf(base, asOf);
    // Repair poisoned bars and re-fill dropped minutes from the tape BEFORE
    // resampling: a 0.00 close or a five-minute hole otherwise blows up the
    // price scale / prints a fake jump. The tape is session-scoped too, so a
    // previous day's tape can never be appended to today's base.
    const filled = fillCandleGaps(clipped, {
      tape: (tape?.rows ?? []).filter((row) => isOnSession(row.t, sessionDate)),
    });
    return resampleCandles(filled, CHART_TF_MINUTES[chartTf]);
  }, [report, chartTf, asOf, tape, spotCandles, tapeCandles, sessionDate]);

  if (chartCandles.length > 0 && !candlesEverShown) setCandlesEverShown(true);

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

  /**
   * Detected-pattern overlay (trendlines + breakout/target/stop).
   *
   * Only when the scan matches the DISPLAYED timeframe: a 15m pattern drawn on
   * 1m bars is a lie. Switching TF hides the overlay until the next scan.
   */
  const patternOverlay = useMemo(() => {
    if (!drawPattern || patternScan.status !== "ready" || patternScan.tf !== chartTf) return null;
    const hit = patternScan.hits[0];
    if (!hit) return null;
    return buildPatternOverlay(hit, chartCandles);
  }, [drawPattern, patternScan, chartTf, chartCandles]);

  const chartEmaData = useMemo(
    () => (patternOverlay ? [...emaData, ...patternOverlay.lines] : emaData),
    [emaData, patternOverlay],
  );
  // The bursts feed always carries the whole session, while an EOD replay is
  // clipped at the playhead. Without this guard a 15:29 break is drawn (and
  // its wall/target lines added) while the replay clock still reads 09:17 —
  // look-ahead that makes the chart lie about what was knowable at the time.
  const wallOverlay = useMemo(() => {
    if (!asOf) return wallEventOverlay(bursts);
    const cutoff = Date.parse(asOf);
    if (!Number.isFinite(cutoff)) return wallEventOverlay(bursts);
    const scoped = (bursts ?? []).filter((burst) => {
      if (!burst.t) return true;
      const t = Date.parse(burst.t);
      return !Number.isFinite(t) || t <= cutoff;
    });
    return wallEventOverlay(scoped);
  }, [bursts, asOf]);
  const chartMarkLines = useMemo(
    () => [...markLines, ...(patternOverlay?.markLines ?? []), ...wallOverlay.markLines],
    [markLines, patternOverlay, wallOverlay],
  );

  /** Bars whose close sits on the report's max pain (tolerance derived from strike step). */
  const mpTouches = useMemo(
    () =>
      maxPainTouches(
        chartCandles.map((c) => ({ value: c.close, maxPain: report.maxPain, time: c.time })),
        report,
      ),
    [chartCandles, report.maxPain, report.strikes],
  );
  /** Flow-flip marker: the candle at/before the flip stamp, drawn as a small
   *  amber dot on its close with no text (lightweight-charts has no vertical
   *  price-line primitive; a marker is the least invasive overlay). */
  const flipMarker = useMemo(() => {
    if (!flipAt || chartCandles.length === 0) return [];
    const flipMs = Date.parse(flipAt);
    if (!Number.isFinite(flipMs)) return [];
    let best = chartCandles[0];
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const candle of chartCandles) {
      const ms = Date.parse(candle.time);
      if (!Number.isFinite(ms) || ms > flipMs) continue;
      if (ms >= bestMs) {
        best = candle;
        bestMs = ms;
      }
    }
    return [
      {
        time: best.time,
        value: best.close,
        shape: "circle" as const,
        color: palette.WARNING,
        position: "aboveBar" as const,
        size: 2,
      },
    ];
  }, [flipAt, chartCandles]);

  const touchMarkers = useMemo(
    () => [
      ...mpTouches.map((t) => ({ time: t.point.time, value: t.value })),
      ...wallOverlay.markers,
      ...flipMarker,
    ],
    [mpTouches, wallOverlay, flipMarker],
  );

  return (
    <CompactPanel
      title={
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          {view === "depth" ? `${symbol} depth map` : `${symbol} chart`}
          {wallOverlay.markers.length > 0 ? (
            <Text
              component="span"
              data-testid="nifty-chart-event-badge"
              sx={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "warning.main",
              }}
            >
              {wallOverlay.markers.length} event{wallOverlay.markers.length === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      }
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
            <Button
              data-testid="nifty-patterns-scan"
              size="xs"
              variant="subtle"
              onClick={() => scanPatterns(chartTf)}
              disabled={patternScan.status === "loading"}
              title={`Run the chart-pattern detector on ${symbol} ${chartTf}`}
              sx={{ minWidth: 0, px: "6px", py: 0, height: 20, fontSize: 9, fontWeight: 800, letterSpacing: "0.06em" }}
            >
              {patternScan.status === "loading" ? "…" : "PATTERNS"}
            </Button>
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
        {chartCandles.length === 0 ? (
          <EmptyCompact
            data-testid="nifty-chart-empty"
            title="No intraday candles"
            description="Showing option-chain levels only."
          />
        ) : null}
        {chartCandles.length > 0 || candlesEverShown ? (
          <Box
            data-testid="nifty-chart-wrap"
            data-fill={chartHeight == null ? "1" : undefined}
            data-mp-touches={mpTouches.length}
            data-flip-marker={flipMarker.length > 0 ? "1" : "0"}
            style={chartHeight == null ? undefined : { height: chartHeight }}
            sx={{
              // Hidden (not unmounted) when a poll returns no candles — see
              // `candlesEverShown`.
              display: chartCandles.length > 0 ? "flex" : "none",
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
              markLines={chartMarkLines}
              emaData={chartEmaData}
              touchMarkers={touchMarkers}
              {...(chartHeight != null ? { height: chartHeight } : {})}
              fitMarkLines
            />
          </Box>
        ) : null}
      </Box>
      {patternScan.status !== "idle" && view === "chart" ? (
        <Box
          data-testid="nifty-patterns-strip"
          data-status={patternScan.status}
          title={
            patternScan.status === "ready"
              ? patternScan.hits.length
                ? (() => {
                    const h = patternScan.hits[0];
                    const lvl = (v?: number | null) =>
                      typeof v === "number" && Number.isFinite(v)
                        ? formatNumberIN(Math.round(v))
                        : "—";
                    // The target is often off-scale by design (it would squash
                    // the candles), so the tooltip always carries all three.
                    return `${h.pattern_name} · ${h.direction} · ${Math.round(h.confidence)}% · ${h.status} · ${
                      h.bars_ago === 0 ? "now" : `${h.bars_ago} bars ago`
                    } · BRK ${lvl(h.breakout_level)} · TGT ${lvl(h.target)} · SL ${lvl(h.stop)}`;
                  })()
                : "No pattern in the scanned window"
              : patternScan.status === "error"
                ? patternScan.message
                : `Scanning ${symbol} ${patternScan.tf}…`
          }
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            height: 18,
            minHeight: 18,
            mt: "2px",
            px: "4px",
            fontFamily: palette.MONO,
            fontSize: 9,
            whiteSpace: "nowrap",
            overflow: "hidden",
            color: palette.TEXT_MUTED,
            borderTop: `1px solid ${palette.TERM_BORDER}`,
          }}
        >
          <Box component="span" sx={{ fontWeight: 800, letterSpacing: "0.08em" }}>
            PATTERNS {patternScan.tf}
          </Box>
          {patternScan.status === "loading" ? (
            <Box component="span">scanning…</Box>
          ) : patternScan.status === "error" ? (
            <Box component="span" sx={{ color: palette.NEGATIVE }}>{patternScan.message}</Box>
          ) : patternScan.hits.length === 0 ? (
            <Box component="span">no pattern</Box>
          ) : (
            <>
              <Box
                component="span"
                data-testid={`nifty-pattern-${patternScan.hits[0].pattern_id}`}
                sx={{
                  color:
                    patternScan.hits[0].direction === "bullish"
                      ? palette.POSITIVE
                      : patternScan.hits[0].direction === "bearish"
                        ? palette.NEGATIVE
                        : palette.TEXT,
                  fontWeight: 700,
                }}
              >
                {patternScan.hits[0].pattern_name}
                {patternScan.hits[0].direction === "bullish"
                  ? " ↑"
                  : patternScan.hits[0].direction === "bearish"
                    ? " ↓"
                    : " ·"}{" "}
                {Math.round(patternScan.hits[0].confidence)}%
              </Box>
              <Box component="span" sx={{ opacity: 0.8 }}>
                {patternScan.hits[0].status}
              </Box>
            </>
          )}
          <Box
            component="span"
            data-testid="nifty-patterns-draw"
            data-on={drawPattern ? "1" : "0"}
            role="button"
            aria-pressed={drawPattern}
            onClick={() => setDrawPattern((v) => !v)}
            title={
              patternScan.tf === chartTf
                ? `${drawPattern ? "Hide" : "Show"} the pattern on the chart`
                : `Pattern was scanned on ${patternScan.tf}; rescan on ${chartTf} to draw it here`
            }
            sx={{
              ml: "auto",
              cursor: "pointer",
              fontWeight: 800,
              letterSpacing: "0.06em",
              color: drawPattern ? palette.PRIMARY : palette.TEXT_MUTED,
              opacity: patternScan.tf === chartTf ? 1 : 0.5,
              "&:hover": { color: palette.TEXT },
            }}
          >
            {drawPattern ? "DRAW ON" : "DRAW OFF"}
          </Box>
        </Box>
      ) : null}
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
