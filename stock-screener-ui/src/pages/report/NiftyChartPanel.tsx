import { formatNumberIN } from "@/utils/ui-helpers";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ActionIcon, Button, SegmentedControl, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { LocalCompactPanel } from "./reportBits";
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

export function LevelLegend(props: LevelLegendProps) {
  const live = () => props.live;
  const sides = () => (props.gex ? gexSideLevels(props.gex, props.spot ?? NaN) : null);
  // A present block filters to drawable levels; callers that only pass `live`
  // keep the legacy "show every code" behaviour.
  const show = () => ({
    flip: !props.gex || props.gex.zeroCross != null,
    support: !props.gex || sides()?.below?.kind === "support",
    resistance: !props.gex || sides()?.above?.kind === "resistance",
    fuel:
      !props.gex ||
      sides()?.below?.kind === "fuel" ||
      sides()?.above?.kind === "fuel",
  });
  const items: { code: string; color: string; meaning: string; zone?: boolean }[] = [
    { code: "CW", color: palette.NEGATIVE, meaning: "max-OI call wall above spot · resistance", zone: true },
    { code: "CW↓", color: palette.NEGATIVE, meaning: "call wall below spot · broken resistance / support", zone: true },
    { code: "CW (BELOW)", color: palette.NEGATIVE, meaning: "call wall below spot (no call above) · broken resistance", zone: true },
    { code: "PW", color: palette.POSITIVE, meaning: "max-OI put wall below spot · support", zone: true },
    { code: "PW↑", color: palette.POSITIVE, meaning: "put wall above spot · broken support / resistance", zone: true },
    { code: "PW (ABOVE)", color: palette.POSITIVE, meaning: "put wall above spot (no put below) · broken support", zone: true },
    { code: "MP", color: palette.PRIMARY, meaning: "max pain · expiry magnet", zone: true },
  ];
  if (live()) {
    if (show().flip) {
      items.push(
        { code: "FLIP", color: palette.WARNING, meaning: "gamma flip · dealers switch sides here" },
      );
    }
    if (show().support) {
      items.push(
        { code: "GSUP", color: palette.POSITIVE, meaning: "gamma support · pin magnet below spot" },
      );
    }
    if (show().resistance) {
      items.push(
        { code: "GRES", color: palette.NEGATIVE, meaning: "gamma resistance · pin magnet above spot" },
      );
    }
    if (show().fuel) {
      items.push(
        { code: "GFUEL", color: palette.WARNING, meaning: "gamma fuel · moves accelerate on that side" },
      );
    }
  }
  return (
    // Single dense wrapped row: tight gaps + minimal top pad so the legend
    // costs one ~16px row instead of two. Fonts/symbols untouched.
    <div
      data-testid="nifty-level-legend"
      class="flex flex-wrap"
      style={{ "column-gap": "8px", "row-gap": "4px", "padding-top": "4px" }}
    >
      <For each={items}>{(it) => (
        <div
          class="flex items-center"
          style={{ gap: "8px", "white-space": "nowrap" }}
        >
          <div
            style={{
              width: it.zone ? "12px" : "8px",
              height: "8px",
              "border-radius": it.zone ? "1px" : "50%",
              "background-color": it.zone ? hexToRgba(it.color, 0.18) : it.color,
              border: it.zone ? `1px solid ${it.color}` : "none",
              "flex-shrink": 0,
            }}
          />
          <Text size="xs" fw={700} span>
            {it.code}
          </Text>
          <Text size="xs" c="dimmed" span>
            {it.meaning}
          </Text>
        </div>
      )}</For>
    </div>
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
export function NiftyChartPanel(props: NiftyChartPanelProps) {
  const report = () => props.report;
  const mode = () => props.mode;
  const view = () => props.view;
  const symbol = () => props.symbol ?? "NIFTY";
  const asOf = () => props.asOf;
  const fillContainer = () => props.fillContainer ?? false;
  const bursts = () => props.bursts ?? null;
  const tape = () => props.tape ?? null;
  const spotPoints = () => props.spotPoints ?? null;
  const flipAt = () => props.flipAt ?? null;
  const maxWalls = () => props.maxWalls ?? null;

  const [chartSize, setChartSize] = createSignal<ChartSize>(props.initialSize ?? "fill");
  /** `null` = fill the panel (autoSize); a number = fixed preset. */
  const chartHeight = () => {
    const size = chartSize();
    return size === "fill" ? null : CHART_HEIGHTS[size];
  };
  const handleSizeChange = (v: string) => {
    const next = v as ChartSize;
    setChartSize(next);
    props.onSizeChange?.(next);
  };
  /** Chart bar timeframe: 1m native; 5m/15m resampled client-side. */
  const [internalTf, setInternalTf] = createSignal<ChartTimeframe>("1m");
  const chartTf = () => props.timeframe ?? internalTf();
  const { state: patternScan, scan: scanPatterns } = useNiftyPatternScan();
  // Default ON: a scan that returns a pattern should draw it. The chip toggles.
  const [drawPattern, setDrawPattern] = createSignal(true);
  const handleTfChange = (v: string) => {
    const next = v as ChartTimeframe;
    if (props.onTimeframeChange) props.onTimeframeChange(next);
    else setInternalTf(next);
  };

  // Lazy depth mount: switching views used to cold-mount ECharts (~380ms),
  // so the depth subtree is not created until first selected. Afterwards
  // both views stay mounted and visibility toggles via `display: none`,
  // making Chart<->Depth switches instant.
  const [depthEverShown, setDepthEverShown] = createSignal(false);
  createEffect(() => {
    if (view() === "depth") setDepthEverShown(true);
  });

  /**
   * Keep the lightweight-charts engine mounted once it has plotted a bar.
   * A poll that briefly returns no intraday candles (pre-open, a feed hiccup,
   * a replay boundary) used to unmount `TradingViewChart` — destroying and
   * rebuilding every canvas, series and price line on the next poll. The empty
   * state is still shown; the chart is just hidden instead of torn down.
   */
  const [candlesEverShown, setCandlesEverShown] = createSignal(false);

  const linesReport = createMemo(() => (maxWalls() ? { ...report(), walls: maxWalls()! } : report()));
  const markLines = createMemo(() =>
    buildMarkLines(
      linesReport(),
      mode() === "live" && !!report().gex,
      labelGapPctFor(linesReport(), chartHeight() ?? FILL_LABEL_HEIGHT),
    ),
  );

  /** The chart's session date. A live generic report can carry a candle
   *  series from the previous completed session (the first cold fetch) while
   *  the tape already belongs to today; mixing them drew two days with an
   *  overnight jump. Everything below is scoped to this date. */
  const sessionDate = () => sessionDateOf(report());

  // Generic underlyings (SENSEX/RELIANCE) have no candle endpoint today: the
  // fast options-live payload and `?candles=1` both return an empty intraday
  // series. The 10-second chain feed does carry a spot, so prefer that: six
  // snapshots a minute give true OHLC (open = first spot, close = last,
  // high/low the extremes) with real wicks. The 1-minute tape is the
  // last-resort fallback — its bars span open→close only (no wicks).
  const spotCandles = createMemo(() => candlesFromSpotPoints(spotPoints() ?? [], sessionDate()));
  const tapeCandles = createMemo(() => candlesFromTape(tape()?.rows ?? [], sessionDate()));

  /** 1-minute intraday candles when present, else the 15-min EOD candles —
   *  each resampled to the selected timeframe (1m passes through). */
  const chartCandles = createMemo(() => {
    const base = pickFreshestCandles(report(), spotCandles(), tapeCandles(), sessionDate());
    // The REST snapshot carries the whole day. On replay, stop at the
    // playhead so the chart cannot show candles from the future.
    const clipped = clipToAsOf(base, asOf());
    // Repair poisoned bars and re-fill dropped minutes from the tape BEFORE
    // resampling: a 0.00 close or a five-minute hole otherwise blows up the
    // price scale / prints a fake jump. The tape is session-scoped too, so a
    // previous day's tape can never be appended to today's base.
    const filled = fillCandleGaps(clipped, {
      tape: (tape()?.rows ?? []).filter((row) => isOnSession(row.t, sessionDate())),
    });
    return resampleCandles(filled, CHART_TF_MINUTES[chartTf()]);
  });
  createEffect(() => {
    if (chartCandles().length > 0) setCandlesEverShown(true);
  });

  /** EMA9 (warning) + EMA20 (primary), recomputed on the displayed candles so
   *  the overlays always match the selected timeframe. The backend `emas`
   *  block is intentionally ignored here (it is fixed to the 1-minute grid). */
  const emaData = createMemo(() => {
    const closes = chartCandles().map((c) => c.close);
    return [
      { label: "EMA9", color: palette.WARNING, data: emaSeries(closes, 9) },
      { label: "EMA20", color: palette.PRIMARY, data: emaSeries(closes, 20) },
    ];
  });

  /**
   * Detected-pattern overlay (trendlines + breakout/target/stop).
   *
   * Only when the scan matches the DISPLAYED timeframe: a 15m pattern drawn on
   * 1m bars is a lie. Switching TF hides the overlay until the next scan.
   */
  const patternOverlay = createMemo(() => {
    const scan = patternScan();
    if (!drawPattern() || scan.status !== "ready" || scan.tf !== chartTf()) return null;
    const hit = scan.hits[0];
    if (!hit) return null;
    return buildPatternOverlay(hit, chartCandles());
  });

  const chartEmaData = createMemo(() => {
    const overlay = patternOverlay();
    return overlay ? [...emaData(), ...overlay.lines] : emaData();
  });
  // The bursts feed always carries the whole session, while an EOD replay is
  // clipped at the playhead. Without this guard a 15:29 break is drawn (and
  // its wall/target lines added) while the replay clock still reads 09:17 —
  // look-ahead that makes the chart lie about what was knowable at the time.
  const wallOverlay = createMemo(() => {
    const rawAsOf = asOf();
    if (!rawAsOf) return wallEventOverlay(bursts());
    const cutoff = Date.parse(rawAsOf);
    if (!Number.isFinite(cutoff)) return wallEventOverlay(bursts());
    const scoped = (bursts() ?? []).filter((burst) => {
      if (!burst.t) return true;
      const t = Date.parse(burst.t);
      return !Number.isFinite(t) || t <= cutoff;
    });
    return wallEventOverlay(scoped);
  });
  const chartMarkLines = createMemo(() => [
    ...markLines(),
    ...(patternOverlay()?.markLines ?? []),
    ...wallOverlay().markLines,
  ]);

  /** Bars whose close sits on the report's max pain (tolerance derived from strike step). */
  const mpTouches = createMemo(() =>
    maxPainTouches(
      chartCandles().map((c) => ({ value: c.close, maxPain: report().maxPain, time: c.time })),
      report(),
    ),
  );
  /** Flow-flip marker: the candle at/before the flip stamp, drawn as a small
   *  amber dot on its close with no text (lightweight-charts has no vertical
   *  price-line primitive; a marker is the least invasive overlay). */
  const flipMarker = createMemo(() => {
    const rawFlipAt = flipAt();
    const candles = chartCandles();
    if (!rawFlipAt || candles.length === 0) return [];
    const flipMs = Date.parse(rawFlipAt);
    if (!Number.isFinite(flipMs)) return [];
    let best = candles[0];
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const candle of candles) {
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
  });

  const touchMarkers = createMemo(() => [
    ...mpTouches().map((t) => ({ time: t.point.time, value: t.value })),
    ...wallOverlay().markers,
    ...flipMarker(),
  ]);

  return (
    <LocalCompactPanel
      title={
        <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
          {view() === "depth" ? `${symbol()} depth map` : `${symbol()} chart`}
          <Show when={wallOverlay().markers.length > 0}>
            <Text
              data-testid="nifty-chart-event-badge"
              style={{
                "font-size": "9px",
                "font-weight": 700,
                "letter-spacing": "0.4em",
                "text-transform": "uppercase",
                color: palette.WARNING,
              }}
            >
              {wallOverlay().markers.length} event{wallOverlay().markers.length === 1 ? "" : "s"}
            </Text>
          </Show>
        </span>
      }
      testId="nifty-chart-panel"
      class="[&_[data-compact-card-content]]:flex-1 [&_[data-compact-card-content]]:min-h-0"
      style={{ "min-width": "0px", "min-height": "0px", height: "100%", overflow: "hidden", display: "flex", "flex-direction": "column" }}
      action={
        view() === "chart" ? (
          <div class="flex items-center" style={{ gap: "4px" }}>
            <SegmentedControl
              data-testid="nifty-tf-toggle"
              value={chartTf()}
              onChange={handleTfChange}
              data={CHART_TF_OPTIONS}
              size="xs"
            />
            <Button
              data-testid="nifty-patterns-scan"
              size="xs"
              variant="subtle"
              onClick={() => scanPatterns(chartTf())}
              disabled={patternScan().status === "loading"}
              title={`Run the chart-pattern detector on ${symbol()} ${chartTf()}`}
              style={{ "min-width": "0px", "padding-left": "6px", "padding-right": "6px", "padding-top": "0px", "padding-bottom": "0px", "height": "20px", "font-size": "9px", "font-weight": 800, "letter-spacing": "0.06em" }}
            >
              {patternScan().status === "loading" ? "…" : "PATTERNS"}
            </Button>
            <SegmentedControl
              data-testid="nifty-chart-size"
              value={chartSize()}
              onChange={handleSizeChange}
              data={CHART_SIZE_OPTIONS}
              size="xs"
            />
            <Show when={props.onExpand}>
              <ActionIcon
                data-testid="nifty-chart-expand"
                aria-label="Expand chart fullscreen"
                title="Fullscreen (F)"
                size={20}
                onClick={props.onExpand}
                style={{ padding: "1px", color: palette.TEXT_MUTED }}
              >
                <Text span size="xs" fw={700} style={{ "font-size": "13px", "line-height": 1 }}>
                  ⤢
                </Text>
              </ActionIcon>
            </Show>
          </div>
        ) : undefined
      }
    >
      {/*
        * Both views stay mounted after first use; the inactive wrapper is
        * `display: none` (zero layout space) so switching never remounts
        * either chart engine. The depth subtree mounts lazily on first
        * selection via `depthEverShown` above.
        */}
      <div
        data-testid="nifty-chart-view"
        class="flex flex-col"
        style={{
          display: view() === "chart" ? "flex" : "none",
          flex: view() === "chart" ? "1" : undefined,
          "min-height": "0px",
        }}
      >
        <Show when={chartCandles().length === 0}>
          <EmptyCompact
            data-testid="nifty-chart-empty"
            title="No intraday candles"
            description="Showing option-chain levels only."
          />
        </Show>
        <Show when={chartCandles().length > 0 || candlesEverShown()}>
          <div
            data-testid="nifty-chart-wrap"
            data-fill={chartHeight() == null ? "1" : undefined}
            data-mp-touches={mpTouches().length}
            data-flip-marker={flipMarker().length > 0 ? "1" : "0"}
            class="w-full max-w-full min-w-0 shrink-0 overflow-hidden"
            style={{
              ...(chartHeight() == null ? undefined : { height: `${chartHeight()}px` }),
              display: chartCandles().length > 0 ? "flex" : "none",
              flex: chartHeight() == null ? "1" : undefined,
              "min-width": "0px",
              "min-height": "0px",
              "flex-shrink": 0,
              ...(chartHeight() == null && !fillContainer() ? { "max-height": `${FILL_MAX_HEIGHT}px`, "min-height": `${FILL_MIN_HEIGHT}px` } : {}),
            }}
          >
            <TradingViewChart
              candles={chartCandles()}
              markLines={chartMarkLines()}
              emaData={chartEmaData()}
              touchMarkers={touchMarkers()}
              {...(chartHeight() != null ? { height: chartHeight()! } : {})}
              fitMarkLines
            />
          </div>
        </Show>
      </div>
      <Show when={patternScan().status !== "idle" && view() === "chart"}>
        {(() => {
          const scan = patternScan();
          if (scan.status === "idle") return null;
          const tf = scan.tf;
          const firstHit = scan.status === "ready" ? scan.hits[0] : undefined;
          const stripTitle =
            scan.status === "ready"
              ? firstHit
                ? (() => {
                    const lvl = (v?: number | null) =>
                      typeof v === "number" && Number.isFinite(v)
                        ? formatNumberIN(Math.round(v))
                        : "—";
                    // The target is often off-scale by design (it would squash
                    // the candles), so the tooltip always carries all three.
                    return `${firstHit.pattern_name} · ${firstHit.direction} · ${Math.round(firstHit.confidence)}% · ${firstHit.status} · ${
                      firstHit.bars_ago === 0 ? "now" : `${firstHit.bars_ago} bars ago`
                    } · BRK ${lvl(firstHit.breakout_level)} · TGT ${lvl(firstHit.target)} · SL ${lvl(firstHit.stop)}`;
                  })()
                : "No pattern in the scanned window"
              : scan.status === "error"
                ? scan.message
                : `Scanning ${symbol} ${tf}…`;
          return (
            <div
              data-testid="nifty-patterns-strip"
              data-status={scan.status}
              title={stripTitle}
              class="flex items-center"
              style={{
                gap: "6px",
                height: "18px",
                "min-height": "18px",
                "margin-top": "2px",
                "padding-left": "4px",
                "padding-right": "4px",
                "font-family": palette.MONO,
                "font-size": "9px",
                "white-space": "nowrap",
                overflow: "hidden",
                color: palette.TEXT_MUTED,
                "border-top": `1px solid ${palette.TERM_BORDER}`,
              }}
            >
              <span style={{ "font-weight": 800, "letter-spacing": "0.08em" }}>
                PATTERNS {tf}
              </span>
              {scan.status === "loading" ? (
                <span>scanning…</span>
              ) : scan.status === "error" ? (
                <span style={{ color: palette.NEGATIVE }}>{scan.message}</span>
              ) : scan.hits.length === 0 ? (
                <span>no pattern</span>
              ) : (
                <>
                  <span
                    data-testid={`nifty-pattern-${scan.hits[0].pattern_id}`}
                    style={{
                      color:
                        scan.hits[0].direction === "bullish"
                          ? palette.POSITIVE
                          : scan.hits[0].direction === "bearish"
                            ? palette.NEGATIVE
                            : palette.TEXT,
                      "font-weight": 700,
                    }}
                  >
                    {scan.hits[0].pattern_name}
                    {scan.hits[0].direction === "bullish"
                      ? " ↑"
                      : scan.hits[0].direction === "bearish"
                        ? " ↓"
                        : " ·"}{" "}
                    {Math.round(scan.hits[0].confidence)}%
                  </span>
                  <span style={{ opacity: 0.8 }}>
                    {scan.hits[0].status}
                  </span>
                </>
              )}
              <span
                data-testid="nifty-patterns-draw"
                data-on={drawPattern() ? "1" : "0"}
                role="button"
                aria-pressed={drawPattern()}
                onClick={() => setDrawPattern((v) => !v)}
                title={
                  tf === chartTf()
                    ? `${drawPattern() ? "Hide" : "Show"} the pattern on the chart`
                    : `Pattern was scanned on ${tf}; rescan on ${chartTf()} to draw it here`
                }
                style={{
                  "margin-left": "auto",
                  cursor: "pointer",
                  "font-weight": 800,
                  "letter-spacing": "0.06em",
                  color: drawPattern() ? palette.PRIMARY : palette.TEXT_MUTED,
                  opacity: tf === chartTf() ? 1 : 0.5,
                }}
              >
                {drawPattern() ? "DRAW ON" : "DRAW OFF"}
              </span>
            </div>
          );
        })()}
      </Show>
      <Show when={depthEverShown()}>
        <div
          data-testid="nifty-depth-view"
          style={{ display: view() === "depth" ? "block" : "none" }}
        >
          <NiftyDepthMap report={report()} active={view() === "depth"} />
        </div>
      </Show>
      {/* The level legend lives on the chart gutter now (dense layout):
          rendering it here cost a full row above the fold. `LevelLegend`
          stays exported for callers/tests that need the decoded key. */}
    </LocalCompactPanel>
  );
}
