import { Show, createEffect, createSignal, onCleanup, onMount, type ComponentProps } from "solid-js";
import type { IChartApi } from "lightweight-charts";
import { Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { formatTimeOnly } from "@/utils/ui-helpers";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { EmptyCompact } from "@/components/common/states";
import { spotSnapshot } from "./ReportKpiHero";
import { NiftyDepthMap } from "./NiftyDepthMap";
import { REPORT_FONT, REPORT_LINE_HEIGHT, REPORT_RADIUS } from "./reportTokens";
import { PATTERN_LOOKBACK_BARS, type PatternScanState } from "./useNiftyPatternScan";
import type { NiftyReport } from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import type { ChartSource } from "./niftyReportStore";
import {
  applyChartPlotMargin,
  CHART_CUTOFF_RIGHT,
  CHART_PLOT_MARGIN,
  FILL_MAX_HEIGHT,
  FILL_MIN_HEIGHT,
  MOBILE_CHART_TARGET,
  type ChartTimeframe,
} from "./NiftyChartPanel.constants";
import { computePatternStripTitle, type ScanBadge } from "./NiftyChartPanel.annotations";
import { phoneViewport, usePinnedChartRange } from "./NiftyChartPanel.range";
import { NARROW_CONTAINER_PX, useNarrowContainer } from "./NiftyChartPanel.controls";
import {
  applyOverlayAxisGeometry,
  ChartOverlayLegend,
  plottableCandleCount,
} from "./NiftyChartPanel.overlayLegend";
export { NARROW_CONTAINER_PX };

type ChartProps = ComponentProps<typeof TradingViewChart>;

/** With the volume tag hidden, one full "22,364.00" tag (85px by the 12px-mono
 *  model) fits a 92px lane. 92 axis + 8 gutter + 16 cutoff = 116px, leaving
 *  274px (~70%) of a 390px card for candles. Desktop 88+8+24 is untouched. */
export const MOBILE_AXIS_MIN_WIDTH = 92;
export const MOBILE_EDGE_GUTTER = 8;
export const MOBILE_CUTOFF_LANE = 16;
/** Keeps the cutoff pill clear of the line and the axis tags beyond it. */
export const MOBILE_CUTOFF_LABEL_GAP = 6;
export const MOBILE_CUTOFF_RIGHT =
  MOBILE_EDGE_GUTTER + MOBILE_AXIS_MIN_WIDTH + MOBILE_CUTOFF_LANE;

/** Compact reservation for a window narrower than the 390px monitor case. */
export const NARROW_AXIS_MIN_WIDTH = 56;
export const NARROW_EDGE_GUTTER = 4;
export const NARROW_CUTOFF_LANE = 10;
export const NARROW_CUTOFF_RIGHT = NARROW_EDGE_GUTTER + NARROW_AXIS_MIN_WIDTH + NARROW_CUTOFF_LANE;

interface ChartBodyProps {
  view: "chart" | "depth";
  offlineEmpty: boolean;
  sessionDate: string;
  chartCandles: ReplayCandle[];
  candlesEverShown: boolean;
  chartHeight: number | null;
  fillContainer: boolean;
  mpTouchesLength: number;
  flipMarkerPresent: boolean;
  patternSourceState: string;
  patternOverlayCount: number;
  chartMarkLines: NonNullable<ChartProps["markLines"]>;
  chartEmaData: NonNullable<ChartProps["emaData"]>;
  touchMarkers: NonNullable<ChartProps["touchMarkers"]>;
  lastDataBoundary: string;
  scanBadge: ScanBadge | null;
  chartSource: ChartSource;
  scanStatus: PatternScanState["status"];
  chartTf: ChartTimeframe;
  symbol: () => string;
  onScanPatterns: () => void;
}

/** Chart + depth view wrappers. Both stay mounted after first use; the
 *  inactive wrapper is `display: none` so switching never remounts an engine. */
export function ChartBody(props: ChartBodyProps) {
  const [phone, setPhone] = createSignal(phoneViewport());
  let bodyRef: HTMLDivElement | undefined;
  const narrowContainer = useNarrowContainer(() => bodyRef?.parentElement ?? bodyRef);
  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 600px)");
    setPhone(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches);
    mq.addEventListener("change", onChange);
    onCleanup(() => mq.removeEventListener("change", onChange));
  });

  const axisGeometry = () =>
    narrowContainer()
      ? { axis: NARROW_AXIS_MIN_WIDTH, lane: NARROW_CUTOFF_LANE, gutter: NARROW_EDGE_GUTTER, shift: true }
      : phone()
        ? { axis: MOBILE_AXIS_MIN_WIDTH, lane: MOBILE_CUTOFF_LANE, gutter: MOBILE_EDGE_GUTTER, shift: true }
        : { axis: CHART_PLOT_MARGIN.axisMinWidth, lane: CHART_PLOT_MARGIN.dataCutoffLane, gutter: CHART_PLOT_MARGIN.edgeGutter, shift: false };
  const hasPinnedCandles = () => plottableCandleCount(props.chartCandles) > 0;
  // One accessor feeds both the engine and the key. A legend that named a
  // different series than the one drawn would be worse than no legend.
  const overlaySeries = () => (hasPinnedCandles() ? props.chartEmaData : []);
  const chartSpotTime = () => props.chartCandles[props.chartCandles.length - 1]?.time;
  const chartSpotView = () =>
    spotSnapshot(props.chartCandles[props.chartCandles.length - 1]?.close, {
      digits: 2,
      asOf: chartSpotTime() ? formatTimeOnly(chartSpotTime()!) : null,
      origin: props.lastDataBoundary.includes("replay") ? "Replay playhead" : "Chart last bar",
    });
  const emptyReason = () =>
    props.lastDataBoundary
      ? `${props.lastDataBoundary} — no candles at this playhead. Showing option-chain levels only.`
      : "Showing option-chain levels only.";
  const cutoffRight = () => axisGeometry().gutter + axisGeometry().axis + axisGeometry().lane;
  const edgePadding = () => {
    const base = { "padding-right": phone() ? `${MOBILE_EDGE_GUTTER}px` : `${CHART_PLOT_MARGIN.edgeGutter}px` };
    return narrowContainer() ? { "padding-right": `${NARROW_EDGE_GUTTER}px` } : base;
  };

  let chartRef: IChartApi | null = null;
  const [chartVersion, setChartVersion] = createSignal(0);

  const applyAxisGeometry = () => {
    const chart = chartRef;
    if (chart) applyOverlayAxisGeometry(chart, axisGeometry());
  };
  const chartReady = (chart: IChartApi) => {
    chartRef = chart;
    applyChartPlotMargin(chart);
    applyAxisGeometry();
    setChartVersion((v) => v + 1);
  };

  usePinnedChartRange(() => chartRef, () => props.chartCandles.length, cutoffRight, chartVersion);

  // TradingViewChart re-enables the volume tag whenever the candle series
  // changes. Re-apply after the current flush so a compact axis stays clear.
  createEffect(() => {
    void props.chartCandles;
    phone();
    narrowContainer();
    chartVersion();
    queueMicrotask(applyAxisGeometry);
  });

  return (
    <div
      ref={(element) => (bodyRef = element)}
      data-testid="nifty-chart-view"
      class="flex flex-col"
      style={{ display: props.view === "chart" ? "flex" : "none", flex: props.view === "chart" ? "1" : undefined, "min-height": "0px" }}
    >
      {/* A flex-1 slot gives the empty card the panel's height budget and
          scrolls it instead of spilling over the pattern footer / side tabs. */}
      <Show when={props.offlineEmpty}>
        <div
          data-testid="nifty-chart-offline-slot"
          class="flex flex-1 min-h-0 items-center justify-center overflow-auto"
        >
          <EmptyCompact
            data-testid="nifty-chart-offline-empty"
            title="No recorded data"
            description={`No recorded replay frames for ${props.sessionDate}. Switch to LIVE for the streamed series.`}
          />
        </div>
      </Show>
      <Show when={!props.offlineEmpty && !hasPinnedCandles()}>
        <div
          data-testid="nifty-chart-empty-slot"
          data-reason="pinned-playhead-no-candles"
          class="flex flex-1 min-h-0 items-center justify-center overflow-auto"
        >
          <EmptyCompact
            data-testid="nifty-chart-empty"
            title="No intraday candles"
            description={emptyReason()}
          />
        </div>
      </Show>
      <Show when={hasPinnedCandles() || props.candlesEverShown}>
        <div
          data-testid="nifty-chart-wrap"
          data-pinned-candles={props.chartCandles.length}
          data-axis-mode={narrowContainer() ? "narrow" : phone() ? "mobile" : "desktop"}
          data-effective-axis-gutter={axisGeometry().axis} data-effective-cutoff-lane={axisGeometry().lane}
          data-fill={props.chartHeight == null ? "1" : undefined} data-mobile-chart-min={MOBILE_CHART_TARGET}
          data-mp-touches={props.mpTouchesLength} data-flip-marker={props.flipMarkerPresent ? "1" : "0"}
          data-pattern-source={props.patternSourceState} data-pattern-overlays={props.patternOverlayCount}
          data-cutoff-right={CHART_CUTOFF_RIGHT} data-cutoff-lane={CHART_PLOT_MARGIN.dataCutoffLane}
          data-axis-gutter={CHART_PLOT_MARGIN.edgeGutter} data-mobile-axis-gutter={MOBILE_AXIS_MIN_WIDTH}
          data-mobile-cutoff-lane={MOBILE_CUTOFF_LANE} data-mobile-left-gutter={phone() ? "6" : "0"}
          data-hide-last-value-tag={phone() ? "1" : "0"}
          class="w-full max-w-full min-w-0 shrink-0 overflow-hidden flex-1 min-h-0"
          style={{
            position: "relative",
            "padding-left": phone() ? "6px" : undefined,
            ...edgePadding(),
            ["--chart-cutoff-right"]: `${cutoffRight()}px`,
            ...(props.chartHeight == null ? undefined : { height: `${props.chartHeight}px` }),
            display: hasPinnedCandles() ? "flex" : "none",
            flex: props.chartHeight == null ? "1" : undefined,
            "min-width": "0px",
            "min-height": "0px",
            "flex-shrink": 0,
            ...(props.chartHeight == null && !props.fillContainer ? { "max-height": `${FILL_MAX_HEIGHT}px`, "min-height": `${FILL_MIN_HEIGHT}px` } : {}),
          }}
        >
          <TradingViewChart
            candles={props.chartCandles}
            markLines={hasPinnedCandles() ? props.chartMarkLines : []}
            emaData={overlaySeries()}
            touchMarkers={hasPinnedCandles() ? props.touchMarkers : []}
            {...(props.chartHeight != null ? { height: props.chartHeight! } : {})}
            fitMarkLines
            hideLastValueTag={phone()}
            rightOffsetBars={0}
            onChartReady={chartReady}
          />
          <ChartOverlayLegend lines={overlaySeries()} compact={narrowContainer() || phone()} />
          <Show when={hasPinnedCandles() && props.lastDataBoundary}>
            {(boundary) => (
              <div
                data-testid="nifty-chart-last-data-boundary"
                class="pointer-events-none absolute"
                title={`${chartSpotView().title} · ${boundary()}`}
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
                    right: phone() ? `${MOBILE_CUTOFF_LABEL_GAP}px` : "4px",
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
          <Show when={hasPinnedCandles() && props.chartSource === "patterns" && props.scanBadge}>
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
      <Show when={props.chartSource === "patterns" && props.scanStatus === "idle"}>
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
            onClick={props.onScanPatterns}
            title={`Run the chart-pattern detector on ${props.symbol()} ${props.chartTf}`}
            style={{ height: "18px", "min-height": "18px", padding: "0 6px", "font-weight": 800 }}
          >
            Run {props.chartTf} scan
          </Button>
        </div>
      </Show>
    </div>
  );
}

interface PatternStripProps {
  active: boolean;
  scan: PatternScanState;
  symbol: () => string;
  chartTf: ChartTimeframe;
  drawPattern: boolean;
  onToggleDraw: () => void;
}

export function PatternStrip(props: PatternStripProps) {
  return (
    <Show when={props.active}>
      {(() => {
        const scan = props.scan;
        if (scan.status === "idle") return null;
        const tf = scan.tf;
        const stripTitle = computePatternStripTitle(scan, props.symbol);
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
              data-on={props.drawPattern ? "1" : "0"}
              role="button"
              aria-pressed={props.drawPattern}
              tabIndex={0}
              onClick={props.onToggleDraw}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                props.onToggleDraw();
              }}
              title={
                tf === props.chartTf
                  ? `${props.drawPattern ? "Hide" : "Show"} the pattern on the chart`
                  : `Pattern was scanned on ${tf}; rescan on ${props.chartTf} to draw it here`
              }
              style={{
                "margin-left": "auto",
                cursor: "pointer",
                "font-weight": 800,
                "letter-spacing": "0.06em",
                color: props.drawPattern ? palette.PRIMARY : palette.TEXT_MUTED,
                opacity: tf === props.chartTf ? 1 : 0.5,
              }}
            >
              {props.drawPattern ? "DRAW ON" : "DRAW OFF"}
            </span>
          </div>
        );
      })()}
    </Show>
  );
}

interface DepthViewProps {
  shown: boolean;
  view: "chart" | "depth";
  report: NiftyReport;
}

export function DepthView(props: DepthViewProps) {
  return (
    <Show when={props.shown}>
      {/* Fill the panel when it is tall, but scroll when it is short: the
          depth map keeps its own min-height, so a desk-height chart row must
          scroll rather than clip the map (the panel body hides overflow). */}
      <div
        data-testid="nifty-depth-view"
        class="flex flex-1 min-h-0 h-full overflow-auto"
        style={{ display: props.view === "depth" ? "flex" : "none" }}
      >
        <NiftyDepthMap report={props.report} active={props.view === "depth"} />
      </div>
    </Show>
  );
}
