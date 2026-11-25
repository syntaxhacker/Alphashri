// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { createSignal } from "solid-js";
import type { ChartCandle, ChartIndicators, PatternHitDTO, SRZone } from "@/types/chartPatterns";
import { buildPatternTVData, type TVMarker } from "./patternTVData";
import { ZoneBandPrimitive } from "./ZoneBandPrimitive";

const mocks = vi.hoisted(() => {
  const createdSeries: Array<{
    setData: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    removePriceLine: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    attachPrimitive: ReturnType<typeof vi.fn>;
    detachPrimitive: ReturnType<typeof vi.fn>;
  }> = [];
  const applyPriceScaleOptions = vi.fn();
  const makeSeries = () => {
    const s = {
      setData: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
      applyOptions: vi.fn(),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      priceScale: () => ({ applyOptions: applyPriceScaleOptions }),
    };
    createdSeries.push(s);
    return s;
  };
  const rangeState: { current: { from: number; to: number } | null } = { current: null };
  const fitContent = vi.fn();
  const chartApi = {
    addSeries: vi.fn((_kind?: unknown, _options?: unknown) => makeSeries()),
    removeSeries: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({
      fitContent,
      getVisibleLogicalRange: vi.fn(() => rangeState.current),
    }),
    panes: () => [],
  };
  const setMarkers = vi.fn();
  return {
    createdSeries,
    rangeState,
    applyPriceScaleOptions,
    fitContent,
    chartApi,
    setMarkers,
    CandlestickSeries: { kind: "candlestick" },
    HistogramSeries: { kind: "histogram" },
    LineSeries: { kind: "line" },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
    createChart: vi.fn((_container?: unknown, _options?: unknown) => chartApi),
    createSeriesMarkers: vi.fn((_series?: unknown, _markers?: unknown) => ({ setMarkers })),
  };
});

vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: mocks.CandlestickSeries,
  HistogramSeries: mocks.HistogramSeries,
  LineSeries: mocks.LineSeries,
  LineStyle: { Solid: "solid", Dashed: "dashed", Dotted: "dotted" },
  TickMarkType: mocks.TickMarkType,
  createChart: mocks.createChart,
  createSeriesMarkers: mocks.createSeriesMarkers,
}));

import {
  PatternTradingViewChart,
  layoutIndicatorTags,
  type IndicatorTagCandidate,
} from "./PatternTradingViewChart";

function candle(t: string, o: number, c: number): ChartCandle {
  return { t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 };
}

const CANDLES: ChartCandle[] = [
  candle("2026-04-01", 100, 102),
  candle("2026-04-02", 102, 101),
  candle("2026-04-03", 101, 105),
  candle("2026-04-04", 105, 104),
  candle("2026-04-05", 104, 108),
];

function makeHit(): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-01",
    end_date: "2026-04-05",
    start_price: 100,
    end_price: 108,
    breakout_level: 109,
    target: 120,
    stop: 99,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-01", price: 103 },
        { t: "2026-04-05", price: 109 },
      ],
      [
        { t: "2026-04-01", price: 99 },
        { t: "2026-04-05", price: 103 },
      ],
    ],
    trend_lines: [
      {
        kind: "support",
        start_date: "2026-04-01",
        start_price: 99,
        end_date: "2026-04-05",
        end_price: 103,
        slope: 1,
        touches: 3,
        span_bars: 5,
        violations: 0,
      },
      {
        kind: "resistance",
        start_date: "2026-04-01",
        start_price: 103,
        end_date: "2026-04-05",
        end_price: 107,
        slope: 1,
        touches: 2,
        span_bars: 5,
        violations: 0,
      },
    ],
    pivots: [
      { t: "2026-04-02", price: 103, kind: "high" },
      { t: "2026-04-03", price: 100, kind: "low" },
    ],
    notes: "",
  };
}

