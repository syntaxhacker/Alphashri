import { formatNumberIN, formatTimeOnly } from "@/utils/ui-helpers";
import { createEffect, createMemo, createSignal, For, Show, untrack, type JSX } from "solid-js";
import type { IChartApi } from "lightweight-charts";
import { ActionIcon, Button, SegmentedControl, Text, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { useFyersTickStream, type FyersTick } from "@/hooks/useFyersTickStream";
import { LocalCompactPanel } from "./reportBits";
import { EmptyCompact } from "@/components/common/states";
import { NiftyDepthMap } from "./NiftyDepthMap";
import { PATTERN_LOOKBACK_BARS, useNiftyPatternScan } from "./useNiftyPatternScan";
import { readChartSource, persistChartSource, type ChartSource } from "./niftyReportStore";
import {
  buildPatternOverlay,
  buildPatternScanAnnotation,
  patternNoHitLabel,
} from "./niftyPatternOverlay";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_CONTROL_LABEL_CLASS,
  REPORT_FONT_BODY_VAR,
} from "./reportTokens";
import { wallEventOverlay, type WallBurstLike } from "./niftyWallEventOverlay";
import { fillCandleGaps } from "./niftyCandles";
import {
  candleSeriesSig,
  candlesFromSpotPoints,
  candlesFromTape,
  clipToAsOf,
  effectiveSessionDate,
  isOnSession,
  pickFreshestCandles,
  tapePointsSig,
  type SpotPoint,
} from "./niftyChartData";
import { gexSideLevels } from "./NiftyGexProfile";
import { maxPainTouches } from "./maxPainTouches";
import { hexToRgba } from "@/utils/color";
import {
  buildMarkLines,
  emaSeries,
  labelGapPctFor,
  resampleCandles,
} from "./niftyChartMath";
import type {
  NiftyGex,
  NiftyReport,
  NiftyReportMode,
  NiftyTape,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

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
  type SpotPoint,
  type TapeSpotPoint,
} from "./niftyChartData";

export const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
export type ChartSize = keyof typeof CHART_HEIGHTS | "fill";
/** DESK fill cap: the chart body stops at 300px (min 260px on short screens). */
export const FILL_MAX_HEIGHT = 300;
const FILL_MIN_HEIGHT = 260;
/** Panel chrome above the chart body (22px header + card padding/border). A
 *  DESK row sizes itself to `chart body + CHART_ROW_CHROME` so the card never
 *  leaves a black void under a capped fill chart. */
export const CHART_ROW_CHROME = 48;
/** Mobile (390px) chart-body target. Reached by collapsing the SESSION/WINDOWS
 *  flow band so the flex-1 main row grows; asserted by the layout contract test. */
export const MOBILE_CHART_TARGET = 240;
const FILL_LABEL_HEIGHT = 480;

export type ChartTimeframe = "1m" | "5m" | "15m";
export const CHART_TF_MINUTES: Record<ChartTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
};

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

const CHART_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "live", label: "LIVE" },
  { value: "patterns", label: "PATTERNS" },
  { value: "offline", label: "OFFLINE" },
];

/**
 * Header rhythm: a 16px section title, 12px feed/event metadata and 8px gutters
 * (the report's shared 16/12/8 steps). The eye lands on the symbol before the
 * status. Wide screens keep one row; phones stack the title over two deliberate
 * control rows with the same 8px gutter instead of 4px slop.
 */
export const CHART_HEADER_METRICS = {
  titleSize: REPORT_FONT.value,
  metaSize: REPORT_FONT.micro,
  gap: REPORT_PAD.md,
} as const;

/** Control captions sit one step below the title, on the 12px label floor. */
const CHART_CONTROL_LABEL_STYLE = {
  [REPORT_FONT_BODY_VAR]: `${REPORT_FONT.micro}px`,
} as JSX.CSSProperties;

/**
 * Plot geometry. The time domain ends at the last populated bar plus a narrow,
 * explicitly labelled cutoff lane — no unmarked grid beyond the real session.
 * The engine paints price/volume tags in the right price axis, so that axis has
 * a fixed minimum width and the card keeps an outer gutter; neither tag can
 * clip at the edge.
 */
