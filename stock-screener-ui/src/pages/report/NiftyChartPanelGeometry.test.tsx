// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  CHART_CUTOFF_RIGHT,
  CHART_HEADER_METRICS,
  CHART_PLOT_MARGIN,
} from "./NiftyChartPanel";
import {
  ChartBody,
  MOBILE_AXIS_MIN_WIDTH,
  MOBILE_CUTOFF_LABEL_GAP,
  MOBILE_CUTOFF_LANE,
  MOBILE_CUTOFF_RIGHT,
  MOBILE_EDGE_GUTTER,
  NARROW_AXIS_MIN_WIDTH,
  NARROW_CONTAINER_PX,
  NARROW_CUTOFF_LANE,
  NARROW_CUTOFF_RIGHT,
  NARROW_EDGE_GUTTER,
} from "./NiftyChartPanel.body";
import { REPORT_FONT, REPORT_PAD } from "./reportTokens";

const env = vi.hoisted(() => ({
  mobile: false,
  mediaListeners: [] as Array<(event: { matches: boolean }) => void>,
  resizeCallbacks: [] as Array<(entries: Array<{ target: Element; contentRect: { width: number } }>) => void>,
}));
const tv = vi.hoisted(() => ({
  onChartReady: null as null | ((chart: unknown, series: unknown) => void),
}));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: (props: {
    fitMarkLines?: boolean;
    onChartReady?: (chart: unknown, series: unknown) => void;
    markLines?: unknown[];
    candles?: unknown[];
  }) => {
    tv.onChartReady = props.onChartReady ?? null;
    return (
      <div
        data-testid="tradingview-chart"
        data-fit-marklines={props.fitMarkLines ? "1" : "0"}
        data-candles={props.candles?.length ?? 0}
        data-marklines={props.markLines?.length ?? 0}
      />
    );
  },
}));
vi.mock("@/hooks/useFyersTickStream", () => ({
  useFyersTickStream: () => ({
    isLive: () => false,
    isReconnecting: () => false,
    isMarketClosed: () => false,
    isDisconnected: () => false,
    lastTick: () => null,
  }),
}));
vi.mock("./useNiftyPatternScan", () => ({
  PATTERN_LOOKBACK_BARS: 40,
  useNiftyPatternScan: () => ({
    state: () => ({ status: "idle", hits: [], tf: "1m", dataThrough: null, message: "" }),
    scan: () => {},
  }),
}));

const { NiftyChartPanel: Panel } = await import("./NiftyChartPanel");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width: 600px") ? env.mobile : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
        env.mediaListeners.push(fn);
      },
      removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
        env.mediaListeners = env.mediaListeners.filter((f) => f !== fn);
      },
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: class {
      constructor(
        callback: (entries: Array<{ target: Element; contentRect: { width: number } }>) => void,
      ) {
        env.resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  cleanup();
  env.mobile = false;
  env.mediaListeners = [];
  env.resizeCallbacks = [];
  tv.onChartReady = null;
  window.localStorage.clear();
});

/** Drive the container observers the same way a real ResizeObserver would. */
function setContainerWidth(width: number) {
  for (const callback of env.resizeCallbacks) {
    callback([{ target: document.body, contentRect: { width } }]);
  }
}

const report = {
  mode: "live",
  date: "2026-10-12",
  expiry: "weekly",
  spot: 22_364,
  ohlc: { open: 22_300, high: 22_400, low: 22_290, close: 22_364 },
  pcrOi: 1.1,
  pcrVol: 0.9,
  maxPain: 22_400,
  strikes: [],
  walls: null,
  gex: null,
  market: { is_open: false, session_date: "2026-10-12", as_of: "2026-10-12T10:00:00" },
  candles: [
    { time: "2026-10-12T09:15:00", open: 22_300, high: 22_320, low: 22_290, close: 22_310 },
    { time: "2026-10-12T09:16:00", open: 22_310, high: 22_340, low: 22_300, close: 22_330 },
    { time: "2026-10-12T10:00:00", open: 22_350, high: 22_400, low: 22_340, close: 22_364 },
  ],
} as any;

