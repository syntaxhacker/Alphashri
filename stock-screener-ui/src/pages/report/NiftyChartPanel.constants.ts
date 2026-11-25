import { createEffect, onCleanup, type JSX } from "solid-js";
import type { IChartApi } from "lightweight-charts";
import type { FyersTick } from "@/hooks/useFyersTickStream";
import type { ReplayCandle } from "@/types/replay";
import type { NiftyReport, NiftyReportMode, NiftyTape } from "@/types/niftyReport";
import type { WallBurstLike } from "./niftyWallEventOverlay";
import { REPORT_FONT, REPORT_FONT_BODY_VAR, REPORT_PAD } from "./reportTokens";
import type { SpotPoint } from "./niftyChartData";

export const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
export type ChartSize = keyof typeof CHART_HEIGHTS | "fill";
/** DESK fill cap: the chart body stops at 300px (min 260px on short screens). */
export const FILL_MAX_HEIGHT = 300;
export const FILL_MIN_HEIGHT = 260;
/** Panel chrome above the chart body (22px header + card padding/border). A
 *  DESK row sizes itself to `chart body + CHART_ROW_CHROME` so the card never
 *  leaves a black void under a capped fill chart. */
export const CHART_ROW_CHROME = 48;
/** Mobile (390px) chart-body target. Reached by collapsing the SESSION/WINDOWS
 *  flow band so the flex-1 main row grows; asserted by the layout contract test. */
export const MOBILE_CHART_TARGET = 240;
export const FILL_LABEL_HEIGHT = 480;

export type ChartTimeframe = "1m" | "5m" | "15m";
export const CHART_TF_MINUTES: Record<ChartTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
};

export const CHART_TF_OPTIONS: { value: string; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
];

export const CHART_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

export const CHART_SOURCE_OPTIONS: { value: string; label: string }[] = [
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
export const CHART_CONTROL_LABEL_STYLE = {
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

export function applyChartPlotMargin(chart: IChartApi): void {
  chart.timeScale().applyOptions({ rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane });
  chart.priceScale("right").applyOptions({
    minimumWidth: CHART_PLOT_MARGIN.axisMinWidth,
    entireTextOnly: true,
  });
}

/**
 * A `HH:MM` tick is five 12px-mono glyphs (~36px), and the engine centres the
 * first and last ticks on their bars. `entireTextOnly` widens the *price* axis
 * only, so without a real plot gutter the edge ticks render as `:15` / `10:0`.
 * One half-label plus a glyph of slack on each side keeps both intact at 390
 * and 1600, including the labelled data-cutoff lane after the last candle.
 */
export const TIME_AXIS_LABEL_GUTTER_PX = 24;

type TimeScale = ReturnType<IChartApi["timeScale"]>;

/** Pixel spacing from the engine's own coordinate mapping, with a safe floor
 *  for the first pin (the engine may not have a mapped series yet). */
function barSpacingPx(scale: TimeScale): number {
  const logical = (value: number) => value as Parameters<TimeScale["logicalToCoordinate"]>[0];
  const first = scale.logicalToCoordinate?.(logical(0));
  const next = scale.logicalToCoordinate?.(logical(1));
  if (first != null && next != null && Number.isFinite(first) && Number.isFinite(next)) {
    const spacing = Math.abs(next - first);
    if (spacing >= 0.5) return spacing;
  }
  return 8;
}

/**
 * Pin the visible range to the real candles while keeping a `HH:MM`-sized
 * gutter on both edges. The left gutter is a fractional logical offset (the
 * engine has no `leftOffsetPixels`), the right one extends the pixel offset
 * past the cutoff lane so the boundary line still marks the last candle.
 */
export function useGutteredChartRange(
  getChart: () => IChartApi | null,
  getCount: () => number,
  getRightOffset: () => number,
  getVersion: () => void,
  getLeftGutter: () => number,
): void {
  createEffect(() => {
    // Tracks chart creation and every axis-mode change: re-applying the base
    // overlay geometry on a viewport switch would otherwise reset the offset.
    getVersion();
    const chart = getChart();
    const count = getCount();
    if (!chart || count === 0) return;

    const pin = () => {
      if (getChart() !== chart) return;
      const scale = chart.timeScale();
      scale.applyOptions({
        rightOffset: 0,
        rightOffsetPixels: getRightOffset() + getLeftGutter(),
      });
      if (typeof scale.setVisibleLogicalRange === "function") {
        scale.setVisibleLogicalRange({
          from: -getLeftGutter() / barSpacingPx(scale),
          to: count - 1,
        });
      }
    };

    queueMicrotask(pin);
    const timer = setTimeout(pin, 0);
    const late = setTimeout(pin, 120);
    onCleanup(() => {
      clearTimeout(timer);
      clearTimeout(late);
    });
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

export function isFyersUnderlying(symbol: string): boolean {
  const key = symbol.trim().toUpperCase();
  return FYERS_UNDERLYINGS.has(key) || key.includes(":");
}

export interface CandleFeed {
  report: Pick<NiftyReport, "intraday" | "candles">;
  tape: Pick<NiftyTape, "rows"> | null;
  spot: readonly SpotPoint[] | null;
}

export interface NiftyChartPanelProps {
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

export function overlayFyersTick(bars: ReplayCandle[], tick: FyersTick | null): ReplayCandle[] {
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