export const CHART_PLOT_MARGIN = {
  /** Blank pixels after the last candle — the labelled data-cutoff lane. */
  dataCutoffLane: 24,
  /** Minimum right price-axis width — value tag plus volume tag, fully shown. */
  axisMinWidth: 88,
  /** Outer gutter between the price axis and the card boundary. */
  edgeGutter: REPORT_PAD.md,
} as const;

/** Distance from the card's right edge to the last candle / cutoff boundary. */
export const CHART_CUTOFF_RIGHT =
  CHART_PLOT_MARGIN.edgeGutter +
  CHART_PLOT_MARGIN.axisMinWidth +
  CHART_PLOT_MARGIN.dataCutoffLane;

function applyChartPlotMargin(chart: IChartApi): void {
  chart.timeScale().applyOptions({ rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane });
  chart.priceScale("right").applyOptions({
    minimumWidth: CHART_PLOT_MARGIN.axisMinWidth,
    entireTextOnly: true,
  });
}

/** Mirrors the explicit underlyings in `/ws/fyers/ticks` (including its
 *  aliases). Other symbols — notably RELIANCE — are rejected by that endpoint,
 *  so opening a socket for them only produces an `unsupported_symbol` error. */
const FYERS_UNDERLYINGS = new Set([
  "NIFTY",
  "NIFTY50",
  "NIFTY50-INDEX",
  "BANKNIFTY",
  "BANKNIFTY-INDEX",
  "SENSEX",
  "SENSEX-INDEX",
]);

function isFyersUnderlying(symbol: string): boolean {
  const key = symbol.trim().toUpperCase();
  return FYERS_UNDERLYINGS.has(key) || key.includes(":");
}