function mount() {
  return render(() => (
    <UIProvider>
      <Panel report={report} mode="live" view="chart" onExpand={() => {}} />
    </UIProvider>
  ));
}

function fakeChart() {
  const calls: { scale: string; id?: string; options: Record<string, unknown> }[] = [];
  return {
    calls,
    chart: {
      timeScale: () => ({
        applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "time", options }),
      }),
      priceScale: (id: string) => ({
        applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "price", id, options }),
      }),
    },
  };
}

describe("NiftyChartPanel — plot domain and annotation margins", () => {
  test("the time domain ends at the last bar plus a narrow, labelled cutoff lane", () => {
    expect(CHART_PLOT_MARGIN.dataCutoffLane).toBeGreaterThanOrEqual(8);
    // No unmarked grid beyond the real candles: the lane is a deliberate
    // annotation gutter, not a third of the plot at 390px.
    expect(CHART_PLOT_MARGIN.dataCutoffLane).toBeLessThanOrEqual(32);
    expect(CHART_PLOT_MARGIN.axisMinWidth).toBeGreaterThanOrEqual(80);
    expect(CHART_PLOT_MARGIN.edgeGutter).toBe(REPORT_PAD.md);
    expect(CHART_CUTOFF_RIGHT).toBe(
      CHART_PLOT_MARGIN.edgeGutter +
        CHART_PLOT_MARGIN.axisMinWidth +
        CHART_PLOT_MARGIN.dataCutoffLane,
    );
  });

  test("the engine gets a pixel right offset and a fixed axis gutter", () => {
    mount();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-fit-marklines", "1");
    expect(tv.onChartReady).toBeTypeOf("function");

    const { chart, calls } = fakeChart();
    tv.onChartReady!(chart, null);

    const time = calls.find((c) => c.scale === "time");
    expect(time?.options).toMatchObject({ rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane });
    const axis = calls.find((c) => c.scale === "price" && c.id === "right");
    expect(axis?.options).toMatchObject({
      minimumWidth: CHART_PLOT_MARGIN.axisMinWidth,
      entireTextOnly: true,
    });
  });

  test("the wrapper reserves the edge gutter and exposes the cutoff geometry", () => {
    mount();
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveStyle({ "padding-right": `${CHART_PLOT_MARGIN.edgeGutter}px` });
    expect(wrap).toHaveAttribute("data-cutoff-right", String(CHART_CUTOFF_RIGHT));
    expect(wrap).toHaveAttribute("data-cutoff-lane", String(CHART_PLOT_MARGIN.dataCutoffLane));
    expect(wrap).toHaveAttribute("data-axis-gutter", String(CHART_PLOT_MARGIN.edgeGutter));
    expect(wrap.className).toContain("flex-1");
    expect(wrap.className).toContain("min-h-0");
  });

  test("the cutoff boundary names the last populated minute and market state", () => {
    mount();
    const boundary = screen.getByTestId("nifty-chart-last-data-boundary");
    expect(boundary).toHaveTextContent("LAST DATA 10:00 · market closed");
    expect(boundary).toHaveStyle({ right: `${CHART_CUTOFF_RIGHT}px` });
  });

  test("the phone reserves 116px total, so a 390px card gives the plot ~70%", () => {
    // Exact budget: 92px axis (fits the whole 85px "22,364.00" tag) + 8px
    // gutter + 16px cutoff lane. The old 144+12+24 reservation left ~54%.
    expect(MOBILE_AXIS_MIN_WIDTH).toBe(92);
    expect(MOBILE_EDGE_GUTTER).toBe(8);
    expect(MOBILE_CUTOFF_LANE).toBe(16);
    expect(MOBILE_CUTOFF_RIGHT).toBe(116);
    expect(MOBILE_CUTOFF_RIGHT).toBe(
      MOBILE_EDGE_GUTTER + MOBILE_AXIS_MIN_WIDTH + MOBILE_CUTOFF_LANE,
    );
    expect(MOBILE_CUTOFF_RIGHT).toBeGreaterThanOrEqual(112);
    expect(MOBILE_CUTOFF_RIGHT).toBeLessThanOrEqual(120);
    expect(390 - MOBILE_CUTOFF_RIGHT).toBe(274);
    expect((390 - MOBILE_CUTOFF_RIGHT) / 390).toBeGreaterThanOrEqual(0.7);
    // Desktop is untouched; only the phone gutter/lane shrink.
    expect(CHART_PLOT_MARGIN.axisMinWidth).toBe(88);
    expect(CHART_PLOT_MARGIN.edgeGutter).toBe(REPORT_PAD.md);
    expect(CHART_PLOT_MARGIN.edgeGutter).toBe(8);
    expect(CHART_PLOT_MARGIN.dataCutoffLane).toBe(24);
    expect(CHART_CUTOFF_RIGHT).toBe(120);

    env.mobile = true;
    mount();
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveStyle({ "padding-right": `${MOBILE_EDGE_GUTTER}px` });
    expect(wrap.style.getPropertyValue("--chart-cutoff-right")).toBe(`${MOBILE_CUTOFF_RIGHT}px`);
    expect(wrap).toHaveAttribute("data-mobile-axis-gutter", String(MOBILE_AXIS_MIN_WIDTH));
    expect(wrap).toHaveAttribute("data-mobile-cutoff-lane", String(MOBILE_CUTOFF_LANE));
    expect(screen.getByTestId("nifty-chart-last-data-boundary")).toHaveStyle({
      right: `${MOBILE_CUTOFF_RIGHT}px`,
    });

    const { chart, calls } = fakeChart();
    tv.onChartReady!(chart, null);
    const rightAxis = calls.filter((c) => c.scale === "price" && c.id === "right").at(-1);
    expect(rightAxis?.options).toMatchObject({
      minimumWidth: MOBILE_AXIS_MIN_WIDTH,
      entireTextOnly: true,
    });
    // The engine's blank lane is the same 16px the CSS cutoff boundary uses.
    const time = calls.filter((c) => c.scale === "time").at(-1);
    expect(time?.options).toMatchObject({ rightOffsetPixels: MOBILE_CUTOFF_LANE });
  });

  test("a narrow CONTAINER shrinks the axis reservation without touching the 390px contract", async () => {
    expect(NARROW_CONTAINER_PX).toBe(320);
    expect(NARROW_CUTOFF_RIGHT).toBe(
      NARROW_EDGE_GUTTER + NARROW_AXIS_MIN_WIDTH + NARROW_CUTOFF_LANE,
    );
    expect(NARROW_CUTOFF_RIGHT).toBeLessThan(MOBILE_CUTOFF_RIGHT);

    env.mobile = true;
    mount();
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap.style.getPropertyValue("--chart-cutoff-right")).toBe(`${MOBILE_CUTOFF_RIGHT}px`);

    // 216px is a 240px window minus the header padding — narrow even though
    // the viewport media query still says "phone".
    setContainerWidth(216);
    await Promise.resolve();
    expect(wrap).toHaveAttribute("data-axis-mode", "narrow");
    expect(wrap).toHaveStyle({ "padding-right": `${NARROW_EDGE_GUTTER}px` });
    expect(wrap.style.getPropertyValue("--chart-cutoff-right")).toBe(`${NARROW_CUTOFF_RIGHT}px`);
    expect(screen.getByTestId("nifty-chart-last-data-boundary")).toHaveStyle({
      right: `${NARROW_CUTOFF_RIGHT}px`,
    });
    // The candles gain the reservation we removed, with no invented data.
    expect(216 - NARROW_CUTOFF_RIGHT).toBeGreaterThan(216 - MOBILE_CUTOFF_RIGHT);

    const { chart, calls } = fakeChart();
    tv.onChartReady!(chart, null);
    expect(calls.filter((c) => c.scale === "price" && c.id === "right").at(-1)?.options).toMatchObject({
      minimumWidth: NARROW_AXIS_MIN_WIDTH,
      alignLabels: true,
    });
    expect(calls.filter((c) => c.scale === "time").at(-1)?.options).toMatchObject({
      rightOffsetPixels: NARROW_CUTOFF_LANE,
    });

    // A 390px monitor still gets the full 116px phone budget.
    setContainerWidth(366);
    await Promise.resolve();
    expect(wrap).toHaveAttribute("data-axis-mode", "mobile");
    expect(wrap.style.getPropertyValue("--chart-cutoff-right")).toBe(`${MOBILE_CUTOFF_RIGHT}px`);
  });

  test("switching back to desktop restores the 24px engine offset and 88px axis", async () => {
    mount();
    const { chart, calls } = fakeChart();
    tv.onChartReady!(chart, null);
    calls.length = 0;

    env.mobile = true;
    for (const fn of env.mediaListeners) fn({ matches: true });
    await Promise.resolve();
    expect(calls.filter((c) => c.scale === "time").at(-1)?.options).toMatchObject({
      rightOffsetPixels: MOBILE_CUTOFF_LANE,
    });
    expect(calls.filter((c) => c.scale === "price" && c.id === "right").at(-1)?.options).toMatchObject({
      minimumWidth: MOBILE_AXIS_MIN_WIDTH,
    });

    calls.length = 0;
    env.mobile = false;
    for (const fn of env.mediaListeners) fn({ matches: false });
    await Promise.resolve();
    expect(calls.filter((c) => c.scale === "time").at(-1)?.options).toMatchObject({
      rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane,
    });
    expect(calls.filter((c) => c.scale === "price" && c.id === "right").at(-1)?.options).toMatchObject({
      minimumWidth: CHART_PLOT_MARGIN.axisMinWidth,
    });
  });
});

