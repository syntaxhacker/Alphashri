// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import {
  CHART_CUTOFF_RIGHT,
  CHART_HEADER_METRICS,
  CHART_PLOT_MARGIN,
} from "./NiftyChartPanel";
import {
  MOBILE_AXIS_MIN_WIDTH,
  MOBILE_CUTOFF_LABEL_GAP,
  MOBILE_CUTOFF_RIGHT,
  MOBILE_EDGE_GUTTER,
} from "./NiftyChartPanel.body";
import { REPORT_FONT, REPORT_PAD } from "./reportTokens";

const env = vi.hoisted(() => ({ mobile: false }));
const tv = vi.hoisted(() => ({
  onChartReady: null as null | ((chart: unknown, series: unknown) => void),
}));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: (props: {
    fitMarkLines?: boolean;
    onChartReady?: (chart: unknown, series: unknown) => void;
  }) => {
    tv.onChartReady = props.onChartReady ?? null;
    return (
      <div
        data-testid="tradingview-chart"
        data-fit-marklines={props.fitMarkLines ? "1" : "0"}
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
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  env.mobile = false;
  tv.onChartReady = null;
  window.localStorage.clear();
});

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

  test("the phone reserves a real right-axis gutter so a full price tag renders", () => {
    // "22300.00" is eight glyphs plus axis padding; the 88px desktop minimum
    // clipped it to "00" at 390. The phone axis must be measurably wider.
    expect(MOBILE_AXIS_MIN_WIDTH).toBeGreaterThanOrEqual(CHART_PLOT_MARGIN.axisMinWidth + 32);
    expect(MOBILE_EDGE_GUTTER).toBeGreaterThan(CHART_PLOT_MARGIN.edgeGutter);
    expect(MOBILE_CUTOFF_RIGHT).toBe(
      MOBILE_EDGE_GUTTER + MOBILE_AXIS_MIN_WIDTH + CHART_PLOT_MARGIN.dataCutoffLane,
    );

    env.mobile = true;
    mount();
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveStyle({ "padding-right": `${MOBILE_EDGE_GUTTER}px` });
    expect(wrap.style.getPropertyValue("--chart-cutoff-right")).toBe(`${MOBILE_CUTOFF_RIGHT}px`);
    expect(wrap).toHaveAttribute("data-mobile-axis-gutter", String(MOBILE_AXIS_MIN_WIDTH));
    // The cutoff rule moves with the wider axis so it still marks the last bar.
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
  });
});

describe("NiftyChartPanel — header control rows", () => {
  test("desktop shows source · timeframe · as-of · expand; size/pattern behind MORE", () => {
    mount();
    const row = screen.getByTestId("nifty-chart-controls-desktop");
    for (const id of ["nifty-chart-source", "nifty-tf-toggle", "nifty-chart-asof", "nifty-chart-expand"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(row).toContainElement(screen.getByTestId(id));
    }
    expect(screen.getByTestId("nifty-chart-asof")).toHaveTextContent("AS OF 10:00");

    const more = screen.getByTestId("nifty-chart-controls-more-desktop");
    expect(more).toHaveAttribute("aria-expanded", "false");
    const extra = screen.getByTestId("nifty-chart-controls-extra-desktop");
    expect(extra).toHaveStyle({ display: "none" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
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
    expect(more).toHaveTextContent("MORE ▾");
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
 * 390px regression: the price tag used to read "00" under the volume tag.
 * Model the axis tags as boxes measured from the report's 12px mono floor so
 * the reserved lane, the cutoff label and the volume tag are checked as
 * geometry rather than as isolated constants.
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

  test("the dedicated lane fits the full price tag and the volume tag", () => {
    // The comma-bearing session tag is the widest label on the axis.
    expect(tagWidth("22,300.00")).toBeLessThanOrEqual(MOBILE_AXIS_MIN_WIDTH);
    expect(tagWidth("22300.00")).toBeLessThanOrEqual(MOBILE_AXIS_MIN_WIDTH);
    expect(tagWidth("109K")).toBeLessThanOrEqual(MOBILE_AXIS_MIN_WIDTH);
    // Both tags start at the axis' left edge, so each has its own full box
    // inside the lane; neither can be cut at the card edge.
    expect(tagWidth("22,300.00") + MOBILE_EDGE_GUTTER).toBeLessThan(MOBILE_CUTOFF_RIGHT);
    expect(MOBILE_AXIS_MIN_WIDTH).toBeGreaterThan(CHART_PLOT_MARGIN.axisMinWidth);
  });

  test("the cutoff label box clears the axis lane on both sides", () => {
    const axisLeftFromWrapRight = MOBILE_EDGE_GUTTER + MOBILE_AXIS_MIN_WIDTH;
    const labelRightFromWrapRight = MOBILE_CUTOFF_RIGHT - MOBILE_CUTOFF_LABEL_GAP;
    // The label ends to the LEFT of the axis, with a real gap — never on an
    // axis tag. It also stays inside the cutoff lane (does not cross the edge).
    expect(labelRightFromWrapRight).toBeGreaterThan(axisLeftFromWrapRight);
    expect(labelRightFromWrapRight - axisLeftFromWrapRight).toBe(
      CHART_PLOT_MARGIN.dataCutoffLane - MOBILE_CUTOFF_LABEL_GAP,
    );
    expect(MOBILE_CUTOFF_RIGHT - labelRightFromWrapRight).toBe(MOBILE_CUTOFF_LABEL_GAP);
    // The cutoff lane is the separator between the label and the axis tags.
    expect(CHART_PLOT_MARGIN.dataCutoffLane).toBeGreaterThan(MOBILE_CUTOFF_LABEL_GAP + 4);
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
    // Volume bars still render; only the last-value tag that crowded the
    // price tag at the pane bottom is removed.
    expect(volumeOptions.lastValueVisible).toBe(false);
  });

  test("desktop keeps its 88px axis and the volume tag", () => {
    mount();
    const { chart, volumeOptions, calls } = fakeChartWithVolume();
    tv.onChartReady!(chart, null);

    const axis = calls.filter((c) => c.scale === "price" && c.id === "right").at(-1);
    expect(axis?.options).toMatchObject({ minimumWidth: CHART_PLOT_MARGIN.axisMinWidth });
    expect(volumeOptions.lastValueVisible).toBe(true);
  });
});
