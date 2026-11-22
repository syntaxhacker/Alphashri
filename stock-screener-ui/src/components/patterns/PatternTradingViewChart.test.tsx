// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { createSignal } from "solid-js";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";

const mocks = vi.hoisted(() => {
  const createdSeries: Array<{
    setData: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    removePriceLine: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
  }> = [];
  const applyPriceScaleOptions = vi.fn();
  const makeSeries = () => {
    const s = {
      setData: vi.fn(),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
      removePriceLine: vi.fn(),
      applyOptions: vi.fn(),
      priceScale: () => ({ applyOptions: applyPriceScaleOptions }),
    };
    createdSeries.push(s);
    return s;
  };
  const fitContent = vi.fn();
  const chartApi = {
    addSeries: vi.fn((_kind?: unknown) => makeSeries()),
    removeSeries: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({ fitContent }),
    panes: () => [],
  };
  const setMarkers = vi.fn();
  return {
    createdSeries,
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

import { PatternTradingViewChart } from "./PatternTradingViewChart";

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

beforeEach(() => {
  setupBrowserMocks();
  mocks.createdSeries.length = 0;
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
    expect((options.timeScale as Record<string, unknown>).rightOffset).toBe(6);

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

  it("draws no price lines or dot markers (risk levels are the trader's job)", () => {
    render(() => <PatternTradingViewChart hit={makeHit()} candles={CANDLES} />);
    const calls = mocks.createdSeries[0]?.createPriceLine.mock.calls ?? [];
    expect(calls).toHaveLength(0);
    const markerCalls = mocks.setMarkers.mock.calls;
    expect(markerCalls[markerCalls.length - 1]?.[0]).toEqual([]);
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