function overlayFyersTick(bars: ReplayCandle[], tick: FyersTick | null): ReplayCandle[] {
  if (!tick || bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  const tickMs =
    typeof tick.ts === "number" ? tick.ts : Date.parse(String(tick.ts ?? ""));
  const barMs = Date.parse(last.time);
  if (!Number.isFinite(tickMs) || !Number.isFinite(barMs) || tickMs <= barMs) {
    return bars;
  }
  const ltp = tick.ltp;
  if (!Number.isFinite(ltp) || ltp <= 0) return bars;
  const updated: ReplayCandle = {
    ...last,
    close: ltp,
    high: Math.max(last.high, ltp),
    low: Math.min(last.low, ltp),
  };
  return [...bars.slice(0, -1), updated];
}

interface LevelLegendProps {
  live: boolean;
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
  const isMobile = useMediaQuery("(max-width: 600px)");
  const [controlsOpen, setControlsOpen] = createSignal(false);
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

  /** Three-way source. Owned here (not in the store's `view`) so switching
   *  never remounts the panel or refetches — the store's `view` is chart/depth. */
  const [chartSource, setChartSource] = createSignal<ChartSource>(readChartSource());
  createEffect(() => persistChartSource(chartSource()));
  const handleSourceChange = (v: string) => {
    if (v === "live" || v === "patterns" || v === "offline") setChartSource(v);
  };
  const isOffline = () => chartSource() === "offline";

  /** Fyers is a chart-lane feed: it updates the last candle, not the option
   *  chain / walls, and only the underlyings the WS endpoint accepts. */
  // Replay is orthogonal to the chart source: a live tick feed into a
  // historical frame would keep walking the last bar past the playhead.
  const fyersEnabled = () => chartSource() === "live" && isFyersUnderlying(symbol()) && !asOf();
  const fyers = useFyersTickStream({
    symbols: () => [symbol()],
    enabled: fyersEnabled,
  });

  /** While Fyers is live it is authoritative, so a REST poll that arrives with
   *  a fresh (or briefly empty) candle series must not move the chart. The
   *  snapshot is frozen on the live transition and released on drop — the poll
   *  is the fallback, never the thing that leaves the desk with no data. */
  interface CandleFeed {
    report: Pick<NiftyReport, "intraday" | "candles">;
    tape: Pick<NiftyTape, "rows"> | null;
    spot: readonly SpotPoint[] | null;
  }
  const [frozenFeed, setFrozenFeed] = createSignal<CandleFeed | null>(null);
  const currentFeed = (): CandleFeed => ({
    report: report(),
    tape: tape(),
    spot: spotPoints(),
  });
  const candleFeed = (): CandleFeed => frozenFeed() ?? currentFeed();
  const newestBarMs = (feed: CandleFeed): number => {
    const times = [
      feed.report.intraday?.at(-1)?.time,
      feed.report.candles?.at(-1)?.time,
      feed.spot?.at(-1)?.t,
      feed.tape?.rows?.at(-1)?.t,
    ];
    let newest = 0;
    for (const value of times) {
      const ms = Date.parse(value ?? "");
      if (Number.isFinite(ms) && ms > newest) newest = ms;
    }
    return newest;
  };
  createEffect(() => {
    const authoritative = fyersEnabled() && fyers.isLive();
    if (!authoritative) {
      if (frozenFeed()) setFrozenFeed(null);
      return;
    }
    const feed = currentFeed();
    const frozen = frozenFeed();
    const hasSeries =
      (feed.report.intraday?.length ?? 0) > 0 ||
      (feed.report.candles?.length ?? 0) > 0 ||
      (feed.spot?.length ?? 0) > 0 ||
      (feed.tape?.rows?.length ?? 0) > 0;
    if (!hasSeries) return;
    // A newer bar is a genuine session advance, not a poll overwriting the
    // tick: accept it so the chart cannot stay pinned to a stale minute.
    if (!frozen || newestBarMs(feed) > newestBarMs(frozen)) setFrozenFeed(feed);
  });

  /** A tick only matters while the stream is actually delivering; a cached
   *  last tick from before a drop must not keep walking the last bar. */
  const chartTick = (): FyersTick | null => {
    if (!fyersEnabled() || !fyers.isLive()) return null;
    const tick = fyers.lastTick(symbol());
    return tick && Number.isFinite(tick.ltp) ? tick : null;
  };
  const tickSig = () => {
    const tick = chartTick();
    return tick ? `${tick.ltp}|${String(tick.ts ?? "")}` : "";
  };

  /** Header status for the chart-lane feed. Short on purpose: the mobile
   *  header is one row and must not steal height from the 111px chart. The
   *  tooltip names the other feed so the two WS labels cannot be confused. */
  const feedView = (): { state: string; label: string; color: string; title: string } | null => {
    if (!fyersEnabled()) return null;
    const title =
      "Fyers tick feed for this chart's last candle. The page header's 'live (WS)' is the separate Upstox report stream.";
    if (fyers.isLive()) {
      return { state: "live", label: "FYERS LIVE", color: palette.POSITIVE, title };
    }
    if (fyers.isReconnecting()) {
      return { state: "reconnecting", label: "FYERS RECON", color: palette.WARNING, title: `${title} REST poll is the fallback.` };
    }
    if (fyers.isMarketClosed()) {
      return { state: "market-closed", label: "FYERS CLOSED", color: palette.TEXT_MUTED, title: `${title} REST poll is the fallback.` };
    }
    if (fyers.isDisconnected()) {
      return { state: "disconnected", label: "FYERS OFFLINE", color: palette.NEGATIVE, title: `${title} REST poll is the fallback.` };
    }
    return { state: "connecting", label: "FYERS LINK…", color: palette.TEXT_MUTED, title: `${title} REST poll is the fallback.` };
  };

  /** Replay is orthogonal to the chart source: whichever candle pipeline feeds
   *  the chart, a supplied playhead stops it from drawing future candles. The
   *  parent passes `undefined` outside EOD, so live mode is unchanged. */
  const effectiveAsOf = () => asOf() ?? undefined;
  const offlineUnavailable = () => isOffline() && !asOf();

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
  const sessionDate = () => effectiveSessionDate(report());

  // Generic underlyings (SENSEX/RELIANCE) have no candle endpoint today: the
  // fast options-live payload and `?candles=1` both return an empty intraday
  // series. The 10-second chain feed does carry a spot, so prefer that: six
  // snapshots a minute give true OHLC (open = first spot, close = last,
  // high/low the extremes) with real wicks. The 1-minute tape is the
  // last-resort fallback — its bars span open→close only (no wicks).
  //
  // The whole pipeline is gated on a content signature: report/tape/spot
  // arrays get a new identity on every poll even when the candles are
  // identical, and the chain below costs 3–7 ms per frame.
  const chartInputsSig = createMemo(() =>
    [
      sessionDate(),
      effectiveAsOf() ?? "",
      // Source is part of the key so switching Live↔Offline recomputes the
      // clip even when every other input is byte-identical.
      String(chartSource()),
      String(chartTf()),
      tickSig(),
      candleSeriesSig(candleFeed().report.intraday ?? []),
      candleSeriesSig(candleFeed().report.candles ?? []),
      tapePointsSig(candleFeed().spot ?? []),
      tapePointsSig(candleFeed().tape?.rows ?? []),
    ].join("~"),
  );

  let chartCache: { sig: string; data: ReturnType<typeof resampleCandles> } | null = null;

  /** 1-minute intraday candles when present, else the 15-min EOD candles —
   *  each resampled to the selected timeframe (1m passes through). */
  const chartCandles = createMemo(() => {
    // OFFLINE with no replay frame has no recorded series to draw.
    if (offlineUnavailable()) return [];
    const sig = chartInputsSig();
    if (chartCache?.sig === sig) return chartCache.data;

    const data = untrack(() => {
      const feed = candleFeed();
      const spot = candlesFromSpotPoints(feed.spot ?? [], sessionDate());
      const tapeBars = candlesFromTape(feed.tape?.rows ?? [], sessionDate());
      const base = pickFreshestCandles(feed.report, spot, tapeBars, sessionDate());
      // The REST snapshot carries the whole day. Any poll replaying history
      // (including one arriving while LIVE/PATTERNS is selected) is cut here,
      // before gap-filling/resampling can turn it into post-playhead bars.
      const clipped = clipToAsOf(base, effectiveAsOf());
      // Repair poisoned bars and re-fill dropped minutes from the tape BEFORE
      // resampling: a 0.00 close or a five-minute hole otherwise blows up the
      // price scale / prints a fake jump. The tape is session-scoped too, so a
      // previous day's tape can never be appended to today's base.
      const filled = fillCandleGaps(clipped, {
        tape: (feed.tape?.rows ?? []).filter((row) => isOnSession(row.t, sessionDate())),
      });
      const bars = resampleCandles(filled, CHART_TF_MINUTES[chartTf()]);
      // Overlay the live price on the final bar of the *displayed* timeframe.
      // Same array length in, same array length out: no per-tick bar.
      return overlayFyersTick(bars, chartTick());
    });

    chartCache = { sig, data };
    return data;
  });
  createEffect(() => {
    if (chartCandles().length > 0) setCandlesEverShown(true);
  });

  /** Last populated bar (or the replay playhead) drives both the header
   *  as-of chip and the in-plot cutoff boundary, so they can never disagree
   *  about where the data actually ends. */
  const lastDataTime = createMemo(() => {
    const bars = chartCandles();
    return bars.length ? bars[bars.length - 1].time : effectiveAsOf() ?? "";
  });
  const lastDataLabel = createMemo(() => {
    const time = lastDataTime();
    return time ? formatTimeOnly(time) : "—";
  });
  const lastDataState = createMemo(() => {
    if (asOf()) return "replay";
    return report().market?.is_open === false ? "market closed" : "live";
  });
  const lastDataBoundary = createMemo(() =>
    lastDataTime() ? `LAST DATA ${lastDataLabel()} · ${lastDataState()}` : "",
  );

  /** OFFLINE with no recorded frames (or a frame with no candles) gets an
   *  explicit empty state instead of a blank chart. */
  const offlineEmpty = () => isOffline() && (!asOf() || chartCandles().length === 0);

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
    if (
      chartSource() !== "patterns" ||
      !drawPattern() ||
      scan.status !== "ready" ||
      scan.tf !== chartTf()
    ) return null;
    const hit = scan.hits[0];
    if (!hit) return null;
    return buildPatternOverlay(hit, chartCandles());
  });

  /** A no-result scan still annotates the chart: one muted dot on the last bar
   *  marks that the window was examined. No level is drawn when nothing matched. */
  const scanAnnotation = createMemo(() => {
    const scan = patternScan();
    if (
      chartSource() !== "patterns" ||
      scan.status !== "ready" ||
      scan.hits.length > 0 ||
      scan.tf !== chartTf()
    ) return null;
    return buildPatternScanAnnotation({
      candles: chartCandles(),
      timeframe: scan.tf,
      lookbackBars: PATTERN_LOOKBACK_BARS,
      hitCount: scan.hits.length,
      markerColor: palette.TEXT_MUTED,
    });
  });

  /** In-chart result badge. An overlay, not a stacked panel, so the 111px
   *  mobile chart keeps its height. */
  const scanBadge = createMemo(() => {
    const scan = patternScan();
    if (chartSource() !== "patterns" || scan.status !== "ready") return null;
    const hit = scan.hits[0];
    return {
      text: hit
        ? `${scan.tf} · ${hit.pattern_name} · ${Math.round(hit.confidence)}%`
        : patternNoHitLabel(scan.tf, PATTERN_LOOKBACK_BARS),
      color: hit
        ? hit.direction === "bullish"
          ? palette.POSITIVE
          : hit.direction === "bearish"
            ? palette.NEGATIVE
            : palette.TEXT
        : palette.TEXT,
      title: hit
        ? `${hit.pattern_id} · ${hit.status} · ${scan.tf}`
        : `Scanned window: up to ${PATTERN_LOOKBACK_BARS} × ${scan.tf} bars · data through ${scan.dataThrough ?? "unknown"}`,
    };
  });

  /** Chart-input observability: LIVE/OFFLINE never carry a pattern overlay. */
  const patternSourceState = createMemo(() => {
    const scan = patternScan();
    if (chartSource() !== "patterns") return "off";
    if (scan.status === "idle" || scan.status === "loading" || scan.status === "error") {
      return scan.status;
    }
    return scan.hits.length > 0 ? "hit" : "none";
  });
  const patternOverlayCount = createMemo(() => {
    const scan = patternScan();
    return chartSource() === "patterns" && scan.status === "ready" && scan.hits.length > 0 ? 1 : 0;
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
    ...(scanAnnotation() ? [scanAnnotation()!.marker] : []),
  ]);

  const sourceToggle = () => (
    <SegmentedControl
      data-testid="nifty-chart-source"
      value={chartSource()}
      onChange={handleSourceChange}
      data={CHART_SOURCE_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const timeframeToggle = () => (
    <SegmentedControl
      data-testid="nifty-tf-toggle"
      value={chartTf()}
      onChange={handleTfChange}
      data={CHART_TF_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const sizeToggle = () => (
    <SegmentedControl
      data-testid="nifty-chart-size"
      value={chartSize()}
      onChange={handleSizeChange}
      data={CHART_SIZE_OPTIONS}
      size="md"
      className={REPORT_CONTROL_LABEL_CLASS}
      style={CHART_CONTROL_LABEL_STYLE}
    />
  );
  const patternButton = () => (
    <Button
      data-testid="nifty-patterns-scan"
      size="xs"
      variant="subtle"
      onClick={() => scanPatterns(chartTf())}
      disabled={patternScan().status === "loading"}
      title={`Run the chart-pattern detector on ${symbol()} ${chartTf()}`}
      style={{ "min-width": "0px", "padding-left": "6px", "padding-right": "6px", "padding-top": "0px", "padding-bottom": "0px", "height": "20px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800, "letter-spacing": "0.06em" }}
    >
      {patternScan().status === "loading" ? "…" : "PATTERNS"}
    </Button>
  );
  const expandButton = () => (
    <Show when={props.onExpand}>
      <ActionIcon
        data-testid="nifty-chart-expand"
        aria-label="Expand chart fullscreen"
        title="Fullscreen (F)"
        size={20}
        onClick={props.onExpand}
        style={{ padding: "1px", color: palette.TEXT_MUTED }}
      >
        <Text span size="xs" fw={700} style={{ "font-size": `${REPORT_FONT.body}px`, "line-height": 1 }}>
          ⤢
        </Text>
      </ActionIcon>
    </Show>
  );
  /** Data-cutoff readout, not a control: the time the populated session ends. */
  const asOfChip = () => (
    <Text
      data-testid="nifty-chart-asof"
      data-header-role="asof"
      span
      c="dimmed"
      title={lastDataBoundary() || "No chart data"}
      class="whitespace-nowrap shrink-0"
      style={{
        "font-size": `${CHART_HEADER_METRICS.metaSize}px`,
        "font-weight": REPORT_FONT_WEIGHT.semibold,
        "letter-spacing": REPORT_LETTER_SPACING.normal,
      }}
    >
      AS OF {lastDataLabel()}
    </Text>
  );
  /** Size + pattern actions are secondary: desktop keeps them behind a
   *  disclosure, mobile behind the existing MORE row. */
  const primaryControls = () => (
    <>
      {timeframeToggle()}
      {asOfChip()}
      {expandButton()}
    </>
  );
  const secondaryControls = () => (
    <>
      {sizeToggle()}
      {patternButton()}
    </>
  );

  return (
    <LocalCompactPanel
      title={
        <span
          data-testid="nifty-chart-title"
          data-header-role="title"
          class="inline-flex items-center gap-2 whitespace-nowrap shrink-0 max-[640px]:whitespace-normal max-[640px]:shrink"
          style={{
            "font-size": `${CHART_HEADER_METRICS.titleSize}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            "line-height": REPORT_LINE_HEIGHT.snug,
            "margin-right": `${CHART_HEADER_METRICS.gap}px`,
          }}
        >
          {view() === "depth" ? `${symbol()} depth map` : `${symbol()} chart`}
          <Show when={feedView()}>
            {(view) => (
              <Text
                data-testid="nifty-fyers-feed"
                data-state={view().state}
                size="xs"
                fw={700}
                span
                title={view().title}
                class="whitespace-nowrap max-[640px]:whitespace-normal"
                style={{
                  color: view().color,
                  "font-size": `${CHART_HEADER_METRICS.metaSize}px`,
                  "font-weight": REPORT_FONT_WEIGHT.bold,
                  "letter-spacing": REPORT_LETTER_SPACING.normal,
                  "line-height": 1,
                }}
              >
                {view().label}
              </Text>
            )}
          </Show>
          <Show when={wallOverlay().markers.length > 0}>
            <Text
              data-testid="nifty-chart-event-badge"
              style={{
                "font-size": `${REPORT_FONT.micro}px`,
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
      class="[&>div:first-child]:gap-x-2 [&_[data-compact-card-content]]:flex-1 [&_[data-compact-card-content]]:min-h-0 [&_[data-compact-card-content]]:overflow-hidden max-[600px]:[&_[data-compact-card-content]]:p-0 max-[600px]:[&_[data-compact-card-content]]:gap-0 max-[640px]:[&>div:first-child]:flex-col max-[640px]:[&>div:first-child]:items-stretch max-[640px]:[&>div:first-child]:gap-y-2"
      style={{ "min-width": "0px", "min-height": "0px", height: "100%", overflow: "hidden", display: "flex", "flex-direction": "column" }}
      action={
        view() === "chart" ? (
          <Show
            when={isMobile()}
            fallback={
              // Primary row: source · timeframe · as-of · expand. Size and
              // pattern actions sit behind a disclosure so the header reads as
              // one decision, not a wall of equal-weight controls.
              <div class="flex flex-col items-end min-w-0" style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}>
                <div
                  data-testid="nifty-chart-controls-desktop"
                  class="flex flex-1 min-w-0 items-center justify-end overflow-x-auto"
                  style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}
                >
                  <div class="min-w-0 overflow-x-auto">{sourceToggle()}</div>
                  <span aria-hidden="true" class="shrink-0 h-[16px] w-px bg-fin-border" />
                  {primaryControls()}
                  <Button
                    data-testid="nifty-chart-controls-more-desktop"
                    size="xs"
                    variant="subtle"
                    aria-expanded={controlsOpen()}
                    aria-controls="nifty-chart-controls-extra-desktop"
                    className="shrink-0"
                    onClick={() => setControlsOpen((v) => !v)}
                    style={{ height: "22px", "min-height": "22px", padding: "0 6px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800 }}
                  >
                    {controlsOpen() ? "LESS ▴" : "MORE ▾"}
                  </Button>
                </div>
                <div
                  id="nifty-chart-controls-extra-desktop"
                  data-testid="nifty-chart-controls-extra-desktop"
                  class="flex flex-wrap items-center justify-end min-w-0"
                  style={{ gap: `${CHART_HEADER_METRICS.gap}px`, display: controlsOpen() ? "flex" : "none" }}
                >
                  {secondaryControls()}
                </div>
              </div>
            }
          >
            <div
              data-testid="nifty-chart-controls-mobile"
              className="flex flex-col items-stretch min-w-0"
              style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}
            >
              <div className="flex items-center justify-end min-w-0" style={{ gap: `${CHART_HEADER_METRICS.gap}px` }}>
                <div className="min-w-0 flex-1 overflow-x-auto">{sourceToggle()}</div>
                <Button
                  data-testid="nifty-chart-controls-more"
                  className="shrink-0"
                  size="xs"
                  variant="subtle"
                  aria-expanded={controlsOpen()}
                  aria-controls="nifty-chart-controls-extra"
                  onClick={() => setControlsOpen((v) => !v)}
                  style={{ height: "26px", "min-height": "26px", "min-width": "56px", padding: "0 6px", "font-size": `${REPORT_FONT.micro}px`, "font-weight": 800 }}
                >
                  {controlsOpen() ? "LESS ▴" : "MORE ▾"}
                </Button>
              </div>
              <Show when={controlsOpen()}>
                <div
                  id="nifty-chart-controls-extra"
                  data-testid="nifty-chart-controls-extra"
                  className="flex flex-wrap items-center justify-end min-w-0"
                  style={{ gap: `${CHART_HEADER_METRICS.gap}px`, "padding-top": `${CHART_HEADER_METRICS.gap}px` }}
                >
                  {primaryControls()}
                  {secondaryControls()}
                </div>
              </Show>
            </div>
          </Show>
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
        {/* The empty card is taller than a short mobile body. A flex-1 slot
            gives it the panel's height budget and scrolls internally instead
            of spilling over the pattern footer / side tabs; on a tall panel
            it centres in the freed chart area rather than leaving a black band. */}
        <Show when={offlineEmpty()}>
          <div
            data-testid="nifty-chart-offline-slot"
            class="flex flex-1 min-h-0 items-center justify-center overflow-auto"
          >
            <EmptyCompact
              data-testid="nifty-chart-offline-empty"
              title="No recorded data"
              description={`No recorded replay frames for ${sessionDate()}. Switch to LIVE for the streamed series.`}
            />
          </div>
        </Show>
        <Show when={!offlineEmpty() && chartCandles().length === 0}>
          <div
            data-testid="nifty-chart-empty-slot"
            class="flex flex-1 min-h-0 items-center justify-center overflow-auto"
          >
            <EmptyCompact
              data-testid="nifty-chart-empty"
              title="No intraday candles"
              description="Showing option-chain levels only."
            />
          </div>
        </Show>
        <Show when={chartCandles().length > 0 || candlesEverShown()}>
          <div
            data-testid="nifty-chart-wrap"
            data-fill={chartHeight() == null ? "1" : undefined}
            data-mobile-chart-min={MOBILE_CHART_TARGET}
            data-mp-touches={mpTouches().length}
            data-flip-marker={flipMarker().length > 0 ? "1" : "0"}
            data-pattern-source={patternSourceState()}
            data-pattern-overlays={patternOverlayCount()}
            data-cutoff-right={CHART_CUTOFF_RIGHT}
            data-cutoff-lane={CHART_PLOT_MARGIN.dataCutoffLane}
            data-axis-gutter={CHART_PLOT_MARGIN.edgeGutter}
            class="w-full max-w-full min-w-0 shrink-0 overflow-hidden flex-1 min-h-0"
            style={{
              position: "relative",
              "padding-right": `${CHART_PLOT_MARGIN.edgeGutter}px`,
              ["--chart-cutoff-right"]: `${CHART_CUTOFF_RIGHT}px`,
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
              onChartReady={applyChartPlotMargin}
            />
            <Show when={lastDataBoundary()}>
              {(boundary) => (
                <div
                  data-testid="nifty-chart-last-data-boundary"
                  class="pointer-events-none absolute"
                  title={boundary()}
                  style={{
                    top: "0px",
                    bottom: "0px",
                    left: "0px",
                    right: "var(--chart-cutoff-right)",
                    "border-right": `1px dashed ${palette.BORDER}`,
                  }}
                >
                  <span
                    class="absolute whitespace-nowrap"
                    style={{
                      top: "4px",
                      right: "4px",
                      "max-width": "100%",
                      padding: "1px 4px",
                      "font-family": palette.MONO,
                      "font-size": `${REPORT_FONT.micro}px`,
                      "font-weight": 700,
                      "line-height": REPORT_LINE_HEIGHT.snug,
                      "text-align": "right",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      color: palette.TEXT_MUTED,
                      background: palette.alpha(palette.SURFACE, 0.86),
                      "border-radius": `${REPORT_RADIUS.sm}px`,
                    }}
                  >
                    {boundary()}
                  </span>
                </div>
              )}
            </Show>
            <Show when={chartSource() === "patterns" && scanBadge()}>
              {(badge) => (
                <div
                  data-testid="nifty-patterns-chart-badge"
                  class="pointer-events-none absolute"
                  title={badge().title}
                  style={{
                    top: "4px",
                    left: "6px",
                    "max-width": "calc(100% - 12px)",
                    padding: "2px 5px",
                    "font-family": palette.MONO,
                    "font-size": `${REPORT_FONT.micro}px`,
                    "font-weight": 700,
                    "line-height": "13px",
                    "white-space": "nowrap",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    color: badge().color,
                    background: palette.alpha(palette.SURFACE, 0.86),
                    border: `1px solid ${palette.BORDER}`,
                    "border-radius": "4px",
                  }}
                >
                  {badge().text}
                </div>
              )}
            </Show>
          </div>
        </Show>
        <Show when={chartSource() === "patterns" && patternScan().status === "idle"}>
          <div
            data-testid="nifty-patterns-empty"
            class="flex items-center"
            style={{ gap: "6px", "min-height": "18px", "padding-top": "2px" }}
          >
            <Text size="xs" c="dimmed" span>Not scanned yet —</Text>
            <Button
              data-testid="nifty-patterns-run"
              size="xs"
              variant="subtle"
              onClick={() => scanPatterns(chartTf())}
              title={`Run the chart-pattern detector on ${symbol()} ${chartTf()}`}
              style={{ height: "18px", "min-height": "18px", padding: "0 6px", "font-weight": 800 }}
            >
              Run {chartTf()} scan
            </Button>
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
                : `No pattern found · up to ${PATTERN_LOOKBACK_BARS} × ${tf} bars · data through ${scan.dataThrough ?? "unknown"}`
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
                "font-size": `${REPORT_FONT.micro}px`,
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
                <span style={{ color: palette.TEXT, "font-weight": 700 }}>
                  no pattern · up to {PATTERN_LOOKBACK_BARS} × {tf} bars
                </span>
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
        {/*
          * Fill the panel when it is tall, but scroll when it is short: the
          * depth map keeps its own min-height, so a desk-height chart row must
          * scroll rather than clip the map (the panel body hides overflow).
          */}
        <div
          data-testid="nifty-depth-view"
          class="flex flex-1 min-h-0 h-full overflow-auto"
          style={{ display: view() === "depth" ? "flex" : "none" }}
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