const INDICATORS: ChartIndicators = {
  aligned: "candles",
  timeframe: "1D",
  session: "2026-04-05",
  partial_last: false,
  series: [
    { id: "sma20", values: [100, 101, 102, 103, 104] },
    { id: "bbUpper", values: [110, 111, 112, 113, 114] },
    { id: "bbMiddle", values: [105, 106, 107, 108, 109] },
    { id: "bbLower", values: [95, 96, 97, 98, 99] },
  ],
  crosses: [
    { t: "2026-04-02", kind: "golden" },
    { t: "2026-04-04", kind: "death" },
  ],
};

const SR_ZONES: SRZone[] = [
  {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: "2026-04-02",
    end_date: "2026-04-04",
    touches: 3,
    score: 0.72,
  },
  {
    kind: "resistance",
    top: 110,
    bottom: 108,
    start_date: "2026-04-01",
    end_date: "2026-04-03",
    touches: 2,
    score: 0.55,
  },
];

beforeEach(() => {
  setupBrowserMocks();
  mocks.createdSeries.length = 0;
  mocks.rangeState.current = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PatternTradingViewChart", () => {
  it("creates the chart and draws candles, levels, boundary/TLS-TLR lines and pivots", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);

    expect(screen.getByTestId("patterns-tv-chart")).toBeInTheDocument();
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
    const options = mocks.createChart.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options).toMatchObject({ handleScroll: true, handleScale: true });
    expect((options.timeScale as Record<string, unknown>).rightOffset).toBe(12);

    const kinds = mocks.chartApi.addSeries.mock.calls.map((c) => c[0]);
    expect(kinds[0]).toBe(mocks.CandlestickSeries);
    expect(kinds).toContain(mocks.HistogramSeries);
    expect(kinds.filter((k) => k === mocks.LineSeries)).toHaveLength(4);

    const [candleSeries, volumeSeries] = mocks.createdSeries;
    expect(candleSeries?.setData).toHaveBeenCalledTimes(1);
    const candleData = candleSeries?.setData.mock.calls[0]?.[0] as Array<{ time: number }>;
    expect(candleData).toHaveLength(5);
    expect(volumeSeries?.setData).toHaveBeenCalledTimes(1);
    expect(mocks.applyPriceScaleOptions).toHaveBeenCalledWith({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    expect(candleSeries?.createPriceLine).not.toHaveBeenCalled();
    expect(mocks.setMarkers).toHaveBeenCalledWith([]);

    expect(mocks.fitContent).toHaveBeenCalled();
  });

  it("disposes the chart on unmount", () => {
    const { unmount } = render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);
    unmount();
    expect(mocks.chartApi.remove).toHaveBeenCalledTimes(1);
  });

  it("renders an empty chart without overlays when there is no hit", () => {
    render(() => <PatternTradingViewChart hit={null} candles={CANDLES} />);
    const [candleSeries] = mocks.createdSeries;
    expect(candleSeries?.setData).toHaveBeenCalled();
    expect(candleSeries?.createPriceLine).not.toHaveBeenCalled();
    expect(mocks.setMarkers).toHaveBeenCalledWith([]);
  });

  it("hides only the toggled-off line series via hiddenNames", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} hiddenNames={new Set(["TLS"])} />);
    const hiddenSeries = mocks.createdSeries.filter((s) =>
      s.applyOptions.mock.calls.some((c) => (c[0] as { visible?: boolean })?.visible === false),
    );
    expect(hiddenSeries).toHaveLength(1);
  });

  it("shows every line series when nothing is hidden", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);
    const hiddenSeries = mocks.createdSeries.filter((s) =>
      s.applyOptions.mock.calls.some((c) => (c[0] as { visible?: boolean })?.visible === false),
    );
    expect(hiddenSeries).toHaveLength(0);
  });

  it("draws no risk price lines; indicator crosses are the only markers", () => {
    render(() => (
      <PatternTradingViewChart
        hit={makeHit()}
        candles={CANDLES}
        indicators={INDICATORS}
        timeframe="1D"
      />
    ));
    const calls = mocks.createdSeries[0]?.createPriceLine.mock.calls ?? [];
    expect(calls).toHaveLength(0);

    const markerCalls = mocks.setMarkers.mock.calls;
    const shown = markerCalls[markerCalls.length - 1]?.[0] as TVMarker[];
    expect(shown).toHaveLength(2);
    expect(shown.every((marker) => marker.group === "crosses")).toBe(true);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-crosses", "2");
  });

  it("hides crosses through the Crosses legend toggle", () => {
    render(() => (
      <PatternTradingViewChart
        hit={null}
        candles={CANDLES}
        indicators={INDICATORS}
        timeframe="1D"
        hiddenNames={new Set(["Crosses"])}
      />
    ));

    const shown = mocks.setMarkers.mock.calls.at(-1)?.[0] as TVMarker[];
    expect(shown).toHaveLength(0);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-crosses", "0");
  });

  it("creates one line series per indicator id and toggles visibility in place", () => {
    const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
    render(() => (
      <PatternTradingViewChart
        hit={null}
        candles={CANDLES}
        indicators={INDICATORS}
        timeframe="1D"
        hiddenNames={hidden()}
      />
    ));

    expect(mocks.createChart).toHaveBeenCalledTimes(1);
    const lineOptions = mocks.chartApi.addSeries.mock.calls
      .filter((call) => call[0] === mocks.LineSeries)
      .map(
        (call) =>
          call[1] as {
            title?: string;
            lastValueVisible?: boolean;
            priceLineVisible?: boolean;
            crosshairMarkerVisible?: boolean;
          },
      );
    expect(lineOptions.map((options) => options.title)).toEqual(["", "", "", ""]);
    expect(
      lineOptions.every(
        (options) =>
          options.lastValueVisible === false &&
          options.priceLineVisible === false &&
          options.crosshairMarkerVisible === false,
      ),
    ).toBe(true);

    const chart = screen.getByTestId("patterns-tv-chart");
    expect(chart).toHaveAttribute("data-indicator-ids", "sma20,bbUpper,bbMiddle,bbLower");
    expect(chart).toHaveAttribute("data-label-eligible-indicators", "sma20,bbMiddle");
    const eligibleLabels = chart.getAttribute("data-label-eligible-indicators") ?? "";
    expect(eligibleLabels).not.toContain("bbUpper");
    expect(eligibleLabels).not.toContain("bbLower");
    expect(chart).toHaveAttribute("data-active-indicators", "4");

    const indicatorSeries = mocks.createdSeries.slice(2);
    expect(indicatorSeries).toHaveLength(4);
    for (const series of indicatorSeries) {
      expect(series.applyOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        }),
      );
    }

    const addCalls = mocks.chartApi.addSeries.mock.calls.length;
    const fitCalls = mocks.fitContent.mock.calls.length;
    setHidden(new Set(["BB"]));

    expect(mocks.chartApi.addSeries).toHaveBeenCalledTimes(addCalls);
    expect(mocks.chartApi.removeSeries).not.toHaveBeenCalled();
    expect(mocks.fitContent).toHaveBeenCalledTimes(fitCalls);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-active-indicators", "1");
    const hiddenSeries = mocks.createdSeries.filter((series) =>
      series.applyOptions.mock.calls.some(
        (call) => (call[0] as { visible?: boolean })?.visible === false,
      ),
    );
    expect(hiddenSeries).toHaveLength(3);
  });

  it("refits only when the symbol/timeframe/window identity changes", () => {
    const [hit, setHit] = createSignal(makeHit());
    const [candles, setCandles] = createSignal<ChartCandle[]>(CANDLES);
    render(() => <PatternTradingViewChart hit={hit()} candles={candles()} />);

    expect(mocks.fitContent).toHaveBeenCalledTimes(1);
    setHit({ ...makeHit(), pattern_name: "Renamed" });
    expect(mocks.fitContent).toHaveBeenCalledTimes(1);

    setCandles([...CANDLES, candle("2026-04-06", 108, 110)]);
    expect(mocks.fitContent).toHaveBeenCalledTimes(2);
  });

  it("filters crosses to the visible logical range and keeps pattern markers", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      candle(`2026-05-${String(index + 1).padStart(2, "0")}`, 100 + index, 101 + index),
    );
    const base = buildPatternTVData({ candles: many, hit: null });
    const markers: TVMarker[] = [
      {
        time: base.candles[0]!.time,
        position: "inBar",
        shape: "circle",
        color: "#fff",
        text: "P",
        group: "pivots",
      },
      ...base.candles.map((candlePoint, index) => ({
        time: candlePoint.time,
        position: index % 2 === 0 ? ("belowBar" as const) : ("aboveBar" as const),
        shape: "square" as const,
        color: "#0f0",
        text: index % 2 === 0 ? "GC" : "DC",
        group: "crosses" as const,
        legendName: "Crosses",
      })),
    ];
    mocks.rangeState.current = { from: 10, to: 12 };

    render(() => <PatternTradingViewChart hit={null} candles={many} data={{ ...base, markers }} />);

    const shown = mocks.setMarkers.mock.calls.at(-1)?.[0] as TVMarker[];
    expect(shown.filter((marker) => marker.group === "crosses")).toHaveLength(3);
    expect(shown.filter((marker) => marker.group === "pivots")).toHaveLength(1);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-crosses", "3");
  });

  it("caps unbounded crosses at the 12 most recent and skips the partial last bar", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      candle(`2026-05-${String(index + 1).padStart(2, "0")}`, 100 + index, 101 + index),
    );
    const last = many[many.length - 1]!;
    const partial = [...many.slice(0, -1), { ...last, is_partial: true }];
    const base = buildPatternTVData({ candles: partial, hit: null });
    const markers: TVMarker[] = base.candles.map((candlePoint) => ({
      time: candlePoint.time,
      position: "belowBar",
      shape: "square",
      color: "#0f0",
      text: "GC",
      group: "crosses",
      legendName: "Crosses",
    }));

    render(() => (
      <PatternTradingViewChart hit={null} candles={partial} data={{ ...base, markers }} />
    ));

    const shown = mocks.setMarkers.mock.calls.at(-1)?.[0] as TVMarker[];
    expect(shown).toHaveLength(12);
    expect(shown.some((marker) => marker.time === last.time)).toBe(false);
    expect(shown[0]?.time).toBe(base.candles[2]?.time);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-crosses", "12");
  });

  it("attaches the zone primitive once, updates it on toggle and detaches on unmount", () => {
    const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
    const { unmount } = render(() => (
      <PatternTradingViewChart
        hit={null}
        candles={CANDLES}
        srZones={SR_ZONES}
        hiddenNames={hidden()}
      />
    ));

    const candleSeries = mocks.createdSeries[0]!;
    expect(candleSeries.attachPrimitive).toHaveBeenCalledTimes(1);
    const primitive = candleSeries.attachPrimitive.mock.calls[0]?.[0] as ZoneBandPrimitive;
    expect(primitive).toBeInstanceOf(ZoneBandPrimitive);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-zones", "2");

    const setZones = vi.spyOn(primitive, "setZones");
    setHidden(new Set(["Support"]));
    expect(setZones).toHaveBeenCalledTimes(1);
    expect(setZones.mock.calls[0]?.[0]).toMatchObject([
      { kind: "resistance", legendName: "Resistance" },
    ]);
    expect(candleSeries.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-visible-zones", "1");

    unmount();
    expect(candleSeries.detachPrimitive).toHaveBeenCalledWith(primitive);
  });

  it("mounts when the chart double does not support series primitives", () => {
    const candleSeries = {
      setData: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: mocks.applyPriceScaleOptions }),
    };
    mocks.chartApi.addSeries.mockImplementationOnce(() => candleSeries as never);

    const { unmount } = render(() => (
      <PatternTradingViewChart
        hit={makeHit()}
        candles={CANDLES}
        indicators={INDICATORS}
        timeframe="1D"
      />
    ));

    expect(candleSeries.setData).toHaveBeenCalledTimes(1);
    expect(mocks.setMarkers).toHaveBeenCalled();
    const chart = screen.getByTestId("patterns-tv-chart");
    expect(chart).toHaveAttribute("data-indicator-ids", "sma20,bbUpper,bbMiddle,bbLower");
    expect(chart).toHaveAttribute("data-active-indicators", "4");
    expect(() => unmount()).not.toThrow();
  });

  it("formats the time axis and crosshair in IST (not the raw UTC epoch)", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);
    const options = mocks.createChart.mock.calls[0]?.[1] as {
      timeScale: { tickMarkFormatter: (t: number, k: number) => string };
      localization: { timeFormatter: (t: number) => string };
    };
    const epoch = Date.parse("2026-05-04T03:50:00+00:00") / 1000; // 09:20 IST
    expect(options.timeScale.tickMarkFormatter(epoch, 3)).toBe("09:20"); // Time
    expect(options.timeScale.tickMarkFormatter(epoch, 2)).toBe("04"); // DayOfMonth
    expect(options.localization.timeFormatter(epoch)).toBe("04 May, 09:20");
  });

  it("formats the time axis and crosshair in the requested market zone", () => {
    render(() => (
      <PatternTradingViewChart
        hit={makeHit()}
        candles={CANDLES}
        timeZone="America/New_York"
      />
    ));
    const options = mocks.createChart.mock.calls[0]?.[1] as {
      timeScale: { tickMarkFormatter: (t: number, k: number) => string };
      localization: { timeFormatter: (t: number) => string };
    };
    const epoch = Date.parse("2026-11-16T14:49:00-05:00") / 1000; // 14:49 EST
    expect(options.timeScale.tickMarkFormatter(epoch, 3)).toBe("14:49"); // Time
    expect(options.timeScale.tickMarkFormatter(epoch, 2)).toBe("16"); // DayOfMonth
    expect(options.localization.timeFormatter(epoch)).toBe("16 Nov, 14:49");
  });

  it("formats the price axis/crosshair numbers with en-IN by default", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);
    const options = mocks.createChart.mock.calls[0]?.[1] as {
      localization: { locale: string };
    };
    expect(options.localization.locale).toBe("en-IN");
  });

  it("formats the price axis/crosshair numbers with en-US for a US market", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} market="usa" />);
    const options = mocks.createChart.mock.calls[0]?.[1] as {
      localization: { locale: string };
    };
    expect(options.localization.locale).toBe("en-US");
  });

  it("rebinds the axis locale when the market changes without recreating the chart", () => {
    const [market, setMarket] = createSignal<"india" | "usa">("india");
    render(() => (
      <PatternTradingViewChart hit={makeHit()} candles={CANDLES} market={market()} />
    ));
    expect(mocks.createChart).toHaveBeenCalledTimes(1);

    setMarket("usa");
    expect(mocks.chartApi.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ localization: expect.objectContaining({ locale: "en-US" }) }),
    );
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
  });

  it("fades a partial last candle and badges it as forming", () => {
    const last = CANDLES[CANDLES.length - 1]!;
    const partial = [...CANDLES.slice(0, -1), { ...last, is_partial: true }];
    render(() => <PatternTradingViewChart hit={makeHit()} candles={partial} />);

    expect(screen.getByTestId("patterns-tv-chart")).toHaveAttribute("data-partial", "true");
    expect(screen.getByTestId("patterns-tv-partial-badge")).toHaveTextContent(/forming/i);

    const candleData = mocks.createdSeries[0]?.setData.mock.calls[0]?.[0] as Array<{
      time: number;
      color?: string;
      borderColor?: string;
      wickColor?: string;
    }>;
    const faded = candleData.filter((c) => c.color != null);
    expect(faded).toHaveLength(1);
    expect(faded[0]?.time).toBe(Math.max(...candleData.map((c) => c.time)));
    expect(faded[0]?.color).toMatch(/^rgba\(/);
    expect(faded[0]?.borderColor).toBe(faded[0]?.color);
    expect(faded[0]?.wickColor).toBe(faded[0]?.color);
  });

  it("leaves completed candles untouched and shows no badge", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);

    expect(screen.queryByTestId("patterns-tv-partial-badge")).toBeNull();
    expect(screen.getByTestId("patterns-tv-chart")).not.toHaveAttribute("data-partial");
    const candleData = mocks.createdSeries[0]?.setData.mock.calls[0]?.[0] as Array<{
      color?: string;
    }>;
    expect(candleData.every((c) => c.color == null)).toBe(true);
  });

  it("does not crash when is_partial is absent or candles are empty", () => {
    expect(() =>
      render(() => <PatternTradingViewChart hit={null} candles={CANDLES} />),
    ).not.toThrow();
    cleanup();
    mocks.createdSeries.length = 0;
    expect(() => render(() => <PatternTradingViewChart hit={null} candles={[]} />)).not.toThrow();
    expect(screen.queryByTestId("patterns-tv-partial-badge")).toBeNull();
  });
});