describe("NiftyChartPanel — header control rows", () => {
  test("desktop shows source · timeframe · as-of · expand; size/pattern behind CHART OPTIONS", () => {
    mount();
    const row = screen.getByTestId("nifty-chart-controls-desktop");
    for (const id of ["nifty-chart-source", "nifty-tf-toggle", "nifty-chart-asof", "nifty-chart-expand"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(row).toContainElement(screen.getByTestId(id));
    }
    expect(screen.getByTestId("nifty-chart-asof")).toHaveTextContent("AS OF 10:00");

    const more = screen.getByTestId("nifty-chart-controls-more-desktop");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveTextContent("CHART OPTIONS");
    expect(more).not.toHaveTextContent("MORE ▾");
    const extra = screen.getByTestId("nifty-chart-controls-extra-desktop");
    expect(extra).toHaveStyle({ display: "none" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(more).toHaveTextContent("HIDE OPTIONS");
    expect(more).not.toHaveTextContent("LESS ▴");
    expect(extra).toHaveStyle({ display: "flex" });
    expect(extra).toContainElement(screen.getByTestId("nifty-chart-size"));
    expect(extra).toContainElement(screen.getByTestId("nifty-patterns-scan"));
  });

  test("phone keeps source + MORE on one row and the rest on a second", () => {
    env.mobile = true;
    mount();
    const wrap = screen.getByTestId("nifty-chart-controls-mobile");
    const more = screen.getByTestId("nifty-chart-controls-more");
    expect(wrap).toHaveStyle({ gap: `${CHART_HEADER_METRICS.gap}px` });
    expect(more).toHaveClass("shrink-0");
    expect(more).toHaveTextContent("CHART OPTIONS");
    expect(more).not.toHaveTextContent("MORE ▾");
    expect(wrap.firstElementChild).toContainElement(screen.getByTestId("nifty-chart-source"));
    expect(wrap.firstElementChild).toContainElement(more);
    expect(screen.queryByTestId("nifty-chart-controls-extra")).not.toBeInTheDocument();

    fireEvent.click(more);
    const extra = screen.getByTestId("nifty-chart-controls-extra");
    for (const id of [
      "nifty-tf-toggle",
      "nifty-chart-size",
      "nifty-patterns-scan",
      "nifty-chart-asof",
      "nifty-chart-expand",
    ]) {
      expect(extra).toContainElement(screen.getByTestId(id));
    }
  });

  test("title is 16px, metadata and control captions are 12px, gaps are 8px", () => {
    mount();
    expect(CHART_HEADER_METRICS).toMatchObject({
      titleSize: REPORT_FONT.value,
      metaSize: REPORT_FONT.micro,
      gap: REPORT_PAD.md,
    });
    expect(REPORT_FONT.value).toBe(16);
    expect(REPORT_FONT.micro).toBe(12);
    const title = screen.getByTestId("nifty-chart-title");
    expect(title).toHaveStyle({ "font-size": "16px", "margin-right": "8px" });
    expect(title).toHaveClass("gap-2");
    const source = screen.getByTestId("nifty-chart-source");
    expect(source.style.getPropertyValue("--report-font-body")).toBe("12px");
    const row = screen.getByTestId("nifty-chart-controls-desktop");
    expect(row).toHaveStyle({ gap: "8px" });
  });
});

/**
 * 390px regression: axis tags overlapped at the pane bottom ("00" peeking
 * below a price tag, "109K" crowded against the PW label). Model the tags as
 * boxes measured from the report's 12px mono floor so the reserved lane, the
 * cutoff label and the volume tag are checked as geometry, not bare constants.
 */
describe("NiftyChartPanel — 390px axis label/tag bounds", () => {
  const MONO_ADVANCE_PX = 7.2;
  const AXIS_TAG_PADDING_PX = 20; // engine tick + inner/outer padding
  const tagWidth = (text: string) => Math.ceil(text.length * MONO_ADVANCE_PX) + AXIS_TAG_PADDING_PX;

  function fakeChartWithVolume() {
    const volumeOptions = { lastValueVisible: true };
    const calls: { scale: string; id?: string; options: Record<string, unknown> }[] = [];
    const volumeSeries = {
      seriesType: () => "Histogram",
      options: () => volumeOptions,
      applyOptions: (options: Record<string, unknown>) => Object.assign(volumeOptions, options),
    };
    return {
      volumeOptions,
      chart: {
        timeScale: () => ({
          applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "time", options }),
        }),
        priceScale: (id: string) => ({
          applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "price", id, options }),
        }),
        panes: () => [{ getSeries: () => [volumeSeries] }],
      },
      calls,
    };
  }

  test("the 92px lane fits the whole price label with headroom", () => {
    // Full-label fit is the reason the lane cannot go back to the 88px
    // desktop minimum on a phone: "22,364.00" is the widest axis tag.
    expect(tagWidth("22,364.00")).toBe(85);
    expect(tagWidth("22364.00")).toBe(78);
    expect(tagWidth("22,364.00")).toBeLessThanOrEqual(MOBILE_AXIS_MIN_WIDTH);
    expect(tagWidth("22364.00")).toBeLessThanOrEqual(MOBILE_AXIS_MIN_WIDTH);
    expect(MOBILE_AXIS_MIN_WIDTH - tagWidth("22,364.00")).toBe(7);
    expect(MOBILE_AXIS_MIN_WIDTH - tagWidth("22364.00")).toBe(14);
    // The tag + gutter still clears the cutoff boundary, and only the phone
    // lane is wider than the desktop axis.
    expect(tagWidth("22,364.00") + MOBILE_EDGE_GUTTER).toBeLessThan(MOBILE_CUTOFF_RIGHT);
    expect(MOBILE_AXIS_MIN_WIDTH).toBeGreaterThan(CHART_PLOT_MARGIN.axisMinWidth);
  });

  test("the cutoff label box clears the axis lane on both sides", () => {
    const axisLeftFromWrapRight = MOBILE_EDGE_GUTTER + MOBILE_AXIS_MIN_WIDTH;
    const labelRightFromWrapRight = MOBILE_CUTOFF_RIGHT - MOBILE_CUTOFF_LABEL_GAP;
    // The label ends to the LEFT of the axis, with a real gap — never on an
    // axis tag. It also stays inside the cutoff lane (does not cross the edge).
    expect(labelRightFromWrapRight).toBeGreaterThan(axisLeftFromWrapRight);
    expect(labelRightFromWrapRight - axisLeftFromWrapRight).toBe(
      MOBILE_CUTOFF_LANE - MOBILE_CUTOFF_LABEL_GAP,
    );
    expect(labelRightFromWrapRight - axisLeftFromWrapRight).toBeGreaterThanOrEqual(10);
    expect(MOBILE_CUTOFF_RIGHT - labelRightFromWrapRight).toBe(MOBILE_CUTOFF_LABEL_GAP);
    // The (shorter) cutoff lane is still the separator between the label and
    // the axis tags — it must stay wider than the gap plus a real margin.
    expect(MOBILE_CUTOFF_LANE).toBeGreaterThan(MOBILE_CUTOFF_LABEL_GAP + 4);
    expect(CHART_PLOT_MARGIN.dataCutoffLane).toBe(24);
  });

  test("the engine keeps label alignment on and suppresses only the volume axis tag on a phone", () => {
    env.mobile = true;
    mount();
    const { chart, volumeOptions, calls } = fakeChartWithVolume();
    tv.onChartReady!(chart, null);

    const axis = calls.filter((c) => c.scale === "price" && c.id === "right").at(-1);
    expect(axis?.options).toMatchObject({
      minimumWidth: MOBILE_AXIS_MIN_WIDTH,
      alignLabels: true,
      entireTextOnly: true,
    });
    const time = calls.filter((c) => c.scale === "time").at(-1);
    expect(time?.options).toMatchObject({ rightOffsetPixels: MOBILE_CUTOFF_LANE });
    // Volume bars still render; only the last-value tag that crowded the
    // price tag at the pane bottom is removed.
    expect(volumeOptions.lastValueVisible).toBe(false);
  });

  test("desktop keeps its 88px axis and 24px lane without the colliding volume tag", () => {
    mount();
    const { chart, volumeOptions, calls } = fakeChartWithVolume();
    tv.onChartReady!(chart, null);

    const axis = calls.filter((c) => c.scale === "price" && c.id === "right").at(-1);
    expect(axis?.options).toMatchObject({ minimumWidth: CHART_PLOT_MARGIN.axisMinWidth });
    const time = calls.filter((c) => c.scale === "time").at(-1);
    expect(time?.options).toMatchObject({ rightOffsetPixels: CHART_PLOT_MARGIN.dataCutoffLane });
    expect(volumeOptions.lastValueVisible).toBe(false);
  });
});

