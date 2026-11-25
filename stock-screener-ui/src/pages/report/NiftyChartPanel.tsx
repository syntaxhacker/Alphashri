import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { formatTimeOnly } from "@/utils/ui-helpers";
import { useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import { useFyersTickStream, type FyersTick } from "@/hooks/useFyersTickStream";
import { LocalCompactPanel } from "./reportBits";
import { readChartSource, persistChartSource, type ChartSource } from "./niftyReportStore";
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
} from "./niftyChartData";
import {
  buildMarkLines,
  emaSeries,
  labelGapPctFor,
  mergeCollidingLabels,
  resampleCandles,
} from "./niftyChartMath";
import { verdictMarkLines } from "./niftyVerdictLevels";
import {
  computeFeedView,
  computeFlipMarker,
  computeLastDataState,
  computeMaxPainTouches,
  computeWallOverlay,
  newestFeedBarMs,
} from "./NiftyChartPanel.annotations";
import { createChartPatterns } from "./NiftyChartPanel.patterns";
import { ChartControls, ChartTitle } from "./NiftyChartPanel.controls";
import { ChartBody, DepthView, PatternStrip } from "./NiftyChartPanel.body";
import {
  CHART_HEIGHTS,
  CHART_TF_MINUTES,
  FILL_LABEL_HEIGHT,
  isFyersUnderlying,
  overlayFyersTick,
  type CandleFeed,
  type ChartSize,
  type ChartTimeframe,
  type NiftyChartPanelProps,
} from "./NiftyChartPanel.constants";

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
export {
  CHART_CUTOFF_RIGHT,
  CHART_HEADER_METRICS,
  CHART_HEIGHTS,
  CHART_PLOT_MARGIN,
  CHART_ROW_CHROME,
  CHART_TF_MINUTES,
  FILL_MAX_HEIGHT,
  MOBILE_CHART_TARGET,
  type ChartSize,
  type ChartTimeframe,
} from "./NiftyChartPanel.constants";
export { LevelLegend } from "./NiftyChartPanel.annotations";

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
  const [frozenFeed, setFrozenFeed] = createSignal<CandleFeed | null>(null);
  const currentFeed = (): CandleFeed => ({
    report: report(),
    tape: tape(),
    spot: spotPoints(),
  });
  const candleFeed = (): CandleFeed => frozenFeed() ?? currentFeed();
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
    if (!frozen || newestFeedBarMs(feed) > newestFeedBarMs(frozen)) setFrozenFeed(feed);
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

  const feedView = () =>
    computeFeedView(
      fyersEnabled(),
      fyers.isLive(),
      fyers.isReconnecting(),
      fyers.isMarketClosed(),
      fyers.isDisconnected(),
    );

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
  const lastDataState = createMemo(() => computeLastDataState(asOf(), report()));
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

  const patterns = createChartPatterns({ chartSource, chartTf, chartCandles, emaData });

  const wallOverlay = createMemo(() => computeWallOverlay(bursts(), asOf()));
  const verdictLines = createMemo(() =>
    verdictMarkLines(report(), labelGapPctFor(report(), chartHeight() ?? FILL_LABEL_HEIGHT)),
  );
  const chartMarkLines = createMemo(() => {
    const lines = [
      ...markLines(),
      ...(patterns.patternOverlay()?.markLines ?? []),
      ...wallOverlay().markLines,
      ...verdictLines(),
    ];
    // Neutral reports add nothing, so their existing geometry stays byte-for-byte
    // identical. A directional verdict runs the shared collision pass so its
    // gutter labels never stack on a wall/pivot label at compact heights.
    return verdictLines().length > 0
      ? mergeCollidingLabels(lines, report().spot, labelGapPctFor(report(), chartHeight() ?? FILL_LABEL_HEIGHT))
      : lines;
  });
  const mpTouches = createMemo(() => computeMaxPainTouches(chartCandles(), report()));
  const flipMarker = createMemo(() => computeFlipMarker(flipAt(), chartCandles()));
  const touchMarkers = createMemo(() => [
    ...mpTouches().map((t) => ({ time: t.point.time, value: t.value })),
    ...wallOverlay().markers,
    ...flipMarker(),
    ...(patterns.scanAnnotation() ? [patterns.scanAnnotation()!.marker] : []),
  ]);

  return (
    <LocalCompactPanel
      title={
        <ChartTitle
          view={view()}
          symbol={symbol()}
          feedView={feedView()}
          eventCount={wallOverlay().markers.length}
        />
      }
      testId="nifty-chart-panel"
      class="[&>div:first-child]:gap-x-2 [&_[data-compact-card-content]]:flex-1 [&_[data-compact-card-content]]:min-h-0 [&_[data-compact-card-content]]:overflow-hidden max-[600px]:[&_[data-compact-card-content]]:p-0 max-[600px]:[&_[data-compact-card-content]]:gap-0 max-[640px]:[&>div:first-child]:flex-col max-[640px]:[&>div:first-child]:items-stretch max-[640px]:[&>div:first-child]:gap-y-2"
      style={{ "min-width": "0px", "min-height": "0px", height: "100%", overflow: "hidden", display: "flex", "flex-direction": "column" }}
      action={
        view() === "chart" ? (
          <ChartControls
            isMobile={isMobile()}
            chartSource={chartSource()}
            chartTf={chartTf()}
            chartSize={chartSize()}
            controlsOpen={controlsOpen()}
            onToggleControls={() => setControlsOpen((v) => !v)}
            onSourceChange={handleSourceChange}
            onTfChange={handleTfChange}
            onSizeChange={handleSizeChange}
            scanLoading={patterns.patternScan().status === "loading"}
            onScanPatterns={() => patterns.scanPatterns(chartTf())}
            asOfLabel={lastDataLabel()}
            asOfBoundary={lastDataBoundary()}
            onExpand={props.onExpand}
            symbol={symbol()}
          />
        ) : undefined
      }
    >
      {/*
        * Both views stay mounted after first use; the inactive wrapper is
        * `display: none` (zero layout space) so switching never remounts
        * either chart engine. The depth subtree mounts lazily on first
        * selection via `depthEverShown` above.
        */}
      <ChartBody
        view={view()}
        offlineEmpty={offlineEmpty()}
        sessionDate={sessionDate()}
        chartCandles={chartCandles()}
        candlesEverShown={candlesEverShown()}
        chartHeight={chartHeight()}
        fillContainer={fillContainer()}
        mpTouchesLength={mpTouches().length}
        flipMarkerPresent={flipMarker().length > 0}
        patternSourceState={patterns.patternSourceState()}
        patternOverlayCount={patterns.patternOverlayCount()}
        chartMarkLines={chartMarkLines()}
        chartEmaData={patterns.chartEmaData()}
        touchMarkers={touchMarkers()}
        lastDataBoundary={lastDataBoundary()}
        scanBadge={patterns.scanBadge()}
        chartSource={chartSource()}
        scanStatus={patterns.patternScan().status}
        chartTf={chartTf()}
        symbol={symbol}
        onScanPatterns={() => patterns.scanPatterns(chartTf())}
      />
      <PatternStrip
        active={patterns.patternScan().status !== "idle" && view() === "chart"}
        scan={patterns.patternScan()}
        symbol={symbol}
        chartTf={chartTf()}
        drawPattern={patterns.drawPattern()}
        onToggleDraw={() => patterns.setDrawPattern((v) => !v)}
      />
      <DepthView shown={depthEverShown()} view={view()} report={report()} />
      {/* The level legend lives on the chart gutter now (dense layout):
          rendering it here cost a full row above the fold. `LevelLegend`
          stays exported for callers/tests that need the decoded key. */}
    </LocalCompactPanel>
  );
}