describe("layoutIndicatorTags", () => {
  const measure = (text: string) => text.length * 8 + 8;
  const CANDIDATES: IndicatorTagCandidate[] = [
    { id: "sma20", label: "SMA20", color: "#4D99FF", y: 40 },
    { id: "sma50", label: "SMA50", color: "#D9902A", y: 80 },
    { id: "sma200", label: "SMA200", color: "#9772FF", y: 120 },
    { id: "bbMiddle", label: "BB", color: "#0FB5D9", y: 160 },
    { id: "vwap", label: "VWAP", color: "#F2EDD3", y: 200 },
  ];

  it.each([
    { name: "1600", paneWidth: 1400, paneHeight: 800, gutterLeft: 1220, lastBarX: 1216 },
    { name: "390", paneWidth: 300, paneHeight: 560, gutterLeft: 246, lastBarX: 240 },
  ])(
    "keeps every $name tag right of the newest bar and inside the pane",
    ({ paneWidth, paneHeight, gutterLeft, lastBarX }) => {
      const { tags } = layoutIndicatorTags(CANDIDATES, {
        paneWidth,
        paneHeight,
        gutterLeft,
        measure,
      });

      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.x).toBeGreaterThan(lastBarX);
        expect(tag.x).toBeGreaterThanOrEqual(gutterLeft);
        expect(tag.x + tag.w).toBeLessThanOrEqual(paneWidth);
        expect(tag.y).toBeGreaterThanOrEqual(0);
        expect(tag.y + tag.h).toBeLessThanOrEqual(paneHeight);
      }
    },
  );

  it("places SMA20 individually on a wide chart", () => {
    const { tags, compact } = layoutIndicatorTags(CANDIDATES, {
      paneWidth: 1400,
      paneHeight: 800,
      gutterLeft: 1220,
      measure,
    });

    expect(compact).toBe(false);
    expect(tags.map((tag) => tag.id)).toEqual([
      "sma20",
      "sma50",
      "sma200",
      "bbMiddle",
      "vwap",
    ]);
  });

  it("merges a narrow 4–5 tag rail to at most two rows without dropping SMA20", () => {
    const { tags, compact } = layoutIndicatorTags(CANDIDATES, {
      paneWidth: 300,
      paneHeight: 560,
      gutterLeft: 246,
      measure,
    });

    expect(compact).toBe(true);
    expect(tags.map((tag) => tag.label)).toEqual(["MAs", "BB"]);
    expect(tags[0]?.id).toBe("mas");
  });

  it("skips tags when even the compact rail cannot fit the gutter", () => {
    const { tags, compact } = layoutIndicatorTags(CANDIDATES, {
      paneWidth: 300,
      paneHeight: 560,
      gutterLeft: 276,
      measure,
    });

    expect(compact).toBe(true);
    expect(tags).toEqual([]);
  });
});