describe("NiftyChartPanel — zero-candle pinned series", () => {
  test("shows the named empty state instead of a blank plot with floating price tags", () => {
    const [candles, setCandles] = createSignal(report.candles);
    const markLines = [
      { label: { formatter: "CW 25000" }, value: 25000, color: palette.PRIMARY },
    ] as never;

    render(() => (
      <UIProvider>
        <ChartBody
          view="chart"
          offlineEmpty={false}
          sessionDate="2026-10-12"
          chartCandles={candles()}
          candlesEverShown={true}
          chartHeight={null}
          fillContainer={true}
          mpTouchesLength={0}
          flipMarkerPresent={false}
          patternSourceState="idle"
          patternOverlayCount={0}
          chartMarkLines={markLines}
          chartEmaData={[] as never}
          touchMarkers={[] as never}
          lastDataBoundary="LAST DATA 09:15"
          scanBadge={null}
          chartSource="live"
          scanStatus="idle"
          chartTf="1m"
          symbol={() => "NIFTY"}
          onScanPatterns={() => {}}
        />
      </UIProvider>
    ));

    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-marklines", "1");

    setCandles([]);
    expect(screen.getByTestId("nifty-chart-empty")).toHaveTextContent("No intraday candles");
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-marklines", "0");
    expect(screen.queryByTestId("nifty-chart-last-data-boundary")).not.toBeInTheDocument();
  });
});
